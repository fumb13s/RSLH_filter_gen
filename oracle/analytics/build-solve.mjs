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

// Maximum-weight assignment of rows to distinct columns, rows <= columns, every row matched. The
// Kuhn-Munkres shortest-augmenting-path form with potentials: O(rows^2 * cols), which at nine
// rows and about thirty columns is a few thousand operations — small enough to run once per plan
// over a few hundred thousand plans.
//
// `weight` is a flat rows*cols array, row-major. Returns the column each row took. Written as a
// MINIMISER fed negated weights, because every published form of this algorithm minimises and
// transcribing one is less error-prone than inventing a maximiser.
//
// Ties go to the lowest column index: both comparisons below are strict, so the first column to
// reach a value keeps it. That makes the result a fixed function of the matrix, which is what
// `solve` needs in order to return the same build on a rerun.
function maxWeightAssignment(weight, rows, cols) {
  const u = new Float64Array(rows + 1);
  const v = new Float64Array(cols + 1);
  const p = new Int32Array(cols + 1);     // p[j] = the 1-based row holding column j, 0 = unheld
  const way = new Int32Array(cols + 1);
  const minv = new Float64Array(cols + 1);
  const used = new Uint8Array(cols + 1);
  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue;
        const cur = -weight[(i0 - 1) * cols + (j - 1)] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowCol = new Int32Array(rows);
  for (let j = 1; j <= cols; j++) if (p[j] > 0) rowCol[p[j] - 1] = j - 1;
  return rowCol;
}

// Best item in a slot regardless of set — what a free column takes. Ties break on item id.
function freeBest(bySet) {
  let best = null;
  for (const entry of bySet.values()) {
    if (!best || entry.value > best.value
      || (entry.value === best.value && entry.item.id < best.item.id)) best = entry;
  }
  return best;
}

const PLAN = 0, SINGLE = 1, FREE = 2;

// The sets worth a singleton column: they pay from a single piece, the plan does not already name
// them, and the index can actually supply them.
//
// Dropping the sets no slot supplies cannot change the answer — every cell of such a column is
// forbidden and a row always has its own free column to take instead — and it keeps the matrix at
// nine rows by about thirty columns on a full vault, rather than growing with the size of the
// bonus table. Set 0 is excluded for the same reason it is excluded from a plan: countsOf skips
// it, so crediting it would make `credited` exceed the realized score.
//
// Ascending set id, so the column order is the same on a rerun.
function singletonSets(index, bonusAt, inPlan) {
  const out = [];
  for (const setId of [...bonusAt.keys()].sort((a, b) => a - b)) {
    if (setId === 0 || inPlan.has(setId)) continue;
    if (!(bonusAt.get(setId)[1] > 0)) continue;
    if (slotsSupplying(index, setId) === 0) continue;
    out.push(setId);
  }
  return out;
}

// The best build this plan can reach, as a maximum-weight assignment of slots to columns.
//
// PLAN columns: `count` of them per named set, each taking that set's indexed item in whichever
// slot it lands, and ALL of them must be filled or the plan is unfillable. SINGLE columns: one
// per set outside the plan that pays from a single piece, carrying that bonus and usable once,
// which is how a build reaches more active sets than a plan can name. FREE columns: one per
// slot, usable only by its own row, taking that slot's best item with no bonus at all.
//
// Column ORDER is fixed — plan pieces in plan order, then singletons by ascending set id, then
// free columns in slot order — so two runs over the same index return the same build.
export function assignPlan(index, bonusAt, plan) {
  const slots = populated(index);
  const need = plan.reduce((sum, p) => sum + p.count, 0);
  if (need > slots.length) return null;

  const inPlan = new Set(plan.map((p) => p.setId));
  const cols = [];
  for (const { setId, count } of plan) {
    for (let k = 0; k < count; k++) cols.push({ kind: PLAN, setId, bonus: 0 });
  }
  // SINGLE columns are what let a build hold more active sets than a plan can name: one per set
  // outside the plan that pays from a single piece, carrying that bonus, usable once.
  for (const setId of singletonSets(index, bonusAt, inPlan)) {
    cols.push({ kind: SINGLE, setId, bonus: bonusAt.get(setId)[1] });
  }
  for (const slot of slots) cols.push({ kind: FREE, slot, bonus: 0 });

  const rows = slots.length;
  const n = cols.length;
  const frees = slots.map((slot) => freeBest(index.get(slot)));
  const base = new Float64Array(rows * n);
  const allowed = new Uint8Array(rows * n);
  let span = 0;
  for (let r = 0; r < rows; r++) {
    const bySet = index.get(slots[r]);
    for (let c = 0; c < n; c++) {
      const col = cols[c];
      let w;
      if (col.kind === FREE) {
        if (col.slot !== slots[r]) continue;
        w = frees[r].value;
      } else {
        const entry = bySet.get(col.setId);
        if (!entry) continue;
        w = entry.value + col.bonus;
      }
      base[r * n + c] = w;
      allowed[r * n + c] = 1;
      if (Math.abs(w) > span) span = Math.abs(w);
    }
  }

  // Two constants large enough that no arrangement of real weights can outvote them. Any
  // assignment's real total lies in [-rows*span, rows*span], so BIG — added to every plan column
  // — makes one more filled plan column beat every possible rearrangement of everything else, and
  // a maximum-weight assignment therefore fills as many plan columns as can be filled. FORBIDDEN
  // costs more than all `rows` plan columns and all the real weight put together, and the
  // all-free assignment is always available, so a maximum-weight assignment never takes one.
  const BIG = 2 * rows * span + 1;
  const FORBIDDEN = -(rows + 1) * BIG;

  const weight = new Float64Array(rows * n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      weight[k] = allowed[k] ? base[k] + (cols[c].kind === PLAN ? BIG : 0) : FORBIDDEN;
    }
  }

  const rowCol = maxWeightAssignment(weight, rows, n);

  // A plan is fillable exactly when every one of its columns got a row. BIG makes the assignment
  // fill as many as it can, so a gap here means no assignment could have filled them all.
  let filled = 0;
  for (let r = 0; r < rows; r++) if (cols[rowCol[r]].kind === PLAN) filled++;
  if (filled < need) return null;

  const picks = [];
  let credited = 0;
  for (let r = 0; r < rows; r++) {
    const c = rowCol[r];
    // Unreachable by the argument above. Loud rather than silent if BIG and FORBIDDEN are ever
    // made too small, because the quiet failure is a build naming an item that is not there.
    if (!allowed[r * n + c]) {
      throw new Error("build-solve: the assignment took a forbidden cell —"
        + " BIG and FORBIDDEN are no longer large enough to rule one out");
    }
    const col = cols[c];
    const entry = col.kind === FREE ? frees[r] : index.get(slots[r]).get(col.setId);
    picks.push({ slot: slots[r], setId: entry.item.set, item: entry.item, value: entry.value });
    credited += base[r * n + c];
  }
  for (const { setId, count } of plan) credited += bonusAt.get(setId)[count];
  return { picks, credited };
}

// Every plan, assigned and then scored on the items it actually produced, best first.
//
// Deduplicated on the sorted item ids, with the FIRST plan to reach a build keeping it, so a
// build is listed under the least committed description of it — a build that completes a set only
// because the best free pieces happened to carry it stays reported under the plan that never
// named that set. Same rule as speed.mjs's topBuilds.
//
// `top` is per-PLAN bests, ranked. Entry 0 is the exact optimum. Entries after it are NOT
// guaranteed to be the true second- and third-best builds: they are the best each OTHER plan
// could reach, and the true runner-up may be a second build under the winning plan, which is
// never generated. Said plainly rather than claimed otherwise.
export function solve(index, bonusAt, { top = 1 } = {}) {
  const slots = populated(index);
  if (slots.length === 0) return [];
  const seen = new Map();
  for (const plan of enumeratePlans(index, bonusAt)) {
    const assigned = assignPlan(index, bonusAt, plan);
    if (!assigned) continue;
    const itemIds = assigned.picks.map((p) => p.item.id).sort((a, b) => a - b);
    const key = itemIds.join(",");
    if (seen.has(key)) continue;
    seen.set(key, {
      score: scoreBuild(assigned.picks, bonusAt),
      items: assigned.picks.map((p) => p.item),
      counts: countsOf(assigned.picks),
      itemIds,
    });
  }
  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, top))
    .map(({ score, items, counts }) => ({ score, items, counts }));
}
