// The speed model:
//
//   speed = base                                 champion base speed, from the corpus
//         + Σ setEffect(base, completed sets)    floor(base * pct) per completion / unlocked tier
//         + Σ itemSpeed(item)                    over the nine equipped items
//         + constant                             flat sources the DB doesn't expose
//
// `constant` is measured once per champion and sweeps up faction guardians, champion ascension and
// relic. It is kept OUT of base deliberately: set bonuses multiply base but not the constant, so
// folding them together applies the percentage to the relic too. On a champion with 62 points of
// unexplained speed and 36% of set bonus that is a 22-speed error, and it biases the solver toward
// set bonuses over flat speed — exactly the trade-off it exists to weigh.
import { setEffect } from "./speed-sets.mjs";

export const SPD = 4;   // STAT_NAMES id for SPD

// Speed this item contributes. `glyphFloor` raises every SPD SUBSTAT glyph to at least that value.
// Glyphs only ever apply to substats — ASCGV and mgv are 0 in all 8474 rows of the 2026-08-12
// snapshot — and a glyph can only lift a stat the item already has, so the floor never conjures
// speed onto an item with no SPD substat.
export function itemSpeed(item, glyphFloor = 0) {
  let total = 0;
  if (item.mainStat.statId === SPD) total += item.mainStat.value;
  for (const s of item.substats) {
    if (s.statId !== SPD) continue;
    // The glyph is ADDITIVE: substat.value does not already include it. Predicting champion totals
    // with it added is exact for 99/243 champions, against 41/243 without.
    total += s.value + Math.max(s.glyph, glyphFloor);
  }
  if (item.ascStat?.statId === SPD) total += item.ascStat.value;
  return total;
}

// Highest SPD substat glyph the vault has actually been seen to carry, per rarity x rank. Derived
// from the data rather than hardcoded so it tracks whatever the game currently allows.
export function glyphCeilings(items) {
  const ceilings = new Map();
  for (const item of items) {
    for (const s of item.substats) {
      if (s.statId !== SPD || s.glyph <= 0) continue;
      const key = `${item.rarity}|${item.rank}`;
      if (s.glyph > (ceilings.get(key) ?? 0)) ceilings.set(key, s.glyph);
    }
  }
  return ceilings;
}

// The floor actually applicable to one item: never above what its rarity x rank has been seen to
// carry, because `--glyph 20` would otherwise invent speed that cannot exist. A bucket with no
// observations carries no evidence, so it is left unclamped rather than silently zeroed.
export function clampFloor(item, glyphFloor, ceilings) {
  if (glyphFloor <= 0) return 0;
  const ceiling = ceilings.get(`${item.rarity}|${item.rank}`);
  return ceiling === undefined ? glyphFloor : Math.min(glyphFloor, ceiling);
}

// One valuation function for a whole run, so the solver never has to carry the ceilings around.
export const speedOfWith = (glyphFloor, ceilings) =>
  (item) => itemSpeed(item, clampFloor(item, glyphFloor, ceilings));

// setId -> how many of these items carry it. Setless items (set 0) belong to no set and are skipped.
export function setCounts(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item.set) continue;
    counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
  }
  return counts;
}

export function buildSpeed(base, constant, items, speedOf) {
  const flat = items.reduce((sum, item) => sum + speedOf(item), 0);
  return base + setEffect(base, setCounts(items)) + flat + constant;
}

// Everything the model cannot account for, measured against the champion's CURRENT gear. It is flat
// and gear-independent, so it carries unchanged into any candidate build. For an ungeared champion
// this is simply observed - base.
export function measureConstant(observedSpd, base, currentGear, speedOf) {
  return observedSpd - buildSpeed(base, 0, currentGear, speedOf);
}
