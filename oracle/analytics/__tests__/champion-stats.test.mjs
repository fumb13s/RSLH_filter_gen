// oracle/analytics/__tests__/champion-stats.test.mjs
import { expect, test } from "vitest";
import { ARENA, GREAT_HALL, STATS, contribution, itemEntries, statBreakdown }
  from "../champion-stats.mjs";

// --- the constants ------------------------------------------------------------------
//
// Written out LONGHAND rather than read back off the module under test. Both tables are recorded
// observations that nothing in the repo can re-derive — a maxed Great Hall on a 2026-09-29
// capture, and the Gold 5 arena league — so the redundancy is the point: a second copy that has
// to be edited in agreement, and the only thing that can catch a transcription slip.

test("STATS is the eight columns of the Total Stats screen, in the game's order", () => {
  expect(STATS).toEqual(["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"]);
});

test("GREAT_HALL is the maxed Affinity Bonuses", () => {
  expect(GREAT_HALL).toEqual([
    ["HP%", 20], ["ATK%", 20], ["DEF%", 20], ["RES", 80], ["ACC", 80], ["C.DMG", 25],
  ]);
});

test("ARENA is the Gold 5 Classic Arena bonus", () => {
  expect(ARENA).toEqual([["HP%", 22], ["ATK%", 22], ["DEF%", 22]]);
});
