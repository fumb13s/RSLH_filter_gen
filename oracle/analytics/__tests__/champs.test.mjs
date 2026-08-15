// oracle/analytics/__tests__/champs.test.mjs
import { test, expect } from "vitest";
import { isRealChamp, parseArgs, selectChamps } from "../champs.mjs";
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

// champion-gear.mjs is the historical home of these; keeping the re-export means its own tests and
// any other caller keep working after the move.
test("champion-gear.mjs still re-exports the extracted helpers", () => {
  expect(gear.isRealChamp).toBe(isRealChamp);
  expect(gear.parseArgs).toBe(parseArgs);
  expect(gear.selectChamps).toBe(selectChamps);
});
