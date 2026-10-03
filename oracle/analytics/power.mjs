// Champion POWER: the current and best power for one champion, over the whole vault.
//
//   node --experimental-sqlite oracle/analytics/power.mjs <name|ID> [snapshot.json.gz] [opts]
//     --power N      this copy's in-game power right now, to measure its constant from
//     --top N        print the N best builds rather than only the winner
//     --exact        prove the maximum instead of certifying a fixed point. Slower, and takes no
//                    --top: it proves one build and keeps no runner-up to rank.
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync,
  writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
import { STATS, statBreakdown } from "./champion-stats.mjs";
import { isRealChamp, selectChamps, suggestNames } from "./champs.mjs";
import { gestalChampRows, gestalChampStats, gestalItems, isGestalPath,
  readGestalSnapshot } from "./gestal.mjs";
import { fitWeights } from "./power-fit.mjs";
import { constantFrom, lin, weightsFor } from "./power-model.mjs";
import { buildTotals, solvePower, solvePowerExact } from "./power-solve.mjs";
import { captureSnapshot, dataRoot, freshnessWarnings, resolveAccount } from "./refresh-gestal.mjs";
import { SET_BONUSES, diffSetBonuses, setCounts } from "./set-bonuses.mjs";
import { isSnapshotArg, resolveSnapshot } from "./snapshots.mjs";
import { describeWearers, otherWearers } from "./wearers.mjs";

// --- CLI: pure helpers ------------------------------------------------------

// What each mode's usage line shows. Printed back on a missing argument, so the answer is the one
// shape that would have worked rather than all four.
export const USAGE = {
  solve: "power.mjs <name|ID> [snapshot.json.gz] [--power N] [--top N] [--exact]",
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
    topGiven: false, exact: false, logPower: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "") continue;
    if (arg === "--power" || arg === "--top") {
      out[arg.slice(2)] = positiveInt(arg, argv[++i]);
      // Recorded SEPARATELY from the value, because --exact refuses any --top at all and `--top 1`
      // is indistinguishable from the default by value alone.
      if (arg === "--top") out.topGiven = true;
      continue;
    }
    // A bare flag: it consumes no value, so `--exact Elhain` still finds Elhain.
    if (arg === "--exact") { out.exact = true; continue; }
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
  // CHECKED AFTER THE LOOP, because the mode is only known once the first positional has been
  // read. Both are refusals rather than warnings: the other three modes run no solver at all, so
  // ignoring the flag there would look like the exact mode had been used; and --exact proves ONE
  // maximum and keeps no runner-up, so every --top above 1 asks for builds it does not have. The
  // option is refused rather than the value, so `--top 1` — which asks for exactly what --exact
  // gives — is refused too, rather than being the single value of a flag that otherwise lies.
  if (out.exact && out.mode !== "solve") {
    throw new Error(`--exact is only supported in solve mode — usage: ${USAGE.solve}`);
  }
  if (out.exact && out.topGiven) {
    throw new Error(`--top is not supported with --exact — the exact mode proves one maximum and`
      + " keeps no runner-up to rank");
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
// which is what `--exact` is for — see formatProven, the line that replaces this one.
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

// What `--exact` PROVED, printed where the certificate line goes. solvePowerExact returns the
// maximum of the true objective over every assignment of this vault, so there is no gap left to
// state — and with no gap there is no unit and no constant, which is why this takes neither
// `bestLin` nor `c` while every other helper here does.
//
// The two numbers it does carry are the ones a reader of an OPT-IN SLOW MODE wants. `runtimeMs` is
// what the proof cost, which is the only reason not to run this mode always. The plan counts say
// how much of the plan space the McCormick bound removed before the branch-and-bound ran; a low
// prune count is not a fault — power-solve.mjs is explicit that the counts are a diagnostic rather
// than usually an early exit.
export function formatProven({ runtimeMs, plansPruned, plansTotal }) {
  return `    proven maximum   [${runtimeMs} ms, ${plansPruned}/${plansTotal} plans pruned]`;
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

// One build: its gear slot by slot, the sets it completes, the pieces it would have to take off
// someone, and its totals.
//
// The sets line is computed from the ITEMS rather than read off the build, because solvePower
// returns no counts — and computing it here is the honest version anyway: a free pick carries an
// item that belongs to some set and can complete one by accident, which has to count.
function printBuild(build, wearers) {
  for (const it of [...build.items].sort((a, b) => a.slot - b.slot)) {
    const on = wearers.get(it.id);
    console.log(`    ${slotName(it.slot).padEnd(7)} ${setLabel(it.set).padEnd(14)}`
      + ` +${String(it.level).padStart(2)}   #${it.id}${on ? `   on ${on}` : ""}`);
  }
  console.log(`    sets: ${formatSets(setCounts(build.items))}`);
  console.log(`    on other champions: ${describeWearers(build.items, wearers)}`);
  console.log(formatTotals(build.totals));
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

  // One wearer map per copy, shared by every build printed for it, because --top draws them all
  // from the same vault-wide pool.
  const wearers = otherWearers(items, row.ID, rows);

  // --exact replaces the whole iterate-and-certify path. One build, no runners-up — the parser has
  // already refused --top — and `proven maximum` where the certificate would be.
  if (args.exact) {
    const proven = solvePowerExact({ items, faction: row.Fraction, champStats, current, weights });
    // No slot can be filled at all: the vault is empty, or every accessory is the wrong faction.
    // speed.mjs prints this same line for an empty index. There is no assignment to report, let
    // alone one to prove anything about, and an empty BEST block would read as a build.
    if (!proven.build) return console.log("  no eligible items for any slot.");
    console.log(`\n${formatGain(currentLin, proven.build.lin, c)}`);
    printBuild(proven.build, wearers);
    return console.log(formatProven(proven));
  }

  const result = solvePower({ items, faction: row.Fraction, champStats, current, weights,
    top: args.top });
  // builds[0] always exists: solvePower records the worn gear as round 0 before it iterates.
  const [best, ...rest] = result.builds;
  console.log(`\n${formatGain(currentLin, best.lin, c)}`);
  printBuild(best, wearers);
  console.log(formatCertificate(result, best.lin, c));

  // The runners-up, each measured against BEST rather than against current: BEST is what a reader
  // compares them with when deciding whether one is worth its lower power.
  rest.forEach((build, i) => {
    console.log(`\n${formatOffBest(i + 2, build, best, c)}`);
    printBuild(build, wearers);
  });
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

// The set table against the game's own per-champion set bonus. set-bonuses.mjs is transcribed from
// Gestal's catalogue and is GAME DATA, so it will drift on a patch; this is the guard, and the
// header comment there names it as such.
//
// Checked against bonusesV2.sets, which is what the champion screen shows. The table is
// multiplier-free and so is that field — Lore of Steel shows under Masteries rather than inside the
// set bonus — so no multiplier is applied on either side here.
function runVerify(args) {
  const { path, snapshot } = readGestalOrDie(args.dbArg);
  const { items, rows, statsById } = accountState(snapshot);
  const mismatches = [];
  let geared = 0;
  for (const row of rows) {
    const worn = items.filter((it) => it.equippedChampId === row.ID);
    // A champion wearing nothing has no set bonus to check, and counting it as a match would
    // inflate the denominator with champions the check never looked at.
    if (!worn.length) continue;
    geared++;
    const counts = setCounts(worn);
    const diff = diffSetBonuses(counts, statsById.get(row.ID).observedSets);
    if (diff.length) mismatches.push({ row, counts, diff });
  }
  console.log(`# Power verify — snapshot ${path.split(/[\\/]/).pop()}`);
  console.log(`set table matches the game's set bonuses for ${geared - mismatches.length}`
    + ` of ${geared} geared champions`);
  for (const { row, counts, diff } of mismatches) {
    // ALL the sets, not only the stat-granting ones: a set that GAINED a stat in a patch is exactly
    // this case, and it sits in NO_STAT_SETS until the table is updated.
    console.log(`\n  ${row.Name} #${row.ID}  ${formatSets(counts, true)}`);
    for (const d of diff) console.log(`    ${d.key}: table ${d.table} vs game ${d.observed}`);
  }
  // A mismatch is a failure, not a note: this runs to find out whether the table can still be
  // trusted, and exiting 0 on a disagreement would let a patch pass unnoticed in a script.
  if (mismatches.length) process.exit(1);
}

// Record one in-game power reading against the copy's stats as they are RIGHT NOW.
//
// THE LIVE FOLDER IS READ HERE DELIBERATELY, against the snapshots-only convention every other mode
// follows: the log line this writes is itself the frozen record, so freezing a snapshot first would
// add a file nobody reads and a chance for the two to disagree. Nothing is written to
// oracle/resources/ — the capture is built in memory and dropped.
function runLog(args) {
  let captured;
  try {
    captured = captureSnapshot(resolveAccount(dataRoot(), null));
  } catch (e) {
    return die(e);
  }
  // `captured.items` is a COUNT, not a list, so the state comes off the snapshot itself.
  const { snapshot } = captured;
  // A warning, not a refusal: Gestal refreshes its documents only while attached to a running Raid,
  // and the reader is looking at the screen and can tell whether it matches.
  for (const w of freshnessWarnings(snapshot)) console.warn(`  warning: ${w}`);

  const { items, rows, statsById } = accountState(snapshot);
  const copies = mainCopies(rows, statsById, items, args.selector);
  if (!copies.length) return noMatch(rows, args.selector);
  // A reading landing on the wrong champion cannot be undone by rerunning — it silently poisons
  // that champion's fit — so an ambiguous selector writes nothing at all.
  if (copies.length !== 1) {
    return tooManyCopies(copies, "a logged reading belongs to one copy");
  }
  const [row] = copies;
  const champStats = statsById.get(row.ID);
  const current = items.filter((it) => it.equippedChampId === row.ID);

  console.log(`${row.Name} #${row.ID}  ${row.Rang}★ +${row.Lvl}  ·  power ${args.logPower}`);
  // The game's layout, so the reader can compare it with the screen the power was read off. That
  // comparison is the only check that the reading and the stat model describe the same copy.
  console.log(formatBreakdown(statBreakdown(champStats, current)));

  const record = {
    t: new Date().toISOString(),
    heroId: row.ID,
    baseTypeId: row.BaseHeroID,
    name: row.Name,
    roleId: row.Role,
    // UNROUNDED, matching what power-solve scores builds on and what the constant is measured
    // against. The rounded screen totals are what was printed above; the difference is at most 1
    // per stat, and recording the rounded ones would make the fit and the solver disagree slightly
    // about what the same build is worth.
    totals: buildTotals(champStats, current),
    power: args.logPower,
  };
  mkdirSync(powerDir(), { recursive: true });
  appendFileSync(readingsPath(), `${JSON.stringify(record)}\n`);
  console.log(`\nlogged to ${readingsPath()}`);
}

// The five parameters in the order power-model resolves them.
const PARAMS = ["b", "r", "a", "s", "k"];

function printFit(readings, fit) {
  const copies = new Set(readings.map((r) => r.heroId));
  console.log(`# Power fit — ${readings[0].name}`
    + `  ·  ${readings.length} readings over ${copies.size}`
    + ` cop${copies.size === 1 ? "y" : "ies"}`);
  for (const name of PARAMS) {
    const value = fit.params[name];
    // A null parameter is one the readings cannot determine. A zero or negative one is a stat the
    // fit barely saw — no weight measured so far is anything but positive, and a negative one would
    // break the solvers. Both are reported as IGNORED rather than as a result, because weightsFor's
    // own test is `> 0` and it will fall through to the built-in or role default for them: the value
    // the solver actually uses is NOT the one on this line.
    const note = value === null ? "   undetermined — weightsFor falls back for it"
      : value <= 0 ? "   ignored, not positive — weightsFor falls back for it"
      : "";
    console.log(`  ${name}  ${value === null ? "—" : value.toPrecision(4)}${note}`);
  }
  // Each copy's own constant, which is what the centering removed and step 6 of the fit put back.
  console.log("  per-copy constants:");
  for (const [heroId, c] of fit.constants) console.log(`    #${heroId}  ${c.toFixed(2)}`);
  // The fit's own error, per reading, so a single bad reading is visible rather than spread across
  // five weights.
  console.log("  residuals:");
  console.log(`    ${"copy".padEnd(10)}${"power".padStart(12)}${"predicted".padStart(12)}`
    + `${"error".padStart(9)}`);
  for (const r of fit.residuals) {
    console.log(`    ${`#${r.heroId}`.padEnd(10)}${String(r.power).padStart(12)}`
      + `${String(Math.round(r.predicted)).padStart(12)}`
      + `${`${r.errorPct.toFixed(2)}%`.padStart(9)}`);
  }
}

// MERGED, not overwritten: the file holds one row per champion, and a fit of one must not drop the
// others — calibrating a second champion would otherwise quietly un-calibrate the first.
//
// `name`, `fittedAt` and `readings` are carried for a reader. weightsFor reads only the five
// weights and ignores the rest, which is what lets the row be both a record and its own input.
function mergeWeights(baseTypeId, readings, fit) {
  const path = weightsPath();
  const table = readWeights(path);
  table[baseTypeId] = {
    name: readings[0].name,
    ...fit.params,
    fittedAt: new Date().toISOString(),
    readings: readings.length,
  };
  mkdirSync(powerDir(), { recursive: true });
  writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`\nwrote ${path}`);
}

// Calibrate one champion's weights from its logged readings. Reads NO snapshot: the readings carry
// the totals they were measured with, which is the whole point of logging them.
function runFit(args) {
  const readings = readReadings(readingsPath());
  const matched = readingsFor(readings, args.selector);
  if (!matched.length) {
    console.error(`no logged readings match "${args.selector}" in ${readingsPath()}`);
    process.exit(1);
  }
  const ids = [...new Set(matched.map((r) => r.baseTypeId))];
  if (ids.length > 1) {
    console.error(`"${args.selector}" matches ${ids.length} champions in the reading log:`);
    for (const id of ids) {
      console.error(`  ${matched.find((r) => r.baseTypeId === id).name} (baseTypeId ${id})`);
    }
    console.error("weights are per champion, so name one of them.");
    process.exit(1);
  }
  // EVERY reading of this champion, across all its copies — not only the ones the selector matched.
  // The weights are shared by every copy and fitWeights removes each copy's own constant exactly, so
  // a second copy adds equations rather than noise.
  const all = readings.filter((r) => r.baseTypeId === ids[0]);
  let fit;
  try {
    fit = fitWeights(all);
  } catch (e) {
    return die(e);
  }
  printFit(all, fit);
  mergeWeights(ids[0], all, fit);
}

function main() {
  let args;
  try {
    args = parsePowerArgs(process.argv.slice(2));
  } catch (e) {
    return die(e);
  }
  // verify reads the whole roster and takes no selector, so it is dispatched before the check the
  // other three share.
  if (args.mode === "verify") return runVerify(args);
  if (args.selector === null) return usage(args.mode);
  if (args.mode === "log") {
    if (args.logPower === null) return usage("log");
    return runLog(args);
  }
  if (args.mode === "fit") return runFit(args);
  return runSolve(args);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
