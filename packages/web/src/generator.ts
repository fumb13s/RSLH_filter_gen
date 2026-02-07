/**
 * Generator tab — setting group cards for artifact filter generation.
 */
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  statDisplayName,
} from "@rslh/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingGroup {
  sets: number[];
  slots: number[];
  goodStats: [number, boolean][];  // [statId, isFlat]
  rolls: number;                   // 4–9
}

export interface GeneratorCallbacks {
  onGroupChange: (index: number, group: SettingGroup) => void;
  onGroupDelete: (index: number) => void;
  onGroupAdd: () => void;
}

// ---------------------------------------------------------------------------
// All possible substat variants (union across all 9 slots) — 11 entries
// ---------------------------------------------------------------------------

const ALL_SUBSTATS: readonly [number, boolean][] = [
  [1, true],   // HP
  [1, false],  // HP%
  [2, true],   // ATK
  [2, false],  // ATK%
  [3, true],   // DEF
  [3, false],  // DEF%
  [4, true],   // SPD
  [5, false],  // C.RATE
  [6, false],  // C.DMG
  [7, true],   // RES
  [8, true],   // ACC
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function defaultGroup(): SettingGroup {
  return { sets: [], slots: [], goodStats: [], rolls: 6 };
}

export function renderGenerator(groups: SettingGroup[], callbacks: GeneratorCallbacks): void {
  const container = document.getElementById("groups-container")!;
  container.innerHTML = "";

  groups.forEach((group, i) => {
    container.appendChild(buildGroupCard(group, i, callbacks));
  });
}

export function clearGenerator(): void {
  document.getElementById("groups-container")!.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Group card builder
// ---------------------------------------------------------------------------

function buildGroupCard(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const card = document.createElement("div");
  card.className = "group-card";

  // Header
  const header = document.createElement("div");
  header.className = "group-header";

  const title = document.createElement("span");
  title.className = "group-title";
  title.textContent = `Group ${index + 1}`;
  header.appendChild(title);

  const delBtn = document.createElement("button");
  delBtn.className = "group-delete";
  delBtn.textContent = "\u00d7";
  delBtn.title = "Delete group";
  delBtn.addEventListener("click", () => cb.onGroupDelete(index));
  header.appendChild(delBtn);

  card.appendChild(header);

  // Set selector
  card.appendChild(buildSetSelector(group, index, cb));

  // Slot selector
  card.appendChild(buildSlotSelector(group, index, cb));

  // Good substats selector
  card.appendChild(buildSubstatSelector(group, index, cb));

  // Roll count
  card.appendChild(buildRollControl(group, index, cb));

  return card;
}

// ---------------------------------------------------------------------------
// Set selector — searchable checklist dropdown
// ---------------------------------------------------------------------------

function buildSetSelector(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Sets";
  wrap.appendChild(label);

  const dropdown = document.createElement("div");
  dropdown.className = "set-selector";

  // Toggle button showing current selection
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "set-selector-toggle";
  toggle.textContent = summariseSets(group.sets);
  dropdown.appendChild(toggle);

  // Panel (hidden by default — visibility controlled via .open class)
  const panel = document.createElement("div");
  panel.className = "set-selector-panel";

  // Search input
  const search = document.createElement("input");
  search.type = "text";
  search.className = "set-selector-search";
  search.placeholder = "Search sets\u2026";
  panel.appendChild(search);

  // Checklist
  const list = document.createElement("div");
  list.className = "set-selector-list";

  const entries = Object.entries(ARTIFACT_SET_NAMES)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const row = document.createElement("label");
    row.className = "set-selector-item";

    const cb_ = document.createElement("input");
    cb_.type = "checkbox";
    cb_.value = String(entry.id);
    cb_.checked = group.sets.includes(entry.id);
    cb_.addEventListener("change", () => {
      if (cb_.checked) {
        group.sets.push(entry.id);
      } else {
        group.sets = group.sets.filter((s) => s !== entry.id);
      }
      toggle.textContent = summariseSets(group.sets);
      cb.onGroupChange(index, group);
    });
    row.appendChild(cb_);

    const span = document.createElement("span");
    span.textContent = entry.name;
    row.appendChild(span);

    list.appendChild(row);
  }

  panel.appendChild(list);
  dropdown.appendChild(panel);

  // Filter on search
  search.addEventListener("input", () => {
    const q = search.value.toLowerCase();
    for (const item of list.children) {
      const text = (item as HTMLElement).textContent!.toLowerCase();
      (item as HTMLElement).hidden = !text.includes(q);
    }
  });

  // Toggle panel
  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) search.focus();
  });

  // Close panel on click outside
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target as Node)) {
      panel.classList.remove("open");
    }
  });

  wrap.appendChild(dropdown);
  return wrap;
}

function summariseSets(ids: number[]): string {
  if (ids.length === 0) return "Any set";
  if (ids.length <= 3) {
    return ids.map((id) => ARTIFACT_SET_NAMES[id] ?? `Unknown(${id})`).join(", ");
  }
  return `${ids.length} sets selected`;
}

// ---------------------------------------------------------------------------
// Slot selector — checkboxes
// ---------------------------------------------------------------------------

function buildSlotSelector(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const headerRow = document.createElement("div");
  headerRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Slots";
  headerRow.appendChild(label);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "preset-btn";
  clearBtn.textContent = "Clear";
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const grid = document.createElement("div");
  grid.className = "slot-checkboxes";

  const checkboxes: HTMLInputElement[] = [];

  for (const [idStr, name] of Object.entries(ARTIFACT_SLOT_NAMES)) {
    const id = Number(idStr);
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(id);
    checkbox.checked = group.slots.includes(id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        group.slots.push(id);
      } else {
        group.slots = group.slots.filter((s) => s !== id);
      }
      cb.onGroupChange(index, group);
    });
    lbl.appendChild(checkbox);
    checkboxes.push(checkbox);

    const span = document.createElement("span");
    span.textContent = name;
    lbl.appendChild(span);

    grid.appendChild(lbl);
  }

  clearBtn.addEventListener("click", () => {
    group.slots = [];
    for (const c of checkboxes) c.checked = false;
    cb.onGroupChange(index, group);
  });

  wrap.appendChild(grid);
  return wrap;
}

// ---------------------------------------------------------------------------
// Good substats selector — checkboxes + preset buttons
// ---------------------------------------------------------------------------

function buildSubstatSelector(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const headerRow = document.createElement("div");
  headerRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Good Substats";
  headerRow.appendChild(label);

  // Preset buttons
  const nukerBtn = document.createElement("button");
  nukerBtn.type = "button";
  nukerBtn.className = "preset-btn";
  nukerBtn.textContent = "Nuker";
  nukerBtn.addEventListener("click", () => {
    // Placeholder — no-op for now
  });
  headerRow.appendChild(nukerBtn);

  const supportBtn = document.createElement("button");
  supportBtn.type = "button";
  supportBtn.className = "preset-btn";
  supportBtn.textContent = "Support";
  supportBtn.addEventListener("click", () => {
    // Placeholder — no-op for now
  });
  headerRow.appendChild(supportBtn);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "preset-btn";
  clearBtn.textContent = "Clear";
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const grid = document.createElement("div");
  grid.className = "substat-checkboxes";

  const checkboxes: HTMLInputElement[] = [];

  for (const [statId, isFlat] of ALL_SUBSTATS) {
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.statId = String(statId);
    checkbox.dataset.isFlat = String(isFlat);
    checkbox.checked = group.goodStats.some(([s, f]) => s === statId && f === isFlat);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        group.goodStats.push([statId, isFlat]);
      } else {
        group.goodStats = group.goodStats.filter(([s, f]) => !(s === statId && f === isFlat));
      }
      cb.onGroupChange(index, group);
    });
    lbl.appendChild(checkbox);
    checkboxes.push(checkbox);

    const span = document.createElement("span");
    span.textContent = statDisplayName(statId, isFlat);
    lbl.appendChild(span);

    grid.appendChild(lbl);
  }

  clearBtn.addEventListener("click", () => {
    group.goodStats = [];
    for (const c of checkboxes) c.checked = false;
    cb.onGroupChange(index, group);
  });

  wrap.appendChild(grid);
  return wrap;
}

// ---------------------------------------------------------------------------
// Roll count control — range slider
// ---------------------------------------------------------------------------

function buildRollControl(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const labelRow = document.createElement("div");
  labelRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Min Rolls into Good Stats";
  labelRow.appendChild(label);

  const valueDisplay = document.createElement("span");
  valueDisplay.className = "roll-value";
  valueDisplay.textContent = String(group.rolls);
  labelRow.appendChild(valueDisplay);

  wrap.appendChild(labelRow);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "roll-slider";
  slider.min = "4";
  slider.max = "9";
  slider.value = String(group.rolls);
  slider.addEventListener("input", () => {
    group.rolls = Number(slider.value);
    valueDisplay.textContent = slider.value;
    cb.onGroupChange(index, group);
  });
  wrap.appendChild(slider);

  return wrap;
}
