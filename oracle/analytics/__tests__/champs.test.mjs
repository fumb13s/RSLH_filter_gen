// oracle/analytics/__tests__/champs.test.mjs
import { test, expect } from "vitest";
import { isRealChamp, parseArgs, selectChamps, suggestNames } from "../champs.mjs";
import * as gear from "../champion-gear.mjs";

const champ = (o = {}) => ({ ID: 110, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60,
  Fraction: 2, SPD: 242, EmpLvl: 0, ...o });

test("isRealChamp rejects placeholder rows with an empty or missing Name", () => {
  expect(isRealChamp(champ())).toBe(true);
  expect(isRealChamp(champ({ Name: "" }))).toBe(false);
  expect(isRealChamp(champ({ Name: "   " }))).toBe(false);
  expect(isRealChamp(champ({ Name: null }))).toBe(false);
});

test("parseArgs separates a snapshot path from a champion selector", () => {
  expect(parseArgs(["Elhain"])).toEqual({ selector: "Elhain", dbArg: undefined });
  expect(parseArgs(["a.db"])).toEqual({ selector: null, dbArg: "a.db" });
  expect(parseArgs(["Elhain", "x/y.db"])).toEqual({ selector: "Elhain", dbArg: "x/y.db" });
});

// An empty arg is no arg: an empty selector matches every champion by substring, which would turn a
// single-champion run into a run over the whole roster.
test("parseArgs drops empty arguments", () => {
  expect(parseArgs([""])).toEqual({ selector: null, dbArg: undefined });
});

test("selectChamps matches an all-digit selector as an exact ID", () => {
  const rows = [champ({ ID: 110 }), champ({ ID: 1101, Name: "Other" })];
  expect(selectChamps(rows, "110").map((r) => r.ID)).toEqual([110]);
});

test("selectChamps matches any other selector as a case-insensitive name substring", () => {
  const rows = [champ({ Name: "Elhain" }), champ({ Name: "Kael" })];
  expect(selectChamps(rows, "ELHA").map((r) => r.Name)).toEqual(["Elhain"]);
  expect(selectChamps(rows, null)).toHaveLength(2);
});

// --- suggestNames -----------------------------------------------------------

// A prefix, not an edit distance: the realistic miss is a half-remembered or half-typed name, and
// the opening characters are what the user is most likely to have right.
// Skaeva contains "kae" but does not start with it. selectChamps already tried a substring match and
// came back empty, so repeating it here would suggest names it has just ruled out.
test("suggestNames offers names sharing the selector's first three characters", () => {
  const rows = [champ({ Name: "Kael" }), champ({ Name: "Kaelan" }), champ({ Name: "Skaeva" }),
    champ({ Name: "Elhain" })];
  expect(suggestNames(rows, "kaelyn")).toEqual(["Kael", "Kaelan"]);
  expect(suggestNames(rows, "KAE")).toEqual(["Kael", "Kaelan"]);
  expect(suggestNames(rows, "elhian")).toEqual(["Elhain"]);
});

// Exactly three characters. Two would drag in every name sharing an opening syllable; four would
// miss a typo IN the fourth character, which is at least as likely as one further along.
test("suggestNames matches on a three-character prefix, not two or four", () => {
  const rows = [champ({ Name: "Kaen" }), champ({ Name: "Kacper" }), champ({ Name: "Kaelan" })];
  expect(suggestNames(rows, "kaelyn")).toEqual(["Kaen", "Kaelan"]);
});

// The roster holds one row per COPY, so a name with four copies would otherwise be suggested four
// times and crowd the other candidates out of the list.
test("suggestNames lists each name once however many copies exist", () => {
  const rows = [champ({ ID: 1, Name: "Kael" }), champ({ ID: 2, Name: "Kael" }),
    champ({ ID: 3, Name: "Kaelan" })];
  expect(suggestNames(rows, "kae")).toEqual(["Kael", "Kaelan"]);
});

test("suggestNames caps the list at eight", () => {
  const rows = Array.from({ length: 12 }, (_, i) => champ({ ID: i, Name: `Elhain ${i}` }));
  expect(suggestNames(rows, "elhain")).toHaveLength(8);
});

test("suggestNames returns nothing when no name is close", () => {
  expect(suggestNames([champ({ Name: "Kael" })], "zzz")).toEqual([]);
  expect(suggestNames([], "kael")).toEqual([]);
});

// Both callers reach here with whatever the command line gave them, and an all-digit selector that
// matched no ID arrives as a string of digits rather than a name.
test("suggestNames tolerates a selector that is not a string", () => {
  const rows = [champ({ Name: "Kael" })];
  expect(suggestNames(rows, 110)).toEqual([]);
  expect(suggestNames(rows, null)).toEqual([]);
});

// champion-gear.mjs is the historical home of these; keeping the re-export means its own tests and
// any other caller keep working after the move.
test("champion-gear.mjs still re-exports the extracted helpers", () => {
  expect(gear.isRealChamp).toBe(isRealChamp);
  expect(gear.parseArgs).toBe(parseArgs);
  expect(gear.selectChamps).toBe(selectChamps);
});
