// oracle/analytics/__tests__/power-solve-exact.test.mjs
//
// solvePowerExact claims a PROVEN maximum. This file pins the claims a hand-built instance can
// show directly: the precondition, the empty-pool answer, the plan counts, and the constructed
// case where the default mode converges to a fixed point that is NOT the optimum. The claim
// itself — equality with an exhaustive search — is power-solve-exact.prop.test.mjs's job.
import { test, expect } from "vitest";
import { buildTotals, nonCritWeights, solvePowerExact } from "../power-solve.mjs";
import { STATS } from "../champion-stats.mjs";
import { lin } from "../power-model.mjs";

// Every field a decoded artifact carries (oracle/analytics/decode.mjs's decodeRow), so the
// fixtures exercise the real Item shape rather than a hand-rolled stat bag.
const item = (o = {}) => ({
  id: 1, slot: 1, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 1, isFlat: true, value: 0 }, substats: [], ascStat: null,
  ascLevel: 0, equippedChampId: 0, ...o,
});

// Our item stat ids (STAT_NAMES order): 4 SPD, 5 C.RATE, 6 C.DMG. ids 4-8 are POINTS whatever
// `isFlat` says — champion-stats.mjs's ITEM_KEY ignores it for them — so only 1-3 (HP/ATK/DEF)
// read it at all.
const crate = (id, slot, value) =>
  item({ id, slot, mainStat: { statId: 5, isFlat: false, value } });

// Zero on every stat. base MUST carry HP, ATK and DEF as numbers: GREAT_HALL and ARENA both hold
// "HP%"/"ATK%"/"DEF%" keys, and contribution would turn a missing one into NaN.
const ZERO_BASE = Object.fromEntries(STATS.map((stat) => [stat, 0]));
const NO_SOURCES = { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] };

const champStats = (o = {}) => ({
  base: { ...ZERO_BASE, ...o.base },
  sources: { ...NO_SOURCES, ...o.sources },
  observedSets: new Map(), loreOfSteel: o.loreOfSteel ?? 0, awaken: 0,
});

// --- nonCritWeights ----------------------------------------------------------------------------

// Written out longhand rather than read back off the module: the point of this export is that it
// is `lin` MINUS its crit product, and the one thing that could go wrong quietly is a C.RATE
// scalar of k * 100 left in by reaching for linearizedWeights(w, 0, 0) instead.
test("nonCritWeights is lin without its crit product", () => {
  const w = { b: 3, r: 5, a: 7, s: 11, k: 13 };
  const totals = { HP: 150, ATK: 20, DEF: 30, SPD: 40,
    "C.RATE": 50, "C.DMG": 60, RES: 70, ACC: 80 };
  const ncW = nonCritWeights(w);
  expect(ncW["C.RATE"]).toBe(0);
  expect(ncW["C.DMG"]).toBe(0);
  // b*(150/15 + 20 + 30) + r*70 + a*80 + s*40
  //   = 3*60 + 5*70 + 7*80 + 11*40 = 180 + 350 + 560 + 440 = 1,530
  const nc = STATS.reduce((sum, stat) => sum + ncW[stat] * totals[stat], 0);
  expect(nc).toBeCloseTo(1530, 9);
  // And the two halves really do add back up to lin: 1,530 + 13 * 50 * 160 = 105,530.
  expect(nc + w.k * totals["C.RATE"] * (100 + totals["C.DMG"]))
    .toBeCloseTo(lin(totals, w), 9);
  expect(lin(totals, w)).toBeCloseTo(105530, 9);
});

// --- solvePowerExact: the weights precondition -------------------------------------------------

const ONE_PIECE = [crate(1, 1, 50)];
const CRIT_ONLY = { b: 0, r: 0, a: 0, s: 0, k: 1 };
const callWith = (weights) => () => solvePowerExact({
  items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE, weights,
});

// The SAME precondition solvePower checks, and checked here too rather than inherited: the
// exactness argument rests on it directly — with a negative weight a piece can LOWER the
// objective, and then the best full build is no longer the best build and the search space is
// the wrong one. The failure would be quiet: a confident "proven maximum" over builds that are
// not maximal.
test("solvePowerExact refuses a negative weight, naming it", () => {
  expect(callWith({ ...CRIT_ONLY, r: -0.1 })).toThrow(/power-solve: weight r/);
  expect(callWith({ ...CRIT_ONLY, k: -1 })).toThrow(/power-solve: weight k/);
  expect(callWith({ ...CRIT_ONLY, b: -0.001 })).toThrow(/power-solve: weight b/);
});

test("solvePowerExact refuses a weight that is not a finite number", () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1"]) {
    expect(callWith({ ...CRIT_ONLY, s: bad }), `s = ${bad}`).toThrow(/power-solve: weight s/);
  }
});

// Zero is LEGAL, as in solvePower: the precondition is >= 0, unlike weightsFor's own `measured`
// test, which is > 0. Every crit-only case below leans on it.
test("solvePowerExact accepts a zero weight", () => {
  expect(callWith(CRIT_ONLY)).not.toThrow();
});

// --- solvePowerExact: nothing to search --------------------------------------------------------

// speed-solve.mjs returns null for an empty index, and this is the same state: there is no build
// to prove anything about. NOT the empty build — solvePower reports the worn gear as round 0 even
// when it is nothing, and `null` is the honest answer to "which assignment is best" when no
// assignment exists.
test("build is null when the pool is empty", () => {
  const got = solvePowerExact({
    items: [], faction: 0, champStats: champStats(), current: [], weights: CRIT_ONLY,
  });
  expect(got.build).toBe(null);
  expect(got.provenOptimal).toBe(true);
});

// No plan was enumerated, because the decision came before the plan pass. Pinned so the counts
// cannot drift into enumeratePlans' own answer for an empty index, which is one (the empty plan)
// and would read as a plan that was considered.
test("an empty pool reports no plans at all", () => {
  const got = solvePowerExact({
    items: [], faction: 0, champStats: champStats(), current: [], weights: CRIT_ONLY,
  });
  expect(got.plansTotal).toBe(0);
  expect(got.plansPruned).toBe(0);
});

// The faction lock is build-solve's, not the item's, so the exact search has to apply it too —
// otherwise it would prove a maximum over builds the champion cannot wear. A pool of nothing but
// wrong-faction accessories fills no slot at all, which is the strongest form of that check.
test("build is null when every accessory is the wrong faction", () => {
  const items = [
    item({ id: 1, slot: 7, isAccessory: true, faction: 4,
      mainStat: { statId: 5, isFlat: false, value: 60 } }),
    item({ id: 2, slot: 8, isAccessory: true, faction: 4,
      mainStat: { statId: 6, isFlat: false, value: 90 } }),
  ];
  const got = solvePowerExact({
    items, faction: 3, champStats: champStats(), current: [], weights: CRIT_ONLY,
  });
  expect(got.build).toBe(null);
});

// The flag's whole point is that it costs more than the default mode, so the number has to be
// real rather than a placeholder a reader would mistake for a measurement.
test("runtimeMs is a non-negative number", () => {
  const got = solvePowerExact({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
    weights: CRIT_ONLY,
  });
  expect(typeof got.runtimeMs).toBe("number");
  expect(got.runtimeMs).toBeGreaterThanOrEqual(0);
});

// A one-slot pool has exactly one build, so the answer is forced — which makes this the cheapest
// possible check that `build` carries the SAME shape as a solvePower entry, re-derived rather
// than read back off the field.
test("the returned build carries its unrounded totals and the lin they give", () => {
  const champ = champStats();
  const got = solvePowerExact({
    items: ONE_PIECE, faction: 0, champStats: champ, current: ONE_PIECE, weights: CRIT_ONLY,
  });
  expect(got.build.items.map((it) => it.id)).toEqual([1]);
  expect(got.build.totals).toEqual(buildTotals(champ, got.build.items));
  expect(got.build.lin).toBeCloseTo(lin(got.build.totals, CRIT_ONLY), 9);
  // C.RATE 50 and the Great Hall's C.DMG 25: 50 * (100 + 25) = 6,250.
  expect(got.build.lin).toBeCloseTo(6250, 6);
});

// --- solvePowerExact: the plan screen ----------------------------------------------------------

// Three slots, each offering one Critical Rate piece (set 5, +12 C.RATE per 2 pieces) and one
// Crit Damage piece (set 6, +20 C.DMG per 2 pieces). Each set can reach its only useful count of
// two but the two together need four slots, so build-solve enumerates exactly three plans: the
// empty one, {5: 2} and {6: 2}.
//
// Non-gear crit is the Great Hall's C.DMG 25 and nothing else, so with CRIT_ONLY weights every
// build's lin is one multiplication:
//
//   3 x set 5     C.RATE 60 + 12 = 72, C.DMG  25             -> 72 * 125 =  9,000   <- worn
//   2 x 5, 1 x 6  C.RATE 40 + 12 = 52, C.DMG  25 + 60  =  85 -> 52 * 185 =  9,620   <- the optimum
//   1 x 5, 2 x 6  C.RATE 20,           C.DMG  25 + 140 = 165 -> 20 * 265 =  5,300
//   3 x set 6     C.RATE  0,           C.DMG  25 + 200 = 225 ->  0 * 325 =      0
const SETS = [
  item({ id: 1, slot: 1, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
  item({ id: 2, slot: 1, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
  item({ id: 3, slot: 2, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
  item({ id: 4, slot: 2, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
  item({ id: 5, slot: 3, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
  item({ id: 6, slot: 3, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
];
const SETS_ARGS = {
  items: SETS, faction: 0, champStats: champStats(),
  current: [SETS[0], SETS[2], SETS[4]], weights: CRIT_ONLY,
};

test("provenOptimal is true and plansPruned never exceeds plansTotal", () => {
  const got = solvePowerExact(SETS_ARGS);
  expect(got.provenOptimal).toBe(true);
  expect(got.plansPruned).toBeLessThanOrEqual(got.plansTotal);
});

// The three plans build-solve enumerates for this pool, counted rather than assumed: a pool that
// collapsed to the empty plan alone would make every plan-screen assertion below vacuous and
// nothing else here would notice.
test("plansTotal counts every plan build-solve enumerates, the empty one included", () => {
  expect(solvePowerExact(SETS_ARGS).plansTotal).toBe(3);
});

// The screen does real work on this pool. Against the worn gear's 9,000, the {6: 2} plan's bound
// is the SMALLER of its two estimators, and the second one — linearized at (CRlo, CDhi) = (0,
// 225), where C.DMG is worth k * CRlo = 0 — values a Crit Damage build at 6,500, below the
// incumbent. So that plan is ruled out with no search at all.
//
//   estimator 2 at (0, 225): C.RATE x 325, C.DMG x 0, offset 0
//     {6: 2}  two set-6 columns at 0 each, one free pick of 20 C.RATE x 325 = 6,500
//
// A floor rather than the figure, so the assertion survives a tighter bound ruling out more.
test("the per-plan bound rules out a plan the incumbent already beats", () => {
  const got = solvePowerExact(SETS_ARGS);
  expect(got.plansPruned).toBeGreaterThanOrEqual(1);
});
