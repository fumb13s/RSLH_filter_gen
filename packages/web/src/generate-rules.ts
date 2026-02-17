/**
 * Generate .hsf rules from setting groups.
 *
 * Each group translates to multiple AND rules — one per valid partition
 * of the required roll count across the selected good substats.
 */
import { defaultRule, emptySubstat, getRollRange } from "@rslh/core";
import type { HsfRule } from "@rslh/core";
import type { SettingGroup } from "./generator.js";
import type { RareAccessoryBlock, OreRerollBlock } from "./quick-generator.js";
import { oreRerollToGroups, rareAccessoriesToGroups } from "./quick-generator.js";

/**
 * Enumerate all ways to distribute `total` into `k` non-negative integers
 * summing to `total`, with at most `maxNonZero` and at least `minNonZero`
 * non-zero entries, each capped at `maxPerSlot`.
 */
function partitions(
  total: number, k: number, maxNonZero: number, maxPerSlot: number, minNonZero: number,
): number[][] {
  const results: number[][] = [];

  function recurse(
    remaining: number, slots: number, nonZeroLeft: number, minNzLeft: number, current: number[],
  ): void {
    if (slots === 0) {
      if (remaining === 0 && minNzLeft <= 0) results.push([...current]);
      return;
    }
    // Last slot — must take whatever remains
    if (slots === 1) {
      if (remaining === 0 && minNzLeft <= 0) {
        current.push(0);
        results.push([...current]);
        current.pop();
      } else if (remaining > 0 && nonZeroLeft > 0 && remaining <= maxPerSlot && minNzLeft <= 1) {
        current.push(remaining);
        results.push([...current]);
        current.pop();
      }
      return;
    }
    // Try assigning 0 to this slot — only if remaining slots can still meet minNonZero
    if (slots - 1 >= minNzLeft) {
      current.push(0);
      recurse(remaining, slots - 1, nonZeroLeft, minNzLeft, current);
      current.pop();
    }
    // Try assigning 1..cap to this slot (consumes a non-zero allowance)
    if (nonZeroLeft > 0) {
      const cap = Math.min(remaining, maxPerSlot);
      for (let v = 1; v <= cap; v++) {
        current.push(v);
        recurse(remaining - v, slots - 1, nonZeroLeft - 1, Math.max(0, minNzLeft - 1), current);
        current.pop();
      }
    }
  }

  recurse(total, k, maxNonZero, minNonZero, []);
  return results;
}

/** Generate all .hsf rules for a list of setting groups. */
export function generateRulesFromGroups(groups: SettingGroup[]): HsfRule[] {
  const rules: HsfRule[] = [];

  for (const group of groups) {
    // Unconditional keep: empty goodStats → single rule with empty substats
    if (group.goodStats.length === 0) {
      const rule = defaultRule({
        Keep: group.keep ?? true,
        ...(group.sets.length > 0 ? { ArtifactSet: [...group.sets] } : { ArtifactSet: undefined }),
        ...(group.slots.length > 0 ? { ArtifactType: [...group.slots] } : { ArtifactType: undefined }),
        MainStatID: -1,
        MainStatF: 1,
        Rank: group.rank ?? 0,
        Rarity: group.rarity ?? 0,
        Faction: group.faction ?? 0,
        LVLForCheck: 0,
        Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
      });
      if (rule.ArtifactSet === undefined) delete rule.ArtifactSet;
      if (rule.ArtifactType === undefined) delete rule.ArtifactType;
      rules.push(rule);
      continue;
    }

    const rank = group.rank ?? 6;

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
        const levelRolls = group.rolls - Math.max(0, li - (group.walkbackDelay ?? 0));
        if (levelRolls <= 0) break;

        // A substat can accumulate at most 1 (initial) + upgrades roll-values.
        // Mythical items get an extra roll at level 0, so +1.
        const maxPerSlot = 2 + level / 4;
        // Total upgrades available = maxPerSlot - 1 (all minus one initial).
        // Each non-zero slot absorbs 1 initial roll, so we need enough
        // non-zero slots that the remaining demand fits the upgrade budget.
        const maxUpgrades = maxPerSlot - 1;
        const minNonZero = Math.max(0, levelRolls - maxUpgrades);
        const parts = partitions(levelRolls, effectiveGoodStats.length, 4, maxPerSlot, minNonZero);

        for (const part of parts) {
          const substats = part
            .map((rolls, i) => {
              if (rolls === 0) return null;
              const [statId, isFlat] = effectiveGoodStats[i];
              const range = getRollRange(statId, rank, isFlat);
              if (!range) return null;
              const threshold = rolls * range[0];
              return {
                ID: statId,
                Value: threshold,
                IsFlat: isFlat,
                NotAvailable: false,
                Condition: ">=",
              };
            })
            .filter((s) => s !== null);

          // Pad to exactly 4 substat slots
          while (substats.length < 4) substats.push(emptySubstat());

          const rule = defaultRule({
            Keep: group.keep ?? true,
            ...(group.sets.length > 0 ? { ArtifactSet: [...group.sets] } : { ArtifactSet: undefined }),
            ...(group.slots.length > 0 ? { ArtifactType: [...group.slots] } : { ArtifactType: undefined }),
            MainStatID: mainStat.MainStatID,
            MainStatF: mainStat.MainStatF,
            Rank: rank,
            Rarity: group.rarity ?? 16,
            Faction: group.faction ?? 0,
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

/** Generate unconditional keep rules for rare accessory set+faction selections. */
export function generateRareAccessoryRules(block: RareAccessoryBlock | undefined): HsfRule[] {
  return generateRulesFromGroups(rareAccessoriesToGroups(block));
}

// ---------------------------------------------------------------------------
// Ore Reroll Candidates — delegates to oreRerollToGroups → generateRulesFromGroups
// ---------------------------------------------------------------------------

export function generateOreRerollRules(block: OreRerollBlock | undefined): HsfRule[] {
  return generateRulesFromGroups(oreRerollToGroups(block));
}
