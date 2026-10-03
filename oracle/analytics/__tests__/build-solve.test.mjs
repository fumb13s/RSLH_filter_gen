// oracle/analytics/__tests__/build-solve.test.mjs
import { test, expect } from "vitest";
import { SLOTS, buildIndex } from "../build-solve.mjs";

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
