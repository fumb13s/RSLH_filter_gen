// oracle/analytics/__tests__/power-model.test.mjs
import { test, expect } from "vitest";
import { constantFrom, lin, power } from "../power-model.mjs";

// The game's Total Stats, every source included. C.RATE and C.DMG are percentage POINTS.
const totals = (o = {}) => ({
  HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o,
});

const W = { b: 0.01, r: 0.2, a: 0.03, s: 0.02, k: 0.001 };

// Hand-computed, term by term, so a sign or a factor going wrong names itself:
//   b * (30000/15 + 2000 + 1500) = 0.01 * 5500      = 55
//   r * 100                      = 0.2  * 100       = 20
//   a * 50                       = 0.03 * 50        =  1.5
//   s * 200                      = 0.02 * 200       =  4
//   k * 60 * (100 + 150)         = 0.001 * 60 * 250 = 15
test("lin sums the five weighted terms of the formula", () => {
  expect(lin(totals(), W)).toBeCloseTo(95.5, 10);
});

// HP, ATK and DEF share ONE weight: fifteen points of HP buy exactly what one point of ATK does.
// Measured to within 1% on four champions.
test("lin divides HP by 15 before sharing b with ATK and DEF", () => {
  const onlyB = { b: 0.01, r: 0, a: 0, s: 0, k: 0 };
  const bare = { SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 };
  expect(lin({ ...bare, HP: 1500, ATK: 0, DEF: 0 }, onlyB)).toBeCloseTo(1, 10);
  expect(lin({ ...bare, HP: 0, ATK: 100, DEF: 0 }, onlyB)).toBeCloseTo(1, 10);
  expect(lin({ ...bare, HP: 0, ATK: 0, DEF: 100 }, onlyB)).toBeCloseTo(1, 10);
});

// Crit enters as the PRODUCT k * C.RATE * (100 + C.DMG), not as two independent terms: on four
// champions the k from a pure C.RATE step and the k from a pure C.DMG step agree to about 1%.
// The `100 +` is why C.RATE pays even at C.DMG 0 — and why no crit rate means no crit term at all.
test("lin's crit term is k x C.RATE x (100 + C.DMG)", () => {
  const onlyK = { b: 0, r: 0, a: 0, s: 0, k: 0.001 };
  const crit = (cr, cd) =>
    ({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": cr, "C.DMG": cd, RES: 0, ACC: 0 });
  expect(lin(crit(60, 0), onlyK)).toBeCloseTo(6, 10);      // 0.001 * 60 * 100
  expect(lin(crit(60, 150), onlyK)).toBeCloseTo(15, 10);   // 0.001 * 60 * 250
  expect(lin(crit(0, 150), onlyK)).toBe(0);
});

// --- power and the copy constant ---------------------------------------------------------------

// Power is the SQUARE of the linear part plus the copy's constant. lin(totals(), W) is 95.5, so a
// constant of 4.5 makes the whole bracket 100 and the power exactly 10000.
test("power squares the linear part plus the copy constant", () => {
  expect(power(totals(), W, 4.5)).toBeCloseTo(10000, 6);
});

// The round trip the calibrator relies on: a constant measured off one reading reproduces that
// reading's power. Compared RELATIVELY — an absolute tolerance on a five-digit power is a tolerance
// on the fourteenth significant digit.
test("constantFrom recovers the c that reproduces an observed power", () => {
  const observed = 123456;
  const c = constantFrom(totals(), W, observed);
  expect(Math.abs(power(totals(), W, c) / observed - 1)).toBeLessThan(1e-12);
});
