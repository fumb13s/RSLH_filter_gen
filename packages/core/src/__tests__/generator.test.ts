import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateFilter,
  serializeFilter,
  parseFilter,
} from "../generator.js";
import {
  HsfRuleSchema,
  HsfSubstatSchema,
  defaultRule,
  emptySubstat,
} from "../types.js";
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  STAT_NAMES,
  lookupName,
  describeRarity,
} from "../mappings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HSF_PATH = resolve(__dirname, "../../../../data/panda_ultraendgame_farming_v1.hsf");

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe("HsfSubstatSchema", () => {
  it("validates a valid substat", () => {
    const result = HsfSubstatSchema.safeParse({
      ID: 4,
      Value: 1,
      IsFlat: true,
      NotAvailable: false,
      Condition: ">=",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing Condition field", () => {
    const result = HsfSubstatSchema.safeParse({
      ID: 4,
      Value: 1,
      IsFlat: true,
      NotAvailable: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("HsfRuleSchema", () => {
  it("validates a rule with ArtifactSet", () => {
    const rule = defaultRule({ ArtifactSet: [62, 65] });
    const result = HsfRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it("validates a rule without ArtifactSet", () => {
    const rule = defaultRule();
    // defaultRule doesn't include ArtifactSet by default
    const result = HsfRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("ArtifactSet");
  });

  it("rejects a rule with wrong Substats count", () => {
    const rule = {
      ...defaultRule(),
      Substats: [emptySubstat(), emptySubstat()],
    };
    const result = HsfRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });

  it("rejects a rule with bad Condition value type", () => {
    const rule = {
      ...defaultRule(),
      Substats: [
        { ...emptySubstat(), Condition: 123 },
        emptySubstat(),
        emptySubstat(),
        emptySubstat(),
      ],
    };
    const result = HsfRuleSchema.safeParse(rule);
    expect(result.success).toBe(false);
  });

  it("preserves unknown fields via passthrough", () => {
    const rule = { ...defaultRule(), SomeNewField: "hello" };
    const result = HsfRuleSchema.parse(rule);
    expect((result as Record<string, unknown>).SomeNewField).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Generator functions
// ---------------------------------------------------------------------------

describe("generateFilter", () => {
  it("wraps valid rules in an HsfFilter", () => {
    const rules = [defaultRule()];
    const filter = generateFilter(rules);
    expect(filter.Rules).toHaveLength(1);
    expect(filter.Rules[0].Keep).toBe(true);
  });

  it("accepts an empty rules array", () => {
    const filter = generateFilter([]);
    expect(filter.Rules).toEqual([]);
  });

  it("throws on invalid rules", () => {
    expect(() =>
      generateFilter([{ bad: true } as never])
    ).toThrow();
  });
});

describe("serializeFilter", () => {
  it("produces compact JSON without whitespace", () => {
    const filter = generateFilter([defaultRule()]);
    const json = serializeFilter(filter);
    expect(json).not.toContain("\n");
    expect(json).not.toContain("  ");
    expect(json.startsWith('{"Rules":[{')).toBe(true);
  });
});

describe("parseFilter", () => {
  it("parses valid compact JSON", () => {
    const filter = generateFilter([defaultRule()]);
    const json = serializeFilter(filter);
    const parsed = parseFilter(json);
    expect(parsed.Rules).toHaveLength(1);
  });

  it("handles UTF-8 BOM", () => {
    const filter = generateFilter([defaultRule()]);
    const json = "\uFEFF" + serializeFilter(filter);
    const parsed = parseFilter(json);
    expect(parsed.Rules).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseFilter("not json")).toThrow();
  });

  it("throws on valid JSON but bad schema", () => {
    expect(() => parseFilter('{"Rules": [{"bad": true}]}')).toThrow();
  });
});

describe("round-trip", () => {
  it("serialize then parse preserves data", () => {
    const original = generateFilter([
      defaultRule({ ArtifactSet: [1, 2], Rarity: 9 }),
      defaultRule(),
    ]);
    const json = serializeFilter(original);
    const parsed = parseFilter(json);
    expect(parsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Real .hsf file tests
// ---------------------------------------------------------------------------

describe("real .hsf file", () => {
  const raw = readFileSync(HSF_PATH, "utf-8");

  it("parses successfully with 135 rules", () => {
    const filter = parseFilter(raw);
    expect(filter.Rules).toHaveLength(135);
  });

  it("spot-checks first rule fields", () => {
    const filter = parseFilter(raw);
    const r = filter.Rules[0];
    expect(r.Keep).toBe(true);
    expect(r.IsRuleTypeAND).toBe(false);
    expect(r.Use).toBe(true);
    expect(r.ArtifactSet).toEqual([62, 65]);
    expect(r.ArtifactType).toEqual([5, 1, 6, 3, 2]);
    expect(r.Rank).toBe(6);
    expect(r.Rarity).toBe(16);
    expect(r.MainStatID).toBe(-1);
    expect(r.Substats).toHaveLength(4);
  });

  it("handles rules without ArtifactSet", () => {
    const filter = parseFilter(raw);
    const withoutSet = filter.Rules.filter((r) => r.ArtifactSet === undefined);
    expect(withoutSet.length).toBe(20);
  });

  it("round-trips byte-for-byte (after stripping BOM)", () => {
    const filter = parseFilter(raw);
    const serialized = serializeFilter(filter);
    // Strip BOM from original for comparison
    const originalNoBom =
      raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    expect(serialized).toBe(originalNoBom);
  });
});

// ---------------------------------------------------------------------------
// Mapping tests
// ---------------------------------------------------------------------------

describe("lookupName", () => {
  it("returns known set name", () => {
    expect(lookupName(ARTIFACT_SET_NAMES, 62)).toBe("Pinpoint");
  });

  it("returns known slot name", () => {
    expect(lookupName(ARTIFACT_SLOT_NAMES, 5)).toBe("Weapon");
  });

  it("returns known stat name", () => {
    expect(lookupName(STAT_NAMES, 4)).toBe("SPD");
  });

  it("returns Unknown(N) for unmapped IDs", () => {
    expect(lookupName(ARTIFACT_SET_NAMES, 9999)).toBe("Unknown(9999)");
  });
});

describe("describeRarity", () => {
  it("describes known rarity thresholds", () => {
    expect(describeRarity(8)).toBe(">= Rare");
    expect(describeRarity(9)).toBe(">= Epic");
    expect(describeRarity(16)).toBe(">= Legendary");
    expect(describeRarity(15)).toBe(">= Mythical");
  });

  it("returns Any for 0", () => {
    expect(describeRarity(0)).toBe("Any");
  });

  it("returns Unknown for unmapped IDs", () => {
    expect(describeRarity(99)).toBe("Unknown(99)");
  });
});
