// oracle/analytics/power-solve.mjs
//
// The gear assignment, out of the whole vault, that maximizes a champion's in-game POWER. Two
// modes. The DEFAULT linearizes the crit term, solves exactly, iterates to a fixed point, and
// certifies how far the answer could still be from the maximum. solvePowerExact PROVES the
// maximum instead, and costs more.
//
// WHY MAXIMIZING `lin` MAXIMIZES POWER. power-model.mjs gives power = (lin + c)^2, where `lin` is
// a weighted sum of stat totals and `c` is a property of the COPY that no gear change can move.
// Squaring is increasing on the non-negative reals, so ranking builds by (lin + c)^2 is ranking
// them by lin + c, and ranking them by lin + c is ranking them by lin. That argument needs
// lin + c > 0, which holds for every build this module reports: the candidate pool is seeded with
// the gear already worn, whose power is an observed in-game number and therefore positive, and
// every build reported scores at or above it. So `c` never enters this module at all, and a
// caller does not have to measure one to rank builds.
//
// THE LINEARIZATION. `lin` is additive over pieces and over set bonuses in every term but one:
// k * C.RATE * (100 + C.DMG) is a PRODUCT of two build totals, so a piece's crit value depends on
// what the other eight slots hold, and no per-item value can express it. Freeze C.RATE and C.DMG
// at reference levels and that term splits into two per-stat scalars — C.RATE weighted by
// k * (100 + cdRef) and C.DMG by k * crRef — leaving an objective that is a per-item value plus a
// per-(set, count) bonus, which is exactly what build-solve.mjs solves exactly. So: linearize at
// the gear already worn, solve exactly, re-linearize at the answer, and repeat.
//
// A FIXED POINT, NOT AN OPTIMUM. When the iteration stops because the build stopped changing
// (`converged`), the answer is a fixed point of that map — the exact optimum of the objective
// linearized at its own crit totals. That is NOT the optimum of the true objective, and nothing
// here claims it is. The iteration can also CYCLE between two builds, or run out at `maxRounds`,
// and then there is no fixed point either; both report `converged: false`. In every case the
// answer is the best build on the TRUE objective out of every build any round produced, plus the
// gear already worn as round 0 — which is what makes it never worse than what the champion is
// wearing. Without that seed a cycle can end on a build below the worn gear, and the answer would
// be a downgrade reported as an improvement.
//
// WHAT IS PROVED. `upperBound` is a genuine upper bound on the true objective over EVERY
// assignment of this vault, so `gap` is a proven ceiling on how much the answer could be
// improved — "within X of the maximum", never "the maximum". It comes from McCormick estimators
// of the crit product over the box of C.RATE and C.DMG the vault can actually reach, each of
// which is affine and therefore one more exact solve. The bound is LOOSE exactly when that box is
// wide — a champion whose crit can swing from almost nothing to a fully stacked double-crit build
// — and a wide `gap` is the signal to pay for solvePowerExact instead of trusting this one.
//
// `current` IS ASSUMED DRAWN FROM `items`. Every bound rests on it: the crit box is the non-gear
// totals plus the most any assignment of `items` can add, so a worn piece that is not in the pool
// could sit outside that box and make `gap` negative rather than zero. Not checked, because the
// one precondition worth paying for on every call is the weights; a vault that omits worn gear is
// a caller bug upstream of here.
//
// WHY solvePowerExact IS EXACT. Four claims, in the order the code makes them.
//
// (1) FULL BUILDS ARE ENOUGH. With every weight >= 0 and every stat a piece or a set adds >= 0,
// `lin` is non-decreasing in every stat total: its non-crit part is a non-negative combination,
// and the crit product k * C.RATE * (100 + C.DMG) grows with each factor while both stay
// non-negative. A set's bonus never shrinks with more pieces either — setVectors is
// non-decreasing in count, which power-solve.test.mjs pins against the real table. So filling a
// slot never lowers the objective, and the best build taking one piece in EVERY slot the pool can
// fill is the best build over "at most one piece per slot". The search therefore enumerates full
// builds only. This rests on CRlo >= 0 and 100 + CDlo >= 0 — true for every champion the game
// has, and documented rather than checked, as `current` is.
//
// (2) A PIECE MATTERS THROUGH THREE NUMBERS. Fix a slot and a set. Then which piece of that set
// fills the slot cannot change the build's set COUNTS, and the objective reads the piece only
// through its non-crit linear value, its C.RATE and its C.DMG — because the non-crit part of
// `lin` is a single linear functional of the stat vector, so a piece enters it as one scalar, and
// the crit part reads those two stats and nothing else. Those three are a sufficient statistic
// for a piece, so one that is no better than another of the same slot and set on all three can be
// dropped with nothing lost. Of pieces equal on all three exactly one survives, the lowest id, as
// buildIndex's tie-break does.
//
// (3) NO BOUND PRUNES THE OPTIMUM. Two bounds, both strict-only: a branch is cut when its
// ceiling is STRICTLY below the incumbent, so the branch holding the optimum survives a ceiling
// that merely equals it. The PLAN bound is valid for every build whose naming plan is that plan —
// the build's true objective is at most its McCormick estimator value, that estimator value is
// exactly what the assignment credits the build under its naming plan, and that credited value is
// at most the plan's assignment maximum. Every build has a naming plan, so the surviving plans
// cover every build that could beat the incumbent. The NODE bound is the smaller of three
// ceilings on the final objective of any completion: the issue's product of three independently
// maximized totals, and each McCormick estimator read as one affine lane. Each is sound alone
// because every lane is a non-negative linear functional, so a per-slot maximum and a per-set
// headroom are both upper bounds on what the remaining slots can add.
//
// (4) THE SEARCH IS OTHERWISE EXHAUSTIVE. Slot order and candidate order are speed choices: the
// search visits every unpruned leaf whatever order it visits them in.
//
// WHAT THE PLAN COUNTS MEAN. `plansTotal` is every plan build-solve would enumerate for this
// pool, the empty one included; `plansPruned` counts the ones that needed no search, because
// either no assignment can fill them or their bound fell strictly below the incumbent. When every
// plan is pruned the incumbent is already the maximum and no search runs at all. In practice the
// EMPTY plan almost never prunes — its assignment is the best free pick in every slot plus every
// one-piece bonus the pool can reach, which an estimator values above any real build — so the
// counts are a diagnostic on how much of the plan space the bound could rule out, not usually an
// early exit. Said plainly rather than claimed otherwise.
//
// The largest per-plan bound is also a global upper bound, and a tighter one than the
// certificate's: both maximize the same estimator over the same plans, but this one uses each
// plan's `credited`, which never exceeds the realized score solve() maximizes. It is not
// reported, because `provenOptimal` makes it redundant.
//
// FLOAT ORDER, SAID PLAINLY. A leaf's ceiling is the same sum as the score the leaf is then
// given, added in a different order, so the two can differ in the last bits. A leaf dropped that
// way ties the incumbent to within rounding and cannot move the maximum by more than float noise;
// the property test compares against an exhaustive search with a relative tolerance of 1e-9 for
// exactly this reason. `provenOptimal` is a claim about the SEARCH, not about IEEE arithmetic.
//
// WHY NOT ALWAYS. Nothing here bounds the runtime. On a full vault the plan space runs to
// hundreds of thousands of plans and the search to a branching factor per slot, which is why the
// mode is opt-in and the default one certifies instead.
import { assignPlan, buildIndex, enumeratePlans, SLOTS, solve } from "./build-solve.mjs";
import { STATS, contribution, itemEntries, statBreakdown } from "./champion-stats.mjs";
import { SET_BONUSES, setBonusTotals, setCounts } from "./set-bonuses.mjs";
import { lin } from "./power-model.mjs";

const zeros = () => Object.fromEntries(STATS.map((stat) => [stat, 0]));

// Summed over STATS in a FIXED order, and two things rest on that. A rerun returns the same
// build; and bonusAt stays non-decreasing, because IEEE multiplication and addition are each
// monotonic in their operands, so a fixed-order sum of non-negative terms cannot shrink when one
// term grows. That is what lets a set whose bonus at n+1 differs from its bonus at n only in the
// last bits still pass build-solve's checkBonusAt, with no epsilon anywhere.
const dot = (weights, vector) =>
  STATS.reduce((sum, stat) => sum + weights[stat] * vector[stat], 0);

const addInto = (target, vector) => {
  for (const stat of STATS) target[stat] += vector[stat];
  return target;
};

// `lin`'s five weights as one scalar per stat, with the crit PRODUCT frozen at a reference
// build's C.RATE and C.DMG. HP/15 shares `b` with ATK and DEF because fifteen points of HP buy
// what one point of ATK does. Every scalar is non-negative when the weights are, which is what
// makes the per-set bonus tables non-decreasing and so acceptable to build-solve.
export function linearizedWeights(w, crRef, cdRef) {
  return {
    HP: w.b / 15,
    ATK: w.b,
    DEF: w.b,
    SPD: w.s,
    "C.RATE": w.k * (100 + cdRef),
    "C.DMG": w.k * crRef,
    RES: w.r,
    ACC: w.a,
  };
}

// `lin`'s non-crit weights alone, as one scalar per stat. The crit scalars are ZERO rather than
// frozen at a reference, so dot(nonCritWeights(w), totals) is exactly `lin` less its crit
// product. linearizedWeights cannot stand in: at a reference of (0, 0) its C.RATE scalar is
// k * 100, not 0, and a search that used it would double-count every point of crit rate.
export function nonCritWeights(w) {
  return {
    HP: w.b / 15,
    ATK: w.b,
    DEF: w.b,
    SPD: w.s,
    "C.RATE": 0,
    "C.DMG": 0,
    RES: w.r,
    ACC: w.a,
  };
}

// --- stat vectors ------------------------------------------------------------------------------

// What one piece contributes, as an unrounded vector over STATS. UNROUNDED on purpose: the
// objective is evaluated on unrounded totals, and champion-stats.mjs's per-column rounding exists
// to reproduce the game's DISPLAY, not its arithmetic.
export function itemVector(item, base) {
  const out = zeros();
  for (const [key, value] of itemEntries(item)) {
    const [stat, amount] = contribution(key, value, base);
    out[stat] += amount;
  }
  return out;
}

// One set's bonus at 0..9 pieces, as stat vectors. set-bonuses.mjs is multiplier-free, so Lore of
// Steel is applied HERE, once, to every set — the mastery scales all of them, not only the eight
// basic ones. Scaling the summed contribution is the same number as scaling each term, because
// nothing on this path floors: (1 + l) * SUM terms == SUM (1 + l) * terms.
//
// setBonusTotals, not setBonusTerms. The warning on setBonusTotals is about the SPEED model,
// where the game floors each set term against base separately; the Total Stats screen does not,
// and champion-stats.mjs says so outright. Do not reconcile the two here.
export function setVectors(setId, base, loreOfSteel) {
  const scale = 1 + loreOfSteel;
  return Array.from({ length: SLOTS.length + 1 }, (_, count) => {
    const out = zeros();
    for (const [key, value] of setBonusTotals(new Map([[setId, count]]))) {
      const [stat, amount] = contribution(key, value, base);
      out[stat] += amount * scale;
    }
    return out;
  });
}

// Everything a copy has before any gear: its base, the Great Hall, Classic Arena, masteries,
// faction guardians, empowerment, blessing and relic. Read off statBreakdown with NO items, so
// the two models can never drift apart, and summed WITHOUT rounding — statBreakdown's own
// `totals` rounds each column to reproduce the game's screen, which is not what an objective
// should be evaluated on.
export function nonGearTotals(champStats) {
  const out = zeros();
  for (const [, vector] of statBreakdown(champStats, []).columns) addInto(out, vector);
  return out;
}

// The unrounded stat totals of one copy wearing one set of items: what it has before any gear,
// plus each piece, plus each set's bonus AT THE COUNT THE BUILD HOLDS.
//
// Summing per set is exact rather than an approximation: setBonusTerms walks its counts set by
// set independently, so the sum of each set's own totals is the whole build's set totals.
//
// The non-gear part and the two caches are PARAMETERS because solvePowerExact scores a build per
// leaf and already holds all three; recomputing nonGearTotals and every set's ten-entry tier
// table per leaf is the difference between a search that finishes and one that does not. One
// implementation, so the exact search and the default mode can never disagree on a build's score.
//
// `vectorOf` is keyed by item IDENTITY and `setVecs` by set id; both must cover every item and
// every set the build holds. `nonGear` is COPIED rather than mutated, since callers share one.
function totalsFrom(nonGear, items, vectorOf, setVecs) {
  const out = { ...nonGear };
  for (const item of items) addInto(out, vectorOf.get(item));
  for (const [setId, count] of setCounts(items)) addInto(out, setVecs.get(setId)[count]);
  return out;
}

export function buildTotals(champStats, items) {
  const { base, loreOfSteel } = champStats;
  const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
  const setVecs = new Map([...setCounts(items).keys()]
    .map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
  return totalsFrom(nonGearTotals(champStats), items, vectorOf, setVecs);
}

// --- solvePower --------------------------------------------------------------------------------

const WEIGHT_NAMES = ["b", "r", "a", "s", "k"];

// Checked once per call rather than trusted, because both failures are quiet. See the two
// consequences spelled out in the header. weightsFor never returns a bad weight, so this fires on
// a hand-built weights object or a fit that came back undetermined.
function checkWeights(weights) {
  for (const name of WEIGHT_NAMES) {
    const value = weights?.[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`power-solve: weight ${name} is ${value}, must be a finite number >= 0 —`
        + " build-solve needs non-decreasing set bonuses and the McCormick bound needs k >= 0");
    }
  }
}

// A build's identity: its item ids, sorted, so "the same set of items" is one string compare
// however the solver happened to order them. Same key build-solve dedups on.
const itemsKey = (items) => items.map((it) => it.id).sort((a, b) => a - b).join(",");

// THE BOX: the C.RATE and C.DMG every assignment of this pool lies between. Gear only ADDS crit
// — every item stat and every set bonus is non-negative — so the non-gear totals are the floor,
// and the ceiling is that floor plus the most any assignment can add, which is one exact solve
// weighting that stat alone. Those two solves are cheap: a set with no crit gets an all-zero
// column, which build-solve's usefulCounts skips (no increase) and singletonSets skips
// (bonus[1] > 0 fails), so plan enumeration collapses onto the crit sets alone rather than
// walking all 41.
//
// Shared by the certificate and by solvePowerExact, which needs the SAME box: a McCormick
// estimator is an upper bound only over a box that covers every assignment, so a box computed two
// ways is a bound that holds for one mode and not the other.
function critBox(items, faction, vectorOf, setVecs, nonGear) {
  const maxGear = (stat) => {
    const index = buildIndex(items, faction, (item) => vectorOf.get(item)[stat]);
    const bonusAt = new Map([...setVecs]
      .map(([setId, vectors]) => [setId, vectors.map((v) => v[stat])]));
    const ranked = solve(index, bonusAt, { top: 1 });
    return ranked.length ? ranked[0].score : 0;
  };
  const CRlo = nonGear["C.RATE"];
  const CDlo = nonGear["C.DMG"];
  return { CRlo, CDlo, CRhi: CRlo + maxGear("C.RATE"), CDhi: CDlo + maxGear("C.DMG") };
}

export function solvePower({ items, faction, champStats, current, weights, top = 1,
  maxRounds = 20 }) {
  checkWeights(weights);
  const { base, loreOfSteel } = champStats;

  // Precomputed once: neither depends on the linearization, only on the champion. Rebuilding them
  // per round would re-walk every item's substats and every set's tier table on each pass.
  const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
  const setVecs = new Map(Object.keys(SET_BONUSES).map(Number).sort((a, b) => a - b)
    .map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
  const nonGear = nonGearTotals(champStats);

  // One linearized exact solve: value every piece and every (set, count) by `linWeights`, then
  // hand the pair to build-solve. The score it returns is the GEAR part alone, and every build
  // that comes back is re-scored on the true objective by the caller.
  const solveAt = (linWeights, howMany) => {
    const index = buildIndex(items, faction, (item) => dot(linWeights, vectorOf.get(item)));
    const bonusAt = new Map([...setVecs]
      .map(([setId, vectors]) => [setId, vectors.map((v) => dot(linWeights, v))]));
    return solve(index, bonusAt, { top: howMany });
  };

  // The pool every answer comes out of, keyed on the sorted item ids so a build two rounds both
  // reached is one entry.
  const pool = new Map();
  const record = (buildItems) => {
    const key = itemsKey(buildItems);
    if (!pool.has(key)) {
      const totals = buildTotals(champStats, buildItems);
      pool.set(key, { items: buildItems, totals, lin: lin(totals, weights) });
    }
    return pool.get(key);
  };

  // ROUND 0 is the gear already worn, scored on the true objective and entered FIRST. Without it
  // a cycle can end on a build below what the champion is wearing, and the answer would be a
  // downgrade reported as an improvement.
  const start = record(current);
  const roundOf = new Map([[itemsKey(current), 0]]);
  let reference = { cr: start.totals["C.RATE"], cd: start.totals["C.DMG"] };

  let rounds = 0;
  let converged = false;
  while (rounds < maxRounds) {
    rounds++;
    const ranked = solveAt(linearizedWeights(weights, reference.cr, reference.cd), top);
    // No slot has an eligible item, so there is nothing to iterate on.
    if (ranked.length === 0) break;
    // Every build the round produced joins the pool, and the round's own best is chosen on the
    // TRUE objective rather than on the linearized score it was found by. With top = 1 the two
    // agree by construction; with top > 1 the linearized order is the wrong one.
    let roundBest = null;
    for (const { items: buildItems } of ranked) {
      const scored = record(buildItems);
      if (!roundBest || scored.lin > roundBest.lin) roundBest = scored;
    }
    const key = itemsKey(roundBest.items);
    // Repeating the PREVIOUS round's build is a fixed point. Repeating any EARLIER one is a
    // cycle, and there is no fixed point to report — the iteration would alternate forever.
    const earlier = roundOf.get(key);
    if (earlier !== undefined) { converged = earlier === rounds - 1; break; }
    roundOf.set(key, rounds);
    reference = { cr: roundBest.totals["C.RATE"], cd: roundBest.totals["C.DMG"] };
  }

  // --- the certificate ------------------------------------------------------------------------

  const { CRlo, CDlo, CRhi, CDhi } = critBox(items, faction, vectorOf, setVecs, nonGear);

  // McCORMICK. With x = C.RATE in [CRlo, CRhi] and y = 100 + C.DMG in [Dlo, Dhi], both
  // (CRhi - x)(y - Dlo) >= 0 and (x - CRlo)(Dhi - y) >= 0, which rearrange to
  //
  //   x*y <= CRhi*y + Dlo*x - CRhi*Dlo        and        x*y <= CRlo*y + Dhi*x - CRlo*Dhi
  //
  // valid for EVERY build. Each is AFFINE in the build's C.RATE and C.DMG, so each is the crit
  // term of a linearization plus a constant — the first at (crRef, cdRef) = (CRhi, CDlo), the
  // second at (CRlo, CDhi). Substituting y = 100 + C.DMG, that constant is -k * crRef * cdRef in
  // both cases, so each bound is ONE MORE call of the same solve, with a scalar correction. No
  // bespoke machinery, which is the whole reason the references are written this way round.
  const upperAt = (crRef, cdRef) => {
    const linWeights = linearizedWeights(weights, crRef, cdRef);
    const ranked = solveAt(linWeights, 1);
    const gear = ranked.length ? ranked[0].score : 0;
    return dot(linWeights, nonGear) + gear - weights.k * crRef * cdRef;
  };
  const upperBound = Math.min(upperAt(CRhi, CDlo), upperAt(CRlo, CDhi));

  // The whole POOL, not the last round: the best build may have come from any round, or be the
  // gear already worn. Stable sort, so a tie falls to insertion order — round order, then
  // build-solve's own deterministic ranking — and a rerun returns the same list.
  //
  // These are the best DISTINCT SETS OF ITEMS this iteration happened to see. That is not a
  // proved top-N, and build-solve's own `top` is not either: its entries after the first are the
  // best each OTHER plan could reach. Said plainly rather than claimed otherwise.
  const builds = [...pool.values()]
    .sort((a, b) => b.lin - a.lin)
    .slice(0, Math.max(1, top));
  return { builds, rounds, converged, upperBound, gap: upperBound - builds[0].lin };
}

// --- solvePowerExact ---------------------------------------------------------------------------

// A weights object that reads one stat and ignores the rest, so every quantity the search bounds
// is the same shape — one dot product against a stat vector — and the lanes in searchBest need no
// special case for the two crit stats.
const unitWeights = (stat) => Object.fromEntries(STATS.map((s) => [s, s === stat ? 1 : 0]));

// The probe linearization's weight row. Strictly positive on every stat, which is the only
// property plan enumeration needs — see WHICH PLANS in the header.
const ONES = { b: 1, r: 1, a: 1, s: 1, k: 1 };

// The pieces worth branching on, slot by slot. Once a piece's slot and set are fixed it affects
// the objective only through three numbers — see (2) in the header — so within one (slot, set)
// group every piece no better than another on all three is dropped. Of pieces equal on all three
// the lowest id survives, as buildIndex's tie-break does, so a rerun returns the same build.
//
// Accessory slots are filtered to the champion's faction HERE as well as in buildIndex: a
// candidate list that skipped it would prove a maximum over builds the champion cannot wear.
// Slots outside SLOTS are skipped, because build-solve's `populated` skips them too.
//
// Returns slot -> entry[], ascending slot, each list non-empty and ordered by item id — the
// search re-orders it for speed, and starting from a fixed order is what makes that reproducible.
function candidatesBySlot(items, faction, ncW, vectorOf) {
  const groups = new Map();
  for (const item of items) {
    if (item.isAccessory && item.faction !== faction) continue;
    if (!SLOTS.includes(item.slot)) continue;
    let bySet = groups.get(item.slot);
    if (!bySet) groups.set(item.slot, (bySet = new Map()));
    let group = bySet.get(item.set);
    if (!group) bySet.set(item.set, (group = []));
    const v = vectorOf.get(item);
    group.push({ item, nc: dot(ncW, v), cr: v["C.RATE"], cd: v["C.DMG"] });
  }
  const out = new Map();
  for (const slot of SLOTS) {
    const bySet = groups.get(slot);
    if (!bySet) continue;
    const kept = [];
    for (const group of bySet.values()) {
      for (const x of group) {
        // Weak domination with an id tie-break. At least one member of every group survives: the
        // piece nothing strictly dominates, with the lowest id among those equal to it.
        const beaten = group.some((y) => y !== x
          && y.nc >= x.nc && y.cr >= x.cr && y.cd >= x.cd
          && (y.nc > x.nc || y.cr > x.cr || y.cd > x.cd || y.item.id < x.item.id));
        if (!beaten) kept.push(x);
      }
    }
    kept.sort((a, b) => a.item.id - b.item.id);
    out.set(slot, kept);
  }
  return out;
}

// Depth-first branch and bound over the slots, exhaustive over FULL builds and seeded with the
// incumbent. See (1) to (4) in the header for why it is exact. Everything here that is not a
// bound — the slot order, the candidate order — is a speed choice that cannot move the answer,
// because the search visits every unpruned leaf whatever order it visits them in.
function searchBest({ cands, weights, ncW, estimators, setVecs, nonGear, box, vectorOf, best }) {
  // ONE LANE per quantity the bound tracks. Lanes 0-2 are the non-crit linear value, C.RATE and
  // C.DMG, which the product bound combines; lanes 3 and 4 are the two McCormick estimators, each
  // affine and therefore exactly the same shape — one scalar per piece. Every lane is a
  // NON-NEGATIVE linear functional of a stat vector, which is what makes a per-slot maximum and a
  // set-bonus headroom upper bounds on what the remaining slots can add to it.
  //
  // The estimator lanes are the TIGHT ones: each collapses the crit product into a single scalar
  // per piece, so a slot's maximum is attainable rather than three maxima that may belong to
  // three different pieces. The product bound is the loose one, and the one the issue specifies.
  // Taking the smaller of all three is sound because each is sound on its own.
  const laneW = [ncW, unitWeights("C.RATE"), unitWeights("C.DMG"),
    estimators[0].w, estimators[1].w];
  const laneSet = laneW.map((w) => new Map([...setVecs]
    .map(([setId, vectors]) => [setId, vectors.map((v) => dot(w, v))])));
  // What each lane holds before any gear. The two crit lanes carry the box floors, which ARE the
  // non-gear crit totals; the estimator lanes carry their own affine offsets.
  const laneBase = [dot(ncW, nonGear), box.CRlo, box.CDlo,
    estimators[0].offset, estimators[1].offset];
  const L = laneW.length;

  for (const list of cands.values()) {
    for (const entry of list) entry.lane = laneW.map((w) => dot(w, vectorOf.get(entry.item)));
  }

  // An optimistic single scalar per piece, used ONLY to order the search: its non-crit value plus
  // the most the crit product could ever pay for its crit, at the top of the global box. Ordering
  // by it tries likely-good leaves first, which raises the incumbent early and prunes more.
  const proxy = (entry) =>
    entry.nc + weights.k * (entry.cr * (100 + box.CDhi) + entry.cd * box.CRhi);
  for (const list of cands.values()) {
    list.sort((a, b) => proxy(b) - proxy(a) || a.item.id - b.item.id);
  }
  // Slots whose candidates differ most go FIRST: that is where a choice moves the bound, and a
  // bound that falls early prunes a whole subtree rather than a leaf. Ties on the slot id, so a
  // rerun searches in the same order and returns the same build.
  const spreadOf = (slot) => {
    const list = cands.get(slot);
    return proxy(list[0]) - proxy(list[list.length - 1]);
  };
  const order = [...cands.keys()].sort((a, b) => spreadOf(b) - spreadOf(a) || a - b);
  const n = order.length;

  // suffMax[lane][i]: the largest value each slot from i on could still contribute in that lane,
  // summed. Every slot's candidate list is non-empty, so the inner maximum is always a real one.
  const suffMax = laneW.map((_, lane) => {
    const out = new Float64Array(n + 1);
    for (let i = n - 1; i >= 0; i--) {
      let max = -Infinity;
      for (const entry of cands.get(order[i])) {
        if (entry.lane[lane] > max) max = entry.lane[lane];
      }
      out[i] = out[i + 1] + max;
    }
    return out;
  });

  // suffSupply[i]: setId -> how many slots from i on could supply a piece of it. A tighter cap on
  // a set's remaining headroom than the number of slots left on its own, and the only place the
  // bound uses WHICH sets the remaining slots actually carry. A set no remaining slot supplies is
  // absent, and contributes nothing — correctly, since its count cannot rise.
  const suffSupply = new Array(n + 1);
  suffSupply[n] = new Map();
  for (let i = n - 1; i >= 0; i--) {
    const here = new Map(suffSupply[i + 1]);
    for (const setId of new Set(cands.get(order[i]).map((entry) => entry.item.set))) {
      if (setId !== 0) here.set(setId, (suffSupply[i + 1].get(setId) ?? 0) + 1);
    }
    suffSupply[i] = here;
  }

  // An upper bound on the TOTAL set-bonus increase the remaining slots can still buy in one lane.
  // Per set, its count can rise by at most however many remaining slots supply it, capped by how
  // many slots remain at all; a lane's set column is non-decreasing in count, so that count's
  // bonus less the bonus at the count already held is that set's own ceiling. Summing over sets
  // is LOOSE — the remaining slots cannot feed every set at once — and sound, which is what a
  // bound has to be.
  const laneGain = (lane, depth, counts) => {
    const columns = laneSet[lane];
    const left = n - depth;
    let total = 0;
    for (const [setId, supply] of suffSupply[depth]) {
      const column = columns.get(setId);
      if (!column) continue;
      const held = counts.get(setId) ?? 0;
      const reach = Math.min(held + Math.min(supply, left), SLOTS.length);
      total += column[reach] - column[held];
    }
    return total;
  };

  const laneCeiling = (lane, depth, acc, counts) =>
    laneBase[lane] + acc[lane] + suffMax[lane][depth] + laneGain(lane, depth, counts);

  // The smaller of three sound ceilings on the FINAL objective of every completion of this
  // partial build: the product of the three tracked totals, and each McCormick estimator read off
  // its own lane.
  const ceilingAt = (depth, acc, counts) => {
    let bound = laneCeiling(0, depth, acc, counts)
      + weights.k * laneCeiling(1, depth, acc, counts)
        * (100 + laneCeiling(2, depth, acc, counts));
    for (let lane = 3; lane < L; lane++) {
      const estimate = laneCeiling(lane, depth, acc, counts);
      if (estimate < bound) bound = estimate;
    }
    return bound;
  };

  const chosen = new Array(n);
  const counts = new Map();

  // `acc` is rebuilt per node rather than incremented and undone. Integer counts undo exactly;
  // float lane sums do not, and an add/subtract cycle over a deep search drifts — which would
  // move a ceiling, and a ceiling that drifts DOWN prunes the optimum.
  const walk = (depth, acc) => {
    if (depth === n) {
      // Scored on the TRUE objective from the ACTUAL set counts — so a one-piece tier and a set
      // completed by accident both count — through the same totalsFrom the default mode scores
      // its pool with, so a build's reported `lin` is the one number both modes agree on. Sorted
      // by slot first, so the sum is in the same order whatever order the search reached the
      // slots in and two runs cannot differ in the last bits.
      const picked = chosen.slice().sort((a, b) => a.item.slot - b.item.slot)
        .map((entry) => entry.item);
      const totals = totalsFrom(nonGear, picked, vectorOf, setVecs);
      const score = lin(totals, weights);
      if (score > best.lin) best = { items: picked, totals, lin: score };
      return;
    }
    for (const entry of cands.get(order[depth])) {
      const setId = entry.item.set;
      const held = setId ? counts.get(setId) ?? 0 : 0;
      const next = Float64Array.from(acc);
      for (let lane = 0; lane < L; lane++) {
        next[lane] += entry.lane[lane];
        if (setId) {
          const column = laneSet[lane].get(setId);
          next[lane] += column[held + 1] - column[held];
        }
      }
      if (setId) counts.set(setId, held + 1);
      chosen[depth] = entry;
      // Pruned only when the ceiling is STRICTLY below the incumbent, so the branch holding the
      // optimum survives a ceiling that merely equals it.
      if (ceilingAt(depth + 1, next, counts) >= best.lin) walk(depth + 1, next);
      if (setId) { if (held === 0) counts.delete(setId); else counts.set(setId, held); }
    }
  };
  walk(0, new Float64Array(L));
  return best;
}

export function solvePowerExact({ items, faction, champStats, current, weights }) {
  checkWeights(weights);
  const started = Date.now();
  const { base, loreOfSteel } = champStats;

  const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
  // Every set the bonus table knows, PLUS any set id the pool actually carries, so totalsFrom can
  // look up a held set unconditionally. A set with no row gets an all-zero column, exactly as
  // setBonusTerms gives it nothing — and an all-zero column is inert in build-solve too, which
  // usefulCounts reads as "no count ever pays" and singletonSets as "nothing to buy".
  const setIds = [...new Set([...Object.keys(SET_BONUSES).map(Number),
    ...items.map((item) => item.set)])].filter((setId) => setId !== 0).sort((a, b) => a - b);
  const setVecs = new Map(setIds.map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
  const nonGear = nonGearTotals(champStats);

  const ncW = nonCritWeights(weights);
  const cands = candidatesBySlot(items, faction, ncW, vectorOf);
  // No slot can be filled at all — the pool is empty, or every accessory is the wrong faction.
  // The same answer speed-solve.mjs gives for an empty index, and the only honest one: there is
  // no assignment to prove anything about. No plan was considered, so both counts are zero.
  if (cands.size === 0) {
    return { build: null, provenOptimal: true, plansTotal: 0, plansPruned: 0,
      runtimeMs: Date.now() - started };
  }

  // THE INCUMBENT. The default mode's answer, which is already the worn gear or better, so the
  // screen below starts from a build the champion could actually wear rather than from nothing —
  // and a pool whose every plan falls below it needs no search at all.
  let best = solvePower({ items, faction, champStats, current, weights }).builds[0];

  const box = critBox(items, faction, vectorOf, setVecs, nonGear);
  const bonusOf = (w) => new Map([...setVecs]
    .map(([setId, vectors]) => [setId, vectors.map((v) => dot(w, v))]));

  // THE TWO McCORMICK ESTIMATORS, at the box corners (CRhi, CDlo) and (CRlo, CDhi) — the only two
  // references at which the bound holds, and the same two the certificate uses. Each is affine in
  // the build's C.RATE and C.DMG, so each is one linearization plus a constant; `offset` is
  // everything in it that does not come off gear, namely the non-gear totals at this estimator's
  // weights and its own affine correction of -k * crRef * cdRef.
  const estimators = [[box.CRhi, box.CDlo], [box.CRlo, box.CDhi]].map(([crRef, cdRef]) => {
    const w = linearizedWeights(weights, crRef, cdRef);
    return {
      w,
      bonusAt: bonusOf(w),
      offset: dot(w, nonGear) - weights.k * crRef * cdRef,
      index: buildIndex(items, faction, (item) => dot(w, vectorOf.get(item))),
    };
  });

  // WHICH PLANS. From a STRICTLY POSITIVE linearization, never from `weights`, which may legally
  // be all zero — and an all-zero valuation gives every set an all-zero bonus column, which
  // usefulCounts reads as "no count ever pays" and which would collapse the plan space to the
  // empty plan alone. With every scalar positive a set's bonus rises at exactly the counts its
  // stat bonus does, so the plans are the same whichever positive row is used. enumeratePlans
  // reads the index only for which (slot, set) pairs exist, so the valuation cannot move them
  // either.
  const probeW = linearizedWeights(ONES, 1, 1);
  const probeIndex = buildIndex(items, faction, (item) => dot(probeW, vectorOf.get(item)));
  const plans = enumeratePlans(probeIndex, bonusOf(probeW));
  const plansTotal = plans.length;

  // THE PER-PLAN BOUND, valid for every build whose NAMING PLAN is this plan: the build's true
  // objective is at most its estimator value (McCormick, over a box that covers every
  // assignment); that estimator value is exactly what the assignment credits it under its naming
  // plan (build-solve's exactness argument); and that credited value is at most the plan's
  // assignment maximum, which is what assignPlan returns. So the plan's own maximum plus the
  // estimator's constant terms bounds every build under it, and the smaller of the two estimators
  // is the bound.
  //
  // This does NOT contradict build-solve's own "NO BRANCH AND BOUND": that note is about bounds
  // computed from the sets a plan NAMES, which miss the singleton bonuses an assignment also
  // collects. This bound is the assignment's own `credited`, so it misses nothing.
  const survivors = [];
  for (const plan of plans) {
    let bound = Infinity;
    for (const estimator of estimators) {
      const assigned = assignPlan(estimator.index, estimator.bonusAt, plan);
      // Unfillable, so no build names this plan and there is nothing under it to search. Both
      // estimators agree here: fillability reads only which (slot, set) pairs the index has.
      if (!assigned) { bound = -Infinity; break; }
      bound = Math.min(bound, assigned.credited + estimator.offset);
    }
    // STRICTLY below, so the plan holding the optimum survives a bound that merely equals the
    // incumbent — in which case the incumbent is already optimal and the search confirms it.
    if (bound < best.lin) continue;
    survivors.push(plan);
  }
  const plansPruned = plansTotal - survivors.length;

  // Every build has a naming plan, so when every plan's bound fell below the incumbent the
  // incumbent IS the maximum and there is nothing left to search.
  if (survivors.length > 0) {
    best = searchBest({ cands, weights, ncW, estimators, setVecs, nonGear, box, vectorOf, best });
  }

  return { build: best, provenOptimal: true, plansTotal, plansPruned,
    runtimeMs: Date.now() - started };
}
