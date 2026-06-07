import { quality, investment } from "./score.mjs";
import { bucketCounts, atOrBelowFloor, setlessDominated } from "./supply.mjs";
import { getSet } from "./sets.mjs";
import { CUTS } from "./weights.mjs";

// Demand-led keep-premium: scarcity boosts only when demand >= 3 (DESIGN.md §3.6).
export function keepPremium(setId) {
  const { demand, scarcity } = getSet(setId);
  return demand + (demand >= 3 ? scarcity - 2 : 0);
}

function slotSortedScores(scored) {
  const bySlot = new Map();
  for (const s of scored) {
    if (!bySlot.has(s.item.slot)) bySlot.set(s.item.slot, []);
    bySlot.get(s.item.slot).push(s.q.score);
  }
  for (const arr of bySlot.values()) arr.sort((a, b) => a - b);
  return bySlot;
}

// Percentile rank of `value` among sorted (ascending) slot scores: slot min -> 0,
// slot max -> 100; a tied group takes its lower-edge rank (# strictly below). A lone
// piece (n <= 1) -> 100 ("top of slot"). This is DESIGN's per-slot percentile: "below
// p25" catches the genuine bottom (incl. tied-junk groups), "at/above p85" the top.
function percentileOf(sorted, value) {
  const n = sorted.length;
  if (n <= 1) return 100;
  let lo = 0, hi = n;                  // lower_bound: count strictly below `value`
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  return (lo / (n - 1)) * 100;
}

// triage(items) -> array of { item, q, inv, percentile, premium, belowFloor, verdict, reason }
export function triage(items) {
  const scored = items.map((item) => ({ item, q: quality(item), inv: investment(item) }));
  const scoreById = new Map(scored.map((s) => [s.item.id, s.q.score]));
  const counts = bucketCounts(items);
  const dominated = setlessDominated(items, (it) => scoreById.get(it.id) ?? 0);
  const sorted = slotSortedScores(scored);

  for (const s of scored) {
    const p = percentileOf(sorted.get(s.item.slot), s.q.score);
    const premium = keepPremium(s.item.set);
    const belowFloor = atOrBelowFloor(s.item, counts);
    let verdict = "keep", reason = "no rule — default keep";
    if (dominated.has(s.item.id)) {
      verdict = "delete";
      reason = "setless: matched/beaten by a set accessory in this faction+slot";
    } else if (p < CUTS.deletePct && !belowFloor && premium <= CUTS.lowPremium) {
      verdict = "delete";
      reason = `bottom ${CUTS.deletePct}% of slot (p${Math.round(p)}), oversupplied, low keep-premium (${premium})`;
    } else if (p >= CUTS.focusPct && premium >= CUTS.focusPremium) {
      verdict = "focus";
      reason = `top of slot (p${Math.round(p)}), demand/scarcity premium ${premium}`;
    }
    Object.assign(s, { percentile: p, premium, belowFloor, verdict, reason });
  }
  return scored;
}
