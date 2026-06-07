import { SLOT_STATS } from "@rslh/core";
import { WEIGHTS, GLYPH_THRESHOLDS, ASCENDED_LEVEL } from "./weights.mjs";
import { getSet, expandRoles, ALL_ROLES } from "./sets.mjs";

// desirability of a (role, statId, isFlat) using our stat ids.
export function desir(role, statId, isFlat) {
  const w = WEIGHTS[role];
  switch (statId) {
    case 4: return w.spd;
    case 5: return w.cr;
    case 6: return w.cd;
    case 7: return w.res;
    case 8: return w.acc;
    case 1: return isFlat ? w.flat : w.hpPct;
    case 2: return isFlat ? w.flat : w.atkPct;
    case 3: return isFlat ? w.flat : w.defPct;
    default: return 0;
  }
}

// Ceiling = mean of the top-4 achievable substat desirabilities for this slot+role.
// Realizes "flat penalized only where a % was rollable": the baseline is slot-relative.
function slotCeil(slot, role) {
  const cfg = SLOT_STATS[slot];
  if (!cfg) return 1;
  const vals = cfg.substats.map(([id, flat]) => desir(role, id, flat)).sort((a, b) => b - a);
  const top = vals.slice(0, 4);
  return top.reduce((s, v) => s + v, 0) / Math.max(1, top.length) || 1;
}

// Roll-weighted mean desirability of the item's actual substats.
// Weight = rolls + 1 (the reveal counts as one roll), so a base sub (rolls 0) still
// contributes and an all-base line never collapses to den 0. (See Task 1 decode finding.)
function rollWeightedMean(item, role) {
  let num = 0, den = 0;
  for (const s of item.substats) { const w = s.rolls + 1; num += desir(role, s.statId, s.isFlat) * w; den += w; }
  return den ? num / den : 0;
}

export function rolesForSet(setId) {
  const roles = expandRoles(getSet(setId).roles);
  return roles.length ? roles : ALL_ROLES; // setless / unknown -> judged at best of all roles
}

// quality(item) -> { role, score } where score in [0,100], best-matching role.
export function quality(item) {
  let best = { role: ALL_ROLES[0], score: -1 };
  for (const role of rolesForSet(item.set)) {
    const score = Math.max(0, Math.min(100,
      Math.round((100 * rollWeightedMean(item, role)) / slotCeil(item.slot, role))));
    if (score > best.score) best = { role, score };
  }
  return best;
}

function isPct(statId, isFlat) {
  return statId === 5 || statId === 6 || ((statId === 1 || statId === 2 || statId === 3) && !isFlat);
}

// investment(item) -> { ascended, glyphed } (DESIGN.md §3.4)
export function investment(item) {
  const ascended = item.ascLevel === ASCENDED_LEVEL;
  const glyphed = item.substats.some((s) => {
    const g = s.glyph || 0;
    if (s.statId === 4) return g >= GLYPH_THRESHOLDS.spd;
    if (s.statId === 7 || s.statId === 8) return g >= GLYPH_THRESHOLDS.accRes;
    if (isPct(s.statId, s.isFlat)) return g >= GLYPH_THRESHOLDS.pct;
    return false;
  });
  return { ascended, glyphed };
}
