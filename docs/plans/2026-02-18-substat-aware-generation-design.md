# Substat-Aware Item Generation — Design

**Problem:** Property tests generate game-accurate substats but don't calibrate
them near rule thresholds. Since `matchesRule` now evaluates substats, random
substats almost never pass threshold checks, so the positive evaluation path
is barely exercised.

**Solution:** Replace the two-tier targeted/near-miss item generation with a
three-tier strategy that includes substat-threshold-aware items.

## Three Tiers

### Tier 1: Near-threshold (150-200 items)

Pick a rule with active substats from the generated ruleset. Generate an item
that matches the rule's structural criteria (set, slot, rank, rarity, mainStat,
level, faction). For each active substat, generate a value within one roll's max
of the threshold: `[threshold - rollMax, threshold + rollMax]`, clamped to >=1.
This produces ~50/50 pass/fail per substat, exercising both paths.

**Not game-accurate:** Values are constructed directly, not via roll mechanics.
The random tier provides game-accuracy coverage.

### Tier 2: Near-miss (100-150 items)

Existing strategies: wrong set, low rank, low rarity.

New strategy: right structure but wrong substats — either different stat IDs or
values well below threshold. Verifies that structural match alone doesn't pass
rules with substat requirements.

### Tier 3: Random (50-100 items)

Fully random, game-accurate items via existing `arbItem`. Unbiased baseline.

## Key Decisions

- `arbTargetedItem` (correct structure, random substats) is **replaced** by
  near-threshold items — strictly more useful since it targets both structural
  AND substat evaluation
- Rules are computed deterministically inside `arbItemsForState` by importing
  the generation pipeline. This is coupling within test code, acceptable
- Near-threshold substats are not constrained by game roll mechanics because
  the goal is to exercise evaluation logic, not model game realism
