import type { HsfFilter } from "@rslh/core";
import { parseFilter, generateFilter, serializeFilter } from "@rslh/core";
import { initUpload } from "./upload.js";
import { renderSummary, renderRules, renderTestPanel, renderError, clearError, clearViewer } from "./render.js";
import { renderGenerator, clearGenerator, defaultGroup } from "./generator.js";
import type { SettingGroup } from "./generator.js";
import { generateRulesFromGroups } from "./generate-rules.js";
import "./style.css";

// ---------------------------------------------------------------------------
// Tab types and state
// ---------------------------------------------------------------------------

type TabType = "viewer" | "generator";

interface FmblFile {
  version: number;
  groups: SettingGroup[];
}

interface TabEntry {
  id: string;
  type: TabType;
  // Viewer state
  filter: HsfFilter | null;
  fileName: string | null;
  // Generator state
  groups: SettingGroup[];
}

const MAX_TABS = 5;
const TAB_TYPES: { type: TabType; label: string }[] = [
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
    addTab("generator");
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
  if (tabs.length >= MAX_TABS) {
    tabBarError.textContent = `Maximum of ${MAX_TABS} tabs reached. Close a tab first.`;
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
    groups: type === "generator" ? [defaultGroup()] : [],
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
  }
}

function showViewerContent(tab: TabEntry): void {
  viewerContent.hidden = false;
  generatorContent.hidden = true;
  clearGenerator();

  if (tab.filter) {
    dropZone.hidden = true;
    clearError();
    renderSummary(tab.filter, tab.fileName!);
    renderTestPanel(tab.filter);
    renderRules(tab.filter);
  } else {
    clearViewer();
    dropZone.hidden = false;
  }
}

function showGeneratorContent(tab: TabEntry): void {
  viewerContent.hidden = true;
  generatorContent.hidden = false;
  clearViewer();

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
      renderTabBar(); // Update tab label with filename
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

  if (tabs.length >= MAX_TABS) {
    tabBarError.textContent = `Maximum of ${MAX_TABS} tabs reached. Close a tab first.`;
    tabBarError.hidden = false;
    return;
  }

  const id = `tab-${++tabCounter}`;
  const entry: TabEntry = {
    id,
    type: "viewer",
    filter,
    fileName: "Generated",
    groups: [],
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

fmblInput.addEventListener("change", () => {
  const file = fmblInput.files?.[0];
  if (!file) return;

  file.text().then((text) => {
    const tab = getActiveTab();
    if (!tab || tab.type !== "generator") return;

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
      // Show a brief error — reuse the tab-bar-level error since generator has no error banner
      tabBarError.textContent = `Failed to load .fmbl: ${err instanceof Error ? err.message : err}`;
      tabBarError.hidden = false;
    }
  });

  fmblInput.value = "";
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
// Initialize with one generator tab (default)
// ---------------------------------------------------------------------------

addTab("generator");
