// oracle/analytics/__tests__/rollquality.test.mjs
import { test, expect } from "vitest";
import { rollStats, isGoodSub, pearson, spearman, ranks, segmentStats, bucketStats } from "../rollquality.mjs";

// substat factory — only statId/isFlat/rolls matter to roll counting (value/glyph irrelevant)
const sub = (statId, isFlat, rolls) => ({ statId, isFlat, rolls, value: 0, glyph: 0 });
const item = (substats, slot = 4) => ({ slot, substats }); // default slot 4 = Boots (artifact)

test("artifact good substats mirror the generator presets (nuker = no ACC, no flat)", () => {
  // ATK-DPS = ATK Nuker on an artifact (slot 4 = Boots): ATK%, SPD, C.RATE, C.DMG
  expect(isGoodSub(4, "ATK-DPS", 2, false)).toBe(true); // ATK%
  expect(isGoodSub(4, "ATK-DPS", 5, false)).toBe(true); // C.RATE
  expect(isGoodSub(4, "ATK-DPS", 4, true)).toBe(true);  // SPD
  expect(isGoodSub(4, "ATK-DPS", 8, true)).toBe(false); // ACC — NOT good for an artifact nuker
  expect(isGoodSub(4, "ATK-DPS", 1, true)).toBe(false); // flat HP
});

test("artifact Support good substats include DEF%, RES and ACC but not crit", () => {
  expect(isGoodSub(2, "Support", 3, false)).toBe(true);  // DEF% (slot 2 = Chest)
  expect(isGoodSub(2, "Support", 7, true)).toBe(true);   // RES
  expect(isGoodSub(2, "Support", 8, true)).toBe(true);   // ACC
  expect(isGoodSub(2, "Support", 5, false)).toBe(false); // C.RATE not good for support
});

test("Ring good substats are role %s only (ring can't roll SPD/crit/ACC/RES)", () => {
  expect(isGoodSub(7, "ATK-DPS", 2, false)).toBe(true);  // ATK%
  expect(isGoodSub(7, "ATK-DPS", 4, true)).toBe(false);  // SPD not on rings
  expect(isGoodSub(7, "ATK-DPS", 6, false)).toBe(false); // C.DMG not on rings
  expect(isGoodSub(7, "Support", 1, false)).toBe(true);  // HP%
  expect(isGoodSub(7, "Support", 3, false)).toBe(true);  // DEF%
});

test("Amulet DPS good = C.DMG + ACC; Support good = ACC/RES/flat HP/DEF", () => {
  expect(isGoodSub(8, "ATK-DPS", 6, false)).toBe(true);  // C.DMG
  expect(isGoodSub(8, "ATK-DPS", 8, true)).toBe(true);   // ACC
  expect(isGoodSub(8, "ATK-DPS", 7, true)).toBe(false);  // RES not good for a DPS amulet
  expect(isGoodSub(8, "Support", 8, true)).toBe(true);   // ACC
  expect(isGoodSub(8, "Support", 7, true)).toBe(true);   // RES
  expect(isGoodSub(8, "Support", 1, true)).toBe(true);   // flat HP
  expect(isGoodSub(8, "Support", 6, false)).toBe(false); // C.DMG not good for a Support amulet
});

test("Banner good = role % + SPD (banner can't roll crit/ACC/RES)", () => {
  expect(isGoodSub(9, "ATK-DPS", 2, false)).toBe(true);  // ATK%
  expect(isGoodSub(9, "ATK-DPS", 4, true)).toBe(true);   // SPD
  expect(isGoodSub(9, "ATK-DPS", 6, false)).toBe(false); // C.DMG not on banners
  expect(isGoodSub(9, "Support", 4, true)).toBe(true);   // SPD
});

test("rollStats counts initial+upgrades (rolls+1) in good substats vs total", () => {
  // ATK-DPS: C.RATE rolls=3 (good), ATK% rolls=1 (good), flat HP rolls=2 (junk), RES rolls=0 (junk for ATK-DPS)
  const it = item([sub(5, false, 3), sub(2, false, 1), sub(1, true, 2), sub(7, true, 0)]);
  const r = rollStats(it, "ATK-DPS");
  expect(r.good).toBe(6);   // (3+1) + (1+1)
  expect(r.total).toBe(10); // 4 + 2 + 3 + 1
  expect(r.frac).toBeCloseTo(0.6, 10);
});

test("rollStats: zero substats -> frac 0, no divide-by-zero", () => {
  const r = rollStats(item([]), "ATK-DPS");
  expect(r.total).toBe(0);
  expect(r.frac).toBe(0);
});

test("rollStats is slot-aware: an ACC sub is good on a Support amulet but not a Support ring", () => {
  const subs = [sub(8, true, 2)]; // one ACC sub -> 3 roll-events
  expect(rollStats({ slot: 8, substats: subs }, "Support").good).toBe(3); // amulet: ACC good
  expect(rollStats({ slot: 7, substats: subs }, "Support").good).toBe(0); // ring: ACC not good
});

test("pearson is +1 for a perfectly increasing line, -1 for decreasing", () => {
  expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
});

test("pearson returns NaN when a series has no variance", () => {
  expect(Number.isNaN(pearson([1, 2, 3], [5, 5, 5]))).toBe(true);
});

test("ranks assigns average ranks to ties (1-based)", () => {
  expect(ranks([10, 30, 20, 30])).toEqual([1, 3.5, 2, 3.5]);
});

test("spearman is 1 for a monotonic-but-nonlinear relation where pearson is < 1", () => {
  const xs = [1, 2, 3, 4], ys = [1, 4, 9, 16]; // y = x^2, strictly increasing
  expect(spearman(xs, ys)).toBeCloseTo(1, 10);
  expect(pearson(xs, ys)).toBeLessThan(1);
});

// --- aggregation: segmentStats / bucketStats ---
const row = (score, good, total, over = {}) => ({ score, good, total, frac: total ? good / total : 0, role: "ATK-DPS", isAccessory: false, level: 16, ...over });

test("segmentStats: counts the segment and correlates q with good-roll count", () => {
  const rows = [row(10, 1, 2), row(20, 2, 4), row(30, 3, 6)]; // good 1,2,3 ; frac all 0.5
  const s = segmentStats(rows, () => true);
  expect(s.n).toBe(3);
  expect(s.rCount).toBeCloseTo(1, 10);      // score rises perfectly with good count
  expect(Number.isNaN(s.rFrac)).toBe(true); // frac constant -> no variance -> NaN
});

test("segmentStats: predicate restricts the segment", () => {
  const rows = [row(10, 1, 2), row(99, 5, 6, { role: "Support" })];
  expect(segmentStats(rows, (r) => r.role === "ATK-DPS").n).toBe(1);
});

test("bucketStats: groups by good count with mean/median, skipping empty buckets", () => {
  const rows = [row(50, 0, 4), row(40, 2, 4), row(60, 2, 4), row(90, 3, 6)];
  expect(bucketStats(rows)).toEqual([
    { good: 0, n: 1, meanQ: 50, medianQ: 50 },
    { good: 2, n: 2, meanQ: 50, medianQ: 50 },
    { good: 3, n: 1, meanQ: 90, medianQ: 90 },
  ]);
});
