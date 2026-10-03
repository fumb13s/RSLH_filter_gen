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
import { expect, test } from "vitest";
import { formatBreakdown, formatTotals, mainCopies, parsePowerArgs } from "../power.mjs";
import { STATS } from "../champion-stats.mjs";

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
