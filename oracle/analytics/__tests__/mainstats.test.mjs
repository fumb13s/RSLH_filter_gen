// oracle/analytics/__tests__/mainstats.test.mjs
import { test, expect } from "vitest";
import { SLOT_STATS } from "@rslh/core";
import { mainMax } from "../mainstats.mjs";

test("confirmed ceilings (validated against the live vault)", () => {
  expect(mainMax(4, 4, true)).toBe(45);    // SPD boots
  expect(mainMax(3, 6, false)).toBe(80);   // C.DMG gloves
  expect(mainMax(8, 6, false)).toBe(40);   // C.DMG amulet (differs from gloves)
  expect(mainMax(9, 1, true)).toBe(6120);  // banner flat HP (higher than other slots)
  expect(mainMax(9, 2, true)).toBe(398);   // banner flat ATK
  expect(mainMax(9, 3, true)).toBe(398);   // banner flat DEF
  expect(mainMax(1, 1, true)).toBe(4080);  // helmet flat HP
  expect(mainMax(7, 2, true)).toBe(265);   // ring flat ATK
  expect(mainMax(2, 2, false)).toBe(60);   // chest ATK%
  expect(mainMax(2, 8, true)).toBe(96);    // chest ACC
  expect(mainMax(3, 5, false)).toBe(60);   // gloves C.RATE
  expect(mainMax(5, 2, true)).toBe(265);   // weapon flat ATK
});

test("a ceiling is defined for every achievable main in SLOT_STATS", () => {
  for (const [slot, cfg] of Object.entries(SLOT_STATS)) {
    for (const [id, flat] of cfg.primaryStats) {
      expect(mainMax(Number(slot), id, flat), `slot ${slot} main ${id}/${flat ? "flat" : "%"}`).toBeGreaterThan(0);
    }
  }
});

test("C.DMG (the only slot-exclusive main) is null off gloves/amulet", () => {
  expect(mainMax(5, 6, false)).toBeNull(); // C.DMG on a weapon — impossible
  expect(mainMax(4, 6, false)).toBeNull(); // C.DMG on boots — impossible
  expect(mainMax(3, 6, false)).toBe(80);   // ...but real on gloves
});
