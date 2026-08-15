// oracle/analytics/__tests__/speed-sets.test.mjs
import { test, expect } from "vitest";
import { speedTerms, setEffect, firstThreshold, usefulCounts, SPEED_SET_IDS, speedSetName } from "../speed-sets.mjs";

const counts = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

// Classic sets STACK: 4 pieces of a 2-piece set is two completions.
test("classic sets stack by floor(count / pieces)", () => {
  expect(speedTerms(counts({ 4: 2 }))).toEqual([12]);
  expect(speedTerms(counts({ 4: 3 }))).toEqual([12]);
  expect(speedTerms(counts({ 4: 4 }))).toEqual([12, 12]);
  expect(speedTerms(counts({ 4: 6 }))).toEqual([12, 12, 12]);
  expect(speedTerms(counts({ 4: 1 }))).toEqual([]);
});

test("Instinct is the one 4-piece classic speed set", () => {
  expect(speedTerms(counts({ 50: 3 }))).toEqual([]);
  expect(speedTerms(counts({ 50: 4 }))).toEqual([12]);
  expect(speedTerms(counts({ 50: 8 }))).toEqual([12, 12]);
});

// Nine-slot sets do NOT stack: each threshold crossed unlocks an ADDITIONAL bonus.
test("tiered sets accumulate their thresholds instead of stacking", () => {
  expect(speedTerms(counts({ 58: 2 }))).toEqual([]);
  expect(speedTerms(counts({ 58: 3 }))).toEqual([10]);
  expect(speedTerms(counts({ 58: 4 }))).toEqual([10]);
  expect(speedTerms(counts({ 58: 5 }))).toEqual([10, 10]);
  expect(speedTerms(counts({ 58: 8 }))).toEqual([10, 10, 12]);
  expect(speedTerms(counts({ 58: 9 }))).toEqual([10, 10, 12]);
});

// Swift Parry's thresholds are 2/4/8, not the 3/5/8 every other tiered set uses.
test("Swift Parry uses 2/4/8 thresholds, unlike its neighbours", () => {
  expect(speedTerms(counts({ 35: 2 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 3 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 4 }))).toEqual([8, 10]);
  expect(speedTerms(counts({ 35: 8 }))).toEqual([8, 10, 10]);
});

test("Merciless and Stonecleaver use 3/7, Slayer uses 3/8", () => {
  expect(speedTerms(counts({ 59: 6 }))).toEqual([5]);
  expect(speedTerms(counts({ 59: 7 }))).toEqual([5, 5]);
  expect(speedTerms(counts({ 63: 7 }))).toEqual([5, 5]);
  expect(speedTerms(counts({ 60: 7 }))).toEqual([5]);
  expect(speedTerms(counts({ 60: 8 }))).toEqual([5, 5]);
});

test("sets outside the table grant nothing, including accessory-only sets", () => {
  expect(speedTerms(counts({ 48: 6, 46: 4, 1003: 3 }))).toEqual([]);
});

// The game floors EACH bonus against base separately. Summing the percentages first and flooring
// once gives a different answer: base 105 at 12%+12% is 12+12=24, not floor(105*0.24)=25.
test("setEffect floors each completion separately, not the summed percentage", () => {
  expect(setEffect(105, counts({ 4: 4 }))).toBe(24);
  expect(Math.floor(105 * 0.24)).toBe(25);
});

test("setEffect sums across different sets", () => {
  // Speed x2 (12%) + Perception x2 (5%) on base 100 -> 12 + 5.
  expect(setEffect(100, counts({ 4: 2, 38: 2 }))).toBe(17);
});

test("setEffect is 0 for an empty build", () => {
  expect(setEffect(110, new Map())).toBe(0);
});

test("firstThreshold reports the minimum pieces before any bonus", () => {
  expect(firstThreshold(4)).toBe(2);
  expect(firstThreshold(50)).toBe(4);
  expect(firstThreshold(35)).toBe(2);
  expect(firstThreshold(58)).toBe(3);
});

// Only counts that change the bonus are worth a solver plan. For a 2-piece stacking set that is
// 2/4/6; for a tiered set it is exactly its thresholds.
test("usefulCounts lists only the counts that change the bonus", () => {
  expect(usefulCounts(4, 9)).toEqual([2, 4, 6, 8]);
  expect(usefulCounts(4, 5)).toEqual([2, 4]);
  expect(usefulCounts(58, 9)).toEqual([3, 5, 8]);
  expect(usefulCounts(58, 6)).toEqual([3, 5]);
  expect(usefulCounts(58, 2)).toEqual([]);
});

// Both tables answer, and a set in neither is null rather than undefined, so a caller can tell
// "not a speed set" from "not asked".
test("speedSetName reads through both tables and returns null off them", () => {
  expect(speedSetName(4)).toBe("Speed");
  expect(speedSetName(58)).toBe("Supersonic");
  expect(speedSetName(35)).toBe("Swift Parry");
  expect(speedSetName(48)).toBe(null);
});

test("SPEED_SET_IDS covers exactly the 18 sets in the two tables", () => {
  expect(SPEED_SET_IDS).toHaveLength(18);
  expect(SPEED_SET_IDS).toContain(4);
  expect(SPEED_SET_IDS).toContain(35);
  expect(SPEED_SET_IDS).not.toContain(48);
});
