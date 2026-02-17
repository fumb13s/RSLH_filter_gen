/**
 * Quick Generator — two-axis approach: set tiers x build profiles.
 */
import { ARTIFACT_SET_NAMES, ACCESSORY_SET_IDS, FACTION_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS, ORE_STATS, GOOD_SUBSTATS } from "./generator.js";
import type { SettingGroup } from "./generator.js";
import { statDisplayName } from "@rslh/core";
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

export interface CustomProfile {
  label: string;                    // user-chosen name, max 50 chars
  stats: [number, boolean][];       // same format as SUBSTAT_PRESETS entries
}

export interface QuickBlock {
  name?: string;
  tiers: SetTier[];
  assignments: Record<number, number>; // set ID → tier index
  selectedProfiles: number[]; // indices into SUBSTAT_PRESETS
  selectedCustom?: number[];  // indices into QuickGenState.customProfiles
}

export interface RareAccessoryBlock {
  selections: Record<number, number[]>; // setId → factionIds
}

export interface OreRerollBlock {
  assignments: Record<number, number>; // setId → column index (0=3rolls, 1=4rolls, 2=5rolls)
}

export interface QuickGenState {
  blocks: QuickBlock[];
  rareAccessories?: RareAccessoryBlock;
  oreReroll?: OreRerollBlock;
  customProfiles?: CustomProfile[];
  strict?: boolean;
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

const ORE_COLUMN_COLORS = ["#a855f7", "#f59e0b", "#ef4444"];

function getOreColumns(): { rolls: number; label: string; color: string }[] {
  const rolls = getSettings().oreRerollColumns;
  return rolls.map((r, i) => ({
    rolls: r,
    label: `${r} rolls`,
    color: ORE_COLUMN_COLORS[i],
  }));
}

export function defaultOreRerollBlock(): OreRerollBlock {
  return { assignments: {} };
}

export function defaultQuickState(): QuickGenState {
  return { blocks: [defaultBlock()], rareAccessories: defaultRareAccessoryBlock(), oreReroll: defaultOreRerollBlock() };
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
    oreReroll: state.oreReroll,
    customProfiles: state.customProfiles,
    ...(state.strict ? { strict: true } : {}),
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
    oreReroll: state.oreReroll,
    customProfiles: state.customProfiles,
    ...(state.strict ? { strict: true } : {}),
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

        // Rank 5 rules at +N rolls (stricter to compensate for lower rank)
        const rank5Rolls = tier.rolls + getSettings().rank5RollAdjustment;
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

      // Custom profiles
      for (const ci of block.selectedCustom ?? []) {
        const custom = state.customProfiles?.[ci];
        if (!custom || custom.stats.length === 0) continue;
        const goodStats: [number, boolean][] = custom.stats.map(([s, f]) => [s, f]);

        groups.push({
          sets,
          slots: [],
          mainStats: [],
          goodStats,
          rolls: tier.rolls,
          rank: 6,
        });

        const rank5Rolls = tier.rolls + getSettings().rank5RollAdjustment;
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
// Rare accessories: RareAccessoryBlock → SettingGroup[]
// ---------------------------------------------------------------------------

export function rareAccessoriesToGroups(block: RareAccessoryBlock | undefined): SettingGroup[] {
  if (!block) return [];
  const groups: SettingGroup[] = [];

  for (const [setIdStr, factionIds] of Object.entries(block.selections)) {
    const setId = Number(setIdStr);
    if (!factionIds || factionIds.length === 0) continue;

    for (const factionId of factionIds) {
      groups.push({
        sets: [setId],
        slots: [7, 8, 9],
        mainStats: [],
        goodStats: [],
        rolls: 0,
        rank: 0,
        rarity: 0,
        faction: factionId,
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Ore reroll: OreRerollBlock → SettingGroup[]
// ---------------------------------------------------------------------------

export function oreRerollToGroups(block: OreRerollBlock | undefined): SettingGroup[] {
  if (!block) return [];
  const groups: SettingGroup[] = [];

  // Group sets by column
  const columnSets: number[][] = [[], [], []];
  for (const [setIdStr, colIdx] of Object.entries(block.assignments)) {
    if (colIdx >= 0 && colIdx < 3) {
      columnSets[colIdx].push(Number(setIdStr));
    }
  }

  const oreColumns = getOreColumns();

  for (let ci = 0; ci < 3; ci++) {
    const sets = columnSets[ci];
    if (sets.length === 0) continue;

    const extraRolls = oreColumns[ci].rolls;

    for (const rank of [6, 5] as const) {
      const totalTarget = rank === 6 ? extraRolls + 1 : extraRolls + 2;
      if (totalTarget > 6) continue;

      for (const [statId, isFlat] of ORE_STATS) {
        // Leg/Myth group
        groups.push({
          sets: [...sets],
          slots: [],
          mainStats: [],
          goodStats: [[statId, isFlat]],
          rolls: totalTarget,
          rank,
          rarity: 15,
        });

        // Epic group — only when Epic can achieve it
        if (totalTarget <= 4) {
          groups.push({
            sets: [...sets],
            slots: [],
            mainStats: [],
            goodStats: [[statId, isFlat]],
            rolls: totalTarget,
            rank,
            rarity: 9,
            walkbackDelay: 1,
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

  // Rare Accessories block
  renderRareAccessories(container, state, onChange);

  // Ore Reroll Candidates block
  renderOreReroll(container, state, onChange);
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

  // Built-in presets
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

  // Custom profiles
  const customs = state.customProfiles ?? [];
  if (!block.selectedCustom) block.selectedCustom = [];

  for (let ci = 0; ci < customs.length; ci++) {
    const custom = customs[ci];
    const wrap = document.createElement("span");
    wrap.className = "custom-profile-checkbox";

    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = block.selectedCustom.includes(ci);
    cb.addEventListener("change", () => {
      if (!block.selectedCustom) block.selectedCustom = [];
      if (cb.checked) {
        block.selectedCustom.push(ci);
      } else {
        block.selectedCustom = block.selectedCustom.filter((p) => p !== ci);
      }
      onChange(state);
    });
    lbl.appendChild(cb);

    const span = document.createElement("span");
    span.textContent = custom.label;
    lbl.appendChild(span);

    wrap.appendChild(lbl);

    // Edit button
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "custom-profile-edit-btn";
    editBtn.textContent = "\u270E";
    editBtn.title = "Edit profile";
    editBtn.addEventListener("click", () => {
      renderCustomProfileEditor(section, ci, state, onChange);
    });
    wrap.appendChild(editBtn);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "custom-profile-delete-btn";
    delBtn.textContent = "\u00d7";
    delBtn.title = "Delete profile";
    delBtn.addEventListener("click", () => {
      if (!state.customProfiles) return;
      state.customProfiles.splice(ci, 1);
      if (state.customProfiles.length === 0) delete state.customProfiles;
      // Adjust selectedCustom indices in all blocks
      for (const b of state.blocks) {
        if (!b.selectedCustom) continue;
        b.selectedCustom = b.selectedCustom
          .filter((idx) => idx !== ci)
          .map((idx) => (idx > ci ? idx - 1 : idx));
        if (b.selectedCustom.length === 0) delete b.selectedCustom;
      }
      onChange(state);
    });
    wrap.appendChild(delBtn);

    row.appendChild(wrap);
  }

  // "+ Add" button (hidden when 4 custom profiles exist)
  if (customs.length < 4) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "preset-btn custom-profile-add-btn";
    addBtn.textContent = "+ Add";
    addBtn.title = "Add custom profile";
    addBtn.addEventListener("click", () => {
      renderCustomProfileEditor(section, -1, state, onChange);
    });
    row.appendChild(addBtn);
  }

  section.appendChild(row);
  parent.appendChild(section);
}

// ---------------------------------------------------------------------------
// Custom profile editor (inline)
// ---------------------------------------------------------------------------

function renderCustomProfileEditor(
  section: HTMLElement,
  editIndex: number, // -1 = new, >= 0 = editing existing
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  // Remove any existing editor in this section
  const existing = section.querySelector(".custom-profile-editor");
  if (existing) existing.remove();

  const editor = document.createElement("div");
  editor.className = "custom-profile-editor";

  const isEditing = editIndex >= 0;
  const current = isEditing ? state.customProfiles?.[editIndex] : undefined;

  // Label input
  const labelRow = document.createElement("div");
  labelRow.className = "custom-profile-label-row";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "custom-profile-label-input";
  labelInput.placeholder = "Profile name";
  labelInput.maxLength = 50;
  const defaultLabel = `Custom ${(state.customProfiles?.length ?? 0) + 1}`;
  labelInput.value = current?.label ?? defaultLabel;
  labelRow.appendChild(labelInput);
  editor.appendChild(labelRow);

  // Substat checkboxes
  const statsGrid = document.createElement("div");
  statsGrid.className = "substat-checkboxes";

  const selectedStats = new Set<string>(
    (current?.stats ?? []).map(([s, f]) => `${s}:${f}`),
  );

  const checkboxes: { el: HTMLInputElement; statId: number; isFlat: boolean }[] = [];

  for (const [statId, isFlat] of GOOD_SUBSTATS) {
    const lbl = document.createElement("label");
    lbl.className = "checkbox-label";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedStats.has(`${statId}:${isFlat}`);
    cb.addEventListener("change", () => {
      const key = `${statId}:${isFlat}`;
      if (cb.checked) selectedStats.add(key);
      else selectedStats.delete(key);
    });
    lbl.appendChild(cb);
    checkboxes.push({ el: cb, statId, isFlat });

    const span = document.createElement("span");
    span.textContent = statDisplayName(statId, isFlat);
    lbl.appendChild(span);

    statsGrid.appendChild(lbl);
  }

  editor.appendChild(statsGrid);

  // Buttons
  const btnRow = document.createElement("div");
  btnRow.className = "custom-profile-btn-row";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "gen-toolbar-btn gen-toolbar-btn-primary";
  saveBtn.textContent = isEditing ? "Update" : "Save";
  saveBtn.addEventListener("click", () => {
    const name = labelInput.value.trim();
    if (!name) {
      labelInput.focus();
      return;
    }

    const stats: [number, boolean][] = [];
    for (const { el, statId, isFlat } of checkboxes) {
      if (el.checked) stats.push([statId, isFlat]);
    }
    if (stats.length === 0) return;

    if (!state.customProfiles) state.customProfiles = [];

    if (isEditing) {
      state.customProfiles[editIndex] = { label: name, stats };
    } else {
      state.customProfiles.push({ label: name, stats });
    }

    editor.remove();
    onChange(state);
  });
  btnRow.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "gen-toolbar-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => {
    editor.remove();
  });
  btnRow.appendChild(cancelBtn);

  editor.appendChild(btnRow);
  section.appendChild(editor);
  labelInput.focus();
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

  // Header
  const header = document.createElement("div");
  header.className = "quick-block-header";

  const title = document.createElement("span");
  title.className = "quick-block-title";
  title.textContent = "Unconditional Keep — Rare Accessories";
  header.appendChild(title);
  card.appendChild(header);

  // Table
  const table = document.createElement("table");
  table.className = "rare-acc-table";

  const allFactionIds = SORTED_FACTIONS.map((f) => f.id);
  const allSetIds = SORTED_ACCESSORY_SETS.map((s) => s.id);

  // Header row
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.appendChild(document.createElement("th")); // empty corner cell
  for (const faction of SORTED_FACTIONS) {
    const th = document.createElement("th");
    const colAllChecked = allSetIds.every((sid) =>
      (block.selections[sid] ?? []).includes(faction.id),
    );
    th.className = "rare-acc-col-header" + (colAllChecked ? " rare-acc-all-selected" : "");
    const span = document.createElement("span");
    span.textContent = faction.name;
    th.appendChild(span);
    th.addEventListener("click", () => {
      // Toggle column: if every set has this faction, clear; otherwise fill
      const allChecked = allSetIds.every((sid) =>
        (block.selections[sid] ?? []).includes(faction.id),
      );
      for (const sid of allSetIds) {
        if (allChecked) {
          if (block.selections[sid]) {
            block.selections[sid] = block.selections[sid].filter((f) => f !== faction.id);
            if (block.selections[sid].length === 0) delete block.selections[sid];
          }
        } else {
          if (!block.selections[sid]) block.selections[sid] = [];
          if (!block.selections[sid].includes(faction.id)) {
            block.selections[sid].push(faction.id);
          }
        }
      }
      onChange(state);
    });
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows — one per accessory set
  const tbody = document.createElement("tbody");
  for (const set of SORTED_ACCESSORY_SETS) {
    const row = document.createElement("tr");

    const labelCell = document.createElement("td");
    const rowAllChecked = allFactionIds.every((fid) => (block.selections[set.id] ?? []).includes(fid));
    labelCell.className = "rare-acc-set-label" + (rowAllChecked ? " rare-acc-all-selected" : "");
    labelCell.textContent = set.name;
    labelCell.addEventListener("click", () => {
      // Toggle row: if every faction is checked, clear; otherwise fill
      const current = block.selections[set.id] ?? [];
      const allChecked = allFactionIds.every((fid) => current.includes(fid));
      if (allChecked) {
        delete block.selections[set.id];
      } else {
        block.selections[set.id] = [...allFactionIds];
      }
      onChange(state);
    });
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

// ---------------------------------------------------------------------------
// Ore Reroll Candidates block
// ---------------------------------------------------------------------------

/** Pool column index — sets not assigned to any roll column. */
const ORE_POOL = -1;

function renderOreReroll(
  container: HTMLElement,
  state: QuickGenState,
  onChange: (state: QuickGenState) => void,
): void {
  if (!state.oreReroll) state.oreReroll = defaultOreRerollBlock();
  const block = state.oreReroll;

  const card = document.createElement("div");
  card.className = "quick-block ore-reroll-block";

  // Header
  const header = document.createElement("div");
  header.className = "quick-block-header";

  const title = document.createElement("span");
  title.className = "quick-block-title";
  title.textContent = "Ore Reroll Candidates";
  header.appendChild(title);
  card.appendChild(header);

  // Columns grid — roll columns + pool
  const grid = document.createElement("div");
  grid.className = "quick-tier-columns ore-columns";

  const oreColumns = getOreColumns();
  const totalCols = oreColumns.length + 1; // +1 for pool
  const columns: HTMLElement[] = [];
  const chipAreas: HTMLElement[] = [];

  // Roll columns
  for (let ci = 0; ci < oreColumns.length; ci++) {
    const colDef = oreColumns[ci];

    const col = document.createElement("div");
    col.className = "quick-tier-column";
    col.style.borderTopColor = colDef.color;
    col.dataset.oreCol = String(ci);

    const colHeader = document.createElement("div");
    colHeader.className = "quick-tier-column-header";
    colHeader.style.color = colDef.color;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = colDef.label;
    colHeader.appendChild(nameSpan);

    col.appendChild(colHeader);

    const chipArea = document.createElement("div");
    chipArea.className = "quick-tier-chips";
    col.appendChild(chipArea);

    // Drop target
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", (e) => {
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
      if (block.assignments[id] === ci) return;
      block.assignments[id] = ci;
      onChange(state);
    });

    columns.push(col);
    chipAreas.push(chipArea);
    grid.appendChild(col);
  }

  // Pool column (unassigned — grey, like Sell tier)
  const poolCol = document.createElement("div");
  poolCol.className = "quick-tier-column quick-tier-sell";
  poolCol.style.borderTopColor = "#e5e7eb";
  poolCol.dataset.oreCol = "pool";

  const poolHeader = document.createElement("div");
  poolHeader.className = "quick-tier-column-header";
  poolHeader.style.color = "#6b7280";

  const poolName = document.createElement("span");
  poolName.textContent = "Unassigned";
  poolHeader.appendChild(poolName);

  poolCol.appendChild(poolHeader);

  const poolChipArea = document.createElement("div");
  poolChipArea.className = "quick-tier-chips";
  poolCol.appendChild(poolChipArea);

  // Drop on pool
  poolCol.addEventListener("dragover", (e) => {
    e.preventDefault();
    poolCol.classList.add("drag-over");
  });
  poolCol.addEventListener("dragleave", (e) => {
    if (!poolCol.contains(e.relatedTarget as Node)) {
      poolCol.classList.remove("drag-over");
    }
  });
  poolCol.addEventListener("drop", (e) => {
    e.preventDefault();
    poolCol.classList.remove("drag-over");
    const setId = e.dataTransfer?.getData("text/plain");
    if (!setId) return;
    const id = Number(setId);
    delete block.assignments[id];
    onChange(state);
  });

  columns.push(poolCol);
  chipAreas.push(poolChipArea);
  grid.appendChild(poolCol);

  // Create chips — one per set
  for (const set of SORTED_SETS) {
    const colIdx = block.assignments[set.id] ?? ORE_POOL;
    const inPool = colIdx === ORE_POOL;
    const chipAreaIdx = inPool ? totalCols - 1 : colIdx;
    const color = inPool ? "#e5e7eb" : oreColumns[colIdx].color;
    const textColor = inPool ? "#6b7280" : "#fff";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-chip";
    chip.draggable = true;
    chip.textContent = set.name;
    chip.style.backgroundColor = color;
    chip.style.color = textColor;
    chip.title = `${set.name} — drag to move, click to cycle column`;

    // Drag
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", String(set.id));
      e.dataTransfer!.effectAllowed = "move";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => {
      chip.classList.remove("dragging");
      for (const c of columns) c.classList.remove("drag-over");
    });

    // Left-click: cycle through columns (0 → 1 → 2 → pool → 0)
    chip.addEventListener("click", () => {
      const cur = block.assignments[set.id] ?? ORE_POOL;
      if (cur === ORE_POOL) {
        block.assignments[set.id] = 0;
      } else if (cur < oreColumns.length - 1) {
        block.assignments[set.id] = cur + 1;
      } else {
        delete block.assignments[set.id];
      }
      onChange(state);
    });

    // Right-click: reverse cycle (pool → 2 → 1 → 0 → pool)
    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const cur = block.assignments[set.id] ?? ORE_POOL;
      if (cur === ORE_POOL) {
        block.assignments[set.id] = oreColumns.length - 1;
      } else if (cur > 0) {
        block.assignments[set.id] = cur - 1;
      } else {
        delete block.assignments[set.id];
      }
      onChange(state);
    });

    chipAreas[chipAreaIdx].appendChild(chip);
  }

  card.appendChild(grid);
  container.appendChild(card);
}
