// oracle/analytics/__tests__/build-solve.test.mjs
import { test, expect } from "vitest";
import {
  SLOTS, buildIndex, slotsSupplying, usefulCounts, enumeratePlans, scoreBuild, assignPlan,
} from "../build-solve.mjs";

// Every item carries a plain `value` the injected valuation reads back. The module is
// stat-agnostic — it never looks at a stat — so a number on the item is the honest way to
// exercise it, and it keeps each expected score below readable arithmetic rather than a speed
// calculation. Every other field is present because a real decoded artifact has it.
const valueOf = (it) => it.value;

const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, value: 0, mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
});

const pool = (specs) => specs.map((s, i) => item({ id: i + 1, ...s }));
const indexOf = (specs, faction = 0) => buildIndex(pool(specs), faction, valueOf);

// A bonus profile over 0..9 pieces, as `bonusAt` wants it. `at` gives the TOTAL bonus from that
// piece count upward, so tiers({ 2: 10, 4: 25 }) is [0,0,10,10,25,25,25,25,25,25]. A helper is
// fine here because these are INPUTS; every expected score below is written out as arithmetic.
const tiers = (at) => {
  const out = [0];
  let current = 0;
  for (let n = 1; n <= 9; n++) {
    if (at[n] !== undefined) current = at[n];
    out.push(current);
  }
  return out;
};

const bonusOf = (byId) => new Map(Object.entries(byId).map(([id, at]) => [Number(id), tiers(at)]));

test("SLOTS covers all nine equipment slots", () => {
  expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("buildIndex keeps only the best item of each set in each slot", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 },
    { slot: 1, set: 4, value: 18 },
    { slot: 1, set: 38, value: 14 },
  ]);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).value).toBe(18);
  expect(index.get(1).get(38).item.id).toBe(3);
});

// The id is a TIE-break, subordinate to value — it must never unseat a better incumbent. The
// worse item has to arrive second for this to bite: an id-dominant comparison is invisible
// whenever the pool happens to be id-ascending, which a database read usually is.
test("buildIndex keeps the better item even when the worse one has the lower id", () => {
  const index = indexOf([
    { id: 2, slot: 1, value: 18 }, { id: 1, slot: 1, value: 10 },
  ]);
  expect(index.get(1).get(4).item.id).toBe(2);
});

// The winner is the lowest id of the whole tied group, not of the first or last pair compared.
// A tie that depended on row order would return a different build on a rerun.
test("buildIndex breaks a three-way tie on the lowest id wherever it sits in the row order", () => {
  for (const order of [[7, 3, 5], [5, 7, 3], [3, 5, 7]]) {
    const index = indexOf(order.map((id) => ({ id, slot: 1, value: 12 })));
    expect(index.get(1).get(4).item.id).toBe(3);
  }
});

// The faction lock covers all three accessory slots and none of the six artifact slots. A filter
// that reached one slot too far, or stopped one slot short, would pass a single-slot case.
test("buildIndex applies the faction lock to every accessory slot and no artifact slot", () => {
  const wrong = [7, 8, 9].map((slot) => ({ id: slot, slot, isAccessory: true, faction: 5, value: 10 }));
  const artifacts = [1, 2, 3, 4, 5, 6].map((slot) => ({ id: slot, slot, faction: 5, value: 10 }));
  const index = buildIndex([...wrong, ...artifacts].map((o) => item(o)), 2, valueOf);
  for (const slot of [7, 8, 9]) expect(index.has(slot)).toBe(false);
  for (const slot of [1, 2, 3, 4, 5, 6]) expect(index.get(slot).get(4).item.id).toBe(slot);
});

// The valuation is injected, so the index must rank by it and not by any field it picks itself.
// Ranking by a hardcoded field would pass every other test in this file.
test("buildIndex ranks by the injected valuation rather than any field of its own", () => {
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, value: 50 }),
    item({ id: 2, slot: 1, set: 4, value: 1 }),
  ], 0, (it) => it.id);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).value).toBe(2);
});

test("slotsSupplying counts distinct slots that can supply a set", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 },
    { slot: 2, set: 4, value: 12 }, { slot: 3, set: 38, value: 10 },
  ]);
  expect(slotsSupplying(index, 4)).toBe(2);
  expect(slotsSupplying(index, 38)).toBe(1);
  expect(slotsSupplying(index, 66)).toBe(0);
});

// Only counts where one more piece actually pays are worth planning around: a count between two
// paying counts grants exactly the lower one's bonus, so planning it enumerates the same build
// twice.
test("usefulCounts lists only the counts where one more piece pays", () => {
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
  expect(usefulCounts(bonusAt, 4, 9)).toEqual([2, 4, 6]);
  expect(usefulCounts(bonusAt, 58, 9)).toEqual([3, 5, 8]);
});

// The cap is maxSlots, and it must INCLUDE a count landing exactly on it — off by one here
// silently deletes the strongest plan a pool can reach rather than failing loudly.
test("usefulCounts caps at maxSlots and includes a count landing exactly on it", () => {
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
  expect(usefulCounts(bonusAt, 4, 6)).toEqual([2, 4, 6]);
  expect(usefulCounts(bonusAt, 4, 5)).toEqual([2, 4]);
  expect(usefulCounts(bonusAt, 58, 2)).toEqual([]);
});

// THE case this solver exists for. A set that pays from one piece has no useful count at all
// unless it also pays again later, because one-piece bonuses are bought by a singleton column
// instead of being planned. A solver that planned them would need nine-set plans.
test("usefulCounts never reports 1, so a one-piece bonus is never planned", () => {
  const bonusAt = bonusOf({ 70: { 1: 9 }, 71: { 1: 9, 3: 20 } });
  expect(usefulCounts(bonusAt, 70, 9)).toEqual([]);
  expect(usefulCounts(bonusAt, 71, 9)).toEqual([3]);
});

test("usefulCounts is empty for a set the model says nothing about", () => {
  expect(usefulCounts(new Map(), 4, 9)).toEqual([]);
});

test("enumeratePlans always includes the empty plan", () => {
  const index = indexOf([{ slot: 1, set: 0, value: 10 }]);
  expect(enumeratePlans(index, new Map())).toEqual([[]]);
});

test("enumeratePlans lists each useful count for a single set", () => {
  const index = indexOf([1, 2, 3, 4].map((slot) => ({ slot, set: 4, value: 10 })));
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 } });
  expect(enumeratePlans(index, bonusAt))
    .toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 4, count: 4 }]]);
});

// The cap is the POPULATED slots, not the nine there could be. A plan needing seven pieces on a
// six-slot pool is unfillable, and enumerating it is wasted work on every one of a few hundred
// thousand calls.
test("enumeratePlans never names more pieces than there are slots to fill", () => {
  const specs = [];
  for (const set of [4, 34, 53, 57, 38]) {
    for (let slot = 1; slot <= 6; slot++) specs.push({ slot, set, value: 10 });
  }
  const index = indexOf(specs);
  const bonusAt = bonusOf(Object.fromEntries([4, 34, 53, 57, 38].map((s) => [s, { 2: 10, 4: 20 }])));
  for (const plan of enumeratePlans(index, bonusAt)) {
    expect(plan.reduce((sum, p) => sum + p.count, 0)).toBeLessThanOrEqual(6);
  }
});

// The cap is exactly four, not merely at-most-four: four two-piece sets fit inside nine slots, so
// a four-set plan has to be reachable or the bound in the module header is vacuous.
test("enumeratePlans reaches four named sets when the pool can supply them", () => {
  const specs = [];
  for (const [i, set] of [4, 34, 53, 35].entries()) {
    for (const slot of [i * 2 + 1, i * 2 + 2]) specs.push({ slot, set, value: 0 });
  }
  specs.push({ slot: 9, set: 0, value: 0 });
  const index = indexOf(specs);
  const bonusAt = bonusOf(Object.fromEntries([4, 34, 53, 35].map((s) => [s, { 2: 10 }])));
  expect(enumeratePlans(index, bonusAt).some((plan) => plan.length === 4)).toBe(true);
});

// A set that pays from one piece only has no count to plan, and naming it would be a fifth name
// competing for a slot the singleton column gets for nothing.
test("enumeratePlans never names a set whose only bonus is at one piece", () => {
  const index = indexOf([1, 2, 3].map((slot) => ({ slot, set: 70, value: 0 })));
  expect(enumeratePlans(index, bonusOf({ 70: { 1: 9 } }))).toEqual([[]]);
});

// Slots can be plentiful and a count still impossible: two pieces of a set only one slot supplies.
test("enumeratePlans caps a set's count at the slots that supply it", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 0 }, { slot: 2, set: 0, value: 0 }, { slot: 3, set: 0, value: 0 },
  ]);
  expect(enumeratePlans(index, bonusOf({ 4: { 2: 12 } }))).toEqual([[]]);
});

// Two sets that each fit alone and cannot both fit, because they draw on the SAME two slots.
// Slots 3 and 4 are here so the per-set room cap does NOT catch it: with four populated slots
// there is room for 2 + 2, and only the union of the two sets' supplying slots shows that the
// pieces have nowhere to go. Checking each set's supply independently passes this test with the
// bad plan still in the list, and nothing downstream complains — assignPlan just returns null,
// after the plan's full cost has been paid.
test("enumeratePlans drops a plan whose sets share too few slots between them", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 0 }, { slot: 1, set: 34, value: 0 },
    { slot: 2, set: 4, value: 0 }, { slot: 2, set: 34, value: 0 },
    { slot: 3, set: 0, value: 0 }, { slot: 4, set: 0, value: 0 },
  ]);
  const bonusAt = bonusOf({ 4: { 2: 12 }, 34: { 2: 12 } });
  expect(enumeratePlans(index, bonusAt))
    .toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 34, count: 2 }]]);
});

// Set 0 is "no set", not a set. It is skipped when counting a build, so a bonus attached to it
// could never be credited — planning it would produce plans that can only ever score as the
// empty plan does.
test("enumeratePlans ignores a bonus attached to set 0", () => {
  const index = indexOf([1, 2, 3].map((slot) => ({ slot, set: 0, value: 0 })));
  expect(enumeratePlans(index, bonusOf({ 0: { 2: 50 } }))).toEqual([[]]);
});

// `picks` is what assignPlan hands back; scoreBuild is tested on hand-written ones so the scoring
// rule is pinned independently of whatever the assignment happens to produce.
const pick = (slot, setId, value) =>
  ({ slot, setId, item: item({ id: slot, slot, set: setId }), value });

test("scoreBuild sums the item values when no set pays", () => {
  expect(scoreBuild([pick(1, 4, 10), pick(2, 4, 7)], new Map())).toBe(17);
});

// The bonus is read at the count the build HOLDS. A rule that paid per piece would answer 24 for
// the first case; a rule that paid once per set regardless of count would answer 12 for the last.
test("scoreBuild credits each set once, at the count the build actually holds", () => {
  const bonusAt = bonusOf({ 4: { 2: 12, 4: 24 } });
  expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0)], bonusAt)).toBe(12);
  expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0), pick(3, 4, 0)], bonusAt)).toBe(12);
  expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0), pick(3, 4, 0), pick(4, 4, 0)], bonusAt)).toBe(24);
});

test("scoreBuild grants nothing for a set the model says nothing about", () => {
  expect(scoreBuild([pick(1, 66, 5), pick(2, 66, 5)], bonusOf({ 4: { 2: 12 } }))).toBe(10);
});

// Set 0 is "no set". Counting it would make nine setless pieces look like a nine-piece set.
test("scoreBuild never counts set 0 as a set", () => {
  expect(scoreBuild([pick(1, 0, 5), pick(2, 0, 5)], bonusOf({ 0: { 2: 99 } }))).toBe(10);
});

const ids = (picks) => picks.map((p) => p.item.id).sort((a, b) => a - b);

test("assignPlan with the empty plan takes the best value in every slot", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 30 },
    { slot: 2, set: 4, value: 40 }, { slot: 2, set: 0, value: 5 },
  ]);
  const { picks, credited } = assignPlan(index, new Map(), []);
  expect(picks.map((p) => p.slot)).toEqual([1, 2]);
  expect(ids(picks)).toEqual([2, 3]);
  expect(credited).toBe(70);
});

// The whole reason this is an assignment and not nine independent choices. Slot 1 holds the
// pool's best item outright, but the plan's two pieces can only come from slots 1 and 2, so slot
// 1 has to give its best up. A per-slot greedy takes the 50 and then cannot fill the plan at all.
test("assignPlan gives up a slot's best item when the plan needs that slot", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 50 },
    { slot: 2, set: 4, value: 10 },
    { slot: 3, set: 0, value: 7 },
  ]);
  const { picks, credited } = assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }]);
  expect(picks.filter((p) => p.setId === 4)).toHaveLength(2);
  expect(credited).toBe(10 + 10 + 7 + 12);
});

test("assignPlan returns null when the plan needs more pieces than there are slots", () => {
  const index = indexOf([{ slot: 1, set: 4, value: 10 }]);
  expect(assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }])).toBe(null);
});

// Slots can be plentiful and the plan still impossible — two pieces of a set only one slot
// supplies. A build that quietly ignored the plan's counts would be scored as if it had honoured
// them, which is a wrong answer rather than a missing one.
test("assignPlan returns null when a plan's set cannot fill its count", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 2, set: 0, value: 10 }, { slot: 3, set: 0, value: 10 },
  ]);
  expect(assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }])).toBe(null);
});

// Two sets that each fit alone and cannot both fit, because they draw on the same two slots.
// enumeratePlans filters this plan out, so assignPlan is the only place the behaviour can be
// checked — and it has to hold, because assignPlan is exported for the power solver to call.
test("assignPlan returns null when two plan sets compete for the same slots", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 0 }, { slot: 1, set: 34, value: 0 },
    { slot: 2, set: 4, value: 0 }, { slot: 2, set: 34, value: 0 },
    { slot: 3, set: 0, value: 0 }, { slot: 4, set: 0, value: 0 },
  ]);
  const bonusAt = bonusOf({ 4: { 2: 12 }, 34: { 2: 12 } });
  expect(assignPlan(index, bonusAt, [{ setId: 4, count: 2 }, { setId: 34, count: 2 }])).toBe(null);
});

// `credited` is what the assignment PAID FOR; scoreBuild is what the build is worth. They agree
// when nothing is completed by accident, and credited is the lower one when something is — never
// the other way round, because that would mean the solver had over-claimed.
test("credited equals scoreBuild when no free pick completes a set by accident", () => {
  const index = indexOf([
    { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 }, { slot: 3, set: 0, value: 7 },
  ]);
  const bonusAt = bonusOf({ 4: { 2: 12 } });
  const { picks, credited } = assignPlan(index, bonusAt, [{ setId: 4, count: 2 }]);
  expect(credited).toBe(39);
  expect(scoreBuild(picks, bonusAt)).toBe(39);
});

// The empty plan names nothing, so it credits nothing — and still lands three pieces of set 40,
// which pays 30. Scoring the plan would report 30 for a build worth 60.
test("credited is below scoreBuild when a free pick completes a set by accident", () => {
  const index = indexOf([
    { slot: 1, set: 40, value: 10 }, { slot: 2, set: 40, value: 10 },
    { slot: 3, set: 40, value: 10 }, { slot: 3, set: 0, value: 9 },
  ]);
  const bonusAt = bonusOf({ 40: { 2: 30 } });
  const { picks, credited } = assignPlan(index, bonusAt, []);
  expect(credited).toBe(30);
  expect(scoreBuild(picks, bonusAt)).toBe(60);
});

test("assignPlan reports each pick's slot, set, item and value", () => {
  const index = indexOf([{ slot: 3, set: 66, value: 11 }]);
  const { picks } = assignPlan(index, new Map(), []);
  expect(picks).toHaveLength(1);
  expect(picks[0].slot).toBe(3);
  expect(picks[0].setId).toBe(66);
  expect(picks[0].value).toBe(11);
  expect(picks[0].item.id).toBe(1);
});
