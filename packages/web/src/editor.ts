/**
 * Editable rule cards for the Viewer's edit mode.
 *
 * Uses event delegation: a single set of listeners on #rules-container
 * handles all card interactions. This eliminates per-card closures that
 * previously retained detached DOM nodes across page switches.
 */
import type { HsfFilter, HsfRule } from "@rslh/core";
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  HSF_RARITY_IDS,
  FACTION_NAMES,
  emptySubstat,
} from "@rslh/core";
import { getCurrentFilter, renderPaginatedCards } from "./render.js";
import { SharedDropdown } from "./shared-dropdown.js";
import type { DropdownOption } from "./shared-dropdown.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleEditorCallbacks {
  onRuleChange(index: number, rule: HsfRule): void;
  onRuleDelete(index: number): void;
  onRuleMove(from: number, to: number): void;
  onRuleAdd(): void;
}

// ---------------------------------------------------------------------------
// All substat variants — encoded as "statId:isFlat" for <option> values
// ---------------------------------------------------------------------------

const SUBSTAT_OPTIONS: { value: string; label: string }[] = [
  { value: "1:1", label: "HP" },
  { value: "1:0", label: "HP%" },
  { value: "2:1", label: "ATK" },
  { value: "2:0", label: "ATK%" },
  { value: "3:1", label: "DEF" },
  { value: "3:0", label: "DEF%" },
  { value: "4:1", label: "SPD" },
  { value: "5:0", label: "C.RATE" },
  { value: "6:0", label: "C.DMG" },
  { value: "7:1", label: "RES" },
  { value: "8:1", label: "ACC" },
];

const CONDITION_OPTIONS = [">=", ">", "=", "<=", "<"];

const CONDITION_DROPDOWN_OPTIONS: DropdownOption[] = CONDITION_OPTIONS.map(
  (c) => ({ value: c, label: c }),
);

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

// ---------------------------------------------------------------------------
// Shared dropdown lifecycle
// ---------------------------------------------------------------------------

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
    "substat-condition": new SharedDropdown("substat-condition", CONDITION_DROPDOWN_OPTIONS),
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

/** Index of the rule currently being dragged, or -1 if none. */
let dragSourceIndex = -1;

/** Current callbacks — set once when edit mode starts, read by delegation handlers. */
let currentCallbacks: RuleEditorCallbacks | null = null;

function clearDropIndicators(container: Element): void {
  for (const el of container.querySelectorAll(".edit-drop-above, .edit-drop-below")) {
    el.classList.remove("edit-drop-above", "edit-drop-below");
  }
}

// ---------------------------------------------------------------------------
// Delegation handlers
// ---------------------------------------------------------------------------

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
        populateSetPanel(panel, rule.ArtifactSet ?? []);
      }
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) {
        const search = panel.querySelector<HTMLInputElement>(".set-selector-search");
        if (search) search.focus();
      }
      break;
    }
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
  }
}

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

function handleContainerInput(e: Event): void {
  const target = e.target as HTMLElement;
  const card = target.closest(".edit-card") as HTMLElement | null;
  if (!card) return;

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

  // Substat value input
  const row = target.closest(".edit-substat-row") as HTMLElement | null;
  if (row && target instanceof HTMLInputElement && target.type === "number") {
    const index = Number(card.dataset.ruleIndex);
    const filter = getCurrentFilter();
    if (!filter || !currentCallbacks) return;
    const rule = filter.Rules[index];
    const subIndex = Number(row.dataset.subIndex);
    rule.Substats[subIndex] = {
      ...rule.Substats[subIndex],
      Value: Number(target.value) || 0,
    };
    currentCallbacks.onRuleChange(index, rule);
    return;
  }
}

// --- Drag delegation ---

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

function handleContainerDragLeave(e: DragEvent): void {
  const container = document.getElementById("rules-container")!;
  if (!container.contains(e.relatedTarget as Node)) {
    clearDropIndicators(container);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderEditableRules(
  filter: HsfFilter,
  callbacks: RuleEditorCallbacks,
): void {
  initDropdowns();
  currentCallbacks = callbacks;
  const total = filter.Rules.length;
  renderPaginatedCards(
    filter,
    (rule, i) => buildEditableRuleCard(rule, i, total),
    false,
    closeAllDropdowns,
  );

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

export function clearEditor(): void {
  destroyDropdowns();
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

// ---------------------------------------------------------------------------
// Card builder — pure DOM construction, no event listeners
// ---------------------------------------------------------------------------

function buildEditableRuleCard(
  rule: HsfRule,
  index: number,
  total: number,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "edit-card";
  card.id = `rule-${index + 1}`;
  card.dataset.ruleIndex = String(index);
  card.draggable = true;
  if (!rule.Use) card.classList.add("inactive");
  card.classList.add(rule.Keep ? "keep" : "sell");

  // --- Header ---
  const header = document.createElement("div");
  header.className = "edit-header";

  // Drag handle
  const dragHandle = document.createElement("span");
  dragHandle.className = "edit-drag-handle";
  dragHandle.textContent = "\u2630";
  dragHandle.title = "Drag to reorder";
  header.appendChild(dragHandle);

  const indexSpan = document.createElement("span");
  indexSpan.className = "rule-index";
  indexSpan.textContent = `#${index + 1}`;
  header.appendChild(indexSpan);

  // Keep/Sell toggle
  const keepBtn = document.createElement("button");
  keepBtn.type = "button";
  keepBtn.className = `edit-badge-toggle ${rule.Keep ? "badge-keep" : "badge-sell"}`;
  keepBtn.textContent = rule.Keep ? "Keep" : "Sell";
  keepBtn.dataset.action = "keep-toggle";
  header.appendChild(keepBtn);

  // Active/Inactive toggle
  const useBtn = document.createElement("button");
  useBtn.type = "button";
  useBtn.className = `edit-badge-toggle ${rule.Use ? "badge-active" : "badge-inactive"}`;
  useBtn.textContent = rule.Use ? "Active" : "Inactive";
  useBtn.dataset.action = "use-toggle";
  header.appendChild(useBtn);

  // Move up
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "edit-move-btn";
  upBtn.textContent = "\u25b2";
  upBtn.title = "Move up";
  upBtn.disabled = index === 0;
  upBtn.dataset.action = "move-up";
  header.appendChild(upBtn);

  // Move down
  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "edit-move-btn";
  downBtn.textContent = "\u25bc";
  downBtn.title = "Move down";
  downBtn.disabled = index === total - 1;
  downBtn.dataset.action = "move-down";
  header.appendChild(downBtn);

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "edit-delete-btn";
  delBtn.textContent = "\u00d7";
  delBtn.title = "Delete rule";
  delBtn.dataset.action = "delete";
  header.appendChild(delBtn);

  card.appendChild(header);

  // --- Body fields ---
  const body = document.createElement("div");
  body.className = "edit-body";

  body.appendChild(buildSetField(rule));
  body.appendChild(buildSlotField(rule));
  body.appendChild(buildTriggerField("Rank", "rank", String(rule.Rank)));
  body.appendChild(buildTriggerField("Rarity", "rarity", String(rule.Rarity)));
  body.appendChild(buildTriggerField("Main Stat", "main-stat", encodeMainStat(rule)));
  body.appendChild(buildTriggerField("Level", "level", String(rule.LVLForCheck)));
  body.appendChild(buildTriggerField("Faction", "faction", String(rule.Faction)));

  card.appendChild(body);

  // --- Substats ---
  card.appendChild(buildSubstatsSection(rule));

  return card;
}

// ---------------------------------------------------------------------------
// Trigger button builders — pure DOM, no listeners
// ---------------------------------------------------------------------------

const OPTION_ARRAYS: Record<string, DropdownOption[]> = {
  rank: RANK_OPTIONS,
  rarity: RARITY_OPTIONS,
  "main-stat": MAIN_STAT_DROPDOWN_OPTIONS,
  level: LEVEL_OPTIONS,
  faction: FACTION_OPTIONS,
  "substat-stat": SUBSTAT_STAT_DROPDOWN_OPTIONS,
  "substat-condition": CONDITION_DROPDOWN_OPTIONS,
};

function getLabelForValue(fieldType: string, value: string): string {
  const opts = OPTION_ARRAYS[fieldType];
  return opts?.find((o) => o.value === value)?.label ?? value;
}

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

// ---------------------------------------------------------------------------
// Value encoding helpers
// ---------------------------------------------------------------------------

function encodeMainStat(rule: HsfRule): string {
  if (rule.MainStatID === -1) return "-1";
  // MainStatF=1 means percent (flatFlag=0), MainStatF=0 means flat (flatFlag=1)
  return `${rule.MainStatID}:${rule.MainStatF === 1 ? 0 : 1}`;
}

function encodeSubstatValue(sub: { ID: number; IsFlat: boolean }): string {
  if (sub.ID === -1) return "-1";
  return `${sub.ID}:${sub.IsFlat ? 1 : 0}`;
}

// ---------------------------------------------------------------------------
// Set selector
// ---------------------------------------------------------------------------

const SORTED_SET_ENTRIES = Object.entries(ARTIFACT_SET_NAMES)
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.name.localeCompare(b.name));

function buildSetField(rule: HsfRule): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";
  field.style.gridColumn = "1 / -1";

  const label = document.createElement("label");
  label.textContent = "Sets";
  field.appendChild(label);

  const dropdown = document.createElement("div");
  dropdown.className = "set-selector";
  dropdown.style.flex = "1";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "set-selector-toggle";
  toggle.textContent = summariseSets(rule.ArtifactSet ?? []);
  toggle.dataset.action = "set-toggle";
  dropdown.appendChild(toggle);

  const panel = document.createElement("div");
  panel.className = "set-selector-panel";
  dropdown.appendChild(panel);

  field.appendChild(dropdown);
  return field;
}

function populateSetPanel(panel: HTMLElement, currentSets: number[]): void {
  const search = document.createElement("input");
  search.type = "text";
  search.className = "set-selector-search";
  search.placeholder = "Search sets\u2026";
  search.dataset.action = "set-search";
  panel.appendChild(search);

  const list = document.createElement("div");
  list.className = "set-selector-list";

  for (const entry of SORTED_SET_ENTRIES) {
    const row = document.createElement("label");
    row.className = "set-selector-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(entry.id);
    checkbox.checked = currentSets.includes(entry.id);
    checkbox.dataset.action = "set-check";
    checkbox.dataset.setId = String(entry.id);
    row.appendChild(checkbox);

    const span = document.createElement("span");
    span.textContent = entry.name;
    row.appendChild(span);

    list.appendChild(row);
  }

  panel.appendChild(list);
}

function summariseSets(ids: number[]): string {
  const filtered = ids.filter((id) => id !== 0);
  if (filtered.length === 0) return "Any set";
  const names = filtered
    .map((id) => ARTIFACT_SET_NAMES[id] ?? `Unknown(${id})`)
    .sort((a, b) => a.localeCompare(b));
  if (names.length <= 4) return names.join(", ");
  return `${names.slice(0, 4).join(", ")}, \u2026 (${names.length} sets)`;
}

// ---------------------------------------------------------------------------
// Slot selector
// ---------------------------------------------------------------------------

function buildSlotField(rule: HsfRule): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";
  field.style.gridColumn = "1 / -1";

  const label = document.createElement("label");
  label.textContent = "Slots";
  field.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "slot-checkboxes";
  grid.style.flex = "1";

  const currentSlots = rule.ArtifactType ?? [];
  const slotOrder = [5, 1, 6, 3, 2, 4, 7, 8, 9];

  for (const id of slotOrder) {
    const name = ARTIFACT_SLOT_NAMES[id];
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(id);
    checkbox.checked = currentSlots.includes(id);
    checkbox.dataset.action = "slot-check";
    checkbox.dataset.slotId = String(id);
    lbl.appendChild(checkbox);

    const span = document.createElement("span");
    span.textContent = name;
    lbl.appendChild(span);

    grid.appendChild(lbl);
  }

  field.appendChild(grid);
  return field;
}

// ---------------------------------------------------------------------------
// Substats section
// ---------------------------------------------------------------------------

function buildSubstatsSection(rule: HsfRule): HTMLElement {
  const section = document.createElement("div");
  section.className = "edit-substats";

  const title = document.createElement("div");
  title.className = "edit-substats-title";
  title.textContent = "Substats";
  section.appendChild(title);

  for (let i = 0; i < 4; i++) {
    section.appendChild(buildSubstatRow(rule, i));
  }

  return section;
}

function buildSubstatRow(rule: HsfRule, subIndex: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "edit-substat-row";
  row.dataset.subIndex = String(subIndex);
  const sub = rule.Substats[subIndex];

  // Stat trigger button (replaces <select>)
  const encoded = encodeSubstatValue(sub);
  const statTrigger = buildTriggerButton(
    "substat-stat",
    encoded,
    sub.ID === -1 ? "None" : getLabelForValue("substat-stat", encoded),
  );
  statTrigger.className = "edit-sub-stat edit-dropdown-trigger";
  statTrigger.dataset.subIndex = String(subIndex);

  // Condition dropdown
  const condSelect = document.createElement("select");
  condSelect.className = "edit-sub-cond";
  for (const cond of CONDITION_OPTIONS) {
    const option = document.createElement("option");
    option.value = cond;
    option.textContent = cond;
    if (cond === (sub.Condition || ">=")) option.selected = true;
    condSelect.appendChild(option);
  }

  // Value input
  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.min = "0";
  valueInput.value = String(sub.Value);

  // Disable condition/value when stat is "None"
  const isNone = sub.ID === -1;
  condSelect.disabled = isNone;
  valueInput.disabled = isNone;

  row.appendChild(statTrigger);
  row.appendChild(condSelect);
  row.appendChild(valueInput);

  return row;
}
