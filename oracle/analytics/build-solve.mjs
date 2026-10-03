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
