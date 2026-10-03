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

// --- fixtures -------------------------------------------------------------------------

const BASE = { HP: 15000, ATK: 1000, DEF: 1000, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 };

// --- contribution ---------------------------------------------------------------------

test("a percent key is that percentage of the champion's BASE stat", () => {
  expect(contribution("HP%", 20, BASE)).toEqual(["HP", 3000]);
  expect(contribution("ATK%", 22, BASE)).toEqual(["ATK", 220]);
  expect(contribution("DEF%", 20, BASE)).toEqual(["DEF", 200]);
  expect(contribution("SPD%", 12, BASE)).toEqual(["SPD", 12]);
});

test("a flat key contributes its value as-is", () => {
  expect(contribution("HP", 1000, BASE)).toEqual(["HP", 1000]);
  expect(contribution("RES", 80, BASE)).toEqual(["RES", 80]);
  expect(contribution("ACC", 80, BASE)).toEqual(["ACC", 80]);
  expect(contribution("SPD", 8, BASE)).toEqual(["SPD", 8]);
});

// The trap this pins: C.RATE and C.DMG are percentage POINTS and carry no "%" suffix, so the
// Great Hall's C.DMG +25 adds 25 points. Reading it as a percent key would give 25% of base
// C.DMG — 12.5 here — which is wrong and plausible-looking.
test("a crit key is additive points, not a percentage of the base crit stat", () => {
  expect(contribution("C.DMG", 25, BASE)).toEqual(["C.DMG", 25]);
  expect(contribution("C.RATE", 12, BASE)).toEqual(["C.RATE", 12]);
});

// Unrounded and unfloored: the Total Stats screen rounds each COLUMN once, after summing, which
// is what statBreakdown does. Rounding here would lose that.
test("a contribution is left unrounded", () => {
  expect(contribution("HP%", 1.2, BASE)).toEqual(["HP", 180]);
  expect(contribution("ATK%", 2.25, BASE)).toEqual(["ATK", 22.5]);
  expect(contribution("DEF%", 0.05, BASE)).toEqual(["DEF", 0.5]);
});
