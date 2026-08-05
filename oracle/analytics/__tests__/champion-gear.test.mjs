// oracle/analytics/__tests__/champion-gear.test.mjs
import { test, expect } from "vitest";
import { CHAMP_ROLE, CHAMP_ROLE_LABEL, champRole, quantile } from "../champion-gear.mjs";

// Minimal Champs row: an Attack champion unless overridden.
const champ = (o = {}) => ({ ID: 110, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60, ...o });

test("champRole maps the four Champs.Role values onto the analytics archetypes", () => {
  expect(champRole(champ({ Role: 0 }))).toBe("ATK-DPS");
  expect(champRole(champ({ Role: 1 }))).toBe("DEF-DPS");
  expect(champRole(champ({ Role: 2 }))).toBe("HP-DPS");
  expect(champRole(champ({ Role: 3 }))).toBe("Support");
});

test("champRole returns null for an unrecognised Role", () => {
  expect(champRole(champ({ Role: 9 }))).toBe(null);
  expect(champRole(champ({ Role: -1 }))).toBe(null);
});

// A SQL NULL Role is unrecognised, not Attack — the column carries no NOT NULL constraint, and a
// silent fallback to role 0 would grade the champion against the wrong archetype.
test("champRole returns null for a missing or null Role", () => {
  expect(champRole(champ({ Role: null }))).toBe(null);
  expect(champRole(champ({ Role: undefined }))).toBe(null);
  expect(champRole({ ID: 999, Name: "No role column" })).toBe(null);
});

test("CHAMP_ROLE covers exactly the four archetypes", () => {
  expect(Object.values(CHAMP_ROLE).sort())
    .toEqual(["ATK-DPS", "DEF-DPS", "HP-DPS", "Support"]);
});

// The two maps are hand-maintained in parallel and indexed by the same Role value.
test("CHAMP_ROLE_LABEL is keyed in lockstep with CHAMP_ROLE", () => {
  expect(Object.keys(CHAMP_ROLE_LABEL)).toEqual(Object.keys(CHAMP_ROLE));
});

test("quantile is index-based and handles degenerate inputs", () => {
  expect(quantile([], 0.5)).toBe(0);
  expect(quantile([7], 0.5)).toBe(7);
  expect(quantile([7], 0)).toBe(7);
  expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
  expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
});

test("quantile sorts an unordered input without mutating it", () => {
  const xs = [3, 1, 2];
  expect(quantile(xs, 0.5)).toBe(2); // fails if the implementation drops its sort
  expect(xs).toEqual([3, 1, 2]);
});
