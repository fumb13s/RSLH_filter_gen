/**
 * Property-based tests for ore reroll pipeline.
 */
import { describe, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFilter } from "@rslh/core";
import {
  generateOreRerollRules,
  generateRulesFromGroups,
} from "../generate-rules.js";
import { oreRerollToGroups } from "../quick-generator.js";
import { assertRuleInvariants } from "./helpers/invariants.js";
import { arbOreRerollBlock } from "./helpers/arbitraries.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "ore-reroll.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

describe("ore-reroll.prop — group invariants", () => {
  fcTest.prop(
    [arbOreRerollBlock],
    cfg("every group has exactly 1 goodStat"),
  )("every group has exactly 1 goodStat", (block) => {
    const groups = oreRerollToGroups(block);
    for (const g of groups) {
      expect(g.goodStats).toHaveLength(1);
    }
  });

  fcTest.prop(
    [arbOreRerollBlock],
    cfg("Epic (rarity=9) groups only when totalTarget ≤ 4"),
  )("Epic (rarity=9) groups only when totalTarget ≤ 4", (block) => {
    const groups = oreRerollToGroups(block);
    for (const g of groups) {
      if (g.rarity === 9) {
        expect(g.rolls).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe("ore-reroll.prop — pipeline equivalence", () => {
  fcTest.prop(
    [arbOreRerollBlock],
    cfg("direct = two-step: generateOreRerollRules ≡ groups → rules"),
  )("direct = two-step: generateOreRerollRules ≡ groups → rules", (block) => {
    const directRules = generateOreRerollRules(block);

    const groups = oreRerollToGroups(block);
    const twoStepRules = generateRulesFromGroups(groups);

    expect(twoStepRules).toEqual(directRules);
  });

  fcTest.prop(
    [arbOreRerollBlock],
    cfg("all rules pass zod + invariants"),
  )("all rules pass zod + invariants", (block) => {
    const rules = generateOreRerollRules(block);
    if (rules.length > 0) {
      expect(() => generateFilter(rules)).not.toThrow();
      assertRuleInvariants(rules);
    }
  });
});
