import type { HsfFilter, HsfRule } from "./types.js";
import type { Item } from "./item.js";

/**
 * Convert an .hsf rarity threshold ID to an ITEM_RARITIES index.
 * 0 → -1 (any), unknown IDs → Infinity (never satisfiable).
 */
function hsfRarityToIndex(hsfRarity: number): number {
  switch (hsfRarity) {
    case 0:  return -1; // Any
    case 8:  return 2;  // Rare
    case 9:  return 3;  // Epic
    case 15: return 5;  // Mythical
    case 16: return 4;  // Legendary
    default: return Infinity;
  }
}

/** Check whether an item satisfies all conditions of a single rule. */
export function matchesRule(rule: HsfRule, item: Item): boolean {
  // ArtifactSet: undefined or empty = any set
  if (rule.ArtifactSet && rule.ArtifactSet.length > 0) {
    if (!rule.ArtifactSet.includes(item.set)) return false;
  }

  // ArtifactType: undefined or empty = any slot
  if (rule.ArtifactType && rule.ArtifactType.length > 0) {
    if (!rule.ArtifactType.includes(item.slot)) return false;
  }

  // Rank: 0 = any, otherwise item.rank must meet threshold
  if (rule.Rank !== 0) {
    if (item.rank < rule.Rank) return false;
  }

  // Rarity: 0 = any, otherwise item.rarity must meet threshold
  const rarityThreshold = hsfRarityToIndex(rule.Rarity);
  if (item.rarity < rarityThreshold) return false;

  // MainStatID: -1 = any
  if (rule.MainStatID !== -1) {
    if (item.mainStat !== rule.MainStatID) return false;
  }

  // Faction: 0 = any
  if (rule.Faction !== 0) {
    if (item.faction !== rule.Faction) return false;
  }

  // LVLForCheck: 0 = any level, otherwise item must be at or above checkpoint
  if (rule.LVLForCheck !== 0) {
    if (item.level < rule.LVLForCheck) return false;
  }

  // Substats: every active rule substat must be satisfied by an item substat
  for (const rs of rule.Substats) {
    if (rs.ID <= 0) continue; // empty slot
    const match = item.substats.find(
      (s) => s.statId === rs.ID && s.isFlat === rs.IsFlat,
    );
    if (!match || match.value < rs.Value) return false;
  }

  return true;
}

/**
 * Evaluate an item against a filter's rules in order.
 * First matching active rule wins. If no rule matches, the item is kept.
 */
export function evaluateFilter(
  filter: HsfFilter,
  item: Item,
): "keep" | "sell" {
  for (const rule of filter.Rules) {
    if (!rule.Use) continue;
    if (matchesRule(rule, item)) {
      return rule.Keep ? "keep" : "sell";
    }
  }
  return "keep";
}
