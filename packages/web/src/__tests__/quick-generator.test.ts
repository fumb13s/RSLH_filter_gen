import { describe, it, expect } from "vitest";
import { generateFilter, getRollRange, ARTIFACT_SET_NAMES } from "@rslh/core";
import type { HsfRule } from "@rslh/core";
import {
  generateOreRerollRules,
  generateRulesFromGroups,
  generateRareAccessoryRules,
} from "../generate-rules.js";
import {
  defaultQuickState,
  quickStateToGroups,
  oreRerollToGroups,
  stripBlockColors,
  restoreBlockColors,
} from "../quick-generator.js";
import type { OreRerollBlock, RareAccessoryBlock } from "../quick-generator.js";
import { SUBSTAT_PRESETS } from "../generator.js";
import type { SettingGroup } from "../generator.js";

// ---------------------------------------------------------------------------
// Invariant checker — applied to every rule array produced by tests
// ---------------------------------------------------------------------------

function assertRuleInvariants(rules: HsfRule[]): void {
  for (const rule of rules) {
    // Every rule has exactly 4 substats
    expect(rule.Substats).toHaveLength(4);

    // Every ArtifactSet entry (when present) is a valid set ID
    if (rule.ArtifactSet) {
      for (const id of rule.ArtifactSet) {
        expect(ARTIFACT_SET_NAMES[id]).toBeDefined();
      }
    }

    // Max possible rolls for the rule's level checkpoint
    const maxPerSlot = 2 + rule.LVLForCheck / 4;

    for (const s of rule.Substats) {
      if (s.ID <= 0) continue;

      const range = getRollRange(s.ID, rule.Rank, s.IsFlat);
      expect(range).toBeDefined();
      if (!range) continue;

      // Value must be achievable: implied rolls = ceil(Value / range[0])
      const impliedRolls = Math.ceil(s.Value / range[0]);
      expect(impliedRolls).toBeGreaterThan(0);
      expect(impliedRolls).toBeLessThanOrEqual(maxPerSlot);

      // Value must be within [rolls × min, rolls × max]
      expect(s.Value).toBeGreaterThanOrEqual(impliedRolls * range[0]);
      expect(s.Value).toBeLessThanOrEqual(impliedRolls * range[1]);
    }
  }
}

// ---------------------------------------------------------------------------
// quickStateToGroups
// ---------------------------------------------------------------------------

describe("quickStateToGroups", () => {
  it("no profiles → no groups", () => {
    const state = defaultQuickState();
    // default has no selectedProfiles
    const groups = quickStateToGroups(state);
    expect(groups).toEqual([]);
  });

  it("single profile, multiple tiers", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0]; // HP Nuker

    const groups = quickStateToGroups(state);
    expect(groups.length).toBeGreaterThan(0);

    // Each non-sell tier with sets should produce rank 6 group (and possibly rank 5)
    const nonSellTiers = state.blocks[0].tiers.filter((t) => t.rolls >= 0);
    const tiersWithSets = nonSellTiers.filter((_, ti) => {
      return Object.values(state.blocks[0].assignments).some((idx) => idx === ti);
    });

    // At least one group per tier-with-sets (rank 6), possibly rank 5 too
    expect(groups.length).toBeGreaterThanOrEqual(tiersWithSets.length);

    // Every group has the HP Nuker good stats
    const hpNukerStats = SUBSTAT_PRESETS[0].stats;
    for (const g of groups) {
      expect(g.goodStats).toEqual(hpNukerStats.map(([s, f]) => [s, f]));
    }
  });

  it("sell tier (rolls=-1) is skipped", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0];
    // Set last tier to sell
    const lastIdx = state.blocks[0].tiers.length - 1;
    state.blocks[0].tiers[lastIdx].sellRolls = state.blocks[0].tiers[lastIdx].rolls;
    state.blocks[0].tiers[lastIdx].rolls = -1;

    // Assign a set to the sell tier
    const someSetId = Number(Object.keys(state.blocks[0].assignments)[0]);
    state.blocks[0].assignments[someSetId] = lastIdx;

    const groups = quickStateToGroups(state);
    // None of the groups should contain the set assigned to the sell tier alone
    // (it might appear in other tiers too, but the sell tier shouldn't generate groups)
    const sellTierSets = Object.entries(state.blocks[0].assignments)
      .filter(([, idx]) => idx === lastIdx)
      .map(([id]) => Number(id));

    // Verify no group has ONLY sell-tier sets
    for (const g of groups) {
      const isOnlySellSets = g.sets.every((s) => sellTierSets.includes(s));
      const otherTierHasSameSet = g.sets.some((s) =>
        Object.entries(state.blocks[0].assignments).some(
          ([id, idx]) => Number(id) === s && idx !== lastIdx,
        ),
      );
      if (isOnlySellSets) {
        expect(otherTierHasSameSet).toBe(true);
      }
    }
  });

  it("rank 5 cutoff at rolls=8", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0];
    // Set all tiers to rolls=8 except make only one tier have sets
    state.blocks[0].tiers = [
      { name: "Test", rolls: 8, color: "#22c55e" },
    ];
    // Assign one set to tier 0
    state.blocks[0].assignments = { 1: 0 };

    const groups = quickStateToGroups(state);
    // rolls=8, rank5Rolls=10 > 9, so only rank 6 group should be produced
    expect(groups).toHaveLength(1);
    expect(groups[0].rank).toBe(6);
    expect(groups[0].rolls).toBe(8);
  });

  it("multiple profiles → groups for each profile × tier", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0, 1]; // HP Nuker, ATK Nuker
    state.blocks[0].tiers = [
      { name: "Tier1", rolls: 5, color: "#22c55e" },
    ];
    state.blocks[0].assignments = { 1: 0 };

    const groups = quickStateToGroups(state);
    // 2 profiles × 1 tier × 2 ranks (5+2=7 ≤ 9, so both rank 6 and rank 5)
    expect(groups).toHaveLength(4);
  });

  it("empty tier (no sets assigned) is skipped", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0];
    state.blocks[0].tiers = [
      { name: "Empty", rolls: 5, color: "#22c55e" },
      { name: "HasSets", rolls: 7, color: "#3b82f6" },
    ];
    // All sets assigned to tier 1, none to tier 0
    state.blocks[0].assignments = { 1: 1, 2: 1 };

    const groups = quickStateToGroups(state);
    // Only tier 1 should produce groups
    for (const g of groups) {
      expect(g.sets).toEqual(expect.arrayContaining([1, 2]));
      expect(g.rolls === 7 || g.rolls === 9).toBe(true); // tier rolls=7, rank5=9
    }
  });

  it("multiple blocks produce groups from both", () => {
    const state = defaultQuickState();
    // Block 0: profile 0, one tier, one set
    state.blocks[0].selectedProfiles = [0];
    state.blocks[0].tiers = [{ name: "T1", rolls: 9, color: "#22c55e" }];
    state.blocks[0].assignments = { 1: 0 };

    // Block 1: profile 1, one tier, different set
    state.blocks.push({
      tiers: [{ name: "T2", rolls: 9, color: "#3b82f6" }],
      assignments: { 2: 0 },
      selectedProfiles: [1],
    });

    const groups = quickStateToGroups(state);
    // Each block has 1 profile × 1 tier; rolls=9 → rank5Rolls=11 > 9, so rank 6 only
    expect(groups).toHaveLength(2);
    expect(groups[0].sets).toEqual([1]);
    expect(groups[1].sets).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// generateRulesFromGroups
// ---------------------------------------------------------------------------

describe("generateRulesFromGroups", () => {
  it("empty groups → empty rules", () => {
    expect(generateRulesFromGroups([])).toEqual([]);
  });

  it("empty goodStats → skipped", () => {
    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [], rolls: 5 },
    ];
    expect(generateRulesFromGroups(groups)).toEqual([]);
  });

  it("single stat, single roll → one rule at L16", () => {
    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [[1, false]], rolls: 1, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);

    // rolls=1 → L16(1), L12(0) stops → just 1 checkpoint
    expect(rules).toHaveLength(1);
    expect(rules[0].LVLForCheck).toBe(16);

    const range = getRollRange(1, 6)!;
    const active = rules[0].Substats.filter((s) => s.ID > 0);
    expect(active).toHaveLength(1);
    expect(active[0].Value).toBe(1 * range[0]);

    assertRuleInvariants(rules);
  });

  it("level checkpoint walkback — rolls=3 → rules at L16, L12, L8", () => {
    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [[5, false]], rolls: 3, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);

    // rolls=3: L16(3), L12(2), L8(1), L4(0→stop)
    const levels = [...new Set(rules.map((r) => r.LVLForCheck))].sort((a, b) => b - a);
    expect(levels).toEqual([16, 12, 8]);

    assertRuleInvariants(rules);
  });

  it("partition count — 2 good stats, rolls=2, L16", () => {
    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [[1, false], [2, false]], rolls: 2, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);

    // At L16: partitions of 2 into 2 slots (max 6 per slot) = [2,0],[1,1],[0,2] = 3 rules
    const l16Rules = rules.filter((r) => r.LVLForCheck === 16);
    expect(l16Rules).toHaveLength(3);

    assertRuleInvariants(rules);
  });

  it("main stat filtering — excludes main stat from effective good stats", () => {
    const groups: SettingGroup[] = [
      {
        sets: [1], slots: [], mainStats: [[2, false]], // ATK% main
        goodStats: [[2, false], [5, false]], // ATK% + C.RATE
        rolls: 1, rank: 6,
      },
    ];
    const rules = generateRulesFromGroups(groups);

    // ATK% is excluded from effective good stats, leaving only C.RATE
    for (const rule of rules) {
      // MainStatID should be 2 (ATK%)
      if (rule.MainStatID === 2 && rule.MainStatF === 1) {
        const active = rule.Substats.filter((s) => s.ID > 0);
        // Should only have C.RATE (ID=5), not ATK% (ID=2)
        for (const s of active) {
          expect(s.ID).not.toBe(2);
        }
      }
    }

    assertRuleInvariants(rules);
  });

  it("any main stat (empty mainStats) → MainStatID=-1", () => {
    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [[5, false]], rolls: 1, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);

    for (const rule of rules) {
      expect(rule.MainStatID).toBe(-1);
      expect(rule.MainStatF).toBe(1);
    }

    assertRuleInvariants(rules);
  });

  it("ArtifactSet/ArtifactType omission when empty", () => {
    const groups: SettingGroup[] = [
      { sets: [], slots: [], mainStats: [], goodStats: [[5, false]], rolls: 1, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);
    expect(rules.length).toBeGreaterThan(0);

    for (const rule of rules) {
      expect(rule).not.toHaveProperty("ArtifactSet");
      expect(rule).not.toHaveProperty("ArtifactType");
    }

    assertRuleInvariants(rules);
  });

  it("threshold values — HP% rank 6 and SPD rank 6", () => {
    const hpRange = getRollRange(1, 6)!;  // HP%

    const groups: SettingGroup[] = [
      { sets: [1], slots: [], mainStats: [], goodStats: [[1, false]], rolls: 2, rank: 6 },
    ];
    const rules = generateRulesFromGroups(groups);
    const l16Rules = rules.filter((r) => r.LVLForCheck === 16);

    // 2 rolls of HP% at rank 6 → threshold = 2 × min
    const hpRule = l16Rules[0];
    const hpActive = hpRule.Substats.filter((s) => s.ID > 0);
    expect(hpActive[0].Value).toBe(2 * hpRange[0]);

    assertRuleInvariants(rules);
  });

  it("all rules pass zod validation", () => {
    const groups: SettingGroup[] = [
      {
        sets: [1, 2, 3], slots: [1, 2],
        mainStats: [[1, false]], goodStats: [[2, false], [5, false], [6, false]],
        rolls: 5, rank: 6,
      },
    ];
    const rules = generateRulesFromGroups(groups);
    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
    assertRuleInvariants(rules);
  });
});

// ---------------------------------------------------------------------------
// generateRareAccessoryRules
// ---------------------------------------------------------------------------

describe("generateRareAccessoryRules", () => {
  it("undefined block → empty", () => {
    expect(generateRareAccessoryRules(undefined)).toEqual([]);
  });

  it("empty selections → empty", () => {
    const block: RareAccessoryBlock = { selections: {} };
    expect(generateRareAccessoryRules(block)).toEqual([]);
  });

  it("single set, single faction → 1 rule", () => {
    const block: RareAccessoryBlock = { selections: { 47: [1] } };
    const rules = generateRareAccessoryRules(block);

    expect(rules).toHaveLength(1);
    expect(rules[0].ArtifactSet).toEqual([47]);
    expect(rules[0].ArtifactType).toEqual([7, 8, 9]);
    expect(rules[0].Faction).toBe(1);
    expect(rules[0].Rank).toBe(0);
    expect(rules[0].Rarity).toBe(0);

    assertRuleInvariants(rules);
  });

  it("single set, multiple factions → N rules", () => {
    const block: RareAccessoryBlock = { selections: { 47: [1, 2, 3] } };
    const rules = generateRareAccessoryRules(block);

    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.Faction).sort()).toEqual([1, 2, 3]);
    for (const rule of rules) {
      expect(rule.ArtifactSet).toEqual([47]);
    }

    assertRuleInvariants(rules);
  });

  it("multiple sets → each set×faction combo is a separate rule", () => {
    const block: RareAccessoryBlock = { selections: { 47: [1], 48: [2, 3] } };
    const rules = generateRareAccessoryRules(block);

    // 1 + 2 = 3 rules
    expect(rules).toHaveLength(3);

    const set47Rules = rules.filter((r) => r.ArtifactSet![0] === 47);
    const set48Rules = rules.filter((r) => r.ArtifactSet![0] === 48);
    expect(set47Rules).toHaveLength(1);
    expect(set48Rules).toHaveLength(2);

    assertRuleInvariants(rules);
  });

  it("empty faction array → skipped", () => {
    const block: RareAccessoryBlock = { selections: { 47: [] } };
    const rules = generateRareAccessoryRules(block);
    expect(rules).toEqual([]);
  });

  it("all rules pass zod validation", () => {
    const block: RareAccessoryBlock = { selections: { 47: [1, 2], 48: [3] } };
    const rules = generateRareAccessoryRules(block);
    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
    assertRuleInvariants(rules);
  });
});

// ---------------------------------------------------------------------------
// stripBlockColors / restoreBlockColors
// ---------------------------------------------------------------------------

describe("stripBlockColors / restoreBlockColors", () => {
  it("round-trip preserves state (colors restored from defaults)", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0, 1];

    const stripped = stripBlockColors(state);
    const restored = restoreBlockColors(stripped);

    // Tiers should have the same name/rolls
    for (let i = 0; i < state.blocks[0].tiers.length; i++) {
      expect(restored.blocks[0].tiers[i].name).toBe(state.blocks[0].tiers[i].name);
      expect(restored.blocks[0].tiers[i].rolls).toBe(state.blocks[0].tiers[i].rolls);
      expect(restored.blocks[0].tiers[i].color).toBe(state.blocks[0].tiers[i].color);
    }

    // Profiles preserved
    expect(restored.blocks[0].selectedProfiles).toEqual(state.blocks[0].selectedProfiles);
    // Assignments preserved
    expect(restored.blocks[0].assignments).toEqual(state.blocks[0].assignments);
  });

  it("strip removes color field", () => {
    const state = defaultQuickState();
    const stripped = stripBlockColors(state);

    for (const block of stripped.blocks) {
      for (const tier of block.tiers) {
        expect(tier).not.toHaveProperty("color");
      }
    }
  });

  it("restore adds fallback #e5e7eb for extra tiers beyond default count", () => {
    const state = defaultQuickState();
    // Add an extra tier beyond the default 4
    state.blocks[0].tiers.push({ name: "Extra", rolls: 4, color: "#000" });

    const stripped = stripBlockColors(state);
    const restored = restoreBlockColors(stripped);

    // The 5th tier (index 4) should get fallback color
    expect(restored.blocks[0].tiers[4].color).toBe("#e5e7eb");
  });

  it("sell tier preserves sellRolls through strip/restore", () => {
    const state = defaultQuickState();
    const lastIdx = state.blocks[0].tiers.length - 1;
    state.blocks[0].tiers[lastIdx].sellRolls = 7;
    state.blocks[0].tiers[lastIdx].rolls = -1;

    const stripped = stripBlockColors(state);
    expect(stripped.blocks[0].tiers[lastIdx].sellRolls).toBe(7);
    expect(stripped.blocks[0].tiers[lastIdx].rolls).toBe(-1);

    const restored = restoreBlockColors(stripped);
    expect(restored.blocks[0].tiers[lastIdx].sellRolls).toBe(7);
    expect(restored.blocks[0].tiers[lastIdx].rolls).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Full integration (moved from ore-reroll.test.ts + new tests)
// ---------------------------------------------------------------------------

describe("full quick-gen flow", () => {
  it("generates and validates when default state has a profile selected + ore set assigned", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0];
    state.oreReroll!.assignments[1] = 0;

    const groups = quickStateToGroups(state);
    const rareRules = generateRareAccessoryRules(state.rareAccessories);
    const oreRules = generateOreRerollRules(state.oreReroll);
    const groupRules = generateRulesFromGroups(groups);
    const rules = [...rareRules, ...oreRules, ...groupRules];

    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
    assertRuleInvariants(rules);
  });

  it("generates and validates when only ore reroll is configured (no profiles)", () => {
    const state = defaultQuickState();
    state.oreReroll!.assignments[1] = 2;

    const groups = quickStateToGroups(state);
    const rareRules = generateRareAccessoryRules(state.rareAccessories);
    const oreRules = generateOreRerollRules(state.oreReroll);
    const groupRules = generateRulesFromGroups(groups);
    const rules = [...rareRules, ...oreRules, ...groupRules];

    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
    assertRuleInvariants(rules);
  });

  it("all three paths produce rules, combined passes zod", () => {
    const state = defaultQuickState();
    // Profile for group rules
    state.blocks[0].selectedProfiles = [0];
    // Ore reroll
    state.oreReroll!.assignments[1] = 0;
    // Rare accessories
    state.rareAccessories!.selections[47] = [1, 2];

    const groups = quickStateToGroups(state);
    const groupRules = generateRulesFromGroups(groups);
    const oreRules = generateOreRerollRules(state.oreReroll);
    const rareRules = generateRareAccessoryRules(state.rareAccessories);

    expect(groupRules.length).toBeGreaterThan(0);
    expect(oreRules.length).toBeGreaterThan(0);
    expect(rareRules.length).toBeGreaterThan(0);

    const combined = [...rareRules, ...oreRules, ...groupRules];
    expect(() => generateFilter(combined)).not.toThrow();
    assertRuleInvariants(combined);
  });

  it("strip/restore round-trip produces same rules", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0, 1];
    state.oreReroll!.assignments[1] = 0;
    state.rareAccessories!.selections[47] = [1];

    // Generate rules from original state
    const groups1 = quickStateToGroups(state);
    const rules1 = [
      ...generateRareAccessoryRules(state.rareAccessories),
      ...generateOreRerollRules(state.oreReroll),
      ...generateRulesFromGroups(groups1),
    ];

    // Strip → JSON → parse → restore
    const stripped = stripBlockColors(state);
    const json = JSON.stringify(stripped);
    const parsed = JSON.parse(json);
    const restored = restoreBlockColors(parsed);

    // Generate rules from restored state
    const groups2 = quickStateToGroups(restored);
    const rules2 = [
      ...generateRareAccessoryRules(restored.rareAccessories),
      ...generateOreRerollRules(restored.oreReroll),
      ...generateRulesFromGroups(groups2),
    ];

    expect(rules2.length).toBe(rules1.length);
    assertRuleInvariants(rules2);
  });
});

// ---------------------------------------------------------------------------
// oreRerollToGroups → generateRulesFromGroups equivalence
// ---------------------------------------------------------------------------

describe("ore reroll two-step pipeline", () => {
  it("oreRerollToGroups + generateRulesFromGroups equals generateOreRerollRules", () => {
    const block: OreRerollBlock = { assignments: { 1: 0, 42: 1, 10: 2 } };

    // Direct (wrapper) path
    const directRules = generateOreRerollRules(block);

    // Two-step path
    const groups = oreRerollToGroups(block);
    const twoStepRules = generateRulesFromGroups(groups);

    // Should be identical
    expect(twoStepRules).toEqual(directRules);
    assertRuleInvariants(twoStepRules);
  });

  it("ore groups produce valid rules that pass zod", () => {
    const block: OreRerollBlock = { assignments: { 1: 0, 2: 1, 3: 2 } };
    const groups = oreRerollToGroups(block);
    const rules = generateRulesFromGroups(groups);

    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
    assertRuleInvariants(rules);
  });
});
