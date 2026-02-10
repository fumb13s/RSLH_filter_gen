import { describe, it, expect } from "vitest";
import { generateFilter } from "@rslh/core";
import { generateOreRerollRules } from "../generate-rules.js";
import { oreRerollToGroups } from "../quick-generator.js";
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

describe("oreRerollToGroups", () => {
  it("undefined block → empty groups", () => {
    expect(oreRerollToGroups(undefined)).toEqual([]);
  });

  it("empty assignments → empty groups", () => {
    const block: OreRerollBlock = { assignments: {} };
    expect(oreRerollToGroups(block)).toEqual([]);
  });

  it("single set in column 0 → groups with correct rolls and ranks", () => {
    const block: OreRerollBlock = { assignments: { 1: 0 } };
    const groups = oreRerollToGroups(block);

    expect(groups.length).toBeGreaterThan(0);

    // Column 0 = 3 extra rolls
    // Rank 6: totalTarget = 3+1 = 4, Rank 5: totalTarget = 3+2 = 5
    const rank6Groups = groups.filter((g) => g.rank === 6);
    const rank5Groups = groups.filter((g) => g.rank === 5);
    expect(rank6Groups.length).toBeGreaterThan(0);
    expect(rank5Groups.length).toBeGreaterThan(0);

    // Rank 6 groups should have rolls=4
    for (const g of rank6Groups) {
      expect(g.rolls).toBe(4);
    }

    // Rank 5 groups should have rolls=5
    for (const g of rank5Groups) {
      expect(g.rolls).toBe(5);
    }
  });


  it("Leg/Myth groups have rarity=15 and walkbackDelay=0 (default)", () => {
    const block: OreRerollBlock = { assignments: { 1: 0 } };
    const groups = oreRerollToGroups(block);

    const legMythGroups = groups.filter((g) => g.rarity === 15);
    expect(legMythGroups.length).toBeGreaterThan(0);

    for (const g of legMythGroups) {
      expect(g.walkbackDelay).toBeUndefined();
    }
  });

  it("Epic groups have rarity=9 and walkbackDelay=1", () => {
    const block: OreRerollBlock = { assignments: { 1: 0 } };
    const groups = oreRerollToGroups(block);

    // Column 0, rank 6: totalTarget=4 ≤ 4 → Epic groups exist
    const epicGroups = groups.filter((g) => g.rarity === 9);
    expect(epicGroups.length).toBeGreaterThan(0);

    for (const g of epicGroups) {
      expect(g.walkbackDelay).toBe(1);
    }
  });

  it("each group has exactly one goodStat", () => {
    const block: OreRerollBlock = { assignments: { 1: 0 } };
    const groups = oreRerollToGroups(block);

    for (const g of groups) {
      expect(g.goodStats).toHaveLength(1);
    }
  });

  it("column 2 rank 5 is skipped (totalTarget=8 > 6)", () => {
    const block: OreRerollBlock = { assignments: { 1: 2 } };
    const groups = oreRerollToGroups(block);

    // Column 2 = 5 extra rolls
    // Rank 5: totalTarget = 5+2 = 7 > 6 → skipped
    const rank5Groups = groups.filter((g) => g.rank === 5);
    expect(rank5Groups).toHaveLength(0);
  });

  it("column 2 rank 6 has no Epic groups (totalTarget=6 > 4)", () => {
    const block: OreRerollBlock = { assignments: { 1: 2 } };
    const groups = oreRerollToGroups(block);

    const epicGroups = groups.filter((g) => g.rarity === 9);
    expect(epicGroups).toHaveLength(0);
  });

  it("sets are grouped by column correctly", () => {
    const block: OreRerollBlock = { assignments: { 1: 0, 2: 0, 3: 1 } };
    const groups = oreRerollToGroups(block);

    // Sets 1,2 in column 0 should appear together; set 3 in column 1 alone
    const col0Groups = groups.filter((g) => g.rolls === 4 && g.rank === 6 && g.rarity === 15);
    const col1Groups = groups.filter((g) => g.rolls === 5 && g.rank === 6 && g.rarity === 15);

    // Column 0 groups should have sets [1, 2]
    for (const g of col0Groups) {
      expect(g.sets.sort()).toEqual([1, 2]);
    }

    // Column 1 groups should have sets [3]
    for (const g of col1Groups) {
      expect(g.sets).toEqual([3]);
    }
  });
});
