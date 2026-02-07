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

/** Min/max roll value per rank (index 0 unused, ranks 1–6). */
export type RollRange = readonly [min: number, max: number];

/**
 * Substat roll ranges by stat group, indexed by rank (1–6).
 * Index 0 is a placeholder so that rank N maps to index N.
 */
export const ROLL_RANGES: Record<"percent" | "accRes" | "speed", readonly [RollRange, ...RollRange[]]> = {
  // HP%, ATK%, DEF%, C.RATE, C.DMG
  percent: [[0, 0], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7]],
  // ACC, RES
  accRes:  [[0, 0], [4, 7], [5, 8], [6, 9], [7, 10], [8, 11], [9, 12]],
  // SPD
  speed:   [[0, 0], [1, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
};

/** Map a stat ID to its roll range group. Returns undefined for flat stats (no data yet). */
export function rollRangeGroup(statId: number): "percent" | "accRes" | "speed" | undefined {
  switch (statId) {
    case 1: case 2: case 3: case 5: case 6: return "percent";
    case 7: case 8: return "accRes";
    case 4: return "speed";
    default: return undefined;
  }
}

/** Get the [min, max] roll range for a stat at a given rank. Returns undefined for flat stats. */
export function getRollRange(statId: number, rank: number): RollRange | undefined {
  const group = rollRangeGroup(statId);
  if (!group) return undefined;
  return ROLL_RANGES[group][rank];
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
