# Shared Dropdown Panels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-card `<select>` elements in editor mode with custom dropdown trigger buttons that share a single floating option list panel per field type. This eliminates ~20,400 DOM nodes per page (100 cards) by removing redundant `<option>` elements that are cloned identically across every card.

**Architecture:** Each field type (rank, rarity, main-stat, level, faction, substat-stat) shares one floating panel element appended to `<body>`. When a trigger button is clicked, the panel is positioned below the trigger via `position: fixed`, populated with highlight state for the current value, and shown. Selecting an option closes the panel, updates the trigger's display text, and fires rule-mutation logic. The existing event delegation on `#rules-container` is extended with a new `data-action="open-dropdown"` case. The `SharedDropdown` class owns its own click-outside and keyboard handlers — no changes to the global click-outside handler in `main.ts`.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests. Follows the same delegation and `data-*` attribute conventions established by the event delegation refactor.

**Ordering note:** This plan is independent of the virtual scrolling and lazy card bodies plans. If combined with the template cloning plan, whichever is implemented second must account for the other's DOM changes (buttons vs selects in the template). Implement this plan first OR adjust the template cloning plan to build buttons instead of selects.

---

## Background

### Current State

Each edit card renders 13 `<select>` elements with their full `<option>` children:

| Field | `<option>` count | Cards/page | Total `<option>` elements |
|---|---|---|---|
| rank | 3 | 100 | 300 |
| rarity | 5 | 100 | 500 |
| main-stat | 12 | 100 | 1,200 |
| level | 17 | 100 | 1,700 |
| faction | 17 | 100 | 1,700 |
| 4x substat stat | 12 each (48) | 100 | 4,800 |
| 4x substat cond | 5 each (20) | 100 | 2,000 |
| **Totals** | **122 per card** | | **12,200 `<option>` elements** |

Each `<option>` is 1 element + 1 text node = 2 DOM nodes. Total: **24,400 DOM nodes** from options. Plus 1,300 `<select>` elements = **25,700 DOM nodes** from select widgets per page.

### Design Decisions

1. **Condition selects stay native.** The 4 condition dropdowns (`>=`, `>`, `=`, `<=`, `<`) have only 5 options each. Converting them yields only ~1,600 fewer nodes — not worth the UI tradeoff.

2. **One shared panel per field type** (6 total: rank, rarity, main-stat, level, faction, substat-stat). Panels are appended to `<body>` so `overflow: hidden` on cards doesn't clip them.

3. **Panels use `position: fixed` + `getBoundingClientRect()`** for positioning.

4. **Keyboard and screen-reader accessibility.** Trigger buttons are focusable `<button>` elements with `aria-haspopup="listbox"` and `aria-expanded`. Panel has `role="listbox"`, items have `role="option"`. Panel supports arrow keys, Enter, Escape. Arrow-key navigation scrolls the active item into view for long option lists.

5. **Click-outside is owned by `SharedDropdown` class.** Each instance registers its own `document` click listener. No changes needed to the existing global handler in `main.ts` (which handles `.set-selector-panel` only).

6. **Substat stat selects share one panel.** All 4 per card have identical options.

7. **Callback passed to `open()`, not mutated on the instance.** Avoids fragile `onSelect` property reassignment.

8. **Viewport-aware positioning.** Panel flips above the trigger when there's insufficient space below (trigger near bottom of viewport).

9. **Close on scroll.** If the page scrolls while a panel is open, the panel closes to avoid visual disconnect between the fixed-position panel and the scrolled-away trigger.

10. **Lazy initialization.** Shared dropdowns are created once and survive across re-renders. Only `clearEditor()` destroys them. This avoids unnecessary create/destroy churn on every delete/move/add action (which each trigger a re-render).

11. **Close on page switch via `beforePageRender` callback.** Pagination controls in `render.ts` call `renderCurrentPage()` directly (prev/next, page-size change, `goToRule`). Since `render.ts` cannot import from `editor.ts` (circular dependency), `renderPaginatedCards` accepts an optional `beforePageRender` callback that `renderCurrentPage` invokes before clearing `container.innerHTML`. The editor passes `closeAllDropdowns` as this callback, ensuring open panels are closed before their trigger buttons are destroyed.

### Savings (excluding condition selects)

| Field | Options saved/card | x 100 | Nodes saved (x2) |
|---|---|---|---|
| rank | 3 | 300 | 600 |
| rarity | 5 | 500 | 1,000 |
| main-stat | 12 | 1,200 | 2,400 |
| level | 17 | 1,700 | 3,400 |
| faction | 17 | 1,700 | 3,400 |
| 4x substat stat | 48 | 4,800 | 9,600 |
| **Total** | **102/card** | **10,200** | **20,400 nodes** |

---

## Task 1: Create the SharedDropdown module

Build a standalone `SharedDropdown` class that manages a single floating panel element.

**Files:**
- Create: `packages/web/src/shared-dropdown.ts`
- Create: `packages/web/src/__tests__/shared-dropdown.test.ts`

### Step 1: Write failing tests

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SharedDropdown } from "../shared-dropdown.js";
import type { DropdownOption } from "../shared-dropdown.js";

const OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  { value: "5", label: "5-star" },
  { value: "6", label: "6-star" },
];

describe("SharedDropdown", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="container"><button id="trigger">Pick</button></div>';
  });

  it("creates a panel element appended to body", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    expect(document.querySelector(".shared-dropdown-panel")).not.toBeNull();
    dd.destroy();
  });

  it("is hidden by default", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.classList.contains("open")).toBe(false);
    dd.destroy();
  });

  it("opens below trigger and shows options", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5", onSelect);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.classList.contains("open")).toBe(true);
    expect(panel.querySelectorAll(".shared-dropdown-item").length).toBe(3);
    dd.destroy();
  });

  it("has correct ARIA attributes", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.getAttribute("role")).toBe("listbox");

    const trigger = document.getElementById("trigger")!;
    dd.open(trigger, "5", vi.fn());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const items = panel.querySelectorAll(".shared-dropdown-item");
    for (const item of items) {
      expect(item.getAttribute("role")).toBe("option");
    }

    dd.close();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    dd.destroy();
  });

  it("highlights the current value", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5", vi.fn());
    const active = document.querySelector(".shared-dropdown-item.active");
    expect(active!.textContent).toBe("5-star");
    dd.destroy();
  });

  it("fires onSelect callback when item clicked", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", onSelect);
    (document.querySelectorAll(".shared-dropdown-item")[2] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("6");
    dd.destroy();
  });

  it("closes on Escape", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("navigates with arrow keys", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    const items = document.querySelectorAll(".shared-dropdown-item");
    expect(items[0].classList.contains("active")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(items[1].classList.contains("active")).toBe(true);
    dd.destroy();
  });

  it("selects on Enter", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", onSelect);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("5");
    dd.destroy();
  });

  it("click outside closes panel", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    document.body.click();
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("closes on scroll", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    expect(document.querySelector(".shared-dropdown-panel.open")).not.toBeNull();
    window.dispatchEvent(new Event("scroll"));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("destroys and removes panel from DOM", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.destroy();
    expect(document.querySelector(".shared-dropdown-panel")).toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/shared-dropdown.test.ts`

### Step 3: Implement `SharedDropdown`

```ts
// packages/web/src/shared-dropdown.ts
export interface DropdownOption {
  value: string;
  label: string;
}

export class SharedDropdown {
  private panel: HTMLElement;
  private options: DropdownOption[];
  private currentTrigger: HTMLElement | null = null;
  private currentCallback: ((value: string) => void) | null = null;
  private activeIndex = 0;

  constructor(fieldType: string, options: DropdownOption[]) {
    this.options = options;
    this.panel = document.createElement("div");
    this.panel.className = "shared-dropdown-panel";
    this.panel.dataset.fieldType = fieldType;
    this.panel.setAttribute("role", "listbox");
    // Delegation: single click handler on panel, reads data-value
    this.panel.addEventListener("click", this.handlePanelClick);
    document.body.appendChild(this.panel);
    document.addEventListener("click", this.handleClickOutside);
  }

  open(
    trigger: HTMLElement,
    currentValue: string,
    onSelect: (value: string) => void,
  ): void {
    this.currentTrigger = trigger;
    this.currentCallback = onSelect;
    this.activeIndex = Math.max(
      0,
      this.options.findIndex((o) => o.value === currentValue),
    );
    this.panel.innerHTML = "";
    for (const [idx, opt] of this.options.entries()) {
      const item = document.createElement("div");
      item.className =
        "shared-dropdown-item" + (idx === this.activeIndex ? " active" : "");
      item.textContent = opt.label;
      item.dataset.value = opt.value;
      item.setAttribute("role", "option");
      this.panel.appendChild(item);
    }
    // Viewport-aware positioning: flip above trigger if insufficient space below
    const rect = trigger.getBoundingClientRect();
    const maxPanelHeight = 300; // matches CSS max-height
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const flipAbove = spaceBelow < maxPanelHeight && rect.top > spaceBelow;
    this.panel.style.position = "fixed";
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.minWidth = `${rect.width}px`;
    if (flipAbove) {
      this.panel.style.top = "";
      this.panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      this.panel.style.bottom = "";
      this.panel.style.top = `${rect.bottom + 4}px`;
    }
    this.panel.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    // Register keyboard and scroll listeners only while open
    document.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("scroll", this.handleScroll, true);
  }

  close(): void {
    this.panel.classList.remove("open");
    this.panel.innerHTML = "";
    this.currentTrigger?.setAttribute("aria-expanded", "false");
    this.currentTrigger?.focus();
    this.currentTrigger = null;
    this.currentCallback = null;
    // Remove listeners that are only needed while open
    document.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("scroll", this.handleScroll, true);
  }

  private select(value: string): void {
    const cb = this.currentCallback;
    this.close();
    cb?.(value);
  }

  private handlePanelClick = (e: MouseEvent): void => {
    const item = (e.target as Element).closest(".shared-dropdown-item") as HTMLElement | null;
    if (item?.dataset.value != null) {
      e.stopPropagation(); // prevent click-outside from also firing
      this.select(item.dataset.value);
    }
  };

  // Registered on document only while the panel is open (in open/close)
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.options.length;
      this.updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex =
        (this.activeIndex - 1 + this.options.length) % this.options.length;
      this.updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.select(this.options[this.activeIndex].value);
    }
  };

  private handleScroll = (): void => {
    this.close();
  };

  private updateActive(): void {
    this.panel
      .querySelectorAll(".shared-dropdown-item")
      .forEach((item, idx) => {
        item.classList.toggle("active", idx === this.activeIndex);
        if (idx === this.activeIndex) {
          (item as HTMLElement).scrollIntoView({ block: "nearest" });
        }
      });
  }

  private handleClickOutside = (e: MouseEvent): void => {
    if (!this.panel.classList.contains("open")) return;
    if (
      !this.panel.contains(e.target as Node) &&
      !this.currentTrigger?.contains(e.target as Node)
    ) {
      this.close();
    }
  };

  destroy(): void {
    // Close first to clean up keyboard/scroll listeners if open
    if (this.panel.classList.contains("open")) this.close();
    this.panel.removeEventListener("click", this.handlePanelClick);
    document.removeEventListener("click", this.handleClickOutside);
    this.panel.remove();
  }
}
```

Key design notes:
- **`open()` takes `onSelect` as third parameter** instead of mutable `onSelect` property
- **Panel uses delegated click handler** (`handlePanelClick` reads `data-value`) instead of per-item `addEventListener`
- **`e.stopPropagation()`** in panel click prevents `handleClickOutside` from also firing
- **`select()` calls `close()` before invoking callback** so the panel is gone if the callback triggers re-rendering. **Note:** `close()` calls `focus()` on the trigger, which is safe as long as callbacks only fire `onRuleChange` (trigger persists). If a future callback triggers a full re-render (e.g. `onRuleDelete`), the focused trigger would be a detached node — harmless but worth noting if extending this pattern
- **ARIA attributes:** `role="listbox"` on panel, `role="option"` on items, `aria-expanded` toggled on trigger
- **Keyboard and scroll listeners registered only while open** — avoids 6 document-level keydown checks per keystroke when all panels are closed
- **Viewport-aware positioning:** flips panel above trigger when insufficient space below
- **Scroll closes panel:** prevents fixed-position panel from floating away from scrolled-away trigger
- **`scrollIntoView({ block: "nearest" })`** on arrow-key navigation for long option lists (faction has 20+ entries)

### Step 4: Run tests, build, lint, commit

Run: `npm run build && npm test && npm run lint`

```
feat: add SharedDropdown component for reusable floating option panels
```

---

## Task 2: Create shared dropdown instances and option arrays in editor.ts

Initialize one `SharedDropdown` per converted field type. Define all option arrays explicitly. Wire dropdown close into page switches.

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/main.ts` (call `closeAllDropdowns` before `renderEditableRules`)

### Step 1: Add imports

```ts
import { SharedDropdown } from "./shared-dropdown.js";
import type { DropdownOption } from "./shared-dropdown.js";
```

### Step 2: Define option arrays

Add these after the existing `CONDITION_OPTIONS` constant (~line 47):

```ts
const RANK_OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  { value: "5", label: "5-star" },
  { value: "6", label: "6-star" },
];

const RARITY_OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  ...Object.entries(HSF_RARITY_IDS).map(([id, name]) => ({
    value: id,
    label: name,
  })),
];

// Main stat uses the same stat list as substats, with "Any" prepended
const MAIN_STAT_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: "-1", label: "Any" },
  ...SUBSTAT_OPTIONS,
];

const LEVEL_OPTIONS: DropdownOption[] = Array.from({ length: 17 }, (_, i) => ({
  value: String(i),
  label: String(i),
}));

const FACTION_OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  ...Object.entries(FACTION_NAMES).map(([id, name]) => ({
    value: id,
    label: name,
  })),
];

// Substat stat dropdown — "None" + all stat variants
const SUBSTAT_STAT_DROPDOWN_OPTIONS: DropdownOption[] = [
  { value: "-1", label: "None" },
  ...SUBSTAT_OPTIONS,
];
```

### Step 3: Add dropdown lifecycle functions

```ts
let sharedDropdowns: Record<string, SharedDropdown> = {};

/** Lazy-init: create shared dropdowns once, survive across re-renders. */
function initDropdowns(): void {
  if (Object.keys(sharedDropdowns).length > 0) return; // already initialized
  sharedDropdowns = {
    rank: new SharedDropdown("rank", RANK_OPTIONS),
    rarity: new SharedDropdown("rarity", RARITY_OPTIONS),
    "main-stat": new SharedDropdown("main-stat", MAIN_STAT_DROPDOWN_OPTIONS),
    level: new SharedDropdown("level", LEVEL_OPTIONS),
    faction: new SharedDropdown("faction", FACTION_OPTIONS),
    "substat-stat": new SharedDropdown("substat-stat", SUBSTAT_STAT_DROPDOWN_OPTIONS),
  };
}

/** Close any open dropdown panel (e.g. on page switch). */
export function closeAllDropdowns(): void {
  for (const dd of Object.values(sharedDropdowns)) dd.close();
}

function destroyDropdowns(): void {
  for (const dd of Object.values(sharedDropdowns)) dd.destroy();
  sharedDropdowns = {};
}
```

### Step 4: Call `initDropdowns()` from `renderEditableRules`

Add `initDropdowns();` at the start of `renderEditableRules`, before `renderPaginatedCards`. This is a lazy init — the first call creates the 6 instances, subsequent calls (from delete/move/add re-renders) are no-ops.

### Step 5: Call `destroyDropdowns()` from `clearEditor`

Add `destroyDropdowns();` at the start of `clearEditor`.

### Step 6: Close open dropdowns on page switch and re-render

Open dropdowns must close in two scenarios: (a) when `main.ts` triggers a full re-render (delete, move, add), and (b) when the user switches pages via pagination controls inside `render.ts`. Scenario (b) is the tricky one — `renderCurrentPage()` is called directly by pagination (prev/next, page-size, `goToRule`) and destroys all trigger buttons via `container.innerHTML = ""`, but the floating panel (on `<body>`) would remain as an orphan.

**Scenario (a) — full re-render from main.ts:**

```ts
// In main.ts, import closeAllDropdowns from editor:
import { renderEditableRules, clearEditor, closeAllDropdowns } from "./editor.js";

// In the showViewerContent callback block, before renderEditableRules:
closeAllDropdowns();
renderEditableRules(tab.filter, { ... });
```

**Scenario (b) — pagination page switches in render.ts:**

Since `render.ts` cannot import from `editor.ts` (circular dependency), add a `beforePageRender` callback to `renderPaginatedCards`:

```ts
// In render.ts, add module-level state:
let beforePageRender: (() => void) | null = null;

// Update renderPaginatedCards signature:
export function renderPaginatedCards(
  filter: HsfFilter,
  cardBuilder: (rule: HsfRule, index: number) => HTMLElement,
  resetPage = false,
  onBeforePageRender?: () => void,
): void {
  // ...existing code...
  beforePageRender = onBeforePageRender ?? null;
  renderCurrentPage();
}

// At the top of renderCurrentPage, before container.innerHTML = "":
function renderCurrentPage(): void {
  if (!currentFilter) return;
  beforePageRender?.();
  // ...existing abort + render logic...
}
```

In `editor.ts`, pass `closeAllDropdowns` as the callback:

```ts
renderPaginatedCards(
  filter,
  (rule, i) => buildEditableRuleCard(rule, i, total),
  false,
  closeAllDropdowns,
);
```

This keeps the dependency direction clean: `editor.ts → render.ts` (no reverse import).

### Step 7: Run tests, build, lint, commit

Run: `npm run build && npm test && npm run lint`

```
feat: create shared dropdown instances for 6 field types in editor
```

---

## Task 3: Convert card builders to use trigger buttons

Replace `<select>` elements with `<button>` triggers for the 9 targeted fields (rank, rarity, main-stat, level, faction, 4x substat stat). Condition selects stay native.

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Add `buildTriggerButton` helper

Replace `buildSelectField` with a trigger button builder:

```ts
function buildTriggerButton(
  fieldName: string,
  currentValue: string,
  label: string,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "edit-dropdown-trigger";
  btn.dataset.action = "open-dropdown";
  btn.dataset.field = fieldName;
  btn.dataset.value = currentValue;
  btn.textContent = label;
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  return btn;
}
```

Add a label-lookup helper used by both builders and selection handlers. The lookup map is module-level to avoid re-creating it on every call (~900 calls per page render):

```ts
const OPTION_ARRAYS: Record<string, DropdownOption[]> = {
  rank: RANK_OPTIONS,
  rarity: RARITY_OPTIONS,
  "main-stat": MAIN_STAT_DROPDOWN_OPTIONS,
  level: LEVEL_OPTIONS,
  faction: FACTION_OPTIONS,
  "substat-stat": SUBSTAT_STAT_DROPDOWN_OPTIONS,
};

function getLabelForValue(fieldType: string, value: string): string {
  const opts = OPTION_ARRAYS[fieldType];
  return opts?.find((o) => o.value === value)?.label ?? value;
}
```

### Step 2: Add value-encoding helpers

These encode the current rule state into the string values used by `SUBSTAT_OPTIONS` and `MAIN_STAT_DROPDOWN_OPTIONS` (format: `"statId:flatFlag"` or `"-1"` for none):

```ts
function encodeMainStat(rule: HsfRule): string {
  if (rule.MainStatID === -1) return "-1";
  // MainStatF=1 means percent (flatFlag=0), MainStatF=0 means flat (flatFlag=1)
  return `${rule.MainStatID}:${rule.MainStatF === 1 ? 0 : 1}`;
}

function encodeSubstatValue(sub: { ID: number; IsFlat: boolean }): string {
  if (sub.ID === -1) return "-1";
  return `${sub.ID}:${sub.IsFlat ? 1 : 0}`;
}
```

### Step 3: Replace field builders in `buildEditableRuleCard`

Replace the `buildSelectField` calls and `buildMainStatField` call with trigger-field builders:

```ts
// Replace:  body.appendChild(buildSelectField("Rank", "rank", rule.Rank, [...]))
// With:
body.appendChild(buildTriggerField("Rank", "rank", String(rule.Rank)));

// Replace:  body.appendChild(buildSelectField("Rarity", "rarity", rule.Rarity, rarityOpts))
// With:
body.appendChild(buildTriggerField("Rarity", "rarity", String(rule.Rarity)));

// Replace:  body.appendChild(buildMainStatField(rule))
// With:
body.appendChild(buildTriggerField("Main Stat", "main-stat", encodeMainStat(rule)));

// Replace:  body.appendChild(buildSelectField("Level", "level", rule.LVLForCheck, levelOpts))
// With:
body.appendChild(buildTriggerField("Level", "level", String(rule.LVLForCheck)));

// Replace:  body.appendChild(buildSelectField("Faction", "faction", rule.Faction, factionOpts))
// With:
body.appendChild(buildTriggerField("Faction", "faction", String(rule.Faction)));
```

Where `buildTriggerField` wraps the label + button:

```ts
function buildTriggerField(
  labelText: string,
  fieldName: string,
  currentValue: string,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";

  const label = document.createElement("label");
  label.textContent = labelText;
  field.appendChild(label);

  field.appendChild(
    buildTriggerButton(fieldName, currentValue, getLabelForValue(fieldName, currentValue)),
  );

  return field;
}
```

### Step 4: Replace substat stat `<select>` with trigger button

In `buildSubstatRow`, replace the stat `<select>` with:

```ts
const statTrigger = buildTriggerButton(
  "substat-stat",
  encodeSubstatValue(sub),
  sub.ID === -1 ? "None" : getLabelForValue("substat-stat", encodeSubstatValue(sub)),
);
statTrigger.className = "edit-sub-stat edit-dropdown-trigger";
statTrigger.dataset.subIndex = String(subIndex);
row.appendChild(statTrigger);
```

Note: the trigger keeps `edit-sub-stat` class so existing CSS layout works. It also gets `data-sub-index` so the selection handler knows which substat row it belongs to.

### Step 5: Remove dead code

Remove these functions and constants, which are replaced by the new trigger-based equivalents from Steps 1–2:

- `buildSelectField` (line 475) — replaced by `buildTriggerButton` + `buildTriggerField`
- `buildMainStatField` (line 514) — replaced by `buildTriggerField("Main Stat", ...)`
- `encodeMainStat` (line 508) — replaced by new version in Step 2
- `encodeSubstatValue` (line 685) — replaced by new version in Step 2
- `MAIN_STAT_OPTIONS` (line 506) — replaced by `MAIN_STAT_DROPDOWN_OPTIONS`
- `rarityOpts`, `levelOpts`, `factionOpts` local variables in `buildEditableRuleCard`
- Remove `esc` from the import `{ esc, getCurrentFilter, renderPaginatedCards }` if `buildSelectField` was its only caller in `editor.ts` (lint will flag unused imports, but clean it up here)

### Step 6: Run build to verify compilation

Run: `npm run build`

Do NOT commit yet — tests will fail until delegation wiring (Task 4) and test updates (Task 5) are done. Tasks 3–5 are committed together at the end of Task 5.

---

## Task 4: Wire delegation for trigger clicks and option selection

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Add `open-dropdown` case to `handleContainerClick`

Add to the `switch` statement in `handleContainerClick` (after the `set-toggle` case):

```ts
case "open-dropdown": {
  const fieldType = action.dataset.field!;
  const currentValue = action.dataset.value ?? "-1";
  const dropdown = sharedDropdowns[fieldType];
  if (!dropdown) break;
  // Close any other open panel before opening a new one
  closeAllDropdowns();
  dropdown.open(action, currentValue, (newValue) => {
    handleDropdownSelection(card, index, action, fieldType, newValue);
  });
  break;
}
```

### Step 2: Implement `handleDropdownSelection`

Full implementation with complete substat-stat logic:

```ts
function handleDropdownSelection(
  card: HTMLElement,
  ruleIndex: number,
  trigger: HTMLElement,
  fieldType: string,
  value: string,
): void {
  const filter = getCurrentFilter();
  if (!filter || !currentCallbacks) return;
  const rule = filter.Rules[ruleIndex];

  switch (fieldType) {
    case "rank":
      rule.Rank = Number(value);
      break;
    case "rarity":
      rule.Rarity = Number(value);
      break;
    case "level":
      rule.LVLForCheck = Number(value);
      break;
    case "faction":
      rule.Faction = Number(value);
      break;
    case "main-stat": {
      if (value === "-1") {
        rule.MainStatID = -1;
        rule.MainStatF = 1;
      } else {
        const [statId, flatFlag] = value.split(":").map(Number);
        rule.MainStatID = statId;
        rule.MainStatF = flatFlag === 1 ? 0 : 1;
      }
      break;
    }
    case "substat-stat": {
      const subIndex = Number(trigger.dataset.subIndex);
      const row = trigger.closest(".edit-substat-row") as HTMLElement;
      const condSelect = row.querySelector(".edit-sub-cond") as HTMLSelectElement;
      const valueInput = row.querySelector('input[type="number"]') as HTMLInputElement;

      if (value === "-1") {
        // Reset to empty substat
        rule.Substats[subIndex] = emptySubstat();
        condSelect.disabled = true;
        valueInput.disabled = true;
        condSelect.value = ">=";
        valueInput.value = "0";
      } else {
        const [statId, flatFlag] = value.split(":").map(Number);
        rule.Substats[subIndex] = {
          ...rule.Substats[subIndex],
          ID: statId,
          IsFlat: flatFlag === 1,
          NotAvailable: false,
          Condition: condSelect.value || ">=",
          Value: Number(valueInput.value) || 0,
        };
        condSelect.disabled = false;
        valueInput.disabled = false;
      }
      break;
    }
  }

  // Update trigger display text and stored value
  trigger.textContent = getLabelForValue(fieldType, value);
  trigger.dataset.value = value;
  currentCallbacks.onRuleChange(ruleIndex, rule);
}
```

### Step 3: Remove dead field-select handling from `handleContainerChange`

Remove the `data-field` block (lines 127-150) from `handleContainerChange`. This handled `rank`, `rarity`, `level`, `faction`, `main-stat` — all now handled by `handleDropdownSelection`.

Also remove the `edit-sub-stat` branch (lines 156-178) from the substat section of `handleContainerChange`. Keep the `edit-sub-cond` branch (lines 179-184) since condition selects remain native.

After removing the `edit-sub-stat` branch, the remaining substat block unconditionally calls `currentCallbacks.onRuleChange(index, rule)` (line 185) even when no branch matched. Guard it so `onRuleChange` only fires when `edit-sub-cond` actually handled the event.

The complete `handleContainerChange` after all removals:

```ts
function handleContainerChange(e: Event): void {
  const target = e.target as HTMLElement;
  const card = target.closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  const index = Number(card.dataset.ruleIndex);
  const filter = getCurrentFilter();
  if (!filter || !currentCallbacks) return;
  const rule = filter.Rules[index];

  // Substat condition changes (native <select>, kept as-is)
  const row = target.closest(".edit-substat-row") as HTMLElement | null;
  if (row) {
    const subIndex = Number(row.dataset.subIndex);
    if (target.classList.contains("edit-sub-cond")) {
      rule.Substats[subIndex] = {
        ...rule.Substats[subIndex],
        Condition: (target as HTMLSelectElement).value,
      };
      currentCallbacks.onRuleChange(index, rule);
    }
    return;
  }

  // Set checkboxes
  const actionAttr = (target as HTMLElement).dataset.action;
  if (actionAttr === "set-check") {
    const checkbox = target as HTMLInputElement;
    const setId = Number(checkbox.dataset.setId);
    let sets = rule.ArtifactSet ?? [];
    if (checkbox.checked) {
      sets.push(setId);
    } else {
      sets = sets.filter((s) => s !== setId);
    }
    rule.ArtifactSet = sets.length > 0 ? sets : undefined;
    const toggle = card.querySelector("[data-action='set-toggle']") as HTMLElement;
    toggle.textContent = summariseSets(sets);
    currentCallbacks.onRuleChange(index, rule);
    return;
  }

  // Slot checkboxes
  if (actionAttr === "slot-check") {
    const checkbox = target as HTMLInputElement;
    const slotId = Number(checkbox.dataset.slotId);
    let slots = rule.ArtifactType ?? [];
    if (checkbox.checked) {
      slots.push(slotId);
    } else {
      slots = slots.filter((s) => s !== slotId);
    }
    rule.ArtifactType = slots.length > 0 ? slots : undefined;
    currentCallbacks.onRuleChange(index, rule);
    return;
  }
}
```

After removal, `handleContainerChange` handles: substat condition changes, set checkboxes, and slot checkboxes. The `data-field` block and `edit-sub-stat` branch are gone — those mutations are now handled by `handleDropdownSelection`.

### Step 4: Run build to verify compilation

Run: `npm run build`

Do NOT commit yet — tests will fail until test updates in Task 5. Tasks 3–5 are committed together at the end of Task 5.

---

## Task 5: Update existing editor tests

**Files:**
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 0: Add `afterEach` cleanup to prevent listener leaks

The existing tests use `beforeEach(setupDOM)` which resets `document.body.innerHTML` — this removes dropdown panel elements from the DOM but does NOT clean up document-level event listeners from `SharedDropdown` instances.

First, add `clearEditor` to the imports at the top of the file:

```ts
// Before:
import { renderEditableRules } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";

// After:
import { renderEditableRules, clearEditor } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";
```

Then add an `afterEach` to the top-level `describe("editor", ...)` block:

```ts
afterEach(() => {
  clearEditor();
});
```

This ensures `destroyDropdowns()` is called between tests, properly removing all document-level `keydown` and `click` listeners.

### Step 1: Update "field selects have data-field" test (line 339-345)

The test currently expects `tagName` to be `SELECT`. Update:

```ts
// Before:
it("field selects have data-field", () => {
  const filter = makeFilter([defaultRule()]);
  renderEditableRules(filter, noopCallbacks());
  const rankField = document.querySelector("[data-field='rank']");
  expect(rankField).not.toBeNull();
  expect(rankField!.tagName).toBe("SELECT");
});

// After:
it("field triggers have data-field", () => {
  const filter = makeFilter([defaultRule()]);
  renderEditableRules(filter, noopCallbacks());
  const rankField = document.querySelector("[data-field='rank']");
  expect(rankField).not.toBeNull();
  expect(rankField!.tagName).toBe("BUTTON");
  expect((rankField as HTMLElement).dataset.action).toBe("open-dropdown");
});
```

### Step 2: Update "rank dropdown > pre-selects current rank value" test (line 269-288)

The test currently looks for a `<select>` inside the Rank field. Update to check `data-value` on the trigger button:

```ts
// Before:
it("pre-selects current rank value", () => {
  const rule = defaultRule({ Rank: 5 });
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());
  const fields = document.querySelectorAll(".edit-field");
  let rankSelect: HTMLSelectElement | null = null;
  for (const field of fields) {
    const label = field.querySelector("label");
    if (label?.textContent === "Rank") {
      rankSelect = field.querySelector("select");
      break;
    }
  }
  expect(rankSelect).not.toBeNull();
  expect(rankSelect!.value).toBe("5");
});

// After:
it("pre-selects current rank value", () => {
  const rule = defaultRule({ Rank: 5 });
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());
  const trigger = document.querySelector("[data-field='rank']") as HTMLElement;
  expect(trigger).not.toBeNull();
  expect(trigger.dataset.value).toBe("5");
  expect(trigger.textContent).toBe("5-star");
});
```

### Step 3: Update "substat editing > changing stat dropdown updates rule substat" test (line 196-216)

The test currently dispatches a `change` event on the `<select>`. Update to click the trigger button and then click an option in the shared dropdown panel:

```ts
// Before:
it("changing stat dropdown updates rule substat", () => {
  const rule = defaultRule();
  const filter = makeFilter([rule]);
  const changes: number[] = [];
  renderEditableRules(filter, noopCallbacks({
    onRuleChange(index) { changes.push(index); },
  }));
  const statSelects = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLSelectElement>;
  expect(statSelects.length).toBe(4);
  statSelects[0].value = "2:0";
  statSelects[0].dispatchEvent(new Event("change", { bubbles: true }));
  expect(rule.Substats[0].ID).toBe(2);
  expect(rule.Substats[0].IsFlat).toBe(false);
  expect(changes.length).toBe(1);
});

// After:
it("changing stat dropdown updates rule substat", () => {
  const rule = defaultRule();
  const filter = makeFilter([rule]);
  const changes: number[] = [];
  renderEditableRules(filter, noopCallbacks({
    onRuleChange(index) { changes.push(index); },
  }));
  const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLButtonElement>;
  expect(statTriggers.length).toBe(4);

  // Click trigger to open dropdown
  statTriggers[0].click();

  // Find the "ATK%" option (value "2:0") in the dropdown panel and click it
  const items = document.querySelectorAll(".shared-dropdown-panel.open .shared-dropdown-item");
  const atkPctItem = Array.from(items).find(
    (el) => (el as HTMLElement).dataset.value === "2:0",
  ) as HTMLElement;
  expect(atkPctItem).not.toBeUndefined();
  atkPctItem.click();

  expect(rule.Substats[0].ID).toBe(2);
  expect(rule.Substats[0].IsFlat).toBe(false);
  expect(changes.length).toBe(1);
});
```

### Step 4: Update "substat editing > selecting None resets substat to empty" test (line 218-232)

```ts
// Before:
it("selecting None resets substat to empty", () => {
  const rule = defaultRule();
  rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" };
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());
  const statSelects = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLSelectElement>;
  statSelects[0].value = "-1";
  statSelects[0].dispatchEvent(new Event("change", { bubbles: true }));
  expect(rule.Substats[0].ID).toBe(-1);
  expect(rule.Substats[0].Value).toBe(0);
});

// After:
it("selecting None resets substat to empty", () => {
  const rule = defaultRule();
  rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" };
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());
  const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLButtonElement>;

  // Click trigger to open dropdown
  statTriggers[0].click();

  // Click the "None" option (value "-1")
  const items = document.querySelectorAll(".shared-dropdown-panel.open .shared-dropdown-item");
  const noneItem = Array.from(items).find(
    (el) => (el as HTMLElement).dataset.value === "-1",
  ) as HTMLElement;
  noneItem.click();

  expect(rule.Substats[0].ID).toBe(-1);
  expect(rule.Substats[0].Value).toBe(0);
});
```

### Step 5: Verify unchanged tests still pass

These tests should NOT need changes:
- "condition and value inputs are disabled when stat is None" — queries `.edit-sub-cond` (native select, unchanged)
- "passthrough fields on substat survive edits" — changes `.edit-sub-cond` (native select, unchanged)
- All Keep/Sell, Active/Inactive, delete, move, drag-and-drop tests — unchanged DOM

### Step 6: Run tests, build, lint, commit

Run: `npm run build && npm test && npm run lint`

All tests should pass now. This is the single commit for Tasks 3–5 (DOM changes + delegation wiring + test updates), ensuring every commit has a green test suite:

```
feat: replace per-card <select> elements with shared dropdown triggers

Convert rank, rarity, main-stat, level, faction, and substat-stat fields
from native <select> to shared dropdown trigger buttons. Wire delegation
for open-dropdown action and update existing editor tests.
```

---

## Task 6: Add CSS for triggers and panels

**Files:**
- Modify: `packages/web/src/style.css`

### Step 1: Add styles

```css
/* Shared dropdown trigger buttons — match existing .edit-field select styling */
.edit-dropdown-trigger {
  flex: 1;
  padding: 0.3rem 0.5rem;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
  text-align: left;
  min-width: 0;
}

.edit-dropdown-trigger:hover { background-color: #f3f4f6; }
.edit-dropdown-trigger:focus { outline: 2px solid #0066cc; outline-offset: -1px; }

/* Shared dropdown floating panel */
.shared-dropdown-panel {
  position: fixed;
  display: none;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  z-index: 50;
  max-height: 300px;
  overflow-y: auto;
}
.shared-dropdown-panel.open { display: flex; flex-direction: column; }

.shared-dropdown-item {
  padding: 0.5rem;
  cursor: pointer;
  background: white;
}
.shared-dropdown-item:hover { background-color: #f0f0f0; }
.shared-dropdown-item.active { background-color: #e3f2fd; font-weight: bold; }
```

### Step 2: Build, lint, commit

Run: `npm run build && npm run lint`

```
style: add CSS for shared dropdown triggers and floating panels
```

---

## Task 7: Integration tests

**Files:**
- Create: `packages/web/src/__tests__/editor-dropdowns.test.ts`

### Step 1: Write integration tests

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HsfFilter, HsfRule } from "@rslh/core";
import { defaultRule } from "@rslh/core";
import { renderEditableRules, clearEditor } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";

function setupDOM(): void {
  document.body.innerHTML =
    '<div id="rules-pagination" hidden></div>' +
    '<div id="rules-container"></div>' +
    '<div id="rules-pagination-bottom" hidden></div>';
}

function makeFilter(rules: HsfRule[]): HsfFilter {
  return { Rules: rules };
}

function noopCallbacks(overrides?: Partial<RuleEditorCallbacks>): RuleEditorCallbacks {
  return {
    onRuleChange: overrides?.onRuleChange ?? (() => {}),
    onRuleDelete: overrides?.onRuleDelete ?? (() => {}),
    onRuleMove: overrides?.onRuleMove ?? (() => {}),
    onRuleAdd: overrides?.onRuleAdd ?? (() => {}),
  };
}

/** Click a trigger button, find an option by value in the open panel, click it. */
function selectDropdownValue(trigger: HTMLElement, value: string): void {
  trigger.click();
  const panel = document.querySelector(".shared-dropdown-panel.open");
  expect(panel, "panel should be open after clicking trigger").not.toBeNull();
  const item = Array.from(panel!.querySelectorAll(".shared-dropdown-item")).find(
    (el) => (el as HTMLElement).dataset.value === value,
  ) as HTMLElement | undefined;
  expect(item, `option with value="${value}" should exist`).not.toBeUndefined();
  item!.click();
}

describe("shared dropdown integration", () => {
  beforeEach(() => {
    setupDOM();
  });

  afterEach(() => {
    clearEditor();
  });

  it("rank trigger shows correct label and updates rule on selection", () => {
    const rule = defaultRule({ Rank: 0 });
    const filter = makeFilter([rule]);
    const changes: number[] = [];
    renderEditableRules(filter, noopCallbacks({
      onRuleChange(index) { changes.push(index); },
    }));

    const trigger = document.querySelector("[data-field='rank']") as HTMLElement;
    expect(trigger.textContent).toBe("Any");

    selectDropdownValue(trigger, "6");
    expect(trigger.textContent).toBe("6-star");
    expect(trigger.dataset.value).toBe("6");
    expect(rule.Rank).toBe(6);
    expect(changes).toEqual([0]);
  });

  it("rarity trigger updates rule", () => {
    const rule = defaultRule({ Rarity: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector("[data-field='rarity']") as HTMLElement;
    selectDropdownValue(trigger, "9");
    expect(rule.Rarity).toBe(9);
    expect(trigger.textContent).toBe("Epic");
  });

  it("main-stat trigger encodes/decodes correctly", () => {
    const rule = defaultRule();
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector("[data-field='main-stat']") as HTMLElement;
    expect(trigger.dataset.value).toBe("-1"); // default = Any

    selectDropdownValue(trigger, "5:0");
    expect(rule.MainStatID).toBe(5);
    expect(rule.MainStatF).toBe(1); // flatFlag=0 → MainStatF=1 (percent)
    expect(trigger.textContent).toBe("C.RATE");
  });

  it("level trigger updates rule", () => {
    const rule = defaultRule({ LVLForCheck: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector("[data-field='level']") as HTMLElement;
    selectDropdownValue(trigger, "12");
    expect(rule.LVLForCheck).toBe(12);
  });

  it("faction trigger updates rule", () => {
    const rule = defaultRule({ Faction: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector("[data-field='faction']") as HTMLElement;
    selectDropdownValue(trigger, "3");
    expect(rule.Faction).toBe(3);
    expect(trigger.textContent).toBe("Sacred Order");
  });

  it("substat-stat trigger selects stat and enables condition/value", () => {
    const rule = defaultRule(); // all substats empty (ID:-1)
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLElement>;
    const row = statTriggers[0].closest(".edit-substat-row")!;
    const condSelect = row.querySelector(".edit-sub-cond") as HTMLSelectElement;
    const valueInput = row.querySelector('input[type="number"]') as HTMLInputElement;

    // Initially disabled
    expect(condSelect.disabled).toBe(true);
    expect(valueInput.disabled).toBe(true);

    // Select HP% (1:0)
    selectDropdownValue(statTriggers[0], "1:0");

    expect(rule.Substats[0].ID).toBe(1);
    expect(rule.Substats[0].IsFlat).toBe(false);
    expect(condSelect.disabled).toBe(false);
    expect(valueInput.disabled).toBe(false);
  });

  it("substat-stat trigger reset to None disables condition/value", () => {
    const rule = defaultRule();
    rule.Substats[0] = { ID: 5, Value: 15, IsFlat: false, NotAvailable: false, Condition: ">" };
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLElement>;

    selectDropdownValue(statTriggers[0], "-1");

    expect(rule.Substats[0].ID).toBe(-1);
    expect(rule.Substats[0].Value).toBe(0);

    const row = statTriggers[0].closest(".edit-substat-row")!;
    expect((row.querySelector(".edit-sub-cond") as HTMLSelectElement).disabled).toBe(true);
    expect((row.querySelector('input[type="number"]') as HTMLInputElement).disabled).toBe(true);
  });

  it("Escape closes panel without changing value", () => {
    const rule = defaultRule({ Rank: 5 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector("[data-field='rank']") as HTMLElement;
    trigger.click();
    expect(document.querySelector(".shared-dropdown-panel.open")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    expect(rule.Rank).toBe(5); // unchanged
  });

  it("switching triggers closes previous panel and opens new one", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const rankTrigger = document.querySelector("[data-field='rank']") as HTMLElement;
    const rarityTrigger = document.querySelector("[data-field='rarity']") as HTMLElement;

    // Open rank dropdown
    rankTrigger.click();
    expect(document.querySelector(".shared-dropdown-panel.open[data-field-type='rank']")).not.toBeNull();

    // Click rarity trigger — rank panel should close, rarity panel should open
    rarityTrigger.click();
    expect(document.querySelector(".shared-dropdown-panel.open[data-field-type='rank']")).toBeNull();
    expect(document.querySelector(".shared-dropdown-panel.open[data-field-type='rarity']")).not.toBeNull();
  });

  it("dropdown on second card updates correct rule", () => {
    const rule0 = defaultRule({ Rank: 0 });
    const rule1 = defaultRule({ Rank: 5 });
    const filter = makeFilter([rule0, rule1]);
    const changes: number[] = [];
    renderEditableRules(filter, noopCallbacks({
      onRuleChange(index) { changes.push(index); },
    }));

    // Find the rank trigger on the second card (rule-index="1")
    const cards = document.querySelectorAll("[data-rule-index]");
    const card1 = cards[1];
    const trigger = card1.querySelector("[data-field='rank']") as HTMLElement;
    expect(trigger.dataset.value).toBe("5");

    selectDropdownValue(trigger, "6");
    expect(rule1.Rank).toBe(6);
    expect(rule0.Rank).toBe(0); // first rule unchanged
    expect(changes).toEqual([1]); // callback fired with index 1
  });

  it("clearEditor destroys dropdown panels", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    expect(document.querySelectorAll(".shared-dropdown-panel").length).toBe(6);
    clearEditor();
    expect(document.querySelectorAll(".shared-dropdown-panel").length).toBe(0);
  });
});
```

### Step 2: Run full suite

Run: `npm run build && npm test && npm run lint`

### Step 3: Commit

```
test: integration tests for shared dropdown panels in editor
```

---

## Task 8: Final verification

### Run full suite

Run: `npm run build && npm test && npm run lint`

### Manual verification

1. Load large .hsf, enter edit mode
2. Click field triggers — shared panel appears positioned below trigger
3. Select options — trigger text and rule state update
4. Arrow keys + Enter/Escape work
5. Click outside closes panel
6. Condition selects still work as native `<select>` elements
7. DevTools: confirm ~20K fewer DOM nodes per page
8. Click trigger near bottom of viewport — panel flips above trigger
9. Scroll page while panel is open — panel closes
10. Click rank trigger, then click rarity trigger — rank panel closes, rarity opens
11. Screen reader audit: trigger announces "listbox", items announce as options

### Expected improvement

Before: ~25,700 select-related DOM nodes per 100-card page
After: ~2,600 trigger button nodes + 6 panel elements (~150 option items when open)
Savings: **~20,400 DOM nodes (~79% of select-related nodes)**
