# Virtual Scrolling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce rendered DOM nodes from ~97,707 (100 cards at 100/page) to ~10-15 cards visible at any time. Only cards in or near the viewport are rendered; sentinel spacer elements maintain correct scroll height.

**Architecture:** A new `VirtualScroller` class manages a window of rendered cards within `#rules-container`. It uses an estimated-height model (one estimated height per card, refined to actual heights as cards are rendered and measured). A top spacer `<div>` and bottom spacer `<div>` fill the non-rendered regions. A `scroll` listener on `window` triggers re-evaluation of the visible range. The scroller is mode-agnostic: both `buildRuleCard` (view mode) and `buildEditableRuleCard` (edit mode) are passed as the card factory. Pagination coexists with virtual scrolling -- pagination determines which slice of rules is "active," and virtual scrolling virtualizes within that slice.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests. No external library dependencies.

---

## Key Design Decisions

1. **Estimated heights with measurement refinement.** Cards have variable height. Start with a default estimate (180px view, 350px edit), replace with actual measured height after first render.

2. **Pagination + virtual scrolling coexistence.** Pagination controls which slice of `filter.Rules` is displayed. Virtual scrolling virtualizes within that slice.

3. **`window` scroll listener.** The `#rules-container` has no overflow/scroll styles -- the page body scrolls. The scroll listener is on `window`. Visibility uses `container.getBoundingClientRect()` relative to viewport.

4. **Overscan buffer.** Render 5 extra cards above and below visible range to prevent flicker during fast scrolling.

5. **Drag-and-drop compatibility.** Drag events delegate to `#rules-container` and use `data-rule-index`. Spacer divs don't contain `.edit-card` elements, so drops into spacer zones are no-ops.

6. **`goToRule(index)` integration.** Forces the target card into the rendered range.

7. **Card height changes.** `ResizeObserver` on rendered cards updates the height map and recalculates spacers.

8. **jsdom test limitations.** Tests use injectable `getViewport`/`getContainerOffset` options for mock geometry.

---

## Task 1: Create the VirtualScroller class

**Files:**
- Create: `packages/web/src/virtual-scroller.ts`
- Create: `packages/web/src/__tests__/virtual-scroller.test.ts`

### Step 1: Write failing tests

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { VirtualScroller } from "../virtual-scroller.js";

function setupDOM(): void {
  document.body.innerHTML =
    '<div id="rules-pagination" hidden></div>' +
    '<div id="rules-container"></div>' +
    '<div id="rules-pagination-bottom" hidden></div>';
}

describe("VirtualScroller", () => {
  beforeEach(setupDOM);

  it("creates top and bottom spacer divs", () => {
    const container = document.getElementById("rules-container")!;
    const scroller = new VirtualScroller({
      container, totalCount: 10, defaultItemHeight: 100, overscan: 2,
      buildItem: () => document.createElement("div"),
      getViewport: () => ({ top: 0, bottom: 600 }),
    });
    scroller.attach();
    expect(container.querySelector(".vs-spacer-top")).not.toBeNull();
    expect(container.querySelector(".vs-spacer-bottom")).not.toBeNull();
  });

  it("only renders cards within the visible range", () => {
    const container = document.getElementById("rules-container")!;
    const built: number[] = [];
    const scroller = new VirtualScroller({
      container, totalCount: 50, defaultItemHeight: 100, overscan: 2,
      buildItem: (i) => { built.push(i); const el = document.createElement("div"); el.className = "rule-card"; el.dataset.ruleIndex = String(i); return el; },
      getViewport: () => ({ top: 0, bottom: 600 }),
    });
    scroller.attach();
    expect(built.length).toBeLessThan(50);
    expect(built.length).toBeLessThanOrEqual(10);
  });

  it("updates estimated height after measurement", () => {
    const container = document.getElementById("rules-container")!;
    const scroller = new VirtualScroller({
      container, totalCount: 10, defaultItemHeight: 100, overscan: 0,
      buildItem: () => { const el = document.createElement("div"); el.className = "rule-card"; return el; },
      getViewport: () => ({ top: 0, bottom: 600 }),
    });
    scroller.attach();
    scroller.updateItemHeight(0, 150);
    expect(scroller.getItemHeight(0)).toBe(150);
    expect(scroller.getItemHeight(5)).toBe(100);
  });

  it("scrollToIndex forces target into rendered range", () => {
    const container = document.getElementById("rules-container")!;
    const scroller = new VirtualScroller({
      container, totalCount: 100, defaultItemHeight: 100, overscan: 2,
      buildItem: (i) => { const el = document.createElement("div"); el.className = "rule-card"; el.id = `rule-${i+1}`; el.dataset.ruleIndex = String(i); return el; },
      getViewport: () => ({ top: 0, bottom: 600 }),
    });
    scroller.attach();
    expect(container.querySelector("#rule-51")).toBeNull();
    scroller.scrollToIndex(50);
    expect(container.querySelector("#rule-51")).not.toBeNull();
  });

  it("destroy removes spacers and clears container", () => {
    const container = document.getElementById("rules-container")!;
    const scroller = new VirtualScroller({
      container, totalCount: 10, defaultItemHeight: 100, overscan: 2,
      buildItem: () => document.createElement("div"),
      getViewport: () => ({ top: 0, bottom: 600 }),
    });
    scroller.attach();
    scroller.destroy();
    expect(container.children.length).toBe(0);
  });
});
```

### Step 2: Implement VirtualScroller

Core interface:

```ts
export interface VirtualScrollerOptions {
  container: HTMLElement;
  totalCount: number;
  defaultItemHeight: number;
  overscan: number;
  buildItem: (index: number) => HTMLElement;
  getViewport: () => { top: number; bottom: number };
  getContainerOffset?: () => number;
}

export class VirtualScroller {
  // - Manages top/bottom spacer divs
  // - Maintains a height map (measured heights replace defaults)
  // - Tracks renderedStart/renderedEnd range
  // - Listens to window scroll/resize (via rAF)
  // - ResizeObserver on rendered cards (guarded for jsdom)
  // - update() computes visible range and calls renderRange()
  // - renderRange() adds/removes cards and updates spacers
  // - scrollToIndex() forces target into range
  // - destroy() cleans up everything
}
```

### Step 3: Run tests, build, lint, commit

```
feat: add VirtualScroller class with height estimation and overscan
```

---

## Task 2: Integrate into renderCurrentPage

**Files:**
- Modify: `packages/web/src/render.ts`

### Step 1: Add module-level scroller reference

```ts
import { VirtualScroller } from "./virtual-scroller.js";

let activeScroller: VirtualScroller | null = null;
```

### Step 2: Replace the card rendering loop in `renderCurrentPage`

```ts
// Tear down previous scroller
if (activeScroller) { activeScroller.destroy(); activeScroller = null; }

const container = document.getElementById("rules-container")!;
container.innerHTML = "";

const isEditMode = currentCardBuilder !== buildRuleCard;
const defaultHeight = isEditMode ? 350 : 180;

activeScroller = new VirtualScroller({
  container,
  totalCount: pageItemCount,
  defaultItemHeight: defaultHeight,
  overscan: 5,
  buildItem: (localIndex) => currentCardBuilder(rules[start + localIndex], start + localIndex),
  getViewport: () => ({ top: window.scrollY, bottom: window.scrollY + window.innerHeight }),
});
activeScroller.attach();
```

### Step 3: Modify `goToRule` to use scroller

```ts
if (activeScroller) {
  const localIndex = ruleIndex - currentPage * pageSize;
  const card = activeScroller.scrollToIndex(localIndex);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("rule-matched");
  }
}
```

### Step 4: Destroy scroller in `clearViewer`

### Step 5: Export `getActiveScroller()` for editor module

### Step 6: Run tests, build, lint, commit

```
feat: integrate VirtualScroller into renderCurrentPage
```

---

## Task 3: Add CSS for spacer elements

**Files:**
- Modify: `packages/web/src/style.css`

```css
.vs-spacer-top,
.vs-spacer-bottom {
  width: 100%;
  flex-shrink: 0;
  pointer-events: none;
}
```

### Commit

```
style: add spacer div styles for virtual scrolling
```

---

## Task 4: Handle card height changes (ResizeObserver)

**Files:**
- Modify: `packages/web/src/virtual-scroller.ts`
- Modify: `packages/web/src/__tests__/virtual-scroller.test.ts`

### Step 1: Add test for graceful degradation without ResizeObserver

```ts
it("does not crash when ResizeObserver is unavailable", () => {
  // jsdom lacks ResizeObserver; scroller should work without it
  const scroller = new VirtualScroller({ ... });
  expect(() => scroller.attach()).not.toThrow();
  scroller.destroy();
});
```

The implementation already guards with `typeof ResizeObserver !== "undefined"`.

### Step 2: Run tests, commit

```
test: verify VirtualScroller degrades gracefully without ResizeObserver
```

---

## Task 5: Wire goToRule and test result links

**Files:**
- Modify: `packages/web/src/__tests__/virtual-render.test.ts`

### Step 1: Test that goToRule renders out-of-viewport cards

```ts
it("renders a card that was not initially in the viewport", async () => {
  const { renderPaginatedCards, goToRule } = await import("../render.js");
  const filter = makeFilter(100);
  renderPaginatedCards(filter, cardBuilder);
  expect(container.querySelector("#rule-81")).toBeNull();
  goToRule(80);
  expect(container.querySelector("#rule-81")).not.toBeNull();
});
```

### Step 2: Run tests, commit

```
test: verify goToRule forces rendering of out-of-viewport cards
```

---

## Task 6: Verify editor test compatibility

**Files:**
- Modify: `packages/web/src/__tests__/editor.test.ts` (if needed)

### Step 1: Run existing editor tests

Small filters (2-3 rules) fit in the mock viewport, so all cards are rendered. Existing tests should pass without modification.

### Step 2: Add verification test

```ts
it("renders all cards when filter is small", () => {
  const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
  renderEditableRules(filter, noopCallbacks());
  expect(container.querySelectorAll(".edit-card").length).toBe(3);
});
```

### Step 3: Run tests, commit

```
test: verify editor tests are compatible with virtual scrolling
```

---

## Task 7: Handle window resize

### Step 1: Test resize recalculation

```ts
it("recalculates range when viewport changes", () => {
  let viewportHeight = 600;
  const scroller = new VirtualScroller({
    ..., getViewport: () => ({ top: 0, bottom: viewportHeight }),
  });
  scroller.attach();
  const count1 = scroller.getRenderedRange().end - scroller.getRenderedRange().start;

  viewportHeight = 300;
  scroller.update();
  const count2 = scroller.getRenderedRange().end - scroller.getRenderedRange().start;
  expect(count2).toBeLessThan(count1);
});
```

### Step 2: Run tests, commit

```
test: verify resize recalculates virtual scroll range
```

---

## Task 8: Add user setting toggle

**Files:**
- Modify: `packages/web/src/settings.ts`
- Modify: `packages/web/src/settings-modal.ts`
- Modify: `packages/web/src/render.ts`

### Step 1: Add `virtualScrolling: boolean` to UserSettings (default: `true`)

### Step 2: Add checkbox to settings modal

### Step 3: Respect setting in renderCurrentPage

```ts
const settings = getSettings();
if (settings.virtualScrolling && pageItemCount > 20) {
  // Use VirtualScroller
} else {
  // Original direct render
  for (let i = start; i < end; i++) {
    container.appendChild(currentCardBuilder(rules[i], i));
  }
}
```

### Step 4: Run tests, build, lint, commit

```
feat: add virtual scrolling toggle to user settings
```

---

## Task 9: Final integration testing

### Run full suite

Run: `npm run build && npm test && npm run lint`

### Manual testing checklist

1. Load large .hsf — cards render progressively
2. Scroll — cards appear smoothly
3. Go-to-rule #500 — renders and scrolls to card
4. Enter edit mode — virtual scrolling applies
5. Toggle set-selector panel — height change doesn't break scroll
6. Drag-and-drop — works on visible cards
7. Change page size 50/500 — scroller adapts
8. Toggle off in Settings — reverts to direct render
9. DevTools: DOM node count stays flat while scrolling

### Expected improvement

Before: ~97,707 DOM nodes (100 cards rendered)
After: ~15,000-20,000 DOM nodes (10-15 cards rendered + spacers)
Reduction: **~80-85%**

---

## Potential Challenges

1. **Scroll jumping.** When estimated heights are inaccurate, replacing with measurements can shift scroll position. Mitigate with `scrollBy` correction after spacer updates.

2. **Drag across spacer zones.** No `.edit-card` in spacers = drop is a no-op. Acceptable degradation — move-up/down buttons provide an alternative.

3. **jsdom limitations.** `getBoundingClientRect()` returns zeros. Mitigated by injectable `getViewport` and `getContainerOffset` options.

4. **Memory savings.** At ~60 DOM nodes/edit card: 100→15 cards = ~5,100→~900 card nodes. With text nodes and options, actual savings are larger.
