// oracle/analytics/__tests__/rolls.test.mjs
import { test, expect } from "vitest";
import { MAX_ROLLS, TOTAL_ROLLS, subMax, subCeiling } from "../rolls.mjs";

test("roll budget derived from core mechanics", () => {
  expect(MAX_ROLLS).toBe(6);   // reveal + Mythical bonus + 4 upgrades
  expect(TOTAL_ROLLS).toBe(9); // 5 Mythical starting rolls + 4 upgrades
});

test("theoretical subMax = MAX_ROLLS x per-roll max @6★", () => {
  expect(subMax(2, false)).toBe(42);   // ATK% : 6 x 7
  expect(subMax(4, true)).toBe(36);    // SPD  : 6 x 6
  expect(subMax(8, true)).toBe(72);    // ACC  : 6 x 12
  expect(subMax(7, true)).toBe(72);    // RES  : 6 x 12
  expect(subMax(1, true)).toBe(3390);  // flat HP : 6 x 565
  expect(subMax(2, true)).toBe(180);   // flat ATK/DEF : 6 x 30
});

test("subCeiling piles the budget on the top desirability sub (rolls 6,1,1,1)", () => {
  // Boots (slot 4) with desirOf = statId: top-4 achievable stat ids are 8,7,6,5 (ACC,RES,C.DMG,C.RATE).
  // ceiling = 8*(6/6) + (7+6+5)*(1/6) = 8 + 3 = 11.
  expect(subCeiling(4, (id) => id)).toBeCloseTo(11, 5);
});

test("subCeiling excludes the main stat from the substat pool", () => {
  // Excluding stat id 8 (the top) -> top-4 become 7,6,5,4 -> 7 + (6+5+4)/6 = 9.5.
  expect(subCeiling(4, (id) => id, { statId: 8, isFlat: true })).toBeCloseTo(9.5, 5);
});
