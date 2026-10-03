// oracle/analytics/__tests__/build-solve.prop.test.mjs
// build-solve claims a PROVABLE maximum over a search space far too large to inspect. On
// instances small enough to enumerate exhaustively that claim is checkable directly — so check
// it. Mirrors speed-solve.prop.test.mjs, including the generator-coverage test at the bottom,
// which is what stops the generator quietly narrowing until the property proves nothing.
import { test, expect } from "vitest";
import fc from "fast-check";
import { SLOTS, buildIndex, enumeratePlans, slotsSupplying, solve } from "../build-solve.mjs";

// vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
// workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
// timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
// runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
// is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const PARAMS = process.env.FC_NUM_RUNS
  ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
  : { numRuns: NUM_RUNS };

const valueOf = (it) => it.value;

const mkItem = (id, slot, set, value) => ({
  id, slot, set, value, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0,
});

// A bonus profile over 0..9 pieces. `at` gives the TOTAL bonus from that piece count upward.
const tiers = (at) => {
  const out = [0];
  let current = 0;
  for (let n = 1; n <= SLOTS.length; n++) {
    if (at[n] !== undefined) current = at[n];
    out.push(current);
  }
  return out;
};

// The shapes the real table has, each parameterised by one magnitude so the generator can vary
// how MUCH a set is worth without varying WHERE it pays.
//
//   stack2    a classic two-piece set that stacks        pays at 2, 4, 6
//   stack4    a classic four-piece set                   pays at 4
//   onePiece  the shape this solver exists for           pays at 1, 2, 3, 5, 7, 8
//   from2     a nine-slot tiered set opening at two      pays at 2, 4, 8
//   from3     a nine-slot tiered set opening at three    pays at 3, 5, 8
//
// stack4 deliberately has no eight-piece rung: the four-piece sets in the real table are
// artifact-only, so six slots is their ceiling and a second stack is unreachable.
const SHAPES = {
  stack2: (p) => tiers({ 2: p, 4: 2 * p, 6: 3 * p }),
  stack4: (p) => tiers({ 4: p }),
  onePiece: (p) => tiers({ 1: p, 2: 2 * p, 3: 3 * p, 5: 4 * p, 7: 5 * p, 8: 6 * p }),
  from2: (p) => tiers({ 2: p, 4: 2 * p, 8: 3 * p }),
  from3: (p) => tiers({ 3: p, 5: 2 * p, 8: 3 * p }),
};

// Eight sets per instance, which keeps plan enumeration in the thousands rather than the hundreds
// of thousands the full table reaches. Set 0 is setless and never appears in bonusAt.
const SET_IDS = [11, 12, 13, 14, 15, 16, 17, 18];

const ANY_SHAPE = fc.constantFrom("stack2", "stack4", "onePiece", "from2", "from3");
// Reaching the four-set cap needs four sets whose FIRST useful count is 2, because 4 x 2 = 8 fits
// in nine slots and 4 x 3 = 12 does not. from3 and stack4 have no count-2 rung, so the draw that
// targets that state excludes them. Same trick as speed-solve.prop.test.mjs's CHEAP_SETS.
const OPENS_AT_2 = fc.constantFrom("stack2", "onePiece", "from2");
const TIERED = fc.constantFrom("onePiece", "from2", "from3");

const bonusAtArb = (shapeArb) => fc.array(
  fc.record({ shape: shapeArb, p: fc.integer({ min: 1, max: 15 }) }),
  { minLength: SET_IDS.length, maxLength: SET_IDS.length },
).map((specs) => new Map(specs.map((s, i) => [SET_IDS[i], SHAPES[s.shape](s.p)])));

// One list of items PER SLOT rather than a flat array whose slots are drawn at random. An
// instance can then put a set in all nine slots — which is what the eight-piece rung and the
// four-set cap need, and what a flat array of a dozen items reaches only by accident. At most two
// items per slot caps the exhaustive search at 2^9.
//
// The populated slots are always a prefix of SLOTS. That costs nothing: buildIndex, assignPlan
// and solve key on the slot rather than reading it, and every generated item is a non-accessory,
// so which nine slots they are is not a distinction any of them can make.
//
// `minSlots` is what makes the targeted draws below land. fc.array biases short, so an
// unconstrained nine-slot generator averages five populated slots and reaches eight or nine only
// by luck.
const itemsArb = (setArb, minSlots) => fc.array(
  fc.array(fc.record({ set: setArb, value: fc.integer({ min: 0, max: 40 }) }),
    { minLength: 1, maxLength: 2 }),
  { minLength: minSlots, maxLength: SLOTS.length },
).map((perSlot) => perSlot.flatMap((specs, i) => specs.map((s) => ({ ...s, slot: SLOTS[i] }))));

// Weighted three-to-one so one set really does reach eight of the nine slots often. An even draw
// puts the eight-piece rung — the top of the ladder and the rung most easily missed — out of
// reach in practice.
const heavilyOneSet = (setId) => fc.oneof(
  { arbitrary: fc.constant(setId), weight: 3 },
  { arbitrary: fc.constant(0), weight: 1 },
);

// Items and set models are drawn TOGETHER. A layout that piles one set into eight slots only
// exercises the eight-piece rung if that set's model has one, so drawing the two independently
// would leave the targeted states to coincidence.
const instanceOf = (setArb, minSlots, shapeArb) =>
  fc.record({ specs: itemsArb(setArb, minSlots), bonusAt: bonusAtArb(shapeArb) });

// Four draws, one per state the coverage test at the bottom holds the generator to: a wide one
// mixing every shape on any number of slots; one piling a single tiered set high enough to unlock
// its top rung; one keeping four two-piece-opening sets in play at once; and one where every set
// pays from a single piece, so optima run past four active sets routinely.
const instance = fc.oneof(
  instanceOf(fc.constantFrom(0, ...SET_IDS), 1, ANY_SHAPE),
  instanceOf(heavilyOneSet(SET_IDS[0]), 8, TIERED),
  instanceOf(fc.constantFrom(...SET_IDS.slice(0, 4)), 8, OPENS_AT_2),
  instanceOf(fc.constantFrom(...SET_IDS), 8, fc.constant("onePiece")),
);

// Exhaustive search over every combination of one item per populated slot. Filling every slot
// loses nothing: values are non-negative and bonuses never decrease, so an empty slot never helps.
//
// The score is written out LONGHAND rather than calling scoreBuild, so the property compares two
// independent implementations instead of one against itself. Push/pop rather than a fresh array
// per node, because the coverage test below runs this two thousand times.
function bruteForceBest(items, bonusAt) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const chosen = [];
  let best = null;
  const walk = (i) => {
    if (i === slots.length) {
      let score = 0;
      const counts = new Map();
      for (const it of chosen) {
        score += it.value;
        if (!it.set) continue;
        counts.set(it.set, (counts.get(it.set) ?? 0) + 1);
      }
      for (const [setId, n] of counts) score += bonusAt.get(setId)?.[n] ?? 0;
      if (best === null || score > best.score) best = { score, chosen: [...chosen] };
      return;
    }
    for (const it of bySlot.get(slots[i])) {
      chosen.push(it);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
  return best;
}

// Measured locally: 0.2 s at the default 300 runs, and 16.4 s at 50,000 — so a fuzz shard's
// 25,000 take roughly 8 s and the 50 s interrupt above is a safety net rather than a live limit.
//
// Two mutations were run against this property to show it is not vacuous. Returning `[]` from
// singletonSets fails it in 4 instances: one set-11 piece paying 1 for its first piece, scored 0
// by solve against 1 by brute force. Lowering MAX_PLAN_SETS to 3 fails it too, but only at
// instance 2,097 (75 against 76) — so the FOUR-set cap is load-bearing and a default 300-run
// pass is NOT evidence for it. The fuzz shards are what hold that bound; locally it needs
// thousands of instances to show up at all.
test("solve returns the same maximum as exhaustive search", () => {
  fc.assert(
    fc.property(instance, ({ specs, bonusAt }) => {
      const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.value));
      const index = buildIndex(items, 0, valueOf);
      expect(solve(index, bonusAt)[0].score).toBe(bruteForceBest(items, bonusAt).score);
    }),
    PARAMS,
  );
}, 60_000);

// A set is TIERED here if it pays at seven or eight pieces. Only the three nine-slot shapes do;
// stack2 tops out at six and stack4 at four. Reading the shape back off the profile keeps this
// check independent of how the generator happened to label it.
const isTiered = (bonus) => bonus[8] > bonus[7] || bonus[7] > bonus[6];

// The generator IS the test. When it narrows, nothing else here complains — which is how a
// property file can come to draw four slots and one shape while claiming to prove a nine-slot
// solver exact. So the states the property exists to cover are asserted reachable rather than
// left to inspection.
//
// Unseeded and sampled wide on purpose: a fixed seed would make the floor below hostage to
// fast-check changing how it generates between versions.
//
// Measured locally: 0.3 s, with 765 nine-slot, 396 four-set-plan, 454 five-active-set and 203
// eight-slot-tiered instances out of 2,000. The rarest clears the floor below by roughly eight
// standard deviations, so a passing run is not a near miss.
test("the generator reaches every state the property is supposed to cover", () => {
  const seen = { nineSlots: 0, fourSetPlan: 0, fiveActiveSets: 0, eightSlotTiered: 0 };
  for (const { specs, bonusAt } of fc.sample(instance, 2000)) {
    const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.value));
    const index = buildIndex(items, 0, valueOf);
    if (index.size === SLOTS.length) seen.nineSlots++;
    if (enumeratePlans(index, bonusAt).some((plan) => plan.length === 4)) seen.fourSetPlan++;
    // "Active" is read off the BRUTE-FORCE optimum, not off solve's answer: the point is that the
    // best build really does run past four active sets, which is the regime speed-solve.mjs
    // cannot reach. Reading it off solve would make the check circular.
    const counts = new Map();
    for (const it of bruteForceBest(items, bonusAt).chosen) {
      if (!it.set) continue;
      counts.set(it.set, (counts.get(it.set) ?? 0) + 1);
    }
    let active = 0;
    for (const [setId, n] of counts) if ((bonusAt.get(setId)?.[n] ?? 0) > 0) active++;
    if (active >= 5) seen.fiveActiveSets++;
    for (const [setId, bonus] of bonusAt) {
      if (isTiered(bonus) && slotsSupplying(index, setId) >= 8) { seen.eightSlotTiered++; break; }
    }
  }
  // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
  // covered by the 300 instances the property above actually runs. At 5% each of these is hit a
  // dozen times or more in a default run, and hundreds of times in a fuzz shard.
  for (const [state, hits] of Object.entries(seen)) {
    expect(hits, `${state} is generated too rarely to count as covered`).toBeGreaterThan(100);
  }
}, 60_000);

// The real table's mix of stat-bearing set shapes: 23 stacking two-piece and 5 stacking
// four-piece sets, both artifact-only, plus 13 nine-slot tiered sets that pay from a single
// piece. Every set is present in every slot it can roll on, which is plan enumeration at its
// worst — a real vault is sparser than this.
const PERF_SETS = [
  ...Array.from({ length: 23 }, (_, i) => ({ id: 1 + i, shape: "stack2", slots: [1, 2, 3, 4, 5, 6] })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: 24 + i, shape: "stack4", slots: [1, 2, 3, 4, 5, 6] })),
  ...Array.from({ length: 13 }, (_, i) => ({ id: 29 + i, shape: "onePiece", slots: SLOTS })),
];

// A deterministic 32-bit LCG. The wall time recorded below only means something if the instance
// is identical every run, and seeding fast-check for 285 numbers would be heavier than this.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Measured locally: 188,061 plans from enumeratePlans, 9.7 s wall. The budget is the 60 s
// timeout on this test, with a target of 30 s to leave room for a slower CI runner and for
// vitest's hardcoded 60 s birpc limit. This test is NOT scaled by FC_NUM_RUNS, so it costs the
// same on every `npm test` and on each of the ten fuzz shards every fifteen minutes — a known and
// accepted charge on the local gate, not an oversight.
test("a full-size index solves inside the time budget", () => {
  const rand = lcg(20261003);
  const items = [];
  let id = 0;
  for (const set of PERF_SETS) {
    for (const slot of set.slots) items.push(mkItem(++id, slot, set.id, Math.floor(rand() * 41)));
  }
  const bonusAt = new Map(
    PERF_SETS.map((s) => [s.id, SHAPES[s.shape](1 + Math.floor(rand() * 15))]));
  const index = buildIndex(items, 0, valueOf);

  const plans = enumeratePlans(index, bonusAt);
  const ranked = solve(index, bonusAt);

  expect(ranked).toHaveLength(1);
  expect(ranked[0].items.map((it) => it.slot).sort((a, b) => a - b)).toEqual(SLOTS);
  // Recomputed longhand from the items returned, so this is an independent check on the score
  // rather than a read-back of whatever solve put in the field.
  const recomputed = ranked[0].items.reduce((sum, it) => sum + it.value, 0)
    + [...ranked[0].counts].reduce((sum, [setId, n]) => sum + bonusAt.get(setId)[n], 0);
  expect(ranked[0].score).toBe(recomputed);
  // A floor, not the measured figure — the measured one is in the comment above. This catches the
  // set mix collapsing to a handful of plans, which would make the timing meaningless.
  expect(plans.length).toBeGreaterThan(50_000);
}, 60_000);
