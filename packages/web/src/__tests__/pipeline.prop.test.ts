/**
 * Property-based tests: three-level pipeline equivalence.
 *
 * For any random QuickGenState + batch of targeted items, the three pipeline
 * stages agree:
 * 1. matchesQuickState(state, item) — direct evaluation
 * 2. groups.some(g => matchesGroup(g, item)) — group-level
 * 3. rules.some(r => matchesRule(r, item)) — rule-level
 */
import { describe, expect, afterAll } from "vitest";
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
import {
  arbQuickGenStateLight,
  arbItemsForState,
} from "./helpers/arbitraries.js";
import type { TaggedItem } from "./helpers/arbitraries.js";
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
// Instrumentation: keep/sell stats by test × strategy
// ---------------------------------------------------------------------------

type Strategy = TaggedItem["strategy"];

interface StrategyStats {
  total: number;
  keep: number;
  sell: number;
}

const statsBy: Record<string, StrategyStats> = {};
let globalRun = 0;

function ensureStats(key: string): StrategyStats {
  if (!statsBy[key]) statsBy[key] = { total: 0, keep: 0, sell: 0 };
  return statsBy[key];
}

function logItem(
  test: string,
  run: number,
  idx: number,
  strategy: Strategy,
  item: Item,
  ruleMatch: boolean,
): void {
  const s = ensureStats(`${test}::${strategy}`);
  s.total++;
  if (ruleMatch) s.keep++;
  else s.sell++;
}

// ---------------------------------------------------------------------------
// Composed arbitraries: state + tagged items via fc.chain
// ---------------------------------------------------------------------------

const arbLightStateWithItems = arbQuickGenStateLight.chain((state) =>
  arbItemsForState(state).map((taggedItems) => [state, taggedItems] as const),
);

// Note: uses the light state to stay within per-test timeout — the coverage
// gain comes from the targeted item batch, not from larger state sizes.
const arbFullStateWithItems = arbQuickGenStateLight.chain((state) =>
  arbItemsForState(state).map((taggedItems) => [state, taggedItems] as const),
);

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("pipeline.prop — three-level equivalence", () => {
  fcTest.prop(
    [arbLightStateWithItems],
    cfg("group match → rule match (batch)"),
  )("group match → rule match (batch)", ([state, taggedItems]) => {
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    const run = globalRun++;

    for (let i = 0; i < taggedItems.length; i++) {
      const { item, strategy } = taggedItems[i];
      const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));
      const ruleMatch = anyRuleMatches(rules, item);

      logItem("group→rule", run, i, strategy, item, ruleMatch);

      // If rules match, groups must also match
      if (ruleMatch) {
        expect(groupMatch).toBe(true);
      }
    }
  });

  fcTest.prop(
    [arbLightStateWithItems],
    cfg("unconditional groups ↔ rules (batch)"),
  )("unconditional groups ↔ rules (batch)", ([state, taggedItems]) => {
    const groups = allGroups(state);
    const unconditionalGroups = groups.filter((g) => g.goodStats.length === 0);
    const unconditionalRules = generateRulesFromGroups(unconditionalGroups);
    const run = globalRun++;

    for (let i = 0; i < taggedItems.length; i++) {
      const { item, strategy } = taggedItems[i];
      const groupMatch = unconditionalGroups.some(
        (g) => matchesGroup(g as SettingGroupLike, item),
      );
      const ruleMatch = anyRuleMatches(unconditionalRules, item);

      logItem("uncond", run, i, strategy, item, ruleMatch);

      expect(ruleMatch).toBe(groupMatch);
    }
  });

  fcTest.prop(
    [arbFullStateWithItems],
    cfg("state ↔ group ↔ rule three-level (batch)"),
  )("state ↔ group ↔ rule three-level (batch)", ([state, taggedItems]) => {
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    const run = globalRun++;

    for (let i = 0; i < taggedItems.length; i++) {
      const { item, strategy } = taggedItems[i];
      const stateMatch = matchesQuickState(state, item);
      const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));
      const ruleMatch = anyRuleMatches(rules, item);

      logItem("three-level", run, i, strategy, item, ruleMatch);

      // State match ↔ group match (bidirectional)
      if (stateMatch) expect(groupMatch).toBe(true);
      if (groupMatch) expect(stateMatch).toBe(true);

      // Rule match → group match (no false positives at rule level)
      if (ruleMatch) expect(groupMatch).toBe(true);
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

  // -------------------------------------------------------------------------
  // Print aggregate stats and write per-item log
  // -------------------------------------------------------------------------

  afterAll(() => {
    const LINE = "=".repeat(70);
    const lines: string[] = [LINE, "PIPELINE PROPERTY TEST — ITEM MATCH STATS", LINE];

    let totalKeep = 0;
    let totalAll = 0;

    // Sort keys for stable output: test::strategy
    const keys = Object.keys(statsBy).sort();
    for (const key of keys) {
      const s = statsBy[key];
      totalKeep += s.keep;
      totalAll += s.total;
      const pct = s.total > 0 ? ((s.keep / s.total) * 100).toFixed(1) : "0.0";
      lines.push(
        `  ${key.padEnd(38)} : ${String(s.keep).padStart(5)}/${String(s.total).padStart(5)} keep (${pct.padStart(5)}%), ${String(s.sell).padStart(5)} sell`,
      );
    }

    const totalPct = totalAll > 0 ? ((totalKeep / totalAll) * 100).toFixed(1) : "0.0";
    lines.push(
      `  ${"TOTAL".padEnd(38)} : ${String(totalKeep).padStart(5)}/${String(totalAll).padStart(5)} keep (${totalPct.padStart(5)}%), ${String(totalAll - totalKeep).padStart(5)} sell`,
    );
    lines.push(LINE);

    console.log(lines.join("\n"));
  });
});
