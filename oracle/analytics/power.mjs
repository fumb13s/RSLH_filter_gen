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
import { selectChamps } from "./champs.mjs";
import { isSnapshotArg } from "./snapshots.mjs";

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
