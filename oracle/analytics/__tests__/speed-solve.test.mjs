// oracle/analytics/__tests__/speed-solve.test.mjs
import { test, expect } from "vitest";
import { buildIndex, SLOTS } from "../speed-solve.mjs";
import { itemSpeed } from "../speed-model.mjs";

const speedOf = (it) => itemSpeed(it);
const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
});
const spd = (n) => [{ statId: 4, isFlat: false, rolls: 0, value: n, glyph: 0 }];

test("SLOTS covers all nine equipment slots", () => {
  expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("buildIndex keeps only the fastest item of each set in each slot", () => {
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, substats: spd(10) }),
    item({ id: 2, slot: 1, set: 4, substats: spd(18) }),
    item({ id: 3, slot: 1, set: 38, substats: spd(14) }),
  ], 0, speedOf);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(18);
  expect(index.get(1).get(38).item.id).toBe(3);
});

// The faction lock is a hard game rule: 1401 equipped accessories in the 2026-08-12 snapshot, zero
// of them on a champion of another faction.
test("buildIndex drops accessories of the wrong faction and keeps artifacts regardless", () => {
  const index = buildIndex([
    item({ id: 1, slot: 7, isAccessory: true, faction: 2, substats: spd(10) }),
    item({ id: 2, slot: 7, isAccessory: true, faction: 5, substats: spd(20) }),
    item({ id: 3, slot: 1, isAccessory: false, faction: 5, substats: spd(9) }),
  ], 2, speedOf);
  expect(index.get(7).get(4).item.id).toBe(1);
  expect(index.get(1).get(4).item.id).toBe(3);
});

// The lock covers all three accessory slots and none of the six artifact slots — a filter that
// reached one slot too far or stopped one slot short would still pass the case above.
test("buildIndex applies the faction lock to every accessory slot and no artifact slot", () => {
  const wrongFaction = [7, 8, 9].map((slot) =>
    item({ id: slot, slot, isAccessory: true, faction: 5, substats: spd(10) }));
  const artifacts = [1, 2, 3, 4, 5, 6].map((slot) =>
    item({ id: slot, slot, isAccessory: false, faction: 5, substats: spd(10) }));
  const index = buildIndex([...wrongFaction, ...artifacts], 2, speedOf);
  for (const slot of [7, 8, 9]) expect(index.has(slot)).toBe(false);
  for (const slot of [1, 2, 3, 4, 5, 6]) expect(index.get(slot).get(4).item.id).toBe(slot);
});

test("buildIndex omits a slot entirely when nothing is eligible for it", () => {
  const index = buildIndex([
    item({ id: 1, slot: 8, isAccessory: true, faction: 9, substats: spd(10) }),
  ], 2, speedOf);
  expect(index.has(8)).toBe(false);
});

// The id is a TIE-break, subordinate to speed — it must never unseat a faster incumbent. The slower
// item has to arrive second for this to bite: SQLite hands back Artifacts id-ascending, so on the
// snapshot an id-dominant comparison is invisible until a caller sorts or pre-filters the pool.
test("buildIndex keeps the faster item even when the slower one has the lower id", () => {
  const index = buildIndex([
    item({ id: 2, slot: 1, substats: spd(18) }), item({ id: 1, slot: 1, substats: spd(10) }),
  ], 0, speedOf);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(18);
});

// A tie must not depend on row order, or the same run prints different builds.
test("buildIndex breaks ties on the lower item id so output is stable", () => {
  const forward = buildIndex([
    item({ id: 7, slot: 1, substats: spd(12) }), item({ id: 3, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  const reverse = buildIndex([
    item({ id: 3, slot: 1, substats: spd(12) }), item({ id: 7, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  expect(forward.get(1).get(4).item.id).toBe(3);
  expect(reverse.get(1).get(4).item.id).toBe(3);
});

// The winner is the lowest id of the whole tied group, not of the first or last pair compared.
test("buildIndex breaks a three-way tie on the lowest id wherever it sits in the row order", () => {
  for (const order of [[7, 3, 5], [5, 7, 3], [3, 5, 7]]) {
    const index = buildIndex(order.map((id) => item({ id, slot: 1, substats: spd(12) })), 0, speedOf);
    expect(index.get(1).get(4).item.id).toBe(3);
  }
});

test("buildIndex indexes setless items under set 0", () => {
  const index = buildIndex([item({ id: 1, slot: 1, set: 0, substats: spd(11) })], 0, speedOf);
  expect(index.get(1).get(0).speed).toBe(11);
});

// A build has to fill all nine slots, and a set needs its pieces whether or not they carry speed —
// so an item worth zero speed is still the slot's candidate for its set.
test("buildIndex keeps items that contribute no speed at all", () => {
  const index = buildIndex([item({ id: 1, slot: 3, set: 66, substats: [] })], 0, speedOf);
  expect(index.get(3).get(66).item.id).toBe(1);
  expect(index.get(3).get(66).speed).toBe(0);
});

// The valuation is injected because a run may raise every SPD glyph to a floor (`--glyph`). An index
// that called itemSpeed itself would silently ignore that and rank the wrong item first.
test("buildIndex ranks by the injected valuation rather than the raw item speed", () => {
  const byId = (it) => it.id;
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, substats: spd(50) }),
    item({ id: 2, slot: 1, set: 4, substats: spd(1) }),
  ], 0, byId);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(2);
});
