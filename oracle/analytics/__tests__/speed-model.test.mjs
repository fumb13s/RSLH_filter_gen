// oracle/analytics/__tests__/speed-model.test.mjs
import { test, expect } from "vitest";
import { SPD, itemSpeed, glyphCeilings, clampFloor, speedOfWith, setCounts, buildSpeed, measureConstant }
  from "../speed-model.mjs";
import { DBSTAT_TO_OURSTAT } from "../../lib/decode.mjs";

const sub = (statId, value, glyph = 0) => ({ statId, isFlat: false, rolls: 0, value, glyph });
const item = (o = {}) => ({
  id: 1, slot: 4, set: 4, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 4, isFlat: false, value: 30 }, substats: [], ascStat: null,
  ascLevel: 0, equippedChampId: 0, ...o,
});
// A main stat that contributes nothing, so a case can isolate the substats.
const OTHER_MAIN = { statId: 2, isFlat: false, value: 60 };

test("itemSpeed reads a SPD main stat", () => {
  expect(itemSpeed(item())).toBe(30);
  expect(itemSpeed(item({ mainStat: { statId: 1, isFlat: false, value: 60 } }))).toBe(0);
});

test("itemSpeed sums SPD substats and ignores the rest", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 12), sub(5, 20), sub(4, 7)] });
  expect(itemSpeed(it)).toBe(19);
});

// The glyph is NOT already folded into substat.value: predicting champion totals with it added is
// exact for 99/243 champions against 41/243 without.
test("itemSpeed adds the substat glyph on top of the substat value", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 5)] });
  expect(itemSpeed(it)).toBe(17);
});

test("itemSpeed adds a SPD ascension stat, and ignores a non-SPD one", () => {
  const base = { mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 10)] };
  expect(itemSpeed(item({ ...base, ascStat: { statId: 4, isFlat: false, value: 12 } }))).toBe(22);
  expect(itemSpeed(item({ ...base, ascStat: { statId: 3, isFlat: false, value: 20 } }))).toBe(10);
  expect(itemSpeed(item({ ...base, ascStat: null }))).toBe(10);
});

// A glyph can only lift a stat the item already carries, so the floor never conjures a SPD substat.
test("glyphFloor lifts existing SPD substat glyphs and nothing else", () => {
  const withSpd = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 3)] });
  expect(itemSpeed(withSpd, 8)).toBe(20);
  const noSpd = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(5, 20, 3)] });
  expect(itemSpeed(noSpd, 8)).toBe(0);
});

test("glyphFloor never lowers a glyph that is already higher", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 11)] });
  expect(itemSpeed(it, 8)).toBe(23);
});

test("glyphFloor does not touch the ascension stat, which carries no glyph", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [],
    ascStat: { statId: 4, isFlat: false, value: 12 } });
  expect(itemSpeed(it, 8)).toBe(12);
});

test("glyphCeilings records the highest SPD glyph seen per rarity and rank", () => {
  const ceil = glyphCeilings([
    item({ rarity: 5, rank: 6, substats: [sub(4, 10, 12)] }),
    item({ rarity: 5, rank: 6, substats: [sub(4, 10, 7)] }),
    item({ rarity: 4, rank: 5, substats: [sub(4, 10, 4)] }),
    item({ rarity: 4, rank: 5, substats: [sub(1, 10, 9)] }),
  ]);
  expect(ceil.get("5|6")).toBe(12);
  expect(ceil.get("4|5")).toBe(4);
});

// Without the clamp, --glyph 20 invents speed no item of that tier can carry.
test("clampFloor caps the requested floor at the item's rarity x rank ceiling", () => {
  const ceil = new Map([["5|6", 12], ["4|5", 4]]);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 20, ceil)).toBe(12);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 8, ceil)).toBe(8);
  expect(clampFloor(item({ rarity: 4, rank: 5 }), 8, ceil)).toBe(4);
});

// An unseen bucket carries no evidence either way, so it is left alone rather than silently zeroed.
test("clampFloor leaves an unseen rarity x rank bucket unclamped, and 0 stays 0", () => {
  expect(clampFloor(item({ rarity: 2, rank: 1 }), 8, new Map())).toBe(8);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 0, new Map([["5|6", 12]]))).toBe(0);
});

test("setCounts tallies sets across a build and ignores setless items", () => {
  const counts = setCounts([item({ set: 4 }), item({ set: 4 }), item({ set: 38 }), item({ set: 0 })]);
  expect(counts.get(4)).toBe(2);
  expect(counts.get(38)).toBe(1);
  expect(counts.has(0)).toBe(false);
});

test("buildSpeed is base + set effect + item speed + constant", () => {
  const items = [
    item({ set: 4, mainStat: { statId: 4, isFlat: false, value: 30 } }),
    item({ set: 4, mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 10)] }),
  ];
  // base 100, Speed x2 -> floor(100 * 0.12) = 12, items 30 + 10 = 40, constant 7.
  expect(buildSpeed(100, 7, items, (it) => itemSpeed(it))).toBe(159);
});

// The constant is whatever the model cannot account for: faction guardians, champion ascension,
// relic. Measured once from current gear, and gear-independent thereafter.
test("measureConstant returns the unexplained remainder of the observed speed", () => {
  const items = [item({ set: 0, mainStat: { statId: 4, isFlat: false, value: 30 } })];
  // base 100 + no set + 30 = 130; observed 140 leaves 10 unexplained.
  expect(measureConstant(140, 100, items, (it) => itemSpeed(it))).toBe(10);
  expect(measureConstant(130, 100, items, (it) => itemSpeed(it))).toBe(0);
});

test("measureConstant handles an ungeared champion", () => {
  expect(measureConstant(113, 110, [], (it) => itemSpeed(it))).toBe(3);
});

test("speedOfWith produces a per-item valuation that applies the clamped floor", () => {
  const ceil = new Map([["5|6", 6]]);
  const speedOf = speedOfWith(10, ceil);
  const it = item({ rarity: 5, rank: 6, mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 12, 2)] });
  expect(speedOf(it)).toBe(18);
});

// --- The id space -------------------------------------------------------------------------------

// decode.mjs's DB stat enum is documented as 1HP 2ATK 3DEF 4SPD..., and DBSTAT_TO_OURSTAT is the
// independent, pre-existing translation into our ids. Agreeing with it pins SPD to the same 4 the
// decoder emits, so a drift in either id space fails here rather than silently valuing the wrong
// stat as speed.
test("SPD is the id decode.mjs maps the DB's SPD onto", () => {
  expect(SPD).toBe(4);
  expect(DBSTAT_TO_OURSTAT[4]).toBe(SPD);
});

// --- What the floor may and may not lift --------------------------------------------------------

// The mirror of the ascension case: glyphs live on substats only (mgv is 0 in all 8474 rows of the
// 2026-08-12 snapshot), so a boots' 30 SPD main stat is 30 however high the floor is asked to go.
test("glyphFloor does not touch the main stat either", () => {
  const it = item({ mainStat: { statId: 4, isFlat: false, value: 30 }, substats: [] });
  expect(itemSpeed(it, 8)).toBe(30);
  expect(itemSpeed(it, 20)).toBe(30);
});

// SPD has no percentage form, but the flag is present on every decoded stat and the model must not
// start reading it: both spellings have to value identically, in all three positions.
test("itemSpeed counts SPD in every position regardless of the isFlat flag", () => {
  const build = (isFlat) => item({
    mainStat: { statId: 4, isFlat, value: 30 },
    substats: [{ statId: 4, isFlat, rolls: 0, value: 12, glyph: 0 }],
    ascStat: { statId: 4, isFlat, value: 5 },
  });
  expect(itemSpeed(build(true))).toBe(47);
  expect(itemSpeed(build(false))).toBe(47);
});

// --- Ceilings and clamping ----------------------------------------------------------------------

// A bucket whose SPD substats all carry a zero glyph has been SEEN but has observed no glyph, and
// recording a 0 ceiling for it would clamp every floor in that bucket to nothing — the same silent
// deletion the unseen-bucket rule exists to avoid.
test("glyphCeilings ignores zero glyphs, leaving that bucket unclamped rather than zeroed", () => {
  const ceil = glyphCeilings([
    item({ rarity: 3, rank: 2, substats: [sub(4, 10, 0)] }),
    item({ rarity: 3, rank: 2, substats: [sub(4, 8, 0)] }),
  ]);
  expect(ceil.has("3|2")).toBe(false);
  expect(clampFloor(item({ rarity: 3, rank: 2 }), 8, ceil)).toBe(8);
});

// Rarity and rank are separate axes: a shared rarity must not borrow another rank's ceiling.
test("glyphCeilings keys on rarity AND rank, not either alone", () => {
  const ceil = glyphCeilings([
    item({ rarity: 5, rank: 6, substats: [sub(4, 10, 12)] }),
    item({ rarity: 5, rank: 4, substats: [sub(4, 10, 5)] }),
    item({ rarity: 3, rank: 6, substats: [sub(4, 10, 3)] }),
  ]);
  expect([...ceil.keys()].sort()).toEqual(["3|6", "5|4", "5|6"]);
  expect(clampFloor(item({ rarity: 5, rank: 4 }), 12, ceil)).toBe(5);
  expect(clampFloor(item({ rarity: 3, rank: 6 }), 12, ceil)).toBe(3);
});

// `--glyph -5` is nonsense rather than "lower every glyph": a floor below zero is no floor at all.
test("clampFloor normalizes a negative floor to 0, seen bucket or not", () => {
  expect(clampFloor(item({ rarity: 5, rank: 6 }), -5, new Map())).toBe(0);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), -5, new Map([["5|6", 12]]))).toBe(0);
});

// The clamp is per item, so one valuation function serves a mixed-tier pool: each piece is held to
// its own bucket's ceiling rather than to whatever the first item happened to establish.
test("speedOfWith clamps each item against its own bucket", () => {
  const speedOf = speedOfWith(10, new Map([["5|6", 12], ["4|5", 4]]));
  const at = (rarity, rank) => item({ rarity, rank, mainStat: OTHER_MAIN, substats: [sub(4, 12, 0)] });
  expect(speedOf(at(5, 6))).toBe(22);   // floor 10 is under the 12 ceiling
  expect(speedOf(at(4, 5))).toBe(16);   // clamped to 4
  expect(speedOf(at(2, 1))).toBe(22);   // unseen bucket, unclamped
});

// --- buildSpeed and measureConstant -------------------------------------------------------------

// Set bonuses multiply base but NOT the constant, which is why they are separate arguments. Folding
// the constant into base before applying the percentage is the error this pins: it would credit the
// relic with a set bonus it does not earn, and bias the solver toward sets over flat speed.
test("buildSpeed applies set bonuses to base alone, never to base + constant", () => {
  const items = [item({ set: 4, mainStat: OTHER_MAIN }), item({ set: 4, mainStat: OTHER_MAIN })];
  // base 100 + floor(100 * 0.12) = 12 + no item speed + constant 25.
  expect(buildSpeed(100, 25, items, itemSpeed)).toBe(137);
  // Folding them would compute the same build as base 125, which is a genuinely different number:
  // floor(125 * 0.12) = 15, i.e. 3 points of speed the champion does not have.
  expect(buildSpeed(125, 0, items, itemSpeed)).toBe(140);
});

// The solver hands buildSpeed a `speedOfWith(...)` closure; valuing items with anything else would
// silently drop the glyph floor from every candidate build it scores.
test("buildSpeed values every item through the speedOf it was given", () => {
  const at = () => item({ rarity: 5, rank: 6, set: 0, mainStat: OTHER_MAIN, substats: [sub(4, 10, 0)] });
  const items = [at(), at()];
  expect(buildSpeed(100, 0, items, itemSpeed)).toBe(120);
  expect(buildSpeed(100, 0, items, speedOfWith(6, new Map([["5|6", 12]])))).toBe(132);
});

// The current gear's set bonus is part of what the model explains, so it must be subtracted out.
// Absorbing it into the constant would double-count it on any candidate build that keeps the set.
test("measureConstant credits the current gear's set bonus instead of absorbing it", () => {
  const items = [
    item({ set: 4, mainStat: { statId: 4, isFlat: false, value: 30 } }),
    item({ set: 4, mainStat: OTHER_MAIN }),
  ];
  // base 100 + Speed x2 (12) + 30 = 142, so an observed 150 leaves 8 unexplained.
  expect(measureConstant(150, 100, items, itemSpeed)).toBe(8);
});

// A champion can be slower than the model predicts (mis-typed base, an unknown penalty), and the
// remainder has to stay signed: clamping it at 0 would hide the disagreement.
test("measureConstant reports a negative remainder rather than clamping it", () => {
  const items = [item({ set: 0, mainStat: { statId: 4, isFlat: false, value: 30 } })];
  expect(measureConstant(125, 100, items, itemSpeed)).toBe(-5);
});

// The round trip the solver relies on: a constant measured off current gear, fed back in, reproduces
// the observed speed exactly — and then carries unchanged onto a different build.
test("a measured constant reproduces the observed speed, and carries to another build", () => {
  const current = [
    item({ set: 4, mainStat: { statId: 4, isFlat: false, value: 30 } }),
    item({ set: 4, mainStat: OTHER_MAIN, substats: [sub(4, 9, 3)] }),
  ];
  const speedOf = speedOfWith(0, new Map());
  const constant = measureConstant(175, 100, current, speedOf);
  // base 100 + Speed x2 (12) + 30 + 12 = 154, so the constant is 21.
  expect(constant).toBe(21);
  expect(buildSpeed(100, constant, current, speedOf)).toBe(175);
  // Swap one piece out of the set: the Speed bonus lapses, that item's 12 speed goes with it.
  const swapped = [current[0], item({ set: 38, mainStat: OTHER_MAIN })];
  expect(buildSpeed(100, constant, swapped, speedOf)).toBe(151);
});
