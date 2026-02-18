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
  MAX_SUBSTATS, STARTING_SUBSTATS, UPGRADE_LEVELS, getRollRange,
} from "@rslh/core";
import type { Item, ItemSubstat, HsfRule, HsfSubstat, HsfFilter } from "@rslh/core";
import type { QuickGenState } from "../../quick-generator.js";
import { SUBSTAT_PRESETS } from "../../generator.js";
import type { SettingGroup } from "../../generator.js";
import type {
  QuickBlock,
  QuickGenState,
  RareAccessoryBlock,
  OreRerollBlock,
} from "../../quick-generator.js";
import { hsfRarityToIndex } from "./invariants.js";

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
  keep: fc.boolean(),
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
  strict: fc.boolean(),
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
  strict: fc.boolean(),
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
// Near-threshold item generation (substat-aware)
// ---------------------------------------------------------------------------

/**
 * Generate items that match a rule's structural criteria with substats
 * near the rule's thresholds (within one roll's max of the threshold).
 * Produces ~50/50 pass/fail per substat, exercising both evaluation paths.
 *
 * Substats are NOT game-accurate — values are constructed directly near
 * the threshold rather than via roll mechanics.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- wired in by arbItemsForState (Task 3)
function arbNearThresholdItem(rules: HsfRule[]): fc.Arbitrary<Item> {
  // Filter to rules that have active substat checks
  const rulesWithSubstats = rules.filter((r) =>
    r.Use && r.Substats.some((s) => s.ID > 0),
  );

  if (rulesWithSubstats.length === 0) return arbItem;

  return fc.constantFrom(...rulesWithSubstats).chain((rule) => {
    // --- Structural field arbitraries matching the rule ---

    const setArb = rule.ArtifactSet && rule.ArtifactSet.length > 0
      ? fc.constantFrom(...rule.ArtifactSet)
      : fc.constantFrom(...SET_IDS);

    const slotArb = rule.ArtifactType && rule.ArtifactType.length > 0
      ? fc.constantFrom(...rule.ArtifactType)
      : fc.constantFrom(...SLOT_IDS);

    const rankArb = rule.Rank <= 5
      ? fc.constantFrom(5, 6)
      : fc.constant(6 as const);

    const rarityThreshold = hsfRarityToIndex(rule.Rarity);
    const validRarities = ([0, 1, 2, 3, 4, 5] as const).filter(
      (r) => r >= rarityThreshold,
    );
    const rarityArb = validRarities.length > 0
      ? fc.constantFrom(...validRarities)
      : fc.constant(5 as const);

    const mainStatArb = rule.MainStatID !== -1
      ? fc.constant(rule.MainStatID)
      : fc.constantFrom(...STAT_IDS);

    const validLevels = ([0, 4, 8, 12, 16] as const).filter(
      (l) => l >= rule.LVLForCheck,
    );
    const levelArb = validLevels.length > 0
      ? fc.constantFrom(...validLevels)
      : fc.constant(16 as const);

    const factionArb = rule.Faction !== 0
      ? fc.constant(rule.Faction as number | undefined)
      : fc.oneof(
          fc.constant(undefined as number | undefined),
          fc.constantFrom(...FACTION_IDS) as fc.Arbitrary<number | undefined>,
        );

    return fc.record({
      set: setArb,
      slot: slotArb,
      rank: rankArb,
      rarity: rarityArb,
      mainStat: mainStatArb,
      level: levelArb,
      faction: factionArb,
    }).chain((base) => {
      // --- Generate substats near thresholds ---
      const activeSubstats = rule.Substats.filter((s) => s.ID > 0);

      const substatArbs = activeSubstats.map((rs) => {
        const range = getRollRange(rs.ID, base.rank, rs.IsFlat);
        const maxDelta = range ? range[1] : 5;
        return fc.integer({
          min: Math.max(1, rs.Value - maxDelta),
          max: rs.Value + maxDelta,
        }).map((value) => ({
          statId: rs.ID,
          isFlat: rs.IsFlat,
          rolls: 1,
          value,
        }));
      });

      return fc.tuple(...substatArbs).map((substats) => ({
        ...base,
        substats: substats as ItemSubstat[],
      }));
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

// ---------------------------------------------------------------------------
// Targeted item generators for multi-item pipeline tests
// ---------------------------------------------------------------------------

interface TargetParams {
  sets: number[];
  ranks: number[];
  rarities: number[];
  factions: (number | undefined)[];
  slots: number[];
}

/** Analyze a QuickGenState and extract matching criteria for targeted items. */
export function extractTargets(state: QuickGenState): TargetParams {
  const sets = new Set<number>();
  const ranks = new Set<number>();
  const rarities = new Set<number>();
  const factions = new Set<number | undefined>();
  const slots = new Set<number>();

  // --- Build profiles ---
  for (const block of state.blocks) {
    if (block.selectedProfiles.length === 0) continue;
    // Check at least one profile has effective stats
    const hasEffective = block.selectedProfiles.some((pi) => {
      const preset = SUBSTAT_PRESETS[pi];
      return preset && preset.stats.length > 0;
    });
    if (!hasEffective) continue;

    for (let ti = 0; ti < block.tiers.length; ti++) {
      const tier = block.tiers[ti];
      if (tier.rolls < 0) continue;

      for (const [setIdStr, tierIdx] of Object.entries(block.assignments)) {
        if (tierIdx !== ti) continue;
        sets.add(Number(setIdStr));
      }

      // Rank eligibility: 6 always, 5 if tier.rolls + 2 <= 9
      ranks.add(6);
      if (tier.rolls + 2 <= 9) ranks.add(5);

      // Rarity: default is 16 → index 4 (Legendary) and 5 (Mythical)
      rarities.add(4);
      rarities.add(5);
    }
  }

  // --- Rare accessories ---
  if (state.rareAccessories) {
    for (const [setIdStr, factionIds] of Object.entries(state.rareAccessories.selections)) {
      if (!factionIds || factionIds.length === 0) continue;
      sets.add(Number(setIdStr));
      slots.add(7);
      slots.add(8);
      slots.add(9);
      for (const fid of factionIds) factions.add(fid);
      // Rare accessories: any rarity
      for (let r = 0; r <= 5; r++) rarities.add(r);
    }
  }

  // --- Ore reroll ---
  if (state.oreReroll) {
    for (const [setIdStr, colIdx] of Object.entries(state.oreReroll.assignments)) {
      if (colIdx < 0 || colIdx > 2) continue;
      sets.add(Number(setIdStr));
    }
    // Ore reroll rarities: Epic (index 3) and Mythical (index 5)
    rarities.add(3);
    rarities.add(5);
    // Ore reroll ranks
    ranks.add(5);
    ranks.add(6);
  }

  return {
    sets: [...sets],
    ranks: [...ranks],
    rarities: [...rarities],
    factions: [...factions],
    slots: [...slots],
  };
}

function arbTargetedItem(targets: TargetParams): fc.Arbitrary<Item> {
  const ALL_RANKS = [5, 6] as const;
  const ALL_RARITIES = [0, 1, 2, 3, 4, 5] as const;
  return fc.record({
    set: fc.constantFrom(...targets.sets),
    slot: targets.slots.length > 0
      ? fc.oneof(fc.constantFrom(...targets.slots), fc.constantFrom(...SLOT_IDS))
      : fc.constantFrom(...SLOT_IDS),
    rank: targets.ranks.length > 0
      ? fc.constantFrom(...targets.ranks)
      : fc.constantFrom(...ALL_RANKS),
    rarity: targets.rarities.length > 0
      ? fc.constantFrom(...targets.rarities)
      : fc.constantFrom(...ALL_RARITIES),
    mainStat: fc.constantFrom(...STAT_IDS),
    level: fc.constantFrom(0, 4, 8, 12, 16),
    faction: targets.factions.length > 0
      ? fc.oneof(
          fc.constantFrom(...targets.factions as (number | undefined)[]),
          fc.constant(undefined),
          fc.constantFrom(...FACTION_IDS),
        )
      : fc.oneof(fc.constant(undefined), fc.constantFrom(...FACTION_IDS)),
  }).chain((base) =>
    arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
      .map((substats) => ({ ...base, substats })),
  );
}

function arbNearMissItem(targets: TargetParams): fc.Arbitrary<Item> {
  const strategies: fc.Arbitrary<Item>[] = [];

  if (targets.sets.length > 0) {
    // Right set but rank 5 only (misses rank-6-only filters)
    strategies.push(fc.record({
      set: fc.constantFrom(...targets.sets),
      slot: fc.constantFrom(...SLOT_IDS),
      rank: fc.constant(5) as fc.Arbitrary<5>,
      rarity: fc.constantFrom(0, 1, 2, 3, 4, 5),
      mainStat: fc.constantFrom(...STAT_IDS),
      level: fc.constantFrom(0, 4, 8, 12, 16),
      faction: fc.oneof(fc.constant(undefined), fc.constantFrom(...FACTION_IDS)),
    }).chain((base) =>
      arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
        .map((substats) => ({ ...base, substats })),
    ));

    // Right rank but wrong set
    const nonTargetSets = SET_IDS.filter((s) => !targets.sets.includes(s));
    if (nonTargetSets.length > 0 && targets.ranks.length > 0) {
      strategies.push(fc.record({
        set: fc.constantFrom(...nonTargetSets),
        slot: fc.constantFrom(...SLOT_IDS),
        rank: fc.constantFrom(...targets.ranks),
        rarity: targets.rarities.length > 0
          ? fc.constantFrom(...targets.rarities)
          : fc.constantFrom(0, 1, 2, 3, 4, 5),
        mainStat: fc.constantFrom(...STAT_IDS),
        level: fc.constantFrom(0, 4, 8, 12, 16),
        faction: fc.oneof(fc.constant(undefined), fc.constantFrom(...FACTION_IDS)),
      }).chain((base) =>
        arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
          .map((substats) => ({ ...base, substats })),
      ));
    }

    // Right set+rank but rarity too low (0-2)
    if (targets.ranks.length > 0) {
      strategies.push(fc.record({
        set: fc.constantFrom(...targets.sets),
        slot: fc.constantFrom(...SLOT_IDS),
        rank: fc.constantFrom(...targets.ranks),
        rarity: fc.constantFrom(0, 1, 2) as fc.Arbitrary<0 | 1 | 2>,
        mainStat: fc.constantFrom(...STAT_IDS),
        level: fc.constantFrom(0, 4, 8, 12, 16),
        faction: fc.oneof(fc.constant(undefined), fc.constantFrom(...FACTION_IDS)),
      }).chain((base) =>
        arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
          .map((substats) => ({ ...base, substats })),
      ));
    }

    // Right structure but wrong substats: match set/rank/rarity but have
    // substats with statIds that DON'T match any active rule substat
    if (targets.ranks.length > 0) {
      strategies.push(fc.record({
        set: fc.constantFrom(...targets.sets),
        slot: fc.constantFrom(...SLOT_IDS),
        rank: fc.constantFrom(...targets.ranks),
        rarity: targets.rarities.length > 0
          ? fc.constantFrom(...targets.rarities)
          : fc.constantFrom(0, 1, 2, 3, 4, 5),
        mainStat: fc.constantFrom(...STAT_IDS),
        level: fc.constantFrom(0, 4, 8, 12, 16),
        faction: fc.oneof(fc.constant(undefined), fc.constantFrom(...FACTION_IDS)),
      }).chain((base) =>
        // Use game-accurate substat generation — the mismatch comes from
        // random stat IDs being unlikely to match specific rule requirements
        arbItemSubstats(base.rank, base.rarity, base.level, base.mainStat)
          .map((substats) => ({ ...base, substats })),
      ));
    }
  }

  // Fallback: just a random item if no strategies could be built
  if (strategies.length === 0) return arbItem;

  return fc.oneof(...strategies);
}

/** Generate a batch of targeted + near-miss + random items for a QuickGenState. */
export function arbItemsForState(state: QuickGenState): fc.Arbitrary<Item[]> {
  const targets = extractTargets(state);

  // If no active criteria, fall back to pure random items
  if (targets.sets.length === 0) {
    return fc.array(arbItem, { minLength: 50, maxLength: 100 });
  }

  return fc.tuple(
    fc.array(arbTargetedItem(targets), { minLength: 150, maxLength: 200 }),
    fc.array(arbNearMissItem(targets), { minLength: 150, maxLength: 200 }),
    fc.array(arbItem, { minLength: 50, maxLength: 100 }),
  ).map(([t, n, r]) => [...t, ...n, ...r]);
}
