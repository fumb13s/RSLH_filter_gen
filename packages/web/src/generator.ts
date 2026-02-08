/**
 * Generator tab — setting group cards for artifact filter generation.
 */
import {
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  statDisplayName,
} from "@rslh/core";
import { getSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingGroup {
  sets: number[];
  slots: number[];
  mainStats: [number, boolean][];       // [statId, isFlat]
  goodStats: [number, boolean][];      // [statId, isFlat]
  rolls: number;                       // 4–9
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

/** Substats eligible as "good stats" — excludes flat HP/ATK/DEF (no roll range data). */
const GOOD_SUBSTATS = ALL_SUBSTATS.filter(
  ([id, flat]) => !(flat && id <= 3),
);

/** Good substat presets. */
export const SUBSTAT_PRESETS: { label: string; stats: [number, boolean][] }[] = [
  { label: "HP Nuker",  stats: [[1, false], [4, true], [5, false], [6, false]] },
  { label: "ATK Nuker", stats: [[2, false], [4, true], [5, false], [6, false]] },
  { label: "DEF Nuker", stats: [[3, false], [4, true], [5, false], [6, false]] },
  { label: "Support",   stats: [[1, false], [3, false], [4, true], [7, true], [8, true]] },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function defaultGroup(): SettingGroup {
  return { sets: [], slots: [], mainStats: [], goodStats: [], rolls: getSettings().generatorDefaultRolls };
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

  // Main stat selector
  card.appendChild(buildMainStatSelector(group, index, cb));

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

  const headerRow = document.createElement("div");
  headerRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Sets";
  headerRow.appendChild(label);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "preset-btn";
  clearBtn.textContent = "Clear";
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

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

  // Clear button
  clearBtn.addEventListener("click", () => {
    group.sets = [];
    for (const item of list.children) {
      const input = (item as HTMLElement).querySelector("input");
      if (input) input.checked = false;
    }
    toggle.textContent = summariseSets(group.sets);
    cb.onGroupChange(index, group);
  });

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

  const SLOT_PRESETS: { label: string; ids: number[] }[] = [
    { label: "Upper",  ids: [5, 1, 6] },
    { label: "Lower",  ids: [3, 2, 4] },
    { label: "Jewels", ids: [7, 8, 9] },
  ];

  for (const preset of SLOT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.textContent = preset.label;
    headerRow.appendChild(btn);
    // Wire after checkboxes are created
    btn.addEventListener("click", () => applySlotPreset(preset.ids));
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "preset-btn";
  clearBtn.textContent = "Clear";
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const grid = document.createElement("div");
  grid.className = "slot-checkboxes";

  const checkboxes: HTMLInputElement[] = [];

  // Display order: weapon/helmet/shield, gloves/chest/boots, ring/amulet/banner
  const slotOrder = [5, 1, 6, 3, 2, 4, 7, 8, 9];
  for (const id of slotOrder) {
    const name = ARTIFACT_SLOT_NAMES[id];
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

  function applySlotPreset(ids: number[]): void {
    group.slots = [...ids];
    for (const c of checkboxes) {
      c.checked = ids.includes(Number(c.value));
    }
    cb.onGroupChange(index, group);
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
// Main stat selector — checkboxes
// ---------------------------------------------------------------------------

function buildMainStatSelector(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const headerRow = document.createElement("div");
  headerRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Main Stat";
  headerRow.appendChild(label);

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
    checkbox.checked = group.mainStats.some(([s, f]) => s === statId && f === isFlat);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        group.mainStats.push([statId, isFlat]);
      } else {
        group.mainStats = group.mainStats.filter(([s, f]) => !(s === statId && f === isFlat));
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
    group.mainStats = [];
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
  const presetBtns: HTMLButtonElement[] = [];
  for (const preset of SUBSTAT_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.textContent = preset.label;
    presetBtns.push(btn);
    headerRow.appendChild(btn);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "preset-btn";
  clearBtn.textContent = "Clear";
  headerRow.appendChild(clearBtn);

  wrap.appendChild(headerRow);

  const grid = document.createElement("div");
  grid.className = "substat-checkboxes";

  const checkboxes: HTMLInputElement[] = [];

  for (const [statId, isFlat] of GOOD_SUBSTATS) {
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

  // Wire preset buttons — apply preset by syncing checkboxes
  function applyPreset(stats: [number, boolean][]): void {
    group.goodStats = stats.map(([s, f]) => [s, f]);
    for (const c of checkboxes) {
      const sid = Number(c.dataset.statId);
      const flat = c.dataset.isFlat === "true";
      c.checked = stats.some(([s, f]) => s === sid && f === flat);
    }
    cb.onGroupChange(index, group);
  }

  for (let i = 0; i < SUBSTAT_PRESETS.length; i++) {
    presetBtns[i].addEventListener("click", () => applyPreset(SUBSTAT_PRESETS[i].stats));
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

const ROLL_PRESETS: { label: string; value: number }[] = [
  { label: "Mid Game", value: 4 },
  { label: "Late Game", value: 6 },
  { label: "End Game", value: 7 },
];

function buildRollControl(group: SettingGroup, index: number, cb: GeneratorCallbacks): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "group-section";

  const labelRow = document.createElement("div");
  labelRow.className = "section-label-row";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Good Rolls at Level 16";
  labelRow.appendChild(label);

  for (const preset of ROLL_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      group.rolls = preset.value;
      slider.value = String(preset.value);
      valueDisplay.textContent = String(preset.value);
      cb.onGroupChange(index, group);
    });
    labelRow.appendChild(btn);
  }

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
  updateSliderFill(slider);
  slider.addEventListener("input", () => {
    group.rolls = Number(slider.value);
    valueDisplay.textContent = slider.value;
    updateSliderFill(slider);
    cb.onGroupChange(index, group);
  });

  wrap.appendChild(slider);

  // Patch preset buttons to also update slider fill
  for (const btn of labelRow.querySelectorAll<HTMLButtonElement>(".preset-btn")) {
    btn.addEventListener("click", () => updateSliderFill(slider));
  }

  return wrap;
}

/** Map slider value (4–9) to a blue shade: lighter at 4, darker at 9. */
function updateSliderFill(slider: HTMLInputElement): void {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const val = Number(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  // Lightness: 65% at min → 35% at max (always recognizably blue)
  const lightness = 65 - ((val - min) / (max - min)) * 30;
  const color = `hsl(217, 80%, ${lightness}%)`;
  slider.style.setProperty("--slider-color", color);
  slider.style.background = `linear-gradient(to right, ${color} ${pct}%, #e5e7eb ${pct}%)`;
}
