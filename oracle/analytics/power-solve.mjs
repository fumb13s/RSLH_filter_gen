// oracle/analytics/power-solve.mjs — header completed in Task 19.
import { buildIndex, SLOTS, solve } from "./build-solve.mjs";
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
export function buildTotals(champStats, items) {
  const { base, loreOfSteel } = champStats;
  const out = nonGearTotals(champStats);
  for (const item of items) addInto(out, itemVector(item, base));
  for (const [setId, count] of setCounts(items)) {
    addInto(out, setVectors(setId, base, loreOfSteel)[count]);
  }
  return out;
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

  // THE BOX. Gear only ADDS crit — every item stat and every set bonus is non-negative — so the
  // non-gear totals are the floor, and the ceiling is that floor plus the most any assignment can
  // add, which is one exact solve weighting that stat alone. Those two solves are cheap: a set
  // with no crit gets an all-zero column, which build-solve's usefulCounts skips (no increase)
  // and singletonSets skips (bonus[1] > 0 fails), so plan enumeration collapses onto the crit
  // sets alone rather than walking all 41.
  const maxGear = (stat) => {
    const index = buildIndex(items, faction, (item) => vectorOf.get(item)[stat]);
    const bonusAt = new Map([...setVecs]
      .map(([setId, vectors]) => [setId, vectors.map((v) => v[stat])]));
    const ranked = solve(index, bonusAt, { top: 1 });
    return ranked.length ? ranked[0].score : 0;
  };
  const CRlo = nonGear["C.RATE"];
  const CDlo = nonGear["C.DMG"];
  const CRhi = CRlo + maxGear("C.RATE");
  const CDhi = CDlo + maxGear("C.DMG");

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
