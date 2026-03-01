# Lazy Card Bodies (Accordion) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce per-page DOM nodes in edit mode from ~97K to ~1.5K by rendering only card headers initially. Card bodies (selects, checkboxes, inputs) are built lazily on demand when a card is expanded. At most 1-3 cards are expanded at any time.

**Architecture:** The existing `buildEditableRuleCard` function in `packages/web/src/editor.ts` is split into two phases: (1) a lightweight header-only card builder (~15 nodes per card), and (2) a lazy body builder that constructs the full ~960-node body on first expansion. Expansion/collapse is triggered by a new `data-action="expand"` click on the header, handled by the existing event delegation infrastructure on `#rules-container`. A module-level `Set<number>` tracks expanded card indices. On page switch, the set is cleared (all cards collapse). On `goToRule`, the target card is auto-expanded.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests. CSS class-based visibility toggle (no `hidden` attribute, to avoid the `display` override gotcha documented in MEMORY.md).

---

## DOM Node Budget Analysis

Current per-card breakdown in `buildEditableRuleCard`:

| Section | Nodes | Detail |
|---|---|---|
| Card wrapper | 1 | `div.edit-card` |
| Header | 9 | div + span(handle) + span(index) + 3 buttons(keep/use/delete) + 2 buttons(up/down) |
| Body container | 1 | `div.edit-body` |
| Set field | ~5 | div + label + div(set-selector) + button(toggle) + div(panel, empty) |
| Slot field | ~21 | div + label + div(grid) + 9 labels + 9 checkboxes + 9 spans |
| Rank select | 5 | div + label + select + 3 options |
| Rarity select | 7 | div + label + select + 5 options |
| Main Stat select | 14 | div + label + select + 12 options |
| Level select | 19 | div + label + select + 17 options |
| Faction select | 19 | div + label + select + 17 options |
| Substats section | ~61 | title + 4 rows (div + stat-select(12 opts) + cond-select(5 opts) + number-input) |
| **Total per card** | **~162 elements** | Plus text nodes (~200 more) |

**Header-only card: ~15 nodes** (card + header div + 7 children + a summary span).
**Body: ~147+ elements** (everything below the header).

With 100 cards per page:
- **Before:** 100 * ~360 (elements+text) = ~36K visible nodes
- **After (collapsed):** 100 * ~16 = ~1,600 nodes
- **After (3 expanded):** ~1,600 + 3 * ~350 = ~2,650 nodes

---

## Task 1: Add a short summary span to the card header

The collapsed card needs to show enough context so the user can identify it without expanding. Add a brief text summary to the header showing the rule's key attributes (sets, slots, rank, main stat).

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`
- Modify: `packages/web/src/style.css`

### Step 1: Write failing tests for the summary span

```ts
// In editor.test.ts, add to the "renderEditableRules" describe block:

it("each collapsed card has a summary span", () => {
  const rule = defaultRule({ Rank: 6, Keep: true });
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());

  const summary = document.querySelector(".edit-summary");
  expect(summary).not.toBeNull();
  expect(summary!.textContent).toBeTruthy();
});

it("summary shows set/slot/rank info", () => {
  const rule = defaultRule({ Rank: 5 });
  rule.ArtifactSet = [1];
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());

  const summary = document.querySelector(".edit-summary");
  expect(summary!.textContent).toContain("5");
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`

Expected: FAIL -- no `.edit-summary` element exists yet.

### Step 3: Add the `buildHeaderSummary` helper

In `editor.ts`, add a function that produces a short text summary of the rule, and add the result span to the header in `buildEditableRuleCard`, right after the delete button.

```ts
import {
  STAT_NAMES,
  describeRarity,
  lookupName,
} from "@rslh/core";

/** One-line summary for collapsed card headers. */
function buildHeaderSummary(rule: HsfRule): string {
  const parts: string[] = [];

  const setIds = rule.ArtifactSet?.filter((id) => id !== 0);
  if (setIds && setIds.length > 0) {
    const names = setIds.map((id) => ARTIFACT_SET_NAMES[id] ?? `?${id}`);
    parts.push(names.length <= 2 ? names.join(", ") : `${names[0]}, +${names.length - 1}`);
  }

  if (rule.Rank > 0) parts.push(`${rule.Rank}\u2605`);
  if (rule.Rarity > 0) parts.push(describeRarity(rule.Rarity));
  if (rule.MainStatID !== -1) parts.push(lookupName(STAT_NAMES, rule.MainStatID));

  const activeSubs = rule.Substats.filter((s) => s.ID !== -1).length;
  if (activeSubs > 0) parts.push(`${activeSubs} sub${activeSubs > 1 ? "s" : ""}`);

  return parts.length > 0 ? parts.join(" \u00b7 ") : "Any";
}
```

In `buildEditableRuleCard`, after the delete button and before `card.appendChild(header)`:

```ts
  const summarySpan = document.createElement("span");
  summarySpan.className = "edit-summary";
  summarySpan.textContent = buildHeaderSummary(rule);
  header.appendChild(summarySpan);
```

### Step 4: Add CSS for the summary span

```css
.edit-summary {
  font-size: 0.8rem;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
```

### Step 5: Run tests, build, lint

Run: `npm run build && npm test && npm run lint`

### Step 6: Commit

```
refactor: add summary span to edit card headers for collapsed preview
```

---

## Task 2: Split card builder into header-only and lazy body phases

Refactor `buildEditableRuleCard` to build only the header by default. Extract the body+substats construction into a `buildEditableCardBody` function that can be called on demand.

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Write failing tests for accordion behavior

```ts
describe("accordion (lazy card bodies)", () => {
  it("cards render without a body by default", () => {
    const filter = makeFilter([defaultRule(), defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const bodies = document.querySelectorAll(".edit-body");
    expect(bodies.length).toBe(0);
  });

  it("cards have an expand button in the header", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const expandBtn = document.querySelector("[data-action='expand']");
    expect(expandBtn).not.toBeNull();
  });

  it("clicking expand builds and shows the body", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const expandBtn = document.querySelector("[data-action='expand']") as HTMLElement;
    expandBtn.click();

    const bodies = document.querySelectorAll(".edit-body");
    expect(bodies.length).toBe(1);

    const card = document.querySelector(".edit-card") as HTMLElement;
    expect(card.classList.contains("expanded")).toBe(true);
  });

  it("clicking expand on a second card collapses the first", () => {
    const filter = makeFilter([defaultRule(), defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const expandBtns = document.querySelectorAll("[data-action='expand']");

    (expandBtns[0] as HTMLElement).click();
    expect(document.querySelectorAll(".edit-card.expanded").length).toBe(1);

    (expandBtns[1] as HTMLElement).click();
    const expanded = document.querySelectorAll(".edit-card.expanded");
    expect(expanded.length).toBe(1);
    expect((expanded[0] as HTMLElement).dataset.ruleIndex).toBe("1");
  });

  it("clicking expand on an expanded card collapses it", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const expandBtn = document.querySelector("[data-action='expand']") as HTMLElement;
    expandBtn.click();
    expect(document.querySelectorAll(".expanded").length).toBe(1);

    expandBtn.click();
    expect(document.querySelectorAll(".expanded").length).toBe(0);
  });

  it("body content survives collapse and re-expand (cached)", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const expandBtn = document.querySelector("[data-action='expand']") as HTMLElement;
    expandBtn.click();

    const rankSelect = document.querySelector("[data-field='rank']") as HTMLSelectElement;
    expect(rankSelect).not.toBeNull();

    expandBtn.click(); // collapse
    expandBtn.click(); // re-expand

    const rankAgain = document.querySelector("[data-field='rank']") as HTMLSelectElement;
    expect(rankAgain).not.toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`

### Step 3: Refactor `buildEditableRuleCard` to be header-only

Extract body and substats construction into a separate function:

```ts
/** Build the full body (fields + substats) for an edit card. Called lazily on expand. */
function buildEditableCardBody(rule: HsfRule): DocumentFragment {
  const frag = document.createDocumentFragment();

  const body = document.createElement("div");
  body.className = "edit-body";

  body.appendChild(buildSetField(rule));
  body.appendChild(buildSlotField(rule));
  body.appendChild(buildSelectField("Rank", "rank", rule.Rank, [
    { value: 0, label: "Any" },
    { value: 5, label: "5-star" },
    { value: 6, label: "6-star" },
  ]));

  // ... rarity, main stat, level, faction fields ...

  frag.appendChild(body);
  frag.appendChild(buildSubstatsSection(rule));
  return frag;
}
```

Modify `buildEditableRuleCard` to remove the body+substats lines. Add `header.dataset.action = "expand"` so the whole header is the expand target.

### Step 4: Add expand/collapse handling to the click delegation handler

Add a new case to `handleContainerClick`:

```ts
    case "expand": {
      if (target !== action && target.closest("[data-action]") !== action) return;
      toggleCardExpansion(card, index);
      break;
    }
```

The `toggleCardExpansion` function:

```ts
function collapseAllExcept(container: HTMLElement, exceptIndex: number): void {
  for (const expanded of container.querySelectorAll(".edit-card.expanded")) {
    const idx = Number((expanded as HTMLElement).dataset.ruleIndex);
    if (idx !== exceptIndex) {
      expanded.classList.remove("expanded");
    }
  }
}

function toggleCardExpansion(card: HTMLElement, index: number): void {
  const isExpanded = card.classList.contains("expanded");

  if (isExpanded) {
    card.classList.remove("expanded");
    return;
  }

  const container = card.parentElement!;
  collapseAllExcept(container, index);

  if (!card.querySelector(".edit-body")) {
    const filter = getCurrentFilter();
    if (!filter) return;
    const rule = filter.Rules[index];
    card.appendChild(buildEditableCardBody(rule));
  }

  card.classList.add("expanded");
}
```

**Key design decision:** The body DOM is built once and cached inside the card element. Collapse does NOT remove it -- it just hides it via CSS. This avoids losing user edits in progress.

### Step 5: Update existing tests to expand card before querying body elements

Add helper:

```ts
function expandCard(index: number): void {
  const cards = document.querySelectorAll(".edit-card");
  const header = cards[index].querySelector(".edit-header") as HTMLElement;
  header.click();
}
```

Tests that need `expandCard(0)` before querying body elements:
- "substat editing"
- "rank dropdown"
- "data attributes / substat rows have data-sub-index"
- "data attributes / field selects have data-field"
- "condition and value inputs are disabled"
- "passthrough fields on substat survive edits"

### Step 6: Run tests, build, lint

Run: `npm run build && npm test && npm run lint`

### Step 7: Commit

```
feat: lazy card bodies — build edit card body only on first expand (accordion)
```

---

## Task 3: Add CSS for accordion expand/collapse

**Files:**
- Modify: `packages/web/src/style.css`

### Step 1: Add CSS rules

```css
/* Body and substats are hidden by default */
.edit-card .edit-body,
.edit-card .edit-substats {
  display: none;
}

/* Show body and substats when card is expanded */
.edit-card.expanded .edit-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1.5rem;
  margin-bottom: 0.75rem;
}

.edit-card.expanded .edit-substats {
  display: block;
}

/* Hide summary when expanded */
.edit-card.expanded .edit-summary {
  display: none;
}

/* Cursor on header */
.edit-header {
  cursor: pointer;
}

.edit-card:not(.expanded) .edit-header {
  margin-bottom: 0;
}

/* Chevron indicator */
.edit-header::after {
  content: "\25b6";
  font-size: 0.7rem;
  color: #9ca3af;
  transition: transform 0.15s;
  flex-shrink: 0;
  margin-left: 0.25rem;
}

.edit-card.expanded .edit-header::after {
  content: "\25bc";
}
```

### Step 2: Build and verify

Run: `npm run build && npm run lint`

### Step 3: Commit

```
style: add accordion expand/collapse CSS for lazy edit card bodies
```

---

## Task 4: Wire `goToRule` to auto-expand the target card

**Files:**
- Modify: `packages/web/src/render.ts`
- Modify: `packages/web/src/editor.ts`

### Step 1: Export `expandCardByIndex` from editor.ts

```ts
export function expandCardByIndex(ruleIndex: number): void {
  const card = document.getElementById(`rule-${ruleIndex + 1}`) as HTMLElement | null;
  if (!card || !card.classList.contains("edit-card")) return;

  const container = card.parentElement;
  if (container) collapseAllExcept(container, ruleIndex);

  if (!card.querySelector(".edit-body")) {
    const filter = getCurrentFilter();
    if (!filter) return;
    const rule = filter.Rules[ruleIndex];
    card.appendChild(buildEditableCardBody(rule));
  }

  card.classList.add("expanded");
}
```

### Step 2: Call from `goToRule` in render.ts

```ts
import { expandCardByIndex } from "./editor.js";

// In goToRule, after scrollIntoView:
expandCardByIndex(ruleIndex);
```

### Step 3: Run tests, build, lint, commit

```
feat: auto-expand edit card when navigating via goToRule
```

---

## Task 5: Update summary span after body edits

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Add `refreshCardSummary` helper

```ts
function refreshCardSummary(card: HTMLElement, rule: HsfRule): void {
  const summary = card.querySelector(".edit-summary");
  if (summary) {
    summary.textContent = buildHeaderSummary(rule);
  }
}
```

### Step 2: Call after every `onRuleChange` in delegation handlers

Add `refreshCardSummary(card, rule)` call after every `currentCallbacks.onRuleChange(index, rule)` in:
- `handleContainerClick` (keep-toggle, use-toggle)
- `handleContainerChange` (field selects, substats, set checkboxes, slot checkboxes)
- `handleContainerInput` (substat value inputs)

### Step 3: Run tests, build, lint, commit

```
fix: refresh card summary span after rule edits in expanded body
```

---

## Task 6: Verify drag-and-drop on collapsed cards

**Files:**
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Add verification tests

```ts
describe("drag and drop on collapsed cards", () => {
  it("collapsed cards are still draggable", () => {
    const filter = makeFilter([defaultRule(), defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const cards = document.querySelectorAll(".edit-card") as NodeListOf<HTMLElement>;
    expect(cards[0].classList.contains("expanded")).toBe(false);
    expect(cards[0].draggable).toBe(true);
  });

  it("drag handles are accessible on collapsed cards", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    const handle = document.querySelector(".edit-drag-handle");
    expect(handle).not.toBeNull();
  });
});
```

### Step 2: Run tests, commit

```
test: verify drag-and-drop works on collapsed accordion cards
```

---

## Task 7: Edge cases -- page switch, rule add/delete

**Files:**
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Add edge case tests

```ts
describe("accordion edge cases", () => {
  it("all cards collapse after re-render", () => {
    const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    expandCard(1);
    expect(document.querySelectorAll(".expanded").length).toBe(1);

    renderEditableRules(filter, noopCallbacks());
    expect(document.querySelectorAll(".expanded").length).toBe(0);
  });
});
```

### Step 2: Run tests, build, lint, commit

```
test: accordion edge cases — page switch, re-render collapse behavior
```

---

## Task 8: Keyboard accessibility

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/style.css`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Make headers focusable

In `buildEditableRuleCard`:

```ts
  header.tabIndex = 0;
  header.setAttribute("role", "button");
  header.setAttribute("aria-expanded", "false");
```

### Step 2: Handle keydown on the container

```ts
function handleContainerKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = e.target as HTMLElement;
  if (!target.classList.contains("edit-header")) return;
  e.preventDefault();
  const card = target.closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  const index = Number(card.dataset.ruleIndex);
  toggleCardExpansion(card, index);
}
```

Register in `renderEditableRules`, remove in `clearEditor`.

### Step 3: Update `aria-expanded` in `toggleCardExpansion`

### Step 4: CSS focus ring

```css
.edit-header:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
  border-radius: 4px;
}
```

### Step 5: Test, build, lint, commit

```
feat: keyboard accessibility for accordion expand/collapse (Enter/Space)
```

---

## Task 9: Final verification

### Step 1: Run full test suite

Run: `npm run build && npm test && npm run lint`

### Step 2: Manual browser verification

1. Load large .hsf, enter edit mode
2. Verify collapsed cards with summary text
3. DevTools: DOM node count ~1.5K per page (vs ~97K before)
4. Click header to expand/collapse
5. Edit fields, verify summary updates
6. Drag-and-drop collapsed cards
7. Page switch: all collapse
8. Go-to-rule: auto-expands
9. Keyboard: Tab + Enter to expand

### Expected improvement

Before: ~97,707 DOM nodes per page (100 fully-built cards)
After: ~1,600 DOM nodes per page (100 collapsed headers)
Reduction: **~98.4%** when all cards collapsed
