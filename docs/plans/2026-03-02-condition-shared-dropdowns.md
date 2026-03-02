# Shared Condition Select Dropdowns — Implementation Plan

**Goal:** Replace the 4 native `<select>` elements per editor card (substat condition dropdowns) with shared dropdown trigger buttons, following the same pattern as the existing 6 shared dropdowns. Eliminates ~10,800 DOM nodes per page (100 cards).

**Architecture:** Add `substat-condition` as a 7th `SharedDropdown` instance. Each condition trigger button gets `data-action="open-dropdown"` + `data-field="substat-condition"` + `data-sub-index` for context. Selection flows through the existing `handleDropdownSelection` switch. When a substat stat is "None", the condition trigger resets to `>=` and is disabled.

**Tech Stack:** Same as existing — vanilla DOM, TypeScript, vitest + jsdom.

---

## Context

Chrome performance traces show **293 DOM nodes per editor card** at page_size=100. Of those, ~141 are Chrome's user-agent shadow DOM inside 32 form controls. The 4 condition `<select>` elements (each with 5 `<option>` children) account for ~108 nodes/card (44 explicit + ~64 shadow DOM). Converting them to shared trigger buttons (like the other 6 field types) is the single largest remaining DOM reduction opportunity.

The original shared-dropdown plan explicitly excluded condition selects, estimating only ~1,600 node savings. The trace analysis revealed the true cost is ~10,800/page due to shadow DOM overhead that wasn't accounted for.

---

## Task 1: Add condition dropdown options and shared instance

**Files:**
- Modify: `packages/web/src/editor.ts`

### Step 1: Add `CONDITION_DROPDOWN_OPTIONS` constant

After the existing `CONDITION_OPTIONS` array (line 49), add a `DropdownOption[]` version:

```ts
const CONDITION_DROPDOWN_OPTIONS: DropdownOption[] = CONDITION_OPTIONS.map(
  (c) => ({ value: c, label: c }),
);
```

### Step 2: Register in `initDropdowns()`

Add to the `sharedDropdowns` object in `initDropdowns()` (line 100):

```ts
"substat-condition": new SharedDropdown("substat-condition", CONDITION_DROPDOWN_OPTIONS),
```

### Step 3: Add to `OPTION_ARRAYS` lookup

Add to the `OPTION_ARRAYS` record (line 568):

```ts
"substat-condition": CONDITION_DROPDOWN_OPTIONS,
```

### Step 4: Build, test, lint

Run: `npm run build && npm test && npm run lint`

No tests should break — this only adds infrastructure.

### Step 5: Commit

```
feat: register shared dropdown instance for substat condition field
```

---

## Task 2: Replace `<select>` with trigger button in `buildSubstatRow`

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Write failing tests

In `editor.test.ts`, add tests in the "substat editing" describe block:

```ts
it("condition trigger button shows current condition", () => {
  const rule = defaultRule();
  rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">" };
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());

  const condTrigger = document.querySelector(
    '.edit-substat-row [data-field="substat-condition"]',
  ) as HTMLButtonElement;
  expect(condTrigger).not.toBeNull();
  expect(condTrigger.textContent).toBe(">");
  expect(condTrigger.dataset.value).toBe(">");
});

it("condition trigger is disabled when stat is None", () => {
  const rule = defaultRule(); // default substats have ID:-1
  const filter = makeFilter([rule]);
  renderEditableRules(filter, noopCallbacks());

  const condTrigger = document.querySelector(
    '.edit-substat-row [data-field="substat-condition"]',
  ) as HTMLButtonElement;
  expect(condTrigger.disabled).toBe(true);
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`

### Step 3: Replace `<select>` with trigger button in `buildSubstatRow()`

In `buildSubstatRow()` (line 792), replace the condition select block:

```ts
// REMOVE: native <select> for condition
// const condSelect = document.createElement("select");
// condSelect.className = "edit-sub-cond";
// for (const cond of CONDITION_OPTIONS) { ... }

// ADD: shared dropdown trigger button for condition
const currentCond = sub.Condition || ">=";
const condTrigger = buildTriggerButton("substat-condition", currentCond, currentCond);
condTrigger.className = "edit-sub-cond edit-dropdown-trigger";
condTrigger.dataset.subIndex = String(subIndex);

const isNone = sub.ID === -1;
condTrigger.disabled = isNone;
valueInput.disabled = isNone;

row.appendChild(statTrigger);
row.appendChild(condTrigger);  // was condSelect
row.appendChild(valueInput);
```

### Step 4: Update existing tests that query `.edit-sub-cond`

Tests that use `querySelector(".edit-sub-cond")` and cast to `HTMLSelectElement` need updating:
- Change casts from `HTMLSelectElement` to `HTMLButtonElement`
- Change `.value` reads to `.dataset.value`
- Change `.disabled` checks — these work the same on buttons
- Remove `dispatchEvent(new Event("change"))` patterns — these will be handled via click delegation instead

Specific tests to update:
- "condition and value inputs are disabled when stat is None" — change select to button queries
- "passthrough fields on substat survive edits" — condition changes now go through dropdown selection, not native change event

### Step 5: Build, test, lint

Run: `npm run build && npm test && npm run lint`

### Step 6: Commit

```
refactor: replace condition <select> with shared dropdown trigger button
```

---

## Task 3: Handle condition selection in `handleDropdownSelection`

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/__tests__/editor.test.ts`

### Step 1: Write failing tests

```ts
it("selecting a condition via shared dropdown updates the rule", () => {
  const rule = defaultRule();
  rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" };
  let changedRule: HsfRule | null = null;
  const filter = makeFilter([rule]);
  renderEditableRules(filter, {
    onRuleChange(_i, r) { changedRule = r; },
    onRuleDelete() {},
    onRuleMove() {},
    onRuleAdd() {},
  });

  const condTrigger = document.querySelector(
    '.edit-substat-row [data-field="substat-condition"]',
  ) as HTMLButtonElement;
  condTrigger.click();

  // Select ">" from the shared dropdown panel
  const items = document.querySelectorAll('.shared-dropdown-panel[data-field-type="substat-condition"] .shared-dropdown-item');
  const gtItem = Array.from(items).find((el) => el.textContent === ">");
  (gtItem as HTMLElement).click();

  expect(changedRule!.Substats[0].Condition).toBe(">");
  expect(condTrigger.textContent).toBe(">");
  expect(condTrigger.dataset.value).toBe(">");
});
```

### Step 2: Add `substat-condition` case to `handleDropdownSelection`

In the switch statement in `handleDropdownSelection()`:

```ts
case "substat-condition": {
  const subIndex = Number(trigger.dataset.subIndex);
  rule.Substats[subIndex] = {
    ...rule.Substats[subIndex],
    Condition: value,
  };
  break;
}
```

### Step 3: Update the `substat-stat` case for condition reset

In the existing `substat-stat` case, when stat is set to "None" (`value === "-1"`), update the condition trigger instead of the native select:

```ts
// Find the condition trigger (was condSelect)
const condTrigger = row?.querySelector('[data-field="substat-condition"]') as HTMLButtonElement | null;
const valueInput = row?.querySelector('input[type="number"]') as HTMLInputElement | null;

if (value === "-1") {
  rule.Substats[subIndex] = emptySubstat();
  if (condTrigger) {
    condTrigger.disabled = true;
    condTrigger.textContent = ">=";
    condTrigger.dataset.value = ">=";
  }
  if (valueInput) {
    valueInput.disabled = true;
    valueInput.value = "0";
  }
} else {
  // ... parse statId:flatFlag ...
  rule.Substats[subIndex] = {
    ...rule.Substats[subIndex],
    ID: statId,
    IsFlat: flatFlag === 1,
    Condition: condTrigger?.dataset.value || ">=",
    Value: Number(valueInput?.value) || 0,
  };
  if (condTrigger) condTrigger.disabled = false;
  if (valueInput) valueInput.disabled = false;
}
```

### Step 4: Remove condition branch from `handleContainerChange`

The `edit-sub-cond` branch in `handleContainerChange()` is no longer needed — condition changes now go through `handleDropdownSelection`. Remove the branch. After removal, `handleContainerChange` handles only: set checkboxes and slot checkboxes.

### Step 5: Build, test, lint

Run: `npm run build && npm test && npm run lint`

### Step 6: Commit

```
feat: wire condition dropdown selection through shared dropdown handler
```

---

## Task 4: Update CSS for condition trigger styling

**Files:**
- Modify: `packages/web/src/style.css`

### Step 1: Update `.edit-sub-cond` styles

The `.edit-sub-cond` selector currently targets a `<select>`. Update it to work with a `<button>` trigger:

```css
.edit-substat-row .edit-sub-cond {
  width: 55px;
  flex-shrink: 0;
  text-align: center;  /* center the condition symbol */
}
```

The button already inherits `.edit-dropdown-trigger` styles (padding, border, background, hover, focus). Just ensure the width and centering are preserved.

### Step 2: Update disabled styles

Replace the select-specific disabled rule:

```css
/* Before: .edit-substat-row select:disabled, */
/* After: */
.edit-substat-row button:disabled,
.edit-substat-row input:disabled {
  opacity: 0.4;
  cursor: default;
}
```

### Step 3: Build, test, lint

Run: `npm run build && npm test && npm run lint`

### Step 4: Commit

```
style: update condition dropdown trigger CSS for button element
```

---

## Task 5: Update integration tests in `editor-dropdowns.test.ts`

**Files:**
- Modify: `packages/web/src/__tests__/editor-dropdowns.test.ts`

### Step 1: Update substat integration tests

Tests that reference `.edit-sub-cond` as a native select need updating:
- `condSelect` variables change from `HTMLSelectElement` to `HTMLButtonElement`
- `.value` access changes to `.dataset.value`
- Direct value assignment (`condSelect.value = ">"`) changes to dataset mutation or simulated dropdown selection
- Tests verifying the condition select is disabled/enabled after stat changes should check `button.disabled`

### Step 2: Add condition-specific dropdown tests

Add to the shared dropdown test suite:
- Condition dropdown opens with correct pre-selection
- Keyboard navigation works (ArrowDown/Up/Enter/Escape)
- Selecting condition updates trigger text and fires onRuleChange
- Condition trigger disabled when stat is None, re-enabled when stat selected

### Step 3: Build, test, lint

Run: `npm run build && npm test && npm run lint`

### Step 4: Commit

```
test: update integration tests for shared condition dropdown
```

---

## Verification

After all tasks:

1. **Build + test + lint**: `npm run build && npm test && npm run lint`
2. **Manual check in browser**: `npm run dev`, load a filter, switch to Edit mode
   - Condition dropdowns should appear as buttons matching the trigger style of other fields
   - Click a condition trigger → shared panel opens with 5 options (>=, >, =, <=, <)
   - Select a condition → trigger updates, rule mutates
   - Set a substat stat to "None" → condition trigger resets to ">=" and is disabled
   - Set stat back to a value → condition trigger re-enables
   - Keyboard navigation (arrows, enter, escape) works on condition panel
3. **DOM node check**: In DevTools Performance tab, record a trace while switching to edit mode
   - Each page of 100 cards should show ~18,500 nodes (down from ~29,300)
   - Per-card savings: ~108 nodes (44 explicit + ~64 shadow DOM)
