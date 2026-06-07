// oracle/analytics/__tests__/sets.test.mjs
import { test, expect } from "vitest";
import { getSet, expandRoles, SETS } from "../sets.mjs";

test("expandRoles: All -> 4 roles, D -> 3", () => {
  expect(expandRoles(["All"]).length).toBe(4);
  expect(expandRoles(["D"]).sort()).toEqual(["ATK-DPS", "DEF-DPS", "HP-DPS"]);
  expect(expandRoles(["DEF-DPS", "Support"]).sort()).toEqual(["DEF-DPS", "Support"]);
});
test("known values transcribed (Mercurial 5/5, Setless 3/1, Killstroke 4/1)", () => {
  expect([getSet(66).scarcity, getSet(66).demand]).toEqual([5, 5]);
  expect([getSet(0).scarcity, getSet(0).demand]).toEqual([3, 1]);
  expect([getSet(49).scarcity, getSet(49).demand]).toEqual([4, 1]);
});
test("unknown set falls back to All/3/3 + unannotated", () => {
  const f = getSet(99999);
  expect(f.unannotated).toBe(true);
  expect([f.scarcity, f.demand]).toEqual([3, 3]);
});
test("every annotated set has valid scarcity/demand 1-5 and >=1 role (except setless)", () => {
  for (const [id, s] of Object.entries(SETS)) {
    expect(s.scarcity >= 1 && s.scarcity <= 5, `set ${id} scarcity`).toBeTruthy();
    expect(s.demand >= 1 && s.demand <= 5, `set ${id} demand`).toBeTruthy();
    if (Number(id) !== 0) expect(s.roles.length >= 1, `set ${id} roles`).toBeTruthy();
  }
});
