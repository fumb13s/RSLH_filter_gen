// Which artifact sets grant SPEED, and how much. Two different mechanics live here:
//
//   CLASSIC sets STACK. A set contributes floor(count / pieces) completions, each worth `pct`.
//     Six pieces of Speed is three completions, +36%.
//   TIERED (nine-slot) sets DO NOT stack. Crossing each successive threshold unlocks an ADDITIONAL
//     bonus, and they accumulate. Nine pieces of Supersonic is 10+10+12 = 32%, not four completions.
//
// Accessories count toward the piece total of any set that can roll on them (35, 36, 47, 48, 58-66);
// the classic sets above are artifact-only, so they cap at 6 pieces.
//
// Every set absent from both tables grants 0% speed, including all accessory-only sets (1000-1004).
// Values are game data, dictated rather than derived: relic speed is per-champion, invisible to the
// DB, and the same magnitude as these bonuses, so fitting them from the vault cannot separate the
// two. See the design doc's evidence appendix.

export const CLASSIC_SPEED_SETS = {
  4:  { name: "Speed",        pieces: 2, pct: 12 },
  34: { name: "Divine Speed", pieces: 2, pct: 12 },
  53: { name: "Impulse",      pieces: 2, pct: 12 },
  57: { name: "Righteous",    pieces: 2, pct: 10 },
  38: { name: "Perception",   pieces: 2, pct: 5 },
  50: { name: "Instinct",     pieces: 4, pct: 12 },
};

// Ascending [threshold, pct] pairs. Most tiered sets share 3/5/8; Swift Parry does not.
const T = (a, b, c) => [[3, a], [5, b], [8, c]];

export const TIERED_SPEED_SETS = {
  58: { name: "Supersonic",   tiers: T(10, 10, 12) },
  62: { name: "Pinpoint",     tiers: T(10, 10, 12) },
  36: { name: "Deflection",   tiers: T(10, 10, 12) },
  65: { name: "Chronophage",  tiers: T(10, 10, 12) },
  64: { name: "Rebirth",      tiers: T(10, 10, 12) },
  66: { name: "Mercurial",    tiers: T(8, 12, 12) },
  47: { name: "Protection",   tiers: T(12, 12, 8) },
  35: { name: "Swift Parry",  tiers: [[2, 8], [4, 10], [8, 10]] },
  61: { name: "Feral",        tiers: T(5, 5, 5) },
  59: { name: "Merciless",    tiers: [[3, 5], [7, 5]] },
  63: { name: "Stonecleaver", tiers: [[3, 5], [7, 5]] },
  60: { name: "Slayer",       tiers: [[3, 5], [8, 5]] },
};

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
