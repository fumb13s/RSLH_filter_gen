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
    if (group.goodStats.length === 0) continue;

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
        const levelRolls = group.rolls - li;
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
              const [statId] = effectiveGoodStats[i];
              const range = getRollRange(statId, rank);
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
            Rank: rank,
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

/** Generate unconditional keep rules for rare accessory set+faction selections. */
export function generateRareAccessoryRules(block: RareAccessoryBlock | undefined): HsfRule[] {
  if (!block) return [];
  const rules: HsfRule[] = [];

  for (const [setIdStr, factionIds] of Object.entries(block.selections)) {
    const setId = Number(setIdStr);
    if (!factionIds || factionIds.length === 0) continue;

    for (const factionId of factionIds) {
      rules.push(defaultRule({
        ArtifactSet: [setId],
        ArtifactType: [7, 8, 9],
        Faction: factionId,
        Rank: 6,
        Rarity: 16,
        LVLForCheck: 0,
        MainStatID: -1,
        IsRuleTypeAND: true,
      }));
    }
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Ore Reroll Candidates — concentrated-roll OR rules
// ---------------------------------------------------------------------------

const LEVEL_CHECKPOINTS = [16, 12, 8, 4, 0] as const;

/**
 * Walkback thresholds for concentrated substats at each level checkpoint.
 *
 * Epic: rolls at L4, L8, L12; new substat at L16 → L16=T, L12=T, L8=T-1, L4=T-2, L0=T-3
 * Leg/Myth: rolls at L0, L4, L8, L12, L16 → L16=T, L12=T-1, L8=T-2, L4=T-3, L0=T-4
 *
 * Returns array of { level, threshold } pairs (skips where threshold ≤ 0).
 */
function oreWalkback(target: number, isEpic: boolean): { level: number; threshold: number }[] {
  const steps: { level: number; threshold: number }[] = [];
  for (let i = 0; i < LEVEL_CHECKPOINTS.length; i++) {
    const level = LEVEL_CHECKPOINTS[i];
    // Epic: first two checkpoints (L16, L12) stay at target, then -1 per step
    // Leg/Myth: decreases by 1 each step from L16
    const decrement = isEpic ? Math.max(0, i - 1) : i;
    const threshold = target - decrement;
    if (threshold <= 0) break;
    steps.push({ level, threshold });
  }
  return steps;
}

// All percentage substats that can receive concentrated rolls
const ORE_STATS = [1, 2, 3, 4, 5, 6, 7, 8]; // HP%, ATK%, DEF%, SPD, CRATE, CDMG, RES, ACC

/**
 * Generate single-substat rules for ore reroll candidates.
 *
 * One rule per stat per level checkpoint — each rule checks whether a single
 * substat has enough concentrated rolls to be worth keeping for ore reroll.
 *
 * Column labels are extra rolls (excluding the base roll). The total concentrated
 * value = (extra + 1) × min, so the viewer displays "(extra)" after subtracting
 * the base roll.
 *
 * Column mapping: 0=3extra, 1=4extra, 2=5extra
 * Rank 5 adds +1 to compensate for lower roll values.
 *
 * Max concentrated totals: Epic=4, Legendary=5, Mythical=6.
 */
export function generateOreRerollRules(block: OreRerollBlock | undefined): HsfRule[] {
  if (!block) return [];
  const rules: HsfRule[] = [];

  // Group sets by column
  const columnSets: number[][] = [[], [], []];
  for (const [setIdStr, colIdx] of Object.entries(block.assignments)) {
    if (colIdx >= 0 && colIdx < 3) {
      columnSets[colIdx].push(Number(setIdStr));
    }
  }

  for (let ci = 0; ci < 3; ci++) {
    const sets = columnSets[ci];
    if (sets.length === 0) continue;

    const extraRolls = ci + 3; // column 0=3, 1=4, 2=5

    // For each rank (6 and 5)
    for (const rank of [6, 5] as const) {
      // Total concentrated rolls = base(1) + extra + rank5 penalty(+1)
      const totalTarget = rank === 6 ? extraRolls + 1 : extraRolls + 2;
      if (totalTarget > 6) continue; // exceeds Mythical max concentrated

      // Rarity=15 (Leg/Myth) rules with Leg/Myth walkback
      const steps15 = oreWalkback(totalTarget, false);
      for (const { level, threshold: t } of steps15) {
        for (const statId of ORE_STATS) {
          const range = getRollRange(statId, rank);
          if (!range) continue;
          const rule = defaultRule({
            ArtifactSet: [...sets],
            Rank: rank,
            Rarity: 15,
            IsRuleTypeAND: false,
            LVLForCheck: level,
            Substats: [
              { ID: statId, Value: t * range[0], IsFlat: false, NotAvailable: false, Condition: ">=" },
              emptySubstat(), emptySubstat(), emptySubstat(),
            ],
          });
          delete rule.ArtifactType;
          rules.push(rule);
        }
      }

      // Rarity=9 (Epic+) rules with Epic walkback — only when Epic can achieve it
      if (totalTarget <= 4) {
        const steps9 = oreWalkback(totalTarget, true);
        for (const { level, threshold: t } of steps9) {
          for (const statId of ORE_STATS) {
            const range = getRollRange(statId, rank);
            if (!range) continue;
            const rule = defaultRule({
              ArtifactSet: [...sets],
              Rank: rank,
              Rarity: 9,
              IsRuleTypeAND: false,
              LVLForCheck: level,
              Substats: [
                { ID: statId, Value: t * range[0], IsFlat: false, NotAvailable: false, Condition: ">=" },
                emptySubstat(), emptySubstat(), emptySubstat(),
              ],
            });
            delete rule.ArtifactType;
            rules.push(rule);
          }
        }
      }
    }
  }

  return rules;
}
