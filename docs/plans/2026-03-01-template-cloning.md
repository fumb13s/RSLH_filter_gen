# Template Cloning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-card `document.createElement` construction with a `<template>` + `cloneNode(true)` pattern to reduce edit-mode card rendering time by 3-5x. Instead of calling `createElement` ~50 times per card (plus ~122 `<option>` elements), build one canonical template once and clone it, then stamp card-specific values onto the clone.

**Architecture:** A new module `packages/web/src/card-template.ts` exports a `getEditCardTemplate()` function that lazily builds a `<template>` element containing a fully-formed edit card with all static `<option>` elements, checkboxes, buttons, and data attributes pre-populated. `buildEditableRuleCard` in `editor.ts` calls `getEditCardTemplate().content.cloneNode(true)` to get a DocumentFragment, then uses `querySelector` to stamp rule-specific values (selected options, checked states, data-rule-index, button text, disabled states, CSS classes). The card builder remains pure (no event listeners) -- event delegation (already in place) handles all interactions.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests.

---

## Background

Chrome performance traces show `buildEditableRuleCard` is the hot path during page switches. Each call to `createElement` + `appendChild` triggers parser overhead. For 100 cards per page, that's ~5,000 `createElement` calls and ~12,200 `<option>` element constructions.

The `<template>` element's `content` is an inert `DocumentFragment` that the browser does not render or style. `cloneNode(true)` is a fast memory copy that skips the parser, attribute validation, and style recalculation that `createElement` requires.

Key insight: **every select element's options are identical across cards**. The rank dropdown always has 3 options, the substat selects always have 12 options. These can all be pre-built in the template.

---

## Task 1: Create `card-template.ts` with template builder and cache

**Files:**
- Create: `packages/web/src/card-template.ts`
- Create: `packages/web/src/__tests__/card-template.test.ts`

### Step 1: Write failing tests for template structure

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getEditCardTemplate, invalidateEditCardTemplate } from "../card-template.js";

describe("card-template", () => {
  beforeEach(() => invalidateEditCardTemplate());

  it("returns an HTMLTemplateElement", () => {
    expect(getEditCardTemplate()).toBeInstanceOf(HTMLTemplateElement);
  });

  it("returns the same instance on repeated calls (cached)", () => {
    expect(getEditCardTemplate()).toBe(getEditCardTemplate());
  });

  it("returns a fresh instance after invalidation", () => {
    const a = getEditCardTemplate();
    invalidateEditCardTemplate();
    expect(getEditCardTemplate()).not.toBe(a);
  });

  it("contains a single .edit-card root element", () => {
    const frag = getEditCardTemplate().content;
    expect(frag.querySelectorAll(".edit-card").length).toBe(1);
  });

  it("has all 5 field selects with correct data-field attributes", () => {
    const frag = getEditCardTemplate().content;
    for (const field of ["rank", "rarity", "main-stat", "level", "faction"]) {
      const sel = frag.querySelector(`[data-field='${field}']`);
      expect(sel, `missing data-field='${field}'`).not.toBeNull();
      expect(sel!.tagName).toBe("SELECT");
    }
  });

  it("rank select has 3 options", () => {
    const frag = getEditCardTemplate().content;
    const sel = frag.querySelector("[data-field='rank']") as HTMLSelectElement;
    expect(sel.options.length).toBe(3);
  });

  it("has 4 substat rows with stat selects (12 options each)", () => {
    const frag = getEditCardTemplate().content;
    const rows = frag.querySelectorAll(".edit-substat-row");
    expect(rows.length).toBe(4);
    for (const row of rows) {
      const statSel = row.querySelector(".edit-sub-stat") as HTMLSelectElement;
      expect(statSel.options.length).toBe(12);
    }
  });

  it("has 9 slot checkboxes", () => {
    const frag = getEditCardTemplate().content;
    expect(frag.querySelectorAll("[data-action='slot-check']").length).toBe(9);
  });

  it("has an empty set-selector-panel (for lazy population)", () => {
    const frag = getEditCardTemplate().content;
    const panel = frag.querySelector(".set-selector-panel");
    expect(panel).not.toBeNull();
    expect(panel!.children.length).toBe(0);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/card-template.test.ts`

### Step 3: Implement `card-template.ts`

Build the full template with all static elements: header (drag handle, index, keep/sell/active/inactive toggles, move buttons, delete), body (set field, slot checkboxes, rank/rarity/main-stat/level/faction selects with all options), substats (4 rows with stat select + condition select + value input).

The template uses default state: `Keep=true`, `Use=true`, all substats `None` (disabled), no slots checked, all selects at first option. The `stampEditCard` function overrides per-card values.

Key exports:
- `getEditCardTemplate()` — returns cached `HTMLTemplateElement`
- `invalidateEditCardTemplate()` — clears cache
- `stampEditCard(frag, rule, index, total)` — stamps rule-specific values

### Step 4: Run tests, build, lint

Run: `npm run build && npm test && npm run lint`

### Step 5: Commit

```
feat: add card-template module with cached <template> element for edit cards
```

---

## Task 2: Add `stampEditCard` function and tests

**Files:**
- Modify: `packages/web/src/card-template.ts`
- Modify: `packages/web/src/__tests__/card-template.test.ts`

### Step 1: Write failing tests for stampEditCard

```ts
import { defaultRule } from "@rslh/core";
import { stampEditCard } from "../card-template.js";

describe("stampEditCard", () => {
  function cloneCard(): DocumentFragment {
    return getEditCardTemplate().content.cloneNode(true) as DocumentFragment;
  }

  it("sets data-ruleIndex and id", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule(), 5, 10);
    const card = frag.querySelector(".edit-card") as HTMLElement;
    expect(card.dataset.ruleIndex).toBe("5");
    expect(card.id).toBe("rule-6");
  });

  it("sets Sell badge for Keep=false", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule({ Keep: false }), 0, 1);
    const btn = frag.querySelector("[data-action='keep-toggle']") as HTMLElement;
    expect(btn.textContent).toBe("Sell");
    expect(btn.classList.contains("badge-sell")).toBe(true);
  });

  it("sets Inactive for Use=false", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule({ Use: false }), 0, 1);
    const btn = frag.querySelector("[data-action='use-toggle']") as HTMLElement;
    expect(btn.textContent).toBe("Inactive");
  });

  it("disables move-up on first card", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule(), 0, 5);
    expect((frag.querySelector("[data-action='move-up']") as HTMLButtonElement).disabled).toBe(true);
    expect((frag.querySelector("[data-action='move-down']") as HTMLButtonElement).disabled).toBe(false);
  });

  it("sets field select values", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule({ Rank: 5, Rarity: 9, LVLForCheck: 12, Faction: 3 }), 0, 1);
    expect((frag.querySelector("[data-field='rank']") as HTMLSelectElement).value).toBe("5");
    expect((frag.querySelector("[data-field='level']") as HTMLSelectElement).value).toBe("12");
  });

  it("checks slot checkboxes matching ArtifactType", () => {
    const frag = cloneCard();
    stampEditCard(frag, defaultRule({ ArtifactType: [1, 3, 5] }), 0, 1);
    const checked = Array.from(frag.querySelectorAll("[data-action='slot-check']:checked"))
      .map((el) => (el as HTMLInputElement).dataset.slotId);
    expect(checked.sort()).toEqual(["1", "3", "5"]);
  });

  it("stamps active substats and enables their controls", () => {
    const rule = defaultRule();
    rule.Substats[0] = { ID: 5, IsFlat: false, Value: 15, Condition: ">", NotAvailable: false };
    const frag = cloneCard();
    stampEditCard(frag, rule, 0, 1);

    const row = frag.querySelectorAll(".edit-substat-row")[0];
    expect((row.querySelector(".edit-sub-stat") as HTMLSelectElement).value).toBe("5:0");
    expect((row.querySelector(".edit-sub-cond") as HTMLSelectElement).disabled).toBe(false);
    expect((row.querySelector(".edit-sub-cond") as HTMLSelectElement).value).toBe(">");
    expect((row.querySelector("input[type='number']") as HTMLInputElement).value).toBe("15");
  });
});
```

### Step 2: Implement `stampEditCard`

The function takes a cloned `DocumentFragment`, queries for each element by selector, and sets:
- `card.id`, `card.dataset.ruleIndex`, card CSS classes
- Keep/Sell and Active/Inactive badge text and classes
- Index span text
- Move button disabled states
- All select values (rank, rarity, main-stat, level, faction)
- Slot checkbox checked states
- Set toggle text via `summariseSets`
- Substat stat select values, condition values, value inputs, disabled states

### Step 3: Run tests, build, lint, commit

```
feat: add stampEditCard function for cloned card value assignment
```

---

## Task 3: Wire `buildEditableRuleCard` to use template cloning

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Verify existing editor tests pass (baseline)

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`

### Step 2: Replace `buildEditableRuleCard`

```ts
import { getEditCardTemplate, stampEditCard } from "./card-template.js";

function buildEditableRuleCard(
  rule: HsfRule,
  index: number,
  total: number,
): HTMLElement {
  const frag = getEditCardTemplate().content.cloneNode(true) as DocumentFragment;
  stampEditCard(frag, rule, index, total);
  return frag.firstElementChild as HTMLElement;
}
```

### Step 3: Remove dead builder functions from `editor.ts`

Remove: `buildSelectField`, `buildMainStatField`, `buildSetField`, `buildSlotField`, `buildSubstatsSection`, `buildSubstatRow`, `encodeMainStat`, `encodeSubstatValue`, `SUBSTAT_OPTIONS`, `CONDITION_OPTIONS`, `MAIN_STAT_OPTIONS`.

Keep: `summariseSets`, `populateSetPanel`, `SORTED_SET_ENTRIES` (used by delegation handlers).

### Step 4: Run editor tests to verify identical DOM

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`

Expected: All existing tests PASS. The cloned+stamped cards produce identical DOM.

### Step 5: Build, lint, commit

```
feat: wire editor to use template cloning instead of per-card createElement
```

---

## Task 4: Add integration test and template invalidation

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Add template invalidation to `clearEditor`

```ts
import { invalidateEditCardTemplate } from "./card-template.js";

export function clearEditor(): void {
  currentCallbacks = null;
  invalidateEditCardTemplate();
  // ... rest of cleanup
}
```

### Step 2: Add integration test

```ts
describe("template cloning integration", () => {
  it("produces cards with correct structure for complex rule", () => {
    const rule = defaultRule({
      Keep: false, Use: false, Rank: 5, Rarity: 9,
      LVLForCheck: 8, Faction: 3, MainStatID: 5, MainStatF: 1,
      ArtifactType: [1, 3, 5], ArtifactSet: [1, 4],
    });
    rule.Substats[0] = { ID: 2, IsFlat: false, Value: 10, Condition: ">", NotAvailable: false };

    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const card = document.querySelector(".edit-card") as HTMLElement;
    expect(card.classList.contains("sell")).toBe(true);
    expect(card.classList.contains("inactive")).toBe(true);
    expect((card.querySelector("[data-field='rank']") as HTMLSelectElement).value).toBe("5");
  });
});
```

### Step 3: Run tests, build, lint, commit

```
feat: invalidate template cache on editor clear, add integration test
```

---

## Task 5: Clean up and verify

### Step 1: Run full suite

Run: `npm run build && npm test && npm run lint`

### Step 2: Manual performance verification

1. Open dev server, load large .hsf, enter edit mode
2. Profile: compare card rendering time before/after
3. Expected: 3-5x faster card rendering per page switch
4. DOM node count unchanged (same nodes, just faster creation)
5. `createElement` calls per page switch drop from ~5,000 to ~1 (`cloneNode`)

---

## Summary

| File | Action | Description |
|---|---|---|
| `packages/web/src/card-template.ts` | Create | Template builder, cache, `stampEditCard`, `invalidateEditCardTemplate` |
| `packages/web/src/__tests__/card-template.test.ts` | Create | Tests for template structure and stamp correctness |
| `packages/web/src/editor.ts` | Modify | Replace `buildEditableRuleCard` with clone+stamp; remove dead builders; add invalidation |
| `packages/web/src/__tests__/editor.test.ts` | Modify | Add integration test for template-cloned cards |
