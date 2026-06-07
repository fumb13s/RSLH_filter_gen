import { SLOT_STATS } from "@rslh/core";
import { WEIGHTS, MAIN_WEIGHTS, BLEND, GLYPH_THRESHOLDS, ASCENDED_LEVEL } from "./weights.mjs";
import { getSet, expandRoles, ALL_ROLES } from "./sets.mjs";
import { subMax, subCeiling } from "./rolls.mjs";
import { mainMax } from "./mainstats.mjs";

// Substat desirability (crit-led). Our stat ids: 4 SPD, 5 C.RATE, 6 C.DMG, 7 RES, 8 ACC, 1/2/3 HP/ATK/DEF.
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

// Main-stat desirability (separate matrix). On accessories a flat HP/ATK/DEF main is a big
// absolute stat, so it counts as its % counterpart; on armor a flat main stays low.
export function mainDesir(role, statId, isFlat, slot) {
  const w = MAIN_WEIGHTS[role];
  const flatAsPct = slot >= 7 && isFlat && (statId === 1 || statId === 2 || statId === 3);
  switch (statId) {
    case 4: return w.spd;
    case 5: return w.cr;
    case 6: return w.cd;
    case 7: return w.res;
    case 8: return w.acc;
    case 1: return isFlat && !flatAsPct ? w.flat : w.hpPct;
    case 2: return isFlat && !flatAsPct ? w.flat : w.atkPct;
    case 3: return isFlat && !flatAsPct ? w.flat : w.defPct;
    default: return 0;
  }
}

function maxMainDesir(slot, role) {
  const cfg = SLOT_STATS[slot];
  if (!cfg) return 1;
  return Math.max(...cfg.primaryStats.map(([id, f]) => mainDesir(role, id, f, slot))) || 1;
}

export function rolesForSet(setId) {
  const roles = expandRoles(getSet(setId).roles);
  return roles.length ? roles : ALL_ROLES; // setless / unknown -> judged at best of all roles
}

// mainComponent in [0,1] = type-fit x build-completeness (main value vs its 6★+16 ceiling).
function mainComponent(item, role) {
  const m = item.mainStat;
  const fit = mainDesir(role, m.statId, m.isFlat, item.slot) / maxMainDesir(item.slot, role);
  const max = mainMax(item.slot, m.statId, m.isFlat);
  const complete = max ? Math.min(1, m.value / max) : 1;
  return fit * complete;
}

// subComponent in [0,1] = the item's desirability-weighted substat value vs the best achievable
// lineup for this slot+role, excluding the main (a substat can never duplicate the main stat).
function subComponent(item, role) {
  const ceil = subCeiling(item.slot, (id, f) => desir(role, id, f),
    { statId: item.mainStat.statId, isFlat: item.mainStat.isFlat });
  if (!ceil) return 0;
  let num = 0;
  for (const s of item.substats) {
    const max = subMax(s.statId, s.isFlat);
    num += desir(role, s.statId, s.isFlat) * (max ? Math.min(1, s.value / max) : 0);
  }
  return Math.min(1, num / ceil);
}

// quality(item) -> { role, score } in [0,100], best-matching role: a 1:1 blend of the main-stat
// and substat components, each measured as value-completeness against its theoretical ceiling.
export function quality(item) {
  let best = { role: ALL_ROLES[0], score: -1 };
  for (const role of rolesForSet(item.set)) {
    const mc = mainComponent(item, role), sc = subComponent(item, role);
    const score = Math.round(100 * (BLEND.main * mc + BLEND.sub * sc) / (BLEND.main + BLEND.sub));
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
