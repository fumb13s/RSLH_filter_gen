// oracle/analytics/__tests__/build-solve.test.mjs
import { test, expect } from "vitest";
import { SLOTS, buildIndex, slotsSupplying, usefulCounts } from "../build-solve.mjs";

// Every item carries a plain `value` the injected valuation reads back. The module is
// stat-agnostic — it never looks at a stat — so a number on the item is the honest way to
// exercise it, and it keeps each expected score below readable arithmetic rather than a speed
// calculation. Every other field is present because a real decoded artifact has it.
const valueOf = (it) => it.value;

const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, value: 0, mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
});

const pool = (specs) => specs.map((s, i) => item({ id: i + 1, ...s }));
const indexOf = (specs, faction = 0) => buildIndex(pool(specs), faction, valueOf);

// A bonus profile over 0..9 pieces, as `bonusAt` wants it. `at` gives the TOTAL bonus from that
// piece count upward, so tiers({ 2: 10, 4: 25 }) is [0,0,10,10,25,25,25,25,25,25]. A helper is
// fine here because these are INPUTS; every expected score below is written out as arithmetic.
const tiers = (at) => {
  const out = [0];
  let current = 0;
  for (let n = 1; n <= 9; n++) {
    if (at[n] !== undefined) current = at[n];
    out.push(current);
  }
  return out;
};

const bonusOf = (byId) => new Map(Object.entries(byId).map(([id, at]) => [Number(id), tiers(at)]));

test("SLOTS covers all nine equipment slots", () => {
  expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("buildIndex keeps only the best item of each set in each slot", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 },
    { slot: 1, set: 4, value: 18 },
    { slot: 1, set: 38, value: 14 },
  ]);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).value).toBe(18);
  expect(index.get(1).get(38).item.id).toBe(3);
});

// The id is a TIE-break, subordinate to value — it must never unseat a better incumbent. The
// worse item has to arrive second for this to bite: an id-dominant comparison is invisible
// whenever the pool happens to be id-ascending, which a database read usually is.
test("buildIndex keeps the better item even when the worse one has the lower id", () => {
  const index = indexOf([
    { id: 2, slot: 1, value: 18 }, { id: 1, slot: 1, value: 10 },
  ]);
  expect(index.get(1).get(4).item.id).toBe(2);
});

// The winner is the lowest id of the whole tied group, not of the first or last pair compared.
// A tie that depended on row order would return a different build on a rerun.
test("buildIndex breaks a three-way tie on the lowest id wherever it sits in the row order", () => {
  for (const order of [[7, 3, 5], [5, 7, 3], [3, 5, 7]]) {
    const index = indexOf(order.map((id) => ({ id, slot: 1, value: 12 })));
    expect(index.get(1).get(4).item.id).toBe(3);
  }
});

// The faction lock covers all three accessory slots and none of the six artifact slots. A filter
// that reached one slot too far, or stopped one slot short, would pass a single-slot case.
test("buildIndex applies the faction lock to every accessory slot and no artifact slot", () => {
  const wrong = [7, 8, 9].map((slot) => ({ id: slot, slot, isAccessory: true, faction: 5, value: 10 }));
  const artifacts = [1, 2, 3, 4, 5, 6].map((slot) => ({ id: slot, slot, faction: 5, value: 10 }));
  const index = buildIndex([...wrong, ...artifacts].map((o) => item(o)), 2, valueOf);
  for (const slot of [7, 8, 9]) expect(index.has(slot)).toBe(false);
  for (const slot of [1, 2, 3, 4, 5, 6]) expect(index.get(slot).get(4).item.id).toBe(slot);
});

// The valuation is injected, so the index must rank by it and not by any field it picks itself.
// Ranking by a hardcoded field would pass every other test in this file.
test("buildIndex ranks by the injected valuation rather than any field of its own", () => {
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, value: 50 }),
    item({ id: 2, slot: 1, set: 4, value: 1 }),
  ], 0, (it) => it.id);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).value).toBe(2);
});

test("slotsSupplying counts distinct slots that can supply a set", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 },
    { slot: 2, set: 4, value: 12 }, { slot: 3, set: 38, value: 10 },
  ]);
  expect(slotsSupplying(index, 4)).toBe(2);
  expect(slotsSupplying(index, 38)).toBe(1);
  expect(slotsSupplying(index, 66)).toBe(0);
});

// Only counts where one more piece actually pays are worth planning around: a count between two
// paying counts grants exactly the lower one's bonus, so planning it enumerates the same build
// twice.
test("usefulCounts lists only the counts where one more piece pays", () => {
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
  expect(usefulCounts(bonusAt, 4, 9)).toEqual([2, 4, 6]);
  expect(usefulCounts(bonusAt, 58, 9)).toEqual([3, 5, 8]);
});

// The cap is maxSlots, and it must INCLUDE a count landing exactly on it — off by one here
// silently deletes the strongest plan a pool can reach rather than failing loudly.
test("usefulCounts caps at maxSlots and includes a count landing exactly on it", () => {
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
  expect(usefulCounts(bonusAt, 4, 6)).toEqual([2, 4, 6]);
  expect(usefulCounts(bonusAt, 4, 5)).toEqual([2, 4]);
  expect(usefulCounts(bonusAt, 58, 2)).toEqual([]);
});

// THE case this solver exists for. A set that pays from one piece has no useful count at all
// unless it also pays again later, because one-piece bonuses are bought by a singleton column
// instead of being planned. A solver that planned them would need nine-set plans.
test("usefulCounts never reports 1, so a one-piece bonus is never planned", () => {
  const bonusAt = bonusOf({ 70: { 1: 9 }, 71: { 1: 9, 3: 20 } });
  expect(usefulCounts(bonusAt, 70, 9)).toEqual([]);
  expect(usefulCounts(bonusAt, 71, 9)).toEqual([3]);
});

test("usefulCounts is empty for a set the model says nothing about", () => {
  expect(usefulCounts(new Map(), 4, 9)).toEqual([]);
});
