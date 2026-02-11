/**
 * Property-based tests: three-level pipeline equivalence.
 *
 * For any random QuickGenState + Item, the three pipeline stages agree:
 * 1. matchesQuickState(state, item) — direct evaluation
 * 2. groups.some(g => matchesGroup(g, item)) — group-level
 * 3. rules.some(r => matchesRule(r, item)) — rule-level
 */
import { describe, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateFilter,
  parseFilter,
  serializeFilter,
} from "@rslh/core";
import type { Item } from "@rslh/core";
import { generateRulesFromGroups } from "../generate-rules.js";
import {
  quickStateToGroups,
  oreRerollToGroups,
  rareAccessoriesToGroups,
} from "../quick-generator.js";
import type { QuickGenState } from "../quick-generator.js";
import { SUBSTAT_PRESETS } from "../generator.js";
import type { SettingGroup } from "../generator.js";
import {
  matchesGroup,
  anyRuleMatches,
  hsfRarityToIndex,
} from "./helpers/invariants.js";
import type { SettingGroupLike } from "./helpers/invariants.js";
import { arbItem, arbQuickGenState, arbQuickGenStateLight } from "./helpers/arbitraries.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "pipeline.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

// ---------------------------------------------------------------------------
// matchesQuickState — reference evaluator against raw QuickGenState
// ---------------------------------------------------------------------------

function matchesQuickState(state: QuickGenState, item: Item): boolean {
  // --- Build profiles ---
  for (const block of state.blocks) {
    for (let ti = 0; ti < block.tiers.length; ti++) {
      const tier = block.tiers[ti];
      if (tier.rolls < 0) continue;

      // Is this item's set assigned to this tier?
      if (block.assignments[item.set] !== ti) continue;

      // Must have selected profiles
      if (block.selectedProfiles.length === 0) continue;

      // Rank: rank 6 always eligible; rank 5 only if tier.rolls + 2 <= 9
      const rankOk =
        item.rank >= 6 ||
        (item.rank >= 5 && tier.rolls + 2 <= 9);
      if (!rankOk) continue;

      // Rarity: default is 16 → hsfRarityToIndex(16) = 4 (Legendary)
      if (item.rarity < hsfRarityToIndex(16)) continue;

      // slots=[] → any slot; mainStats=[] → any main stat
      // For each profile, check if at least one has effective good stats
      for (const pi of block.selectedProfiles) {
        const preset = SUBSTAT_PRESETS[pi];
        if (!preset) continue;

        // With mainStats=[] (any), effectiveGoodStats = all goodStats
        // Since quick gen always uses mainStats=[], effective = full preset.stats
        if (preset.stats.length > 0) {
          return true;
        }
      }
    }
  }

  // --- Rare accessories ---
  if (state.rareAccessories) {
    for (const [setIdStr, factionIds] of Object.entries(state.rareAccessories.selections)) {
      const setId = Number(setIdStr);
      if (!factionIds || factionIds.length === 0) continue;

      if (item.set !== setId) continue;
      if (![7, 8, 9].includes(item.slot)) continue;

      for (const factionId of factionIds) {
        if (item.faction === factionId) {
          return true;
        }
      }
    }
  }

  // --- Ore reroll ---
  if (state.oreReroll) {
    // Group sets by column
    const columnSets: number[][] = [[], [], []];
    for (const [setIdStr, colIdx] of Object.entries(state.oreReroll.assignments)) {
      if (colIdx >= 0 && colIdx < 3) {
        columnSets[colIdx].push(Number(setIdStr));
      }
    }

    for (let ci = 0; ci < 3; ci++) {
      const sets = columnSets[ci];
      if (sets.length === 0) continue;
      if (!sets.includes(item.set)) continue;

      const extraRolls = ci + 3;

      for (const rank of [6, 5] as const) {
        const totalTarget = rank === 6 ? extraRolls + 1 : extraRolls + 2;
        if (totalTarget > 6) continue;
        if (item.rank < rank) continue;

        // Rarity: always >= Mythical (15 → index 5)
        if (item.rarity >= hsfRarityToIndex(15)) {
          return true;
        }
        // Also >= Epic (9 → index 3) when totalTarget <= 4
        if (totalTarget <= 4 && item.rarity >= hsfRarityToIndex(9)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helper: collect all groups from a QuickGenState
// ---------------------------------------------------------------------------

function allGroups(state: QuickGenState): SettingGroup[] {
  return [
    ...rareAccessoriesToGroups(state.rareAccessories),
    ...quickStateToGroups(state),
    ...oreRerollToGroups(state.oreReroll),
  ];
}

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("pipeline.prop — three-level equivalence", () => {
  fcTest.prop(
    [arbQuickGenStateLight, arbItem],
    cfg("group match → rule match (no false positives at rule level)"),
  )("group match → rule match (no false positives at rule level)", (state, item) => {
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));
    const ruleMatch = anyRuleMatches(rules, item);

    // If rules match, groups must also match
    if (ruleMatch) {
      expect(groupMatch).toBe(true);
    }
  });

  fcTest.prop(
    [arbQuickGenStateLight, arbItem],
    cfg("unconditional groups: group match ↔ rule match"),
  )("unconditional groups: group match ↔ rule match", (state, item) => {
    const groups = allGroups(state);
    const unconditionalGroups = groups.filter((g) => g.goodStats.length === 0);
    const unconditionalRules = generateRulesFromGroups(unconditionalGroups);

    const groupMatch = unconditionalGroups.some(
      (g) => matchesGroup(g as SettingGroupLike, item),
    );
    const ruleMatch = anyRuleMatches(unconditionalRules, item);

    expect(ruleMatch).toBe(groupMatch);
  });

  fcTest.prop(
    [arbQuickGenState, arbItem],
    cfg("quickState match → group match (state level implies group level)"),
  )("quickState match → group match (state level implies group level)", (state, item) => {
    const groups = allGroups(state);
    const stateMatch = matchesQuickState(state, item);
    const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));

    if (stateMatch) {
      expect(groupMatch).toBe(true);
    }
  });

  fcTest.prop(
    [arbQuickGenState, arbItem],
    cfg("group match → quickState match (group level implies state level)"),
  )("group match → quickState match (group level implies state level)", (state, item) => {
    const groups = allGroups(state);
    const stateMatch = matchesQuickState(state, item);
    const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));

    if (groupMatch) {
      expect(stateMatch).toBe(true);
    }
  });

  fcTest.prop(
    [arbQuickGenStateLight],
    cfg("full round-trip: state → groups → rules → filter → serialize → parse"),
  )("full round-trip: state → groups → rules → filter → serialize → parse", (state) => {
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    if (rules.length === 0) return;

    const filter = generateFilter(rules);
    const json = serializeFilter(filter);
    const parsed = parseFilter(json);

    expect(parsed.Rules.length).toBe(filter.Rules.length);
  });

  fcTest.prop(
    [arbQuickGenStateLight],
    cfg("pipeline is deterministic"),
  )("pipeline is deterministic", (state) => {
    const groups1 = allGroups(state);
    const rules1 = generateRulesFromGroups(groups1);

    const groups2 = allGroups(state);
    const rules2 = generateRulesFromGroups(groups2);

    expect(rules1).toEqual(rules2);
  });
});
