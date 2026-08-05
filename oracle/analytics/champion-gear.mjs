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
import { quality, qualityAtRole } from "./score.mjs";
import { rollStats } from "./rollquality.mjs";
import { ALL_ROLES } from "./sets.mjs";
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

// How miscast is this piece for the champion wearing it? gap = the item's best score across ALL
// FOUR archetypes (unrestricted by the set annotation — this is about the item's stats, not its
// set) minus its score at the champion's own role. Caller flags at CUTS.roleGapFlag.
export function roleGap(item, champRoleName) {
  if (!champRoleName) return null;
  const atChampRole = qualityAtRole(item, champRoleName);
  let best = { role: champRoleName, score: atChampRole };
  for (const role of ALL_ROLES) {
    const score = qualityAtRole(item, role);
    if (score > best.score) best = { role, score };
  }
  return { gap: best.score - atChampRole, bestRole: best.role, atChampRole };
}

// The triage verdict WINS OUTRIGHT. For equipped gear the only rule that can fire is
// setless-domination (junkTrim and slotBalance both skip equipped items), and it is load-bearing:
// 488 of 4192 equipped pieces are setless-dominated yet sit at a MEDIAN of 0 upgrade paths, because
// the replacement pool only counts demanded sets while setlessDominated compares against ANY
// set-bearing accessory. Without this override the metric inverts exactly those pieces.
//
// `cuts.n` is the size of the population the cuts were calibrated on. At 0 the quantiles collapse to
// keepCut = sellCut = 0, and 0 is a cut BOTH branches below match: only a zero count would read
// KEEP, so a vault too small — or too thoroughly condemned — to calibrate would be told to sell
// nearly everything. Advisory tooling has to fail toward KEEP, and say so rather than quoting a
// count as if it were evidence. Cuts handed in without an `n` are a caller stating them outright.
export function verdictFor({ triageVerdict, triageReason, better }, cuts) {
  if (triageVerdict === "delete") return { verdict: "SELL", reason: `triage: ${triageReason}` };
  if (cuts.n === 0) return { verdict: "KEEP", reason: "uncalibrated: no equipped gear to compare against" };
  const reason = `${better} upgrade path${better === 1 ? "" : "s"}`;
  if (better <= cuts.keepCut) return { verdict: "KEEP", reason };
  if (better >= cuts.sellCut) return { verdict: "SELL", reason };
  return { verdict: "BORDERLINE", reason };
}

// Cut points are quantiles of the vault's OWN equipped gear, so they self-calibrate as it grows.
// Global rather than per-slot on purpose: per-slot quantiles rate a weapon with 149 upgrade paths
// as KEEP (the weapon slot's own p50 is 181). Holding more spare weapons than spare gloves genuinely
// does make weapons more disposable. `n` is the population size — see verdictFor for what 0 means.
export function resolveCuts(betterCounts) {
  return {
    keepCut: quantile(betterCounts, CUTS.gearKeepQuantile),
    sellCut: quantile(betterCounts, CUTS.gearSellQuantile),
    n: betterCounts.length,
  };
}

// One pass over the vault: ceilings, the pool index, the triage lookup, and the resolved cuts.
// `scored` is the output of triage(items). Ceilings are quality-at-POTENTIAL — level-independent,
// substat TYPES only — because the pool is spares that would have to be leveled: the question is
// which of them would finish better, not which is further along today.
export function buildContext(items, scored) {
  const ceiling = new Map(items.map((it) => [it.id, quality(it, true).score]));
  const index = buildPoolIndex(items, (it) => ceiling.get(it.id));
  const byId = new Map(scored.map((s) => [s.item.id, s]));
  // Calibrate on equipped gear the triage hasn't already condemned.
  const counts = items
    .filter((it) => it.equippedChampId > 0 && byId.get(it.id)?.verdict === "keep")
    .map((it) => betterCount(index, it, ceiling.get(it.id)));
  return { ceiling, index, byId, cuts: resolveCuts(counts) };
}

export function rateItem(item, ctx, champRoleName) {
  const s = ctx.byId.get(item.id);
  const ceil = ctx.ceiling.get(item.id);
  // A ceiling the context doesn't hold is `undefined`, and `arr[mid] <= undefined` is false all the
  // way down betterCount's binary search — the piece would come back maximally replaceable and get
  // sold, silently. quality(item, true).score itself can't be non-finite: at potential it reads stat
  // TYPES only (never a decoded value), every weight is a finite constant, an unrecognised stat id
  // or slot scores 0, and the divisor is a max over the slot's own primaries with a `|| 1` guard.
  // So this only fires on an item buildContext never saw, and that is a caller error.
  if (!Number.isFinite(ceil)) {
    throw new Error(`champion-gear: no ceiling for item ${item.id} — rateItem needs an item buildContext saw`);
  }
  const better = betterCount(ctx.index, item, ceil);
  const { verdict, reason } = verdictFor(
    { triageVerdict: s.verdict, triageReason: s.reason, better }, ctx.cuts);
  const rg = roleGap(item, champRoleName);
  return {
    item, better, ceiling: ceil, verdict, reason,
    q: s.q.score, role: s.q.role, percentile: Math.round(s.percentile),
    premium: keepPremium(item.set), rolls: rollStats(item, s.q.role),
    roleGap: rg && rg.gap >= CUTS.roleGapFlag ? rg : null,
  };
}

const VERDICT_ORDER = { SELL: 0, BORDERLINE: 1, KEEP: 2 };

export function analyzeChampionGear(champRow, items, ctx) {
  const role = champRole(champRow);
  const ratings = items
    .filter((it) => it.equippedChampId === Number(champRow.ID))
    .map((it) => rateItem(it, ctx, role))
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
      || b.better - a.better || a.item.slot - b.item.slot);
  const tally = { SELL: 0, BORDERLINE: 0, KEEP: 0 };
  for (const r of ratings) tally[r.verdict]++;
  return { champ: champRow, role, ratings, tally };
}
