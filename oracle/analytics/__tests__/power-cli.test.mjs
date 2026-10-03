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
import { formatBreakdown, formatCertificate, formatGain, formatOffBest, formatProven, formatSets,
  formatTotals, latestReading, mainCopies, parsePowerArgs, powerDir, readingsFor, readingsPath,
  weightsPath } from "../power.mjs";
import { STATS } from "../champion-stats.mjs";
import { FORMAT, FORMAT_VERSION } from "../gestal.mjs";
import { power as powerOf } from "../power-model.mjs";
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
//
// `topGiven` is carried SEPARATELY from `top` because --exact refuses any --top, even `--top 1`,
// which is indistinguishable from the default by value alone. toEqual rather than toMatchObject,
// so a field silently dropped from the record names itself here.
test("parsePowerArgs defaults top to 1 and leaves the rest null", () => {
  expect(parsePowerArgs(["Elhain"])).toEqual({
    mode: "solve", selector: "Elhain", dbArg: undefined, power: null, top: 1, topGiven: false,
    exact: false, glyph: null, logPower: null,
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

// --- parsePowerArgs: --exact ----------------------------------------------------

// A bare flag, so it is read wherever it appears and never consumes the next argument — `--exact
// Elhain` must still find Elhain.
test("parsePowerArgs reads --exact in solve mode", () => {
  expect(parsePowerArgs(["Elhain", "--exact"])).toMatchObject({ mode: "solve", exact: true });
  expect(parsePowerArgs(["--exact", "Elhain"])).toMatchObject({ selector: "Elhain", exact: true });
  expect(parsePowerArgs(["Elhain"]).exact).toBe(false);
});

// The other three modes run no solver at all, so --exact there is a reader expecting a different
// command to do something it cannot. Answering anyway — running `fit` and ignoring the flag —
// would look like the exact mode had been used.
test("parsePowerArgs rejects --exact outside solve mode", () => {
  for (const mode of ["log", "fit", "verify"]) {
    expect(() => parsePowerArgs([mode, "Elhain", "100", "--exact"]), mode)
      .toThrow(/--exact is only supported in solve mode/);
  }
});

// ANY --top, `--top 1` included. The exact mode proves ONE maximum and has no second-best to
// report — build-solve's `top` lists the best each other PLAN could reach, which this search does
// not keep. `--top 1` asks for exactly what --exact gives, but accepting it would mean accepting a
// flag whose every other value is a silent lie, so the parser refuses the option rather than the
// value. That is why `topGiven` is recorded separately: `top` is 1 by default.
test("parsePowerArgs rejects --exact combined with any --top", () => {
  expect(() => parsePowerArgs(["Elhain", "--exact", "--top", "1"]))
    .toThrow(/--top is not supported with --exact/);
  expect(() => parsePowerArgs(["Elhain", "--top", "3", "--exact"]))
    .toThrow(/--top is not supported with --exact/);
  // Without --exact the same --top is ordinary.
  expect(parsePowerArgs(["Elhain", "--top", "1"])).toMatchObject({ top: 1, topGiven: true });
});

// --- parsePowerArgs: --glyph ----------------------------------------------------

// A GRADE, not a number: glyph values differ per stat, so one number could not cover both a SPD
// glyph that tops out at 12 and a flat HP one at 1,150.
//
// The second case is the one that matters most. `--glyph 5` carries an ALL-DIGIT value, and an
// all-digit selector is an exact copy id to mainCopies — so a value that leaked into the
// positionals would not merely be ignored, it would silently report a different champion.
test("parsePowerArgs reads --glyph in solve mode and consumes its value", () => {
  expect(parsePowerArgs(["Elhain", "--glyph", "epic"]))
    .toMatchObject({ mode: "solve", glyph: "epic" });
  expect(parsePowerArgs(["--glyph", "5", "Elhain"]))
    .toMatchObject({ selector: "Elhain", glyph: "5" });
  expect(parsePowerArgs(["Elhain"]).glyph).toBe(null);
});

// The five grades are the whole vocabulary, and a near miss has to name them rather than being
// guessed at: `--glyph 6` is someone reading the labels and typing the star level, and lifting a
// vault by a table nobody chose is a plausible wrong answer rather than a crash.
test("parsePowerArgs rejects an unknown glyph grade, naming the five", () => {
  expect(() => parsePowerArgs(["Elhain", "--glyph", "mythical"]))
    .toThrow(/unknown glyph grade "mythical" — use one of 5, normal, rare, epic, legendary/);
  expect(() => parsePowerArgs(["Elhain", "--glyph", "6"])).toThrow(/unknown glyph grade "6"/);
  expect(() => parsePowerArgs(["Elhain", "--glyph", "EPIC"]))
    .toThrow(/unknown glyph grade "EPIC"/);
});

// Same reason positiveInt checks blank before Number(): an option whose value went missing must
// not read as something legal. Here a blank would fall through to the grade lookup and report
// `unknown glyph grade ""`, which describes the symptom rather than the mistake.
test("parsePowerArgs rejects a missing or blank glyph grade", () => {
  const wanted = /--glyph needs a grade — use one of 5, normal, rare, epic, legendary/;
  expect(() => parsePowerArgs(["Elhain", "--glyph"]), "missing").toThrow(wanted);
  expect(() => parsePowerArgs(["Elhain", "--glyph", ""]), "empty").toThrow(wanted);
  expect(() => parsePowerArgs(["Elhain", "--glyph", "  "]), "blank").toThrow(wanted);
});

// The other three modes run no solver at all, so --glyph there is a reader expecting a different
// command to do something it cannot. Answering anyway — running `fit` and ignoring the flag —
// would look like the lifted solve had been run.
test("parsePowerArgs rejects --glyph outside solve mode", () => {
  for (const mode of ["log", "fit", "verify"]) {
    expect(() => parsePowerArgs([mode, "Elhain", "100", "--glyph", "epic"]), mode)
      .toThrow(/--glyph is only supported in solve mode/);
  }
});

// The grade is validated where it is READ, as --power and --top are, so a bad grade in the wrong
// mode reports the grade. Pinned because the opposite order is just as defensible and a reader of
// either message should not have to guess which one a run will give.
test("parsePowerArgs reports a bad grade before it reports the wrong mode", () => {
  expect(() => parsePowerArgs(["fit", "Elhain", "--glyph", "bogus"]))
    .toThrow(/unknown glyph grade "bogus"/);
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

// --- formatProven ----------------------------------------------------------------
//
// The line --exact prints INSTEAD of the certificate. There is no gap to state, so no unit and no
// constant enter it — which is why it takes neither `bestLin` nor `c`, unlike every other format
// helper here. The two numbers it does carry are the ones a reader of an opt-in slow mode wants:
// what it cost, and how much of the plan space the bound removed before the search ran.

test("formatProven states the maximum with the runtime and the plan counts", () => {
  expect(formatProven({ runtimeMs: 8934, plansPruned: 13, plansTotal: 988 }))
    .toBe("    proven maximum   [8934 ms, 13/988 plans pruned]");
});

// Pruning nothing is the ordinary case on a small pool, and zero plans is what an unfillable one
// gives. Neither is an error, and both have to read as numbers rather than as a blank.
test("formatProven prints a zero prune count rather than omitting it", () => {
  expect(formatProven({ runtimeMs: 0, plansPruned: 0, plansTotal: 1 }))
    .toBe("    proven maximum   [0 ms, 0/1 plans pruned]");
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

// --- solve: CURRENT, the weights and the constant --------------------------------

// A reading log holding one record for copy #100, written where RSLH_POWER_DIR points. `totals` is
// whatever was measured at the time, so it is deliberately NOT this snapshot's totals — the point of
// a logged reading is that the constant it yields survives the gear change since.
const READING = {
  t: "2026-10-02T09:00:00.000Z", heroId: 100, baseTypeId: 1490, name: "Elhain", roleId: 0,
  totals: { HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50 },
  power: 480000,
};

// A power directory holding whichever of the two files a test needs.
function powerOut({ readings, weights } = {}) {
  const dir = tmp();
  if (readings) {
    writeFileSync(join(dir, "power-readings.jsonl"),
      readings.map((r) => `${JSON.stringify(r)}\n`).join(""));
  }
  if (weights) writeFileSync(join(dir, "power-weights.json"), JSON.stringify(weights, null, 2));
  return dir;
}

test("solve prints the stat breakdown in the game's Total Stats layout", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}CURRENT$/m);
  // `m` is load-bearing: each label starts its own line, and without it `^` anchors to the start of
  // the whole stdout and every label but the first could never match.
  for (const label of ["Basic", "Artifacts", "Affinity", "Classic Arena", "Masteries",
    "Faction Guardians", "Empowerment", "Blessing", "Relic", "Total"]) {
    expect(res.stdout, label).toMatch(new RegExp(`^ {2}${label} `, "m"));
  }
});

// Elhain is in no BUILT_IN row, so every weight falls through to a role default — and the header has
// to say so, because those are the parameters a `fit` would improve.
test("solve names the weight source and the parameters that fell through to a default", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/weights role default/);
  expect(res.stdout).toMatch(/approximate: b, r, a, s, k/);
});

// A fitted row for this champion's baseTypeId outranks the built-in table and the role defaults,
// per parameter, through weightsFor — so a calibrated champion must stop reading "approximate".
test("solve prefers a fitted weights row and drops the approximate note", () => {
  const dir = powerOut({ weights: { 1490: { name: "Elhain", b: 0.0122, r: 0.277, a: 0.0387,
    s: 0.022, k: 0.00154, fittedAt: "2026-10-02T09:00:00.000Z", readings: 8 } } });
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/weights fitted/);
  expect(res.stdout).not.toMatch(/approximate:/);
});

// Without a constant there is no power to print at all: power is (lin + c)^2, so every absolute
// number needs it.
test("solve reports the constant as unknown when nothing supplies one", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/· {2}constant unknown$/m);
});

test("solve measures the constant from the copy's latest logged reading", () => {
  const dir = powerOut({ readings: [READING] });
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/constant -?[\d.]+ \(logged reading of 2026-10-02T09:00:00\.000Z\)/);
  expect(res.stdout).toMatch(/^ {4}\d+ power$/m);
});

// --power is this copy's power RIGHT NOW, read off the screen, so it beats a reading logged against
// whatever gear the copy had on at the time.
test("solve lets --power override a logged reading", () => {
  const dir = powerOut({ readings: [READING] });
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--power", "412000"],
    { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/constant -?[\d.]+ \(--power\)/);
  expect(res.stdout).not.toMatch(/logged reading/);
});

// One in-game power value belongs to ONE copy. Measuring a constant for several from it would make
// every power printed afterwards wrong by that amount, with nothing saying so.
test("solve refuses --power when the selector matches more than one champion", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR, champions: TWO_CHAMPS }),
    "--power", "412000"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/--power is one champion's in-game reading/);
  expect(res.stderr).toMatch(/Elhain #100/);
  expect(res.stderr).toMatch(/Dark Elhain #200/);
});

// Without --power the same selector is fine: two champions means two reports.
test("solve reports every main copy a selector matches", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR, champions: TWO_CHAMPS })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^Elhain #100 /m);
  expect(res.stdout).toMatch(/^Dark Elhain #200 /m);
});

// --- solve: BEST -----------------------------------------------------------------

// One line per slot, named the way the game names them — the slot, the set, the level and the id —
// plus `on <champion>` for a piece that would have to come off someone. The solver's pool is the
// whole vault, worn gear included, so that last part is what decides whether the build is
// actionable.
test("solve prints BEST slot by slot, with its sets and totals", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}BEST /m);
  // Three slots, which are our 1 Helmet, 5 Weapon and 6 Shield — Gestal's 1, 0 and 2.
  expect(res.stdout).toMatch(/^ {4}Helmet {2}/m);
  expect(res.stdout).toMatch(/^ {4}Weapon {2}/m);
  expect(res.stdout).toMatch(/^ {4}Shield {2}/m);
  // The optimum is MIXED, not three of either set, and the crit product is why. At the role-default
  // k of 0.00154, with non-gear C.RATE 15 and C.DMG 75 (base 50 + the Great Hall's 25):
  //   2 CR + 1 CD  C.RATE 15+32+12 = 59, C.DMG 75+120     = 195 -> 59 * 295 = 17,405
  //   3 CR         C.RATE 15+36+12 = 63, C.DMG 75+90      = 165 -> 63 * 265 = 16,695
  //   3 CD         C.RATE 15+24    = 39, C.DMG 75+180+20  = 275 -> 39 * 375 = 14,625
  // So the mixed build wins outright, and pinning an `x3` line here would pin a worse build.
  expect(res.stdout).toMatch(/^ {4}sets: Critical Rate x2 · Crit Damage x1$/m);
  expect(res.stdout).toMatch(/^ {4}totals: HP \d+ {2}ATK \d+ {2}DEF \d+ {2}SPD \d+ {2}C\.RATE /m);
});

// Nothing in this fixture is on another champion except the three pieces already on Elhain, and a
// piece already on the copy being solved for costs nothing to fit. The line is printed anyway,
// `none` included: silence would be indistinguishable from a report that does not check.
test("solve prints the borrowed-pieces line even when nothing is borrowed", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {4}on other champions: none$/m);
});

// A piece on someone else has to be named twice over: beside its own line, and once for the build.
test("solve names the champion a borrowed piece would come off", () => {
  const champions = [champion(), champion({ heroId: 200, baseTypeId: 1491, name: "Kael" })];
  // Give Kael the three Crit Damage pieces, so whichever build BEST picks borrows from someone.
  const artifacts = GEAR.map((p) => (p.gearSetId === CD_SET ? { ...p, equippedOnHeroId: 200 } : p));
  const res = run(["Elhain", snapshotFile({ artifacts, champions })]);
  expect(res.status, res.stderr).toBe(0);
  // BEST is the mixed build (see the arithmetic above), so it borrows exactly ONE of Kael's Crit
  // Damage pieces — the helmet. Named in both places a reader looks: beside the piece, and once for
  // the build.
  expect(res.stdout).toMatch(/^ {4}Helmet {2}Crit Damage {4}\+16 {3}#5 {3}on Kael$/m);
  expect(res.stdout).toMatch(/^ {4}on other champions: 1 of 3 — Kael$/m);
});

// What the solver PROVED, as against what it found. A fixed point of the linearize-and-resolve map
// is not an optimum, so the headline number is the proven CEILING on what is left on the table.
test("solve closes each build with the certificate line", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout)
    .toMatch(/^ {4}at most -?[\d.]+ √power \([\d.]+%\) below the true maximum {3}\[\d+ rounds?, (converged|no fixed point)\]$/m);
});

// With a constant the whole report switches to power, the number the game shows — the certificate
// line included, so it can be compared with the power printed above it.
test("solve states the certificate in power once the constant is known", () => {
  const dir = powerOut({ readings: [READING] });
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {4}at most -?\d+ power \([\d.]+%\) below the true maximum/m);
  expect(res.stdout).toMatch(/^ {2}BEST {2}\d+ power {2}\(\+-?\d+ over current\)$/m);
});

// Without one, the gain is a ratio marked `≈` and said to be missing a constant, rather than a
// power number computed from a constant that is not there.
test("solve reports the gain as a marked percentage when the constant is unknown", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout)
    .toMatch(/^ {2}BEST {2}≈ \+[\d.]+% \(per-copy constant unknown: log a reading or pass --power\)$/m);
});

// A champion wearing nothing is a real state, and solvePower seeds the worn gear as round 0, so an
// empty vault still produces one build rather than no report at all.
test("solve still reports a champion with no gear and an empty vault", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: [] })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}CURRENT$/m);
  expect(res.stdout).toMatch(/^ {2}BEST /m);
  expect(res.stdout).toMatch(/below the true maximum/);
});

// --- solve: --top ----------------------------------------------------------------

// Two sets over three slots gives the solver more than one plan to rank: {}, {Critical Rate: 2} and
// {Crit Damage: 2} all reach a different set of items. A runner-up that costs little power but
// frees three pieces of a set is visible rather than discarded.
//
// These are the best DISTINCT SETS OF ITEMS the iteration saw, not a proved top-N — power-solve is
// explicit about that and neither is this report.
test("--top 2 adds a numbered runner-up block measured against BEST", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--top", "2"]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}#2 {2}\(-?[\d.]+ √power off BEST\)$/m);
  // The runner-up gets the same per-build detail as BEST, so it can be acted on directly.
  expect(res.stdout.match(/^ {4}sets: /gm)).toHaveLength(2);
});

// The runner-up's distance has to be in the SAME unit as the certificate line, or the two numbers
// on one report cannot be compared.
test("--top states the runner-up's distance in power once the constant is known", () => {
  const dir = powerOut({ readings: [READING] });
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--top", "2"], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}#2 {2}\(-?\d+ power off BEST\)$/m);
});

// The default is one build, so an ordinary run is not made longer by a feature it did not ask for.
test("solve prints only BEST without --top", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).not.toMatch(/off BEST/);
  expect(res.stdout.match(/^ {4}sets: /gm)).toHaveLength(1);
});

// --- solve: --exact --------------------------------------------------------------

// The whole point of the flag, end to end: the certificate line is GONE and `proven maximum` is
// in its place. Asserting the absence matters as much as the presence — a run that printed both
// would be claiming a ceiling on a number that has no ceiling left.
//
// The counts are matched as digits rather than pinned: `plansTotal` is a property of the set table
// and this fixture's three slots, and `runtimeMs` is a wall clock. Pinning either would make the
// test fail on a table patch or a slow runner without anything being wrong.
test("--exact replaces the certificate with the proven maximum, its runtime and plan counts", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--exact"]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {4}proven maximum {3}\[\d+ ms, \d+\/\d+ plans pruned\]$/m);
  expect(res.stdout).not.toMatch(/below the true maximum/);
  // Everything else about the report is unchanged: BEST, the gear slot by slot, and the sets.
  expect(res.stdout).toMatch(/^ {2}BEST /m);
  expect(res.stdout).toMatch(/^ {4}sets: /m);
});

// The exact mode is never worse than the default one — it searches the same pool and starts from
// the default's answer as its incumbent — so the build it reports has to be at least as good. On
// this fixture the default mode already finds the optimum, so the two agree outright, and that is
// the assertion: --exact must not come back with something different.
test("--exact reports a build at least as good as the default mode's", () => {
  const snapshot = snapshotFile({ artifacts: GEAR });
  const sets = (out) => out.match(/^ {4}sets: .*$/m)[0];
  expect(sets(run(["Elhain", snapshot, "--exact"]).stdout))
    .toBe(sets(run(["Elhain", snapshot]).stdout));
});

// A champion with nothing wearable is a real state, and solvePowerExact returns `build: null` for
// it rather than an empty build. speed.mjs prints this same line for an empty index: there is no
// assignment to report, let alone one to prove anything about.
test("--exact says plainly when no slot can be filled", () => {
  const res = run(["Elhain", snapshotFile({ artifacts: [] }), "--exact"]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}no eligible items for any slot\.$/m);
  expect(res.stdout).not.toMatch(/proven maximum/);
  // CURRENT still prints: the copy's own stats do not depend on there being gear to move.
  expect(res.stdout).toMatch(/^ {2}CURRENT$/m);
});

// The parser's two refusals, through the CLI rather than through parsePowerArgs, so the exit code
// and the usage line a reader actually sees are checked too.
test("--exact exits 1 outside solve mode and with --top", () => {
  const wrongMode = run(["verify", "--exact"]);
  expect(wrongMode.status).toBe(1);
  expect(wrongMode.stderr).toMatch(/--exact is only supported in solve mode/);
  const withTop = run(["Elhain", "--exact", "--top", "1"]);
  expect(withTop.status).toBe(1);
  expect(withTop.stderr).toMatch(/--top is not supported with --exact/);
});

// --- verify ----------------------------------------------------------------------
//
// The set table is GAME DATA and will drift on a patch. verify is the guard: it diffs the table
// against the game's OWN per-champion set bonus, which Gestal captures as bonusesV2.sets.
//
// Two worn Critical Rate pieces are one 2-piece completion, +12 C.RATE. Gestal reports a relative
// C.RATE under statKindId 7 as the FRACTION 0.12, which the adapter scales to the 12 points the
// screen shows. Lore of Steel is off in the fixture, and the table is multiplier-free, so the two
// numbers have to agree exactly.
const WORN_PAIR = [
  piece({ id: 1, slot: G_WEAPON, gearSetId: CR_SET, equippedOnHeroId: 100 }),
  piece({ id: 2, slot: G_HELMET, gearSetId: CR_SET, equippedOnHeroId: 100 }),
];
const critRateSets = (value) => ({
  bonusesV2: { sets: [{ statKindId: 7, isAbsolute: false, value }],
    mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
});

test("verify reports every geared champion matching and exits 0", () => {
  const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.12))] });
  const res = run(["verify", snap]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout)
    .toMatch(/^set table matches the game's set bonuses for 1 of 1 geared champions$/m);
});

// The whole point of the check: a disagreement is named, with the champion, the sets it is wearing
// and both numbers, and the exit code makes it a failure rather than a note.
test("verify names a mismatching champion and exits 1", () => {
  const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.2))] });
  const res = run(["verify", snap]);
  expect(res.status).toBe(1);
  expect(res.stdout)
    .toMatch(/^set table matches the game's set bonuses for 0 of 1 geared champions$/m);
  expect(res.stdout).toMatch(/Elhain #100 {2}Critical Rate x2/);
  expect(res.stdout).toMatch(/^ {4}C\.RATE: table 12 vs game 20$/m);
});

// A champion wearing nothing has no set bonus to check, and counting it as a match would inflate
// the denominator with champions the check never looked at.
test("verify counts only the champions wearing something", () => {
  const champions = [champion(critRateSets(0.12)),
    champion({ heroId: 200, baseTypeId: 1491, name: "Kael" })];
  const res = run(["verify", snapshotFile({ artifacts: WORN_PAIR, champions })]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/for 1 of 1 geared champions/);
});

test("verify refuses a non-Gestal snapshot, as solve does", () => {
  const res = run(["verify", "x/y.db"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/power\.mjs needs a Gestal snapshot/);
});

// verify takes no selector, so it must not be caught by the missing-selector check that solve, log
// and fit share.
test("verify runs without a selector", () => {
  const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.12))] });
  const res = run(["verify", snap]);
  expect(res.status, res.stderr).toBe(0);
  expect(res.stderr).not.toMatch(/usage:/);
});

// --- log -------------------------------------------------------------------------
//
// log reads Gestal's LIVE documents rather than a snapshot, deliberately: the log line it writes is
// itself the frozen record, so freezing a snapshot first would only add a file nobody reads. The
// fixture is a Gestal data folder laid out as the app writes one.

function gestalRoot({ artifacts = [], champions = [champion()] } = {}) {
  const root = tmp();
  const acct = join(root, "accounts", "abc123");
  mkdirSync(join(acct, "diagnostics"), { recursive: true });
  const put = (rel, body) => writeFileSync(join(acct, rel), JSON.stringify(body));
  writeFileSync(join(root, "active.json"),
    JSON.stringify(doc(1, { activeAccountKey: "abc123" })));
  put("artifacts.json",
    doc(2, { extractedAt: "2026-10-03T12:00:00Z", gameVersion: "11.75.0", artifacts }));
  put("champions.json",
    doc(2, { extractedAt: "2026-10-03T12:00:30Z", gameVersion: "11.75.0", champions }));
  put("metadata.json", doc(2, { displayName: "Player One", raidPlayerId: "123456789" }));
  put("diagnostics/last-extraction.json", doc(1, { attemptedAt: "2026-10-03T12:04:00Z",
    succeeded: true, errorMessage: null, elapsedMilliseconds: 1000, gameVersion: "11.75.0" }));
  return root;
}

const readLog = (dir) => readFileSync(join(dir, "power-readings.jsonl"), "utf8")
  .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

test("log appends one reading with the copy's totals and the power given", () => {
  const dir = tmp();
  const res = run(["log", "Elhain", "12345"],
    { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR }) });
  expect(res.status, res.stderr).toBe(0);
  const log = readLog(dir);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ heroId: 100, baseTypeId: 1490, name: "Elhain", roleId: 0,
    power: 12345 });
  expect(Object.keys(log[0].totals).sort())
    .toEqual(["ACC", "ATK", "C.DMG", "C.RATE", "DEF", "HP", "RES", "SPD"]);
  expect(log[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

// The log is append-only: a second reading of the same copy is another equation for the fit, not a
// replacement for the first.
test("log appends rather than replacing", () => {
  const dir = tmp();
  const root = gestalRoot({ artifacts: GEAR });
  expect(run(["log", "Elhain", "12345"], { powerDir: dir, dataRoot: root }).status).toBe(0);
  expect(run(["log", "Elhain", "12999"], { powerDir: dir, dataRoot: root }).status).toBe(0);
  expect(readLog(dir).map((r) => r.power)).toEqual([12345, 12999]);
});

// So the reader can compare it with the screen the power was read off, which is the only check that
// the reading and the stat model are describing the same copy.
test("log prints the copy's stat breakdown in the game layout", () => {
  const res = run(["log", "Elhain", "12345"], { dataRoot: gestalRoot({ artifacts: GEAR }) });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/^ {2}Basic /m);
  expect(res.stdout).toMatch(/^ {2}Total /m);
});

// A reading landing on the wrong champion is the one failure that cannot be undone by rerunning:
// it silently poisons that champion's fit. So an ambiguous selector writes NOTHING.
test("log refuses an ambiguous selector and writes nothing", () => {
  const dir = tmp();
  const res = run(["log", "Elhain", "12345"],
    { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR, champions: TWO_CHAMPS }) });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/a logged reading belongs to one copy/);
  expect(res.stderr).toMatch(/Elhain #100/);
  expect(res.stderr).toMatch(/Dark Elhain #200/);
  expect(existsSync(join(dir, "power-readings.jsonl"))).toBe(false);
});

test("log without its power exits 1 with log's usage line and writes nothing", () => {
  const dir = tmp();
  const res = run(["log", "Elhain"],
    { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR }) });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/usage: power\.mjs log <name\|ID> <in-game power>/);
  expect(existsSync(join(dir, "power-readings.jsonl"))).toBe(false);
});

test("log without a selector exits 1 with log's usage line", () => {
  const res = run(["log"], { dataRoot: gestalRoot() });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/usage: power\.mjs log <name\|ID> <in-game power>/);
});

// Gestal refreshes its documents only while attached to a running Raid, so data this old means the
// stats may not be the ones on the screen. A WARNING, not a refusal: the reader is looking at the
// screen and can tell.
test("log warns that the live data is stale rather than refusing it", () => {
  const res = run(["log", "Elhain", "12345"], { dataRoot: gestalRoot({ artifacts: GEAR }) });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stderr).toMatch(/warning: the data is .* old/);
});

// resolveAccount's own message, which names what to do about it.
test("log exits 1 with Gestal's own message when there is no data folder", () => {
  const res = run(["log", "Elhain", "12345"], { dataRoot: join(tmp(), "nothing-here") });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/Gestal data folder not found/);
});

// --- fit -------------------------------------------------------------------------
//
// The readings are generated FROM the formula, so a fit that recovers W is recovering what produced
// the numbers rather than agreeing with itself. baseTypeId 999001 is in no BUILT_IN row, so every
// prior is a role default. Same construction as power-fit.test.mjs.
const FIT_BASE = 999001;
const W = { b: 0.0131, r: 0.2641, a: 0.0412, s: 0.0193, k: 0.00168 };
const C11 = 37.5;

const fitTotals = (o = {}) => ({
  HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o });

// A baseline plus one single-stat step per design column, which is what leaves all five centered
// columns independent. X_B and X_K each get two steps, one from each stat that feeds them.
const FIT_STEPS = [{}, { HP: 36000 }, { ATK: 2600 }, { RES: 160 }, { ACC: 90 }, { SPD: 240 },
  { "C.RATE": 85 }, { "C.DMG": 220 }];

const fitReadings = ({ name = "Synthetic", baseTypeId = FIT_BASE, heroId = 11 } = {}) =>
  FIT_STEPS.map((step, i) => {
    const totals = fitTotals(step);
    return { t: new Date(Date.UTC(2026, 9, 3, 0, 0, i)).toISOString(),
      heroId, baseTypeId, name, roleId: 0, totals, power: powerOf(totals, W, C11) };
  });

// Relative, not absolute: these weights span 0.0017 to 0.26, so one absolute tolerance cannot mean
// the same thing for all five.
const close = (got, want) => Math.abs(got / want - 1);
const readFitted = (dir) => JSON.parse(readFileSync(join(dir, "power-weights.json"), "utf8"));

test("fit recovers the weights that generated the readings and writes them", () => {
  const dir = powerOut({ readings: fitReadings() });
  const res = run(["fit", "Synthetic"], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  const row = readFitted(dir)[FIT_BASE];
  for (const name of ["b", "r", "a", "s", "k"]) {
    expect(close(row[name], W[name]), `${name} = ${row[name]}`).toBeLessThan(0.01);
  }
  expect(row).toMatchObject({ name: "Synthetic", readings: 8 });
  expect(row.fittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

// The file holds one row per champion. A fit of one champion must not drop the others, or
// calibrating a second champion would quietly un-calibrate the first.
test("fit keeps an existing entry for another champion", () => {
  const dir = powerOut({ readings: fitReadings(),
    weights: { 7090: { name: "Ultimate Deathknight", b: 0.01936, r: 0.187, a: 0.03483,
      s: 0.0038, k: 0.001245, fittedAt: "2026-10-01T09:00:00.000Z", readings: 12 } } });
  const res = run(["fit", "Synthetic"], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  const fitted = readFitted(dir);
  expect(Object.keys(fitted).sort()).toEqual(["7090", String(FIT_BASE)]);
  expect(fitted[7090].name).toBe("Ultimate Deathknight");
});

test("fit prints the per-copy constants and a residual table", () => {
  const dir = powerOut({ readings: fitReadings() });
  const res = run(["fit", "Synthetic"], { powerDir: dir });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toMatch(/per-copy constants:/);
  expect(res.stdout).toMatch(/#11 {2}37\.5/);
  expect(res.stdout).toMatch(/residuals:/);
  // Eight readings, generated from the formula, so every residual is ~0%.
  expect(res.stdout.match(/^ {4}#11 /gm)).toHaveLength(9);   // one constant line + eight residuals
});

// The weights are per champion. Fitting two together would average them into something that
// describes neither, and nothing downstream could tell that had happened.
test("fit refuses a selector matching two champions, naming both", () => {
  const dir = powerOut({ readings: [
    ...fitReadings({ name: "Synthetic A", baseTypeId: 999001, heroId: 11 }),
    ...fitReadings({ name: "Synthetic B", baseTypeId: 999002, heroId: 22 }),
  ] });
  const res = run(["fit", "Synthetic"], { powerDir: dir });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/matches 2 champions in the reading log/);
  expect(res.stderr).toMatch(/Synthetic A \(baseTypeId 999001\)/);
  expect(res.stderr).toMatch(/Synthetic B \(baseTypeId 999002\)/);
  expect(existsSync(join(dir, "power-weights.json"))).toBe(false);
});

// An empty log is the state before the first `log`, and the message has to point at the file so the
// reader can tell "nothing logged yet" from "logged under another name".
test("fit exits 1 when no reading matches, naming the log it looked in", () => {
  const dir = powerOut({ readings: fitReadings() });
  const res = run(["fit", "Nobody"], { powerDir: dir });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/no logged readings match "Nobody"/);
  expect(res.stderr).toMatch(/power-readings\.jsonl/);
});

test("fit exits 1 when there is no reading log at all", () => {
  const res = run(["fit", "Elhain"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/no logged readings match "Elhain"/);
});

// fitWeights' own message. Below copies + varying columns the system has fewer equations than
// unknowns, and the answer would be arbitrary rather than wrong by a little.
//
// Under-determining it takes a reading that moves TWO design columns at once, not simply a shorter
// log: the first three of FIT_STEPS move HP and ATK, which BOTH feed X_B, so they leave one varying
// column and 3 >= 1 copy + 1 column solves cleanly. Here the second reading moves HP (X_B) and RES
// (r) together, so it is 2 readings against 2 columns plus 1 copy constant — three unknowns.
test("fit passes fitWeights' refusal through when there are too few readings", () => {
  const [baseline] = fitReadings();
  const bothAtOnce = fitTotals({ HP: 36000, RES: 160 });
  const dir = powerOut({ readings: [baseline, { ...baseline,
    t: "2026-10-03T00:01:00.000Z", totals: bothAtOnce, power: powerOf(bothAtOnce, W, C11) }] });
  const res = run(["fit", "Synthetic"], { powerDir: dir });
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/power-fit: too few readings/);
  expect(res.stderr).toMatch(/readings=2, copies=1, varying stat columns=2/);
  expect(existsSync(join(dir, "power-weights.json"))).toBe(false);
});

test("fit without a selector exits 1 with fit's usage line", () => {
  const res = run(["fit"]);
  expect(res.status).toBe(1);
  expect(res.stderr).toMatch(/usage: power\.mjs fit <name\|ID>/);
});
