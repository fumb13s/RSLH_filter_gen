/** Artifact rarity tiers in ascending order. */
export const ITEM_RARITIES = [
  "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical",
] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/** An artifact item. */
export interface Item {
  set: number;        // artifact set ID (from ARTIFACT_SET_NAMES)
  slot: number;       // artifact slot ID (from ARTIFACT_SLOT_NAMES)
  rank: number;       // 1–6
  rarity: number;     // index into ITEM_RARITIES (0=Common .. 5=Mythical)
  mainStat: number;   // stat ID (placeholder, details TBD)
  substats: number[]; // stat IDs (placeholder, details TBD)
  level: number;      // 1–16
  faction?: number;   // faction ID; only applicable for Ring, Amulet, Banner
}
