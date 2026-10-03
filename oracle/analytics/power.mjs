// Champion POWER: the current and best power for one champion, over the whole vault.
//
//   node --experimental-sqlite oracle/analytics/power.mjs <name|ID> [snapshot.json.gz] [opts]
//     --power N      this copy's in-game power right now, to measure its constant from
//     --top N        print the N best builds rather than only the winner
//
//   node --experimental-sqlite oracle/analytics/power.mjs log <name|ID> <in-game power>
//     record a power reading against Gestal's LIVE stats, for `fit` to calibrate from.
//
//   node --experimental-sqlite oracle/analytics/power.mjs fit <name|ID>
//     fit one champion's weights from its logged readings.
//
//   node --experimental-sqlite oracle/analytics/power.mjs verify [snapshot.json.gz]
//     check the set table against the game's own per-champion set bonuses.
//
// GESTAL SNAPSHOTS ONLY. The stat model needs each copy's base stats and its per-source bonus
// breakdown, and an RSL Helper DB carries neither, so a .db path is refused rather than half-read.
// `log` is the one exception to the snapshots-only convention and reads Gestal's live documents:
// the log line it writes is itself the frozen record.
//
// --experimental-sqlite is needed on Node 22 even though nothing here opens a database: the
// champion selector comes from champs.mjs, which imports node:sqlite for the other snapshot kind.
//
// TOTALS, ROUNDED AND NOT. Two sets of totals are in play on purpose. buildTotals is unrounded and
// is what the objective, the constant and a logged reading use, because that is what power-solve
// scores builds on. statBreakdown's totals round each column as the game's screen does, and are
// what gets PRINTED, because the point of the CURRENT block is that it can be compared with the
// screen. Both come off the same stat record and the same items, so they cannot drift.
//
// Advisory only for the game: nothing is written to a snapshot, to Gestal's folder or to the
// game's own database. `log` and `fit` write to out/, which is personal account data and
// gitignored.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
import { STATS, statBreakdown } from "./champion-stats.mjs";
import { isRealChamp, selectChamps, suggestNames } from "./champs.mjs";
import { gestalChampRows, gestalChampStats, gestalItems, isGestalPath,
  readGestalSnapshot } from "./gestal.mjs";
import { constantFrom, lin, weightsFor } from "./power-model.mjs";
import { buildTotals } from "./power-solve.mjs";
import { SET_BONUSES } from "./set-bonuses.mjs";
import { isSnapshotArg, resolveSnapshot } from "./snapshots.mjs";

// --- CLI: pure helpers ------------------------------------------------------

// What each mode's usage line shows. Printed back on a missing argument, so the answer is the one
// shape that would have worked rather than all four.
export const USAGE = {
  solve: "power.mjs <name|ID> [snapshot.json.gz] [--power N] [--top N]",
  log: "power.mjs log <name|ID> <in-game power>",
  fit: "power.mjs fit <name|ID>",
  verify: "power.mjs verify [snapshot.json.gz]",
};

// The two modes that open a snapshot. The other two must refuse one outright rather than read the
// path as a champion name — see parsePowerArgs.
const READS_SNAPSHOT = new Set(["solve", "verify"]);

// How many positionals each mode takes BESIDES the snapshot: solve and fit take a selector, log
// takes a selector and a power, verify takes neither.
const TAKES = { solve: 1, log: 2, fit: 1, verify: 0 };

// Same selector/snapshot conventions as speed.mjs, plus a mode word. Option VALUES are consumed as
// they are read, so `--top 3 Elhain` still finds Elhain rather than reading 3 as the selector.
export function parsePowerArgs(argv) {
  const out = { mode: "solve", selector: null, dbArg: undefined, power: null, top: 1,
    logPower: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "") continue;
    if (arg === "--power" || arg === "--top") {
      out[arg.slice(2)] = positiveInt(arg, argv[++i]);
      continue;
    }
    // Anything else beginning `--` is a typo, not a champion, and swallowing it as a positional is
    // the worst outcome on offer: `--tpo 3` loses the option-value race, prints one build, exits 0,
    // and says nothing about the two it dropped. A plausible wrong answer, not a crash.
    if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    // A mode word is a mode only as the FIRST positional. `power.mjs Elhain fit` is someone naming
    // a champion and then a mode, which is not a usage line, and reading it as `fit` would answer a
    // different question than the one asked.
    if (positional.length === 0 && Object.hasOwn(USAGE, arg) && arg !== "solve") {
      out.mode = arg;
      continue;
    }
    positional.push(arg);
  }
  if (READS_SNAPSHOT.has(out.mode)) out.dbArg = positional.find(isSnapshotArg);
  if (!READS_SNAPSHOT.has(out.mode)) {
    const snap = positional.find(isSnapshotArg);
    if (snap) {
      throw new Error(`${out.mode} reads no snapshot, so it cannot take "${snap}"`
        + ` — usage: ${USAGE[out.mode]}`);
    }
  }
  const rest = positional.filter((a) => a !== out.dbArg);
  if (rest.length > TAKES[out.mode]) {
    throw new Error(`too many arguments for ${out.mode} — usage: ${USAGE[out.mode]}`);
  }
  out.selector = TAKES[out.mode] > 0 ? rest[0] ?? null : null;
  if (out.mode === "log" && rest.length > 1) out.logPower = positiveInt("the in-game power", rest[1]);
  return out;
}

// In-game power, --power and --top are all WHOLE COUNTS: the game prints power as an integer, and
// "the N best builds" has no fractional reading. Blank is checked before Number(), because
// Number("") and Number(" ") are both 0 — an option whose value went missing would otherwise parse
// as a legal 0, which is the one value that is certainly not meant. parseSpeedArgs makes the same
// check for the same reason.
function positiveInt(what, raw) {
  const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${what} needs a positive integer`);
  }
  return value;
}

// How many of these items a copy is wearing. A measure of INVESTMENT in the copy, not of what it
// could hold — the solver's pool is the whole vault either way.
const equippedCount = (items, champId) =>
  items.filter((it) => it.equippedChampId === champId).length;

// Investment order, most invested first: rank, level, empowerment, awakening, how many pieces it is
// wearing, then the lower id so a rerun on one snapshot picks the same copy.
//
// spare-copies.mjs's compareCopies is the same idea in a different order — it weighs gear above
// empowerment and carries a blessing marker Gestal has no column for — so the two are kept apart
// rather than one being bent to serve both.
function compareInvestment(a, b, awakenOf, items) {
  return (b.Rang - a.Rang)
    || (b.Lvl - a.Lvl)
    || (b.EmpLvl - a.EmpLvl)
    || (awakenOf(b) - awakenOf(a))
    || (equippedCount(items, b.ID) - equippedCount(items, a.ID))
    || (a.ID - b.ID);
}

// One copy per champion: the most invested one. Copies of a champion share a baseTypeId and
// therefore one set of weights, but each has its own constant and its own gear, so solving all of
// them would print the same answer several times over for the copies nobody plays.
//
// An ALL-DIGIT selector is an exact copy id and is never grouped: asking for #12059 by id is asking
// for that copy, spare or not. Anything else is a name substring, which can match several champions
// as well as several copies of one, so the grouping is by BaseHeroID.
//
// `rows` is expected to have been through isRealChamp. A placeholder row for a wearer the roster
// has not listed yet has a null BaseHeroID and no stats record, and grouping those together would
// put unrelated champions in one bucket.
export function mainCopies(rows, statsById, items, selector) {
  const matched = selectChamps(rows, selector);
  if (/^\d+$/.test(String(selector ?? ""))) return matched;
  const awakenOf = (r) => statsById.get(r.ID)?.awaken ?? 0;
  const best = new Map();
  for (const row of matched) {
    const held = best.get(row.BaseHeroID);
    if (!held || compareInvestment(row, held, awakenOf, items) < 0) best.set(row.BaseHeroID, row);
  }
  return [...best.values()].sort((a, b) => a.ID - b.ID);
}

// --- the game's Total Stats screen ----------------------------------------------

// Wide enough for "Faction Guardians", the longest label the stat model produces.
const LABEL_WIDTH = 18;
// Wide enough for a six-digit HP total and for the "C.RATE" heading, with a space between columns.
const CELL_WIDTH = 8;

// One cell. ROUNDED, because that is what the game shows and what statBreakdown's own totals are
// summed from — a column printed unrounded would not add up to the Total row beneath it. A zero is
// BLANK rather than printed: most sources touch two or three stats, and a grid of eighty cells with
// seventy zeroes in it hides the handful that matter.
const cell = (value) => {
  const n = Math.round(value);
  return (n === 0 ? "" : String(n)).padStart(CELL_WIDTH);
};

const gridRow = (label, vector) =>
  `  ${label.padEnd(LABEL_WIDTH)}${STATS.map((stat) => cell(vector[stat])).join("")}`;

// The game's Total Stats screen: one row per source, one column per stat, then the totals. The
// source rows come out in whatever order statBreakdown gives them, which is the screen's own order
// (Basic, Artifacts, Affinity, Classic Arena, Masteries, Faction Guardians, Empowerment, Blessing,
// Relic) — so the layout is the stat model's to change, not this printer's.
export function formatBreakdown(breakdown) {
  const lines = [`  ${"".padEnd(LABEL_WIDTH)}${STATS.map((s) => s.padStart(CELL_WIDTH)).join("")}`];
  for (const [label, vector] of breakdown.columns) lines.push(gridRow(label, vector));
  lines.push(gridRow("Total", breakdown.totals));
  return lines.join("\n");
}

// One build's totals on a single line. A grid per build would be eleven lines each, and --top asks
// for several builds at once; what a reader compares between them is the eight numbers.
//
// Every stat is named, zeroes included, unlike the grid above: on one line there is nothing for a
// zero to hide among, and a missing stat would read as a stat the model does not carry.
export function formatTotals(totals) {
  return `    totals: ${STATS.map((s) => `${s} ${Math.round(totals[s])}`).join("  ")}`;
}

// --- the BEST headline, the certificate and the runners-up ----------------------

// Power from a build's `lin` and the copy's constant. The one place the square is taken, so the
// relationship between the solver's objective and the number the game shows is written once.
const powerOf = (buildLin, c) => (buildLin + c) ** 2;

// The BEST headline. With `c` it is in power, the number on the game's screen; without it neither
// the power nor the gain exists, and the only honest thing left is the ratio at c = 0 — an
// over-estimate, since a positive c raises both sides and shrinks it.
export function formatGain(currentLin, bestLin, c) {
  if (c !== null) {
    const best = powerOf(bestLin, c);
    return `  BEST  ${Math.round(best)} power`
      + `  (+${Math.round(best - powerOf(currentLin, c))} over current)`;
  }
  // Nothing over nothing has no ratio, and at c = 0 it would come out as "+0.0%" for a build that is
  // in fact an infinite improvement. Unreachable for a real champion — base stats alone put `lin`
  // in the hundreds — so it is named rather than computed.
  if (!(currentLin > 0)) {
    return "  BEST  gain unknown (the current build scores zero and the per-copy constant is"
      + " unknown: log a reading or pass --power)";
  }
  const pct = ((bestLin / currentLin) ** 2 - 1) * 100;
  return `  BEST  ≈ +${pct.toFixed(1)}%`
    + " (per-copy constant unknown: log a reading or pass --power)";
}

// What the solver PROVED, as opposed to what it found. power-solve's `upperBound` is a genuine
// upper bound on the objective over EVERY assignment of this vault, so the gap is a proven ceiling
// on how much the answer could still be improved — "within X of the maximum", never "the maximum".
//
// `converged` means a FIXED POINT of the linearize-and-resolve map, which is the exact optimum of
// the objective linearized at its own crit totals and is NOT the optimum of the true objective. The
// wording must not drift into claiming otherwise; power-solve.mjs's header is explicit about it.
// A wide gap is the signal that this champion's crit range is too broad for the linearization,
// which is what the planned exact mode is for.
export function formatCertificate({ gap, upperBound, rounds, converged }, bestLin, c) {
  const best = c === null ? bestLin : powerOf(bestLin, c);
  const amount = c === null ? gap : powerOf(upperBound, c) - best;
  // Two decimals in sqrt(power), where the numbers are single digits; whole numbers in power, which
  // the game shows as an integer.
  const shown = c === null ? amount.toFixed(2) : String(Math.round(amount));
  const pct = best > 0 ? `${((amount / best) * 100).toFixed(2)}%` : "n/a";
  return `    at most ${shown} ${c === null ? "√power" : "power"} (${pct}) below the true maximum`
    + `   [${rounds} round${rounds === 1 ? "" : "s"},`
    + ` ${converged ? "converged" : "no fixed point"}]`;
}

// One runner-up's distance from BEST, in the same unit as the certificate line above so the two
// numbers on one report can be compared. Same shape as speed.mjs's printRanked.
//
// These are the best DISTINCT SETS OF ITEMS the iteration happened to see, which is not a proved
// top-N — power-solve says so outright and this line does not imply otherwise.
export function formatOffBest(index, build, best, c) {
  const delta = c === null ? build.lin - best.lin : powerOf(build.lin, c) - powerOf(best.lin, c);
  const shown = c === null ? delta.toFixed(2) : String(Math.round(delta));
  return `  #${index}  (${shown} ${c === null ? "√power" : "power"} off BEST)`;
}

// --- labels ---------------------------------------------------------------------

const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setLabel = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

// "Merciless x6 · Zeal x2". Biggest count first, then by name, so a rerun prints the same line.
//
// `all` names every set the build holds. The default names only the sets that GRANT STATS, because
// a set that grants none did not move a power number and listing it here would imply it had.
// verify passes `all`: a set that gained a stat in a patch is the case it exists to catch, and that
// set sits in NO_STAT_SETS until the table is updated.
//
// Set 0 never reaches here — setCounts skips it, since a setless piece belongs to no set.
export function formatSets(counts, all = false) {
  const parts = [...counts]
    .filter(([setId]) => all || SET_BONUSES[setId])
    .sort((a, b) => b[1] - a[1] || setLabel(a[0]).localeCompare(setLabel(b[0])))
    .map(([setId, count]) => `${setLabel(setId)} x${count}`);
  if (parts.length) return parts.join(" · ");
  return all ? "no sets" : "no stat sets";
}

// --- the reading log ------------------------------------------------------------

// Which logged readings a fit selector names. fit reads no snapshot, so there is no roster to match
// against — the readings carry their own `heroId` and `name`, and the two rules are selectChamps':
// all digits is an exact copy id, anything else is a case-insensitive substring of the name the
// reading was logged under.
//
// No selector matches NOTHING, not everything. An empty substring would match every reading and
// hand fitWeights two champions, which it refuses — but with a message about mixed baseTypeIds
// rather than about the missing selector that caused it.
export function readingsFor(readings, selector) {
  if (!selector) return [];
  if (/^\d+$/.test(selector)) {
    return readings.filter((r) => Number(r.heroId) === Number(selector));
  }
  const needle = selector.toLowerCase();
  return readings.filter((r) => String(r.name).toLowerCase().includes(needle));
}

// The most recent reading for ONE copy, or null. The constant is a property of the copy, and the
// copy's non-stat investment only grows, so the newest reading is the one that still describes it.
//
// By TIMESTAMP rather than by file order: readings are appended in time order, but the log is a
// plain text file a user can edit or concatenate two of. ISO-8601 strings in UTC compare
// lexicographically in time order, which is why no Date is constructed here.
export function latestReading(readings, heroId) {
  let best = null;
  for (const r of readings) {
    if (r.heroId !== heroId) continue;
    if (!best || String(r.t) > String(best.t)) best = r;
  }
  return best;
}

// --- where the local files live --------------------------------------------------

// The readings and the fitted weights. $RSLH_POWER_DIR overrides the location, which is what lets a
// test run without reading or appending to a real log. The default is MODULE-relative — the way
// analyze.mjs locates out/ — rather than relative to the working directory, so the log is the same
// file whichever directory the tool is run from. oracle/analytics/.gitignore already denies out/:
// a reading log and a fitted table are personal account data.
export function powerDir() {
  return process.env.RSLH_POWER_DIR || fileURLToPath(new URL("out/", import.meta.url));
}

// One reading record per line, in power-fit.mjs's format.
export const readingsPath = () => join(powerDir(), "power-readings.jsonl");

// baseTypeId -> { name, b, r, a, s, k, fittedAt, readings }. The whole object is the `fitted`
// argument to weightsFor, which reads only the five weights and ignores the rest.
export const weightsPath = () => join(powerDir(), "power-weights.json");

// --- CLI: I/O and formatting ------------------------------------------------
// Below this line nothing is unit-tested: snapshot reads, the local files, layout and printing.

// parsePowerArgs, resolveAccount and captureSnapshot all throw messages written for this audience,
// so a mistyped flag or a Gestal folder that is not there gets the message and nothing else.
// Everything past here keeps its stack trace, because anything else that throws is a bug.
function die(e) {
  console.error(e.message);
  process.exit(1);
}

function usage(mode) {
  console.error(`usage: ${USAGE[mode]}`);
  process.exit(1);
}

// Gestal only. The stat model needs each copy's base stats and its per-source bonus breakdown, and
// an RSL Helper DB carries neither — so there is nothing to build a champion's totals from, and
// half-reading one would report a power computed from base stats it had to invent.
function readGestalOrDie(dbArg) {
  const path = resolveSnapshot(dbArg);
  if (!isGestalPath(path)) {
    console.error("power.mjs needs a Gestal snapshot (.json.gz) — an RSL Helper DB has neither"
      + " per-copy base stats nor the bonus breakdown");
    process.exit(1);
  }
  return { path, snapshot: readGestalSnapshot(path) };
}

// Everything the snapshot-reading modes need, off ONE read. `items` is handed to gestalChampRows so
// the wearer columns are built from the same item list the solver searches rather than from a second
// decode of the same document.
//
// Rows go through isRealChamp, which drops the placeholder rows gestalChampRows appends for wearers
// the roster has not listed yet. That is also what makes `statsById.get(row.ID)` total: every row
// that survives came from the roster document, and so has a stat record.
function accountState(snapshot) {
  const items = gestalItems(snapshot);
  return {
    items,
    rows: gestalChampRows(snapshot, items).filter(isRealChamp),
    statsById: gestalChampStats(snapshot),
  };
}

// The reading log, one record per line. A missing file is an empty log, which is the state before
// the first `log`. A line that does not parse is a corrupted log, and skipping it silently would
// make a fit quietly narrower than the reader believes — so it is named, by its real line number.
function readReadings(path) {
  if (!existsSync(path)) return [];
  const out = [];
  const lines = readFileSync(path, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;   // a trailing newline is normal
    try {
      out.push(JSON.parse(line));
    } catch {
      console.error(`${path}: line ${i + 1} is not JSON — the reading log is corrupted`);
      process.exit(1);
    }
  }
  return out;
}

// The fitted weights, or an empty table. A missing file is the state before the first `fit`; a file
// that does not parse is NOT, and falling back to the built-in weights for it would print
// "built-in" on a champion the reader has already calibrated, which reads like the fit never ran.
function readWeights(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`${path} is not readable JSON (${e.message}) — fix or remove it`);
    process.exit(1);
  }
}

// Listed with their ids, because an id is the selector that picks exactly one copy. `why` names
// what the ambiguity would break, which differs between the two callers.
function tooManyCopies(copies, why) {
  console.error(`${why}, but ${copies.length} champions matched:`);
  for (const row of copies) console.error(`  ${row.Name} #${row.ID}`);
  console.error("name one by its id to pick exactly one copy.");
  process.exit(1);
}

// Same shape as speed.mjs: the selector that found nothing, then the near misses, so a half-typed
// name costs one rerun rather than a scroll through the roster.
function noMatch(rows, selector) {
  console.error(`no champion matches "${selector}".`);
  const near = suggestNames(rows, selector);
  if (near.length) console.error(`did you mean: ${near.join(", ")}?`);
  process.exit(1);
}

// The copy's own constant, and where it came from. Both sources go through constantFrom on the
// totals the power was observed WITH, which is what makes the result a property of the COPY rather
// than of the gear it had on at the time — power-model measured `c` unchanged across every gear
// change, so a reading logged weeks ago still describes it.
function resolveConstant(args, weights, currentTotals, readings, heroId) {
  if (args.power !== null) {
    return { c: constantFrom(currentTotals, weights, args.power), source: "--power" };
  }
  const latest = latestReading(readings, heroId);
  if (latest) {
    return { c: constantFrom(latest.totals, weights, latest.power),
      source: `logged reading of ${latest.t}` };
  }
  return { c: null, source: "none" };
}

function printCopy(row, { items, rows, statsById, fitted, readings, args }) {
  const champStats = statsById.get(row.ID);
  const { weights, source, fromDefaults } = weightsFor(
    { baseTypeId: row.BaseHeroID, roleId: row.Role }, fitted);
  const current = items.filter((it) => it.equippedChampId === row.ID);
  // UNROUNDED, because this is what the objective, the constant and a logged reading are all
  // evaluated on. The rounded screen totals are printed just below, and are a different number by
  // at most 1 per stat.
  const currentTotals = buildTotals(champStats, current);
  const currentLin = lin(currentTotals, weights);
  const { c, source: cSource } = resolveConstant(args, weights, currentTotals, readings, row.ID);

  console.log(`\n${row.Name} #${row.ID}  ${row.Rang}★ +${row.Lvl}`
    + `  ·  weights ${source}`
    + `${fromDefaults.length ? ` (approximate: ${fromDefaults.join(", ")})` : ""}`
    + `  ·  constant ${c === null ? "unknown" : `${c.toFixed(2)} (${cSource})`}`);

  console.log("  CURRENT");
  console.log(formatBreakdown(statBreakdown(champStats, current)));
  if (c !== null) console.log(`    ${Math.round((currentLin + c) ** 2)} power`);
  void rows;
}

function runSolve(args) {
  const { path, snapshot } = readGestalOrDie(args.dbArg);
  const { items, rows, statsById } = accountState(snapshot);
  const copies = mainCopies(rows, statsById, items, args.selector);
  if (!copies.length) return noMatch(rows, args.selector);
  if (args.power !== null && copies.length !== 1) {
    return tooManyCopies(copies, "--power is one champion's in-game reading");
  }
  const fitted = readWeights(weightsPath());
  const readings = readReadings(readingsPath());
  console.log(`# Power — snapshot ${path.split(/[\\/]/).pop()}`);
  for (const row of copies) printCopy(row, { items, rows, statsById, fitted, readings, args });
}

function main() {
  let args;
  try {
    args = parsePowerArgs(process.argv.slice(2));
  } catch (e) {
    return die(e);
  }
  if (args.selector === null) return usage(args.mode);
  return runSolve(args);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
