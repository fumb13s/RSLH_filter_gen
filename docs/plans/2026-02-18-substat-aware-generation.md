# Substat-Aware Item Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make property test item generation substat-aware so that `matchesRule` substat evaluation is meaningfully exercised with near-threshold items that sometimes pass and sometimes fail.

**Architecture:** Replace the current two-tier `arbTargetedItem`/`arbNearMissItem` scheme in the web arbitraries with a three-tier system: near-threshold items (structural match + substats near rule thresholds), enhanced near-miss items (including substat mismatches), and fully random items. Rules are computed deterministically from the state inside `arbItemsForState`.

**Tech Stack:** TypeScript, fast-check, vitest

---

## Task 1: Add `arbNearThresholdItem` to web arbitraries

**Files:**
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts:457-484`

**Step 1: Add imports for rule generation pipeline**

At the top of `packages/web/src/__tests__/helpers/arbitraries.ts`, add these imports alongside the existing ones:

```typescript
import { generateRulesFromGroups } from "../../generate-rules.js";
import {
  quickStateToGroups,
  oreRerollToGroups,
  rareAccessoriesToGroups,
} from "../../quick-generator.js";
import { hsfRarityToIndex } from "./invariants.js";
```

Note: `QuickGenState` is already imported (line 16/24). `getRollRange` is already imported from `@rslh/core` (line 13). `HsfRule` and `HsfSubstat` are already imported from `@rslh/core` (line 15).

**Step 2: Add the `arbNearThresholdItem` function**

Add this function after the `arbItemSubstats` function (after line 298) and before the Item arbitrary section:

```typescript
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
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS (new function is not called yet)

**Step 4: Commit**

```
feat: add arbNearThresholdItem for substat-aware item generation

Generates items matching a rule's structural criteria with substats
within one roll's max of the threshold. Produces ~50/50 pass/fail per
substat, exercising both evaluation paths in matchesRule.
```

---

## Task 2: Add substat-mismatch strategy to `arbNearMissItem`

**Files:**
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts:486-544`

**Step 1: Add substat-mismatch strategy**

The current `arbNearMissItem` has three structural strategies (wrong set, low rank, low rarity). Add a fourth: right structure but wrong substats.

In `arbNearMissItem`, after the "Right set+rank but rarity too low" strategy block (around line 537) and before the fallback `if (strategies.length === 0)` line, add:

```typescript
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
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```
feat: add substat-mismatch near-miss strategy

Adds a fourth near-miss strategy where items match structurally (correct
set, rank, rarity) but have random substats unlikely to meet rule
thresholds, verifying that structural match alone doesn't pass rules
with substat requirements.
```

---

## Task 3: Wire `arbNearThresholdItem` into `arbItemsForState` and remove `arbTargetedItem`

**Files:**
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts:546-560` (arbItemsForState)
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts:457-484` (remove arbTargetedItem)

**Step 1: Update `arbItemsForState` to compute rules and use near-threshold items**

Replace the existing `arbItemsForState` function (lines 547-560) with:

```typescript
/** Generate a batch of near-threshold + near-miss + random items for a QuickGenState. */
export function arbItemsForState(state: QuickGenState): fc.Arbitrary<Item[]> {
  const targets = extractTargets(state);

  // If no active criteria, fall back to pure random items
  if (targets.sets.length === 0) {
    return fc.array(arbItem, { minLength: 50, maxLength: 100 });
  }

  // Compute rules from state to enable substat-aware generation
  const groups = [
    ...quickStateToGroups(state),
    ...rareAccessoriesToGroups(state.rareAccessories),
    ...oreRerollToGroups(state.oreReroll),
  ];
  const rules = generateRulesFromGroups(groups);

  const nearThresholdArb = arbNearThresholdItem(rules);

  return fc.tuple(
    fc.array(nearThresholdArb, { minLength: 150, maxLength: 200 }),
    fc.array(arbNearMissItem(targets), { minLength: 100, maxLength: 150 }),
    fc.array(arbItem, { minLength: 50, maxLength: 100 }),
  ).map(([t, n, r]) => [...t, ...n, ...r]);
}
```

**Step 2: Remove `arbTargetedItem`**

Delete the `arbTargetedItem` function (lines 457-484) and the `TargetParams` interface (lines 375-381) **only if** `TargetParams` is no longer used. Check: `TargetParams` is used by `extractTargets` return type and `arbNearMissItem` parameter. So keep `TargetParams`, and only delete `arbTargetedItem`.

**Step 3: Run build and tests**

Run: `npm run build && npm test && npm run lint`
Expected: PASS — pipeline property tests should still hold because:
- `ruleMatch → groupMatch` is unchanged (rules are stricter → fewer matches)
- Near-threshold items produce more rule matches, exercising the assertion more
- Near-miss items with substat mismatches produce more group matches without rule matches (expected by directional property)

**Step 4: Commit**

```
feat: wire near-threshold items into arbItemsForState, replace targeted tier

arbItemsForState now computes rules from the state and uses
arbNearThresholdItem for the primary tier (150-200 items with substats
near rule thresholds), replacing arbTargetedItem which had random substats.

Near-miss tier reduced to 100-150, random tier stays at 50-100.
```

---

## Task 4: Verify pipeline properties with increased iteration count

**Files:**
- No code changes

**Step 1: Run full test suite**

Run: `npm run build && npm test && npm run lint`
Expected: PASS

**Step 2: Run pipeline property tests with more iterations to build confidence**

Run: `npx vitest run packages/web/src/__tests__/pipeline.prop.test.ts --reporter=verbose`
Expected: PASS — all 5 properties hold

If any property fails, inspect the counterexample:
- If `ruleMatch` but not `groupMatch`: bug in near-threshold item generation (item matches rule but shouldn't match group)
- If `groupMatch` but not `stateMatch`: existing bug exposed by better coverage

**Step 3: Commit (verification only, no changes)**

No commit needed unless regressions were found and fixed.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Add `arbNearThresholdItem` function | `arbitraries.ts` |
| 2 | Add substat-mismatch near-miss strategy | `arbitraries.ts` |
| 3 | Wire into `arbItemsForState`, remove `arbTargetedItem` | `arbitraries.ts` |
| 4 | Verify pipeline properties | (verification only) |
