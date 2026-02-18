# Item Substat Generation for Property Tests

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate game-accurate substats on `Item` objects in property-based test arbitraries so items are realistic and ready for future substat evaluation testing.

**Architecture:** Build an `arbItemSubstats(rank, rarity, level, mainStat)` arbitrary that picks unique stat IDs (excluding mainStat), computes roll counts from rarity/level upgrade mechanics, and generates values within `getRollRange` bounds. Replace `fc.constant([])` in both core and web `arbItem` with this new generator. Targeted/near-miss item generators in web inherit the change automatically.

**Tech Stack:** fast-check arbitraries, existing `item.ts` roll-range infrastructure (`STARTING_SUBSTATS`, `MAX_SUBSTATS`, `UPGRADE_LEVELS`, `getRollRange`)

---

## Game Mechanics Reference

### Substat Count

`STARTING_SUBSTATS = [0, 1, 2, 3, 4, 5]` indexed by rarity (0=Common..5=Mythical).

At level 0, an item has `min(STARTING_SUBSTATS[rarity], MAX_SUBSTATS)` substat **slots** filled. Mythical (index 5) starts with 4 slots but the 5th "starting substat" becomes an extra roll on an existing slot.

Each upgrade level (4, 8, 12, 16) either:
- Fills an empty slot (if < 4 substats), or
- Adds a roll to a random existing substat

### Substat Stat IDs

11 possible substat variants (`ALL_STAT_VARIANTS`):
- `[1, true]` Flat HP, `[1, false]` HP%
- `[2, true]` Flat ATK, `[2, false]` ATK%
- `[3, true]` Flat DEF, `[3, false]` DEF%
- `[4, true]` SPD (always flat-group in roll ranges)
- `[5, false]` C.RATE, `[6, false]` C.DMG
- `[7, true]` RES, `[8, true]` ACC

A substat's stat ID must differ from the item's mainStat (same ID excluded). No duplicate stat IDs among an item's substats.

### Roll Ranges

`getRollRange(statId, rank, isFlat)` returns `[min, max]`. Flat HP/ATK/DEF have `[0, 0]` at ranks 1-4, so flat variants of stats 1-3 are only valid at ranks 5-6. The arbitrary already constrains rank to 5 or 6, so this is not a problem in practice — but the code should still filter out zero-range stats.

### Value Computation

For a substat with `rolls` roll count at rank `R`:
- Each roll produces a value in `[min, max]` from `getRollRange`
- `value` = sum of `rolls` independent rolls
- So `value` is in `[rolls * min, rolls * max]`

---

## Tasks

### Task 1: Build `arbItemSubstats` in core arbitraries

**Files:**
- Modify: `packages/core/src/__tests__/helpers/arbitraries.ts`

**Step 1: Add the substat stat-variant constant and helper**

Add above the existing Item arbitrary section:

```typescript
import {
  ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, STAT_NAMES,
  FACTION_NAMES, HSF_RARITY_IDS,
  MAX_SUBSTATS, STARTING_SUBSTATS, UPGRADE_LEVELS, getRollRange,
} from "../../index.js";
import type { HsfRule, HsfFilter, HsfSubstat, Item, ItemSubstat } from "../../index.js";

// Substat variants: [statId, isFlat]
const SUBSTAT_VARIANTS: readonly [number, boolean][] = [
  [1, true], [1, false],
  [2, true], [2, false],
  [3, true], [3, false],
  [4, true],            // SPD — always "flat" in roll-range terms
  [5, false], [6, false],
  [7, true], [8, true],
];
```

**Step 2: Build the `arbItemSubstats` function**

Add a function that, given item properties, generates a valid substats array:

```typescript
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

  // If not enough eligible stats, reduce filledSlots
  const actualSlots = Math.min(filledSlots, eligible.length);
  if (actualSlots === 0) return fc.constant([]);

  // Pick `actualSlots` unique stat variants
  return fc.shuffledSubarray(eligible, {
    minLength: actualSlots,
    maxLength: actualSlots,
  }).chain((chosenVariants) => {
    // Distribute extraRolls randomly among slots
    // Each slot starts with 1 roll; extra rolls are added on top
    return fc.array(
      fc.nat({ max: actualSlots - 1 }),
      { minLength: extraRolls, maxLength: extraRolls },
    ).chain((rollTargets) => {
      const rollCounts = new Array(actualSlots).fill(1) as number[];
      for (const idx of rollTargets) rollCounts[idx]++;

      // Generate value for each substat
      const substatArbs = chosenVariants.map(([statId, isFlat], i) => {
        const range = getRollRange(statId, rank, isFlat)!;
        const rolls = rollCounts[i];
        // Value = sum of `rolls` independent values in [min, max]
        return fc.tuple(
          ...Array.from({ length: rolls }, () =>
            fc.integer({ min: range[0], max: range[1] }),
          ),
        ).map((values) => ({
          statId,
          rolls,
          value: (values as number[]).reduce((a, b) => a + b, 0),
        }));
      });

      return fc.tuple(...substatArbs) as fc.Arbitrary<ItemSubstat[]>;
    });
  });
}
```

**Step 3: Update `arbItem` to use `arbItemSubstats`**

Replace the flat `fc.record` with a chain that first picks the structural fields, then generates substats:

```typescript
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
```

**Step 4: Run tests to verify nothing breaks**

Run: `npm test`
Expected: all existing tests pass — substats are now populated but no test asserts on them yet.

**Step 5: Commit**

```
feat: add game-accurate substat generation to core item arbitrary
```

---

### Task 2: Port `arbItemSubstats` to web arbitraries

**Files:**
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts`

**Step 1: Add the same substat infrastructure**

Add imports and `SUBSTAT_VARIANTS`, `arbItemSubstats` (identical logic to core). Add to imports:

```typescript
import type { Item, ItemSubstat, HsfRule, HsfSubstat, HsfFilter } from "@rslh/core";
import {
  // existing imports...
  MAX_SUBSTATS, STARTING_SUBSTATS, UPGRADE_LEVELS, getRollRange,
} from "@rslh/core";
```

Then add `SUBSTAT_VARIANTS` and `arbItemSubstats` (same code as Task 1).

**Step 2: Update `arbItem` to use `arbItemSubstats`**

Same `.chain()` pattern as Task 1.

**Step 3: Update `arbTargetedItem` and `arbNearMissItem`**

Both functions currently return `fc.record({...})` with `substats: fc.constant([])`. Update each to use the same `.chain()` + `arbItemSubstats` pattern. The `arbTargetedItem` function:

```typescript
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
```

Same pattern for each `fc.record({...})` in `arbNearMissItem`'s strategy branches.

**Step 4: Run tests**

Run: `npm test`
Expected: all tests pass.

**Step 5: Commit**

```
feat: add game-accurate substat generation to web item arbitraries
```

---

### Task 3: DRY — extract shared substat arbitrary to core

Since core and web have identical `SUBSTAT_VARIANTS` and `arbItemSubstats` logic, extract to a shared location.

**Files:**
- Modify: `packages/core/src/__tests__/helpers/arbitraries.ts` — export the shared pieces
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts` — import from core

**Step 1: Export `SUBSTAT_VARIANTS` and `arbItemSubstats` from core arbitraries**

Add `export` to both:

```typescript
export const SUBSTAT_VARIANTS: readonly [number, boolean][] = [...];
export function arbItemSubstats(...): fc.Arbitrary<ItemSubstat[]> { ... }
```

**Step 2: Import in web arbitraries and remove duplicates**

```typescript
import { arbItemSubstats } from "@rslh/core/src/__tests__/helpers/arbitraries.js";
```

Wait — test helpers shouldn't be imported cross-package via published paths. Since both are test files, and the logic is identical, it's better to either:
- **(a)** Keep the duplication (it's ~40 lines, test-only), or
- **(b)** Move `arbItemSubstats` into core's published API (e.g. `item.ts`) as a pure function, not an fc arbitrary

Option (a) is simpler and avoids polluting the published API with test infrastructure. **Keep the duplication.** Skip this task.

---

### Task 4: Verify with a quick smoke property

Add a lightweight property test in core to confirm generated items have valid substats.

**Files:**
- Modify: `packages/core/src/__tests__/evaluate.prop.test.ts`

**Step 1: Add a property that checks substat invariants on generated items**

```typescript
import { getRollRange, MAX_SUBSTATS, STARTING_SUBSTATS, UPGRADE_LEVELS } from "../index.js";

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
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: all tests pass, including the new property.

**Step 3: Commit**

```
test: add property test validating generated item substats
```

---

## Notes

- The `fc.tuple(...Array.from(...))` spread pattern creates a tuple of N integer arbitraries where N is the roll count. This is valid because roll counts are small (1-6).
- `fc.shuffledSubarray` picks a unique subset in random order — exactly what we need for non-duplicate stat selection.
- Common-rarity items at level 0 will have 0 substats (matching real game behavior).
- The change is backwards-compatible: existing tests don't assert on substat contents, so they'll pass with populated substats.
