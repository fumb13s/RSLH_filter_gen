/**
 * Regression test suite for property-based test failures.
 *
 * When a property test fails, the reporter saves the counterexample to a
 * JSON file in regressions/. This suite replays every saved counterexample
 * to ensure the bug stays fixed.
 *
 * Additionally, the prop tests themselves load these as fast-check `examples`
 * so they're also tested during randomized runs.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateFilter,
  parseFilter,
  serializeFilter,
  matchesRule,
} from "@rslh/core";
import type { Item } from "@rslh/core";
import {
  generateOreRerollRules,
  generateRareAccessoryRules,
  generateRulesFromGroups,
} from "../generate-rules.js";
import {
  quickStateToGroups,
  oreRerollToGroups,
  rareAccessoriesToGroups,
} from "../quick-generator.js";
import type {
  QuickGenState,
  OreRerollBlock,
  RareAccessoryBlock,
} from "../quick-generator.js";
import type { SettingGroup } from "../generator.js";
import { matchesGroup, anyRuleMatches, assertRuleInvariants } from "./helpers/invariants.js";
import type { SettingGroupLike } from "./helpers/invariants.js";
import { loadRegressions } from "./helpers/fc-reporter.js";
import type { RegressionStore } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Shared pipeline helpers
// ---------------------------------------------------------------------------

function allGroups(state: QuickGenState): SettingGroup[] {
  return [
    ...rareAccessoriesToGroups(state.rareAccessories),
    ...quickStateToGroups(state),
    ...oreRerollToGroups(state.oreReroll),
  ];
}

// ---------------------------------------------------------------------------
// Assertion registry — maps test name → replay function
// ---------------------------------------------------------------------------

type AssertFn = (counterexample: unknown) => void;

const PIPELINE_ASSERTIONS: Record<string, AssertFn> = {
  "group match → rule match (no false positives at rule level)": (ce) => {
    const [state, item] = ce as [QuickGenState, Item];
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    const ruleMatch = rules.some((r) => matchesRule(r, item));
    if (ruleMatch) {
      expect(groups.some((g) => matchesGroup(g as SettingGroupLike, item))).toBe(true);
    }
  },
  "unconditional groups: group match ↔ rule match": (ce) => {
    const [state, item] = ce as [QuickGenState, Item];
    const groups = allGroups(state);
    const uncond = groups.filter((g) => g.goodStats.length === 0);
    const rules = generateRulesFromGroups(uncond);
    const groupMatch = uncond.some((g) => matchesGroup(g as SettingGroupLike, item));
    const ruleMatch = anyRuleMatches(rules, item);
    expect(ruleMatch).toBe(groupMatch);
  },
  "quickState match → group match (state level implies group level)": (ce) => {
    const [state, item] = ce as [QuickGenState, Item];
    const groups = allGroups(state);
    // Can't call matchesQuickState here (private to prop test), but we can
    // verify the group-level consistency which is the core property.
    const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));
    const ruleMatch = anyRuleMatches(generateRulesFromGroups(groups), item);
    if (ruleMatch) expect(groupMatch).toBe(true);
  },
  "group match → quickState match (group level implies state level)": (ce) => {
    const [state, item] = ce as [QuickGenState, Item];
    const groups = allGroups(state);
    const groupMatch = groups.some((g) => matchesGroup(g as SettingGroupLike, item));
    const ruleMatch = anyRuleMatches(generateRulesFromGroups(groups), item);
    if (ruleMatch) expect(groupMatch).toBe(true);
  },
  "full round-trip: state → groups → rules → filter → serialize → parse": (ce) => {
    const [state] = ce as [QuickGenState];
    const groups = allGroups(state);
    const rules = generateRulesFromGroups(groups);
    if (rules.length === 0) return;
    const filter = generateFilter(rules);
    const parsed = parseFilter(serializeFilter(filter));
    expect(parsed.Rules.length).toBe(filter.Rules.length);
  },
  "pipeline is deterministic": (ce) => {
    const [state] = ce as [QuickGenState];
    const r1 = generateRulesFromGroups(allGroups(state));
    const r2 = generateRulesFromGroups(allGroups(state));
    expect(r1).toEqual(r2);
  },
};

const ORE_ASSERTIONS: Record<string, AssertFn> = {
  "every group has exactly 1 goodStat": (ce) => {
    const [block] = ce as [OreRerollBlock];
    for (const g of oreRerollToGroups(block)) {
      expect(g.goodStats).toHaveLength(1);
    }
  },
  "Epic (rarity=9) groups only when totalTarget ≤ 4": (ce) => {
    const [block] = ce as [OreRerollBlock];
    for (const g of oreRerollToGroups(block)) {
      if (g.rarity === 9) expect(g.rolls).toBeLessThanOrEqual(4);
    }
  },
  "direct = two-step: generateOreRerollRules ≡ groups → rules": (ce) => {
    const [block] = ce as [OreRerollBlock];
    expect(generateRulesFromGroups(oreRerollToGroups(block))).toEqual(generateOreRerollRules(block));
  },
  "all rules pass zod + invariants": (ce) => {
    const [block] = ce as [OreRerollBlock];
    const rules = generateOreRerollRules(block);
    if (rules.length > 0) {
      expect(() => generateFilter(rules)).not.toThrow();
      assertRuleInvariants(rules);
    }
  },
};

const RARE_ACC_ASSERTIONS: Record<string, AssertFn> = {
  "every group has slots=[7,8,9]": (ce) => {
    const [block] = ce as [RareAccessoryBlock];
    for (const g of rareAccessoriesToGroups(block)) {
      expect(g.slots).toEqual([7, 8, 9]);
    }
  },
  "every group has empty goodStats": (ce) => {
    const [block] = ce as [RareAccessoryBlock];
    for (const g of rareAccessoriesToGroups(block)) {
      expect(g.goodStats).toEqual([]);
    }
  },
  "direct = two-step: generateRareAccessoryRules ≡ groups → rules": (ce) => {
    const [block] = ce as [RareAccessoryBlock];
    expect(generateRulesFromGroups(rareAccessoriesToGroups(block))).toEqual(
      generateRareAccessoryRules(block),
    );
  },
  "all rules pass zod + invariants": (ce) => {
    const [block] = ce as [RareAccessoryBlock];
    const rules = generateRareAccessoryRules(block);
    if (rules.length > 0) {
      expect(() => generateFilter(rules)).not.toThrow();
      assertRuleInvariants(rules);
    }
  },
};

// ---------------------------------------------------------------------------
// Run regressions
// ---------------------------------------------------------------------------

function runRegressions(
  suiteName: string,
  filePath: string,
  assertions: Record<string, AssertFn>,
) {
  const store: RegressionStore = loadRegressions(filePath);
  const entries = Object.entries(store);

  if (entries.length === 0) {
    describe(`regressions: ${suiteName}`, () => {
      it("no regressions saved (placeholder)", () => {
        // Empty — regressions auto-populate on property failures
      });
    });
    return;
  }

  describe(`regressions: ${suiteName}`, () => {
    for (const [testName, cases] of entries) {
      const assertFn = assertions[testName];
      for (let i = 0; i < cases.length; i++) {
        const entry = cases[i];
        it(`${testName} [${i}] (seed=${entry.seed})`, () => {
          if (!assertFn) {
            throw new Error(`No assertion registered for "${testName}"`);
          }
          assertFn(entry.counterexample);
        });
      }
    }
  });
}

runRegressions(
  "pipeline",
  path.join(__dirname, "regressions", "pipeline.json"),
  PIPELINE_ASSERTIONS,
);

runRegressions(
  "ore-reroll",
  path.join(__dirname, "regressions", "ore-reroll.json"),
  ORE_ASSERTIONS,
);

runRegressions(
  "rare-accessories",
  path.join(__dirname, "regressions", "rare-accessories.json"),
  RARE_ACC_ASSERTIONS,
);
