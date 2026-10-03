// oracle/analytics/__tests__/power-solve-exact.test.mjs
//
// solvePowerExact claims a PROVEN maximum. This file pins the claims a hand-built instance can
// show directly: the precondition, the empty-pool answer, the plan counts, and the constructed
// case where the default mode converges to a fixed point that is NOT the optimum. The claim
// itself — equality with an exhaustive search — is power-solve-exact.prop.test.mjs's job.
import { test, expect } from "vitest";
import { buildTotals, nonCritWeights, solvePower, solvePowerExact } from "../power-solve.mjs";
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
const spd = (id, slot, value) =>
  item({ id, slot, mainStat: { statId: 4, isFlat: true, value } });
const crate = (id, slot, value) =>
  item({ id, slot, mainStat: { statId: 5, isFlat: false, value } });
const cdmg = (id, slot, value) =>
  item({ id, slot, mainStat: { statId: 6, isFlat: false, value } });

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

// The optimum here is MIXED — two Critical Rate and one Crit Damage, at 9,620 — and neither the
// worn three-of-a-kind (9,000) nor either single-set plan reaches it. A search that scored leaves
// on their PLAN rather than on their actual set counts would miss the +12 the two Critical Rate
// pieces earn when the third slot went elsewhere, and would answer 9,000 while looking healthy.
test("the exact search scores leaves on their actual set counts", () => {
  const got = solvePowerExact(SETS_ARGS);
  expect(got.build.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([1, 3, 6]);
  expect(got.build.lin).toBeCloseTo(9620, 6);
  expect(got.build.lin).toBeGreaterThan(solvePower(SETS_ARGS).builds[0].lin);
});

// --- solvePowerExact: a fixed point that is not the optimum ------------------------------------

// SPD AND CRIT, because a crit-only pool cannot produce this case at all. Write
// f(CR, CD) = k * CR * (100 + CD); then f(Q) = tangent_P(Q) + k * dCR * dCD, and a fixed point
// means tangent_P(Q) <= f(P) for every Q, so beating P needs dCR * dCD > 0 — both totals up,
// which positive linear weights would already have preferred, or both down, which makes both
// factors smaller. Either way impossible. The gap opens only once a NON-CRIT weight is in play,
// because then a build can buy crit on BOTH axes by giving up non-crit value, which the
// linearization at a low-crit reference prices at almost nothing.
const SPD_AND_CRIT = { b: 0, r: 0, a: 0, s: 1, k: 1 };

// Two slots. Each offers a pure-SPD piece or a pure-crit one, and nothing in between. Non-gear
// crit is the Great Hall's C.DMG 25; non-gear SPD is zero. lin = SPD + C.RATE * (100 + C.DMG).
//
//   worn  {1, 3}  SPD 210, C.RATE 0, C.DMG  25   true 210 +   0 * 125 =   210
//         {1, 4}  SPD 200, C.RATE 0, C.DMG 325   true 200 +   0 * 425 =   200
//         {2, 3}  SPD  10, C.RATE 1, C.DMG  25   true  10 +   1 * 125 =   135
//   best  {2, 4}  SPD   0, C.RATE 1, C.DMG 325   true   0 +   1 * 425 =   425
//
// Round 1 linearizes at the worn build's own crit, (C.RATE 0, C.DMG 25), which prices SPD at 1,
// C.RATE at k * (100 + 25) = 125 and C.DMG at k * C.RATE = 0 — the champion has no crit rate, so
// crit damage is worth literally nothing to it:
//
//   slot 1   SPD 200 -> 200   vs   C.RATE 1 -> 125     keeps the SPD piece
//   slot 2   SPD  10 ->  10   vs   C.DMG 300 ->   0    keeps the SPD piece
//
// so round 1 returns the worn build itself: a FIXED POINT, at 210 against a true optimum of 425.
const TRAP = [spd(1, 1, 200), crate(2, 1, 1), spd(3, 2, 10), cdmg(4, 2, 300)];
const TRAP_ARGS = {
  items: TRAP, faction: 0, champStats: champStats(),
  current: [TRAP[0], TRAP[2]], weights: SPD_AND_CRIT,
};

// The fixture is only a trap while solvePower really does converge on it. Pinned here, so a
// change to the default mode that escapes this pool fails THIS test rather than quietly turning
// the one below into a test of nothing.
test("solvePower converges to this pool's fixed point, which is not its optimum", () => {
  const got = solvePower(TRAP_ARGS);
  expect(got.converged).toBe(true);
  expect(got.rounds).toBe(1);
  expect(got.builds[0].items.map((it) => it.id).sort((a, b) => a - b)).toEqual([1, 3]);
  expect(got.builds[0].lin).toBeCloseTo(210, 6);
});

test("the exact search finds the build the fixed point missed", () => {
  const got = solvePowerExact(TRAP_ARGS);
  expect(got.build.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([2, 4]);
  expect(got.build.lin).toBeCloseTo(425, 6);
  expect(got.provenOptimal).toBe(true);
});

// Stated as a comparison rather than as two numbers, because that is the claim the mode exists to
// make: whatever the default mode found, the exact search is never below it.
test("the exact answer beats the default mode's on the same pool", () => {
  expect(solvePowerExact(TRAP_ARGS).build.lin)
    .toBeGreaterThan(solvePower(TRAP_ARGS).builds[0].lin);
});
