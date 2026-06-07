// oracle/analytics/__tests__/census.test.mjs
import { test, expect } from "vitest";
import { census } from "../census.mjs";

const it = (over) => ({ slot: 1, set: 1, rarity: 4, level: 16, faction: 0, isAccessory: false,
  substats: [], ascLevel: -1, equippedChampId: 0, ...over });

test("bySlot counts reconcile to total", () => {
  const items = [it({ slot: 1 }), it({ slot: 1 }), it({ slot: 4 })];
  const c = census(items);
  expect(c.total).toBe(3);
  expect([...c.bySlot.values()].reduce((a, b) => a + b, 0)).toBe(c.total);
});
test("setless counts only setless accessories", () => {
  const items = [it({ slot: 8, isAccessory: true, set: 0 }), it({ slot: 8, isAccessory: true, set: 66 }), it({ slot: 1, set: 0 })];
  expect(census(items).setless).toBe(1);
});
