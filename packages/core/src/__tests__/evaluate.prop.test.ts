/**
 * Property-based tests for the evaluation engine (matchesRule, evaluateFilter).
 */
import { describe, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import fc from "fast-check";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateFilter, matchesRule, defaultRule, MAX_SUBSTATS } from "../index.js";
import type { HsfFilter } from "../index.js";
import { arbHsfRule, arbItem, arbHsfFilter } from "./helpers/arbitraries.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "evaluate.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

describe("evaluate.prop — evaluateFilter", () => {
  fcTest.prop(
    [arbItem],
    cfg("empty filter always returns keep"),
  )("empty filter always returns keep", (item) => {
    const filter: HsfFilter = { Rules: [] };
    expect(evaluateFilter(filter, item)).toBe("keep");
  });

  fcTest.prop(
    [fc.array(arbHsfRule, { minLength: 1, maxLength: 5 }), arbItem],
    cfg("all-inactive rules → keep"),
  )("all-inactive rules → keep", (rules, item) => {
    const inactiveRules = rules.map((r) => ({ ...r, Use: false }));
    const filter: HsfFilter = { Rules: inactiveRules };
    expect(evaluateFilter(filter, item)).toBe("keep");
  });

  fcTest.prop(
    [arbHsfFilter, arbItem],
    cfg("result is always 'keep' or 'sell'"),
  )("result is always 'keep' or 'sell'", (filter, item) => {
    const result = evaluateFilter(filter, item);
    expect(["keep", "sell"]).toContain(result);
  });

  fcTest.prop(
    [arbHsfFilter, arbItem],
    cfg("evaluation is deterministic"),
  )("evaluation is deterministic", (filter, item) => {
    const r1 = evaluateFilter(filter, item);
    const r2 = evaluateFilter(filter, item);
    expect(r1).toBe(r2);
  });

  fcTest.prop(
    [arbItem],
    cfg("wildcard keep rule matches any item"),
  )("wildcard keep rule matches any item", (item) => {
    const wildcardRule = defaultRule({
      Keep: true,
      Use: true,
      Rank: 0,
      Rarity: 0,
      MainStatID: -1,
      Faction: 0,
    });
    delete (wildcardRule as Record<string, unknown>).ArtifactSet;
    delete (wildcardRule as Record<string, unknown>).ArtifactType;

    expect(matchesRule(wildcardRule, item)).toBe(true);

    const filter: HsfFilter = { Rules: [wildcardRule] };
    expect(evaluateFilter(filter, item)).toBe("keep");
  });

  fcTest.prop(
    [arbItem],
    cfg("generated items have valid substats"),
  )("generated items have valid substats", (item) => {
    // Substat count is within bounds
    expect(item.substats.length).toBeLessThanOrEqual(MAX_SUBSTATS);

    // No duplicate stat IDs
    const statIds = item.substats.map((s) => s.statId);
    expect(new Set(statIds).size).toBe(statIds.length);

    // No substat shares mainStat ID
    for (const s of item.substats) {
      expect(s.statId).not.toBe(item.mainStat);
    }

    // Each substat has valid rolls and value
    for (const s of item.substats) {
      expect(s.rolls).toBeGreaterThanOrEqual(1);
      expect(s.value).toBeGreaterThanOrEqual(1);
    }

    // Each substat has a boolean isFlat
    for (const s of item.substats) {
      expect(typeof s.isFlat).toBe("boolean");
    }
  });
});
