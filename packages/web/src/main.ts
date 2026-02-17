import type { HsfFilter } from "@rslh/core";
import { parseFilter, generateFilter, serializeFilter, defaultRule } from "@rslh/core";
import { initUpload } from "./upload.js";
import { renderSummary, renderRules, renderTestPanel, renderError, clearError, clearViewer } from "./render.js";
import { renderGenerator, clearGenerator, defaultGroup } from "./generator.js";
import type { SettingGroup } from "./generator.js";
import { generateRulesFromGroups } from "./generate-rules.js";
import { renderQuickGenerator, clearQuickGenerator, defaultQuickState, quickStateToGroups, oreRerollToGroups, rareAccessoriesToGroups, stripBlockColors, restoreBlockColors } from "./quick-generator.js";
import type { QuickGenState, QuickBlock } from "./quick-generator.js";
import { getSettings } from "./settings.js";
import type { TabType } from "./settings.js";
import { encodeState, decodeState } from "./share.js";
import { renderEditableRules } from "./editor.js";
import { initSettingsModal } from "./settings-modal.js";
import { marked } from "marked";
import readme from "../../../README.md?raw";
import "./style.css";

// ---------------------------------------------------------------------------
// Tab types and state
// ---------------------------------------------------------------------------

interface FmblFile {
  version: number;
  groups: SettingGroup[];
}

interface FqblFile {
  version: number;
  state: QuickGenState;
}

/** V1 format stored flat tiers/assignments/selectedProfiles at state level */
interface FqblFileV1 {
  version: 1;
  state: QuickBlock;
}

interface TabEntry {
  id: string;
  type: TabType;
  // Viewer state
  filter: HsfFilter | null;
  fileName: string | null;
  editing: boolean;
  editSnapshot: HsfFilter | null;
  // Generator state
  groups: SettingGroup[];
  // Quick Generator state
  quickState: QuickGenState | null;
}

const settings = getSettings();
const TAB_TYPES: { type: TabType; label: string }[] = [
  { type: "quick", label: "Quick Generator" },
  { type: "generator", label: "Generator" },
  { type: "viewer", label: "Viewer" },
];

const tabs: TabEntry[] = [];
let activeTabId: string | null = null;
let tabCounter = 0;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const tabBar = document.getElementById("tab-bar")!;
const tabBarError = document.getElementById("tab-bar-error")!;
const tabContent = document.getElementById("tab-content")!;
const emptyState = document.getElementById("empty-state")!;
const dropZone = document.getElementById("drop-zone")!;
const viewerContent = document.getElementById("viewer-content")!;
const generatorContent = document.getElementById("generator-content")!;
const quickContent = document.getElementById("quick-content")!;

// ---------------------------------------------------------------------------
// Cross-format file routing
// ---------------------------------------------------------------------------

const KNOWN_EXTENSIONS: Record<string, TabType> = {
  ".hsf": "viewer",
  ".fmbl": "generator",
  ".fqbl": "quick",
};

/**
 * Route a file to the correct tab type. If the active tab already matches,
 * return false so the caller loads normally. Otherwise replace the current
 * tab with one of the correct type and load the file there.
 */
function routeFile(file: File): boolean {
  const ext = Object.keys(KNOWN_EXTENSIONS).find((e) => file.name.endsWith(e));
  if (!ext) return false;

  const targetType = KNOWN_EXTENSIONS[ext];
  const tab = getActiveTab();

  // Already on the right tab type — caller handles it
  if (tab && tab.type === targetType) return false;

  // Replace the current tab: remove it, then add one of the correct type
  if (tab) removeTab(tab.id);
  addTab(targetType);
  const newTab = getActiveTab()!;

  if (targetType === "viewer") {
    loadHsfIntoTab(file, newTab);
  } else if (targetType === "generator") {
    loadFmblIntoTab(file, newTab);
  } else if (targetType === "quick") {
    loadFqblIntoTab(file, newTab);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Drop zone helper for toolbar load buttons
// ---------------------------------------------------------------------------

function wireDropZone(id: string, ext: string, onFile: (file: File) => void): void {
  const zone = document.getElementById(id);
  if (!zone) return;

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", (e) => {
    if (!zone.contains(e.relatedTarget as Node)) {
      zone.classList.remove("drag-over");
    }
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (!file) return;

    if (file.name.endsWith(ext)) {
      tabBarError.hidden = true;
      onFile(file);
      return;
    }

    // Try routing to a different tab type
    if (!routeFile(file)) {
      tabBarError.textContent = `Expected a ${ext} file.`;
      tabBarError.hidden = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Tab bar rendering
// ---------------------------------------------------------------------------

function renderTabBar(): void {
  // Clear existing tab buttons (not the + button area)
  tabBar.innerHTML = "";

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (tab.id === activeTabId ? " active" : "");
    btn.dataset.tabId = tab.id;

    const label = document.createElement("span");
    label.className = "tab-label";
    const typeLabel = TAB_TYPES.find((t) => t.type === tab.type)?.label ?? tab.type;
    label.textContent = tab.fileName ?? typeLabel;
    btn.appendChild(label);

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "\u00d7";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      removeTab(tab.id);
    });
    btn.appendChild(close);

    btn.addEventListener("click", () => activateTab(tab.id));
    tabBar.appendChild(btn);
  }

  // Split "+" button
  const splitWrap = document.createElement("div");
  splitWrap.className = "tab-add-split";

  const addBtn = document.createElement("button");
  addBtn.className = "tab-add-btn";
  addBtn.textContent = "+";
  addBtn.title = "New Generator tab";
  addBtn.addEventListener("click", () => {
    addTab(settings.defaultTabType);
  });
  splitWrap.appendChild(addBtn);

  const arrowBtn = document.createElement("button");
  arrowBtn.className = "tab-add-arrow";
  arrowBtn.textContent = "\u25be";
  arrowBtn.title = "Choose tab type";
  arrowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTypeMenu(splitWrap);
  });
  splitWrap.appendChild(arrowBtn);

  tabBar.appendChild(splitWrap);
}

// ---------------------------------------------------------------------------
// Tab type dropdown menu
// ---------------------------------------------------------------------------

function toggleTypeMenu(anchor: HTMLElement): void {
  const existing = anchor.querySelector(".tab-type-menu");
  if (existing) {
    existing.remove();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "tab-type-menu";

  for (const tt of TAB_TYPES) {
    const item = document.createElement("button");
    item.className = "tab-type-item";
    item.textContent = tt.label;
    item.addEventListener("click", () => {
      menu.remove();
      addTab(tt.type);
    });
    menu.appendChild(item);
  }

  anchor.appendChild(menu);

  // Close on click outside
  const closeMenu = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }
  };
  // Defer so the current click doesn't immediately close it
  setTimeout(() => document.addEventListener("click", closeMenu), 0);
}

// ---------------------------------------------------------------------------
// Tab operations
// ---------------------------------------------------------------------------

function addTab(type: TabType): void {
  if (tabs.length >= settings.maxTabs) {
    tabBarError.textContent = `Maximum of ${settings.maxTabs} tabs reached. Close a tab first.`;
    tabBarError.hidden = false;
    return;
  }

  tabBarError.hidden = true;
  const id = `tab-${++tabCounter}`;
  const entry: TabEntry = {
    id,
    type,
    filter: null,
    fileName: null,
    editing: false,
    editSnapshot: null,
    groups: type === "generator" ? [defaultGroup()] : [],
    quickState: type === "quick" ? defaultQuickState() : null,
  };
  tabs.push(entry);
  activateTab(id);
}

function removeTab(id: string): void {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  tabBarError.hidden = true;
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    if (tabs.length > 0) {
      // Activate the nearest tab
      const nextIdx = Math.min(idx, tabs.length - 1);
      activateTab(tabs[nextIdx].id);
    } else {
      activeTabId = null;
      showEmptyState();
      renderTabBar();
    }
  } else {
    renderTabBar();
  }
}

function activateTab(id: string): void {
  activeTabId = id;
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  renderTabBar();
  showContent();

  if (tab.type === "viewer") {
    showViewerContent(tab);
  } else if (tab.type === "generator") {
    showGeneratorContent(tab);
  } else if (tab.type === "quick") {
    showQuickContent(tab);
  }
}

function showViewerContent(tab: TabEntry): void {
  viewerContent.hidden = false;
  generatorContent.hidden = true;
  quickContent.hidden = true;
  clearGenerator();
  clearQuickGenerator();

  const toolbar = document.getElementById("viewer-toolbar")!;
  const editBtn = document.getElementById("viewer-edit-btn")!;
  const saveHsfBtn = document.getElementById("viewer-save-hsf-btn")!;
  const addRuleBtn = document.getElementById("viewer-add-rule-btn")!;
  const cancelBtn = document.getElementById("viewer-cancel-btn")!;

  if (tab.filter) {
    dropZone.hidden = true;
    toolbar.hidden = false;
    clearError();
    renderSummary(tab.filter, tab.fileName!);

    if (tab.editing) {
      editBtn.textContent = "Done";
      saveHsfBtn.hidden = false;
      addRuleBtn.hidden = false;
      cancelBtn.hidden = false;
      // Hide test panel and raw JSON in edit mode
      document.getElementById("test-panel")!.hidden = true;
      document.getElementById("raw-json")!.hidden = true;
      renderEditableRules(tab.filter, {
        onRuleChange(index, rule) {
          tab.filter!.Rules[index] = rule;
          renderSummary(tab.filter!, tab.fileName!);
        },
        onRuleDelete(index) {
          tab.filter!.Rules.splice(index, 1);
          showViewerContent(tab);
        },
        onRuleMove(from, to) {
          const rules = tab.filter!.Rules;
          const [moved] = rules.splice(from, 1);
          rules.splice(to, 0, moved);
          showViewerContent(tab);
        },
        onRuleAdd() {
          tab.filter!.Rules.push(defaultRule());
          showViewerContent(tab);
        },
      });
    } else {
      editBtn.textContent = "Edit";
      saveHsfBtn.hidden = true;
      addRuleBtn.hidden = true;
      cancelBtn.hidden = true;
      renderTestPanel(tab.filter);
      renderRules(tab.filter);
    }
  } else {
    clearViewer();
    toolbar.hidden = true;
    dropZone.hidden = false;
  }
}

function showQuickContent(tab: TabEntry): void {
  viewerContent.hidden = true;
  generatorContent.hidden = true;
  quickContent.hidden = false;
  clearViewer();
  clearGenerator();

  if (!tab.quickState) tab.quickState = defaultQuickState();

  // Sync strict button to current state
  syncStrictButton(!!tab.quickState.strict);

  const onQuickChange = (state: QuickGenState): void => {
    tab.quickState = state;
    renderQuickGenerator(state, onQuickChange);
  };
  renderQuickGenerator(tab.quickState, onQuickChange);
}

function showGeneratorContent(tab: TabEntry): void {
  viewerContent.hidden = true;
  generatorContent.hidden = false;
  quickContent.hidden = true;
  clearViewer();
  clearQuickGenerator();

  renderGenerator(tab.groups, {
    onGroupChange(index, group) {
      tab.groups[index] = group;
    },
    onGroupDelete(index) {
      tab.groups.splice(index, 1);
      renderGenerator(tab.groups, this);
    },
    onGroupAdd() {
      tab.groups.push(defaultGroup());
      renderGenerator(tab.groups, this);
    },
  });
}

function showEmptyState(): void {
  emptyState.hidden = false;
  tabContent.hidden = true;
}

function showContent(): void {
  emptyState.hidden = true;
  tabContent.hidden = false;
}

function getActiveTab(): TabEntry | undefined {
  return tabs.find((t) => t.id === activeTabId);
}

// ---------------------------------------------------------------------------
// Upload wiring
// ---------------------------------------------------------------------------

function loadHsfIntoTab(file: File, tab: TabEntry): void {
  file.text().then((text) => {
    clearError();
    try {
      const filter = parseFilter(text);
      tab.filter = filter;
      tab.fileName = file.name;
      dropZone.hidden = true;
      renderTabBar();
      renderSummary(filter, file.name);
      renderTestPanel(filter);
      renderRules(filter);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        renderError(`Invalid JSON: ${err.message}`);
      } else if (isZodError(err)) {
        renderError(formatZodError(err));
      } else {
        renderError(`Unexpected error: ${err}`);
      }
    }
  });
}

initUpload(
  (text, fileName) => {
    const tab = getActiveTab();
    if (!tab || tab.type !== "viewer") return;

    clearError();
    try {
      const filter = parseFilter(text);
      tab.filter = filter;
      tab.fileName = fileName;
      dropZone.hidden = true;
      renderTabBar();
      renderSummary(filter, fileName);
      renderTestPanel(filter);
      renderRules(filter);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        renderError(`Invalid JSON: ${err.message}`);
      } else if (isZodError(err)) {
        renderError(formatZodError(err));
      } else {
        renderError(`Unexpected error: ${err}`);
      }
    }
  },
  (message) => {
    clearError();
    renderError(message);
  },
  routeFile,
);

// ---------------------------------------------------------------------------
// Generate .hsf
// ---------------------------------------------------------------------------

/** Try to generate rules from the active generator tab. Returns null on failure (shows error). */
function generateFromActiveTab(): ReturnType<typeof generateFilter> | null {
  const tab = getActiveTab();
  if (!tab || tab.type !== "generator") return null;

  const rules = generateRulesFromGroups(tab.groups);
  if (rules.length === 0) {
    tabBarError.textContent = "No rules generated — add at least one group with good substats.";
    tabBarError.hidden = false;
    return null;
  }

  tabBarError.hidden = true;
  return generateFilter(rules);
}

// Generate → open viewer tab with the result
document.getElementById("gen-generate-btn")!.addEventListener("click", () => {
  const filter = generateFromActiveTab();
  if (!filter) return;

  if (tabs.length >= settings.maxTabs) {
    tabBarError.textContent = `Maximum of ${settings.maxTabs} tabs reached. Close a tab first.`;
    tabBarError.hidden = false;
    return;
  }

  const id = `tab-${++tabCounter}`;
  const entry: TabEntry = {
    id,
    type: "viewer",
    filter,
    fileName: "Generated",
    editing: false,
    editSnapshot: null,
    groups: [],
    quickState: null,
  };
  tabs.push(entry);
  activateTab(id);
});

// Save .hsf → download as file
document.getElementById("gen-save-hsf-btn")!.addEventListener("click", () => {
  const filter = generateFromActiveTab();
  if (!filter) return;

  const json = serializeFilter(filter);
  const bom = "\uFEFF";
  const blob = new Blob([bom + json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filter.hsf";
  a.click();
  URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// .fmbl save/load
// ---------------------------------------------------------------------------

document.getElementById("gen-save-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "generator") return;

  const data: FmblFile = { version: 1, groups: tab.groups };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filter.fmbl";
  a.click();
  URL.revokeObjectURL(url);
});

const fmblInput = document.getElementById("fmbl-input") as HTMLInputElement;

document.getElementById("gen-load-btn")!.addEventListener("click", () => {
  fmblInput.click();
});

function loadFmblIntoTab(file: File, tab: TabEntry): void {
  file.text().then((text) => {
    try {
      const data = JSON.parse(text) as FmblFile;
      if (data.version !== 1 || !Array.isArray(data.groups)) {
        throw new Error("Invalid .fmbl file format");
      }
      tab.groups = data.groups;
      tab.fileName = file.name;
      renderTabBar();
      showGeneratorContent(tab);
    } catch (err) {
      tabBarError.textContent = `Failed to load .fmbl: ${err instanceof Error ? err.message : err}`;
      tabBarError.hidden = false;
    }
  });
}

function loadFmblFile(file: File): void {
  const tab = getActiveTab();
  if (!tab || tab.type !== "generator") return;
  loadFmblIntoTab(file, tab);
}

fmblInput.addEventListener("change", () => {
  const file = fmblInput.files?.[0];
  if (!file) return;
  loadFmblFile(file);
  fmblInput.value = "";
});

wireDropZone("gen-load-drop", ".fmbl", loadFmblFile);

// ---------------------------------------------------------------------------
// Quick Generator toolbar
// ---------------------------------------------------------------------------

/** Build groups from the active quick tab. Returns null on failure (shows error). */
function groupsFromQuickTab(): SettingGroup[] | null {
  const tab = getActiveTab();
  if (!tab || tab.type !== "quick" || !tab.quickState) return null;

  const groups = [
    ...rareAccessoriesToGroups(tab.quickState.rareAccessories),
    ...quickStateToGroups(tab.quickState),
    ...oreRerollToGroups(tab.quickState.oreReroll),
  ];

  if (groups.length === 0) {
    tabBarError.textContent = "No rules generated — assign sets to tiers and select at least one profile.";
    tabBarError.hidden = false;
    return null;
  }

  // Strict mode: append a catchall sell-all rule at the end
  if (tab.quickState.strict) {
    groups.push({ keep: false, sets: [], slots: [], mainStats: [], goodStats: [], rolls: 0, rank: 0, rarity: 0 });
  }

  tabBarError.hidden = true;
  return groups;
}

/** Try to generate a filter from the active quick tab. Returns null on failure. */
function generateFromQuickTab(): ReturnType<typeof generateFilter> | null {
  const groups = groupsFromQuickTab();
  if (!groups) return null;

  const rules = generateRulesFromGroups(groups);
  if (rules.length === 0) {
    tabBarError.textContent = "No rules generated — check your tier/profile selections.";
    tabBarError.hidden = false;
    return null;
  }

  tabBarError.hidden = true;
  return generateFilter(rules);
}

// Generate → open Generator tab (groups) + Viewer tab (filter)
document.getElementById("quick-generate-btn")!.addEventListener("click", () => {
  const groups = groupsFromQuickTab();
  if (!groups) return;

  const rules = generateRulesFromGroups(groups);
  if (rules.length === 0) {
    tabBarError.textContent = "No rules generated — check your tier/profile selections.";
    tabBarError.hidden = false;
    return;
  }

  if (tabs.length + 2 > settings.maxTabs) {
    tabBarError.textContent = `Need 2 free tab slots (Generator + Viewer). Close ${tabs.length + 2 - settings.maxTabs} tab(s) first.`;
    tabBarError.hidden = false;
    return;
  }

  tabBarError.hidden = true;
  const filter = generateFilter(rules);

  // Generator tab with the intermediate groups
  const genId = `tab-${++tabCounter}`;
  tabs.push({
    id: genId,
    type: "generator",
    filter: null,
    fileName: null,
    editing: false,
    editSnapshot: null,
    groups,
    quickState: null,
  });

  // Viewer tab with the final filter
  const viewId = `tab-${++tabCounter}`;
  tabs.push({
    id: viewId,
    type: "viewer",
    filter,
    fileName: "Generated",
    editing: false,
    editSnapshot: null,
    groups: [],
    quickState: null,
  });

  activateTab(viewId);
});

// Save .hsf
document.getElementById("quick-save-hsf-btn")!.addEventListener("click", () => {
  const filter = generateFromQuickTab();
  if (!filter) return;

  const json = serializeFilter(filter);
  const bom = "\uFEFF";
  const blob = new Blob([bom + json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filter.hsf";
  a.click();
  URL.revokeObjectURL(url);
});

// Save .fqbl
document.getElementById("quick-save-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "quick" || !tab.quickState) return;

  const data: FqblFile = { version: FQBL_CURRENT_VERSION, state: stripBlockColors(tab.quickState) };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "filter.fqbl";
  a.click();
  URL.revokeObjectURL(url);
});

// .fqbl migration pipeline — each step migrates one version up
const FQBL_CURRENT_VERSION = 4;

function migrateFqbl(data: { version: number; state: unknown }): FqblFile {
  if (!data || typeof data.version !== "number" || !data.state) {
    throw new Error("Invalid .fqbl file format");
  }

  // V1 → V2: flat state → blocks array
  if (data.version === 1) {
    const v1 = data as FqblFileV1;
    if (typeof v1.state.assignments !== "object") {
      throw new Error("Invalid .fqbl v1 format");
    }
    data = { version: 2, state: { blocks: [v1.state] } };
  }

  // V2 → V3: strip tier colors (already present, just bump version)
  if (data.version === 2) {
    data = { version: 3, state: data.state };
  }

  // V3 → V4: customProfiles support (optional fields, just bump version)
  if (data.version === 3) {
    data = { version: 4, state: data.state };
  }

  // V4 (current): restore colors from defaults
  if (data.version === FQBL_CURRENT_VERSION) {
    return { version: FQBL_CURRENT_VERSION, state: restoreBlockColors(data.state as QuickGenState) };
  }

  throw new Error(`Unsupported .fqbl version: ${data.version}`);
}

// Load .fqbl
const fqblInput = document.getElementById("fqbl-input") as HTMLInputElement;

document.getElementById("quick-load-btn")!.addEventListener("click", () => {
  fqblInput.click();
});

function loadFqblIntoTab(file: File, tab: TabEntry): void {
  file.text().then((text) => {
    try {
      const data = JSON.parse(text);
      const migrated = migrateFqbl(data);
      tab.quickState = migrated.state;
      tab.fileName = file.name;
      renderTabBar();
      showQuickContent(tab);
    } catch (err) {
      tabBarError.textContent = `Failed to load .fqbl: ${err instanceof Error ? err.message : err}`;
      tabBarError.hidden = false;
    }
  });
}

function loadFqblFile(file: File): void {
  const tab = getActiveTab();
  if (!tab || tab.type !== "quick") return;
  loadFqblIntoTab(file, tab);
}

fqblInput.addEventListener("change", () => {
  const file = fqblInput.files?.[0];
  if (!file) return;
  loadFqblFile(file);
  fqblInput.value = "";
});

wireDropZone("quick-load-drop", ".fqbl", loadFqblFile);

// Strict button — toggle strict mode on the active quick tab
function syncStrictButton(active: boolean): void {
  const btn = document.getElementById("quick-strict-btn")!;
  btn.classList.toggle("gen-toolbar-btn-strict", active);
  btn.title = active
    ? "Strict mode ON — items not matching any keep rule will be sold. Click to disable."
    : "Strict mode OFF — unmatched items are kept by default. Click to enable.";
}

document.getElementById("quick-strict-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "quick" || !tab.quickState) return;
  tab.quickState.strict = !tab.quickState.strict || undefined;
  syncStrictButton(!!tab.quickState.strict);
});

// Share button — encode quick state into URL and copy to clipboard
const shareBtn = document.getElementById("quick-share-btn")!;
const MAX_SHARE_URL_LENGTH = 4096;

shareBtn.addEventListener("click", async () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "quick" || !tab.quickState) return;

  if (tab.quickState.blocks.length > 10) {
    tabBarError.textContent = "Too many blocks to share — max 10.";
    tabBarError.hidden = false;
    return;
  }

  tabBarError.hidden = true;

  try {
    const encoded = await encodeState(tab.quickState);
    const url = location.origin + location.pathname + "#q=" + encoded;

    if (url.length > MAX_SHARE_URL_LENGTH) {
      tabBarError.textContent = "State too large to share — try fewer blocks or assignments.";
      tabBarError.hidden = false;
      return;
    }

    await navigator.clipboard.writeText(url);
    const original = shareBtn.textContent;
    shareBtn.textContent = "Copied!";
    setTimeout(() => { shareBtn.textContent = original; }, 1500);
  } catch (err) {
    tabBarError.textContent = `Failed to share: ${err instanceof Error ? err.message : err}`;
    tabBarError.hidden = false;
  }
});

// ---------------------------------------------------------------------------
// Generator "Add group" button
// ---------------------------------------------------------------------------

document.getElementById("gen-add-group")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "generator") return;

  tab.groups.push(defaultGroup());
  showGeneratorContent(tab);
});

// ---------------------------------------------------------------------------
// Viewer edit mode
// ---------------------------------------------------------------------------

document.getElementById("viewer-edit-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "viewer" || !tab.filter) return;

  if (tab.editing) {
    // "Done" — exit edit mode, keep changes
    tab.editing = false;
    tab.editSnapshot = null;
  } else {
    // Enter edit mode
    tab.editing = true;
    tab.editSnapshot = structuredClone(tab.filter);
  }
  showViewerContent(tab);
});

document.getElementById("viewer-cancel-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "viewer" || !tab.editing) return;

  tab.filter = tab.editSnapshot;
  tab.editing = false;
  tab.editSnapshot = null;
  showViewerContent(tab);
});

document.getElementById("viewer-save-hsf-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "viewer" || !tab.filter) return;

  const json = serializeFilter(tab.filter);
  const bom = "\uFEFF";
  const blob = new Blob([bom + json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = tab.fileName?.endsWith(".hsf") ? tab.fileName : "filter.hsf";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("viewer-add-rule-btn")!.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab || tab.type !== "viewer" || !tab.filter || !tab.editing) return;

  tab.filter.Rules.push(defaultRule());
  showViewerContent(tab);
});

// ---------------------------------------------------------------------------
// Zod error formatting
// ---------------------------------------------------------------------------

interface ZodIssue {
  path: (string | number)[];
  message: string;
}

function isZodError(err: unknown): err is Error & { issues: ZodIssue[] } {
  return err instanceof Error && err.name === "ZodError" && Array.isArray((err as { issues?: unknown }).issues);
}

function formatZodError(err: Error & { issues: ZodIssue[] }): string {
  const count = err.issues.length;
  const heading = `Invalid .hsf schema \u2014 ${count} issue${count === 1 ? "" : "s"} found:`;

  const lines = err.issues.map((issue) => {
    const path = issue.path
      .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : (i > 0 ? "." : "") + seg))
      .join("");
    return `\u2022 ${path || "(root)"} \u2014 ${issue.message}`;
  });

  return heading + "\n" + lines.join("\n");
}

// ---------------------------------------------------------------------------
// About modal
// ---------------------------------------------------------------------------

const aboutOverlay = document.getElementById("about-overlay")!;
const aboutBtn = document.getElementById("about-btn")!;
const aboutClose = document.getElementById("about-close")!;
const guideOverlay = document.getElementById("guide-overlay")!;
const guideBtn = document.getElementById("guide-btn")!;
const guideClose = document.getElementById("guide-close")!;

const settingsModal = initSettingsModal(() => {
  closeAbout();
  closeGuide();
  closeFeedback();
});

document.getElementById("settings-btn")!.addEventListener("click", () => settingsModal.open());

// Tally.so feedback modal (iframe)
const feedbackOverlay = document.getElementById("feedback-overlay")!;
const feedbackIframe = document.getElementById("feedback-iframe") as HTMLIFrameElement;

function openFeedback(): void {
  closeAbout();
  closeGuide();
  settingsModal.close();
  feedbackIframe.src = "https://tally.so/r/GxdboZ";
  feedbackOverlay.classList.add("open");
}

function closeFeedback(): void {
  feedbackOverlay.classList.remove("open");
  feedbackIframe.src = "";
}

document.getElementById("feedback-btn")!.addEventListener("click", openFeedback);
document.getElementById("feedback-close")!.addEventListener("click", closeFeedback);
feedbackOverlay.addEventListener("click", (e) => {
  if (e.target === feedbackOverlay) closeFeedback();
});

function openAbout(): void {
  closeGuide();
  closeFeedback();
  settingsModal.close();
  aboutOverlay.classList.add("open");
}

function closeAbout(): void {
  aboutOverlay.classList.remove("open");
}

function openGuide(): void {
  closeAbout();
  closeFeedback();
  settingsModal.close();
  guideOverlay.classList.add("open");
}

function closeGuide(): void {
  guideOverlay.classList.remove("open");
}

aboutBtn.addEventListener("click", openAbout);
aboutClose.addEventListener("click", closeAbout);
aboutOverlay.addEventListener("click", (e) => {
  if (e.target === aboutOverlay) closeAbout();
});

guideBtn.addEventListener("click", openGuide);
guideClose.addEventListener("click", closeGuide);
guideOverlay.addEventListener("click", (e) => {
  if (e.target === guideOverlay) closeGuide();
});

// TOC smooth-scroll within the guide modal
guideOverlay.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "A" && target.closest(".guide-toc")) {
    e.preventDefault();
    const href = target.getAttribute("href");
    if (!href) return;
    const el = guideOverlay.querySelector(href);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (aboutOverlay.classList.contains("open")) closeAbout();
    if (guideOverlay.classList.contains("open")) closeGuide();
    if (feedbackOverlay.classList.contains("open")) closeFeedback();
  }
});

// ---------------------------------------------------------------------------
// Render guide content from README.md
// ---------------------------------------------------------------------------

{
  let html = marked.parse(readme) as string;

  // Strip the first <h1> (repo title — the modal already has its own <h2>)
  html = html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, "");

  // Demote headings: h3 → h4, then h2 → h3 (order matters to avoid double-demoting)
  html = html.replace(/<(\/?)h3(\s|>)/g, "<$1h4$2");
  html = html.replace(/<(\/?)h2(\s|>)/g, "<$1h3$2");

  // Add slugified id attributes to h3 and h4 headings
  html = html.replace(/<(h[34])>([\s\S]*?)<\/\1>/g, (_match, tag: string, text: string) => {
    const plain = text.replace(/<[^>]+>/g, "");
    const slug = "guide-" + plain.toLowerCase().replace(/[^\w]+/g, "-").replace(/(^-|-$)/g, "");
    return `<${tag} id="${slug}">${text}</${tag}>`;
  });

  // Build TOC from h3 headings only (top-level sections)
  const tocLinks: string[] = [];
  html.replace(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g, (_match, id: string, text: string) => {
    const plain = text.replace(/<[^>]+>/g, "");
    tocLinks.push(`<a href="#${id}">${plain}</a>`);
    return "";
  });

  document.getElementById("guide-toc")!.innerHTML = tocLinks.join("");
  document.getElementById("guide-content")!.innerHTML = html;
}

// Fetch Aptoide promo code from the guide
const promoCodeEl = document.getElementById("about-promo-code")!;
fetch("https://api.github.com/repos/fumb13s/raid-guides/contents/aptoide.md")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((data: { content: string }) => {
    const text = atob(data.content);
    const match = text.match(/promo code\s+(\w+)\s*\(valid until\s+([\d-]+)\)/i);
    if (match) promoCodeEl.textContent = `${match[1]} (valid until ${match[2]})`;
    else promoCodeEl.textContent = "(see guide)";
  })
  .catch(() => {
    promoCodeEl.textContent = "(see guide)";
  });

// ---------------------------------------------------------------------------
// Back-to-top button
// ---------------------------------------------------------------------------

const backToTop = document.getElementById("back-to-top")!;
window.addEventListener("scroll", () => {
  backToTop.classList.toggle("visible", window.scrollY >= window.innerHeight);
});
backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

document.documentElement.style.setProperty("--max-tab-label-width", settings.maxTabLabelWidthPercent + "%");

// Load shared state from URL hash, or fall back to default tab
async function loadSharedState(): Promise<QuickGenState | null> {
  const hash = location.hash;
  if (!hash.startsWith("#q=")) return null;
  try {
    return await decodeState(hash.slice(3));
  } catch (e) {
    console.warn("Failed to load shared state:", e);
    return null;
  }
}

(async () => {
  const shared = await loadSharedState();
  if (shared) {
    addTab("quick");
    const tab = getActiveTab()!;
    tab.quickState = shared;
    showQuickContent(tab);
    history.replaceState(null, "", location.pathname);
  } else {
    addTab(settings.defaultTabType);
  }
})();
