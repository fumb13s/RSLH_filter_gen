# Event Delegation Refactor — Implementation Plan

> **Status:** Implemented (Tasks 1–4 complete). Task 5 (manual Chrome DevTools verification) remains.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate per-card event listeners in edit mode to fix the DOM node retention memory leak (~97k nodes + ~3.6k listeners leaked per page switch).

**Architecture:** Replace all per-card `addEventListener` calls in `editor.ts` (and the single one in `render.ts` view mode) with delegated listeners on the `#rules-container` element. Handlers inspect `event.target` and walk up to the card via `data-rule-index` to identify which rule to act on. Rule objects are accessed via `currentFilter.Rules[index]` instead of closure capture. Callbacks are stored at module scope.

**Tech Stack:** Vanilla DOM (no framework), TypeScript, vitest + jsdom for tests.

---

## Background

Chrome traces show that every edit-mode page switch leaks ~97,707 DOM nodes and ~3,608 event listeners. The `AbortController` approach (commit b8569e9) properly removes listeners from event targets, but V8's shared closure context still retains references: each closure in `buildEditableRuleCard` captures both DOM elements and `rule` objects (reachable via `currentFilter`), creating cross-heap (V8 ↔ Oilpan) reference cycles that the GC cannot break.

Event delegation eliminates per-card closures entirely. The delegation handlers are registered once on the container and survive page switches — no teardown needed.

## Inventory of Listeners to Delegate

### editor.ts — per card (~36 listeners)

| Builder function | Event | Count/card | CSS class / role | New `data-*` attrs |
|---|---|---|---|---|
| `buildEditableRuleCard` | `dragstart` | 1 | card itself | (use existing `data-rule-index`) |
| `buildEditableRuleCard` | `dragend` | 1 | card itself | — |
| `buildEditableRuleCard` | `dragover` | 1 | card itself | — |
| `buildEditableRuleCard` | `drop` | 1 | card itself | — |
| `buildEditableRuleCard` | `click` | 1 | `.edit-badge-toggle` (Keep/Sell) | `data-action="keep-toggle"` |
| `buildEditableRuleCard` | `click` | 1 | `.edit-badge-toggle` (Active/Inactive) | `data-action="use-toggle"` |
| `buildEditableRuleCard` | `click` | 1 | `.edit-move-btn` (up) | `data-action="move-up"` |
| `buildEditableRuleCard` | `click` | 1 | `.edit-move-btn` (down) | `data-action="move-down"` |
| `buildEditableRuleCard` | `click` | 1 | `.edit-delete-btn` | `data-action="delete"` |
| `buildSetField` | `click` | 1 | `.set-selector-toggle` | `data-action="set-toggle"` |
| `populateSetPanel` | `change` | 0–135 | checkbox in `.set-selector-item` | `data-action="set-check"`, `data-set-id` |
| `populateSetPanel` | `input` | 1 | `.set-selector-search` | `data-action="set-search"` |
| `buildSlotField` | `change` | 9 | checkbox in `.checkbox-label` | `data-action="slot-check"`, `data-slot-id` |
| `buildSelectField` | `change` | 4× | select in `.edit-field` | `data-field="rank\|rarity\|main-stat\|level\|faction"` |
| `buildMainStatField` | `change` | 1 | select in `.edit-field` | `data-field="main-stat"` |
| `buildSubstatRow` | `change` | 4× | `.edit-sub-stat` | `data-sub-index` (on row) |
| `buildSubstatRow` | `change` | 4× | `.edit-sub-cond` | `data-sub-index` (on row) |
| `buildSubstatRow` | `input` | 4× | `input[type=number]` | `data-sub-index` (on row) |

### render.ts — per card (view mode)

| Builder function | Event | Count/card | CSS class | New `data-*` attrs |
|---|---|---|---|---|
| `buildRuleCard` | `click` | 1 | `.badge-raw` | `data-action="raw-toggle"` |

### render.ts — pagination controls (per page render)

These are rebuilt on every page switch (5-7 listeners). They use `{ signal }` today. After delegation, they can stay as-is (they're on pagination containers, not the rules container) or be delegated to a pagination wrapper. **Decision: leave pagination listeners as-is** — they're few and on persistent containers, not leaked cards.

## Design Decisions

1. **Module-level `currentCallbacks`**: Store the `RuleEditorCallbacks` at module level in `editor.ts` (alongside `currentFilter` in `render.ts`). The delegated handlers read `currentFilter` (already module-level in render.ts, needs to be exported or accessed) and `currentCallbacks`.

2. **`data-action` for buttons, `data-field` for selects/inputs**: Buttons get `data-action` to identify their purpose. Selects/inputs in the body grid get `data-field` to identify which rule property they control. Substat rows get `data-sub-index` on the `.edit-substat-row` container.

3. **Drag events on container**: `dragstart`, `dragend`, `dragover`, and `drop` all bubble. Delegate them to `#rules-container`. Use `closest(".edit-card")` to find the target card.

4. **Lazy set panel**: The set panel is still lazily populated on first toggle click. But its checkbox `change` events and search `input` events are handled by the container-level delegation, so no per-checkbox listeners are needed.

5. **AbortController removal**: The `pageController`/`abortPageListeners()` mechanism in render.ts becomes unnecessary for editor cards. Keep it for pagination controls (which still use `{ signal }`). Remove `signal` parameter from all card builder functions.

6. **Test compatibility**: All tests use `.click()` and `dispatchEvent(new Event("change", { bubbles: true }))` which bubble to the container. **Caveat**: `new Event("change")` does NOT bubble by default — we need `{ bubbles: true }`. Check whether tests already pass (jsdom might handle this) or if test event creation needs updating.

7. **Rule lookup pattern**: Every handler does:
   ```ts
   const card = (e.target as Element).closest(".edit-card") as HTMLElement | null;
   if (!card) return;
   const index = Number(card.dataset.ruleIndex);
   const rule = currentFilter!.Rules[index];
   ```

---

## Task 1: Add data attributes to card DOM construction

Remove all `addEventListener` calls and `signal` parameters from `buildEditableRuleCard` and its sub-builders. Add `data-action`, `data-field`, `data-sub-index`, and `data-set-id` attributes to the appropriate elements.

**Files:**
- Modify: `packages/web/src/editor.ts` (entire file)

### Step 1: Write failing tests for data attributes

Add tests that verify data attributes exist on rendered elements.

```ts
// In editor.test.ts
describe("data attributes for delegation", () => {
  it("Keep button has data-action='keep-toggle'", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());
    const btn = document.querySelector("[data-action='keep-toggle']");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("Keep");
  });

  it("delete button has data-action='delete'", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());
    const btn = document.querySelector("[data-action='delete']");
    expect(btn).not.toBeNull();
  });

  it("substat rows have data-sub-index", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());
    const rows = document.querySelectorAll(".edit-substat-row");
    expect(rows.length).toBe(4);
    expect((rows[0] as HTMLElement).dataset.subIndex).toBe("0");
    expect((rows[3] as HTMLElement).dataset.subIndex).toBe("3");
  });

  it("field selects have data-field", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());
    const rankField = document.querySelector("[data-field='rank']");
    expect(rankField).not.toBeNull();
    expect(rankField!.tagName).toBe("SELECT");
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`
Expected: FAIL — no `data-action` or `data-field` attributes exist yet.

### Step 3: Add data attributes to all editor DOM builders

Modify `buildEditableRuleCard` and sub-builders:

**Keep button** (line ~177): add `keepBtn.dataset.action = "keep-toggle";`
**Use button** (line ~191): add `useBtn.dataset.action = "use-toggle";`
**Move up** (line ~206): add `upBtn.dataset.action = "move-up";`
**Move down** (line ~215): add `downBtn.dataset.action = "move-down";`
**Delete** (line ~226): add `delBtn.dataset.action = "delete";`
**Set toggle** (line ~419): add `toggle.dataset.action = "set-toggle";`

**`buildSelectField`** — add `data-field` to the `<select>`:
```ts
// Caller passes the field name; add it as a parameter
function buildSelectField(
  labelText: string,
  fieldName: string,    // NEW
  current: number,
  options: { value: number; label: string }[],
): HTMLElement {
  // ...
  select.dataset.field = fieldName;
  // ... NO addEventListener
}
```

Call sites change to:
- `buildSelectField("Rank", "rank", rule.Rank, [...])`
- `buildSelectField("Rarity", "rarity", rule.Rarity, rarityOpts)`
- `buildSelectField("Level", "level", rule.LVLForCheck, levelOpts)`
- `buildSelectField("Faction", "faction", rule.Faction, factionOpts)`

**`buildMainStatField`** — add `select.dataset.field = "main-stat";`

**`buildSubstatRow`** — add `row.dataset.subIndex = String(subIndex);` on the row element. The three elements inside (`.edit-sub-stat`, `.edit-sub-cond`, `input[type=number]`) are identified by their CSS class/type within the row.

**`populateSetPanel`** — add `checkbox.dataset.setId = String(entry.id);` and `checkbox.dataset.action = "set-check";` on each checkbox. Add `search.dataset.action = "set-search";` on the search input.

**`buildSlotField`** — add `checkbox.dataset.slotId = String(id);` and `checkbox.dataset.action = "slot-check";`.

### Step 4: Remove all addEventListener calls and signal parameters

Remove every `addEventListener` call inside:
- `buildEditableRuleCard` (9 calls: 4 drag + 5 header)
- `buildSetField` (1 call)
- `populateSetPanel` (up to 136 calls: checkboxes + search)
- `buildSlotField` (9 calls)
- `buildSelectField` (1 call)
- `buildMainStatField` (1 call)
- `buildSubstatRow` (3 calls × 4 = 12)

Remove the `signal: AbortSignal` parameter from ALL builder function signatures:
- `buildEditableRuleCard`
- `buildSetField`
- `populateSetPanel`
- `buildSlotField`
- `buildSelectField`
- `buildMainStatField`
- `buildSubstatsSection`
- `buildSubstatRow`

Update the lambda in `renderEditableRules` to not pass signal:
```ts
renderPaginatedCards(filter, (rule, i) => buildEditableRuleCard(rule, i, total));
```

Remove `cb: RuleEditorCallbacks` from builder function parameters — callbacks will be accessed from module scope.

### Step 5: Run tests to verify data-attribute tests pass (and old tests now fail)

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`
Expected: New data-attribute tests PASS. Old behavioral tests (toggle, delete, move, substat editing) FAIL because listeners are gone and delegation isn't wired yet.

### Step 6: Commit

```bash
git add packages/web/src/editor.ts packages/web/src/__tests__/editor.test.ts
git commit -m "refactor: add data attributes, remove per-card addEventListener calls"
```

---

## Task 2: Wire delegated event handlers on the container

Add module-level delegation handlers in `editor.ts` for `click`, `change`, and `input` events. Register them once on `#rules-container` when edit mode starts.

**Files:**
- Modify: `packages/web/src/editor.ts`
- Modify: `packages/web/src/render.ts` (export `currentFilter`, adjust `renderPaginatedCards` signature)

### Step 1: Export currentFilter from render.ts

`currentFilter` is already module-level in `render.ts`. Export a getter:

```ts
export function getCurrentFilter(): HsfFilter | null {
  return currentFilter;
}
```

Update `renderPaginatedCards` card builder signature to remove signal:
```ts
cardBuilder: (rule: HsfRule, index: number) => HTMLElement
```

Update `renderCurrentPage` — still abort the page controller (for pagination listeners), but don't pass signal to `currentCardBuilder`:
```ts
container.appendChild(currentCardBuilder(rules[i], i));
```

Update `buildRuleCard` signature to remove signal. Move its raw-button listener into delegation (Task 3).

### Step 2: Store callbacks at module level in editor.ts

```ts
let currentCallbacks: RuleEditorCallbacks | null = null;
```

Set it in `renderEditableRules`:
```ts
export function renderEditableRules(filter: HsfFilter, callbacks: RuleEditorCallbacks): void {
  currentCallbacks = callbacks;
  const total = filter.Rules.length;
  renderPaginatedCards(filter, (rule, i) => buildEditableRuleCard(rule, i, total));
  // ...
}
```

### Step 3: Write the click delegation handler

```ts
function handleContainerClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  const action = target.closest("[data-action]") as HTMLElement | null;
  if (!action) return;
  const card = action.closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  const index = Number(card.dataset.ruleIndex);
  const filter = getCurrentFilter();
  if (!filter || !currentCallbacks) return;
  const rule = filter.Rules[index];

  switch (action.dataset.action) {
    case "keep-toggle": {
      rule.Keep = !rule.Keep;
      action.textContent = rule.Keep ? "Keep" : "Sell";
      action.className = `edit-badge-toggle ${rule.Keep ? "badge-keep" : "badge-sell"}`;
      card.classList.toggle("keep", rule.Keep);
      card.classList.toggle("sell", !rule.Keep);
      currentCallbacks.onRuleChange(index, rule);
      break;
    }
    case "use-toggle": {
      rule.Use = !rule.Use;
      action.textContent = rule.Use ? "Active" : "Inactive";
      action.className = `edit-badge-toggle ${rule.Use ? "badge-active" : "badge-inactive"}`;
      card.classList.toggle("inactive", !rule.Use);
      currentCallbacks.onRuleChange(index, rule);
      break;
    }
    case "move-up":
      currentCallbacks.onRuleMove(index, index - 1);
      break;
    case "move-down":
      currentCallbacks.onRuleMove(index, index + 1);
      break;
    case "delete":
      currentCallbacks.onRuleDelete(index);
      break;
    case "set-toggle": {
      const panel = card.querySelector(".set-selector-panel") as HTMLElement;
      if (!panel.children.length) {
        populateSetPanel(panel, rule, index, action);
      }
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        const search = panel.querySelector<HTMLInputElement>(".set-selector-search");
        if (search) search.focus();
      }
      break;
    }
  }
}
```

### Step 4: Write the change delegation handler

```ts
function handleContainerChange(e: Event): void {
  const target = e.target as HTMLElement;
  const card = target.closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  const index = Number(card.dataset.ruleIndex);
  const filter = getCurrentFilter();
  if (!filter || !currentCallbacks) return;
  const rule = filter.Rules[index];

  // Field selects (Rank, Rarity, Level, Faction)
  const field = (target as HTMLElement).dataset.field;
  if (field) {
    const val = Number((target as HTMLSelectElement).value);
    switch (field) {
      case "rank": rule.Rank = val; break;
      case "rarity": rule.Rarity = val; break;
      case "level": rule.LVLForCheck = val; break;
      case "faction": rule.Faction = val; break;
      case "main-stat": {
        const sv = (target as HTMLSelectElement).value;
        if (sv === "-1") {
          rule.MainStatID = -1;
          rule.MainStatF = 1;
        } else {
          const [statId, flatFlag] = sv.split(":").map(Number);
          rule.MainStatID = statId;
          rule.MainStatF = flatFlag === 1 ? 0 : 1;
        }
        break;
      }
    }
    currentCallbacks.onRuleChange(index, rule);
    return;
  }

  // Substat changes
  const row = target.closest(".edit-substat-row") as HTMLElement | null;
  if (row) {
    const subIndex = Number(row.dataset.subIndex);
    if (target.classList.contains("edit-sub-stat")) {
      handleSubstatStatChange(rule, subIndex, row, target as HTMLSelectElement);
    } else if (target.classList.contains("edit-sub-cond")) {
      rule.Substats[subIndex] = { ...rule.Substats[subIndex], Condition: (target as HTMLSelectElement).value };
    }
    currentCallbacks.onRuleChange(index, rule);
    return;
  }

  // Set checkboxes
  const action = (target as HTMLElement).dataset.action;
  if (action === "set-check") {
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
  if (action === "slot-check") {
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

### Step 5: Write the input delegation handler

```ts
function handleContainerInput(e: Event): void {
  const target = e.target as HTMLElement;
  const card = target.closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  const index = Number(card.dataset.ruleIndex);
  const filter = getCurrentFilter();
  if (!filter || !currentCallbacks) return;
  const rule = filter.Rules[index];

  // Substat value input
  const row = target.closest(".edit-substat-row") as HTMLElement | null;
  if (row && target instanceof HTMLInputElement && target.type === "number") {
    const subIndex = Number(row.dataset.subIndex);
    rule.Substats[subIndex] = {
      ...rule.Substats[subIndex],
      Value: Number(target.value) || 0,
    };
    currentCallbacks.onRuleChange(index, rule);
    return;
  }

  // Set search filter
  if ((target as HTMLElement).dataset.action === "set-search") {
    const q = (target as HTMLInputElement).value.toLowerCase();
    const list = target.closest(".set-selector-panel")?.querySelector(".set-selector-list");
    if (list) {
      for (const item of list.children) {
        const text = (item as HTMLElement).textContent!.toLowerCase();
        (item as HTMLElement).hidden = !text.includes(q);
      }
    }
    return;
  }
}
```

### Step 6: Wire drag delegation on container

```ts
function handleContainerDragStart(e: DragEvent): void {
  const card = (e.target as Element).closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  dragSourceIndex = Number(card.dataset.ruleIndex);
  e.dataTransfer!.effectAllowed = "move";
  e.dataTransfer!.setData("text/plain", String(dragSourceIndex));
  card.classList.add("edit-card-dragging");
}

function handleContainerDragEnd(e: DragEvent): void {
  const card = (e.target as Element).closest(".edit-card") as HTMLElement | null;
  if (card) card.classList.remove("edit-card-dragging");
  dragSourceIndex = -1;
  const container = document.getElementById("rules-container")!;
  clearDropIndicators(container);
}

function handleContainerDragOver(e: DragEvent): void {
  if (dragSourceIndex === -1) return;
  const card = (e.target as Element).closest(".edit-card") as HTMLElement | null;
  if (!card) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";
  const container = card.parentElement!;
  clearDropIndicators(container);
  const targetIndex = Number(card.dataset.ruleIndex);
  if (targetIndex === dragSourceIndex) return;
  const rect = card.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) card.classList.add("edit-drop-above");
  else card.classList.add("edit-drop-below");
}

function handleContainerDrop(e: DragEvent): void {
  e.preventDefault();
  const from = dragSourceIndex;
  if (from === -1) return;
  const card = (e.target as Element).closest(".edit-card") as HTMLElement | null;
  if (!card || !currentCallbacks) return;
  const targetIndex = Number(card.dataset.ruleIndex);
  if (from === targetIndex) return;
  const rect = card.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  let to = e.clientY < midY ? targetIndex : targetIndex + 1;
  if (from < to) to--;
  if (from !== to) currentCallbacks.onRuleMove(from, to);
}
```

### Step 7: Register delegation listeners in renderEditableRules

Register once using named functions (idempotent due to same reference):

```ts
export function renderEditableRules(filter: HsfFilter, callbacks: RuleEditorCallbacks): void {
  currentCallbacks = callbacks;
  const total = filter.Rules.length;
  renderPaginatedCards(filter, (rule, i) => buildEditableRuleCard(rule, i, total));

  const container = document.getElementById("rules-container")!;
  container.addEventListener("click", handleContainerClick);
  container.addEventListener("change", handleContainerChange);
  container.addEventListener("input", handleContainerInput);
  container.addEventListener("dragstart", handleContainerDragStart);
  container.addEventListener("dragend", handleContainerDragEnd);
  container.addEventListener("dragover", handleContainerDragOver);
  container.addEventListener("drop", handleContainerDrop);
  container.addEventListener("dragleave", handleContainerDragLeave);
}
```

And remove them in `clearEditor`:
```ts
export function clearEditor(): void {
  currentCallbacks = null;
  const container = document.getElementById("rules-container")!;
  container.removeEventListener("click", handleContainerClick);
  container.removeEventListener("change", handleContainerChange);
  container.removeEventListener("input", handleContainerInput);
  container.removeEventListener("dragstart", handleContainerDragStart);
  container.removeEventListener("dragend", handleContainerDragEnd);
  container.removeEventListener("dragover", handleContainerDragOver);
  container.removeEventListener("drop", handleContainerDrop);
  container.removeEventListener("dragleave", handleContainerDragLeave);
  container.innerHTML = "";
}
```

### Step 8: Run all tests

Run: `npm test -- --reporter=verbose packages/web/src/__tests__/editor.test.ts`
Expected: All existing tests pass. If `dispatchEvent(new Event("change"))` doesn't bubble, fix by using `new Event("change", { bubbles: true })` in the tests.

### Step 9: Commit

```bash
git add packages/web/src/editor.ts packages/web/src/render.ts packages/web/src/__tests__/editor.test.ts
git commit -m "feat: event delegation for edit mode, eliminate per-card listeners"
```

---

## Task 3: Delegate view-mode raw button in render.ts

The view-mode `buildRuleCard` has 1 `addEventListener` per card (raw JSON toggle). Delegate it.

**Files:**
- Modify: `packages/web/src/render.ts`

### Step 1: Add data-action to raw button

In `buildRuleCard`, add `rawBtn.dataset.action = "raw-toggle"` and remove the `addEventListener` call.

### Step 2: Add a view-mode click delegation handler

```ts
function handleViewerClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target.dataset.action !== "raw-toggle") return;
  const card = target.closest(".rule-card") as HTMLElement | null;
  if (!card) return;
  const rawPre = card.querySelector(".rule-raw") as HTMLElement;
  rawPre.hidden = !rawPre.hidden;
  if (!rawPre.hidden && !rawPre.textContent) {
    const index = Number(card.id.replace("rule-", "")) - 1;
    const rule = currentFilter?.Rules[index];
    if (rule) rawPre.textContent = JSON.stringify(rule, null, 2);
  }
  target.classList.toggle("badge-raw-active", !rawPre.hidden);
}
```

### Step 3: Register/unregister in renderRules/clearViewer

In `renderRules`:
```ts
const container = document.getElementById("rules-container")!;
container.addEventListener("click", handleViewerClick);
```

In `clearViewer` (before `innerHTML = ""`):
```ts
const container = document.getElementById("rules-container")!;
container.removeEventListener("click", handleViewerClick);
```

### Step 4: Remove signal from buildRuleCard and renderPaginatedCards

Remove the `signal` parameter from `buildRuleCard`. The `renderCurrentPage` function no longer needs to pass signal to card builders. The `AbortController` in `renderCurrentPage` is still used for pagination control listeners — that's fine.

Update `currentCardBuilder` type:
```ts
let currentCardBuilder: (rule: HsfRule, index: number) => HTMLElement = buildRuleCard;
```

### Step 5: Run full test suite

Run: `npm run build && npm test && npm run lint`
Expected: All pass.

### Step 6: Commit

```bash
git add packages/web/src/render.ts
git commit -m "feat: delegate view-mode raw toggle, remove per-card signal"
```

---

## Task 4: Clean up AbortController remnants

Now that no card builders use `signal`, simplify the abort mechanism.

**Files:**
- Modify: `packages/web/src/render.ts`
- Modify: `packages/web/src/editor.ts`

### Step 1: Keep AbortController for pagination only

The `pageController` in render.ts is still used by `renderPaginationControls` (5-7 listeners per page switch on the pagination bar). This is fine — pagination elements are replaced on page switch and the abort cleans them up.

Remove the `abortPageListeners` export from `render.ts` if `editor.ts` no longer needs it. Check if `clearEditor` still calls it.

Since `clearEditor` now manually removes container-level listeners and clears innerHTML, it no longer needs `abortPageListeners`. Remove the import.

### Step 2: Verify no signal parameters remain in card builder signatures

Grep for `signal: AbortSignal` in editor.ts — should be zero matches.
Grep for `{ signal }` in editor.ts — should be zero matches.

### Step 3: Run full test suite

Run: `npm run build && npm test && npm run lint`
Expected: All pass.

### Step 4: Commit

```bash
git add packages/web/src/render.ts packages/web/src/editor.ts
git commit -m "refactor: remove signal threading from card builders"
```

---

## Task 5: Verify fix with Chrome DevTools

This is a manual verification step.

### Step 1: Build for dev

Run: `npm run dev`

### Step 2: Profile in Chrome

1. Open the dev server URL in Chrome
2. Open a large .hsf file (1000+ rules) in the viewer
3. Enter edit mode
4. Open DevTools → Performance → Record
5. Switch through 5+ pages
6. Stop recording
7. Check `UpdateCounters` / Performance Monitor:
   - DOM node count should stay roughly flat across page switches
   - Event listener count should not grow with each page switch
   - Memory should not grow monotonically

### Step 3: Compare before/after

Before (from trace): +97,707 nodes per page switch, +3,608 listeners
After (expected): ~0 growth per page switch (only pagination control listeners replaced)

---

## Event Bubbling Compatibility Note

The `change` event on `<select>` elements bubbles in all browsers. The `input` event on `<input>` elements bubbles. The `click` event bubbles. Drag events (`dragstart`, `dragend`, `dragover`, `drop`, `dragleave`) all bubble.

**Test caveat**: `new Event("change")` in jsdom/vitest does NOT bubble by default. If tests fail, update test code to use `new Event("change", { bubbles: true })`. Same for `new Event("input", { bubbles: true })`. The `.click()` method always bubbles, so those tests are fine.
