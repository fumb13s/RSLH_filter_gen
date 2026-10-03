// oracle/analytics/__tests__/power-solve.test.mjs
import { test, expect } from "vitest";
import {
  buildTotals, itemVector, linearizedWeights, nonGearTotals, setVectors, solvePower,
} from "../power-solve.mjs";
import { STATS, statBreakdown } from "../champion-stats.mjs";
import { lin } from "../power-model.mjs";
import { SET_BONUSES as SET_BONUSES_IDS } from "../set-bonuses.mjs";

// Every field a decoded artifact carries (oracle/analytics/decode.mjs's decodeRow), so the
// fixtures exercise the real Item shape rather than a hand-rolled stat bag.
const item = (o = {}) => ({
  id: 1, slot: 1, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 1, isFlat: true, value: 0 }, substats: [], ascStat: null,
  ascLevel: 0, equippedChampId: 0, ...o,
});

const sub = (statId, value, isFlat = false) => ({ statId, isFlat, rolls: 0, value, glyph: 0 });

// A crit piece as the game rolls one: C.RATE and C.DMG in percentage POINTS. statId 5 is C.RATE
// and 6 is C.DMG in OUR item id space (STAT_NAMES order), NOT the statKindId space where 5 is
// RES and 7 is C.RATE.
const crit = (id, slot, cr, cd) => item({
  id, slot,
  mainStat: { statId: 5, isFlat: false, value: cr },
  substats: cd ? [sub(6, cd)] : [],
});

// Zero on every stat. base MUST carry HP, ATK and DEF as numbers: GREAT_HALL and ARENA both hold
// "HP%"/"ATK%"/"DEF%" keys, and contribution would turn a missing one into NaN.
const ZERO_BASE = Object.fromEntries(STATS.map((stat) => [stat, 0]));
const NO_SOURCES = { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] };

const champStats = (o = {}) => ({
  base: { ...ZERO_BASE, ...o.base },
  sources: { ...NO_SOURCES, ...o.sources },
  observedSets: new Map(), loreOfSteel: o.loreOfSteel ?? 0, awaken: 0,
});

// k alone. Every other weight is zero, so lin collapses to C.RATE * (100 + C.DMG) and every
// expected number below is one multiplication a reader can check. A zero weight is LEGAL here —
// the precondition is >= 0, unlike weightsFor's own `measured` test, which is > 0.
const CRIT_ONLY = { b: 0, r: 0, a: 0, s: 0, k: 1 };

// --- linearizedWeights -------------------------------------------------------------------------

// Written out longhand rather than read back off the module, so a swapped crRef/cdRef names
// itself. The crit row is the whole point: C.RATE carries k * (100 + cdRef) and C.DMG carries
// k * crRef, so the two references are NOT interchangeable.
test("linearizedWeights spreads the five weights over the eight stats", () => {
  const w = { b: 0.012, r: 0.28, a: 0.039, s: 0.022, k: 0.0015 };
  expect(linearizedWeights(w, 60, 150)).toEqual({
    HP: 0.012 / 15,
    ATK: 0.012,
    DEF: 0.012,
    SPD: 0.022,
    "C.RATE": 0.0015 * 250,
    "C.DMG": 0.0015 * 60,
    RES: 0.28,
    ACC: 0.039,
  });
});

// A missing key would make the dot product NaN, and a NaN score sorts below everything and is
// silently never returned rather than failing.
test("linearizedWeights is keyed by exactly the eight stats", () => {
  const got = linearizedWeights({ b: 1, r: 1, a: 1, s: 1, k: 1 }, 0, 0);
  expect(Object.keys(got).sort()).toEqual([...STATS].sort());
});

// --- itemVector --------------------------------------------------------------------------------

test("itemVector sums the piece's main stat, substats and ascension stat", () => {
  const piece = item({
    mainStat: { statId: 2, isFlat: true, value: 150 },
    substats: [sub(4, 10, true), sub(5, 20)],
    ascStat: { statId: 6, isFlat: false, value: 12 },
  });
  const got = itemVector(piece, ZERO_BASE);
  expect(got.ATK).toBe(150);
  expect(got.SPD).toBe(10);
  expect(got["C.RATE"]).toBe(20);
  expect(got["C.DMG"]).toBe(12);
  expect(got.HP).toBe(0);
});

// A percent main stat is a percentage of the champion's BASE, so the same piece is worth a
// different amount on a different champion. Reading it as a flat value would pass with a zero base.
test("itemVector scales a percent stat against the champion's base", () => {
  const piece = item({ mainStat: { statId: 2, isFlat: false, value: 60 } });
  expect(itemVector(piece, { ...ZERO_BASE, ATK: 1000 }).ATK).toBeCloseTo(600, 9);
});

// The glyph is ADDITIVE: substat.value does not already include it.
test("itemVector adds a substat's glyph to its value", () => {
  const piece = item({ substats: [{ statId: 4, isFlat: true, rolls: 0, value: 10, glyph: 5 }] });
  expect(itemVector(piece, ZERO_BASE).SPD).toBe(15);
});

test("itemVector is keyed by all eight stats", () => {
  expect(Object.keys(itemVector(item(), ZERO_BASE)).sort()).toEqual([...STATS].sort());
});

// --- setVectors --------------------------------------------------------------------------------

// Set 1 is Life, "HP%" 15 per 2-piece completion, so the vector is base-relative: a 20,000 HP
// champion earns 3,000 HP per completion, not 15. One piece completes nothing.
test("setVectors turns a percent key into an amount relative to the champion's base", () => {
  const vectors = setVectors(1, { ...ZERO_BASE, HP: 20000 }, 0);
  expect(vectors[0].HP).toBe(0);
  expect(vectors[1].HP).toBe(0);
  expect(vectors[2].HP).toBeCloseTo(3000, 9);
  expect(vectors[4].HP).toBeCloseTo(6000, 9);
});

// C.RATE and C.DMG are percentage POINTS and carry no "%" suffix, so set 5 (Crit Rate, +12 per
// 2-piece completion) adds 12 points however large the champion's base crit rate is. Reading it
// as a percent key would give 12% of 15 — 1.8 — which is wrong and plausible-looking.
test("setVectors adds a crit key as points rather than a percentage of base crit", () => {
  expect(setVectors(5, { ...ZERO_BASE, "C.RATE": 15 }, 0)[2]["C.RATE"]).toBeCloseTo(12, 9);
});

// Lore of Steel scales EVERY set's bonus, once. Applying it twice is the quiet failure this
// pins: 12 * 1.15 is 13.8 and 12 * 1.15 * 1.15 is 15.87, and neither looks wrong on its own.
test("setVectors applies Lore of Steel exactly once", () => {
  expect(setVectors(5, ZERO_BASE, 0.15)[2]["C.RATE"]).toBeCloseTo(13.8, 9);
  expect(setVectors(5, ZERO_BASE, 0.15)[4]["C.RATE"]).toBeCloseTo(27.6, 9);
});

// A tiered set's FIRST tier can be a single piece — set 60 is Slayer, C.RATE +5 off one piece —
// which is the shape most easily assumed away, and the reason build-solve has singleton columns.
test("setVectors credits a one-piece tier at one piece", () => {
  expect(setVectors(60, ZERO_BASE, 0)[1]["C.RATE"]).toBeCloseTo(5, 9);
});

// Ten entries, zero at zero pieces: build-solve's checkBonusAt rejects anything else, and a
// nine-entry array would read bonus[9] as undefined and poison the score into NaN.
test("setVectors is a ten-entry array that is zero at zero pieces", () => {
  const vectors = setVectors(60, ZERO_BASE, 0);
  expect(vectors).toHaveLength(10);
  expect(vectors[0]).toEqual(ZERO_BASE);
});

// The precondition build-solve leans on, checked against the real table rather than assumed.
test("every set's vectors are non-decreasing in piece count on every stat", () => {
  for (const setId of Object.keys(SET_BONUSES_IDS)) {
    const vectors = setVectors(Number(setId), { ...ZERO_BASE, HP: 20000, SPD: 100 }, 0.15);
    for (let n = 1; n < vectors.length; n++) {
      for (const stat of STATS) {
        expect(vectors[n][stat], `set ${setId} stat ${stat} at ${n}`)
          .toBeGreaterThanOrEqual(vectors[n - 1][stat]);
      }
    }
  }
});

// --- nonGearTotals -----------------------------------------------------------------------------

// The Great Hall's C.DMG +25 is the whole of a zero-base champion's non-gear crit, and every crit
// case further down is built around it. Classic Arena grants no crit at all.
test("nonGearTotals carries the Great Hall's crit, resistance and accuracy", () => {
  const got = nonGearTotals(champStats());
  expect(got["C.DMG"]).toBeCloseTo(25, 9);
  expect(got["C.RATE"]).toBe(0);
  expect(got.RES).toBeCloseTo(80, 9);
  expect(got.ACC).toBeCloseTo(80, 9);
});

// Base plus 20% Great Hall plus 22% Classic Arena on HP, and the two flat per-source bonuses
// landing on their own stats.
test("nonGearTotals sums the champion's base with every per-source bonus", () => {
  const got = nonGearTotals(champStats({
    base: { HP: 20000, SPD: 100 },
    sources: { blessing: [["SPD", 7]], relic: [["ACC", 50]] },
  }));
  expect(got.HP).toBeCloseTo(20000 + 4000 + 4400, 9);
  expect(got.SPD).toBeCloseTo(107, 9);
  expect(got.ACC).toBeCloseTo(80 + 50, 9);
});

// No gear means no set bonus, so Lore of Steel has nothing to scale and must not appear.
test("nonGearTotals is unaffected by Lore of Steel", () => {
  const withMastery = nonGearTotals(champStats({ base: { HP: 20000 }, loreOfSteel: 0.15 }));
  const without = nonGearTotals(champStats({ base: { HP: 20000 } }));
  expect(withMastery).toEqual(without);
});

// --- buildTotals -------------------------------------------------------------------------------

// The stat model's columns summed WITHOUT rounding — deliberately not statBreakdown().totals,
// which rounds each column to reproduce the game's screen. This is the independent second
// implementation buildTotals is checked against.
const summedColumns = (stats, items) => {
  const { columns } = statBreakdown(stats, items);
  return Object.fromEntries(STATS.map((stat) =>
    [stat, columns.reduce((sum, [, v]) => sum + v[stat], 0)]));
};

// Two Offense pieces (set 2, a 2-piece stacker) and one Stone Skin (set 48, whose FIRST tier is a
// single piece), so both set mechanics are in play at once.
const GEAR = [
  item({ id: 1, slot: 1, set: 2, mainStat: { statId: 1, isFlat: true, value: 1000 } }),
  item({ id: 2, slot: 2, set: 2, mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 10, true)] }),
  item({ id: 3, slot: 3, set: 48, mainStat: { statId: 5, isFlat: false, value: 20 },
    ascStat: { statId: 6, isFlat: false, value: 12 } }),
];

const WORN_STATS = champStats({
  base: { HP: 20000, ATK: 1500, DEF: 1200, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30 },
  sources: { mastery: [["ATK%", 5], ["C.RATE", 5]], blessing: [["SPD", 7]] },
  loreOfSteel: 0.15,
});

// LORE OF STEEL AT 0.15 is the case that matters. The stat model splits a set's bonus across the
// Artifacts column and the Masteries column, and buildTotals has to land on the same number from
// a single (1 + 0.15) scaling applied per set. A champion with the mastery OFF would pass this
// with the scaling missing altogether.
//
// toBeCloseTo, not toBe: the two sum the same terms in different orders, so they agree
// mathematically and can differ in the last bits.
test("buildTotals equals the stat model's columns summed unrounded, with Lore of Steel", () => {
  const got = buildTotals(WORN_STATS, GEAR);
  const want = summedColumns(WORN_STATS, GEAR);
  for (const stat of STATS) expect(got[stat], stat).toBeCloseTo(want[stat], 9);
});

test("buildTotals equals the stat model's columns summed unrounded, without Lore of Steel", () => {
  const none = champStats({ base: WORN_STATS.base, sources: WORN_STATS.sources });
  const got = buildTotals(none, GEAR);
  const want = summedColumns(none, GEAR);
  for (const stat of STATS) expect(got[stat], stat).toBeCloseTo(want[stat], 9);
});

test("buildTotals with no items is nonGearTotals", () => {
  expect(buildTotals(WORN_STATS, [])).toEqual(nonGearTotals(WORN_STATS));
});

// --- solvePower: the weights precondition ------------------------------------------------------

const ONE_PIECE = [crit(1, 1, 50, 0)];
const callWith = (weights) => () => solvePower({
  items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE, weights,
});

// Both consequences are quiet rather than loud. A negative per-stat scalar makes a set's bonus
// DECREASE with more pieces, which build-solve rejects for one weight and silently mis-solves
// for another; and the McCormick estimators are upper bounds only for k >= 0, so a negative k
// turns the certificate into a confident wrong number.
test("solvePower refuses a negative weight, naming it", () => {
  expect(callWith({ ...CRIT_ONLY, r: -0.1 })).toThrow(/power-solve: weight r/);
  expect(callWith({ ...CRIT_ONLY, k: -1 })).toThrow(/power-solve: weight k/);
  expect(callWith({ ...CRIT_ONLY, b: -0.001 })).toThrow(/power-solve: weight b/);
});

// A least-squares fit can return null for a weight it could not determine and NaN from a broken
// one. Neither is a measurement, and lin turns either into NaN, which sorts below everything and
// is silently never returned rather than failing.
test("solvePower refuses a weight that is not a finite number", () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1"]) {
    expect(callWith({ ...CRIT_ONLY, s: bad }), `s = ${bad}`).toThrow(/power-solve: weight s/);
  }
});

// Zero is LEGAL, unlike weightsFor's own `measured` test which requires > 0. Every crit case in
// this file leans on it: k alone, with b, r, a and s all zero.
test("solvePower accepts a zero weight", () => {
  expect(callWith(CRIT_ONLY)).not.toThrow();
});

// --- solvePower: round 0, the gear already worn ------------------------------------------------

// With a zero base the only crit a build has that did not come off gear is GREAT_HALL's C.DMG 25.
// A worn C.RATE 50 piece therefore gives C.RATE 50, C.DMG 25 and lin = 50 * (100 + 25) = 6,250.
test("the worn gear is scored on the true objective and reported", () => {
  const got = solvePower({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
    weights: CRIT_ONLY, maxRounds: 0,
  });
  expect(got.builds).toHaveLength(1);
  expect(got.builds[0].items.map((it) => it.id)).toEqual([1]);
  expect(got.builds[0].lin).toBeCloseTo(6250, 6);
});

// The totals are the UNROUNDED build totals, and `lin` is that vector through power-model's own
// formula — so a caller can re-derive the score rather than take the field on trust.
test("each build carries its unrounded totals alongside its lin", () => {
  const got = solvePower({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
    weights: CRIT_ONLY, maxRounds: 0,
  });
  expect(got.builds[0].totals["C.RATE"]).toBeCloseTo(50, 9);
  expect(got.builds[0].totals["C.DMG"]).toBeCloseTo(25, 9);
  expect(got.builds[0].lin).toBeCloseTo(lin(got.builds[0].totals, CRIT_ONLY), 9);
});

// An empty slot is a real state — a copy can be wearing nothing — and the worn "build" is then
// the non-gear totals alone.
test("an empty worn build is still round 0", () => {
  const got = solvePower({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: [],
    weights: CRIT_ONLY, maxRounds: 0,
  });
  expect(got.builds[0].items).toEqual([]);
  expect(got.builds[0].lin).toBe(0);   // C.RATE 0, so the crit term is 0 whatever C.DMG is
});

// --- solvePower: convergence -------------------------------------------------------------------

// Linearizing at the worn gear picks a build WORSE than what is worn — C.DMG 400 with no crit
// rate at all scores zero — and only the next round's reference makes the crit-heavy optimum the
// best linear pick. One slot and three setless pieces, so nothing but the crit term is in play.
//
//   non-gear crit: C.RATE 0, C.DMG 25 (the Great Hall)
//   worn  id 1  C.RATE 20              true 20 * (100 +  25) =  2,500
//   lure  id 2  C.DMG 400              true  0 * (100 + 425) =      0
//   best  id 3  C.RATE 30, C.DMG 150   true 30 * (100 + 175) =  8,250
//
//   round 1 at (20,  25): C.RATE x 125, C.DMG x 20 -> lure 8,000 > best 6,750 > worn 2,500
//   round 2 at ( 0, 425): C.RATE x 525, C.DMG x  0 -> best 15,750 > worn 10,500 > lure 0
//   round 3 at (30, 175): C.RATE x 275, C.DMG x 30 -> best 12,750 > lure 12,000 > worn 5,500
//                         best repeats round 2's build: a FIXED POINT.
const CONVERGE = [crit(1, 1, 20, 0), crit(2, 1, 0, 400), crit(3, 1, 30, 150)];
const CONVERGE_ARGS = {
  items: CONVERGE, faction: 0, champStats: champStats(),
  current: [CONVERGE[0]], weights: CRIT_ONLY,
};

// rounds > 1 is the assertion that matters: a solver that linearized ONCE around the worn gear
// would stop at the lure and report a build worth nothing.
test("the iteration walks off a low-crit linear pick onto the crit-heavy optimum", () => {
  const got = solvePower(CONVERGE_ARGS);
  expect(got.converged).toBe(true);
  expect(got.rounds).toBe(3);
  expect(got.builds[0].items.map((it) => it.id)).toEqual([3]);
  expect(got.builds[0].lin).toBeCloseTo(8250, 6);
});

// --- solvePower: a cycle -----------------------------------------------------------------------

// Two slots, each offering a C.RATE 50 piece or a C.DMG 150 piece and nothing else. The
// linearization alternates between the two corners and never looks at the mixed build, which is
// the actual optimum. Built from ordinary items — no injected valuation is needed to produce it.
//
//   worn (both C.RATE)  C.RATE 100, C.DMG  25  true 100 * 125 = 12,500
//   both C.DMG          C.RATE   0, C.DMG 325  true   0 * 425 =      0
//   one of each         C.RATE  50, C.DMG 175  true  50 * 275 = 13,750  <- never reached
//
//   round 1 at (100,  25): C.RATE x 125, C.DMG x 100 -> per slot 15,000 > 6,250, so both C.DMG
//   round 2 at (  0, 325): C.RATE x 425, C.DMG x   0 -> per slot 21,250 > 0, so both C.RATE,
//                          which is ROUND 0's build — a cycle, and no fixed point exists.
const CYCLE = [
  crit(1, 1, 50, 0), crit(2, 1, 0, 150),
  crit(3, 2, 50, 0), crit(4, 2, 0, 150),
];
const CYCLE_ARGS = {
  items: CYCLE, faction: 0, champStats: champStats(),
  current: [CYCLE[0], CYCLE[2]], weights: CRIT_ONLY,
};
const idsOf = (build) => build.items.map((it) => it.id).sort((a, b) => a - b);

test("a cycle stops the iteration and is reported as not converged", () => {
  const got = solvePower(CYCLE_ARGS);
  expect(got.converged).toBe(false);
  expect(got.rounds).toBe(2);
});

// The answer is below the true optimum, and that is the point: this mode is a fixed-point search,
// not a proof. A solver claiming optimality here would be claiming 12,500 is the best of a pool
// whose best is 13,750.
test("a cycle still returns the best build it saw", () => {
  const got = solvePower(CYCLE_ARGS);
  expect(idsOf(got.builds[0])).toEqual([1, 3]);
  expect(got.builds[0].lin).toBeCloseTo(12500, 6);
  expect(got.builds[0].lin).toBeLessThan(13750);
});

// --- solvePower: maxRounds ---------------------------------------------------------------------
//
// Both of these are REGRESSION LOCKS on the loop bound being read from the parameter, not new
// behaviour: the bound has read `maxRounds` since the loop was introduced, because the round-0
// tests above pass `maxRounds: 0` and would otherwise have a round run underneath them. They are
// here because a bound quietly hardcoded back to a literal is invisible to every other test in
// this file.

// Cut the cycle off before it closes. One round runs, nothing has repeated yet, so there is no
// fixed point to claim.
test("maxRounds stops the iteration and leaves converged false", () => {
  const got = solvePower({ ...CYCLE_ARGS, maxRounds: 1 });
  expect(got.rounds).toBe(1);
  expect(got.converged).toBe(false);
});

// Zero rounds is a legal request — it reports the worn gear and nothing else, which is what the
// round-0 tests above use.
test("maxRounds of zero runs no round at all", () => {
  const got = solvePower({ ...CYCLE_ARGS, maxRounds: 0 });
  expect(got.rounds).toBe(0);
  expect(got.converged).toBe(false);
});

// Cutting the cycle off mid-flight must still answer from the POOL, not from the round that
// happened to be last: round 1's own pick is the all-C.DMG build worth nothing.
test("maxRounds still answers from the whole pool", () => {
  const got = solvePower({ ...CYCLE_ARGS, maxRounds: 1 });
  expect(idsOf(got.builds[0])).toEqual([1, 3]);
  expect(got.builds[0].lin).toBeCloseTo(12500, 6);
});

// --- solvePower: never worse than the gear already worn ---------------------------------------

// A cycle every member of which is WORSE than what is worn. Without round 0 in the pool the
// answer is C.RATE 60 at 7,500 — a downgrade, reported as a result. Same weights and same
// non-gear crit as the cycle case above.
//
//   worn   id 1  C.RATE 50, C.DMG 50  true 50 * (100 +  75) = 8,750
//   lure   id 2  C.DMG 300            true  0 * (100 + 325) =     0
//   second id 3  C.RATE 60            true 60 * (100 +  25) = 7,500
//
//   round 1 at (50,  75): C.RATE x 175, C.DMG x 50 -> lure 15,000 > worn 11,250 > second 10,500
//   round 2 at ( 0, 325): C.RATE x 425, C.DMG x  0 -> second 25,500 > worn 21,250 > lure 0
//   round 3 at (60,  25): C.RATE x 125, C.DMG x 60 -> lure 18,000 > worn 9,250 > second 7,500
//                         lure is ROUND 1's build, so this is a cycle whose own best is 7,500.
const BELOW_WORN = [crit(1, 1, 50, 50), crit(2, 1, 0, 300), crit(3, 1, 60, 0)];

test("the answer is never worse than the worn gear, even when every round is", () => {
  const got = solvePower({
    items: BELOW_WORN, faction: 0, champStats: champStats(),
    current: [BELOW_WORN[0]], weights: CRIT_ONLY,
  });
  expect(got.converged).toBe(false);
  expect(got.rounds).toBe(3);
  expect(got.builds[0].items.map((it) => it.id)).toEqual([1]);
  expect(got.builds[0].lin).toBeCloseTo(8750, 6);
});

// --- solvePower: top --------------------------------------------------------------------------

// The POOL is what `top` ranks, not one round's output. buildIndex keeps only the best piece of
// each set in each slot, so a one-slot pool of three setless pieces offers the solver exactly one
// build per round — all three entries below were found in three DIFFERENT rounds.
test("top greater than one returns distinct builds from the whole pool, best first", () => {
  const got = solvePower({ ...CONVERGE_ARGS, top: 3 });
  expect(got.builds.map((b) => b.items.map((it) => it.id))).toEqual([[3], [1], [2]]);
  expect(got.builds.map((b) => Math.round(b.lin))).toEqual([8250, 2500, 0]);
});

test("top caps the number of builds returned", () => {
  const got = solvePower({ ...CONVERGE_ARGS, top: 2 });
  expect(got.builds).toHaveLength(2);
  expect(got.builds[0].items.map((it) => it.id)).toEqual([3]);
});

// Entries are distinct SETS of items, so a build two rounds both reached is listed once.
test("top does not list the same set of items twice", () => {
  const got = solvePower({ ...CONVERGE_ARGS, top: 9 });
  const keys = got.builds.map((b) => b.items.map((it) => it.id).sort((a, c) => a - c).join(","));
  expect(new Set(keys).size).toBe(keys.length);
});

// The default is one build, and `top` can never shrink the answer to nothing.
test("top defaults to one build", () => {
  expect(solvePower(CONVERGE_ARGS).builds).toHaveLength(1);
});

// --- solvePower: the certificate ---------------------------------------------------------------

// The box is the non-gear crit plus the most any assignment of the pool can ADD, each found by
// one exact solve weighting that stat alone. On the cycle pool the most gear can add is C.RATE
// 100 and C.DMG 300, so the box is C.RATE 0..100 and C.DMG 25..325, giving Dlo = 125 and
// Dhi = 425. The two estimators then maximise to
//
//   UB_1 at (crRef, cdRef) = (CRhi, CDlo) = (100,  25)
//     non-gear   125 * 0 + 100 *  25 =  2,500
//     best gear  per slot max(50 * 125, 150 * 100) = 15,000, twice = 30,000
//     constant   -k * CRhi * CDlo = -100 * 25 = -2,500
//     UB_1 = 2,500 + 30,000 - 2,500 = 30,000
//
//   UB_2 at (crRef, cdRef) = (CRlo, CDhi) = (  0, 325)
//     non-gear   425 * 0 + 0 * 25 = 0
//     best gear  per slot max(50 * 425, 150 * 0) = 21,250, twice = 42,500
//     constant   -k * CRlo * CDhi = 0
//     UB_2 = 42,500
//
// and the bound is the smaller. Loose by design: a pool whose crit can swing that far is exactly
// the case the provably exact mode exists for.
test("the certificate is the smaller of the two McCormick bounds", () => {
  const got = solvePower(CYCLE_ARGS);
  expect(got.upperBound).toBeCloseTo(30000, 6);
  expect(got.gap).toBeCloseTo(30000 - 12500, 6);
});

// The bound has to hold over EVERY assignment, including the mixed build the iteration never
// reaches. A bound that only covered the builds the rounds happened to visit would certify
// nothing.
test("the bound covers the true optimum the iteration never reached", () => {
  expect(solvePower(CYCLE_ARGS).upperBound).toBeGreaterThanOrEqual(13750);
});

// When the pool cannot move crit at all the box collapses to a point, both estimators become
// exact, and the bound is the build's own value. This is the degenerate case the algebra has to
// survive rather than divide by a zero-width box.
test("a pool with no crit to gain certifies a zero gap", () => {
  const flat = [item({ id: 1, slot: 1, mainStat: { statId: 4, isFlat: true, value: 30 } })];
  const got = solvePower({
    items: flat, faction: 0, champStats: champStats(), current: flat,
    weights: { b: 0, r: 0, a: 0, s: 1, k: 1 },
  });
  expect(got.builds[0].lin).toBeCloseTo(30, 9);   // s * SPD 30; C.RATE is 0, so no crit term
  expect(got.gap).toBeCloseTo(0, 9);
});

// gap is a difference the caller does not have to recompute, and it must match the two fields it
// is derived from.
test("gap is upperBound less the best build's lin", () => {
  const got = solvePower(CONVERGE_ARGS);
  expect(got.gap).toBeCloseTo(got.upperBound - got.builds[0].lin, 9);
  expect(got.gap).toBeGreaterThanOrEqual(0);
});

// --- solvePower: certify ------------------------------------------------------------------------
//
// An INTERNAL option, for solvePowerExact, which calls this for its incumbent and then throws the
// certificate away and computes its own box. The certificate is four more exact solves — two for
// the box and one per McCormick estimator — and build-solve.prop.test.mjs measures a full-vault
// solve at 9.7 s, so on a real vault those four are most of a minute spent proving a ceiling that
// is discarded unread.

// The two fields are ABSENT rather than null or zero. A caller that reads one gets undefined,
// which turns into NaN in arithmetic and is loud; a null would read as 0 and print as a zero gap,
// which is a certificate claiming the answer is proved optimal — the one thing this mode must
// never say.
test("certify false drops the certificate fields rather than zeroing them", () => {
  const got = solvePower({ ...CONVERGE_ARGS, certify: false });
  expect(got).not.toHaveProperty("upperBound");
  expect(got).not.toHaveProperty("gap");
});

// Skipping the certificate must not move the answer: it is computed after the iteration and feeds
// nothing back into it.
test("certify false returns the same builds, rounds and convergence", () => {
  const full = solvePower(CONVERGE_ARGS);
  const bare = solvePower({ ...CONVERGE_ARGS, certify: false });
  expect(bare.builds.map((b) => b.items.map((it) => it.id)))
    .toEqual(full.builds.map((b) => b.items.map((it) => it.id)));
  expect(bare.builds[0].lin).toBeCloseTo(full.builds[0].lin, 9);
  expect(bare.rounds).toBe(full.rounds);
  expect(bare.converged).toBe(full.converged);
});

// The default is the certificate, because every caller outside this module wants it — power.mjs
// prints it, and the public contract is a certified answer.
test("certify defaults to true", () => {
  expect(solvePower(CONVERGE_ARGS)).toHaveProperty("upperBound");
  expect(solvePower({ ...CONVERGE_ARGS, certify: true })).toHaveProperty("gap");
});
