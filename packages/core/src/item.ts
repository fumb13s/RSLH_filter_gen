/** Artifact rarity tiers in ascending order. */
export const ITEM_RARITIES = [
  "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical",
] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/**
 * Number of substats an artifact starts with at level 0, indexed by rarity.
 * Mythical overflows the 4-slot cap: 4 substats, one with an extra roll.
 */
export const STARTING_SUBSTATS = [0, 1, 2, 3, 4, 5] as const;

/** Max substat slots on any item. */
export const MAX_SUBSTATS = 4;

/** Upgrade levels at which a substat is added or rolled. */
export const UPGRADE_LEVELS = [4, 8, 12, 16] as const;

/** A single substat on an artifact. */
export interface ItemSubstat {
  statId: number;   // stat ID (from STAT_NAMES)
  rolls: number;    // roll counter, 1–6 (default 1)
  value: number;    // total value, at least 1
}

/** An artifact item. */
export interface Item {
  set: number;            // artifact set ID (from ARTIFACT_SET_NAMES)
  slot: number;           // artifact slot ID (from ARTIFACT_SLOT_NAMES)
  rank: number;           // 1–6
  rarity: number;         // index into ITEM_RARITIES (0=Common .. 5=Mythical)
  mainStat: number;       // stat ID
  substats: ItemSubstat[];// 0–4 substats
  level: number;          // 0–16
  faction?: number;       // faction ID; only applicable for Ring, Amulet, Banner
}
