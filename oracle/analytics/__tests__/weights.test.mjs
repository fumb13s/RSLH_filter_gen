// oracle/analytics/__tests__/weights.test.mjs
import { test, expect } from "vitest";
import { WEIGHTS } from "../weights.mjs";

test("SPD is 1.0 in every role", () => {
  for (const w of Object.values(WEIGHTS)) expect(w.spd).toBe(1.0);
});
test("every % stat outranks every flat stat, per role", () => {
  for (const [role, w] of Object.entries(WEIGHTS)) {
    const pcts = [w.cr, w.cd, w.atkPct, w.defPct, w.hpPct];
    expect(Math.min(...pcts) > w.flat, `${role}: min %(${Math.min(...pcts)}) > flat(${w.flat})`).toBeTruthy();
  }
});
test("Support: RES > DEF%", () => {
  expect(WEIGHTS.Support.res > WEIGHTS.Support.defPct).toBeTruthy();
});
