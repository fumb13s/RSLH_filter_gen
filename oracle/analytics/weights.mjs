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
// HP%/ACC/RES are equal "in general". Flat HP/ATK/DEF here is the armor case (low); on accessories
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
export const SUPPLY = { accessoryFloor: 4, armorBase: 4 }; // accessory flat 4; armor armorBase*demand

// Triage cut lines. delete: oversupplied low-demand armor below slot-percentile `deletePct`
// (plus all setless-dominated accessories). focus/upgrade: top `focusPerGroup` per slot x archetype
// among demanded sets (premium >= focusPremium). upgrade restricted to level <= upgradeMaxLevel.
export const CUTS = { deletePct: 70, lowPremium: 2, focusPremium: 4, focusPerGroup: 2, upgradeMaxLevel: 12 };
