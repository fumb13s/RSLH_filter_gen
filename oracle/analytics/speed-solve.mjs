// Exact maximum-speed gear solver. See the design doc for why this is plan enumeration plus a small
// assignment DP rather than one DP over all set counts.
import { SPEED_SET_IDS, firstThreshold, setEffect, usefulCounts } from "./speed-sets.mjs";
import { buildSpeed, setCounts } from "./speed-model.mjs";

export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// slot -> setId -> the fastest item of that set in that slot. For a fixed slot->set assignment
// nothing else about a slot matters, so this IS the search space: 8474 items collapse to about 1011
// entries. Accessory slots (7-9) are filtered to the champion's faction, a hard game constraint.
// Ties break on the lower item id so a rerun prints the same build.
export function buildIndex(items, faction, speedOf) {
  const index = new Map();
  for (const item of items) {
    if (item.isAccessory && item.faction !== faction) continue;
    let bySet = index.get(item.slot);
    if (!bySet) index.set(item.slot, (bySet = new Map()));
    const speed = speedOf(item);
    const current = bySet.get(item.set);
    if (!current || speed > current.speed
      || (speed === current.speed && item.id < current.item.id)) {
      bySet.set(item.set, { item, speed });
    }
  }
  return index;
}

// How many distinct slots could contribute a piece of this set. A set needs at least its first
// threshold's worth of slots before it can grant anything.
export function slotsSupplying(index, setId) {
  let n = 0;
  for (const bySet of index.values()) if (bySet.has(setId)) n++;
  return n;
}

// The speed sets this pool could actually complete. Everything else is dead weight in the plan
// space, and pruning it here is what keeps enumeration small.
export function viableSets(index) {
  return SPEED_SET_IDS.filter((setId) => slotsSupplying(index, setId) >= firstThreshold(setId));
}

// Every set allocation worth trying: pick up to four viable sets and give each a count that changes
// its bonus. Four is not a tuning knob — nine slots at a two-piece minimum threshold cannot support
// a fifth active set. Counts come from usefulCounts, so a count between two thresholds (which grants
// exactly the lower threshold's bonus) is never enumerated twice.
export function enumeratePlans(index, sets) {
  const plans = [[]];
  const extend = (from, current, used) => {
    if (current.length === 4) return;
    for (let i = from; i < sets.length; i++) {
      const setId = sets[i];
      const room = Math.min(slotsSupplying(index, setId), SLOTS.length - used);
      for (const count of usefulCounts(setId, room)) {
        const next = [...current, { setId, count }];
        plans.push(next);
        extend(i + 1, next, used + count);
      }
    }
  };
  extend(0, [], 0);
  return plans;
}

// Best item in a slot regardless of set — what an unassigned slot takes. Ties break on item id.
function freeBest(bySet) {
  let best = null;
  for (const entry of bySet.values()) {
    if (!best || entry.speed > best.speed
      || (entry.speed === best.speed && entry.item.id < best.item.id)) best = entry;
  }
  return best;
}

// Assign each slot to one of the plan's sets or leave it free, maximising summed item speed subject
// to the plan's counts. State is how many of each plan entry have been placed, which is small enough
// (nine slots, at most four entries) that this is exact rather than heuristic. Returns null when the
// plan cannot be satisfied. Every slot is always filled: item speed is never negative, so an empty
// slot can never win.
export function assign(index, plan) {
  const slots = SLOTS.filter((slot) => index.has(slot));
  const need = plan.map((p) => p.count);
  if (need.reduce((sum, n) => sum + n, 0) > slots.length) return null;

  let states = new Map([[need.map(() => 0).join(","), { speed: 0, picks: [] }]]);
  for (const slot of slots) {
    const bySet = index.get(slot);
    const free = freeBest(bySet);
    const next = new Map();
    const offer = (key, speed, picks) => {
      const current = next.get(key);
      if (!current || speed > current.speed) next.set(key, { speed, picks });
    };
    for (const [key, state] of states) {
      const placed = key.split(",").map(Number);
      for (let i = 0; i < plan.length; i++) {
        if (placed[i] >= need[i]) continue;
        const entry = bySet.get(plan[i].setId);
        if (!entry) continue;
        const advanced = placed.map((v, j) => (j === i ? v + 1 : v)).join(",");
        offer(advanced, state.speed + entry.speed, [...state.picks, entry.item]);
      }
      if (free) offer(key, state.speed + free.speed, [...state.picks, free.item]);
    }
    states = next;
    if (states.size === 0) return null;
  }
  return states.get(need.join(","))?.picks ?? null;
}

// The provable maximum, not a heuristic. Every plan is enumerated and each resulting build is scored
// on the items it actually contains — a free slot's item belongs to some set and may complete one by
// accident, so scoring the plan instead would under-report.
//
// The branch-and-bound is safe despite that: an optimal build's own naming plan has a bound at least
// equal to its score, so it can only be pruned by an incumbent that already equals it.
export function solve(index, base, constant, speedOf) {
  const slots = SLOTS.filter((slot) => index.has(slot));
  if (slots.length === 0) return null;
  const maxFlat = slots.reduce((sum, slot) => sum + freeBest(index.get(slot)).speed, 0);

  let best = null;
  for (const plan of enumeratePlans(index, viableSets(index))) {
    if (best) {
      const counts = new Map(plan.map((p) => [p.setId, p.count]));
      if (base + setEffect(base, counts) + maxFlat + constant <= best.speed) continue;
    }
    const picks = assign(index, plan);
    if (!picks) continue;
    const speed = buildSpeed(base, constant, picks, speedOf);
    if (!best || speed > best.speed) best = { speed, items: picks, plan, counts: setCounts(picks) };
  }
  return best;
}
