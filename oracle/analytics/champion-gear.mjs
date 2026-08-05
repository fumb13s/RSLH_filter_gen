// Per-champion gear triage: rate each piece a champion is WEARING as KEEP / BORDERLINE / SELL.
//
// The vault report (analyze.mjs) can't answer this — its two delete passes (junkTrim, slotBalance)
// skip equipped items by construction, so worn gear always comes back "keep" on supply floors
// rather than merit. Here the call is driven by REPLACEABILITY: how many unequipped spares could
// actually take this piece's place and would finish better. Advisory only; nothing is ever deleted.
//
//   node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
//     name|ID     all digits -> exact Champs.ID; otherwise a case-insensitive Name substring.
//                 Omit for summary mode: one line per geared champion, worst first.
//     snapshot.db an arg ending in .db or containing a slash (default: newest snapshot).

import { keepPremium } from "./triage.mjs";
import { CUTS } from "./weights.mjs";

// Champs.Role is the game's champion type and maps 1:1 onto the analytics archetypes. Verified
// against the 2026-07-12 snapshot: Role=1 champs are uniformly DEF-scaling, Role=2 top the HP
// medians, Role=3 bottom the crit medians. It's static champion data — bare level-1 copies already
// carry it, and 368 of 369 multi-copy names agree across copies (the one exception is a block of
// empty-Name placeholder rows, which hold no gear and are filtered out on read).
export const CHAMP_ROLE = { 0: "ATK-DPS", 1: "DEF-DPS", 2: "HP-DPS", 3: "Support" };
export const CHAMP_ROLE_LABEL = { 0: "Attack", 1: "Defense", 2: "HP", 3: "Support" };

// null for an unrecognised Role — suppresses the role-gap flag, leaves verdicts intact. Indexed
// raw, NOT via Number(): the column has no NOT NULL constraint, and Number(null) is 0, which would
// quietly grade a role-less champion as Attack instead of suppressing the flag.
export const champRole = (row) => CHAMP_ROLE[row?.Role] ?? null;

// p in [0,1], index-based (no interpolation) to match the analytics' existing percentile style.
export function quantile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) * p)];
}

// Could `candidate` (an unequipped spare) actually take `item`'s place on its champion?
//   same slot · same MAIN stat (a C.DMG glove isn't replaced by an HP glove; for Weapon/Helmet/
//   Shield the main is slot-fixed so this is a natural no-op) · same FACTION for accessories
//   (a hard game constraint) · on a set you'd actually build on.
export function inReplacementPool(candidate, item) {
  if (candidate.equippedChampId !== 0) return false;
  if (candidate.slot !== item.slot) return false;
  if (candidate.mainStat.statId !== item.mainStat.statId) return false;
  if (candidate.mainStat.isFlat !== item.mainStat.isFlat) return false;
  if (item.isAccessory && candidate.faction !== item.faction) return false;
  return keepPremium(candidate.set) >= CUTS.focusPremium;
}

// Index key matching inReplacementPool's slot/main/faction clauses. The equipped and demanded-set
// clauses are applied when the index is BUILT (they're properties of the candidate alone), so they
// deliberately don't appear here.
export function bucketKeyFor(item) {
  const m = item.mainStat;
  const base = `${item.slot}|${m.statId}|${m.isFlat ? 1 : 0}`;
  return item.isAccessory ? `${base}|${item.faction}` : base;
}

// Bucket the UNEQUIPPED demanded-set pool by bucketKeyFor, holding each bucket's ceilings in an
// ascending array so betterCount is a binary search instead of a scan. `ceilingOf(item) -> number`.
export function buildPoolIndex(items, ceilingOf) {
  const buckets = new Map();
  for (const it of items) {
    if (it.equippedChampId !== 0) continue;
    if (keepPremium(it.set) < CUTS.focusPremium) continue;
    const k = bucketKeyFor(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(ceilingOf(it));
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a - b);
  return buckets;
}

// Upgrade paths for this slot: pool members whose ceiling is STRICTLY higher (ties are not upgrades).
export function betterCount(index, item, ceiling) {
  const arr = index.get(bucketKeyFor(item));
  if (!arr || !arr.length) return 0;
  let lo = 0, hi = arr.length;                       // first index with arr[i] > ceiling
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= ceiling) lo = mid + 1; else hi = mid;
  }
  return arr.length - lo;
}
