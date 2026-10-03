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

// --- itemEntries ------------------------------------------------------------------------

const sub = (statId, value, glyph = 0, isFlat = false) => ({ statId, isFlat, rolls: 0, value, glyph });
const item = (o = {}) => ({
  id: 1, slot: 4, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 4, isFlat: true, value: 30 }, substats: [], ascStat: null,
  ascLevel: -1, equippedChampId: 0, ...o,
});

test("the main stat is the first entry", () => {
  expect(itemEntries(item())).toEqual([["SPD", 30]]);
});

// The ITEM stat ids are STAT_NAMES order, NOT the statKindId enum bonusesV2 uses: here 5 is
// C.RATE and 7 is RES, where a statKindId 5 is RES and 7 is C.RATE.
test("item stat ids 4-8 map onto SPD, C.RATE, C.DMG, RES and ACC", () => {
  const main = (statId) => itemEntries(item({ mainStat: { statId, isFlat: true, value: 11 } }))[0][0];
  expect([4, 5, 6, 7, 8].map(main)).toEqual(["SPD", "C.RATE", "C.DMG", "RES", "ACC"]);
});

test("HP, ATK and DEF take a flat or a percent key from the isFlat flag", () => {
  const main = (statId, isFlat) => itemEntries(item({ mainStat: { statId, isFlat, value: 7 } }))[0][0];
  expect([1, 2, 3].map((id) => main(id, true))).toEqual(["HP", "ATK", "DEF"]);
  expect([1, 2, 3].map((id) => main(id, false))).toEqual(["HP%", "ATK%", "DEF%"]);
});

// The glyph is ADDITIVE: substat.value does not already include it, as itemSpeed established.
test("a substat contributes its value plus its glyph", () => {
  const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 }, substats: [sub(4, 10, 5, true)] });
  expect(itemEntries(it)).toEqual([["HP", 500], ["SPD", 15]]);
});

test("the ascension stat contributes like any other", () => {
  const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 },
    ascStat: { statId: 6, isFlat: false, value: 12 } });
  expect(itemEntries(it)).toEqual([["HP", 500], ["C.DMG", 12]]);
});

test("an item with no substats and no ascension stat yields its main stat alone", () => {
  expect(itemEntries(item({ substats: [], ascStat: null }))).toHaveLength(1);
});

// The damage-type substats (PvE/PvP/Boss/Dungeon DMG +/-) reflect on no Total Stats column, so
// they are skipped rather than refused — unlike a genuinely unknown id.
test("a damage-type substat is skipped, and does not stop the rest of the item", () => {
  const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 },
    substats: [sub(11, 5), sub(18, 5), sub(4, 10, 0, true)] });
  expect(itemEntries(it)).toEqual([["HP", 500], ["SPD", 10]]);
});

test("an unknown item stat id is refused rather than silently dropped", () => {
  expect(() => itemEntries(item({ substats: [sub(99, 5)] }))).toThrow(/unknown item stat id 99/);
  expect(() => itemEntries(item({ substats: [sub(10, 5)] }))).toThrow(/unknown item stat id 10/);
});
