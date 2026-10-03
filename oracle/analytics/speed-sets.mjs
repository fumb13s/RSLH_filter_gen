// Which artifact sets grant SPEED, and how much. Two different mechanics live here:
//
//   CLASSIC sets STACK. A set contributes floor(count / pieces) completions, each worth `pct`.
//     Six pieces of Speed is three completions, +36%.
//   TIERED (nine-slot) sets DO NOT stack. Crossing each successive threshold unlocks an ADDITIONAL
//     bonus, and they accumulate. Nine pieces of Supersonic is 10+10+12 = 32%, not four completions.
//
// Accessories count toward the piece total of any set that can roll on them (35, 36, 47, 48, 58-66);
// the classic sets here are artifact-only, so they cap at 6 pieces.
//
// Every set absent from both tables grants 0% speed, including all accessory-only sets (1000-1004).
//
// Both tables are DERIVED from set-bonuses.mjs — they are its "SPD%" view — rather than dictated
// here. That table is generated from Gestal's set catalogue and checked against the game's own
// per-champion set bonuses, and checking it corrected the values this file used to carry by hand,
// for six sets:
//
//   Deflection (36), Feral (61), Pinpoint (62), Rebirth (64) and Chronophage (65) open their first
//     SPD tier at TWO pieces, not three. Supersonic (58) shares their 10/10/12 payouts and really
//     does open at three — so the old shared `T(10, 10, 12)` shorthand hid four separate errors
//     behind one that was right.
//   Killstroke (49) grants +5% SPD per 2-piece completion, alongside its +20% C.DMG, and was
//     missing from the table entirely.
//
// Deriving is what stops that recurring: one table to correct, not two. It does not make the values
// checkable from a vault snapshot — relic speed is per-champion, invisible to the DB and the same
// magnitude as these bonuses, so a fit over the vault still cannot separate the two. The check is
// against the game's own numbers, in set-bonuses.mjs.
import { SET_BONUSES } from "./set-bonuses.mjs";

// The one stat key this module is a view of. Not to be confused with speed-model.mjs's `SPD`, which
// is the STAT_NAMES id 4.
const SPD_KEY = "SPD%";

const rows = Object.entries(SET_BONUSES);

// The stacking sets that grant SPD. `pieces` and `pct` are all the speed model needs from a row.
export const CLASSIC_SPEED_SETS = Object.fromEntries(
  rows.filter(([, row]) => row.kind === "stack" && SPD_KEY in row.bonus)
    .map(([id, row]) => [id, { name: row.name, pieces: row.pieces, pct: row.bonus[SPD_KEY] }]),
);

// The nine-slot sets with at least one SPD tier, carrying ONLY their SPD tiers. Dropping the other
// stats' tiers is what makes firstThreshold and usefulCounts answer about SPEED: a Deflection tier
// that grants ACC changes no speed, and must not become a piece count the solver plans around.
export const TIERED_SPEED_SETS = Object.fromEntries(
  rows.filter(([, row]) => row.kind === "tiered" && row.tiers.some(([, bonus]) => SPD_KEY in bonus))
    .map(([id, row]) => [id, {
      name: row.name,
      tiers: row.tiers.filter(([, bonus]) => SPD_KEY in bonus)
        .map(([threshold, bonus]) => [threshold, bonus[SPD_KEY]]),
    }]),
);

export const SPEED_SET_IDS = [
  ...Object.keys(CLASSIC_SPEED_SETS), ...Object.keys(TIERED_SPEED_SETS),
].map(Number);

export const speedSetName = (setId) =>
  CLASSIC_SPEED_SETS[setId]?.name ?? TIERED_SPEED_SETS[setId]?.name ?? null;

// Pieces needed before a set grants anything at all. Used by the solver to reject plans a pool
// cannot supply, and to bound how many sets can be active at once.
export function firstThreshold(setId) {
  const c = CLASSIC_SPEED_SETS[setId];
  if (c) return c.pieces;
  const t = TIERED_SPEED_SETS[setId];
  return t ? t.tiers[0][0] : Infinity;
}

// The only piece counts worth planning around: any count between two of these gives exactly the
// bonus of the lower one, so the solver would be enumerating identical builds. Bounded by maxSlots,
// which is however many slots of this set the pool can actually supply.
export function usefulCounts(setId, maxSlots) {
  const out = [];
  const c = CLASSIC_SPEED_SETS[setId];
  if (c) {
    for (let n = c.pieces; n <= maxSlots; n += c.pieces) out.push(n);
    return out;
  }
  const t = TIERED_SPEED_SETS[setId];
  if (!t) return out;
  for (const [threshold] of t.tiers) if (threshold <= maxSlots) out.push(threshold);
  return out;
}

// Every percentage a build earns, as a flat list — one entry per completed classic set and per
// unlocked tier. A list rather than a sum because the game floors EACH against base separately.
// `counts` maps setId -> how many of the nine equipped items carry that set.
export function speedTerms(counts) {
  const terms = [];
  for (const [setId, count] of counts) {
    const c = CLASSIC_SPEED_SETS[setId];
    if (c) {
      for (let n = Math.floor(count / c.pieces); n > 0; n--) terms.push(c.pct);
      continue;
    }
    const t = TIERED_SPEED_SETS[setId];
    if (!t) continue;
    for (const [threshold, pct] of t.tiers) if (count >= threshold) terms.push(pct);
  }
  return terms;
}

// Speed granted by set bonuses. Floor per completion — summing the percentages first and flooring
// once is off by a point or two, and the snapshot says per-completion is the rule.
export function setEffect(base, counts) {
  return speedTerms(counts).reduce((sum, pct) => sum + Math.floor(base * pct / 100), 0);
}
