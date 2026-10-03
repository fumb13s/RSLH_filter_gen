// oracle/analytics/__tests__/power-cli.test.mjs
//
// power.mjs: the pure helpers directly, and all four modes end to end through a spawned node.
//
// Every fixture here is synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds
// personal account data and never belongs in the repo. Nothing about argument parsing, copy
// selection, layout or the fit needs real data.
//
// EVERY spawned run sets RSLH_POWER_DIR to a fresh temp directory. Without it the tool would read
// and append to the developer's real oracle/analytics/out/ — a test that pollutes a personal
// reading log, and one whose own assertions would depend on whatever is already in it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { formatBreakdown, formatCertificate, formatGain, formatOffBest, formatSets, formatTotals,
  latestReading, mainCopies, parsePowerArgs, powerDir, readingsFor, readingsPath,
  weightsPath } from "../power.mjs";
import { STATS } from "../champion-stats.mjs";
import { FORMAT, FORMAT_VERSION } from "../gestal.mjs";
import { writeSnapshot } from "../refresh-gestal.mjs";

// --- parsePowerArgs: modes and positionals ------------------------------------

test("parsePowerArgs defaults to solve and reads the selector and snapshot in either order", () => {
  expect(parsePowerArgs(["Elhain", "x/y.json.gz"]))
    .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
  expect(parsePowerArgs(["x/y.json.gz", "Elhain"]))
    .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
});

test("parsePowerArgs recognises the three subcommands as the first positional", () => {
  expect(parsePowerArgs(["log", "Elhain", "12345"]))
    .toMatchObject({ mode: "log", selector: "Elhain", logPower: 12345 });
  expect(parsePowerArgs(["fit", "Elhain"])).toMatchObject({ mode: "fit", selector: "Elhain" });
  expect(parsePowerArgs(["verify", "x/y.json.gz"]))
    .toMatchObject({ mode: "verify", selector: null, dbArg: "x/y.json.gz" });
});

// `top` defaults to 1 as in parseSpeedArgs; the other three have no default value that could be
// mistaken for a supplied one, so they are null.
test("parsePowerArgs defaults top to 1 and leaves the rest null", () => {
  expect(parsePowerArgs(["Elhain"])).toEqual({
    mode: "solve", selector: "Elhain", dbArg: undefined, power: null, top: 1, logPower: null,
  });
});

test("parsePowerArgs takes no selector and no snapshot at all", () => {
  expect(parsePowerArgs([])).toMatchObject({ mode: "solve", selector: null, dbArg: undefined });
  expect(parsePowerArgs(["verify"])).toMatchObject({ mode: "verify", dbArg: undefined });
});

// Same rule as parseSpeedArgs: an empty arg is no arg, because an empty selector matches the whole
// roster by substring.
test("parsePowerArgs drops empty positional arguments", () => {
  expect(parsePowerArgs([""])).toMatchObject({ selector: null, dbArg: undefined });
});

// --- parsePowerArgs: the numeric arguments -------------------------------------

test("parsePowerArgs reads --power and --top", () => {
  expect(parsePowerArgs(["Elhain", "--power", "412000", "--top", "3"]))
    .toMatchObject({ power: 412000, top: 3 });
});

// In-game power is a whole number on the screen, and --top counts builds. A fractional or negative
// value is a typo, and 0 is the one value that is certainly not meant — `--top 0` would ask for no
// builds at all.
test("parsePowerArgs rejects a --power or --top that is not a positive integer", () => {
  for (const bad of ["0", "-1", "1.5", "lots", "1e3x"]) {
    expect(() => parsePowerArgs(["Elhain", "--top", bad]), `--top ${bad}`)
      .toThrow(/--top needs a positive integer/);
    expect(() => parsePowerArgs(["Elhain", "--power", bad]), `--power ${bad}`)
      .toThrow(/--power needs a positive integer/);
  }
});

// The log power is a positional rather than an option, and gets the same test: a reading logged
// with a fractional power would be fitted against a number the game never showed.
test("parsePowerArgs rejects a log power that is not a positive integer", () => {
  expect(() => parsePowerArgs(["log", "Elhain", "0"]))
    .toThrow(/the in-game power needs a positive integer/);
  expect(() => parsePowerArgs(["log", "Elhain", "-5"]))
    .toThrow(/the in-game power needs a positive integer/);
  expect(() => parsePowerArgs(["log", "Elhain", "12.5"]))
    .toThrow(/the in-game power needs a positive integer/);
});

// Number("") and Number(" ") are both 0, so an empty value would silently parse as a legal option
// rather than as the typo it is. A missing value is Number(undefined) -> NaN.
test("parsePowerArgs rejects an empty or missing option value", () => {
  expect(() => parsePowerArgs(["Elhain", "--top", ""])).toThrow(/--top/);
  expect(() => parsePowerArgs(["Elhain", "--power", "  "])).toThrow(/--power/);
  expect(() => parsePowerArgs(["Elhain", "--top"])).toThrow(/--top/);
});

// An option value must never be mistaken for the selector.
test("parsePowerArgs does not treat an option value as the selector", () => {
  expect(parsePowerArgs(["--top", "3", "Elhain"]).selector).toBe("Elhain");
  expect(parsePowerArgs(["--power", "412000"]).selector).toBe(null);
});

// --- parsePowerArgs: arguments a mode does not take ----------------------------

test("parsePowerArgs rejects an unknown option instead of taking it as a positional", () => {
  expect(() => parsePowerArgs(["Elhain", "--tpo", "3"])).toThrow(/unknown option --tpo/);
  expect(() => parsePowerArgs(["--powr", "1"])).toThrow(/unknown option/);
  expect(() => parsePowerArgs(["verify", "--top", "2", "--nope"])).toThrow(/unknown option --nope/);
});

// Each mode takes only the positionals its usage line shows. An extra one means the command was
// understood differently than it was typed, and guessing which argument to drop is worse than
// saying so.
test("parsePowerArgs rejects an extra positional, naming the mode's usage line", () => {
  expect(() => parsePowerArgs(["fit", "Elhain", "Kael"]))
    .toThrow(/too many arguments for fit — usage: power\.mjs fit <name\|ID>/);
  expect(() => parsePowerArgs(["log", "Elhain", "100", "200"]))
    .toThrow(/too many arguments for log/);
  expect(() => parsePowerArgs(["Elhain", "Kael"])).toThrow(/too many arguments for solve/);
  expect(() => parsePowerArgs(["verify", "Elhain"])).toThrow(/too many arguments for verify/);
});

// fit reads no snapshot and log reads the LIVE folder, so a snapshot handed to either is a reader
// who expects it to be used. Reading the live folder anyway (log), or nothing at all (fit), would
// answer a different question — and `fit x/y.json.gz` would otherwise match the path against
// reading NAMES and report "no logged readings match", which reads like an empty log rather than
// like a mode that never opens a snapshot.
test("parsePowerArgs rejects a snapshot given to a mode that reads none", () => {
  expect(() => parsePowerArgs(["fit", "x/y.json.gz"]))
    .toThrow(/fit reads no snapshot/);
  expect(() => parsePowerArgs(["log", "Elhain", "100", "x/y.json.gz"]))
    .toThrow(/log reads no snapshot/);
  expect(() => parsePowerArgs(["fit", "Elhain", "a.db"])).toThrow(/fit reads no snapshot/);
});

// `solve` is the default mode and has no usage line to type, so the word is an ordinary selector.
test("parsePowerArgs treats a mode word after the first positional as a selector", () => {
  expect(parsePowerArgs(["solve"])).toMatchObject({ mode: "solve", selector: "solve" });
});

// --- mainCopies -----------------------------------------------------------------
//
// Champion rows as gestalChampRows builds them, cut down to the columns mainCopies reads. Two
// copies of one champion share a BaseHeroID; `awaken` is NOT a row column — Gestal carries it per
// copy and the row shape mirrors RSL Helper's Champs table, which has none — so it arrives in the
// separate stats map.
const copyRow = (o = {}) => ({
  ID: 1, Name: "Elhain", Role: 0, Rarity: 5, Rang: 6, Lvl: 60, Fraction: 0, EmpLvl: 0,
  BaseHeroID: 1490, ...o,
});
const statsOf = (byId) => new Map(Object.entries(byId).map(([id, awaken]) => [Number(id), { awaken }]));
const worn = (id, champId) => ({ id, equippedChampId: champId });
const idsOf = (rows) => rows.map((r) => r.ID);

// Rank first: a 6-star copy is the one being played however long the 5-star has been sitting at
// level 60.
test("mainCopies keeps the higher-ranked copy of a champion", () => {
  const rows = [copyRow({ ID: 1, Rang: 5 }), copyRow({ ID: 2, Rang: 6 })];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2]);
});

test("mainCopies falls to level when the rank ties", () => {
  const rows = [copyRow({ ID: 1, Lvl: 60 }), copyRow({ ID: 2, Lvl: 50 })];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([1]);
});

test("mainCopies falls to empowerment when rank and level tie", () => {
  const rows = [copyRow({ ID: 1, EmpLvl: 0 }), copyRow({ ID: 2, EmpLvl: 3 })];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2]);
});

// Awakening comes off the stats map, not the row. A copy with no stats record reads as awaken 0
// rather than crashing, which is what keeps the comparator total.
test("mainCopies falls to awakening, which it reads from the stats map", () => {
  const rows = [copyRow({ ID: 1 }), copyRow({ ID: 2 })];
  expect(idsOf(mainCopies(rows, statsOf({ 1: 0, 2: 5 }), [], "Elhain"))).toEqual([2]);
  expect(idsOf(mainCopies(rows, statsOf({ 1: 5 }), [], "Elhain"))).toEqual([1]);
});

test("mainCopies falls to how many pieces the copy is wearing", () => {
  const rows = [copyRow({ ID: 1 }), copyRow({ ID: 2 })];
  const items = [worn(10, 2), worn(11, 2), worn(12, 1)];
  expect(idsOf(mainCopies(rows, statsOf({}), items, "Elhain"))).toEqual([2]);
});

// The last tiebreak, and the one that makes a rerun on one snapshot deterministic.
test("mainCopies falls to the lower id when every other measure ties", () => {
  const rows = [copyRow({ ID: 7 }), copyRow({ ID: 3 })];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([3]);
});

// Two different champions are two groups, not two copies, however alike their names.
test("mainCopies keeps one copy per BaseHeroID and returns them in id order", () => {
  const rows = [
    copyRow({ ID: 1, BaseHeroID: 1490, Rang: 5 }),
    copyRow({ ID: 2, BaseHeroID: 1490, Rang: 6 }),
    copyRow({ ID: 9, BaseHeroID: 1491, Name: "Dark Elhain" }),
    copyRow({ ID: 8, BaseHeroID: 1491, Name: "Dark Elhain", Rang: 4 }),
  ];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2, 9]);
});

// An id is a request for THAT copy. Grouping it would answer with a different one, which is the
// single worst thing an exact selector can do.
test("mainCopies returns the exact copy for an all-digit selector, spare or not", () => {
  const rows = [copyRow({ ID: 1, Rang: 6 }), copyRow({ ID: 2, Rang: 2, Lvl: 1 })];
  expect(idsOf(mainCopies(rows, statsOf({}), [], "2"))).toEqual([2]);
  expect(idsOf(mainCopies(rows, statsOf({}), [], "99"))).toEqual([]);
});

test("mainCopies returns nothing when the selector matches nothing", () => {
  expect(mainCopies([copyRow()], statsOf({}), [], "Kael")).toEqual([]);
});

// --- formatBreakdown ------------------------------------------------------------
//
// The grid is read back by SLICING fixed-width fields rather than by splitting on whitespace: a
// blank cell is the thing being tested, and splitting would collapse it into its neighbours. The
// widths are re-derived here rather than imported, so a change to the layout fails this test —
// which is the point, the widths ARE the contract.
const LABEL_W = 18, CELL_W = 8;
const fields = (line) => {
  const body = line.slice(2);
  return [body.slice(0, LABEL_W).trim(),
    ...STATS.map((_, i) => body.slice(LABEL_W + i * CELL_W, LABEL_W + (i + 1) * CELL_W).trim())];
};

const vec = (o = {}) => ({ ...Object.fromEntries(STATS.map((s) => [s, 0])), ...o });

test("formatBreakdown heads the grid with the eight stats in the screen's order", () => {
  const lines = formatBreakdown({ columns: [], totals: vec() }).split("\n");
  expect(fields(lines[0])).toEqual(["", ...STATS]);
});

// One row per source, in whatever order the breakdown gives them, then Total. A zero is left BLANK
// rather than printed: most sources touch two or three stats, and a grid of 80 cells with seventy
// zeroes in it hides the handful that matter.
test("formatBreakdown prints one row per column, then Total, blanking the zeroes", () => {
  const breakdown = {
    columns: [["Basic", vec({ HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30 })],
      ["Artifacts", vec({ "C.RATE": 12, "C.DMG": 30 })]],
    totals: vec({ HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 27, "C.DMG": 80, RES: 30 }),
  };
  const lines = formatBreakdown(breakdown).split("\n");
  expect(fields(lines[1]))
    .toEqual(["Basic", "15000", "1000", "900", "100", "15", "50", "30", ""]);
  expect(fields(lines[2])).toEqual(["Artifacts", "", "", "", "", "12", "30", "", ""]);
  expect(fields(lines[3]))
    .toEqual(["Total", "15000", "1000", "900", "100", "27", "80", "30", ""]);
  expect(lines).toHaveLength(4);
});

// Column vectors are unrounded on purpose (champion-stats.mjs rounds each column once and then
// sums). Printing one unrounded would leave a column that does not add up to the Total beneath it.
test("formatBreakdown rounds each cell, as the game's screen does", () => {
  const lines = formatBreakdown({
    columns: [["Classic Arena", vec({ HP: 3300.4, ATK: 220.6 })]], totals: vec({ HP: 3300 }),
  }).split("\n");
  expect(fields(lines[1])).toEqual(["Classic Arena", "3300", "221", "", "", "", "", "", ""]);
});

// Faction Guardians is the longest label the stat model produces, at 17 characters, so the label
// column has to hold it without pushing the grid out of alignment.
test("formatBreakdown keeps the grid aligned under the longest source label", () => {
  const lines = formatBreakdown({
    columns: [["Faction Guardians", vec({ HP: 2000 })]], totals: vec({ HP: 2000 }),
  }).split("\n");
  expect(fields(lines[1])[0]).toBe("Faction Guardians");
  expect(fields(lines[1])[1]).toBe("2000");
});

// --- formatTotals ---------------------------------------------------------------

// One line rather than a grid: a build's totals are printed per build, and --top prints several.
test("formatTotals names every stat with its rounded value on one line", () => {
  expect(formatTotals(vec({ HP: 42000.4, ATK: 2100, SPD: 240, "C.RATE": 100, "C.DMG": 220 })))
    .toBe("    totals: HP 42000  ATK 2100  DEF 0  SPD 240  C.RATE 100  C.DMG 220  RES 0  ACC 0");
});

// --- formatGain -----------------------------------------------------------------

// With the constant the answer is in POWER, the number the game shows, and the gain is a difference
// the reader can check against the screen.
//   current (100 + 5)^2 = 11,025 · best (120 + 5)^2 = 15,625 · gain 4,600
test("formatGain reports power and the gain over current when the constant is known", () => {
  expect(formatGain(100, 120, 5)).toBe("  BEST  15625 power  (+4600 over current)");
});

// Power is (lin + c)^2, so without `c` every absolute number is unavailable and only the RATIO can
// be stated — computed at c = 0, where it is an OVER-estimate, because a positive c raises both
// sides and shrinks the ratio. Marked `≈` and told to the reader outright rather than dressed up as
// a power number.
//   (120 / 100)^2 - 1 = 0.44
test("formatGain falls back to a percentage when the constant is unknown", () => {
  expect(formatGain(100, 120, null))
    .toBe("  BEST  ≈ +44.0% (per-copy constant unknown: log a reading or pass --power)");
});

// A negative constant is legal — constantFrom is signed and never clamped, so a disagreement
// between the weights and the reading stays visible rather than being absorbed into a floor.
//   current (100 - 20)^2 = 6,400 · best (120 - 20)^2 = 10,000 · gain 3,600
test("formatGain handles a negative constant without losing the sign", () => {
  expect(formatGain(100, 120, -20)).toBe("  BEST  10000 power  (+3600 over current)");
});

// Nothing over nothing has no ratio. It cannot arise from a real champion — base stats alone put
// `lin` in the hundreds — so it is named rather than turned into a percentage, which at c = 0 would
// read as "+0.0%" for a build that is in fact an infinite improvement.
test("formatGain names a zero current rather than reporting a ratio for it", () => {
  expect(formatGain(0, 120, null)).toMatch(/gain unknown/);
});

// --- formatCertificate ----------------------------------------------------------
//
// `gap` and `upperBound` come out of power-solve in sqrt(power) units — it maximizes `lin`, and its
// McCormick bound bounds `lin`. With `c` they convert to power; without it they are reported in
// their own units rather than silently mislabelled as power, which is the one way this line could
// be read as a much smaller number than it is.

const cert = (o = {}) => ({ gap: 5, upperBound: 125, rounds: 3, converged: true, ...o });

//   best (120 + 5)^2 = 15,625 · bound (125 + 5)^2 = 16,900 · gap 1,275 · 1275/15625 = 8.16%
test("formatCertificate converts the gap to power when the constant is known", () => {
  expect(formatCertificate(cert(), 120, 5))
    .toBe("    at most 1275 power (8.16%) below the true maximum   [3 rounds, converged]");
});

//   gap 5 in sqrt(power) against a best `lin` of 120 · 5/120 = 4.17%
test("formatCertificate keeps the gap in sqrt(power) when the constant is unknown", () => {
  expect(formatCertificate(cert({ rounds: 1, converged: false }), 120, null))
    .toBe("    at most 5.00 √power (4.17%) below the true maximum   [1 round, no fixed point]");
});

// `converged` is a fixed point of the linearize-and-resolve map, NOT an optimum, and a cycle or a
// maxRounds stop is neither. The wording has to keep those apart without either claiming
// optimality.
test("formatCertificate says plainly when there was no fixed point", () => {
  expect(formatCertificate(cert({ converged: false }), 120, 5)).toMatch(/no fixed point/);
  expect(formatCertificate(cert({ converged: true }), 120, 5)).toMatch(/converged/);
});

// power-solve leaves `gap` unclamped so a violated assumption stays visible, and float noise can
// put it a hair below zero. Printing the sign is the whole point; absorbing it into an absolute
// value would hide exactly the case the gap was left signed for.
test("formatCertificate keeps a negative gap visible rather than absorbing it", () => {
  expect(formatCertificate(cert({ gap: -0.004 }), 120, null)).toMatch(/at most -0\.00 √power/);
});

// --- formatOffBest --------------------------------------------------------------

// The runners-up, measured against BEST in the SAME unit as the certificate line, so the two
// numbers on one report are comparable. The delta is negative by construction — these are worse
// builds — and the sign is printed rather than a minus being pasted in front of an absolute value.
//   (110 + 5)^2 = 13,225 against (120 + 5)^2 = 15,625 -> -2,400
test("formatOffBest measures a runner-up against BEST in power when the constant is known", () => {
  expect(formatOffBest(2, { lin: 110 }, { lin: 120 }, 5)).toBe("  #2  (-2400 power off BEST)");
});

test("formatOffBest measures it in sqrt(power) when the constant is unknown", () => {
  expect(formatOffBest(3, { lin: 110 }, { lin: 120 }, null))
    .toBe("  #3  (-10.00 √power off BEST)");
});

// --- formatSets -----------------------------------------------------------------
//
// Set names come from @rslh/core's ARTIFACT_SET_NAMES, the same table speed.mjs and
// champion-gear.mjs label items with, so one report does not call a set what another does not.
// (set-bonuses.mjs carries its own `name` field; it is not the one printed.)

test("formatSets names each set with its count, biggest first", () => {
  expect(formatSets(new Map([[59, 6], [54, 2]]))).toBe("Merciless x6 · Zeal x2");
});

test("formatSets breaks a tie on the set name, so a rerun prints the same line", () => {
  expect(formatSets(new Map([[54, 2], [59, 2]]))).toBe("Merciless x2 · Zeal x2");
  expect(formatSets(new Map([[59, 2], [54, 2]]))).toBe("Merciless x2 · Zeal x2");
});

// Set 12 is Cursed, one of the 28 ids that grant no stats at all. Naming it in a POWER report would
// imply it moved the number; it cannot, because no stat column reflects it.
test("formatSets leaves out the sets that grant no stats", () => {
  expect(formatSets(new Map([[12, 4], [59, 2]]))).toBe("Merciless x2");
  expect(formatSets(new Map([[12, 4]]))).toBe("no stat sets");
  expect(formatSets(new Map())).toBe("no stat sets");
});

// verify is the one caller that wants them all. A set that GAINED a stat in a game patch is
// exactly what it is looking for, and that set is still in NO_STAT_SETS until the table is
// updated — so hiding it would hide the cause of the mismatch being reported.
test("formatSets names every set when asked for all of them", () => {
  expect(formatSets(new Map([[12, 4], [59, 2]]), true)).toBe("Cursed x4 · Merciless x2");
  expect(formatSets(new Map(), true)).toBe("no sets");
});

// --- readingsFor / latestReading ------------------------------------------------
//
// A reading record, in power-fit.mjs's format. Only the four fields these two helpers read are
// filled in; the fit's own tests cover `totals` and `power`.
const rec = (o = {}) => ({ t: "2026-10-03T12:00:00.000Z", heroId: 11, baseTypeId: 999001,
  name: "Synthetic", roleId: 0, ...o });

// fit reads NO snapshot, so its selector is matched against the readings themselves rather than
// against a roster. Same two rules selectChamps uses: all digits is an exact copy id, anything else
// is a case-insensitive name substring.
test("readingsFor matches an all-digit selector against heroId", () => {
  const log = [rec({ heroId: 11 }), rec({ heroId: 22 })];
  expect(readingsFor(log, "22").map((r) => r.heroId)).toEqual([22]);
  expect(readingsFor(log, "99")).toEqual([]);
});

test("readingsFor matches anything else as a case-insensitive name substring", () => {
  const log = [rec({ name: "Thor Faehammer" }), rec({ name: "Madame Serris" })];
  expect(readingsFor(log, "faeham").map((r) => r.name)).toEqual(["Thor Faehammer"]);
  expect(readingsFor(log, "SERRIS").map((r) => r.name)).toEqual(["Madame Serris"]);
});

// An empty selector would match every reading by substring and fit two champions together, which
// fitWeights refuses — but with a message about mixed baseTypeIds rather than about the missing
// selector that caused it.
test("readingsFor matches nothing without a selector", () => {
  expect(readingsFor([rec()], null)).toEqual([]);
  expect(readingsFor([rec()], "")).toEqual([]);
});

// The constant is a property of the COPY, so the reading it is measured from has to be that copy's.
// The MOST RECENT one, because the copy's non-stat investment (a blessing, a relic) only grows.
test("latestReading takes the newest reading for one copy", () => {
  const log = [
    rec({ heroId: 11, t: "2026-10-01T09:00:00.000Z" }),
    rec({ heroId: 22, t: "2026-10-09T09:00:00.000Z" }),
    rec({ heroId: 11, t: "2026-10-03T09:00:00.000Z" }),
  ];
  expect(latestReading(log, 11).t).toBe("2026-10-03T09:00:00.000Z");
  expect(latestReading(log, 22).t).toBe("2026-10-09T09:00:00.000Z");
});

// No reading for this copy is the state before the first log, not an error: solve falls back to
// reporting a ratio.
test("latestReading returns null when the copy has no reading", () => {
  expect(latestReading([rec({ heroId: 11 })], 99)).toBe(null);
  expect(latestReading([], 11)).toBe(null);
});

// The log is appended in time order, but it is a plain text file a user can edit or concatenate, so
// the newest is taken by comparing timestamps rather than by reading the last line.
test("latestReading compares timestamps rather than trusting the file order", () => {
  const log = [rec({ t: "2026-10-09T09:00:00.000Z" }), rec({ t: "2026-10-01T09:00:00.000Z" })];
  expect(latestReading(log, 11).t).toBe("2026-10-09T09:00:00.000Z");
});

// --- powerDir -------------------------------------------------------------------

// The default is MODULE-relative, the way analyze.mjs locates out/, rather than relative to the
// working directory — so the reading log is the same file whichever directory the tool is run from.
// oracle/analytics/.gitignore already denies out/: these are personal account data.
test("powerDir defaults to the module's own out/ directory", () => {
  const saved = process.env.RSLH_POWER_DIR;
  try {
    delete process.env.RSLH_POWER_DIR;
    expect(powerDir().replace(/\\/g, "/")).toMatch(/oracle\/analytics\/out\/?$/);
  } finally {
    if (saved === undefined) delete process.env.RSLH_POWER_DIR;
    else process.env.RSLH_POWER_DIR = saved;
  }
});

// $RSLH_POWER_DIR is what lets a test run without touching a real reading log, and what lets the
// account owner keep one somewhere else.
test("powerDir honours $RSLH_POWER_DIR and the two file names hang off it", () => {
  const saved = process.env.RSLH_POWER_DIR;
  try {
    process.env.RSLH_POWER_DIR = "/tmp/elsewhere";
    expect(powerDir()).toBe("/tmp/elsewhere");
    expect(readingsPath()).toBe("/tmp/elsewhere/power-readings.jsonl");
    expect(weightsPath()).toBe("/tmp/elsewhere/power-weights.json");
  } finally {
    if (saved === undefined) delete process.env.RSLH_POWER_DIR;
    else process.env.RSLH_POWER_DIR = saved;
  }
});

// === end to end ==================================================================
//
// The CLI over throwaway synthetic snapshots, read back from its stdout and stderr.

const SCRIPT = fileURLToPath(new URL("../power.mjs", import.meta.url));
// node:sqlite needs the flag on Node 22 and refuses it on builds that no longer know it. power.mjs
// opens no database, but its champion selector comes from champs.mjs, which imports node:sqlite for
// the other snapshot kind. --no-warnings keeps that module's ExperimentalWarning off stderr, which
// the message assertions below read.
const FLAGS = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-sqlite"] : [];

const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "power-cli-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// EVERY run gets a fresh RSLH_POWER_DIR, so no test ever reads or appends to the developer's real
// oracle/analytics/out/. GESTAL_DATA_ROOT is always set too, and by default to a path that does not
// exist: a test that reaches the live folder by mistake then fails loudly instead of reading a real
// account. Only the `log` tests point it at a fixture.
const run = (args, { powerDir = tmp(), dataRoot } = {}) => spawnSync(
  process.execPath, [...FLAGS, "--no-warnings", SCRIPT, ...args],
  { encoding: "utf8", env: { ...process.env,
    RSLH_POWER_DIR: powerDir,
    GESTAL_DATA_ROOT: dataRoot ?? join(powerDir, "no-gestal-folder-here") } });

// --- Gestal fixtures ------------------------------------------------------------
//
// Synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds personal account
// data and never belongs in the repo.

// Gestal's slot ids are 0-based and are NOT ours: 0 is the Weapon (our slot 5), 1 the Helmet
// (our 1), 2 the Shield (our 6). Named here so the fixtures below read as gear rather than as
// integers.
const G_WEAPON = 0, G_HELMET = 1, G_SHIELD = 2;
// Gestal stat ids, which are a third numbering again: 8 is C.RATE and 9 is C.DMG, both stored as
// integers x100 of what the game displays.
const G_CRATE = 8, G_CDMG = 9;
// .hsf set ids, as ARTIFACT_SET_NAMES and SET_BONUSES key them. Both are `stack` sets completing
// every 2 pieces: Critical Rate pays +12 C.RATE, Crit Damage +20 C.DMG.
const CR_SET = 5, CD_SET = 6;

// A Gestal artifact record: a Legendary 6★ +16 Weapon with a C.RATE 12 main and a C.DMG 30
// substat, setless and unequipped.
function piece(o = {}) {
  return {
    id: 1, slot: G_WEAPON, gearSetId: 0, factionId: null, rarityId: 5, rank: 6, level: 16,
    ascensionLevel: 0,
    mainStatId: G_CRATE, mainStatValue: 1200,
    substats: [{ statId: G_CDMG, value: 3000, glyphBonusValue: null, rolls: 2, isMythicalRoll: false }],
    ascensionStat: null, equippedOnHeroId: null, sellPrice: 0, isNew: false, isReworked: false,
    isAnomalous: false, ...o,
  };
}

// A Gestal champion record carrying the six stat fields gestalChampStats reads. The bonus shapes
// are the ones a real capture shows (gestal-stats.test.mjs): HP/ATK/DEF flat or %, SPD flat, RES
// and ACC flat, and both crits as FRACTIONS. Lore of Steel is off, which keeps the Masteries column
// at zero and the set arithmetic below checkable by hand.
function champion(o = {}) {
  return {
    heroId: 100, typeId: 1496, baseTypeId: 1490, grade: 6, level: 60, empowerLevel: 0,
    blessingId: null, factionId: 0, rarityId: 5, roleId: 0, name: "Elhain", awakenLevel: 0,
    baseStats: { hp: 15000, atk: 1000, def: 900, spd: 100, crate: 15, cdmg: 50, res: 30, acc: 0 },
    loreOfSteelMultiplier: 0,
    bonusesV2: { sets: [], mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
    ...o,
  };
}

const doc = (schemaVersion, payload) => ({ schemaVersion, payload });

function snapshotOf({ artifacts = [], champions = [champion()] } = {}) {
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, capturedAt: "2026-10-03T12:05:00Z",
    gestalVersion: "0.8.15",
    documents: {
      artifacts: doc(2, { extractedAt: "2026-10-03T12:00:00Z", gameVersion: "11.75.0", artifacts }),
      champions: doc(2, { extractedAt: "2026-10-03T12:00:30Z", gameVersion: "11.75.0", champions }),
    },
  };
}

// A snapshot on disk, where the tool reads one. The .json.gz extension is load-bearing twice over:
// the readers recognise a Gestal snapshot by it, and it is what .gitignore denies repo-wide.
function snapshotFile(opts) {
  const path = join(tmp(), "2026-10-03-Gestal.json.gz");
  writeSnapshot(path, snapshotOf(opts));
  return path;
}

// Six pieces over three slots: three Critical Rate and three Crit Damage. TWO sets over THREE
// slots is what gives the solver more than one plan to rank — each set can reach its useful count
// of 2, so the plans are {}, {Critical Rate: 2} and {Crit Damage: 2} — which is what --top needs.
// The three Critical Rate pieces are worn, so CURRENT is a real build and BEST has somewhere to go.
const cdPiece = (id, slot) => piece({
  id, slot, gearSetId: CD_SET, mainStatId: G_CDMG, mainStatValue: 6000,
  substats: [{ statId: G_CRATE, value: 800, glyphBonusValue: null, rolls: 1, isMythicalRoll: false }],
});
const GEAR = [
  piece({ id: 1, slot: G_WEAPON, gearSetId: CR_SET, equippedOnHeroId: 100 }),
  piece({ id: 2, slot: G_HELMET, gearSetId: CR_SET, equippedOnHeroId: 100 }),
  piece({ id: 3, slot: G_SHIELD, gearSetId: CR_SET, equippedOnHeroId: 100 }),
  cdPiece(4, G_WEAPON), cdPiece(5, G_HELMET), cdPiece(6, G_SHIELD),
];

// Two champions sharing a name substring and NOT a baseTypeId, so mainCopies keeps one of each and
// a selector of "Elhain" is genuinely ambiguous.
const TWO_CHAMPS = [champion(), champion({ heroId: 200, baseTypeId: 1491, name: "Dark Elhain" })];

// --- solve: the arguments it refuses --------------------------------------------

// The stat model needs each copy's base stats and its per-source bonus breakdown, and an RSL Helper
// DB carries neither. Half-reading one would report a champion's power from base stats it had to
// invent, which is a plausible wrong answer rather than a crash.
test("solve refuses a non-Gestal snapshot, saying what it is missing", () => {
  const res = run(["Elhain", "x/y.db"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/power\.mjs needs a Gestal snapshot \(\.json\.gz\)/);
  expect(res.stderr).toMatch(/neither per-copy base stats nor the bonus breakdown/);
});

// The mode's OWN usage line, not all four: the answer to a missing argument is the one shape that
// would have worked.
test("solve without a selector exits 1 with solve's usage line", () => {
  const res = run([]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/usage: power\.mjs <name\|ID> \[snapshot\.json\.gz\]/);
  expect(res.stderr).not.toMatch(/power\.mjs fit/);
});

// A half-typed name costs one rerun rather than a scroll through a 500-champion roster. Same shape
// as speed.mjs.
test("solve names the near misses when the selector matches nothing", () => {
  const res = run(["Elhian", snapshotFile({ artifacts: GEAR })]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/no champion matches "Elhian"/);
  expect(res.stderr).toMatch(/did you mean: Elhain\?/);
});

test("solve heads the report with the snapshot it read", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^# Power — snapshot 2026-10-03-Gestal\.json\.gz$/m);
});
