// oracle/analytics/__tests__/power-solve.test.mjs
import { test, expect } from "vitest";
import {
  buildTotals, itemVector, linearizedWeights, nonGearTotals, setVectors, solvePower,
} from "../power-solve.mjs";
import { STATS, statBreakdown } from "../champion-stats.mjs";
import { lin } from "../power-model.mjs";

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
