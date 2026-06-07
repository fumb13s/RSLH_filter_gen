// Role -> stat desirability (0-1). SPD universal 1.0. Hard rule: every % stat > every flat stat.
// flat = flat HP/ATK/DEF; SPD/ACC/RES have no % form.
export const WEIGHTS = {
  "ATK-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.8, defPct: 0.2, hpPct: 0.2, res: 0.15, acc: 0.5, flat: 0.1 },
  "DEF-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.8, hpPct: 0.2, res: 0.2, acc: 0.5, flat: 0.1 },
  "HP-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.2, hpPct: 0.8, res: 0.2, acc: 0.5, flat: 0.1 },
  "Support": { spd: 1.0, cr: 0.25, cd: 0.25, atkPct: 0.25, defPct: 0.6, hpPct: 0.8, res: 0.7, acc: 0.7, flat: 0.15 },
};

// Investment: "highly glyphed" decoded-glyph thresholds (DESIGN.md §3.4).
export const GLYPH_THRESHOLDS = { spd: 4, pct: 5, accRes: 8 };
export const ASCENDED_LEVEL = 6;

// Supply floors (DESIGN.md §3.5/§6), counting unequipped only.
export const SUPPLY = { accessoryFloor: 4, armorBase: 4 }; // accessory flat 4; armor armorBase*demand

// Triage cut lines (per-slot percentile) + keep-premium gates (DESIGN.md §3.6/§3.7).
export const CUTS = { deletePct: 25, focusPct: 85, lowPremium: 2, focusPremium: 4 };
