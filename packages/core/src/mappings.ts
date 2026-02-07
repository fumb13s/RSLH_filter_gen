/**
 * ID-to-name lookup tables for RSLH artifact filter fields.
 * Sourced from game data / Kotlin enum definitions.
 */

export const ARTIFACT_SET_NAMES: Record<number, string> = {
  1: "Life",
  2: "Offense",
  3: "Defense",
  4: "Speed",
  5: "Critical Rate",
  6: "Crit Damage",
  7: "Accuracy",
  8: "Resistance",
  9: "Lifesteal",
  10: "Fury",
  11: "Daze",
  12: "Cursed",
  13: "Frost",
  14: "Frenzy",
  15: "Regeneration",
  16: "Immunity",
  17: "Shield",
  18: "Relentless",
  19: "Savage",
  20: "Destroy",
  21: "Stun",
  22: "Toxic",
  23: "Provoke",
  24: "Retaliation",
  25: "Avenging",
  26: "Stalwart",
  27: "Reflex",
  28: "Curing",
  29: "Cruel",
  30: "Immortal",
  31: "Divine Offense",
  32: "Divine Critical Rate",
  33: "Divine Life",
  34: "Divine Speed",
  35: "Swift Parry",
  36: "Deflection",
  37: "Resilience",
  38: "Perception",
  39: "Affinitybreaker",
  40: "Untouchable",
  41: "Fatal",
  42: "Frostbite",
  43: "Bloodthirst",
  44: "Guardian",
  45: "Fortitude",
  46: "Lethal",
  47: "Protection",
  48: "Stone Skin",
  49: "Killstroke",
  50: "Instinct",
  51: "Bolster",
  52: "Defiant",
  53: "Impulse",
  54: "Zeal",
  57: "Righteous",
  58: "Supersonic",
  59: "Merciless",
  60: "Slayer",
  61: "Feral",
  62: "Pinpoint",
  63: "Stonecleaver",
  64: "Rebirth",
  65: "Chronophage",
  66: "Mercurial",
  1000: "Refresh",
  1001: "Cleansing",
  1002: "Bloodshield",
  1003: "Reaction",
  1004: "Revenge",
};

export const ARTIFACT_SLOT_NAMES: Record<number, string> = {
  1: "Helmet",
  2: "Chest",
  3: "Gloves",
  4: "Boots",
  5: "Weapon",
  6: "Shield",
  7: "Ring",
  8: "Amulet",
  9: "Banner",
};

/** Placeholder stat names — IDs are known but labels are unverified. */
export const STAT_NAMES: Record<number, string> = {
  1: "HP%",
  2: "ATK%",
  3: "DEF%",
  4: "SPD",
  5: "C.RATE",
  6: "C.DMG",
  7: "RES",
  8: "ACC",
};

/**
 * .hsf rarity IDs → rarity tier names.
 * The .hsf Rarity field is a minimum-rarity threshold, not a bitmask.
 * Common and Uncommon IDs are unknown and rarely used.
 */
export const HSF_RARITY_IDS: Record<number, string> = {
  8: "Rare",
  9: "Epic",
  15: "Mythical",
  16: "Legendary",
};

export const FACTION_NAMES: Record<number, string> = {
  1: "Banner Lords",
  2: "High Elves",
  3: "Sacred Order",
  4: "Barbarians",
  5: "Ogryn Tribes",
  6: "Lizardmen",
  7: "Skinwalkers",
  8: "Orcs",
  9: "Demonspawn",
  10: "Undead Hordes",
  11: "Dark Elves",
  12: "Knights Revenant",
  13: "Dwarves",
  14: "Shadowkin",
  15: "Sylvan Watchers",
  16: "Argonites",
};

// ---------------------------------------------------------------------------
// Slot → stat mappings (primary / substat availability)
// ---------------------------------------------------------------------------

/** A stat reference: [statId, isFlat]. */
export type StatRef = readonly [statId: number, isFlat: boolean];

export interface SlotStatConfig {
  readonly primaryStats: readonly StatRef[];
  readonly substats: readonly StatRef[];
}

/**
 * Which primary (main) stats and substats each slot can roll.
 * Derived from official Plarium artifact stat table.
 */
export const SLOT_STATS: Record<number, SlotStatConfig> = {
  // Weapon
  5: {
    primaryStats: [[2, true]],
    substats: [[1, true], [1, false], [2, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Helmet
  1: {
    primaryStats: [[1, true]],
    substats: [[1, false], [2, true], [2, false], [3, true], [3, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Shield
  6: {
    primaryStats: [[3, true]],
    substats: [[1, true], [1, false], [3, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Gloves
  3: {
    primaryStats: [[5, false], [6, false], [1, true], [1, false], [2, true], [2, false], [3, true], [3, false]],
    substats: [[1, true], [1, false], [2, true], [2, false], [3, true], [3, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Chest
  2: {
    primaryStats: [[8, true], [7, true], [1, true], [1, false], [2, true], [2, false], [3, true], [3, false]],
    substats: [[1, true], [1, false], [2, true], [2, false], [3, true], [3, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Boots
  4: {
    primaryStats: [[4, true], [1, true], [1, false], [2, true], [2, false], [3, true], [3, false]],
    substats: [[1, true], [1, false], [2, true], [2, false], [3, true], [3, false], [4, true], [5, false], [6, false], [7, true], [8, true]],
  },
  // Ring
  7: {
    primaryStats: [[1, true], [2, true], [3, true]],
    substats: [[1, true], [2, true], [3, true], [1, false], [2, false], [3, false]],
  },
  // Amulet
  8: {
    primaryStats: [[6, false], [1, true], [2, true], [3, true]],
    substats: [[1, true], [2, true], [3, true], [8, true], [7, true], [6, false]],
  },
  // Banner
  9: {
    primaryStats: [[8, true], [7, true], [1, true], [2, true], [3, true]],
    substats: [[1, true], [2, true], [3, true], [1, false], [2, false], [3, false], [4, true]],
  },
};

/** Display name for a stat variant: combines stat ID with flat/percentage context. */
export function statDisplayName(statId: number, isFlat: boolean): string {
  switch (statId) {
    case 1: return isFlat ? "HP" : "HP%";
    case 2: return isFlat ? "ATK" : "ATK%";
    case 3: return isFlat ? "DEF" : "DEF%";
    case 4: return "SPD";
    case 5: return "C.RATE";
    case 6: return "C.DMG";
    case 7: return "RES";
    case 8: return "ACC";
    default: return `Unknown(${statId})`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a name by ID, returning `"Unknown(N)"` for unmapped IDs. */
export function lookupName(map: Record<number, string>, id: number): string {
  return map[id] ?? `Unknown(${id})`;
}

/** Describe an .hsf rarity threshold as a human-readable string. */
export function describeRarity(value: number): string {
  if (value === 0) return "Any";
  const name = HSF_RARITY_IDS[value];
  return name ? `>= ${name}` : `Unknown(${value})`;
}
