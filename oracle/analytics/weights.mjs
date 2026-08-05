// Role -> stat desirability (0-1). SPD universal 1.0. Hard rule: every % stat > every flat stat.
// flat = flat HP/ATK/DEF; SPD/ACC/RES have no % form.
export const WEIGHTS = {
  "ATK-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.8, defPct: 0.2, hpPct: 0.2, res: 0.15, acc: 0.5, flat: 0.1 },
  "DEF-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.8, hpPct: 0.2, res: 0.2, acc: 0.5, flat: 0.1 },
  "HP-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.2, hpPct: 0.8, res: 0.2, acc: 0.5, flat: 0.1 },
  "Support": { spd: 1.0, cr: 0.25, cd: 0.25, atkPct: 0.25, defPct: 0.6, hpPct: 0.8, res: 0.7, acc: 0.7, flat: 0.15 },
};

// MAIN-stat desirability — a SEPARATE matrix from the substat WEIGHTS, because a main's value
// profile differs from a sub's: C.DMG main > C.RATE main (but they're equal as subs), and the
// damage-scaling % main sits below the crits. dmg% = ATK%/DEF%/HP% for ATK/DEF/HP-DPS. Support
// HP%/ACC/RES are equal "in general". Flat HP/ATK/DEF here is the artifact case (low); on accessories
// a flat main maps to its % counterpart in score.mjs (a main is a big absolute stat).
export const MAIN_WEIGHTS = {
  "ATK-DPS": { spd: 1.0, cd: 0.95, cr: 0.9, atkPct: 0.8, defPct: 0.2, hpPct: 0.2, acc: 0.5, res: 0.15, flat: 0.1 },
  "DEF-DPS": { spd: 1.0, cd: 0.95, cr: 0.9, defPct: 0.8, atkPct: 0.2, hpPct: 0.2, acc: 0.5, res: 0.15, flat: 0.1 },
  "HP-DPS": { spd: 1.0, cd: 0.95, cr: 0.9, hpPct: 0.8, atkPct: 0.2, defPct: 0.2, acc: 0.5, res: 0.15, flat: 0.1 },
  "Support": { spd: 1.0, cd: 0.25, cr: 0.25, atkPct: 0.25, defPct: 0.6, hpPct: 0.8, acc: 0.8, res: 0.8, flat: 0.15 },
};

// Blend of the two [0,1] quality components. 1:1 holds the "best main + bad subs ranks below
// second-best main + perfect subs" principle with margin (it survives up to ~4:1).
export const BLEND = { main: 1, sub: 1 };

// Investment: "highly glyphed" decoded-glyph thresholds (DESIGN.md §3.4).
export const GLYPH_THRESHOLDS = { spd: 4, pct: 5, accRes: 8 };
export const ASCENDED_LEVEL = 6;

// Supply floors (DESIGN.md §3.5/§6), counting unequipped only.
export const SUPPLY = { accessoryFloor: 4, artifactBase: 4 }; // accessory flat 4; artifact artifactBase*demand

// Triage cut lines. delete (junk): for each low-demand (premium <= lowPremium) set x slot, keep the
// best max(ceil(junkKeepFrac * N), junkKeepFloor) UNEQUIPPED spares by quality and delete the rest —
// so a limited-but-off-meta set keeps its best pieces + a floor bench instead of being swept (plus
// all setless-dominated accessories). focus/upgrade: top `focusPerGroup` per slot x archetype among
// demanded sets (premium >= focusPremium). upgrade restricted to level <= upgradeMaxLevel.
// balanceFactor: slot-balance target = round(family mean of kept-unequipped x balanceFactor) per
// slot, deleting worst-first to even the UNEQUIPPED pool within artifacts (6 slots) and accessories
// (3 slots) separately; <1 is more aggressive (lower cap), >1 gentler, 0 disables.
// gearKeepQuantile/gearSellQuantile/roleGapFlag drive champion-gear.mjs (see its header).
export const CUTS = { junkKeepFrac: 0.30, junkKeepFloor: 4, lowPremium: 2, focusPremium: 4, focusPerGroup: 2, upgradeMaxLevel: 12, balanceFactor: 1,
  // champion-gear.mjs: KEEP at/below the p50 of the vault's own equipped-gear upgrade-path counts,
  // SELL at/above p75 (runtime quantiles, so they self-calibrate as the vault grows). roleGapFlag is
  // in score points — the shoulder of the gap distribution, where ~25% of equipped gear sits.
  gearKeepQuantile: 0.50, gearSellQuantile: 0.75, roleGapFlag: 10 };
