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

// --- statBreakdown ---------------------------------------------------------------------

const champStats = ({ base, sources, ...o } = {}) => ({
  base: { ...BASE, ...base },
  sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [], ...sources },
  observedSets: new Map(), loreOfSteel: 0, awaken: 0, ...o,
});

// Two Offense (a 2-piece stacker) and one Stone Skin, whose FIRST tier is a SINGLE piece — the
// shape most easily assumed away, and the reason a one-piece set still feeds the Artifacts column.
const GEAR = [
  item({ id: 1, set: 2, mainStat: { statId: 1, isFlat: true, value: 1000 } }),
  item({ id: 2, set: 2, mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 10, 5, true)] }),
  item({ id: 3, set: 48, mainStat: { statId: 5, isFlat: false, value: 20 },
    ascStat: { statId: 6, isFlat: false, value: 12 } }),
];

const WORN = champStats({
  sources: {
    mastery: [["ATK%", 5], ["C.RATE", 5]],
    blessing: [["SPD", 7]],
    relic: [["ACC", 50]],
    factionGuardian: [["HP", 500]],
  },
  loreOfSteel: 0.15,
});

const columnNamed = (breakdown, name) => breakdown.columns.find(([n]) => n === name)[1];

test("the columns are the game's nine, in its order", () => {
  expect(statBreakdown(WORN, GEAR).columns.map(([name]) => name)).toEqual([
    "Basic", "Artifacts", "Affinity", "Classic Arena", "Masteries",
    "Faction Guardians", "Empowerment", "Blessing", "Relic",
  ]);
});

test("every column vector is keyed by all eight stats, zero where nothing lands", () => {
  for (const [name, vector] of statBreakdown(WORN, GEAR).columns) {
    expect(Object.keys(vector).sort(), name).toEqual([...STATS].sort());
  }
  expect(columnNamed(statBreakdown(WORN, GEAR), "Empowerment"))
    .toEqual({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });
});

test("Basic is the champion's base, and is a copy rather than the same object", () => {
  const breakdown = statBreakdown(WORN, GEAR);
  expect(columnNamed(breakdown, "Basic")).toEqual(BASE);
  expect(columnNamed(breakdown, "Basic")).not.toBe(WORN.base);
});

const zeroVector = () => ({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });

// Column vectors are unrounded, so a percentage term can land on a fraction. Compared with
// toBeCloseTo rather than toBe: the exact binary value of 15000 * (0.15 * 8) / 100 is not
// something a test should depend on, while the totals below are integers and are exact.
test("Artifacts is the items' own stats plus the set bonuses they complete", () => {
  const artifacts = columnNamed(statBreakdown(WORN, GEAR), "Artifacts");
  expect(artifacts.HP).toBeCloseTo(2200, 9);     // 1000 flat + 15000 * 8% from Stone Skin's 1-piece tier
  expect(artifacts.ATK).toBeCloseTo(750, 9);     // 1000 * 60% main + 1000 * 15% from one Offense completion
  expect(artifacts.SPD).toBeCloseTo(15, 9);      // substat 10 + glyph 5
  expect(artifacts["C.RATE"]).toBeCloseTo(20, 9);
  expect(artifacts["C.DMG"]).toBeCloseTo(12, 9); // the ascension stat
  expect(artifacts.DEF).toBe(0);
});

test("Affinity applies the Great Hall, crediting C.DMG its 25 POINTS", () => {
  expect(columnNamed(statBreakdown(WORN, GEAR), "Affinity"))
    .toEqual({ HP: 3000, ATK: 200, DEF: 200, SPD: 0, "C.RATE": 0, "C.DMG": 25, RES: 80, ACC: 80 });
});

test("Classic Arena applies the Gold 5 bonus to HP, ATK and DEF alone", () => {
  expect(columnNamed(statBreakdown(WORN, GEAR), "Classic Arena"))
    .toEqual({ HP: 3300, ATK: 220, DEF: 220, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });
});

// Lore of Steel at 0.15 adds 15% of EVERY set term — Stone Skin's tiered HP% as much as Offense's
// stacking ATK% — and the game shows that extra under Masteries rather than in the set bonus.
test("Masteries carries the mastery bonuses plus Lore of Steel on every set term", () => {
  const masteries = columnNamed(statBreakdown(WORN, GEAR), "Masteries");
  expect(masteries.ATK).toBeCloseTo(72.5, 9);    // 1000 * 5% mastery + 1000 * (15% * 0.15)
  expect(masteries.HP).toBeCloseTo(180, 9);      // 15000 * (8% * 0.15)
  expect(masteries["C.RATE"]).toBe(5);
});

test("Lore of Steel at 0 leaves Masteries with the mastery bonuses alone", () => {
  const none = statBreakdown(champStats({ sources: WORN.sources }), GEAR);
  const masteries = columnNamed(none, "Masteries");
  expect(masteries.ATK).toBeCloseTo(50, 9);
  expect(masteries.HP).toBe(0);
});

test("the four remaining sources each land in their own column", () => {
  const breakdown = statBreakdown(WORN, GEAR);
  expect(columnNamed(breakdown, "Faction Guardians").HP).toBe(500);
  expect(columnNamed(breakdown, "Blessing").SPD).toBe(7);
  expect(columnNamed(breakdown, "Relic").ACC).toBe(50);
  expect(columnNamed(breakdown, "Empowerment").HP).toBe(0);
});

test("the totals reproduce the hand-computed Total Stats screen", () => {
  expect(statBreakdown(WORN, GEAR).totals).toEqual({
    HP: 24180, ATK: 2243, DEF: 1420, SPD: 122, "C.RATE": 40, "C.DMG": 87, RES: 110, ACC: 130,
  });
});

test("an ungeared champion totals its base plus the account-wide bonuses", () => {
  const bare = statBreakdown(champStats(), []);
  expect(columnNamed(bare, "Artifacts")).toEqual(zeroVector());
  expect(bare.totals).toEqual({
    HP: 21300, ATK: 1420, DEF: 1420, SPD: 100, "C.RATE": 15, "C.DMG": 75, RES: 110, ACC: 80,
  });
});

// --- per-column rounding ------------------------------------------------------------------
//
// The whole reason totals are not a plain sum. The halves below are contrived to isolate the rule
// on one stat; in real data it shows up as the ±1 by which a total can differ from the sum of the
// unrounded columns, which is exactly what the game's own screen does.

test("totals round EACH column before summing, which a plain sum does not reproduce", () => {
  const halves = champStats({
    base: { ACC: 0 },
    sources: { blessing: [["ACC", 0.5]], relic: [["ACC", 0.5]] },
  });
  const breakdown = statBreakdown(halves, []);
  expect(columnNamed(breakdown, "Blessing").ACC).toBe(0.5);
  expect(columnNamed(breakdown, "Relic").ACC).toBe(0.5);
  // Per column: round(0.5) + round(0.5) = 2, on top of the Great Hall's 80.
  expect(breakdown.totals.ACC).toBe(82);
  // Rounding the unrounded sum instead would give 81 — the ±1 this rule exists to reproduce.
  const unrounded = breakdown.columns.reduce((sum, [, v]) => sum + v.ACC, 0);
  expect(Math.round(unrounded)).toBe(81);
});

test("a column that sums to a whole number is unaffected by the rule", () => {
  const whole = champStats({ sources: { blessing: [["ACC", 10]], relic: [["ACC", 10]] } });
  expect(statBreakdown(whole, []).totals.ACC).toBe(100);   // 80 Great Hall + 10 + 10
});
