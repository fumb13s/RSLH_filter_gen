// oracle/analytics/__tests__/power-solve.prop.test.mjs
// solvePower makes two checkable claims: that the certificate really is an upper bound over every
// assignment, and that its answer is in the pool and never below the worn gear. On instances
// small enough to enumerate exhaustively both are checkable directly — so check them, against a
// brute force that goes through champion-stats.mjs and power-model.mjs and touches nothing in the
// module under test.
import { test, expect } from "vitest";
import fc from "fast-check";
import { solvePower } from "../power-solve.mjs";
import { STATS, statBreakdown } from "../champion-stats.mjs";
import { lin } from "../power-model.mjs";
import { SET_BONUSES, setBonusTotals } from "../set-bonuses.mjs";

// vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
// workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
// timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
// runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
// is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const PARAMS = process.env.FC_NUM_RUNS
  ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
  : { numRuns: NUM_RUNS };

// A relative tolerance, IN THE TEST ONLY. solvePower and the brute force sum the same terms in
// different orders, so they agree mathematically and can differ in the last bits. Nothing inside
// power-solve.mjs has a tolerance — build-solve compares scores exactly, and smearing an epsilon
// into the solver would hide a real ordering bug instead of surfacing it here.
const TOL = 1e-9;
const noLessThan = (a, b) => a >= b - TOL * Math.max(1, Math.abs(b));

// Five slots, so the exhaustive search below is at most 3^5 = 243 builds. All non-accessory, so
// the faction lock never fires and which five slots they are is not a distinction any of
// buildIndex, solve or the brute force can make.
const SLOT_IDS = [1, 2, 3, 4, 5];

// Non-negative throughout, and that is load-bearing rather than tidy. Every stat a piece or a set
// adds is then non-negative, so C.RATE and 100 + C.DMG both only grow and the crit PRODUCT grows
// with them — a piece can never lower the objective, which is what makes the full-build
// enumeration below the optimum. One negative anywhere and the best build might have an empty
// slot the brute force never visits.
//
// C.DMG RANGES FAR WIDER THAN C.RATE, which is both what the game does — a C.DMG total runs into
// the hundreds while C.RATE caps at 100 — and what makes the crit box wide enough to be worth
// certifying. A narrow box makes both McCormick estimators nearly exact and the `gap` nearly
// zero, so the bound would never be exercised anywhere near its loose regime.
const statsArb = fc.record({
  HP: fc.integer({ min: 0, max: 2000 }),
  ATK: fc.integer({ min: 0, max: 200 }),
  DEF: fc.integer({ min: 0, max: 200 }),
  SPD: fc.integer({ min: 0, max: 30 }),
  "C.RATE": fc.integer({ min: 0, max: 30 }),
  "C.DMG": fc.integer({ min: 0, max: 200 }),
  RES: fc.integer({ min: 0, max: 40 }),
  ACC: fc.integer({ min: 0, max: 40 }),
});

// A real decoded-artifact Item whose vector is exactly `stats`. HP, ATK and DEF go in FLAT so the
// vector is the drawn numbers rather than a percentage of a base the generator also draws — the
// property is about the solver, not about re-deriving contribution's percent branch, which
// power-solve.test.mjs pins directly.
const mkItem = (id, slot, set, stats) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 1, isFlat: true, value: stats.HP },
  substats: [
    { statId: 2, isFlat: true, rolls: 0, value: stats.ATK, glyph: 0 },
    { statId: 3, isFlat: true, rolls: 0, value: stats.DEF, glyph: 0 },
    { statId: 4, isFlat: true, rolls: 0, value: stats.SPD, glyph: 0 },
    { statId: 5, isFlat: false, rolls: 0, value: stats["C.RATE"], glyph: 0 },
    { statId: 6, isFlat: false, rolls: 0, value: stats["C.DMG"], glyph: 0 },
    { statId: 7, isFlat: true, rolls: 0, value: stats.RES, glyph: 0 },
    { statId: 8, isFlat: true, rolls: 0, value: stats.ACC, glyph: 0 },
  ],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
});

// The crit sets the generator leans on, with the piece count at which each FIRST pays anything
// READ OFF set-bonuses.mjs rather than typed in. 5 and 6 are two-piece stackers and 60 (Slayer)
// pays from a single piece — and keeping the threshold derived is what stops the coverage floor
// below drifting away from the table if a patch moves a tier.
const CRIT_SETS = [5, 6, 60];
const ALL_SET_IDS = Object.keys(SET_BONUSES).map(Number);
const firstPayingCount = (setId) => {
  for (let n = 1; n <= 9; n++) if (setBonusTotals(new Map([[setId, n]])).size > 0) return n;
  return Infinity;
};

// Weighted toward the crit sets so an instance often COMPLETES one. Five slots drawing flat over
// 41 sets would complete a crit set only by accident, and the crit term is the whole reason this
// solver is not just build-solve. Set 0 is setless and carries no bonus at all.
const setArb = fc.oneof(
  { arbitrary: fc.constantFrom(...CRIT_SETS), weight: 6 },
  { arbitrary: fc.constantFrom(...ALL_SET_IDS), weight: 2 },
  { arbitrary: fc.constant(0), weight: 1 },
);

// One list of items PER SLOT rather than a flat array whose slots are drawn at random, so an
// instance can pile a set into enough slots to complete it. At most three items a slot.
const instance = fc.record({
  perSlot: fc.array(
    fc.array(fc.record({ set: setArb, stats: statsArb }), { minLength: 1, maxLength: 3 }),
    { minLength: 1, maxLength: SLOT_IDS.length },
  ),
  // Positive, as weightsFor always returns. Small integers rather than doubles, so an instance
  // that fails can be read by hand instead of through fifteen significant digits.
  weights: fc.record({
    b: fc.integer({ min: 1, max: 20 }),
    r: fc.integer({ min: 1, max: 20 }),
    a: fc.integer({ min: 1, max: 20 }),
    s: fc.integer({ min: 1, max: 20 }),
    k: fc.integer({ min: 1, max: 20 }),
  }),
  base: statsArb,
  loreOfSteel: fc.constantFrom(0, 0.15),
  // Which item each slot is currently wearing, or none when the draw is -1: a copy can have an
  // empty slot, and the worn build is then NOT one of the full builds the brute force enumerates.
  wornPick: fc.array(fc.integer({ min: -1, max: 2 }),
    { minLength: SLOT_IDS.length, maxLength: SLOT_IDS.length }),
});

// `current` is drawn from `items` BY REFERENCE, not rebuilt. solvePower's documented assumption
// is that the worn gear is in the pool, and every bound rests on it: the crit box is the non-gear
// totals plus the most any assignment of `items` can add, so a worn piece absent from the pool
// could sit outside that box and make `gap` negative.
const vaultOf = (spec) => {
  const items = spec.perSlot.flatMap((specs, i) =>
    specs.map((s, j) => mkItem(i * 10 + j + 1, SLOT_IDS[i], s.set, s.stats)));
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const current = [];
  spec.perSlot.forEach((specs, i) => {
    const inSlot = bySlot.get(SLOT_IDS[i]);
    const pick = spec.wornPick[i];
    if (pick >= 0 && pick < inSlot.length) current.push(inSlot[pick]);
  });
  return { items, current };
};

const champStatsOf = (spec) => ({
  base: { ...spec.base },
  sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
  observedSets: new Map(), loreOfSteel: spec.loreOfSteel, awaken: 0,
});

// The stat model's columns summed WITHOUT rounding. This is the INDEPENDENT second implementation
// of buildTotals: it goes through champion-stats.mjs and nothing in power-solve.mjs, so the
// property compares two implementations rather than one against itself.
const totalsVia = (champStats, items) => {
  const { columns } = statBreakdown(champStats, items);
  return Object.fromEntries(STATS.map((stat) =>
    [stat, columns.reduce((sum, [, v]) => sum + v[stat], 0)]));
};

// Every combination of one item per populated slot, scored on the TRUE objective. Filling every
// slot loses nothing: every stat a piece adds is non-negative, so C.RATE and 100 + C.DMG both
// only grow and the crit product grows with them — a piece can never lower the objective, so the
// best FULL build is the best build, and the worn build with an empty slot cannot beat it.
//
// Push/pop rather than a fresh array per node, because the coverage test below runs this shape
// two thousand times.
function bruteForceBest(items, champStats, weights) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  const chosen = [];
  let best = -Infinity;
  const walk = (i) => {
    if (i === slots.length) {
      best = Math.max(best, lin(totalsVia(champStats, chosen), weights));
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

// Measured locally: 1.0 s at the default 300 runs, and 31.3 s at 10,000 — so a fuzz shard's
// 25,000 would overrun, and the 50 s interrupt above is a live limit there rather than a safety
// net. A shard runs however many instances fit and passes.
//
// All four assertions live in ONE property so an instance runs the brute force and the solver
// once between them, rather than four times over four properties drawing four different vaults.
//
// TWO MUTATIONS were run against this property, and only one of them fails it — recorded here
// because the half that does NOT is the more useful fact:
//
//   - Halving `upperBound` fails on the FIRST instance (80 against an optimum of 160). The bound
//     assertion is doing real work.
//   - Dropping the worn gear out of the candidate pool — the round-0 seed — survives 10,000
//     instances. So the "never below the worn gear" assertion here is NOT what holds round 0 in
//     place; power-solve.test.mjs's never-worse case is, and it is a hand-built pool precisely
//     because this generator does not reach the state. The pathology needs the worn build to be
//     at or near the true optimum while a crit-lopsided lure outscores it on the linearization,
//     and `current` is drawn at RANDOM per slot, so over five slots of three items that
//     coincidence is rare by construction. Left as a cheap invariant rather than removed: it
//     still catches `builds` being read off the last round instead of the pool.

test("the certificate bounds the optimum and the answer never drops below the worn gear", () => {
  fc.assert(
    fc.property(instance, (spec) => {
      const { items, current } = vaultOf(spec);
      const champStats = champStatsOf(spec);
      const { weights } = spec;
      const optimum = bruteForceBest(items, champStats, weights);
      const got = solvePower({ items, faction: 0, champStats, current, weights });
      const wornLin = lin(totalsVia(champStats, current), weights);

      expect(noLessThan(got.upperBound, optimum),
        `upperBound ${got.upperBound} must bound the optimum ${optimum}`).toBe(true);
      expect(noLessThan(optimum, got.builds[0].lin),
        `the answer ${got.builds[0].lin} cannot beat the optimum ${optimum}`).toBe(true);
      expect(noLessThan(got.builds[0].lin, wornLin),
        `the answer ${got.builds[0].lin} cannot be below the worn gear ${wornLin}`).toBe(true);
      expect(noLessThan(got.gap, 0), `the gap ${got.gap} cannot be negative`).toBe(true);
    }),
    PARAMS,
  );
}, 60_000);

// The generator IS the test. When it narrows, nothing else here complains — which is how a
// property file can come to draw setless pieces only while claiming to exercise a crit-set
// solver. So the state the property exists to cover is asserted REACHABLE rather than left to
// inspection.
//
// Unseeded and sampled wide on purpose: a fixed seed would make the floor below hostage to
// fast-check changing how it generates between versions.
//
// Measured locally: 1,608 of 2,000 instances can complete some crit set, in 0.2 s. That clears
// the floor below by roughly thirty standard deviations, so a passing run is not a near miss.
test("the generator reaches a completed crit set often enough to count as covered", () => {
  let hits = 0;
  for (const spec of fc.sample(instance, 2000)) {
    const { items } = vaultOf(spec);
    // How many DISTINCT slots could supply each crit set — the same quantity build-solve's
    // slotsSupplying works from, and what decides whether a set is completable at all.
    const supply = new Map(CRIT_SETS.map((setId) => [setId, new Set()]));
    for (const it of items) if (supply.has(it.set)) supply.get(it.set).add(it.slot);
    if (CRIT_SETS.some((setId) => supply.get(setId).size >= firstPayingCount(setId))) hits++;
  }
  // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
  // covered by the 300 instances the property above actually runs. At 5% it is hit a dozen times
  // or more in a default run, and hundreds of times in a fuzz shard.
  expect(hits, "a completed crit set is generated too rarely to count as covered")
    .toBeGreaterThan(100);
}, 60_000);
