import { quality, investment } from "./score.mjs";
import { bucketCounts, bucketKey, floorFor, atOrBelowFloor, setlessDominated } from "./supply.mjs";
import { getSet } from "./sets.mjs";
import { CUTS } from "./weights.mjs";

const ARTIFACT_SLOTS = [1, 2, 3, 4, 5, 6];
const ACC_SLOTS = [7, 8, 9];

// Demand-led keep-premium: scarcity boosts only when demand >= 3 (DESIGN.md §3.6).
export function keepPremium(setId) {
  const { demand, scarcity } = getSet(setId);
  return demand + (demand >= 3 ? scarcity - 2 : 0);
}

// Count of kept UNEQUIPPED pieces in a slot (the pool the slot-balance pass evens out). When
// `faction` is given, only that faction's pieces count (the per-faction accessory pass).
function keptUnequippedInSlot(scored, slot, faction = null) {
  return scored.filter((s) => s.item.slot === slot
    && (faction === null || s.item.faction === faction)
    && s.verdict === "keep" && s.item.equippedChampId === 0).length;
}

// Even one slot family (optionally restricted to a faction) toward its mean kept-unequipped count
// (x balanceFactor), deleting worst-quality-first. Equipped mules aren't part of the pool; invested
// (ascended/glyphed) pieces and below-floor buckets are protected. Mutates `scored` + `live`.
function balanceFamily(scored, slots, live, faction = null) {
  const kept = slots.reduce((n, sl) => n + keptUnequippedInSlot(scored, sl, faction), 0);
  const cap = Math.round((kept / slots.length) * CUTS.balanceFactor);
  const facTag = faction === null ? "" : ` (faction ${faction})`;
  for (const slot of slots) {
    let keptUneq = keptUnequippedInSlot(scored, slot, faction);
    const pool = scored
      .filter((s) => s.item.slot === slot && (faction === null || s.item.faction === faction)
        && s.verdict === "keep" && s.item.equippedChampId === 0 && !s.inv.ascended && !s.inv.glyphed)
      .sort((a, b) => a.q.score - b.q.score);
    for (const s of pool) {
      if (keptUneq <= cap) break;
      const k = bucketKey(s.item);
      if ((live.get(k) || 0) <= floorFor(s.item)) continue; // keep-floor protects spares
      s.verdict = "delete";
      s.slotBalanced = true;
      s.reason = `slot-balance: oversupplied unequipped slot${facTag} (q${s.q.score}), trimmed worst-first toward ~${cap}`;
      live.set(k, live.get(k) - 1);
      keptUneq--;
    }
  }
}

// Slot-balance: even the UNEQUIPPED pool worst-quality-first. Artifacts (slots 1-6) are one family —
// it isn't faction-locked. Accessories are evened PER FACTION: ring/amulet/banner are faction-bound
// gear, so each faction's three slots are balanced against each other, while cross-faction totals are
// left alone (a faction with more usable champions keeps more accessories). Mutates `scored`. (§3.8)
export function slotBalance(scored, counts) {
  if (!CUTS.balanceFactor) return;
  // live unequipped count per bucket = static count minus unequipped deletes already taken.
  const live = new Map(counts);
  for (const s of scored) {
    if (s.verdict === "delete" && s.item.equippedChampId === 0) {
      const k = bucketKey(s.item);
      live.set(k, (live.get(k) || 0) - 1);
    }
  }
  balanceFamily(scored, ARTIFACT_SLOTS, live);
  const factions = [...new Set(scored.filter((s) => s.item.isAccessory).map((s) => s.item.faction))]
    .sort((a, b) => a - b);
  for (const faction of factions) balanceFamily(scored, ACC_SLOTS, live, faction);
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

// Per-slot percentile rank (min -> 0, max -> 100; ties take the lower-edge rank; lone piece -> 100).
function percentileOf(sorted, value) {
  const n = sorted.length;
  if (n <= 1) return 100;
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < value) lo = mid + 1; else hi = mid; }
  return (lo / (n - 1)) * 100;
}

// Tag the top `n` of each (slot x role) group by scoreFn(s).
function tagTopN(pool, roleFn, scoreFn, n, tag) {
  const groups = new Map();
  for (const s of pool) {
    const k = `${s.item.slot}|${roleFn(s)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => scoreFn(b) - scoreFn(a));
    for (let i = 0; i < Math.min(n, arr.length); i++) arr[i][tag] = true;
  }
}

// triage(items) -> array of { item, q, inv, percentile, premium, belowFloor, verdict, reason,
// focus, upgrade, qPotential? }. verdict is delete|keep; focus/upgrade are highlight overlays on keeps.
export function triage(items) {
  const scored = items.map((item) =>
    ({ item, q: quality(item), inv: investment(item), focus: false, upgrade: false }));
  const scoreById = new Map(scored.map((s) => [s.item.id, s.q.score]));
  const counts = bucketCounts(items);
  const dominated = setlessDominated(items, (it) => scoreById.get(it.id) ?? 0);
  const sorted = slotSortedScores(scored);

  for (const s of scored) {
    const p = percentileOf(sorted.get(s.item.slot), s.q.score);
    const premium = keepPremium(s.item.set);
    const belowFloor = atOrBelowFloor(s.item, counts);
    let verdict = "keep", reason = "keep";
    if (dominated.has(s.item.id)) {
      verdict = "delete";
      reason = "setless: dominated by a set accessory in the same faction + slot";
    } else if (p < CUTS.deletePct && !belowFloor && premium <= CUTS.lowPremium) {
      verdict = "delete";
      reason = `low quality (p${Math.round(p)} of slot), oversupplied, low-demand set (premium ${premium})`;
    }
    Object.assign(s, { percentile: p, premium, belowFloor, verdict, reason, slotBalanced: false });
  }

  // Even the unequipped pool within artifacts / accessories (deletes worst-first toward family mean).
  slotBalance(scored, counts);

  // Focus: the best couple to build around per slot x archetype, among kept demanded-set gear.
  tagTopN(scored.filter((s) => s.verdict === "keep" && s.premium >= CUTS.focusPremium),
    (s) => s.q.role, (s) => s.q.score, CUTS.focusPerGroup, "focus");

  // Upgrade: under-leveled kept demanded gear with the best *potential* if taken to 16.
  const upPool = scored.filter((s) => s.verdict === "keep"
    && s.item.level <= CUTS.upgradeMaxLevel && s.premium >= CUTS.focusPremium);
  for (const s of upPool) s.qPotential = quality(s.item, true);
  tagTopN(upPool, (s) => s.qPotential.role, (s) => s.qPotential.score, CUTS.focusPerGroup, "upgrade");

  return scored;
}
