/**
 * Shared test helpers for property-based testing.
 * Duplicated from core's test helpers to avoid cross-package import issues.
 */
import { expect } from "vitest";
import {
  ARTIFACT_SET_NAMES,
  getRollRange,
  matchesRule,
} from "@rslh/core";
import type { HsfRule, Item } from "@rslh/core";

// ---------------------------------------------------------------------------
// assertRuleInvariants
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
// hsfRarityToIndex — mirrors evaluate.ts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// matchesGroup — reference evaluator against a SettingGroup
// ---------------------------------------------------------------------------

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

export function matchesGroup(group: SettingGroupLike, item: Item): boolean {
  if (group.sets.length > 0 && !group.sets.includes(item.set)) return false;
  if (group.slots.length > 0 && !group.slots.includes(item.slot)) return false;

  const groupRank = group.rank ?? 0;
  if (groupRank !== 0 && item.rank < groupRank) return false;

  // Default rarity depends on whether group has goodStats:
  // unconditional (empty goodStats) uses group.rarity as-is (often 0),
  // conditional uses group.rarity ?? 16 (matching generateRulesFromGroups)
  const defaultRarity = group.goodStats.length === 0 ? (group.rarity ?? 0) : (group.rarity ?? 16);
  const rarityIdx = hsfRarityToIndex(defaultRarity);
  if (item.rarity < rarityIdx) return false;

  const groupFaction = group.faction ?? 0;
  if (groupFaction !== 0 && item.faction !== groupFaction) return false;

  if (group.mainStats.length > 0) {
    const matchesAnyStat = group.mainStats.some(([statId, isFlat]) => {
      if (item.mainStat !== statId) return false;
      if (group.goodStats.length > 0) {
        const effective = group.goodStats.filter(
          ([s, f]) => !(s === statId && f === isFlat),
        );
        return effective.length > 0;
      }
      return true;
    });
    if (!matchesAnyStat) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Convenience matchers
// ---------------------------------------------------------------------------

export function anyRuleMatches(rules: HsfRule[], item: Item): boolean {
  return rules.some((r) => matchesRule(r, item));
}

export function anyGroupMatches(
  groups: SettingGroupLike[],
  item: Item,
): boolean {
  return groups.some((g) => matchesGroup(g, item));
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
