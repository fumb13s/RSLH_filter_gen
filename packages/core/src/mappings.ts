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

export const RARITY_BITS = {
  Common: 1,
  Uncommon: 2,
  Rare: 4,
  Epic: 8,
  Legendary: 16,
} as const;

/** Look up a name by ID, returning `"Unknown(N)"` for unmapped IDs. */
export function lookupName(map: Record<number, string>, id: number): string {
  return map[id] ?? `Unknown(${id})`;
}

/** Decode a rarity bitmask to a human-readable string (e.g. "Epic+Legendary"). */
export function describeRarity(value: number): string {
  if (value === 0) return "Any";
  const names: string[] = [];
  for (const [name, bit] of Object.entries(RARITY_BITS)) {
    if (value & bit) names.push(name);
  }
  return names.length > 0 ? names.join("+") : `Unknown(${value})`;
}
