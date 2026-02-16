/**
 * fast-check arbitraries for core types: HsfRule, Item, HsfFilter.
 */
import fc from "fast-check";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, STAT_NAMES, FACTION_NAMES, HSF_RARITY_IDS } from "../../index.js";
import type { HsfRule, HsfFilter, HsfSubstat, Item } from "../../index.js";

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

const SET_IDS = Object.keys(ARTIFACT_SET_NAMES).map(Number);
const SLOT_IDS = Object.keys(ARTIFACT_SLOT_NAMES).map(Number);
const STAT_IDS = Object.keys(STAT_NAMES).map(Number);
const FACTION_IDS = Object.keys(FACTION_NAMES).map(Number);
const RARITY_HSF_IDS = [0, ...Object.keys(HSF_RARITY_IDS).map(Number)]; // 0, 8, 9, 15, 16

// ---------------------------------------------------------------------------
// Substat arbitrary
// ---------------------------------------------------------------------------

const arbEmptySubstat: fc.Arbitrary<HsfSubstat> = fc.constant({
  ID: -1,
  Value: 0,
  IsFlat: true,
  NotAvailable: false,
  Condition: "",
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

// ---------------------------------------------------------------------------
// HsfRule arbitrary
// ---------------------------------------------------------------------------

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
  // Clean up: convert tuple to array, handle undefined ArtifactSet/ArtifactType
  const rule: HsfRule = {
    ...r,
    Substats: [...r.Substats],
  };
  if (rule.ArtifactSet === undefined) delete (rule as Record<string, unknown>).ArtifactSet;
  if (rule.ArtifactType === undefined) delete (rule as Record<string, unknown>).ArtifactType;
  return rule;
});

// ---------------------------------------------------------------------------
// Item arbitrary
// ---------------------------------------------------------------------------

export const arbItem: fc.Arbitrary<Item> = fc.record({
  set: fc.constantFrom(...SET_IDS),
  slot: fc.constantFrom(...SLOT_IDS),
  rank: fc.constantFrom(5, 6),
  rarity: fc.constantFrom(0, 1, 2, 3, 4, 5), // index into ITEM_RARITIES
  mainStat: fc.constantFrom(...STAT_IDS),
  substats: fc.constant([]),
  level: fc.constantFrom(0, 4, 8, 12, 16),
  faction: fc.oneof(
    fc.constant(undefined),
    fc.constantFrom(...FACTION_IDS),
  ),
});

// ---------------------------------------------------------------------------
// HsfFilter arbitrary
// ---------------------------------------------------------------------------

export const arbHsfFilter: fc.Arbitrary<HsfFilter> = fc
  .array(arbHsfRule, { minLength: 0, maxLength: 10 })
  .map((rules) => ({ Rules: rules }));
