# Shared Dropdown Panels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-card `<select>` elements in editor mode with custom dropdown trigger buttons that share a single floating option list panel per field type. This eliminates ~20,400 DOM nodes per page (100 cards) by removing redundant `<option>` elements that are cloned identically across every card.

**Architecture:** Each field type (rank, rarity, main-stat, level, faction, substat-stat) shares one floating panel element appended to `<body>`. When a trigger button is clicked, the panel is positioned below the trigger via `position: fixed`, populated with highlight state for the current value, and shown. Selecting an option closes the panel, updates the trigger's display text, and fires the same rule-mutation logic that `handleContainerChange` uses today. The existing event delegation pattern on `#rules-container` is extended with new `data-action` values for triggers and a separate document-level listener for the shared panels.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests. Follows the same delegation and `data-*` attribute conventions established by the event delegation refactor.

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

4. **Keyboard accessibility.** Trigger buttons are focusable `<button>` elements. Panel supports arrow keys, Enter, Escape.

5. **Global click-outside handler extended** in `main.ts` for `.shared-dropdown-panel.open`.

6. **Substat stat selects share one panel.** All 4 per card have identical options.

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
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5");
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.classList.contains("open")).toBe(true);
    expect(panel.querySelectorAll(".shared-dropdown-item").length).toBe(3);
    dd.destroy();
  });

  it("highlights the current value", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5");
    const active = document.querySelector(".shared-dropdown-item.active");
    expect(active!.textContent).toBe("5-star");
    dd.destroy();
  });

  it("fires onSelect when item clicked", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.onSelect = onSelect;
    dd.open(document.getElementById("trigger")!, "0");
    (document.querySelectorAll(".shared-dropdown-item")[2] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("6");
    dd.destroy();
  });

  it("closes on Escape", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("navigates with arrow keys", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0");
    const items = document.querySelectorAll(".shared-dropdown-item");
    expect(items[0].classList.contains("active")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(items[1].classList.contains("active")).toBe(true);
    dd.destroy();
  });

  it("selects on Enter", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.onSelect = onSelect;
    dd.open(document.getElementById("trigger")!, "0");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledWith("5");
    dd.destroy();
  });

  it("destroys and removes panel", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.destroy();
    expect(document.querySelector(".shared-dropdown-panel")).toBeNull();
  });
});
```

### Step 2: Implement `SharedDropdown`

```ts
// packages/web/src/shared-dropdown.ts
export interface DropdownOption {
  value: string;
  label: string;
}

export class SharedDropdown {
  private panel: HTMLElement;
  private options: DropdownOption[];
  public onSelect?: (value: string) => void;
  private currentTrigger: HTMLElement | null = null;
  private activeIndex = 0;

  constructor(fieldType: string, options: DropdownOption[]) {
    this.options = options;
    this.panel = document.createElement("div");
    this.panel.className = "shared-dropdown-panel";
    this.panel.dataset.fieldType = fieldType;
    document.body.appendChild(this.panel);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("click", this.handleClickOutside);
  }

  open(trigger: HTMLElement, currentValue: string): void {
    this.currentTrigger = trigger;
    this.activeIndex = Math.max(0, this.options.findIndex((o) => o.value === currentValue));
    this.panel.innerHTML = "";
    this.options.forEach((opt, idx) => {
      const item = document.createElement("div");
      item.className = "shared-dropdown-item" + (idx === this.activeIndex ? " active" : "");
      item.textContent = opt.label;
      item.dataset.value = opt.value;
      item.addEventListener("click", () => this.select(opt.value));
      this.panel.appendChild(item);
    });
    const rect = trigger.getBoundingClientRect();
    this.panel.style.position = "fixed";
    this.panel.style.left = `${rect.left}px`;
    this.panel.style.top = `${rect.bottom + 4}px`;
    this.panel.style.minWidth = `${rect.width}px`;
    this.panel.classList.add("open");
  }

  close(): void {
    this.panel.classList.remove("open");
    this.panel.innerHTML = "";
    this.currentTrigger?.focus();
    this.currentTrigger = null;
  }

  private select(value: string): void {
    this.onSelect?.(value);
    this.close();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.panel.classList.contains("open")) return;
    if (e.key === "Escape") { e.preventDefault(); this.close(); }
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % this.options.length;
      this.updateActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + this.options.length) % this.options.length;
      this.updateActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.select(this.options[this.activeIndex].value);
    }
  };

  private updateActive(): void {
    this.panel.querySelectorAll(".shared-dropdown-item").forEach((item, idx) => {
      item.classList.toggle("active", idx === this.activeIndex);
    });
  }

  private handleClickOutside = (e: MouseEvent): void => {
    if (!this.panel.classList.contains("open")) return;
    if (!this.panel.contains(e.target as Node) && e.target !== this.currentTrigger) this.close();
  };

  destroy(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("click", this.handleClickOutside);
    this.panel.remove();
  }
}
```

### Step 3: Run tests, build, lint, commit

```
feat: add SharedDropdown component for reusable floating option panels
```

---

## Task 2: Create shared dropdown instances in editor.ts

Initialize one `SharedDropdown` per field type at module scope.

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Add imports and create instances

```ts
import { SharedDropdown, type DropdownOption } from "./shared-dropdown.js";

const RANK_OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  { value: "5", label: "5-star" },
  { value: "6", label: "6-star" },
];

// ... rarity, main-stat, level, faction, substat-stat option arrays ...

const sharedDropdowns: Record<string, SharedDropdown> = {};

function initDropdowns(): void {
  sharedDropdowns.rank = new SharedDropdown("rank", RANK_OPTIONS);
  sharedDropdowns.rarity = new SharedDropdown("rarity", RARITY_OPTIONS);
  sharedDropdowns["main-stat"] = new SharedDropdown("main-stat", MAIN_STAT_OPTIONS);
  sharedDropdowns.level = new SharedDropdown("level", LEVEL_OPTIONS);
  sharedDropdowns.faction = new SharedDropdown("faction", FACTION_OPTIONS);
  sharedDropdowns["substat-stat"] = new SharedDropdown("substat-stat", SUBSTAT_STAT_OPTIONS);
}
```

### Step 2: Call `initDropdowns()` from `renderEditableRules`

### Step 3: Clean up dropdowns in `clearEditor`

### Step 4: Run tests, build, lint, commit

```
feat: create shared dropdown instances for 6 field types in editor
```

---

## Task 3: Convert card builders to use trigger buttons

Replace `<select>` elements with `<button>` triggers for the 9 targeted fields (rank, rarity, main-stat, level, faction, 4x substat stat). Keep condition selects native.

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Replace select builders with trigger builders

Each trigger button gets:
- `data-action="open-dropdown"`
- `data-field="<fieldType>"`
- `data-value="<currentEncodedValue>"`
- Optional `data-sub-index` for substat triggers
- Display text matching the current selection label

### Step 2: Update existing editor tests

Tests that query `<select>` elements by `data-field` will now find `<button>` elements. Update assertions accordingly.

### Step 3: Run tests, build, lint, commit

```
feat: replace per-card <select> elements with shared dropdown triggers
```

---

## Task 4: Wire delegation for trigger clicks and option selection

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Add `open-dropdown` case to `handleContainerClick`

```ts
case "open-dropdown": {
  const fieldType = action.dataset.field!;
  const currentValue = action.dataset.value ?? "-1";
  const dropdown = sharedDropdowns[fieldType];
  if (!dropdown) break;
  dropdown.onSelect = (newValue) => {
    handleDropdownSelection(card, index, action, fieldType, newValue);
  };
  dropdown.open(action, currentValue);
  break;
}
```

### Step 2: Implement `handleDropdownSelection`

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
    case "rank": rule.Rank = Number(value); break;
    case "rarity": rule.Rarity = Number(value); break;
    case "level": rule.LVLForCheck = Number(value); break;
    case "faction": rule.Faction = Number(value); break;
    case "main-stat": {
      // decode "statId:flatFlag" or "-1"
      if (value === "-1") { rule.MainStatID = -1; rule.MainStatF = 1; }
      else {
        const [statId, flatFlag] = value.split(":").map(Number);
        rule.MainStatID = statId;
        rule.MainStatF = flatFlag === 1 ? 0 : 1;
      }
      break;
    }
    case "substat-stat": {
      const subIndex = Number(trigger.dataset.subIndex);
      // ... update substat ID/IsFlat, enable/disable condition and value inputs ...
      break;
    }
  }

  // Update trigger display
  trigger.textContent = getLabelForValue(fieldType, value);
  trigger.dataset.value = value;
  currentCallbacks.onRuleChange(ruleIndex, rule);
}
```

### Step 3: Run tests, build, lint, commit

```
feat: wire delegation for shared dropdown trigger clicks and selections
```

---

## Task 5: Add CSS for triggers and panels

**Files:**
- Modify: `packages/web/src/style.css`

### Step 1: Add styles

```css
/* Dropdown triggers — styled to match native <select> appearance */
button[data-action="open-dropdown"] {
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  background: #f9f9f9;
  cursor: pointer;
  font-size: 0.875rem;
  border-radius: 2px;
  text-align: left;
  min-width: 50px;
}

button[data-action="open-dropdown"]:hover { background-color: #e8e8e8; }
button[data-action="open-dropdown"]:focus { outline: 2px solid #0066cc; outline-offset: -1px; }

/* Shared dropdown panel */
.shared-dropdown-panel {
  position: fixed;
  display: none;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 10000;
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

```
style: add CSS for shared dropdown triggers and floating panels
```

---

## Task 6: Extend global click-outside handler

**Files:**
- Modify: `packages/web/src/main.ts`

### Step 1: Add shared dropdown closing to existing handler

```ts
// Existing handler in main.ts:
document.addEventListener("click", (e) => {
  // ... existing set-selector-panel close logic ...

  // Close shared dropdown panels
  for (const panel of document.querySelectorAll(".shared-dropdown-panel.open")) {
    if (!panel.contains(e.target as Node)) {
      panel.classList.remove("open");
    }
  }
});
```

### Step 2: Build, lint, commit

```
fix: extend global click-outside handler for shared dropdown panels
```

---

## Task 7: Integration tests

**Files:**
- Create: `packages/web/src/__tests__/editor-dropdowns.test.ts`

### Step 1: Write end-to-end tests

Test all 9 fields: open panel, select option, verify rule state and trigger text updates. Test keyboard nav and click-outside.

### Step 2: Run full suite, commit

```
test: integration tests for shared dropdown panels in editor
```

---

## Task 8: Final verification

### Run full suite

Run: `npm run build && npm test && npm run lint`

### Manual verification

1. Load large .hsf, enter edit mode
2. Click field triggers — shared panel appears
3. Select options — trigger text and rule state update
4. Arrow keys + Enter/Escape work
5. Click outside closes panel
6. DevTools: confirm ~20K fewer DOM nodes per page

### Expected improvement

Before: ~25,700 select-related DOM nodes per 100-card page
After: ~2,600 trigger nodes + 6 panel elements
Savings: **~20,400 DOM nodes (~79% of select-related nodes)**
