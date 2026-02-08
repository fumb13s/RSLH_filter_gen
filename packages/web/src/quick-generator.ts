/**
 * Quick Generator — two-axis approach: set tiers x build profiles.
 */
import { ARTIFACT_SET_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS } from "./generator.js";
import type { SettingGroup } from "./generator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetTier {
  name: string;
  rolls: number; // 4-9, or -1 for "Sell"
  color: string; // CSS color for chips/header
}

export interface QuickGenState {
  tiers: SetTier[];
  assignments: Record<number, number>; // set ID → tier index
  selectedProfiles: number[]; // indices into SUBSTAT_PRESETS
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TIERS: SetTier[] = [
  { name: "Must-Keep", rolls: 4, color: "#22c55e" },
  { name: "Good", rolls: 6, color: "#3b82f6" },
  { name: "Situational", rolls: 7, color: "#f59e0b" },
  { name: "Sell", rolls: -1, color: "#e5e7eb" },
];

export function defaultQuickState(): QuickGenState {
  const assignments: Record<number, number> = {};
  const sellIdx = DEFAULT_TIERS.length - 1;
  for (const id of Object.keys(ARTIFACT_SET_NAMES)) {
    assignments[Number(id)] = sellIdx;
  }
  return {
    tiers: DEFAULT_TIERS.map((t) => ({ ...t })),
    assignments,
    selectedProfiles: [],
  };
}

// ---------------------------------------------------------------------------
// Cross-product: tiers x profiles → SettingGroup[]
// ---------------------------------------------------------------------------

export function quickStateToGroups(state: QuickGenState): SettingGroup[] {
  const groups: SettingGroup[] = [];

  for (let ti = 0; ti < state.tiers.length; ti++) {
    const tier = state.tiers[ti];
    if (tier.rolls < 0) continue; // skip Sell

    const sets = Object.entries(state.assignments)
      .filter(([, idx]) => idx === ti)
      .map(([id]) => Number(id));
    if (sets.length === 0) continue;

    for (const pi of state.selectedProfiles) {
      const preset = SUBSTAT_PRESETS[pi];
      if (!preset) continue;
      groups.push({
        sets,
        slots: [],
        mainStats: [],
        goodStats: preset.stats.map(([s, f]) => [s, f]),
        rolls: tier.rolls,
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** All sets sorted alphabetically for display. */
const SORTED_SETS = Object.entries(ARTIFACT_SET_NAMES)
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function renderQuickGenerator(
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  renderProfiles(state, onChange);
  renderTiers(state, onChange);
}

export function clearQuickGenerator(): void {
  const profiles = document.getElementById("quick-profiles");
  const tiers = document.getElementById("quick-tiers");
  if (profiles) profiles.innerHTML = "";
  if (tiers) tiers.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Profiles section
// ---------------------------------------------------------------------------

function renderProfiles(
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  const container = document.getElementById("quick-profiles")!;
  container.innerHTML = "";

  const section = document.createElement("div");
  section.className = "quick-profiles-section";

  const label = document.createElement("div");
  label.className = "section-label";
  label.textContent = "Build Profiles";
  section.appendChild(label);

  const row = document.createElement("div");
  row.className = "quick-profiles-row";

  for (let i = 0; i < SUBSTAT_PRESETS.length; i++) {
    const preset = SUBSTAT_PRESETS[i];
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.selectedProfiles.includes(i);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.selectedProfiles.push(i);
      } else {
        state.selectedProfiles = state.selectedProfiles.filter((p) => p !== i);
      }
      onChange(state);
    });
    lbl.appendChild(cb);

    const span = document.createElement("span");
    span.textContent = preset.label;
    lbl.appendChild(span);

    row.appendChild(lbl);
  }

  section.appendChild(row);
  container.appendChild(section);
}

// ---------------------------------------------------------------------------
// Tier columns
// ---------------------------------------------------------------------------

function renderTiers(
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  const container = document.getElementById("quick-tiers")!;
  container.innerHTML = "";

  // Search
  const searchWrap = document.createElement("div");
  searchWrap.className = "quick-search";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search sets\u2026";
  searchInput.className = "quick-search-input";
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  // Columns grid
  const grid = document.createElement("div");
  grid.className = "quick-tier-columns";

  // Build column containers first so chips can be moved between them
  const columns: HTMLElement[] = [];
  const chipAreas: HTMLElement[] = [];

  for (let ti = 0; ti < state.tiers.length; ti++) {
    const tier = state.tiers[ti];

    const col = document.createElement("div");
    col.className = "quick-tier-column";
    col.style.borderTopColor = tier.color;

    const header = document.createElement("div");
    header.className = "quick-tier-column-header";
    header.style.color = tier.color === "#e5e7eb" ? "#6b7280" : tier.color;
    const rollsLabel = tier.rolls < 0 ? "" : ` (${tier.rolls})`;
    header.textContent = `${tier.name}${rollsLabel}`;
    col.appendChild(header);

    const chipArea = document.createElement("div");
    chipArea.className = "quick-tier-chips";
    col.appendChild(chipArea);

    columns.push(col);
    chipAreas.push(chipArea);
    grid.appendChild(col);
  }

  // Create chips — one per set, placed in the correct column
  const allChips: { el: HTMLElement; name: string }[] = [];

  for (const set of SORTED_SETS) {
    const tierIdx = state.assignments[set.id] ?? state.tiers.length - 1;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-chip";
    chip.textContent = set.name;
    chip.style.backgroundColor = state.tiers[tierIdx].color;
    chip.style.color = tierIdx === state.tiers.length - 1 ? "#6b7280" : "#fff";
    chip.title = `${set.name} — click to cycle tier`;

    // Left-click: advance to next tier (wrap around)
    chip.addEventListener("click", () => {
      const cur = state.assignments[set.id] ?? state.tiers.length - 1;
      const next = (cur + 1) % state.tiers.length;
      state.assignments[set.id] = next;
      onChange(state);
    });

    // Right-click: go to previous tier
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cur = state.assignments[set.id] ?? state.tiers.length - 1;
      const prev = (cur - 1 + state.tiers.length) % state.tiers.length;
      state.assignments[set.id] = prev;
      onChange(state);
    });

    chipAreas[tierIdx].appendChild(chip);
    allChips.push({ el: chip, name: set.name.toLowerCase() });
  }

  // Search filtering
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.toLowerCase();
    for (const { el, name } of allChips) {
      el.hidden = q !== "" && !name.includes(q);
    }
  });

  container.appendChild(grid);
}
