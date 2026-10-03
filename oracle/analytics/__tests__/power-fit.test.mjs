// oracle/analytics/__tests__/power-fit.test.mjs
import { test, expect } from "vitest";
import { fitWeights } from "../power-fit.mjs";
import { power, weightsFor } from "../power-model.mjs";

// A baseTypeId in no BUILT_IN table, so every prior in these tests is a role default and the test
// never has to know which champion it is standing in for.
const BASE = 999001;
const ROLE = 0;

const totals = (o = {}) => ({
  HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o,
});

// Unique per (copy, step) so a test can line residuals up with the readings that produced them.
const stamp = (heroId, i) => new Date(Date.UTC(2026, 9, 3, 0, heroId % 60, i)).toISOString();

// Generated FROM the formula, so a fit that recovers w and c is recovering what produced the
// numbers rather than agreeing with itself. `name` is carried because the record has it; nothing
// in fitWeights reads it.
const reading = (heroId, stats, w, c, i) => ({
  t: stamp(heroId, i), heroId, baseTypeId: BASE, name: "Synthetic", roleId: ROLE,
  totals: stats, power: power(stats, w, c),
});

// A baseline plus one single-stat step per design column. The steps move DISJOINT readings, and the
// baseline is in no step's support, which is what leaves the five centered columns independent.
// X_B and X_K each get two steps, one from each stat that feeds them.
const STEPS = [
  {},                    // baseline
  { HP: 36000 },         // X_B
  { ATK: 2600 },         // X_B, from the other side of the shared weight
  { RES: 160 },
  { ACC: 90 },
  { SPD: 240 },
  { "C.RATE": 85 },      // X_K
  { "C.DMG": 220 },      // X_K, from the other factor of the crit product
];

// `over` shifts a whole copy's baseline. Both copies sitting at DIFFERENT stat levels is what makes
// a global mean (instead of a per-copy one) produce visibly wrong weights: at identical levels the
// copy difference is orthogonal to every design column and a global mean recovers them by luck.
const OVER_22 = {
  HP: 42000, ATK: 2000, DEF: 1500, SPD: 230, "C.RATE": 70, "C.DMG": 180, RES: 130, ACC: 70,
};

const copy = (heroId, w, c, over = {}, steps = STEPS) =>
  steps.map((step, i) => reading(heroId, totals({ ...over, ...step }), w, c, i));

const W = { b: 0.0131, r: 0.2641, a: 0.0412, s: 0.0193, k: 0.00168 };
const C11 = 37.5;
const C22 = 51.25;

// Relative, not absolute: these weights span 0.0017 to 0.26, so one absolute tolerance cannot
// mean the same thing for all five.
const close = (got, want) => Math.abs(got / want - 1);

// --- input checks ------------------------------------------------------------------------------

test("fitWeights refuses an empty reading list", () => {
  expect(() => fitWeights([])).toThrow(/power-fit/);
  expect(() => fitWeights([])).toThrow(/no readings/);
});

// A reading whose power is not a positive finite number cannot be square-rooted into the response
// variable, and a NaN there would quietly turn every fitted weight into NaN.
test("fitWeights refuses a reading whose power is not a positive finite number", () => {
  const bad = (p) => () => fitWeights([{ ...reading(11, totals(), W, C11, 0), power: p }]);
  expect(bad(0)).toThrow(/power 0/);
  expect(bad(0)).toThrow(/power-fit/);
  expect(bad(-1)).toThrow(/power -1/);
  expect(bad(NaN)).toThrow(/power NaN/);
  expect(bad(undefined)).toThrow(/power-fit/);
});

// The stat is named because a reading has eight of them, and "a total is not finite" sends the
// reader through all eight by hand.
test("fitWeights refuses a reading with a non-finite total, naming the stat", () => {
  const r = reading(11, totals(), W, C11, 0);
  const broken = { ...r, totals: { ...r.totals, "C.RATE": NaN } };
  expect(() => fitWeights([broken])).toThrow(/C\.RATE/);
  expect(() => fitWeights([broken])).toThrow(/power-fit/);
});

// Weights are per champion. Fitting two together would average them into something that describes
// neither, and nothing downstream could tell that had happened — so it is refused, loudly, with
// both ids named so the caller can see what it has to group by.
test("fitWeights refuses readings from two champions, naming the ids found", () => {
  const mixed = [
    ...copy(11, W, C11),
    ...copy(22, W, C22, OVER_22).map((r) => ({ ...r, baseTypeId: 7090 })),
  ];
  expect(() => fitWeights(mixed)).toThrow(/power-fit/);
  expect(() => fitWeights(mixed)).toThrow(/999001/);
  expect(() => fitWeights(mixed)).toThrow(/7090/);
  expect(() => fitWeights(mixed)).toThrow(/baseTypeId/);
});

// --- the fit -----------------------------------------------------------------------------------

// Eight readings of one copy, generated from the formula: a baseline plus one step per design
// column. An exact solution exists, so least squares has to land on it.
test("fitWeights recovers known weights and one copy's constant from eight readings", () => {
  const fit = fitWeights(copy(11, W, C11));
  expect(fit.undetermined).toEqual([]);
  for (const name of ["b", "r", "a", "s", "k"]) {
    expect(close(fit.params[name], W[name]), name).toBeLessThan(1e-6);
  }
  expect(fit.constants.size).toBe(1);
  expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
});

// The constants are per COPY, and the two copies here sit at different stat levels as well as
// different constants — so the copy difference is NOT orthogonal to the design columns and a single
// global mean biases every weight. Sixteen readings against seven unknowns, with an exact solution.
test("fitWeights recovers both copies' constants when the copies sit at different stat levels", () => {
  const fit = fitWeights([...copy(11, W, C11), ...copy(22, W, C22, OVER_22)]);
  expect(fit.undetermined).toEqual([]);
  for (const name of ["b", "r", "a", "s", "k"]) {
    expect(close(fit.params[name], W[name]), name).toBeLessThan(1e-6);
  }
  expect(fit.constants.size).toBe(2);
  expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
  expect(close(fit.constants.get(22), C22)).toBeLessThan(1e-6);
});

// --- residuals ---------------------------------------------------------------------------------

// In input order, so a caller can line a residual up with the reading that produced it without
// matching on anything. `predicted` is power() rebuilt from the returned weights and that
// reading's own copy constant — not a number the fit carried along separately.
test("residuals come back one per reading, in input order, rebuilt from the returned values", () => {
  const readings = [...copy(11, W, C11), ...copy(22, W, C22, OVER_22)];
  const fit = fitWeights(readings);
  expect(fit.residuals).toHaveLength(readings.length);
  expect(fit.residuals.map((res) => res.t)).toEqual(readings.map((r) => r.t));
  expect(fit.residuals.map((res) => res.heroId)).toEqual(readings.map((r) => r.heroId));
  fit.residuals.forEach((res, i) => {
    expect(res.power).toBe(readings[i].power);
    const want = power(readings[i].totals, fit.params, fit.constants.get(res.heroId));
    expect(close(res.predicted, want)).toBeLessThan(1e-12);
    expect(close(res.predicted, readings[i].power)).toBeLessThan(1e-9);
  });
});

// The sign convention, pinned by the one case where it is visible. One reading's power is raised
// 5%; sixteen readings against seven unknowns cannot chase a single observation, so the fit lands
// BELOW it — predicted < observed, and errorPct = (predicted - power) / power is negative. A
// flipped subtraction passes every exact-fit test and fails only here.
test("errorPct goes negative for a reading whose power was raised above the fit", () => {
  const readings = [...copy(11, W, C11), ...copy(22, W, C22, OVER_22)];
  const bumped = readings.map((r, i) => (i === 0 ? { ...r, power: r.power * 1.05 } : r));
  const fit = fitWeights(bumped);
  expect(fit.residuals[0].errorPct).toBeLessThan(0);
});

// And it is ~0 everywhere when the readings came out of the formula unaltered.
test("errorPct is about zero across an exactly solvable fit", () => {
  const fit = fitWeights([...copy(11, W, C11), ...copy(22, W, C22, OVER_22)]);
  for (const res of fit.residuals) expect(Math.abs(res.errorPct)).toBeLessThan(1e-6);
});

// --- undetermined parameters -------------------------------------------------------------------

const PRIOR = weightsFor({ baseTypeId: BASE, roleId: ROLE }).weights;
const NO_SPD_STEPS = STEPS.filter((step) => !("SPD" in step));

// SPD is constant within each copy (at a different value per copy), so after the within-copy
// centering its column is exactly zero and its effect is indistinguishable from that copy's
// constant. Fitting `s` to that would be fitting noise, so it comes back null — and the weights the
// solvers will actually use put it at its prior, which is what the constants are measured against.
test("a stat that is constant within every copy leaves its parameter undetermined", () => {
  const w = { ...W, s: PRIOR.s };
  const fit = fitWeights([
    ...copy(11, w, C11, { SPD: 200 }, NO_SPD_STEPS),
    ...copy(22, w, C22, { ...OVER_22, SPD: 260 }, NO_SPD_STEPS),
  ]);
  expect(fit.params.s).toBeNull();
  expect(fit.undetermined).toEqual(["s"]);
  for (const name of ["b", "r", "a", "k"]) {
    expect(close(fit.params[name], w[name]), name).toBeLessThan(1e-6);
  }
  expect(fit.constants.size).toBe(2);
  expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
  expect(close(fit.constants.get(22), C22)).toBeLessThan(1e-6);
});

// The same identity as above, on a fit that HAS an undetermined parameter: `predicted` is power()
// with the undetermined weights at their prior. Rebuilt from `params`, `undetermined` and
// `constants` alone, which is all a caller gets.
test("predicted is power() rebuilt from the returned values, undetermined ones at their prior", () => {
  const w = { ...W, s: PRIOR.s };
  const readings = [
    ...copy(11, w, C11, { SPD: 200 }, NO_SPD_STEPS),
    ...copy(22, w, C22, { ...OVER_22, SPD: 260 }, NO_SPD_STEPS),
  ];
  const fit = fitWeights(readings);
  expect(fit.undetermined).toEqual(["s"]);
  const rebuilt = { ...fit.params };
  for (const name of fit.undetermined) rebuilt[name] = PRIOR[name];
  fit.residuals.forEach((res, i) => {
    const want = power(readings[i].totals, rebuilt, fit.constants.get(res.heroId));
    expect(close(res.predicted, want), res.t).toBeLessThan(1e-12);
  });
});

// Three readings of one copy, with HP, RES and SPD all moving: one copy constant plus three varying
// columns is four unknowns against three equations. The counts are all three named, because which
// one to change is the caller's decision — log more readings, or hold a stat still.
test("fitWeights refuses a fit with fewer readings than unknowns, naming the three counts", () => {
  const few = [
    reading(11, totals(), W, C11, 0),
    reading(11, totals({ HP: 36000 }), W, C11, 1),
    reading(11, totals({ RES: 160, SPD: 240 }), W, C11, 2),
  ];
  expect(() => fitWeights(few)).toThrow(/power-fit/);
  expect(() => fitWeights(few)).toThrow(/readings=3/);
  expect(() => fitWeights(few)).toThrow(/copies=1/);
  expect(() => fitWeights(few)).toThrow(/varying stat columns=3/);
});

// --- dependent columns -------------------------------------------------------------------------

// The same step list with no ACC step: ACC is derived from RES, so the RES step moves both columns.
const LINKED_STEPS = [
  {}, { HP: 36000 }, { ATK: 2600 }, { RES: 160 }, { SPD: 240 }, { "C.RATE": 85 }, { "C.DMG": 220 },
];

// RES and ACC locked in a fixed 2:1 ratio, so the centered ACC column is exactly half the centered
// RES column — a champion geared so that accuracy only ever arrives alongside resistance.
const linkedCopy = (heroId, w, c, over = {}) =>
  LINKED_STEPS.map((step, i) => {
    const stats = totals({ ...over, ...step });
    return reading(heroId, { ...stats, ACC: stats.RES / 2 }, w, c, i);
  });

// ACC sits AFTER RES in the fixed column order and the factorization does not pivot, so RES is kept
// and ACC is dropped — every time, on every machine. With pivoting, which of the two survived would
// follow whichever rounding produced the larger norm.
test("a column that only moves with an earlier one is dropped, and the fixed order picks which", () => {
  const w = { ...W, a: PRIOR.a };
  const fit = fitWeights([...linkedCopy(11, w, C11), ...linkedCopy(22, w, C22, OVER_22)]);
  expect(fit.params.a).toBeNull();
  expect(fit.undetermined).toEqual(["a"]);
  expect(fit.params.r).not.toBeNull();
});

// Nothing non-finite ever leaves the fit: the skip is what keeps back-substitution off a ~0 pivot.
test("every number a rank-deficient power fit returns is finite", () => {
  const w = { ...W, a: PRIOR.a };
  const fit = fitWeights([...linkedCopy(11, w, C11), ...linkedCopy(22, w, C22, OVER_22)]);
  for (const [name, v] of Object.entries(fit.params)) {
    if (v !== null) expect(Number.isFinite(v), name).toBe(true);
  }
  for (const [heroId, c] of fit.constants) expect(Number.isFinite(c), `copy ${heroId}`).toBe(true);
  for (const res of fit.residuals) {
    expect(Number.isFinite(res.predicted), res.t).toBe(true);
    expect(Number.isFinite(res.errorPct), res.t).toBe(true);
  }
});
