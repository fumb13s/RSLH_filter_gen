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
  HsfRuleSchema,
  generateFilter,
  serializeFilter,
  parseFilter,
  evaluateFilter,
  matchesRule,
  defaultRule,
} from "../index.js";
import type { HsfFilter, HsfRule, Item } from "../index.js";
import { loadRegressions } from "./helpers/fc-reporter.js";
import type { RegressionStore } from "./helpers/fc-reporter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Assertion registry — maps test name → replay function
// ---------------------------------------------------------------------------

type AssertFn = (counterexample: unknown) => void;

const GENERATOR_ASSERTIONS: Record<string, AssertFn> = {
  "every random HsfRule passes zod validation": (ce) => {
    const [rule] = ce as [HsfRule];
    expect(() => HsfRuleSchema.parse(rule)).not.toThrow();
  },
  "every rule has exactly 4 substats": (ce) => {
    const [rule] = ce as [HsfRule];
    expect(rule.Substats).toHaveLength(4);
  },
  "parseFilter(serializeFilter(generateFilter(rules))) preserves rules": (ce) => {
    const [rules] = ce as [HsfRule[]];
    const filter = generateFilter(rules);
    const json = serializeFilter(filter);
    const parsed = parseFilter(json);
    expect(parsed.Rules.length).toBe(filter.Rules.length);
  },
  "serialization is deterministic": (ce) => {
    const [rules] = ce as [HsfRule[]];
    const filter = generateFilter(rules);
    expect(serializeFilter(filter)).toBe(serializeFilter(filter));
  },
};

const EVALUATE_ASSERTIONS: Record<string, AssertFn> = {
  "empty filter always returns keep": (ce) => {
    const [item] = ce as [Item];
    expect(evaluateFilter({ Rules: [] }, item)).toBe("keep");
  },
  "all-inactive rules → keep": (ce) => {
    const [rules, item] = ce as [HsfRule[], Item];
    const inactive = rules.map((r) => ({ ...r, Use: false }));
    expect(evaluateFilter({ Rules: inactive }, item)).toBe("keep");
  },
  "result is always 'keep' or 'sell'": (ce) => {
    const [filter, item] = ce as [HsfFilter, Item];
    expect(["keep", "sell"]).toContain(evaluateFilter(filter, item));
  },
  "evaluation is deterministic": (ce) => {
    const [filter, item] = ce as [HsfFilter, Item];
    expect(evaluateFilter(filter, item)).toBe(evaluateFilter(filter, item));
  },
  "wildcard keep rule matches any item": (ce) => {
    const [item] = ce as [Item];
    const rule = defaultRule({ Keep: true, Use: true, Rank: 0, Rarity: 0, MainStatID: -1, Faction: 0 });
    delete (rule as Record<string, unknown>).ArtifactSet;
    delete (rule as Record<string, unknown>).ArtifactType;
    expect(matchesRule(rule, item)).toBe(true);
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
  "generator",
  path.join(__dirname, "regressions", "generator.json"),
  GENERATOR_ASSERTIONS,
);

runRegressions(
  "evaluate",
  path.join(__dirname, "regressions", "evaluate.json"),
  EVALUATE_ASSERTIONS,
);
