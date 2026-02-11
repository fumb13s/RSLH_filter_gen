/**
 * Property-based tests for core schema validation, round-trip, and
 * determinism of the .hsf filter pipeline.
 */
import { describe, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import fc from "fast-check";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HsfRuleSchema,
  generateFilter,
  serializeFilter,
  parseFilter,
} from "../index.js";
import { arbHsfRule } from "./helpers/arbitraries.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "generator.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

describe("generator.prop — schema validity", () => {
  fcTest.prop(
    [arbHsfRule],
    cfg("every random HsfRule passes zod validation"),
  )("every random HsfRule passes zod validation", (rule) => {
    expect(() => HsfRuleSchema.parse(rule)).not.toThrow();
  });

  fcTest.prop(
    [arbHsfRule],
    cfg("every rule has exactly 4 substats"),
  )("every rule has exactly 4 substats", (rule) => {
    expect(rule.Substats).toHaveLength(4);
  });
});

describe("generator.prop — round-trip", () => {
  fcTest.prop(
    [fc.array(arbHsfRule, { minLength: 1, maxLength: 5 })],
    cfg("parseFilter(serializeFilter(generateFilter(rules))) preserves rules"),
  )("parseFilter(serializeFilter(generateFilter(rules))) preserves rules", (rules) => {
    const filter = generateFilter(rules);
    const json = serializeFilter(filter);
    const parsed = parseFilter(json);

    expect(parsed.Rules.length).toBe(filter.Rules.length);
    for (let i = 0; i < filter.Rules.length; i++) {
      expect(parsed.Rules[i].Rank).toBe(filter.Rules[i].Rank);
      expect(parsed.Rules[i].Rarity).toBe(filter.Rules[i].Rarity);
      expect(parsed.Rules[i].MainStatID).toBe(filter.Rules[i].MainStatID);
      expect(parsed.Rules[i].Keep).toBe(filter.Rules[i].Keep);
      expect(parsed.Rules[i].Use).toBe(filter.Rules[i].Use);
      expect(parsed.Rules[i].Substats).toEqual(filter.Rules[i].Substats);
    }
  });

  fcTest.prop(
    [fc.array(arbHsfRule, { minLength: 1, maxLength: 5 })],
    cfg("serialization is deterministic"),
  )("serialization is deterministic", (rules) => {
    const filter = generateFilter(rules);
    const json1 = serializeFilter(filter);
    const json2 = serializeFilter(filter);

    expect(json1).toBe(json2);
  });
});
