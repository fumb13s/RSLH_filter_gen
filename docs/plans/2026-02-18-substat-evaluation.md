# Substat Evaluation in matchesRule — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `matchesRule` check item substats against rule substat thresholds, and add `LVLForCheck` level gating, so the evaluation engine is complete.

**Architecture:** Add `isFlat` to `ItemSubstat`, update both item arbitraries to carry it, then extend `matchesRule` with level and substat checks. Update reference evaluators (`matchesGroup`, `matchesQuickState`) to match. Existing pipeline property tests exercise the change automatically.

**Tech Stack:** TypeScript, vitest, fast-check

---

## Task 1: Add `isFlat` to `ItemSubstat`

**Files:**
- Modify: `packages/core/src/item.ts:20-24`

**Step 1: Update the interface**

```typescript
export interface ItemSubstat {
  statId: number;   // stat ID (from STAT_NAMES)
  isFlat: boolean;  // true = flat variant (flat HP, flat ATK, flat DEF); false = percent/other
  rolls: number;    // roll counter, 1–6 (default 1)
  value: number;    // total value, at least 1
}
```

**Step 2: Run tests to verify nothing breaks**

Run: `npm test`
Expected: PASS — no code reads `isFlat` yet, and the arbitraries already produce objects with `isFlat` (it's just not in the type).

Wait — the arbitraries do NOT currently include `isFlat` in the generated `ItemSubstat`. The `.map()` in `arbItemSubstats` produces `{ statId, rolls, value }`. This task adds the type; Task 2 adds the generation.

Run: `npm run build`
Expected: PASS (adding an optional-like field doesn't break consumers that don't read it).

Actually, adding a required field to an interface WILL break any code that constructs `ItemSubstat` without it. Check: the only construction points are `arbItemSubstats` (both core and web) and `makeItem` (invariants.ts). None currently include `isFlat`. So build will fail until Task 2 patches them.

**Approach: combine with Task 2 to avoid a broken intermediate state.**

**Step 3: Commit**

Combined with Task 2.

---

## Task 2: Update `arbItemSubstats` and `makeItem` to include `isFlat`

**Files:**
- Modify: `packages/core/src/item.ts:20-24` (from Task 1)
- Modify: `packages/core/src/__tests__/helpers/arbitraries.ts` (arbItemSubstats .map)
- Modify: `packages/web/src/__tests__/helpers/arbitraries.ts` (arbItemSubstats .map)
- Modify: `packages/core/src/__tests__/helpers/invariants.ts:46-57` (makeItem)

**Step 1: Add `isFlat` to ItemSubstat interface**

In `packages/core/src/item.ts`, change:

```typescript
export interface ItemSubstat {
  statId: number;   // stat ID (from STAT_NAMES)
  rolls: number;    // roll counter, 1–6 (default 1)
  value: number;    // total value, at least 1
}
```

to:

```typescript
export interface ItemSubstat {
  statId: number;   // stat ID (from STAT_NAMES)
  isFlat: boolean;  // true for flat HP/ATK/DEF; false for percent/SPD/C.RATE/C.DMG/RES/ACC
  rolls: number;    // roll counter, 1–6 (default 1)
  value: number;    // total value, at least 1
}
```

**Step 2: Update core `arbItemSubstats` to include `isFlat`**

In `packages/core/src/__tests__/helpers/arbitraries.ts`, find the `.map((values) => ({` inside `arbItemSubstats` and add `isFlat`:

```typescript
.map((values) => ({
  statId,
  isFlat,    // NEW
  rolls,
  value: (values as number[]).reduce((a, b) => a + b, 0),
}));
```

**Step 3: Update web `arbItemSubstats` to include `isFlat`**

Same change in `packages/web/src/__tests__/helpers/arbitraries.ts`.

**Step 4: Update `makeItem` in invariants.ts**

No change needed — `makeItem` produces `substats: []` by default, which is a valid empty array of `ItemSubstat`. Callers that pass substats via overrides will need to include `isFlat`, but no existing callers do.

**Step 5: Update `makeItem` in evaluate.test.ts**

Same situation — `substats: []` is fine. But we'll add substat tests in Task 4 that construct items with substats, so no change needed here yet.

**Step 6: Update smoke property test to check `isFlat`**

In `packages/core/src/__tests__/evaluate.prop.test.ts`, add to the "generated items have valid substats" test:

```typescript
// Each substat has a boolean isFlat
for (const s of item.substats) {
  expect(typeof s.isFlat).toBe("boolean");
}
```

**Step 7: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 8: Commit**

```
feat: add isFlat to ItemSubstat and carry through arbitraries
```

---

## Task 3: Add LVLForCheck and substat evaluation to `matchesRule`

**Files:**
- Modify: `packages/core/src/evaluate.ts:20-51`

**Step 1: Add LVLForCheck check**

After the Faction check (line 48) and before `return true` (line 50), add:

```typescript
// LVLForCheck: 0 = any level, otherwise item must be at or above checkpoint
if (rule.LVLForCheck !== 0) {
  if (item.level < rule.LVLForCheck) return false;
}
```

**Step 2: Add substat evaluation**

After the LVLForCheck check, add:

```typescript
// Substats: every active rule substat must be satisfied by an item substat
for (const rs of rule.Substats) {
  if (rs.ID <= 0) continue; // empty slot
  const match = item.substats.find(
    (s) => s.statId === rs.ID && s.isFlat === rs.IsFlat,
  );
  if (!match || match.value < rs.Value) return false;
}
```

**Step 3: Run build and tests**

Run: `npm run build && npm test`
Expected: Some tests may fail — the "wildcard keep rule matches any item" property test uses `defaultRule()` which has `LVLForCheck: 0` and empty substats, so it should still pass. But other tests that construct rules with non-zero LVLForCheck or active substats against items with `substats: []` may now fail.

Check specifically:
- `evaluate.test.ts` — all existing tests use `makeItem()` with `level: 16` and rules with `LVLForCheck: 0` + empty substats → should pass
- `evaluate.prop.test.ts` — random rules against random items → substat checks now active, some matches will become non-matches. The "wildcard" test explicitly sets LVLForCheck:0 → fine. Other properties test generic behavior (determinism, keep/sell enum) → fine.

**Step 4: Commit**

```
feat: add LVLForCheck and substat evaluation to matchesRule
```

---

## Task 4: Add unit tests for substat and level evaluation

**Files:**
- Modify: `packages/core/src/__tests__/evaluate.test.ts`

**Step 1: Add LVLForCheck unit tests**

```typescript
describe("matchesRule — LVLForCheck", () => {
  it("LVLForCheck 0 matches any level", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, LVLForCheck: 0 });
    expect(matchesRule(rule, makeItem({ level: 0 }))).toBe(true);
    expect(matchesRule(rule, makeItem({ level: 16 }))).toBe(true);
  });

  it("matches when item level meets checkpoint", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, LVLForCheck: 8 });
    expect(matchesRule(rule, makeItem({ level: 8 }))).toBe(true);
    expect(matchesRule(rule, makeItem({ level: 16 }))).toBe(true);
  });

  it("does not match when item level is below checkpoint", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, LVLForCheck: 8 });
    expect(matchesRule(rule, makeItem({ level: 4 }))).toBe(false);
  });
});
```

**Step 2: Add substat unit tests**

```typescript
describe("matchesRule — Substats", () => {
  it("empty rule substats match any item", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    // defaultRule has all empty substats (ID: -1)
    expect(matchesRule(rule, makeItem())).toBe(true);
  });

  it("matches when item meets substat threshold", () => {
    const rule = defaultRule({
      Rank: 0, Rarity: 0, MainStatID: -1,
      Substats: [
        { ID: 4, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
      ],
    });
    const item = makeItem({
      substats: [{ statId: 4, isFlat: false, rolls: 3, value: 15 }],
    });
    expect(matchesRule(rule, item)).toBe(true);
  });

  it("does not match when item substat value is below threshold", () => {
    const rule = defaultRule({
      Rank: 0, Rarity: 0, MainStatID: -1,
      Substats: [
        { ID: 4, Value: 20, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
      ],
    });
    const item = makeItem({
      substats: [{ statId: 4, isFlat: false, rolls: 2, value: 10 }],
    });
    expect(matchesRule(rule, item)).toBe(false);
  });

  it("does not match when item lacks required substat", () => {
    const rule = defaultRule({
      Rank: 0, Rarity: 0, MainStatID: -1,
      Substats: [
        { ID: 4, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
      ],
    });
    const item = makeItem({ substats: [] });
    expect(matchesRule(rule, item)).toBe(false);
  });

  it("IsFlat distinguishes flat from percent variants", () => {
    const rule = defaultRule({
      Rank: 0, Rarity: 0, MainStatID: -1,
      Substats: [
        { ID: 1, Value: 5, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
      ],
    });
    // Item has flat HP (isFlat: true), rule wants HP% (IsFlat: false) — should NOT match
    const item = makeItem({
      substats: [{ statId: 1, isFlat: true, rolls: 1, value: 200 }],
    });
    expect(matchesRule(rule, item)).toBe(false);
  });

  it("multiple active substats require ALL to be satisfied (AND)", () => {
    const rule = defaultRule({
      Rank: 0, Rarity: 0, MainStatID: -1,
      Substats: [
        { ID: 4, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: 5, Value: 8, IsFlat: false, NotAvailable: false, Condition: ">=" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
        { ID: -1, Value: 0, IsFlat: true, NotAvailable: false, Condition: "" },
      ],
    });
    // Item has both substats meeting thresholds
    const itemBoth = makeItem({
      substats: [
        { statId: 4, isFlat: false, rolls: 3, value: 15 },
        { statId: 5, isFlat: false, rolls: 2, value: 10 },
      ],
    });
    expect(matchesRule(rule, itemBoth)).toBe(true);

    // Item has only one substat
    const itemOne = makeItem({
      substats: [
        { statId: 4, isFlat: false, rolls: 3, value: 15 },
      ],
    });
    expect(matchesRule(rule, itemOne)).toBe(false);
  });
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```
test: add unit tests for LVLForCheck and substat evaluation in matchesRule
```

---

## Task 5: Update reference evaluators in test invariants

The pipeline property tests use `matchesGroup` and `matchesQuickState` as reference evaluators. These currently only check structural fields. Since `matchesRule` now checks substats and level, the pipeline equivalence properties need the reference evaluators to account for these too — otherwise the "rule match → group match" property will have false negatives (rule rejects on substats, but group accepts on structure only).

However, looking at the pipeline properties more carefully:

- "group match → rule match" asserts: `if (ruleMatch) then groupMatch` — rule match implies group match. With substat checks added to `matchesRule`, rules are **stricter** (fewer matches), so this property becomes **easier** to satisfy — it should still hold without changes to `matchesGroup`.
- "unconditional groups ↔ rules" — unconditional groups have no goodStats, so their rules have empty substats (all ID:-1). Substat checks are vacuously true. Should still hold.
- "state ↔ group ↔ rule three-level" — same logic: rule match → group match becomes easier; group match → state match is unchanged.

**The reference evaluators do NOT need substat logic.** The directional properties (rule ⊆ group ⊆ state) become strictly more true when rules are stricter. The only property that could break is a bidirectional one for conditional groups, but the existing "unconditional groups ↔ rules" test filters to unconditional groups (empty goodStats = empty substats).

**Files:** No changes needed.

**Step 1: Run the full test suite to confirm**

Run: `npm run build && npm test && npm run lint`
Expected: PASS

**Step 2: Commit**

No commit needed — just verification.

---

## Task 6: Update smoke property test for `isFlat`

Already handled in Task 2 Step 6. No additional task needed.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 2 | Add `isFlat` to `ItemSubstat` + update arbitraries | `item.ts`, both `arbitraries.ts` files, `evaluate.prop.test.ts` |
| 3 | Add LVLForCheck + substat checks to `matchesRule` | `evaluate.ts` |
| 4 | Add unit tests for new evaluation logic | `evaluate.test.ts` |
| 5 | Verify pipeline property tests still pass | (verification only) |
