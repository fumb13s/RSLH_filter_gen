import { describe, it, expect } from "vitest";
import { generateFilter } from "@rslh/core";
import {
  generateOreRerollRules,
  generateRulesFromGroups,
  generateRareAccessoryRules,
} from "../generate-rules.js";
import { defaultQuickState, quickStateToGroups } from "../quick-generator.js";
import type { OreRerollBlock } from "../quick-generator.js";

describe("generateOreRerollRules", () => {
  it("generates valid rules for a single set in column 0 (3 extra rolls)", () => {
    const block: OreRerollBlock = {
      assignments: { 1: 0 }, // set ID 1 → column 0
    };

    const rules = generateOreRerollRules(block);
    expect(rules.length).toBeGreaterThan(0);

    // Every rule must pass zod validation inside generateFilter
    expect(() => generateFilter(rules)).not.toThrow();

    // Every ArtifactSet entry must be a finite number
    for (const rule of rules) {
      if (rule.ArtifactSet) {
        for (const id of rule.ArtifactSet) {
          expect(Number.isFinite(id)).toBe(true);
        }
      }
    }
  });

  it("generates valid rules for a single set in column 2 (5 extra rolls)", () => {
    const block: OreRerollBlock = {
      assignments: { 42: 2 }, // set ID 42 → column 2
    };

    const rules = generateOreRerollRules(block);
    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
  });

  it("generates flat substat rules with correct IsFlat flag", () => {
    const block: OreRerollBlock = {
      assignments: { 1: 0 },
    };

    const rules = generateOreRerollRules(block);
    const flatRules = rules.filter((r) =>
      r.Substats.some((s) => s.ID > 0 && s.IsFlat),
    );
    expect(flatRules.length).toBeGreaterThan(0);

    // Flat HP/ATK/DEF only (IDs 1, 2, 3)
    for (const rule of flatRules) {
      const active = rule.Substats.filter((s) => s.ID > 0 && s.IsFlat);
      for (const s of active) {
        expect([1, 2, 3]).toContain(s.ID);
      }
    }
  });
});

describe("full quick-gen flow with ore reroll", () => {
  it("generates and validates when default state has a profile selected + ore set assigned", () => {
    const state = defaultQuickState();
    // Select the first profile (HP Nuker)
    state.blocks[0].selectedProfiles = [0];
    // Add set 1 to ore column 0
    state.oreReroll!.assignments[1] = 0;

    const groups = quickStateToGroups(state);
    const rareRules = generateRareAccessoryRules(state.rareAccessories);
    const oreRules = generateOreRerollRules(state.oreReroll);
    const groupRules = generateRulesFromGroups(groups);
    const rules = [...rareRules, ...oreRules, ...groupRules];

    expect(rules.length).toBeGreaterThan(0);

    // This is the exact call that throws in the browser
    expect(() => generateFilter(rules)).not.toThrow();
  });

  it("generates and validates when only ore reroll is configured (no profiles)", () => {
    const state = defaultQuickState();
    // No profiles selected
    // Add set 1 to ore column 2 (5 extra rolls)
    state.oreReroll!.assignments[1] = 2;

    const groups = quickStateToGroups(state);
    const rareRules = generateRareAccessoryRules(state.rareAccessories);
    const oreRules = generateOreRerollRules(state.oreReroll);
    const groupRules = generateRulesFromGroups(groups);
    const rules = [...rareRules, ...oreRules, ...groupRules];

    expect(rules.length).toBeGreaterThan(0);
    expect(() => generateFilter(rules)).not.toThrow();
  });
});
