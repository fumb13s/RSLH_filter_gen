/**
 * Property-based tests for rare accessories pipeline.
 */
import { describe, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFilter } from "@rslh/core";
import {
  generateRareAccessoryRules,
  generateRulesFromGroups,
} from "../generate-rules.js";
import { rareAccessoriesToGroups } from "../quick-generator.js";
import { assertRuleInvariants } from "./helpers/invariants.js";
import { arbRareAccessoryBlock } from "./helpers/arbitraries.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "rare-accessories.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

describe("rare-accessories.prop — group invariants", () => {
  fcTest.prop(
    [arbRareAccessoryBlock],
    cfg("every group has slots=[7,8,9]"),
  )("every group has slots=[7,8,9]", (block) => {
    const groups = rareAccessoriesToGroups(block);
    for (const g of groups) {
      expect(g.slots).toEqual([7, 8, 9]);
    }
  });

  fcTest.prop(
    [arbRareAccessoryBlock],
    cfg("every group has empty goodStats"),
  )("every group has empty goodStats", (block) => {
    const groups = rareAccessoriesToGroups(block);
    for (const g of groups) {
      expect(g.goodStats).toEqual([]);
    }
  });
});

describe("rare-accessories.prop — pipeline equivalence", () => {
  fcTest.prop(
    [arbRareAccessoryBlock],
    cfg("direct = two-step: generateRareAccessoryRules ≡ groups → rules"),
  )("direct = two-step: generateRareAccessoryRules ≡ groups → rules", (block) => {
    const directRules = generateRareAccessoryRules(block);

    const groups = rareAccessoriesToGroups(block);
    const twoStepRules = generateRulesFromGroups(groups);

    expect(twoStepRules).toEqual(directRules);
  });

  fcTest.prop(
    [arbRareAccessoryBlock],
    cfg("all rules pass zod + invariants"),
  )("all rules pass zod + invariants", (block) => {
    const rules = generateRareAccessoryRules(block);
    if (rules.length > 0) {
      expect(() => generateFilter(rules)).not.toThrow();
      assertRuleInvariants(rules);
    }
  });
});
