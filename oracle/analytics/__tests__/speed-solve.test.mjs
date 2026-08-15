// oracle/analytics/__tests__/speed-solve.test.mjs
import { test, expect } from "vitest";
import {
  buildIndex, SLOTS, slotsSupplying, viableSets, enumeratePlans, assign, solve,
} from "../speed-solve.mjs";
import { itemSpeed, speedOfWith } from "../speed-model.mjs";

const speedOf = (it) => itemSpeed(it);
const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
});
const spd = (n) => [{ statId: 4, isFlat: false, rolls: 0, value: n, glyph: 0 }];
const pool = (specs) => specs.map((s, i) => item({ id: i + 1, ...s }));
const plain = speedOfWith(0, new Map());

// A pool whose best build needs FOUR sets at once: three 2-piece classics across the six artifact
// slots plus 2-piece Swift Parry (35, the one tiered set that opens at two and rolls on accessories)
// across two accessory slots. Every slot also offers a setless item worth 5 speed, so committing a
// slot to a set costs real flat speed and the fourth set has to earn its place.
const fourSetPool = () => {
  const specs = [];
  for (const [i, set] of [4, 34, 53, 35].entries()) {
    for (const slot of [i * 2 + 1, i * 2 + 2]) specs.push({ slot, set, substats: spd(0) });
  }
  for (const slot of SLOTS) specs.push({ slot, set: 0, substats: spd(5) });
  return specs;
};

test("SLOTS covers all nine equipment slots", () => {
  expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("buildIndex keeps only the fastest item of each set in each slot", () => {
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, substats: spd(10) }),
    item({ id: 2, slot: 1, set: 4, substats: spd(18) }),
    item({ id: 3, slot: 1, set: 38, substats: spd(14) }),
  ], 0, speedOf);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(18);
  expect(index.get(1).get(38).item.id).toBe(3);
});

// The faction lock is a hard game rule: 1401 equipped accessories in the 2026-08-12 snapshot, zero
// of them on a champion of another faction.
test("buildIndex drops accessories of the wrong faction and keeps artifacts regardless", () => {
  const index = buildIndex([
    item({ id: 1, slot: 7, isAccessory: true, faction: 2, substats: spd(10) }),
    item({ id: 2, slot: 7, isAccessory: true, faction: 5, substats: spd(20) }),
    item({ id: 3, slot: 1, isAccessory: false, faction: 5, substats: spd(9) }),
  ], 2, speedOf);
  expect(index.get(7).get(4).item.id).toBe(1);
  expect(index.get(1).get(4).item.id).toBe(3);
});

// The lock covers all three accessory slots and none of the six artifact slots — a filter that
// reached one slot too far or stopped one slot short would still pass the case above.
test("buildIndex applies the faction lock to every accessory slot and no artifact slot", () => {
  const wrongFaction = [7, 8, 9].map((slot) =>
    item({ id: slot, slot, isAccessory: true, faction: 5, substats: spd(10) }));
  const artifacts = [1, 2, 3, 4, 5, 6].map((slot) =>
    item({ id: slot, slot, isAccessory: false, faction: 5, substats: spd(10) }));
  const index = buildIndex([...wrongFaction, ...artifacts], 2, speedOf);
  for (const slot of [7, 8, 9]) expect(index.has(slot)).toBe(false);
  for (const slot of [1, 2, 3, 4, 5, 6]) expect(index.get(slot).get(4).item.id).toBe(slot);
});

test("buildIndex omits a slot entirely when nothing is eligible for it", () => {
  const index = buildIndex([
    item({ id: 1, slot: 8, isAccessory: true, faction: 9, substats: spd(10) }),
  ], 2, speedOf);
  expect(index.has(8)).toBe(false);
});

// The id is a TIE-break, subordinate to speed — it must never unseat a faster incumbent. The slower
// item has to arrive second for this to bite: SQLite hands back Artifacts id-ascending, so on the
// snapshot an id-dominant comparison is invisible until a caller sorts or pre-filters the pool.
test("buildIndex keeps the faster item even when the slower one has the lower id", () => {
  const index = buildIndex([
    item({ id: 2, slot: 1, substats: spd(18) }), item({ id: 1, slot: 1, substats: spd(10) }),
  ], 0, speedOf);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(18);
});

// A tie must not depend on row order, or the same run prints different builds.
test("buildIndex breaks ties on the lower item id so output is stable", () => {
  const forward = buildIndex([
    item({ id: 7, slot: 1, substats: spd(12) }), item({ id: 3, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  const reverse = buildIndex([
    item({ id: 3, slot: 1, substats: spd(12) }), item({ id: 7, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  expect(forward.get(1).get(4).item.id).toBe(3);
  expect(reverse.get(1).get(4).item.id).toBe(3);
});

// The winner is the lowest id of the whole tied group, not of the first or last pair compared.
test("buildIndex breaks a three-way tie on the lowest id wherever it sits in the row order", () => {
  for (const order of [[7, 3, 5], [5, 7, 3], [3, 5, 7]]) {
    const index = buildIndex(order.map((id) => item({ id, slot: 1, substats: spd(12) })), 0, speedOf);
    expect(index.get(1).get(4).item.id).toBe(3);
  }
});

test("buildIndex indexes setless items under set 0", () => {
  const index = buildIndex([item({ id: 1, slot: 1, set: 0, substats: spd(11) })], 0, speedOf);
  expect(index.get(1).get(0).speed).toBe(11);
});

// A build has to fill all nine slots, and a set needs its pieces whether or not they carry speed —
// so an item worth zero speed is still the slot's candidate for its set.
test("buildIndex keeps items that contribute no speed at all", () => {
  const index = buildIndex([item({ id: 1, slot: 3, set: 66, substats: [] })], 0, speedOf);
  expect(index.get(3).get(66).item.id).toBe(1);
  expect(index.get(3).get(66).speed).toBe(0);
});

// The valuation is injected because a run may raise every SPD glyph to a floor (`--glyph`). An index
// that called itemSpeed itself would silently ignore that and rank the wrong item first.
test("buildIndex ranks by the injected valuation rather than the raw item speed", () => {
  const byId = (it) => it.id;
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, substats: spd(50) }),
    item({ id: 2, slot: 1, set: 4, substats: spd(1) }),
  ], 0, byId);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(2);
});

test("slotsSupplying counts distinct slots that can supply a set", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 2, set: 4, substats: spd(10) },
    { slot: 2, set: 4, substats: spd(12) }, { slot: 3, set: 38, substats: spd(10) },
  ]), 0, plain);
  expect(slotsSupplying(index, 4)).toBe(2);
  expect(slotsSupplying(index, 38)).toBe(1);
  expect(slotsSupplying(index, 66)).toBe(0);
});

// A set that cannot reach its first threshold can never contribute, so it must not enter the plan
// space — that is what keeps enumeration small.
test("viableSets keeps only speed sets whose first threshold the pool can reach", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 2, set: 4, substats: spd(10) },
    { slot: 3, set: 38, substats: spd(10) },
    { slot: 4, set: 48, substats: spd(10) }, { slot: 5, set: 48, substats: spd(10) },
  ]), 0, plain);
  expect(viableSets(index).sort((a, b) => a - b)).toEqual([4]);
});

test("enumeratePlans always includes the empty plan", () => {
  const index = buildIndex(pool([{ slot: 1, set: 0, substats: spd(10) }]), 0, plain);
  expect(enumeratePlans(index, [])).toEqual([[]]);
});

test("enumeratePlans lists each viable count for a single set", () => {
  const index = buildIndex(pool(
    [1, 2, 3, 4].map((slot) => ({ slot, set: 4, substats: spd(10) }))), 0, plain);
  expect(enumeratePlans(index, [4])).toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 4, count: 4 }]]);
});

// Nine slots and a minimum threshold of two pieces cap the number of simultaneously active sets at
// four. That bound is what makes enumeration tractable at all.
test("enumeratePlans never exceeds nine slots or four active sets", () => {
  const specs = [];
  for (const set of [4, 34, 53, 57, 38]) {
    for (let slot = 1; slot <= 6; slot++) specs.push({ slot, set, substats: spd(10) });
  }
  const index = buildIndex(pool(specs), 0, plain);
  for (const plan of enumeratePlans(index, [4, 34, 53, 57, 38])) {
    expect(plan.length).toBeLessThanOrEqual(4);
    expect(plan.reduce((s, p) => s + p.count, 0)).toBeLessThanOrEqual(9);
  }
});

// The cap is exactly four, not merely at-most-four: three two-piece artifact sets plus a two-piece
// accessory-capable one fit inside nine slots, so a four-set plan has to be reachable.
test("enumeratePlans reaches four active sets when the pool can supply them", () => {
  const index = buildIndex(pool(fourSetPool()), 0, plain);
  const plans = enumeratePlans(index, viableSets(index));
  expect(plans.some((plan) => plan.length === 4)).toBe(true);
});

test("assign fills every available slot and honours the plan's counts", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 1, set: 0, substats: spd(30) },
    { slot: 2, set: 4, substats: spd(10) }, { slot: 2, set: 0, substats: spd(30) },
    { slot: 3, set: 0, substats: spd(30) },
  ]), 0, plain);
  const picks = assign(index, [{ setId: 4, count: 2 }]);
  expect(picks).toHaveLength(3);
  expect(picks.filter((p) => p.set === 4)).toHaveLength(2);
});

test("assign returns null when the plan needs more slots than exist", () => {
  const index = buildIndex(pool([{ slot: 1, set: 4, substats: spd(10) }]), 0, plain);
  expect(assign(index, [{ setId: 4, count: 2 }])).toBe(null);
});

// Slots can be plentiful and the plan still impossible — two pieces of a set only one slot supplies.
// The DP is the only thing that catches that, and a build that quietly ignored the plan's counts
// would be scored as if it had honoured them.
test("assign returns null when a plan's set cannot fill its count", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) },
    { slot: 2, set: 0, substats: spd(10) }, { slot: 3, set: 0, substats: spd(10) },
  ]), 0, plain);
  expect(assign(index, [{ setId: 4, count: 2 }])).toBe(null);
});

// The set bonus has to beat the flat speed given up to earn it, and the solver has to notice.
test("solve commits slots to a set only when the bonus beats the flat speed forgone", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 1, set: 0, substats: spd(11) },
    { slot: 2, set: 4, substats: spd(10) }, { slot: 2, set: 0, substats: spd(11) },
  ]), 0, plain);
  // Speed x2 on base 100 is +12 for 2 speed forgone -> take the set.
  expect(solve(index, 100, 0, plain).speed).toBe(100 + 12 + 20);
  // On base 10 the same set is worth +1, which does not pay for 2 speed -> skip it.
  expect(solve(index, 10, 0, plain).speed).toBe(10 + 22);
});

// Four sets at once is worth 88 speed on base 200 against the 72 of the best three, so a solver that
// stopped enumerating at three would answer 287 and never see it. Nothing weaker than this catches
// that: an at-most-four assertion passes just as happily at three.
test("solve takes a fourth set when three plus the flat speed cannot match it", () => {
  const index = buildIndex(pool(fourSetPool()), 0, plain);
  const best = solve(index, 200, 0, plain);
  // 24+24+24 from the classics, 16 from Swift Parry's first tier, 5 from the one uncommitted slot.
  expect(best.speed).toBe(200 + 88 + 5);
  expect(new Set(best.items.map((it) => it.set))).toEqual(new Set([4, 34, 53, 35, 0]));
});

test("solve carries the constant through untouched", () => {
  const index = buildIndex(pool([{ slot: 1, set: 0, substats: spd(10) }]), 0, plain);
  expect(solve(index, 100, 17, plain).speed).toBe(127);
});

test("solve returns null for an empty index", () => {
  expect(solve(new Map(), 100, 0, plain)).toBe(null);
});

// A free slot's item belongs to some set and can complete one by accident. Scoring the ACTUAL items
// rather than the plan means the reported number is never an under-count.
test("solve scores the items it picked, not the plan it picked them under", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(30) }, { slot: 2, set: 4, substats: spd(30) },
  ]), 0, plain);
  const best = solve(index, 100, 0, plain);
  expect(best.speed).toBe(100 + 12 + 60);
});

// Builds can TIE at the maximum, and then WHICH one comes back is the whole answer: `counts` is the
// set summary a reader sees. Here 149 is reachable two ways — Supersonic plus two Perception from the
// empty plan, or three Perception from the [{38,2}] plan, which the bound prunes at 149 <= 149.
// Scoring the plan rather than the picked items reaches the same 149 down the other branch, so the
// speed assertion alone cannot see the difference; the ids and counts can.
test("solve pins which of two equally fast builds it returns", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 58, substats: spd(0) }, { slot: 1, set: 38, substats: spd(0) },
    { slot: 2, set: 38, substats: spd(0) }, { slot: 3, set: 38, substats: spd(0) },
  ]), 0, plain);
  const best = solve(index, 142, 0, plain);
  expect(best.speed).toBe(149);
  expect(best.items.map((it) => it.id)).toEqual([1, 3, 4]);
  expect(best.counts).toEqual(new Map([[58, 1], [38, 2]]));
});

// freeBest promises the tie goes to the lower item id, not to whichever row buildIndex saw first.
// The lower id has to arrive SECOND for that to bite — first-wins and lowest-id-wins agree otherwise.
test("solve breaks a free slot's speed tie on the lower item id", () => {
  const index = buildIndex(pool([
    { id: 9, slot: 1, set: 58, substats: spd(0) }, { id: 2, slot: 1, set: 38, substats: spd(0) },
  ]), 0, plain);
  expect(solve(index, 100, 0, plain).items.map((it) => it.id)).toEqual([2]);
});

// A later plan that merely ties must not displace the incumbent, or the build printed depends on
// enumeration order. Speed x2 is worth exactly the 12 flat speed its two slots give up, and the
// plan's bound (which assumes the best flat speed as well) clears the incumbent, so it is scored
// rather than pruned — the tie is decided by the comparison, not by the branch-and-bound.
test("solve keeps the build it already had when a later plan only ties", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(6) }, { slot: 1, set: 0, substats: spd(12) },
    { slot: 2, set: 4, substats: spd(6) }, { slot: 2, set: 0, substats: spd(12) },
  ]), 0, plain);
  const best = solve(index, 100, 0, plain);
  expect(best.speed).toBe(124);
  expect(best.items.map((it) => it.id)).toEqual([2, 4]);
});
