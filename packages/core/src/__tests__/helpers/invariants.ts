/**
 * Shared test helpers: assertRuleInvariants, makeItem, and reference
 * evaluation functions for property-based testing.
 */
import { expect } from "vitest";
import { ARTIFACT_SET_NAMES, getRollRange, matchesRule } from "../../index.js";
import type { HsfRule, Item } from "../../index.js";

// ---------------------------------------------------------------------------
// assertRuleInvariants — extracted from quick-generator.test.ts
// ---------------------------------------------------------------------------

export function assertRuleInvariants(rules: HsfRule[]): void {
  for (const rule of rules) {
    expect(rule.Substats).toHaveLength(4);

    if (rule.ArtifactSet) {
      for (const id of rule.ArtifactSet) {
        expect(ARTIFACT_SET_NAMES[id]).toBeDefined();
      }
    }

    const maxPerSlot = 2 + rule.LVLForCheck / 4;

    for (const s of rule.Substats) {
      if (s.ID <= 0) continue;

      const range = getRollRange(s.ID, rule.Rank, s.IsFlat);
      expect(range).toBeDefined();
      if (!range) continue;

      const impliedRolls = Math.ceil(s.Value / range[0]);
      expect(impliedRolls).toBeGreaterThan(0);
      expect(impliedRolls).toBeLessThanOrEqual(maxPerSlot);

      expect(s.Value).toBeGreaterThanOrEqual(impliedRolls * range[0]);
      expect(s.Value).toBeLessThanOrEqual(impliedRolls * range[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// makeItem — minimal item factory
// ---------------------------------------------------------------------------

export function makeItem(overrides?: Partial<Item>): Item {
  return {
    set: 1,
    slot: 1,
    rank: 6,
    rarity: 4,
    mainStat: 2,
    substats: [],
    level: 16,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// matchesGroup — reference evaluator against a SettingGroup
// ---------------------------------------------------------------------------

/**
 * Convert an .hsf rarity threshold ID to an ITEM_RARITIES index.
 * Must mirror the logic in evaluate.ts:hsfRarityToIndex.
 */
export function hsfRarityToIndex(hsfRarity: number): number {
  switch (hsfRarity) {
    case 0:  return -1;
    case 8:  return 2;
    case 9:  return 3;
    case 15: return 5;
    case 16: return 4;
    default: return Infinity;
  }
}

/**
 * SettingGroup shape — duplicated here to avoid importing from web package.
 * Only the fields used for matching are required.
 */
export interface SettingGroupLike {
  sets: number[];
  slots: number[];
  mainStats: [number, boolean][];
  goodStats: [number, boolean][];
  rolls: number;
  rank?: number;
  rarity?: number;
  faction?: number;
}

/**
 * Reference evaluation: does an item match a single SettingGroup's
 * structural constraints (set, slot, rank, rarity, mainStat, faction)?
 *
 * This checks the same fields that matchesRule checks, NOT substats.
 * For conditional groups (non-empty goodStats), we also check that the
 * item's mainStat doesn't eliminate all effective good stats.
 */
export function matchesGroup(group: SettingGroupLike, item: Item): boolean {
  // Set filter
  if (group.sets.length > 0 && !group.sets.includes(item.set)) return false;

  // Slot filter
  if (group.slots.length > 0 && !group.slots.includes(item.slot)) return false;

  // Rank filter (0/undefined = any)
  const groupRank = group.rank ?? 0;
  if (groupRank !== 0 && item.rank < groupRank) return false;

  // Rarity filter (0/undefined = any)
  const groupRarity = group.rarity ?? 16; // default from generateRulesFromGroups
  const rarityIdx = hsfRarityToIndex(groupRarity);
  if (item.rarity < rarityIdx) return false;

  // Faction filter (0/undefined = any)
  const groupFaction = group.faction ?? 0;
  if (groupFaction !== 0 && item.faction !== groupFaction) return false;

  // Main stat filter
  if (group.mainStats.length > 0) {
    // Item must match at least one mainStat variant
    const matchesAnyStat = group.mainStats.some(([statId, isFlat]) => {
      if (item.mainStat !== statId) return false;
      // For conditional groups, check that effective good stats are non-empty
      if (group.goodStats.length > 0) {
        const effective = group.goodStats.filter(
          ([s, f]) => !(s === statId && f === isFlat),
        );
        return effective.length > 0;
      }
      return true;
    });
    if (!matchesAnyStat) return false;
  } else {
    // No mainStats filter → unconditional on main stat
    // But for conditional groups with goodStats, mainStatID=-1 means
    // all good stats are effective (no filtering), so always passes
  }

  return true;
}

/**
 * Check if an item matches any rule in a list (structural match only,
 * matching what matchesRule checks).
 */
export function anyRuleMatches(rules: HsfRule[], item: Item): boolean {
  return rules.some((r) => matchesRule(r, item));
}

/**
 * Check if an item matches any group in a list.
 */
export function anyGroupMatches(
  groups: SettingGroupLike[],
  item: Item,
): boolean {
  return groups.some((g) => matchesGroup(g, item));
}
