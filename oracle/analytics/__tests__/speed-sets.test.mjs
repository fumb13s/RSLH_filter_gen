// oracle/analytics/__tests__/speed-sets.test.mjs
import { test, expect } from "vitest";
import { speedTerms, setEffect, firstThreshold, usefulCounts, SPEED_SET_IDS, speedSetName } from "../speed-sets.mjs";
import { SETS } from "../sets.mjs";

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

// Swift Parry's thresholds are 2/4/8. It shares the 2-piece opening with Deflection, Feral,
// Pinpoint, Rebirth and Chronophage, but its SECOND tier lands at 4 where every one of theirs
// lands at 5 — so it is still the only set on this shape.
test("Swift Parry uses 2/4/8 thresholds", () => {
  expect(speedTerms(counts({ 35: 2 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 3 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 4 }))).toEqual([8, 10]);
  expect(speedTerms(counts({ 35: 8 }))).toEqual([8, 10, 10]);
});

test("Merciless and Stonecleaver use 3/7, Slayer uses 3/8", () => {
  expect(speedTerms(counts({ 59: 6 }))).toEqual([5]);
  expect(speedTerms(counts({ 59: 7 }))).toEqual([5, 5]);
  // Stonecleaver needs BOTH sides of its second threshold. At 7 alone a 3/5 set also yields [5, 5],
  // so the count-6 case is what actually pins the 7 — the title claims 3/7, this is what holds it.
  expect(speedTerms(counts({ 63: 6 }))).toEqual([5]);
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

test("SPEED_SET_IDS covers exactly the 19 sets in the two tables", () => {
  expect(SPEED_SET_IDS).toHaveLength(19);
  expect(SPEED_SET_IDS).toContain(4);
  expect(SPEED_SET_IDS).toContain(35);
  expect(SPEED_SET_IDS).not.toContain(48);
});

// --- Every row of both tables, pinned ---------------------------------------------------------
//
// The tests above cover eight of the nineteen rows; these cover all of them. The values are derived
// from set-bonuses.mjs now rather than dictated here, which relocates the risk rather than removing
// it: a wrong SPD% in that table, or a filter here that picks the wrong tiers out of it, reaches
// speed.mjs unchallenged, because relic speed masks these magnitudes and nothing downstream can
// re-derive them from the vault. The most exposed row is Protection's 12 / 12 / 8, whose third tier
// is genuinely lower than its first and so reads like a typo waiting to be "fixed".
//
// Each profile is speedTerms at 1, 2, 3... pieces, written out LONGHAND rather than computed from
// the table under test. That redundancy is the point: it is a second copy that has to be edited in
// agreement, not a read-back of the thing it is checking.

// Classic sets are artifact-only, so six is their real ceiling. Profiles run 1..6 pieces.
const CLASSIC_PROFILES = [
  [4,  "Speed",        [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
  [34, "Divine Speed", [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
  [53, "Impulse",      [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
  [57, "Righteous",    [[], [10], [10], [10, 10], [10, 10], [10, 10, 10]]],
  [38, "Perception",   [[], [5],  [5],  [5, 5],   [5, 5],   [5, 5, 5]]],
  [49, "Killstroke",   [[], [5],  [5],  [5, 5],   [5, 5],   [5, 5, 5]]],
  [50, "Instinct",     [[], [],   [],   [12],     [12],     [12]]],
];

// Tiered sets roll on accessories too, so all nine slots are reachable. Profiles run 1..9 pieces,
// which straddles every threshold in both directions and therefore pins the thresholds themselves,
// not just the percentages.
const TIERED_PROFILES = [
  [58, "Supersonic",   [[], [], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
  [62, "Pinpoint",     [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
  [36, "Deflection",   [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
  [65, "Chronophage",  [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
  [64, "Rebirth",      [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
  [66, "Mercurial",    [[], [], [8],  [8],  [8, 12],  [8, 12],  [8, 12],  [8, 12, 12],  [8, 12, 12]]],
  [47, "Protection",   [[], [], [12], [12], [12, 12], [12, 12], [12, 12], [12, 12, 8],  [12, 12, 8]]],
  [35, "Swift Parry",  [[], [8], [8], [8, 10], [8, 10], [8, 10], [8, 10], [8, 10, 10],  [8, 10, 10]]],
  [61, "Feral",        [[], [5], [5], [5], [5, 5],   [5, 5],   [5, 5],   [5, 5, 5],    [5, 5, 5]]],
  [59, "Merciless",    [[], [], [5],  [5],  [5],      [5],      [5, 5],   [5, 5],       [5, 5]]],
  [63, "Stonecleaver", [[], [], [5],  [5],  [5],      [5],      [5, 5],   [5, 5],       [5, 5]]],
  [60, "Slayer",       [[], [], [5],  [5],  [5],      [5],      [5],      [5, 5],       [5, 5]]],
];

test.each(CLASSIC_PROFILES)("classic set %i (%s) grants its derived bonus at every count 1-6", (id, name, profile) => {
  expect(profile.map((_, i) => speedTerms(counts({ [id]: i + 1 })))).toEqual(profile);
});

test.each(TIERED_PROFILES)("tiered set %i (%s) grants its derived bonus at every count 1-9", (id, name, profile) => {
  expect(profile.map((_, i) => speedTerms(counts({ [id]: i + 1 })))).toEqual(profile);
});

// Guards against the profiles going stale: a row added to either table in speed-sets.mjs without a
// matching profile here fails, rather than quietly re-opening the coverage hole.
test("the profiles above cover every id in SPEED_SET_IDS", () => {
  const profiled = [...CLASSIC_PROFILES, ...TIERED_PROFILES].map(([id]) => id);
  const asc = (a, b) => a - b;
  expect([...profiled].sort(asc)).toEqual([...SPEED_SET_IDS].sort(asc));
});

// sets.mjs is an independent, pre-existing table covering all 67 sets, so agreeing with it kills
// the wrong-id class outright: a mistyped id would have to land on a different real set that
// happens to carry the same name.
test("every id and name agrees with the independent SETS table in sets.mjs", () => {
  const rows = [...CLASSIC_PROFILES, ...TIERED_PROFILES];
  const want = rows.map(([, name]) => name);
  expect(rows.map(([id]) => SETS[id]?.name ?? null)).toEqual(want);
  expect(rows.map(([id]) => speedSetName(id))).toEqual(want);
});

// The boundary the cases above miss: maxSlots landing exactly ON a multiple of `pieces`, or on a
// threshold. Six artifact slots of 2-piece Speed is the most realistic call the solver will ever
// make — Speed is artifact-only, so 6 is its true ceiling — and an off-by-one here would silently
// delete the strongest classic speed plan in the game rather than fail loudly.
test("usefulCounts includes maxSlots itself when it lands exactly on a boundary", () => {
  expect(usefulCounts(4, 6)).toEqual([2, 4, 6]);
  expect(usefulCounts(50, 4)).toEqual([4]);
  expect(usefulCounts(50, 8)).toEqual([4, 8]);
  expect(usefulCounts(58, 8)).toEqual([3, 5, 8]);
  expect(usefulCounts(35, 4)).toEqual([2, 4]);
});

// The solver's "at most four active sets" cap (enumeratePlans in speed-solve.mjs) is sound only
// because no speed set opens below two pieces: four sets at two pieces is eight of the nine slots,
// and a fifth would need ten. One-piece tiers DO exist in set-bonuses.mjs — Stone Skin's first tier
// is a single piece — so the day a patch puts SPD% on a one-piece tier, that cap starts silently
// discarding the best build. This makes it fail loudly instead.
test("no speed set grants anything below two pieces, which the solver's four-set cap needs", () => {
  for (const setId of SPEED_SET_IDS) {
    expect(firstThreshold(setId), `set ${setId} (${speedSetName(setId)})`).toBeGreaterThanOrEqual(2);
  }
});
