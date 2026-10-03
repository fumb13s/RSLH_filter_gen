// oracle/analytics/__tests__/power-model.test.mjs
import { test, expect } from "vitest";
import { ALL_DEFAULTS, BUILT_IN, constantFrom, lin, power, ROLE_DEFAULTS, weightsFor }
  from "../power-model.mjs";

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

// --- the weight tables -------------------------------------------------------------------------

const PARAMS = ["b", "r", "a", "s", "k"];

// The invariant weightsFor leans on: between them these two tables supply all five parameters, so
// the fallback chain always terminates in five positive weights however little is known about a
// champion. Lose this and weightsFor starts returning undefined weights, which lin turns into NaN.
test("ROLE_DEFAULTS and ALL_DEFAULTS together cover all five parameters for every role", () => {
  expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual(["0", "1", "2", "3"]);
  for (const roleId of Object.keys(ROLE_DEFAULTS)) {
    for (const name of PARAMS) {
      const v = ROLE_DEFAULTS[roleId][name] ?? ALL_DEFAULTS[name];
      expect(Number.isFinite(v) && v > 0).toBe(true);
    }
  }
});

// Every weight measured so far is positive, and the solvers that will consume them need
// non-negative weights. A zero or a negative in a committed table would be a transcription slip.
test("every weight in every table is a finite positive number", () => {
  const tables = [...Object.values(BUILT_IN), ...Object.values(ROLE_DEFAULTS), ALL_DEFAULTS];
  for (const table of tables) {
    for (const name of PARAMS) {
      if (table[name] === undefined) continue;   // partial rows are legitimate; see Helicath
      expect(Number.isFinite(table[name]) && table[name] > 0).toBe(true);
    }
  }
});

// A BUILT_IN row whose roleId the defaults do not know could never be filled in, and weightsFor
// would throw for a champion we have actually measured.
test("every BUILT_IN roleId is a key of ROLE_DEFAULTS", () => {
  for (const [id, row] of Object.entries(BUILT_IN)) {
    expect(ROLE_DEFAULTS[row.roleId], `baseTypeId ${id}`).toBeDefined();
  }
});

// Helicath's b, r and a were never measured. The built-in precedence test below depends on their
// being ABSENT rather than guessed, so pin that rather than let a later edit quietly fill them.
test("Helicath's BUILT_IN row is partial: s and k only", () => {
  expect(BUILT_IN[7200].s).toBeGreaterThan(0);
  expect(BUILT_IN[7200].k).toBeGreaterThan(0);
  expect(BUILT_IN[7200].b).toBeUndefined();
  expect(BUILT_IN[7200].r).toBeUndefined();
  expect(BUILT_IN[7200].a).toBeUndefined();
});

// The one role pattern the measurements showed: b and r split Defense (roleId 1) from the other
// three, which is the whole reason ROLE_DEFAULTS is keyed by role at all.
test("the Defense role defaults carry a higher b and a lower r than every other role", () => {
  for (const roleId of [0, 2, 3]) {
    expect(ROLE_DEFAULTS[1].b).toBeGreaterThan(ROLE_DEFAULTS[roleId].b);
    expect(ROLE_DEFAULTS[1].r).toBeLessThan(ROLE_DEFAULTS[roleId].r);
  }
});

// --- weightsFor precedence ---------------------------------------------------------------------

const FITTED = { b: 0.02, r: 0.3, a: 0.05, s: 0.01, k: 0.002 };

test("weightsFor prefers a full fitted table over everything else", () => {
  const got = weightsFor({ baseTypeId: 7090, roleId: 1 }, { 7090: FITTED });
  expect(got.weights).toEqual(FITTED);
  expect(got.source).toBe("fitted");
  expect(got.fromDefaults).toEqual([]);
});

// Helicath's row supplies s and k only, so b and r come off the role table and a off the
// all-champion means — and the source is still "built-in", because a built-in row DID answer.
test("weightsFor fills a partial built-in row from the role and all-champion defaults", () => {
  const got = weightsFor({ baseTypeId: 7200, roleId: 1 });
  expect(got.source).toBe("built-in");
  expect(got.fromDefaults).toEqual(["b", "r", "a"]);
  expect(got.weights.s).toBe(BUILT_IN[7200].s);
  expect(got.weights.k).toBe(BUILT_IN[7200].k);
  expect(got.weights.b).toBe(ROLE_DEFAULTS[1].b);
  expect(got.weights.r).toBe(ROLE_DEFAULTS[1].r);
  expect(got.weights.a).toBe(ALL_DEFAULTS.a);
});

// A champion in no table at all: every parameter is a default, and the two with no role pattern
// come from ALL_DEFAULTS.
test("weightsFor falls back to the role defaults for a champion in no table", () => {
  const got = weightsFor({ baseTypeId: 999999, roleId: 0 });
  expect(got.source).toBe("role default");
  expect(got.fromDefaults).toEqual(["b", "r", "a", "s", "k"]);
  expect(got.weights).toEqual({ ...ROLE_DEFAULTS[0], ...ALL_DEFAULTS });
});

// A fit determines some parameters and not others, and returns null for the rest. The null falls
// through on its own while the four real values stand — which is the point of resolving per
// parameter rather than picking one table.
test("weightsFor falls back per parameter for a null in an otherwise fitted row", () => {
  const got = weightsFor({ baseTypeId: 7200, roleId: 1 }, { 7200: { ...FITTED, s: null } });
  expect(got.source).toBe("fitted");
  expect(got.weights.b).toBe(FITTED.b);
  expect(got.weights.s).toBe(BUILT_IN[7200].s);
  expect(got.fromDefaults).toEqual([]);
});

// A weakly measured stat can come back zero or negative from least squares, and a broken fit can
// come back NaN. None of those is a measurement, so each falls through exactly as the null does.
test("weightsFor skips a fitted value that is not a finite positive number", () => {
  for (const bad of [NaN, 0, -0.01, Infinity, undefined]) {
    const got = weightsFor({ baseTypeId: 7200, roleId: 1 }, { 7200: { ...FITTED, s: bad } });
    expect(got.weights.s, `fitted s = ${bad}`).toBe(BUILT_IN[7200].s);
  }
});
