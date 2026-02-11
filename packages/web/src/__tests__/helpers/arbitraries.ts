/**
 * fast-check arbitraries for web-layer types: SettingGroup, QuickBlock,
 * QuickGenState, RareAccessoryBlock, OreRerollBlock.
 */
import fc from "fast-check";
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  STAT_NAMES,
  ACCESSORY_SET_IDS,
  FACTION_NAMES,
  HSF_RARITY_IDS,
} from "@rslh/core";
import type { Item, HsfRule, HsfSubstat, HsfFilter } from "@rslh/core";
import { SUBSTAT_PRESETS } from "../../generator.js";
import type { SettingGroup } from "../../generator.js";
import type {
  QuickBlock,
  QuickGenState,
  RareAccessoryBlock,
  OreRerollBlock,
} from "../../quick-generator.js";

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

const SET_IDS = Object.keys(ARTIFACT_SET_NAMES).map(Number);
const SLOT_IDS = Object.keys(ARTIFACT_SLOT_NAMES).map(Number);
const STAT_IDS = Object.keys(STAT_NAMES).map(Number);
const FACTION_IDS = Object.keys(FACTION_NAMES).map(Number);
const RARITY_HSF_IDS = [0, ...Object.keys(HSF_RARITY_IDS).map(Number)];

// Stat variants: [statId, isFlat]
const ALL_STAT_VARIANTS: [number, boolean][] = [
  [1, true], [1, false],
  [2, true], [2, false],
  [3, true], [3, false],
  [4, true],
  [5, false],
  [6, false],
  [7, true],
  [8, true],
];

// ---------------------------------------------------------------------------
// SettingGroup arbitrary
// ---------------------------------------------------------------------------

export const arbSettingGroup: fc.Arbitrary<SettingGroup> = fc.record({
  sets: fc.uniqueArray(fc.constantFrom(...SET_IDS), { minLength: 0, maxLength: 6 }),
  slots: fc.uniqueArray(fc.constantFrom(...SLOT_IDS), { minLength: 0, maxLength: 4 }),
  mainStats: fc.uniqueArray(
    fc.constantFrom(...ALL_STAT_VARIANTS),
    { minLength: 0, maxLength: 3, comparator: (a, b) => a[0] === b[0] && a[1] === b[1] },
  ) as fc.Arbitrary<[number, boolean][]>,
  goodStats: fc.uniqueArray(
    fc.constantFrom(...ALL_STAT_VARIANTS),
    { minLength: 0, maxLength: 4, comparator: (a, b) => a[0] === b[0] && a[1] === b[1] },
  ) as fc.Arbitrary<[number, boolean][]>,
  rolls: fc.integer({ min: 1, max: 9 }),
  rank: fc.constantFrom(5, 6),
  rarity: fc.constantFrom(0, 9, 15, 16),
  faction: fc.constantFrom(0, ...FACTION_IDS),
});

// ---------------------------------------------------------------------------
// QuickBlock arbitrary
// ---------------------------------------------------------------------------

interface SetTier {
  name: string;
  rolls: number;
  color: string;
}

const arbSetTier: fc.Arbitrary<SetTier> = fc.record({
  name: fc.constantFrom("Must-Keep", "Good", "Situational", "Off-Set"),
  rolls: fc.integer({ min: 4, max: 9 }),
  color: fc.constant("#22c55e"),
});

export const arbQuickBlock: fc.Arbitrary<QuickBlock> = fc.record({
  tiers: fc.array(arbSetTier, { minLength: 1, maxLength: 4 }),
  assignments: fc.dictionary(
    fc.constantFrom(...SET_IDS.map(String)),
    fc.nat({ max: 3 }),
  ).map((d) => {
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(d)) result[Number(k)] = v;
    return result;
  }),
  selectedProfiles: fc.uniqueArray(
    fc.nat({ max: SUBSTAT_PRESETS.length - 1 }),
    { minLength: 0, maxLength: SUBSTAT_PRESETS.length },
  ),
}).map((b) => {
  // Clamp assignments to valid tier indices
  const maxTier = b.tiers.length - 1;
  for (const key of Object.keys(b.assignments)) {
    b.assignments[Number(key)] = Math.min(b.assignments[Number(key)], maxTier);
  }
  return b;
});

// ---------------------------------------------------------------------------
// RareAccessoryBlock arbitrary
// ---------------------------------------------------------------------------

export const arbRareAccessoryBlock: fc.Arbitrary<RareAccessoryBlock> = fc
  .dictionary(
    fc.constantFrom(...ACCESSORY_SET_IDS.map(String)),
    fc.uniqueArray(fc.constantFrom(...FACTION_IDS), { minLength: 1, maxLength: 4 }),
  )
  .map((d) => {
    const selections: Record<number, number[]> = {};
    for (const [k, v] of Object.entries(d)) selections[Number(k)] = v;
    return { selections };
  });

// ---------------------------------------------------------------------------
// OreRerollBlock arbitrary
// ---------------------------------------------------------------------------

export const arbOreRerollBlock: fc.Arbitrary<OreRerollBlock> = fc
  .dictionary(
    fc.constantFrom(...SET_IDS.map(String)),
    fc.constantFrom(0, 1, 2),
  )
  .map((d) => {
    const assignments: Record<number, number> = {};
    for (const [k, v] of Object.entries(d)) assignments[Number(k)] = v;
    return { assignments };
  });

// ---------------------------------------------------------------------------
// QuickGenState arbitrary
// ---------------------------------------------------------------------------

export const arbQuickGenState: fc.Arbitrary<QuickGenState> = fc.record({
  blocks: fc.array(arbQuickBlock, { minLength: 1, maxLength: 2 }),
  rareAccessories: fc.option(arbRareAccessoryBlock, { nil: undefined }),
  oreReroll: fc.option(arbOreRerollBlock, { nil: undefined }),
});

// Light variant: single block, at most 1 profile, fewer sets — keeps
// generateRulesFromGroups fast (avoids combinatorial partition explosion).
const arbQuickBlockLight: fc.Arbitrary<QuickBlock> = fc.record({
  tiers: fc.array(arbSetTier, { minLength: 1, maxLength: 2 }),
  assignments: fc.dictionary(
    fc.constantFrom(...SET_IDS.slice(0, 5).map(String)),
    fc.nat({ max: 1 }),
  ).map((d) => {
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(d)) result[Number(k)] = v;
    return result;
  }),
  selectedProfiles: fc.uniqueArray(
    fc.nat({ max: SUBSTAT_PRESETS.length - 1 }),
    { minLength: 0, maxLength: 1 },
  ),
}).map((b) => {
  const maxTier = b.tiers.length - 1;
  for (const key of Object.keys(b.assignments)) {
    b.assignments[Number(key)] = Math.min(b.assignments[Number(key)], maxTier);
  }
  return b;
});

export const arbQuickGenStateLight: fc.Arbitrary<QuickGenState> = fc.record({
  blocks: fc.array(arbQuickBlockLight, { minLength: 1, maxLength: 1 }),
  rareAccessories: fc.option(arbRareAccessoryBlock, { nil: undefined }),
  oreReroll: fc.option(arbOreRerollBlock, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Item arbitrary
// ---------------------------------------------------------------------------

export const arbItem: fc.Arbitrary<Item> = fc.record({
  set: fc.constantFrom(...SET_IDS),
  slot: fc.constantFrom(...SLOT_IDS),
  rank: fc.constantFrom(1, 2, 3, 4, 5, 6),
  rarity: fc.constantFrom(0, 1, 2, 3, 4, 5),
  mainStat: fc.constantFrom(...STAT_IDS),
  substats: fc.constant([]),
  level: fc.constantFrom(0, 4, 8, 12, 16),
  faction: fc.oneof(
    fc.constant(undefined),
    fc.constantFrom(...FACTION_IDS),
  ),
});

// ---------------------------------------------------------------------------
// HsfRule / HsfFilter arbitraries
// ---------------------------------------------------------------------------

const arbEmptySubstat: fc.Arbitrary<HsfSubstat> = fc.constant({
  ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "",
});

const arbActiveSubstat: fc.Arbitrary<HsfSubstat> = fc.record({
  ID: fc.constantFrom(...STAT_IDS),
  Value: fc.integer({ min: 1, max: 100 }),
  IsFlat: fc.boolean(),
  NotAvailable: fc.constant(false),
  Condition: fc.constant(">="),
});

const arbSubstat: fc.Arbitrary<HsfSubstat> = fc.oneof(
  { weight: 1, arbitrary: arbEmptySubstat },
  { weight: 2, arbitrary: arbActiveSubstat },
);

export const arbHsfRule: fc.Arbitrary<HsfRule> = fc.record({
  Keep: fc.boolean(),
  IsRuleTypeAND: fc.constant(false),
  Use: fc.boolean(),
  ArtifactSet: fc.oneof(
    fc.constant(undefined),
    fc.uniqueArray(fc.constantFrom(...SET_IDS), { minLength: 0, maxLength: 8 }),
  ),
  ArtifactType: fc.oneof(
    fc.constant(undefined),
    fc.uniqueArray(fc.constantFrom(...SLOT_IDS), { minLength: 0, maxLength: 6 }),
  ),
  Rank: fc.constantFrom(0, 1, 2, 3, 4, 5, 6),
  Rarity: fc.constantFrom(...RARITY_HSF_IDS),
  MainStatID: fc.constantFrom(-1, ...STAT_IDS),
  MainStatF: fc.constantFrom(0, 1),
  LVLForCheck: fc.constantFrom(0, 4, 8, 12, 16),
  Faction: fc.constantFrom(0, ...FACTION_IDS),
  Substats: fc.tuple(arbSubstat, arbSubstat, arbSubstat, arbSubstat),
}).map((r) => {
  const rule: HsfRule = { ...r, Substats: [...r.Substats] };
  if (rule.ArtifactSet === undefined) delete (rule as Record<string, unknown>).ArtifactSet;
  if (rule.ArtifactType === undefined) delete (rule as Record<string, unknown>).ArtifactType;
  return rule;
});

export const arbHsfFilter: fc.Arbitrary<HsfFilter> = fc
  .array(arbHsfRule, { minLength: 0, maxLength: 10 })
  .map((rules) => ({ Rules: rules }));
