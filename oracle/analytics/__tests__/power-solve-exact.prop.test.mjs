// oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
// solvePowerExact claims a PROVEN maximum. On instances small enough to enumerate exhaustively
// that claim is checkable directly — so check it, against a brute force that goes through
// champion-stats.mjs and power-model.mjs and touches nothing in the module under test.
import { test, expect } from "vitest";
import fc from "fast-check";
import { setVectors, solvePower, solvePowerExact } from "../power-solve.mjs";
import { STATS, statBreakdown } from "../champion-stats.mjs";
import { lin } from "../power-model.mjs";
import { SET_BONUSES, setCounts } from "../set-bonuses.mjs";

// vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
// workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
// timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
// runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
// is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const PARAMS = process.env.FC_NUM_RUNS
  ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
  : { numRuns: NUM_RUNS };

// A relative tolerance, IN THE TEST ONLY. The solver and the brute force sum the same terms in
// different orders, so they agree mathematically and can differ in the last bits. Nothing inside
// power-solve.mjs has a tolerance, and smearing an epsilon into the search would hide a real
// pruning bug instead of surfacing it here.
const TOL = 1e-9;
const near = (a, b) => Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
const noLessThan = (a, b) => a >= b - TOL * Math.max(1, Math.abs(b));

// Nine slots, so the brute force is at most 2^9 = 512 builds at two items a slot. All
// non-accessory with faction 0, so the faction lock never fires and which nine slots they are is
// not a distinction buildIndex, candidatesBySlot or the brute force can make — the lock has its
// own case in power-solve-exact.test.mjs.
const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ZERO_STATS = Object.fromEntries(STATS.map((stat) => [stat, 0]));

// Non-negative throughout, and that is load-bearing rather than tidy: it is exactly the
// precondition claim (1) in power-solve.mjs's header rests on. Every stat a piece or a set adds is
// then non-negative, so C.RATE and 100 + C.DMG both only grow and the crit PRODUCT grows with
// them — a piece can never lower the objective, which is what makes the full-build enumeration
// below the optimum over "at most one piece per slot".
//
// C.DMG RANGES FAR WIDER THAN C.RATE, which is both what the game does — a C.DMG total runs into
// the hundreds while C.RATE caps at 100 — and what makes the crit box wide enough that the
// McCormick lanes are loose and the product bound has to carry its share of the pruning.
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
// property is about the search, not about re-deriving contribution's percent branch, which
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

// The set models the search has to reason about, kept to five so plan enumeration stays cheap at
// 25,000 instances: 0 is setless; 5 Critical Rate and 6 Crit Damage are two-piece stackers on the
// two stats the crit product reads; 60 Slayer is TIERED AND PAYS FROM ONE PIECE, with C.RATE +5
// at a single piece, which is the one-piece-tier state the coverage test asserts; 48 Stone Skin is
// a one-piece tier on a NON-crit stat (HP% +8), so the non-crit lane meets one too.
const SETS = [0, 5, 6, 60, 48];

// Weighted toward the crit sets so an instance often COMPLETES one. Drawing flat over 41 sets
// would complete a crit set only by accident, and the crit term is the whole reason this solver is
// not just build-solve.
const setArb = fc.oneof(
  { arbitrary: fc.constantFrom(5, 6, 60), weight: 6 },
  { arbitrary: fc.constantFrom(...SETS), weight: 3 },
  { arbitrary: fc.constant(0), weight: 1 },
);

// Positive, as weightsFor always returns. Small integers rather than doubles, so an instance that
// fails can be read by hand instead of through fifteen significant digits.
const weightsArb = fc.record({
  b: fc.integer({ min: 1, max: 20 }),
  r: fc.integer({ min: 1, max: 20 }),
  a: fc.integer({ min: 1, max: 20 }),
  s: fc.integer({ min: 1, max: 20 }),
  k: fc.integer({ min: 1, max: 20 }),
});

// One list of items PER SLOT rather than a flat array whose slots are drawn at random, so an
// instance can pile a set into enough slots to complete it — and so nine populated slots is an
// ordinary draw rather than a coincidence. At most two items a slot caps the brute force at 2^9.
//
// `minSlots` is what makes the nine-slot draw land: fc.array biases short, so an unconstrained
// nine-slot generator averages five populated slots and reaches nine only by luck.
const instanceWith = ({ setArb: sets, minSlots = 1 }) => fc.record({
  perSlot: fc.array(
    fc.array(fc.record({ set: sets, stats: statsArb }), { minLength: 1, maxLength: 2 }),
    { minLength: minSlots, maxLength: SLOT_IDS.length },
  ),
  weights: weightsArb,
  base: statsArb,
  loreOfSteel: fc.constantFrom(0, 0.15),
  // Which item each slot is currently wearing, or none when the draw is -1: a copy can have an
  // empty slot, and the worn build is then NOT one of the full builds the brute force enumerates.
  wornPick: fc.array(fc.integer({ min: -1, max: 1 }),
    { minLength: SLOT_IDS.length, maxLength: SLOT_IDS.length }),
});

// THE TRAP DRAW, and the band on `cd` below is derived rather than guessed. Every slot offers the
// SAME pure-C.RATE piece or the SAME pure-C.DMG piece — power-solve.test.mjs's CYCLE fixture
// generalized — and the worn build takes C.RATE everywhere. Identical ratios in every slot are
// what makes this a trap: the linearization picks per slot on whether cr/cd beats CR/(100 + CD),
// which is one threshold for all slots at once, so the iteration can only ever reach the two
// CORNERS and never the mixed build that is the real optimum.
//
// With non-gear C.RATE 0 and C.DMG 25 (the Great Hall's, since base crit is drawn as zero here),
// a build with j of the n slots on C.RATE is worth cr * [j(125) + j(n - j)cd], a downward
// parabola in j peaking at j* = (125/cd + n)/2. The corner j = n is beaten by an interior j
// whenever j* <= n - 1, i.e. cd >= 125/(n - 2) — so n >= 3 and cd >= 125 makes every instance a
// trap. Round 1 also has to leave the worn corner, which it does when 125 < n * cd: at n >= 3 and
// cd >= 125 that is 375 > 125, always.
const trapInstance = fc.record({
  slots: fc.integer({ min: 3, max: SLOT_IDS.length }),
  cr: fc.integer({ min: 10, max: 60 }),
  cd: fc.integer({ min: 125, max: 300 }),
  weights: weightsArb,
  // Crit drawn as ZERO, so the worn corner really has no crit rate and round 1 prices C.DMG at
  // k * C.RATE = next to nothing. The other six stats are drawn, since they are constant across
  // every build of one instance and cannot change which build wins.
  base: statsArb.map((stats) => ({ ...stats, "C.RATE": 0, "C.DMG": 0 })),
  loreOfSteel: fc.constantFrom(0, 0.15),
}).map(({ slots, cr, cd, ...rest }) => ({
  ...rest,
  perSlot: Array.from({ length: slots }, () => [
    { set: 0, stats: { ...ZERO_STATS, "C.RATE": cr } },
    { set: 0, stats: { ...ZERO_STATS, "C.DMG": cd } },
  ]),
  // The C.RATE piece in every slot: index 0 of each pair.
  wornPick: SLOT_IDS.map(() => 0),
}));

// Three draws: a wide one that mixes every set model on any number of slots, one that forces all
// nine slots, and the trap. The coverage test at the bottom of this file holds the mix to the
// three states the properties exist to cover.
const instance = fc.oneof(
  { arbitrary: instanceWith({ setArb, minSlots: 1 }), weight: 2 },
  { arbitrary: instanceWith({ setArb, minSlots: SLOT_IDS.length }), weight: 1 },
  { arbitrary: trapInstance, weight: 1 },
);

// `current` is drawn from `items` BY REFERENCE, not rebuilt. solvePower's documented assumption is
// that the worn gear is in the pool, and every bound rests on it: the crit box is the non-gear
// totals plus the most any assignment of `items` can add, so a worn piece absent from the pool
// could sit outside that box.
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

// Every combination of one item per populated slot, scored on the TRUE objective, best first.
// Filling every slot loses nothing: every stat a piece adds is non-negative, so C.RATE and
// 100 + C.DMG both only grow and the crit product grows with them — a piece can never lower the
// objective, so the best FULL build is the best build, and a worn build with an empty slot cannot
// beat it. The same argument claim (1) in power-solve.mjs's header makes, checked here against a
// search that makes no such assumption beyond enumerating full builds.
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
  let best = { lin: -Infinity, items: [] };
  const walk = (i) => {
    if (i === slots.length) {
      const score = lin(totalsVia(champStats, chosen), weights);
      if (score > best.lin) best = { lin: score, items: [...chosen] };
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

// Measured locally: 1.6 s at the default 300 runs. The 25,000-run figure was NOT measured — the
// implementing session could not set FC_NUM_RUNS — so it is left unstated rather than guessed at.
// Scaling the 300-run figure puts a full shard near 130 s, which is past the 50 s interrupt
// above, so a fuzz shard is expected to stop at 50 s and pass on however many instances fit.
// That is the interrupt working as designed, not a failure; whoever first watches a shard should
// replace this paragraph with the real number.
//
// TWO MUTATIONS were run against this property, and both fail it — recorded here because a
// property written after the code it tests passed on its first run, which is no evidence at all
// that it tests anything:
//
//   - Scaling the node ceiling to 0.9 of itself, so the bound is no longer sound, fails on
//     instance 5 (7,690 against an optimum of 7,700). The pruning really is load-bearing.
//   - Dropping the C.DMG key from the candidate dominance test, so a piece worse on non-crit
//     value and C.RATE but better on C.DMG is discarded, fails on instance 1 (3,910 against an
//     optimum of 5,160).
//
// All five assertions live in ONE property so an instance runs the brute force, the exact search
// and the default mode once between them, rather than three times over three different vaults.
test("the exact search equals an exhaustive search and never trails the default mode", () => {
  fc.assert(
    fc.property(instance, (spec) => {
      const { items, current } = vaultOf(spec);
      const champStats = champStatsOf(spec);
      const { weights } = spec;
      const optimum = bruteForceBest(items, champStats, weights);
      const exact = solvePowerExact({ items, faction: 0, champStats, current, weights });
      const iterated = solvePower({ items, faction: 0, champStats, current, weights });

      // EQUALITY, not a bound in one direction: an answer below the optimum means the search
      // pruned the optimum, and an answer above it means the brute force is wrong or the reported
      // `lin` does not belong to the items returned.
      expect(near(exact.build.lin, optimum.lin),
        `exact ${exact.build.lin} must equal the optimum ${optimum.lin}`).toBe(true);
      // The reported lin really belongs to the items returned, recomputed through the independent
      // stat model rather than read back off the field.
      expect(near(exact.build.lin, lin(totalsVia(champStats, exact.build.items), weights)),
        "the reported lin must be the lin of the items returned").toBe(true);
      expect(noLessThan(exact.build.lin, iterated.builds[0].lin),
        `exact ${exact.build.lin} cannot trail solvePower's ${iterated.builds[0].lin}`).toBe(true);
      expect(exact.provenOptimal).toBe(true);
      expect(exact.plansPruned).toBeLessThanOrEqual(exact.plansTotal);
    }),
    PARAMS,
  );
}, 60_000);

// The one-piece tiers the real table has, READ OFF SET_BONUSES rather than listed, so a set whose
// first tier moves in a patch does not quietly drop out of the state below.
const ONE_PIECE_TIERS = Object.entries(SET_BONUSES)
  .filter(([, row]) => row.kind === "tiered" && row.tiers.some(([threshold]) => threshold === 1))
  .map(([id]) => Number(id));

// ACTIVE, not merely present: a one-piece tier granting HP% pays nothing to a champion whose base
// HP is zero, and counting such a set would make the state look covered while the non-crit lane
// never met a real one-piece bonus at all.
const paysFromOnePiece = (setId, base, loreOfSteel) => {
  const vector = setVectors(setId, base, loreOfSteel)[1];
  return STATS.some((stat) => vector[stat] > 0);
};

// The generator IS the test. When it narrows, nothing else here complains — which is how a
// property file can come to draw four setless slots while claiming to prove a nine-slot
// crit-product search exact. So the three states the property exists to cover are asserted
// REACHABLE rather than left to inspection.
//
// Unseeded and sampled wide on purpose: a fixed seed would make the floor hostage to fast-check
// changing how it generates between versions.
//
// `belowOptimum` is the state that matters most: it is the only one under which the exact search
// has to BEAT its incumbent rather than confirm it, so a generator that never reached it would
// leave the whole branch-and-bound untested by this file. The trap draw exists for it, and reads
// the optimum off the BRUTE FORCE rather than off solvePowerExact, so the check is not circular.
//
// Measured locally: 4.6 s, with 528 below-optimum, 656 nine-slot and 1,235
// active-one-piece-tier instances out of 2,000. The rarest clears the floor below by roughly
// twenty standard deviations, so a passing run is not a near miss.
test("the generator reaches every state the property is supposed to cover", () => {
  const seen = { belowOptimum: 0, nineSlots: 0, onePieceTier: 0 };
  for (const spec of fc.sample(instance, 2000)) {
    const { items, current } = vaultOf(spec);
    const champStats = champStatsOf(spec);
    const { weights } = spec;
    const optimum = bruteForceBest(items, champStats, weights);
    const iterated = solvePower({ items, faction: 0, champStats, current, weights });
    if (iterated.builds[0].lin < optimum.lin - TOL * Math.max(1, optimum.lin)) {
      seen.belowOptimum++;
    }
    if (new Set(items.map((it) => it.slot)).size === SLOT_IDS.length) seen.nineSlots++;
    const held = [...setCounts(optimum.items).keys()];
    if (held.some((setId) => ONE_PIECE_TIERS.includes(setId)
      && paysFromOnePiece(setId, spec.base, spec.loreOfSteel))) {
      seen.onePieceTier++;
    }
  }
  // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
  // covered by the 300 instances the property above actually runs. At 5% each is hit a dozen
  // times or more in a default run, and hundreds of times in a fuzz shard.
  for (const [state, hits] of Object.entries(seen)) {
    expect(hits, `${state} is generated too rarely to count as covered`).toBeGreaterThan(100);
  }
}, 60_000);

// --- performance -------------------------------------------------------------------------------

// Eight set models spanning every mechanic the search has to price: 5 and 6 are two-piece
// stackers on the two crit stats; 41 Fatal and 2 Offense are two-piece stackers that pay ATK%
// (and, for Fatal, C.RATE) off the champion's base; and 60, 59, 48 and 35 are tiered sets that all
// pay from a SINGLE piece, which is what puts one-piece bonuses on every lane at once.
const PERF_SETS = [5, 6, 41, 2, 60, 59, 48, 35];

// A deterministic 32-bit LCG. The wall time recorded below only means something if the instance is
// identical every run, and seeding fast-check for 216 items would be heavier than this.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Measured locally: the solve itself 6.8 s (6825 and 6850 ms), the whole test 6.9 s run alone and
// 9.5 s inside a full `npm test`, from 988 plans of which 13 were pruned. The 15 s TARGET is met
// either way, with a third of it still in hand under full-suite load; the 60 s timeout below is
// the actual pass condition, and that has roughly six times the measured figure in hand for a
// slower CI runner.
//
// `certify: false` on the incumbent does NOT show up here, and should not: it saves four exact
// solves, which on this 216-piece instance are milliseconds. It is a real-vault saving, where
// build-solve.prop.test.mjs measures one solve at 9.7 s.
//
// The numbers are quoted from the run rather than printed by it. An earlier draft logged them
// from inside the test, which put the only console.log in oracle/analytics/__tests__ onto every
// `npm test` and all ten fuzz shards every fifteen minutes — a permanent charge to record a
// number twice.
//
// A plain seeded test, NOT an fc.property, so FC_NUM_RUNS does not multiply it. It therefore costs
// the same on every `npm test` and on each of the ten fuzz shards every fifteen minutes — a known
// and accepted charge on the local gate, matching build-solve.prop.test.mjs's own.
//
// This is a MEDIUM instance and deliberately not a full vault: 9 slots x 8 sets x 3 items is 216
// pieces, where a real vault is thousands. power-solve.mjs's header says outright that nothing
// bounds this mode's runtime; a real snapshot is a manual timing after merge, not a test.
test("a medium synthetic instance proves its maximum inside the time budget", () => {
  const rand = lcg(20261003);
  const items = [];
  let id = 0;
  for (const slot of SLOT_IDS) {
    for (const set of PERF_SETS) {
      for (let n = 0; n < 3; n++) {
        // FOUR stats drawn from all eight, so crit appears throughout rather than on a dedicated
        // minority of pieces, and the non-crit lane has something to weigh against it everywhere.
        const stats = { ...ZERO_STATS };
        const pool = [...STATS];
        for (let pick = 0; pick < 4; pick++) {
          const stat = pool.splice(Math.floor(rand() * pool.length), 1)[0];
          const scale = { HP: 2000, ATK: 200, DEF: 200, SPD: 30,
            "C.RATE": 30, "C.DMG": 60, RES: 40, ACC: 40 }[stat];
          stats[stat] = Math.floor(rand() * scale);
        }
        items.push(mkItem(++id, slot, set, stats));
      }
    }
  }
  const champStats = {
    base: { HP: 20000, ATK: 1500, DEF: 1200, SPD: 100,
      "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 },
    sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
    observedSets: new Map(), loreOfSteel: 0.15, awaken: 0,
  };
  // A real role-default weight row, so the lanes have the magnitudes they will meet in use.
  const weights = { b: 0.0122, r: 0.277, a: 0.0387, s: 0.022, k: 0.00154 };
  // One worn piece per slot, drawn from the vault BY REFERENCE, so solvePower's documented
  // assumption holds.
  const current = SLOT_IDS.map((slot) => items.find((it) => it.slot === slot));

  expect(items).toHaveLength(216);
  expect(current.filter(Boolean)).toHaveLength(9);

  const started = Date.now();
  const got = solvePowerExact({ items, faction: 0, champStats, current, weights });
  const elapsed = Date.now() - started;

  expect(got.provenOptimal).toBe(true);
  expect(got.build.items.map((it) => it.slot).sort((a, b) => a - b)).toEqual(SLOT_IDS);
  // Recomputed from the items returned through the INDEPENDENT stat model, so this checks the
  // reported lin rather than reading back whatever the search put in the field.
  expect(got.build.lin)
    .toBeCloseTo(lin(totalsVia(champStats, got.build.items), weights), 6);
  // Never worse than what the champion is wearing, and never worse than the default mode.
  expect(noLessThan(got.build.lin, lin(totalsVia(champStats, current), weights))).toBe(true);
  expect(noLessThan(got.build.lin,
    solvePower({ items, faction: 0, champStats, current, weights }).builds[0].lin)).toBe(true);
  // A floor, not the measured figure — the measured one is in the comment above. This catches the
  // set mix collapsing to a handful of plans, which would make the timing meaningless.
  expect(got.plansTotal).toBeGreaterThan(100);
  // The pass condition is this test's 60 s timeout; asserting it here names the budget at the
  // point a reader is looking at the number, rather than leaving it implicit in the timeout.
  expect(elapsed).toBeLessThan(60_000);
}, 60_000);
