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
