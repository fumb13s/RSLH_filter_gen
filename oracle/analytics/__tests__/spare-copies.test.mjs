// oracle/analytics/__tests__/spare-copies.test.mjs
import { test, expect } from "vitest";
import { gearCount, compareCopies, classifyCopy, analyzeChampion } from "../spare-copies.mjs";

// Minimal Champs-row factory: pristine level-1, ungeared, unblessed unless overridden.
const row = (o) => ({
  ID: 1, Name: "X", Rarity: 5, Rang: 1, Lvl: 1, EmpLvl: 0, Br: 0,
  Weapon: 0, Helmet: 0, Shield: 0, Glouves: 0, Chest: 0, Shoes: 0, Ring: 0, Amulett: 0, Banner: 0, ...o,
});

test("gearCount counts non-zero equip slots", () => {
  expect(gearCount(row({}))).toBe(0);
  expect(gearCount(row({ Weapon: 123, Chest: 5, Ring: 9 }))).toBe(3);
});

test("classifyCopy: maxed / bare / partial", () => {
  expect(classifyCopy(row({ Rang: 6, Lvl: 60, Weapon: 1 }))).toBe("maxed");
  expect(classifyCopy(row({ Rang: 6, Lvl: 60 }))).toBe("maxed");             // maxed even when ungeared
  expect(classifyCopy(row({ Rang: 5, Lvl: 1 }))).toBe("bare");               // pristine food
  expect(classifyCopy(row({ Rang: 6, Lvl: 1 }))).toBe("bare");              // ranked but otherwise untouched
  expect(classifyCopy(row({ Rang: 5, Lvl: 30 }))).toBe("partial");
  expect(classifyCopy(row({ Rang: 5, Lvl: 1, Weapon: 9 }))).toBe("partial"); // geared -> not bare
  expect(classifyCopy(row({ Rang: 5, Lvl: 1, EmpLvl: 2 }))).toBe("partial"); // empowered -> not bare
});

test("compareCopies orders by rank, then level, then gear", () => {
  const a = row({ ID: 1, Rang: 6, Lvl: 60, Weapon: 1 });
  const b = row({ ID: 2, Rang: 6, Lvl: 60 });          // same rank/level, less gear
  const c = row({ ID: 3, Rang: 5, Lvl: 60 });          // lower rank
  expect([c, b, a].sort(compareCopies).map((r) => r.ID)).toEqual([1, 2, 3]);
});

test("analyzeChampion picks the most-invested keeper and tags the spares", () => {
  // Michinaki-like: two maxed (one blessed+geared, one geared), one maxed-ungeared, two bare.
  const copies = [
    row({ ID: 184790, Rang: 5, Lvl: 1 }),                              // bare
    row({ ID: 52457, Rang: 6, Lvl: 60, Br: 1, Weapon: 1, Helmet: 1 }), // maxed, blessed, geared
    row({ ID: 126834, Rang: 6, Lvl: 60 }),                             // maxed, ungeared
    row({ ID: 204402, Rang: 5, Lvl: 1 }),                              // bare
    row({ ID: 57614, Rang: 6, Lvl: 60, Weapon: 1, Helmet: 1 }),        // maxed, geared, unblessed
  ];
  const g = analyzeChampion("Michinaki", copies);
  expect(g.keeper.ID).toBe(52457);   // blessing breaks the tie among maxed+geared copies
  expect(g.total).toBe(5);
  expect(g.spares.length).toBe(4);
  expect(g.tags).toEqual({ maxed: 2, partial: 0, bare: 2 });
});

test("analyzeChampion on a lone copy yields no spares", () => {
  const g = analyzeChampion("Solo", [row({ ID: 7, Rang: 6, Lvl: 60 })]);
  expect(g.total).toBe(1);
  expect(g.spares).toEqual([]);
  expect(g.keeper.ID).toBe(7);
});
