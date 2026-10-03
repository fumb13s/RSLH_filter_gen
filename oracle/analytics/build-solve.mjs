// oracle/analytics/build-solve.mjs
//
// The provably best build for an objective that is a per-item VALUE plus a per-(set, count)
// BONUS. Stat-agnostic by construction: it is handed `valueOf` and `bonusAt` and knows nothing
// about what they measure.
//
// WHY A SECOND SOLVER. speed-solve.mjs enumerates set plans and runs a counts-state DP per plan.
// Its exactness rests on every speed bonus needing at least TWO pieces, so at most four sets can
// be active in nine slots and one plan can name all of them. Newer sets pay out from a SINGLE
// piece. A build can then hold nine active sets at once — more than any plan can name — and that
// argument collapses. The fix is not a bigger plan space (nine-set plans number in the billions)
// but a different shape: plans still name only the sets held at a multi-piece count, and every
// one-piece bonus is bought instead by a SINGLETON COLUMN in the assignment, one per set, usable
// once.
//
// WHY IT IS EXACT. Take an optimal build B. Name each set B holds at or above one of its useful
// counts, at the largest such count. At most four such sets fit in nine slots, so this plan is
// enumerated. Map B into that plan: `count` pieces of each plan set go to that set's plan
// columns; one piece of every other set with `bonusAt[1] > 0` goes to that set's singleton
// column; every remaining piece goes to its slot's free column. Below its first useful count a
// set gains nothing past its first piece, and a plan set gains nothing past its named count, so
// this assignment credits all of B's value. No realized build scores below its assignment's
// credited value, because bonuses never decrease with more pieces and singleton columns credit
// distinct sets outside the plan, once each. So the best realized score over all plans equals B's.
//
// WHY AT MOST FOUR. A useful count is at least two — one-piece bonuses are bought by singleton
// columns and never enter a plan — so a fifth named set would need a tenth slot.
//
// NO BRANCH AND BOUND. speed-solve.mjs prunes plans against an incumbent; that bound does not
// carry over. Here a plan's assignment also collects singleton bonuses for sets OUTSIDE the plan,
// so a bound computed from the sets a plan names is not an upper bound at all, and one that added
// every singleton bonus to be safe would prune almost nothing. `top` needs every plan's best
// anyway. So every plan is assigned, and the cost per call is uniform and predictable.
//
// SCORING IS ALWAYS ON THE ACTUAL ITEMS, never on the plan: a free pick carries an item that
// belongs to some set and can complete one by accident, and that has to count. `credited` is what
// an assignment paid for and is a LOWER bound on the realized score; `scoreBuild` is the realized
// score.

export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// slot -> setId -> the best item of that set in that slot, by the caller's valuation. For a fixed
// slot->set assignment nothing else about a slot matters, so this IS the search space. Accessory
// slots (7-9) are filtered to the champion's faction, a hard game constraint. Ties break on the
// lower item id so a rerun returns the same build.
//
// Identical in shape to speed-solve.mjs's buildIndex with a generic `value` in place of `speed`.
// The duplication is deliberate: folding the two together means moving speed.mjs onto this
// solver, which is its own change.
export function buildIndex(items, faction, valueOf) {
  const index = new Map();
  for (const item of items) {
    if (item.isAccessory && item.faction !== faction) continue;
    let bySet = index.get(item.slot);
    if (!bySet) index.set(item.slot, (bySet = new Map()));
    const value = valueOf(item);
    const current = bySet.get(item.set);
    if (!current || value > current.value
      || (value === current.value && item.id < current.item.id)) {
      bySet.set(item.set, { item, value });
    }
  }
  return index;
}

// How many distinct slots could contribute a piece of this set.
export function slotsSupplying(index, setId) {
  let n = 0;
  for (const bySet of index.values()) if (bySet.has(setId)) n++;
  return n;
}

// The piece counts worth planning around: those where one more piece actually pays. Counts start
// at TWO. A one-piece bonus is never planned — it is bought by a singleton column instead, which
// is the whole reason this solver exists — and a count between two paying counts grants exactly
// the lower one's bonus, so planning it would enumerate the same build twice. `maxSlots` is
// however many slots of this set the pool can actually supply.
export function usefulCounts(bonusAt, setId, maxSlots) {
  const bonus = bonusAt.get(setId);
  const out = [];
  if (!bonus) return out;
  const top = Math.min(maxSlots, SLOTS.length);
  for (let count = 2; count <= top; count++) if (bonus[count] > bonus[count - 1]) out.push(count);
  return out;
}

// The slots this index could fill, always ascending, so every column order and every pick list
// below is the same on a rerun.
const populated = (index) => SLOTS.filter((slot) => index.has(slot));

// A plan names at most four sets. Not a tuning knob: a useful count is at least two pieces, so a
// fifth named set would need a tenth slot. One-piece bonuses are bought by singleton columns and
// never enter a plan, which is what keeps this bound true in a world that has one-piece sets.
const MAX_PLAN_SETS = 4;

function popcount(bits) {
  let n = 0;
  for (let b = bits; b !== 0; b &= b - 1) n++;
  return n;
}

// Every set allocation worth trying: up to four distinct sets, each at one of its useful counts,
// with the counts summing to no more than there are slots to fill.
//
// Two filters, both NECESSARY conditions on a plan being fillable at all, and both cheap. A set
// can only contribute as many pieces as there are slots supplying it — that is `room`. And the
// UNION of the slots supplying a plan's sets must be at least as large as its counts sum to,
// which is Hall's condition on the whole family. The union filter also prunes the RECURSION: a
// plan that fails it is unfillable, and so is every plan containing it, because any assignment
// for the larger plan restricts to one for the smaller. So no fillable plan is ever dropped.
//
// Slot sets are nine-bit masks rather than Sets. This runs a few hundred thousand times per
// solve, and a Set per node is the difference between milliseconds and seconds.
//
// Set 0 is "no set" and is excluded: countsOf skips it, so a bonus attached to it could never be
// credited, and planning it would enumerate plans that can only score as the empty plan does.
export function enumeratePlans(index, bonusAt) {
  const slots = populated(index);
  const mask = new Map();
  for (let i = 0; i < slots.length; i++) {
    for (const setId of index.get(slots[i]).keys()) {
      mask.set(setId, (mask.get(setId) ?? 0) | (1 << i));
    }
  }
  const candidates = [...mask.keys()]
    .filter((setId) => setId !== 0 && bonusAt.has(setId))
    .sort((a, b) => a - b);

  const plans = [[]];
  const extend = (from, current, used, union) => {
    if (current.length === MAX_PLAN_SETS) return;
    for (let i = from; i < candidates.length; i++) {
      const setId = candidates[i];
      const bits = mask.get(setId);
      const room = Math.min(popcount(bits), slots.length - used);
      for (const count of usefulCounts(bonusAt, setId, room)) {
        const nextUnion = union | bits;
        if (popcount(nextUnion) < used + count) continue;
        const next = [...current, { setId, count }];
        plans.push(next);
        extend(i + 1, next, used + count, nextUnion);
      }
    }
  };
  extend(0, [], 0, 0);
  return plans;
}

// setId -> how many picks carry it. Set 0 is "no set" and is skipped, as speed-model.mjs's
// setCounts does, so a build of nine setless pieces has no counts rather than one count of nine.
function countsOf(picks) {
  const counts = new Map();
  for (const p of picks) {
    if (!p.setId) continue;
    counts.set(p.setId, (counts.get(p.setId) ?? 0) + 1);
  }
  return counts;
}

// What a build is actually worth: its items' values, plus each set's bonus AT THE COUNT THE BUILD
// HOLDS. Never at a plan's count — a free pick can complete a set the plan never named, and
// scoring the plan would under-report it.
export function scoreBuild(picks, bonusAt) {
  let total = 0;
  for (const p of picks) total += p.value;
  for (const [setId, count] of countsOf(picks)) total += bonusAt.get(setId)?.[count] ?? 0;
  return total;
}
