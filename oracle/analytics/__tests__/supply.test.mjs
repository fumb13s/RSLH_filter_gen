// oracle/analytics/__tests__/supply.test.mjs
import { test, expect } from "vitest";
import { bucketKey, floorFor, bucketCounts, atOrBelowFloor, setlessDominated } from "../supply.mjs";

const acc = (id, faction, slot, set, eq = 0) => ({ id, faction, slot, set, isAccessory: true, equippedChampId: eq });
const art = (id, slot, set, eq = 0) => ({ id, slot, set, faction: 0, isAccessory: false, equippedChampId: eq });

test("floors: accessory flat 4, setless 0, artifact 4xdemand", () => {
  expect(floorFor(acc(1, 5, 7, 66))).toBe(4);  // Mercurial accessory
  expect(floorFor(acc(2, 5, 7, 0))).toBe(0);   // setless
  expect(floorFor(art(3, 1, 66))).toBe(20);    // Mercurial artifact demand 5 -> 20
  expect(floorFor(art(4, 1, 49))).toBe(4);     // Killstroke demand 1 -> 4
});
test("bucketCounts excludes worn", () => {
  const items = [art(1, 1, 48), art(2, 1, 48, 999), art(3, 1, 48)];
  const c = bucketCounts(items);
  expect(c.get(bucketKey(art(1, 1, 48)))).toBe(2); // only the 2 unequipped
});
test("atOrBelowFloor protects thin buckets", () => {
  const items = [art(1, 1, 49), art(2, 1, 49)]; // demand1 artifact, floor 4, only 2 -> protected
  const c = bucketCounts(items);
  expect(atOrBelowFloor(art(1, 1, 49), c)).toBe(true);
});
test("setlessDominated: setless flagged when a set accessory matches/beats it", () => {
  const items = [acc(1, 5, 7, 0), acc(2, 5, 7, 60)]; // #1 setless, #2 set 60, same faction5/slot7
  const score = (it) => (it.set === 0 ? 30 : 50); // set piece better
  const dom = setlessDominated(items, score);
  expect(dom.has(1)).toBeTruthy();
  expect(dom.has(2)).toBeFalsy();
});
