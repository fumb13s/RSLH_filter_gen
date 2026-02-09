/**
 * Quick Generator — two-axis approach: set tiers x build profiles.
 */
import { ARTIFACT_SET_NAMES, ACCESSORY_SET_IDS, FACTION_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS } from "./generator.js";
import type { SettingGroup } from "./generator.js";
import { getSettings } from "./settings.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SetTier {
  name: string;
  rolls: number;    // 4-9, or -1 for "Sell"
  color: string;    // CSS color for chips/header
  sellRolls?: number; // stashed rolls value while in sell mode
}

export interface QuickBlock {
  name?: string;
  tiers: SetTier[];
  assignments: Record<number, number>; // set ID → tier index
  selectedProfiles: number[]; // indices into SUBSTAT_PRESETS
}

export interface RareAccessoryBlock {
  name?: string;
  selections: Record<number, number[]>; // setId → factionIds
}

export interface QuickGenState {
  blocks: QuickBlock[];
  rareAccessories?: RareAccessoryBlock;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Curated set-to-tier assignments extracted from the user's .fqbl file. */
const DEFAULT_ASSIGNMENTS: Record<number, number> = {
  1: 3, 2: 3, 3: 3, 4: 1, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3,
  11: 3, 12: 3, 13: 3, 14: 3, 15: 2, 16: 3, 17: 2, 18: 1, 19: 1, 20: 3,
  21: 2, 22: 3, 23: 2, 24: 3, 25: 3, 26: 3, 27: 2, 28: 3, 29: 2, 30: 2,
  31: 3, 32: 3, 33: 3, 34: 1, 35: 1, 36: 1, 37: 3, 38: 1, 39: 3, 40: 3,
  41: 3, 42: 3, 43: 3, 44: 2, 45: 3, 46: 0, 47: 0, 48: 0, 49: 3, 50: 1,
  51: 0, 52: 2, 53: 0, 54: 1, 57: 1, 58: 1, 59: 0, 60: 3, 61: 0, 62: 0,
  63: 2, 64: 0, 65: 0, 66: 0, 1000: 1, 1001: 3, 1002: 3, 1003: 0, 1004: 3,
};

function getDefaultTiers(): SetTier[] {
  const r = getSettings().quickTierRolls;
  return [
    { name: "Must-Keep", rolls: r[0], color: "#22c55e" },
    { name: "Good", rolls: r[1], color: "#3b82f6" },
    { name: "Situational", rolls: r[2], color: "#f59e0b" },
    { name: "Off-Set", rolls: r[3], color: "#ef4444" },
  ];
}

export function defaultBlock(): QuickBlock {
  const tiers = getDefaultTiers();
  const lastTier = tiers.length - 1;
  const assignments: Record<number, number> = {};
  for (const id of Object.keys(ARTIFACT_SET_NAMES)) {
    const n = Number(id);
    assignments[n] = DEFAULT_ASSIGNMENTS[n] ?? lastTier;
  }
  return {
    tiers: tiers.map((t) => ({ ...t })),
    assignments,
    selectedProfiles: [],
  };
}

export function defaultRareAccessoryBlock(): RareAccessoryBlock {
  return { selections: {} };
}

export function defaultQuickState(): QuickGenState {
  return { blocks: [defaultBlock()], rareAccessories: defaultRareAccessoryBlock() };
}

/** Strip tier colors for serialization (colors are not user-editable). */
export function stripBlockColors(state: QuickGenState): QuickGenState {
  return {
    blocks: state.blocks.map((b) => ({
      ...b,
      tiers: b.tiers.map((t) => {
        const { name, rolls, sellRolls } = t;
        return sellRolls !== undefined ? { name, rolls, sellRolls } : { name, rolls };
      }),
    })),
    rareAccessories: state.rareAccessories,
  };
}

/** Restore tier colors from defaults after deserialization. */
export function restoreBlockColors(state: QuickGenState): QuickGenState {
  const defaultColors = getDefaultTiers().map((t) => t.color);
  return {
    blocks: state.blocks.map((b) => ({
      ...b,
      tiers: b.tiers.map((t, i) => ({ ...t, color: t.color ?? defaultColors[i] ?? "#e5e7eb" })),
    })),
    rareAccessories: state.rareAccessories,
  };
}

// ---------------------------------------------------------------------------
// Cross-product: tiers x profiles → SettingGroup[]
// ---------------------------------------------------------------------------

export function quickStateToGroups(state: QuickGenState): SettingGroup[] {
  const groups: SettingGroup[] = [];

  for (const block of state.blocks) {
    for (let ti = 0; ti < block.tiers.length; ti++) {
      const tier = block.tiers[ti];
      if (tier.rolls < 0) continue;

      const sets = Object.entries(block.assignments)
        .filter(([, idx]) => idx === ti)
        .map(([id]) => Number(id));
      if (sets.length === 0) continue;

      for (const pi of block.selectedProfiles) {
        const preset = SUBSTAT_PRESETS[pi];
        if (!preset) continue;
        const goodStats: [number, boolean][] = preset.stats.map(([s, f]) => [s, f]);

        // Rank 6 rules at the tier's roll threshold
        groups.push({
          sets,
          slots: [],
          mainStats: [],
          goodStats,
          rolls: tier.rolls,
          rank: 6,
        });

        // Rank 5 rules at +2 rolls (stricter to compensate for lower rank)
        const rank5Rolls = tier.rolls + 2;
        if (rank5Rolls <= 9) {
          groups.push({
            sets,
            slots: [],
            mainStats: [],
            goodStats,
            rolls: rank5Rolls,
            rank: 5,
          });
        }
      }
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
  const container = document.getElementById("quick-tiers")!;
  container.innerHTML = "";

  // Hide the legacy profiles container — profiles now live inside each block
  const legacyProfiles = document.getElementById("quick-profiles");
  if (legacyProfiles) legacyProfiles.innerHTML = "";

  for (let bi = 0; bi < state.blocks.length; bi++) {
    const block = state.blocks[bi];

    const card = document.createElement("div");
    card.className = "quick-block";

    // Block header
    const header = document.createElement("div");
    header.className = "quick-block-header";

    const title = document.createElement("input");
    title.type = "text";
    title.className = "quick-block-title editable-title";
    title.value = block.name ?? "";
    title.placeholder = `Block ${bi + 1}`;
    title.addEventListener("input", () => {
      block.name = title.value || undefined;
    });
    title.addEventListener("blur", () => {
      block.name = title.value || undefined;
      onChange(state);
    });
    header.appendChild(title);

    if (state.blocks.length > 1) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "group-delete";
      del.textContent = "\u00d7";
      del.title = "Delete block";
      del.addEventListener("click", () => {
        state.blocks.splice(bi, 1);
        onChange(state);
      });
      header.appendChild(del);
    }

    card.appendChild(header);

    // Profiles inside this block
    renderBlockProfiles(card, block, bi, state, onChange);

    // Tiers inside this block
    renderBlockTiers(card, block, bi, state, onChange);

    container.appendChild(card);
  }

  // Rare Accessories block
  renderRareAccessories(container, state, onChange);

  // Add Block button
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "gen-add-group-btn";
  addBtn.textContent = "+ Add Block";
  addBtn.addEventListener("click", () => {
    state.blocks.push(defaultBlock());
    onChange(state);
  });
  container.appendChild(addBtn);
}

export function clearQuickGenerator(): void {
  const profiles = document.getElementById("quick-profiles");
  const tiers = document.getElementById("quick-tiers");
  if (profiles) profiles.innerHTML = "";
  if (tiers) tiers.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Profiles section (per block)
// ---------------------------------------------------------------------------

function renderBlockProfiles(
  parent: HTMLElement,
  block: QuickBlock,
  _blockIdx: number,
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
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
    cb.checked = block.selectedProfiles.includes(i);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        block.selectedProfiles.push(i);
      } else {
        block.selectedProfiles = block.selectedProfiles.filter((p) => p !== i);
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
  parent.appendChild(section);
}

// ---------------------------------------------------------------------------
// Tier columns
// ---------------------------------------------------------------------------

function renderBlockTiers(
  parent: HTMLElement,
  block: QuickBlock,
  _blockIdx: number,
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  // Columns grid
  const grid = document.createElement("div");
  grid.className = "quick-tier-columns";

  // Build column containers first so chips can be moved between them
  const columns: HTMLElement[] = [];
  const chipAreas: HTMLElement[] = [];

  for (let ti = 0; ti < block.tiers.length; ti++) {
    const tier = block.tiers[ti];

    const col = document.createElement("div");
    col.className = "quick-tier-column";
    col.style.borderTopColor = tier.color;
    col.dataset.tier = String(ti);

    const header = document.createElement("div");
    header.className = "quick-tier-column-header";
    header.style.color = tier.color;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = tier.name;
    header.appendChild(nameSpan);

    const rollsInput = document.createElement("input");
    rollsInput.type = "number";
    rollsInput.className = "quick-tier-rolls-input";
    rollsInput.min = "1";
    rollsInput.max = "9";
    rollsInput.value = String(tier.rolls);
    rollsInput.title = "Good rolls required at level 16";
    // Update state on input without re-rendering (keeps focus)
    rollsInput.addEventListener("input", () => {
      const raw = Number(rollsInput.value);
      if (!raw || raw < 1 || raw > 9) return;
      block.tiers[ti].rolls = raw;
    });
    // Clamp on blur
    rollsInput.addEventListener("blur", () => {
      const v = Math.max(1, Math.min(9, Number(rollsInput.value) || tier.rolls));
      rollsInput.value = String(v);
      block.tiers[ti].rolls = v;
    });
    // Prevent click on input from triggering column drag-over / chip events
    rollsInput.addEventListener("click", (e) => e.stopPropagation());
    // Blur when mouse leaves so the spinner arrows disappear
    rollsInput.addEventListener("mouseleave", () => rollsInput.blur());
    // Scroll to cycle value
    rollsInput.addEventListener("wheel", (e) => {
      e.preventDefault();
      const cur = Number(rollsInput.value);
      const next = Math.max(1, Math.min(9, cur + (e.deltaY < 0 ? 1 : -1)));
      rollsInput.value = String(next);
      block.tiers[ti].rolls = next;
    });
    header.appendChild(rollsInput);

    // Sell toggle — only on the last tier
    const isLast = ti === block.tiers.length - 1;
    const isSell = tier.rolls < 0;
    if (isLast) {
      const sellLabel = document.createElement("label");
      sellLabel.className = "quick-sell-toggle";
      sellLabel.title = "Sell everything in this column instead of filtering";

      const sellCb = document.createElement("input");
      sellCb.type = "checkbox";
      sellCb.checked = isSell;
      sellLabel.appendChild(sellCb);

      const sellText = document.createElement("span");
      sellText.textContent = "Sell";
      sellLabel.appendChild(sellText);

      sellCb.addEventListener("change", () => {
        if (sellCb.checked) {
          // Stash current rolls and switch to sell mode
          block.tiers[ti].sellRolls = block.tiers[ti].rolls;
          block.tiers[ti].rolls = -1;
        } else {
          // Restore stashed rolls
          block.tiers[ti].rolls = block.tiers[ti].sellRolls ?? 9;
          delete block.tiers[ti].sellRolls;
        }
        onChange(state);
      });

      header.appendChild(sellLabel);

      // Hide rolls input in sell mode
      if (isSell) {
        rollsInput.hidden = true;
        col.style.borderTopColor = "#e5e7eb";
        header.style.color = "#6b7280";
        col.classList.add("quick-tier-sell");
      }
    }

    col.appendChild(header);

    const chipArea = document.createElement("div");
    chipArea.className = "quick-tier-chips";
    col.appendChild(chipArea);

    // Drop target
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", (e) => {
      // Only remove when actually leaving the column (not entering a child)
      if (!col.contains(e.relatedTarget as Node)) {
        col.classList.remove("drag-over");
      }
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const setId = e.dataTransfer?.getData("text/plain");
      if (!setId) return;
      const id = Number(setId);
      if (block.assignments[id] === ti) return; // already in this tier
      block.assignments[id] = ti;
      onChange(state);
    });

    columns.push(col);
    chipAreas.push(chipArea);
    grid.appendChild(col);
  }

  // Create chips — one per set, placed in the correct column

  for (const set of SORTED_SETS) {
    const tierIdx = block.assignments[set.id] ?? block.tiers.length - 1;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-chip";
    chip.draggable = true;
    chip.textContent = set.name;
    const tierIsSell = block.tiers[tierIdx].rolls < 0;
    chip.style.backgroundColor = tierIsSell ? "#e5e7eb" : block.tiers[tierIdx].color;
    chip.style.color = tierIsSell ? "#6b7280" : "#fff";
    chip.title = `${set.name} — drag to move, click to cycle tier`;

    // Drag
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", String(set.id));
      e.dataTransfer!.effectAllowed = "move";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("dragging");
      // Clean up any lingering drag-over highlights
      for (const col of columns) col.classList.remove("drag-over");
    });

    // Left-click: advance to next tier (wrap around)
    chip.addEventListener("click", () => {
      const cur = block.assignments[set.id] ?? block.tiers.length - 1;
      const next = (cur + 1) % block.tiers.length;
      block.assignments[set.id] = next;
      onChange(state);
    });

    // Right-click: go to previous tier
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cur = block.assignments[set.id] ?? block.tiers.length - 1;
      const prev = (cur - 1 + block.tiers.length) % block.tiers.length;
      block.assignments[set.id] = prev;
      onChange(state);
    });

    chipAreas[tierIdx].appendChild(chip);
  }

  parent.appendChild(grid);
}

// ---------------------------------------------------------------------------
// Rare Accessories block
// ---------------------------------------------------------------------------

/** Accessory sets sorted alphabetically for the grid. */
const SORTED_ACCESSORY_SETS = ACCESSORY_SET_IDS
  .map((id) => ({ id, name: ARTIFACT_SET_NAMES[id] ?? `Set ${id}` }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Factions sorted by ID for stable column order. */
const SORTED_FACTIONS = Object.entries(FACTION_NAMES)
  .map(([id, name]) => ({ id: Number(id), name }))
  .sort((a, b) => a.id - b.id);

function renderRareAccessories(
  container: HTMLElement,
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  if (!state.rareAccessories) state.rareAccessories = defaultRareAccessoryBlock();
  const block = state.rareAccessories;

  const card = document.createElement("div");
  card.className = "quick-block rare-acc-block";

  // Header with editable title
  const header = document.createElement("div");
  header.className = "quick-block-header";

  const title = document.createElement("input");
  title.type = "text";
  title.className = "quick-block-title editable-title";
  title.value = block.name ?? "";
  title.placeholder = "Rare Accessories";
  title.addEventListener("input", () => {
    block.name = title.value || undefined;
  });
  title.addEventListener("blur", () => {
    block.name = title.value || undefined;
    onChange(state);
  });
  header.appendChild(title);
  card.appendChild(header);

  // Table
  const table = document.createElement("table");
  table.className = "rare-acc-table";

  // Header row
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.appendChild(document.createElement("th")); // empty corner cell
  for (const faction of SORTED_FACTIONS) {
    const th = document.createElement("th");
    const span = document.createElement("span");
    span.textContent = faction.name;
    th.appendChild(span);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows — one per accessory set
  const tbody = document.createElement("tbody");
  for (const set of SORTED_ACCESSORY_SETS) {
    const row = document.createElement("tr");

    const labelCell = document.createElement("td");
    labelCell.className = "rare-acc-set-label";
    labelCell.textContent = set.name;
    row.appendChild(labelCell);

    for (const faction of SORTED_FACTIONS) {
      const td = document.createElement("td");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = (block.selections[set.id] ?? []).includes(faction.id);
      cb.addEventListener("change", () => {
        if (!block.selections[set.id]) block.selections[set.id] = [];
        if (cb.checked) {
          if (!block.selections[set.id].includes(faction.id)) {
            block.selections[set.id].push(faction.id);
          }
        } else {
          block.selections[set.id] = block.selections[set.id].filter((f) => f !== faction.id);
          if (block.selections[set.id].length === 0) delete block.selections[set.id];
        }
        onChange(state);
      });
      td.appendChild(cb);
      row.appendChild(td);
    }

    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const wrapper = document.createElement("div");
  wrapper.className = "rare-acc-scroll";
  wrapper.appendChild(table);
  card.appendChild(wrapper);

  container.appendChild(card);
}
