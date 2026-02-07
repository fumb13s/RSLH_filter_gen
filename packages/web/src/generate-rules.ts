/**
 * Generate .hsf rules from setting groups.
 *
 * Each group translates to multiple AND rules — one per valid partition
 * of the required roll count across the selected good substats.
 */
import { defaultRule, emptySubstat, getRollRange } from "@rslh/core";
import type { HsfRule } from "@rslh/core";
import type { SettingGroup } from "./generator.js";

/**
 * Enumerate all ways to distribute `total` into `k` non-negative integers
 * summing to `total`, with at most `maxNonZero` non-zero entries.
 */
function partitions(total: number, k: number, maxNonZero: number): number[][] {
  const results: number[][] = [];

  function recurse(remaining: number, slots: number, nonZeroLeft: number, current: number[]): void {
    if (slots === 0) {
      if (remaining === 0) results.push([...current]);
      return;
    }
    // Last slot — must take whatever remains
    if (slots === 1) {
      if (remaining === 0 || nonZeroLeft > 0) {
        current.push(remaining);
        results.push([...current]);
        current.pop();
      }
      return;
    }
    // Try assigning 0 to this slot (doesn't consume a non-zero allowance)
    current.push(0);
    recurse(remaining, slots - 1, nonZeroLeft, current);
    current.pop();
    // Try assigning 1..remaining to this slot (consumes a non-zero allowance)
    if (nonZeroLeft > 0) {
      for (let v = 1; v <= remaining; v++) {
        current.push(v);
        recurse(remaining - v, slots - 1, nonZeroLeft - 1, current);
        current.pop();
      }
    }
  }

  recurse(total, k, maxNonZero, []);
  return results;
}

/** Generate all .hsf rules for a list of setting groups. */
export function generateRulesFromGroups(groups: SettingGroup[]): HsfRule[] {
  const rules: HsfRule[] = [];

  for (const group of groups) {
    if (group.goodStats.length === 0) continue;

    // Main stat variants: one set of rules per selected main stat, or one with -1 (any)
    const mainStatVariants: { id: number; isFlat: boolean; MainStatID: number; MainStatF: number }[] =
      group.mainStats.length > 0
        ? group.mainStats.map(([id, isFlat]) => ({ id, isFlat, MainStatID: id, MainStatF: isFlat ? 0 : 1 }))
        : [{ id: -1, isFlat: false, MainStatID: -1, MainStatF: 1 }];

    // Level checkpoints: each step down from 16 reduces rolls by 1
    const LEVEL_CHECKPOINTS = [16, 12, 8, 4, 0] as const;

    for (const mainStat of mainStatVariants) {
      // Exclude the main stat from good substats — an artifact can't have
      // the same stat as both main and substat
      const effectiveGoodStats = mainStat.id === -1
        ? group.goodStats
        : group.goodStats.filter(([s, f]) => !(s === mainStat.id && f === mainStat.isFlat));

      if (effectiveGoodStats.length === 0) continue;

      for (let li = 0; li < LEVEL_CHECKPOINTS.length; li++) {
        const level = LEVEL_CHECKPOINTS[li];
        const levelRolls = group.rolls - li;
        if (levelRolls <= 0) break;

        const parts = partitions(levelRolls, effectiveGoodStats.length, 4);

        for (const part of parts) {
          const substats = part
            .map((rolls, i) => {
              if (rolls === 0) return null;
              const [statId] = effectiveGoodStats[i];
              const range = getRollRange(statId, 6);
              if (!range) return null;
              const threshold = rolls * range[0];
              return {
                ID: statId,
                Value: threshold,
                IsFlat: false,
                NotAvailable: false,
                Condition: ">=",
              };
            })
            .filter((s) => s !== null);

          // Pad to exactly 4 substat slots
          while (substats.length < 4) substats.push(emptySubstat());

          const rule = defaultRule({
            ...(group.sets.length > 0 ? { ArtifactSet: [...group.sets] } : { ArtifactSet: undefined }),
            ...(group.slots.length > 0 ? { ArtifactType: [...group.slots] } : { ArtifactType: undefined }),
            MainStatID: mainStat.MainStatID,
            MainStatF: mainStat.MainStatF,
            Rank: 6,
            IsRuleTypeAND: true,
            LVLForCheck: level,
            Substats: substats,
          });

          // Remove ArtifactSet/ArtifactType keys when undefined (= "any")
          if (rule.ArtifactSet === undefined) delete rule.ArtifactSet;
          if (rule.ArtifactType === undefined) delete rule.ArtifactType;

          rules.push(rule);
        }
      }
    }
  }

  return rules;
}
