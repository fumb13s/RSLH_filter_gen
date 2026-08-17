// oracle/analytics/__tests__/speed-solve.prop.test.mjs
// The solver claims a PROVABLE maximum. On instances small enough to enumerate exhaustively, that
// claim is checkable directly — so check it.
import { test, expect } from "vitest";
import fc from "fast-check";
import { buildIndex, enumeratePlans, solve, viableSets, SLOTS } from "../speed-solve.mjs";
import { speedOfWith, buildSpeed } from "../speed-model.mjs";
import { TIERED_SPEED_SETS } from "../speed-sets.mjs";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const plain = speedOfWith(0, new Map());

const mkItem = (id, slot, set, speed) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [{ statId: 4, isFlat: false, rolls: 0, value: speed, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
});

// Exhaustive search over every combination of one item per slot.
function bruteForce(items, base, constant) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  let best = null;
  const walk = (i, chosen) => {
    if (i === slots.length) {
      const speed = buildSpeed(base, constant, chosen, plain);
      if (best === null || speed > best) best = speed;
      return;
    }
    for (const it of bySlot.get(slots[i])) walk(i + 1, [...chosen, it]);
  };
  walk(0, []);
  return best;
}

// Sets chosen to span every mechanic the solver has to reason about: 0 is setless; 4 and 38 are
// classic 2-piece stackers with different values; 50 is the classic 4-piece one; 35 is tiered on the
// odd 2/4/8 thresholds; 58 and 47 are tiered on the usual 3/5/8 with payouts in different orders;
// 59 is tiered but stops after two rungs.
const SETS = [0, 4, 38, 50, 35, 58, 47, 59];

// Four sets active at once is the `current.length === 4` cap in enumeratePlans, and reaching it needs
// four sets whose FIRST threshold is 2 (4 x 2 = 8 <= 9 slots). Drawing from only these makes that
// state ordinary rather than a coincidence — 15% of instances against 7% with setless in the mix,
// measured. Setless pieces, and the free picks that complete a set by accident, are the wide draw's
// job.
const CHEAP_SETS = [4, 38, 53, 35];

// Every tier SHAPE: 3/5/8, 2/4/8, 3/7, and 3/5/8 with the payouts front-loaded.
const TIERED_SETS = [58, 47, 35, 59, 66];

// One list of items PER SLOT, rather than a flat array whose slots are drawn at random. An instance
// can then put a set in all nine slots — which is what the 8-piece tier and the four-set cap need,
// and what a flat array of a dozen items reaches only by accident. At most two items per slot caps
// the exhaustive search at 2^9.
//
// The populated slots are always a prefix of SLOTS. That costs nothing: buildIndex, assign and solve
// key on the slot rather than reading it, and every generated item is a non-accessory, so which nine
// slots they are is not a distinction any of them can make.
//
// `minSlots` is what makes the targeted draws below land. fc.array biases short, so an unconstrained
// nine-slot generator averages five populated slots and reaches the states needing eight or nine
// only by luck — 3% of instances rather than 14%, measured.
const instanceWith = (setArb, minSlots = 1) => fc.array(
  fc.array(fc.record({ set: setArb, speed: fc.integer({ min: 0, max: 40 }) }),
    { minLength: 1, maxLength: 2 }),
  { minLength: minSlots, maxLength: SLOTS.length },
).map((perSlot) => perSlot.flatMap((specs, i) => specs.map((s) => ({ ...s, slot: SLOTS[i] }))));

// Weighted three-to-one so one set really does reach eight of the nine slots often. An even draw
// puts the 8-piece tier — the top of the ladder and the rung most easily missed — out of reach in
// practice.
const heavilyOneSet = (setId) => fc.oneof(
  { arbitrary: fc.constant(setId), weight: 3 },
  { arbitrary: fc.constant(0), weight: 1 },
);

// Three draws: a wide one that mixes every mechanic on any number of slots, one that piles a single
// tiered set high enough to unlock all three of its rungs, and one that keeps four cheap sets in
// play at once. Measured over 2,000 instances: 36% populate all nine slots, 11% supply some tiered
// set from eight slots, 20% from five, 34% from three, and 15% enumerate a four-set plan. The test
// at the bottom of this file holds those rates to it.
const instance = fc.oneof(
  instanceWith(fc.constantFrom(...SETS)),
  fc.constantFrom(...TIERED_SETS).chain((setId) => instanceWith(heavilyOneSet(setId), 8)),
  instanceWith(fc.constantFrom(...CHEAP_SETS), 8),
);

test("solve returns the same maximum as exhaustive search", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), fc.integer({ min: -20, max: 60 }),
      (specs, base, constant) => {
        const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
        const index = buildIndex(items, 0, plain);
        const solved = solve(index, base, constant, plain);
        expect(solved.speed).toBe(bruteForce(items, base, constant));
      }),
    { numRuns: NUM_RUNS },
  );
});

// Two invariants that must hold on any instance, not just small ones.
test("solve is never worse than taking the fastest item in each slot", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), (specs, base) => {
      const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
      const index = buildIndex(items, 0, plain);
      const greedy = [...index.values()].map((bySet) =>
        [...bySet.values()].reduce((b, e) => (e.speed > b.speed ? e : b)).item);
      expect(solve(index, base, 0, plain).speed)
        .toBeGreaterThanOrEqual(buildSpeed(base, 0, greedy, plain));
    }),
    { numRuns: NUM_RUNS },
  );
});

// The generator IS the test. When it narrows, nothing else here complains — which is how this file
// came to draw from four slots and one tiered set while claiming to prove a nine-slot solver exact.
// So the states the property exists to cover are asserted reachable rather than left to inspection.
//
// Unseeded and sampled wide on purpose: the rarest of these lands in about 11% of instances, so the
// floor below sits nine standard deviations clear of it, while a fixed seed would make the check
// hostage to fast-check changing how it generates between versions.
const tiersOf = (setId) => TIERED_SPEED_SETS[setId]?.tiers.map(([threshold]) => threshold) ?? [];

test("the generator reaches every state the property is supposed to cover", () => {
  const seen = { nineSlots: 0, eighthRung: 0, fifthRung: 0, thirdRung: 0, fourSets: 0 };
  for (const specs of fc.sample(instance, 2000)) {
    const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
    const index = buildIndex(items, 0, plain);
    if (index.size === SLOTS.length) seen.nineSlots++;
    // How many distinct slots could supply each set — the same quantity viableSets works from, and
    // what decides which tier rungs are reachable at all.
    const supply = new Map();
    for (const bySet of index.values()) {
      for (const setId of bySet.keys()) supply.set(setId, (supply.get(setId) ?? 0) + 1);
    }
    const rung = (n) => [...supply].some(([setId, slots]) => slots >= n && tiersOf(setId).includes(n));
    if (rung(8)) seen.eighthRung++;
    if (rung(5)) seen.fifthRung++;
    if (rung(3)) seen.thirdRung++;
    if (enumeratePlans(index, viableSets(index)).some((plan) => plan.length === 4)) seen.fourSets++;
  }
  // 5%, not "at least once": a state the generator reaches twice in 2,000 draws is not covered by
  // the 300 the property above actually runs. At 5% every one of these is hit a dozen times or more
  // in a default run, and several hundred times in a fuzz shard.
  for (const [state, hits] of Object.entries(seen)) {
    expect(hits, `${state} is generated too rarely to count as covered`).toBeGreaterThan(100);
  }
});
