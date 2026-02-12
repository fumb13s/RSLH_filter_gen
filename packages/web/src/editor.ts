/**
 * Editable rule cards for the Viewer's edit mode.
 */
import type { HsfFilter, HsfRule, HsfSubstat } from "@rslh/core";
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  HSF_RARITY_IDS,
  FACTION_NAMES,
  emptySubstat,
} from "@rslh/core";
import { esc } from "./render.js";

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

/** Index of the rule currently being dragged, or -1 if none. */
let dragSourceIndex = -1;

function clearDropIndicators(container: Element): void {
  for (const el of container.querySelectorAll(".edit-drop-above, .edit-drop-below")) {
    el.classList.remove("edit-drop-above", "edit-drop-below");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderEditableRules(
  filter: HsfFilter,
  callbacks: RuleEditorCallbacks,
): void {
  const container = document.getElementById("rules-container")!;
  container.innerHTML = "";

  const total = filter.Rules.length;
  filter.Rules.forEach((rule, i) => {
    container.appendChild(buildEditableRuleCard(rule, i, total, callbacks));
  });

  // Container-level drop indicator cleanup
  container.addEventListener("dragleave", (e) => {
    if (!container.contains(e.relatedTarget as Node)) {
      clearDropIndicators(container);
    }
  });
}

export function clearEditor(): void {
  document.getElementById("rules-container")!.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildEditableRuleCard(
  rule: HsfRule,
  index: number,
  total: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "edit-card";
  card.dataset.ruleIndex = String(index);
  card.draggable = true;
  if (!rule.Use) card.classList.add("inactive");
  card.classList.add(rule.Keep ? "keep" : "sell");

  // --- Drag-and-drop ---
  card.addEventListener("dragstart", (e) => {
    dragSourceIndex = index;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", String(index));
    card.classList.add("edit-card-dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("edit-card-dragging");
    dragSourceIndex = -1;
    const container = card.parentElement;
    if (container) clearDropIndicators(container);
  });

  card.addEventListener("dragover", (e) => {
    if (dragSourceIndex === -1) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";

    const container = card.parentElement!;
    clearDropIndicators(container);

    const targetIndex = Number(card.dataset.ruleIndex);
    if (targetIndex === dragSourceIndex) return;

    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      card.classList.add("edit-drop-above");
    } else {
      card.classList.add("edit-drop-below");
    }
  });

  card.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = dragSourceIndex;
    if (from === -1) return;

    const targetIndex = Number(card.dataset.ruleIndex);
    if (from === targetIndex) return;

    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    let to = e.clientY < midY ? targetIndex : targetIndex + 1;
    // Adjust: if dragging downward past the original position, the splice
    // removes the source first, shifting indices down by 1
    if (from < to) to--;
    if (from !== to) cb.onRuleMove(from, to);
  });

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
  keepBtn.addEventListener("click", () => {
    rule.Keep = !rule.Keep;
    keepBtn.textContent = rule.Keep ? "Keep" : "Sell";
    keepBtn.className = `edit-badge-toggle ${rule.Keep ? "badge-keep" : "badge-sell"}`;
    card.classList.toggle("keep", rule.Keep);
    card.classList.toggle("sell", !rule.Keep);
    cb.onRuleChange(index, rule);
  });
  header.appendChild(keepBtn);

  // Active/Inactive toggle
  const useBtn = document.createElement("button");
  useBtn.type = "button";
  useBtn.className = `edit-badge-toggle ${rule.Use ? "badge-active" : "badge-inactive"}`;
  useBtn.textContent = rule.Use ? "Active" : "Inactive";
  useBtn.addEventListener("click", () => {
    rule.Use = !rule.Use;
    useBtn.textContent = rule.Use ? "Active" : "Inactive";
    useBtn.className = `edit-badge-toggle ${rule.Use ? "badge-active" : "badge-inactive"}`;
    card.classList.toggle("inactive", !rule.Use);
    cb.onRuleChange(index, rule);
  });
  header.appendChild(useBtn);

  // Move up
  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "edit-move-btn";
  upBtn.textContent = "\u25b2";
  upBtn.title = "Move up";
  upBtn.disabled = index === 0;
  upBtn.addEventListener("click", () => cb.onRuleMove(index, index - 1));
  header.appendChild(upBtn);

  // Move down
  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "edit-move-btn";
  downBtn.textContent = "\u25bc";
  downBtn.title = "Move down";
  downBtn.disabled = index === total - 1;
  downBtn.addEventListener("click", () => cb.onRuleMove(index, index + 1));
  header.appendChild(downBtn);

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "edit-delete-btn";
  delBtn.textContent = "\u00d7";
  delBtn.title = "Delete rule";
  delBtn.addEventListener("click", () => cb.onRuleDelete(index));
  header.appendChild(delBtn);

  card.appendChild(header);

  // --- Body fields ---
  const body = document.createElement("div");
  body.className = "edit-body";

  // Sets — searchable multi-select dropdown (reuse pattern from generator)
  body.appendChild(buildSetField(rule, index, cb));

  // Slots — checkbox grid
  body.appendChild(buildSlotField(rule, index, cb));

  // Rank dropdown
  body.appendChild(
    buildSelectField("Rank", rule.Rank, [
      { value: 0, label: "Any" },
      { value: 5, label: "5-star" },
      { value: 6, label: "6-star" },
    ], (val) => {
      rule.Rank = val;
      cb.onRuleChange(index, rule);
    }),
  );

  // Rarity dropdown
  const rarityOpts: { value: number; label: string }[] = [{ value: 0, label: "Any" }];
  for (const [id, name] of Object.entries(HSF_RARITY_IDS)) {
    rarityOpts.push({ value: Number(id), label: name });
  }
  body.appendChild(
    buildSelectField("Rarity", rule.Rarity, rarityOpts, (val) => {
      rule.Rarity = val;
      cb.onRuleChange(index, rule);
    }),
  );

  // Main Stat dropdown — encodes both MainStatID and MainStatF
  body.appendChild(buildMainStatField(rule, index, cb));

  // Level dropdown
  const levelOpts = Array.from({ length: 17 }, (_, i) => ({ value: i, label: String(i) }));
  body.appendChild(
    buildSelectField("Level", rule.LVLForCheck, levelOpts, (val) => {
      rule.LVLForCheck = val;
      cb.onRuleChange(index, rule);
    }),
  );

  // Faction dropdown
  const factionOpts: { value: number; label: string }[] = [{ value: 0, label: "Any" }];
  for (const [id, name] of Object.entries(FACTION_NAMES)) {
    factionOpts.push({ value: Number(id), label: name });
  }
  body.appendChild(
    buildSelectField("Faction", rule.Faction, factionOpts, (val) => {
      rule.Faction = val;
      cb.onRuleChange(index, rule);
    }),
  );

  card.appendChild(body);

  // --- Substats ---
  card.appendChild(buildSubstatsSection(rule, index, cb));

  return card;
}

// ---------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------

function buildSelectField(
  labelText: string,
  current: number,
  options: { value: number; label: string }[],
  onChange: (value: number) => void,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";

  const label = document.createElement("label");
  label.textContent = labelText;
  field.appendChild(label);

  const select = document.createElement("select");
  for (const opt of options) {
    const option = document.createElement("option");
    option.value = String(opt.value);
    option.textContent = esc(opt.label);
    if (opt.value === current) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(Number(select.value)));
  field.appendChild(select);

  return field;
}

// ---------------------------------------------------------------------------
// Main Stat selector — encodes MainStatID + MainStatF together
// ---------------------------------------------------------------------------

/** All main stat options: same variants as SUBSTAT_OPTIONS. */
const MAIN_STAT_OPTIONS = SUBSTAT_OPTIONS;

function encodeMainStat(rule: HsfRule): string {
  if (rule.MainStatID === -1) return "-1";
  // MainStatF: 0 = flat, 1 = percentage
  const isFlat = rule.MainStatF === 0;
  return `${rule.MainStatID}:${isFlat ? 1 : 0}`;
}

function buildMainStatField(
  rule: HsfRule,
  index: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";

  const label = document.createElement("label");
  label.textContent = "Main Stat";
  field.appendChild(label);

  const select = document.createElement("select");

  const noneOpt = document.createElement("option");
  noneOpt.value = "-1";
  noneOpt.textContent = "Any";
  select.appendChild(noneOpt);

  for (const opt of MAIN_STAT_OPTIONS) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  select.value = encodeMainStat(rule);

  select.addEventListener("change", () => {
    const val = select.value;
    if (val === "-1") {
      rule.MainStatID = -1;
      rule.MainStatF = 1;
    } else {
      const [statId, flatFlag] = val.split(":").map(Number);
      rule.MainStatID = statId;
      rule.MainStatF = flatFlag === 1 ? 0 : 1; // flatFlag=1 → isFlat → MainStatF=0
    }
    cb.onRuleChange(index, rule);
  });

  field.appendChild(select);
  return field;
}

// ---------------------------------------------------------------------------
// Set selector — searchable checklist dropdown (like generator)
// ---------------------------------------------------------------------------

function buildSetField(
  rule: HsfRule,
  index: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
  const field = document.createElement("div");
  field.className = "edit-field";
  field.style.gridColumn = "1 / -1";

  const label = document.createElement("label");
  label.textContent = "Sets";
  field.appendChild(label);

  const dropdown = document.createElement("div");
  dropdown.className = "set-selector";
  dropdown.style.flex = "1";

  const currentSets = rule.ArtifactSet ?? [];

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "set-selector-toggle";
  toggle.textContent = summariseSets(currentSets);
  dropdown.appendChild(toggle);

  const panel = document.createElement("div");
  panel.className = "set-selector-panel";

  const search = document.createElement("input");
  search.type = "text";
  search.className = "set-selector-search";
  search.placeholder = "Search sets\u2026";
  panel.appendChild(search);

  const list = document.createElement("div");
  list.className = "set-selector-list";

  const entries = Object.entries(ARTIFACT_SET_NAMES)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const row = document.createElement("label");
    row.className = "set-selector-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(entry.id);
    checkbox.checked = currentSets.includes(entry.id);
    checkbox.addEventListener("change", () => {
      let sets = rule.ArtifactSet ?? [];
      if (checkbox.checked) {
        sets.push(entry.id);
      } else {
        sets = sets.filter((s) => s !== entry.id);
      }
      rule.ArtifactSet = sets.length > 0 ? sets : undefined;
      toggle.textContent = summariseSets(sets);
      cb.onRuleChange(index, rule);
    });
    row.appendChild(checkbox);

    const span = document.createElement("span");
    span.textContent = entry.name;
    row.appendChild(span);

    list.appendChild(row);
  }

  panel.appendChild(list);
  dropdown.appendChild(panel);

  search.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    for (const item of list.children) {
      const text = (item as HTMLElement).textContent!.toLowerCase();
      (item as HTMLElement).hidden = !text.includes(q);
    }
  });

  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) search.focus();
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target as Node)) {
      panel.classList.remove("open");
    }
  });

  field.appendChild(dropdown);
  return field;
}

function summariseSets(ids: number[]): string {
  const filtered = ids.filter((id) => id !== 0);
  if (filtered.length === 0) return "Any set";
  if (filtered.length <= 3) {
    return filtered.map((id) => ARTIFACT_SET_NAMES[id] ?? `Unknown(${id})`).join(", ");
  }
  return `${filtered.length} sets selected`;
}

// ---------------------------------------------------------------------------
// Slot selector — checkbox grid
// ---------------------------------------------------------------------------

function buildSlotField(
  rule: HsfRule,
  index: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
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
    checkbox.addEventListener("change", () => {
      let slots = rule.ArtifactType ?? [];
      if (checkbox.checked) {
        slots.push(id);
      } else {
        slots = slots.filter((s) => s !== id);
      }
      rule.ArtifactType = slots.length > 0 ? slots : undefined;
      cb.onRuleChange(index, rule);
    });
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

function buildSubstatsSection(
  rule: HsfRule,
  index: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "edit-substats";

  const title = document.createElement("div");
  title.className = "edit-substats-title";
  title.textContent = "Substats";
  section.appendChild(title);

  for (let i = 0; i < 4; i++) {
    section.appendChild(buildSubstatRow(rule, i, index, cb));
  }

  return section;
}

function encodeSubstatValue(s: HsfSubstat): string {
  if (s.ID === -1) return "-1";
  return `${s.ID}:${s.IsFlat ? 1 : 0}`;
}

function buildSubstatRow(
  rule: HsfRule,
  subIndex: number,
  ruleIndex: number,
  cb: RuleEditorCallbacks,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "edit-substat-row";
  const sub = rule.Substats[subIndex];

  // Stat dropdown
  const statSelect = document.createElement("select");
  statSelect.className = "edit-sub-stat";

  const noneOpt = document.createElement("option");
  noneOpt.value = "-1";
  noneOpt.textContent = "None";
  statSelect.appendChild(noneOpt);

  for (const opt of SUBSTAT_OPTIONS) {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    statSelect.appendChild(option);
  }
  statSelect.value = encodeSubstatValue(sub);

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

  // Wire events
  statSelect.addEventListener("change", () => {
    const val = statSelect.value;
    if (val === "-1") {
      rule.Substats[subIndex] = emptySubstat();
      condSelect.disabled = true;
      valueInput.disabled = true;
      condSelect.value = ">=";
      valueInput.value = "0";
    } else {
      const [statId, flatFlag] = val.split(":").map(Number);
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
    cb.onRuleChange(ruleIndex, rule);
  });

  condSelect.addEventListener("change", () => {
    rule.Substats[subIndex] = {
      ...rule.Substats[subIndex],
      Condition: condSelect.value,
    };
    cb.onRuleChange(ruleIndex, rule);
  });

  valueInput.addEventListener("input", () => {
    rule.Substats[subIndex] = {
      ...rule.Substats[subIndex],
      Value: Number(valueInput.value) || 0,
    };
    cb.onRuleChange(ruleIndex, rule);
  });

  row.appendChild(statSelect);
  row.appendChild(condSelect);
  row.appendChild(valueInput);

  return row;
}
