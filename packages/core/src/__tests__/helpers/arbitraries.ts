/**
 * fast-check arbitraries for core types: HsfRule, Item, HsfFilter.
 */
import fc from "fast-check";
import {
  ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, STAT_NAMES,
  FACTION_NAMES, HSF_RARITY_IDS,
  MAX_SUBSTATS, STARTING_SUBSTATS, UPGRADE_LEVELS, getRollRange,
} from "../../index.js";
import type { HsfRule, HsfFilter, HsfSubstat, Item, ItemSubstat } from "../../index.js";

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
// Item substat generation
// ---------------------------------------------------------------------------

// Substat variants: [statId, isFlat]
const SUBSTAT_VARIANTS: readonly [number, boolean][] = [
  [1, true], [1, false],
  [2, true], [2, false],
  [3, true], [3, false],
  [4, false],           // SPD
  [5, false], [6, false],
  [7, false], [8, false], // RES, ACC
];

/**
 * Generate game-accurate substats for an item.
 *
 * Algorithm:
 * 1. Compute how many substat slots are filled and how many extra rolls exist.
 * 2. Pick that many unique stat variants (excluding mainStat, excluding zero-range).
 * 3. Distribute extra rolls across the filled slots.
 * 4. For each substat, generate a value = sum of `rolls` random values in [min, max].
 */
function arbItemSubstats(
  rank: number,
  rarity: number,
  level: number,
  mainStat: number,
): fc.Arbitrary<ItemSubstat[]> {
  // Number of upgrades the item has received
  const upgrades = UPGRADE_LEVELS.filter((l) => level >= l).length;

  // Starting substats: capped at MAX_SUBSTATS slots
  const startingRaw = STARTING_SUBSTATS[rarity] ?? 0;
  const startingSlots = Math.min(startingRaw, MAX_SUBSTATS);
  const extraStartingRolls = Math.max(startingRaw - MAX_SUBSTATS, 0); // Mythical: 1

  // Each upgrade either fills an empty slot or adds a roll
  let filledSlots = startingSlots;
  let extraRolls = extraStartingRolls;
  for (let i = 0; i < upgrades; i++) {
    if (filledSlots < MAX_SUBSTATS) {
      filledSlots++;
    } else {
      extraRolls++;
    }
  }

  if (filledSlots === 0) return fc.constant([]);

  // Filter to stat variants valid for this item
  const eligible = SUBSTAT_VARIANTS.filter(([statId, isFlat]) => {
    if (statId === mainStat) return false;
    const range = getRollRange(statId, rank, isFlat);
    if (!range || (range[0] === 0 && range[1] === 0)) return false;
    return true;
  });

  // Group eligible variants by statId
  const byStatId = new Map<number, [number, boolean][]>();
  for (const v of eligible) {
    const arr = byStatId.get(v[0]) ?? [];
    arr.push(v);
    byStatId.set(v[0], arr);
  }
  const uniqueStatIds = [...byStatId.keys()];

  // If not enough unique stat IDs, reduce slots
  const actualSlots = Math.min(filledSlots, uniqueStatIds.length);
  if (actualSlots === 0) return fc.constant([]);

  // Pick `actualSlots` unique stat IDs
  return fc.shuffledSubarray(uniqueStatIds, {
    minLength: actualSlots,
    maxLength: actualSlots,
  }).chain((chosenStatIds) => {
    // For each chosen stat ID, pick a random variant
    const variantArbs = chosenStatIds.map((statId) => {
      const variants = byStatId.get(statId)!;
      return variants.length === 1
        ? fc.constant(variants[0])
        : fc.constantFrom(...variants);
    });

    return fc.tuple(...variantArbs).chain((chosenVariants) => {
      // Distribute extraRolls randomly among slots
      const rollDistArb = extraRolls === 0
        ? fc.constant([] as number[])
        : fc.array(
            fc.nat({ max: actualSlots - 1 }),
            { minLength: extraRolls, maxLength: extraRolls },
          );

      return rollDistArb.chain((rollTargets) => {
        const rollCounts = new Array(actualSlots).fill(1) as number[];
        for (const idx of rollTargets) rollCounts[idx]++;

        // Generate value for each substat
        const substatArbs = (chosenVariants as [number, boolean][]).map(([statId, isFlat], i) => {
          const range = getRollRange(statId, rank, isFlat)!;
          const rolls = rollCounts[i];
          return fc.tuple(
            ...Array.from({ length: rolls }, () =>
              fc.integer({ min: range[0], max: range[1] }),
            ),
          ).map((values) => ({
            statId,
            isFlat,
            rolls,
            value: (values as number[]).reduce((a, b) => a + b, 0),
          }));
        });

        return fc.tuple(...substatArbs) as fc.Arbitrary<ItemSubstat[]>;
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Item arbitrary
// ---------------------------------------------------------------------------

export const arbItem: fc.Arbitrary<Item> = fc.record({
  set: fc.constantFrom(...SET_IDS),
  slot: fc.constantFrom(...SLOT_IDS),
  rank: fc.constantFrom(5, 6),
  rarity: fc.constantFrom(0, 1, 2, 3, 4, 5),
  mainStat: fc.constantFrom(...STAT_IDS),
  level: fc.constantFrom(0, 4, 8, 12, 16),
  faction: fc.oneof(
    fc.constant(undefined),
    fc.constantFrom(...FACTION_IDS),
  ),
}).chain((base) =>
  arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
    .map((substats) => ({ ...base, substats })),
);

// ---------------------------------------------------------------------------
// HsfFilter arbitrary
// ---------------------------------------------------------------------------

export const arbHsfFilter: fc.Arbitrary<HsfFilter> = fc
  .array(arbHsfRule, { minLength: 0, maxLength: 10 })
  .map((rules) => ({ Rules: rules }));
