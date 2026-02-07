import type { HsfFilter } from "@rslh/core";
import { parseFilter } from "@rslh/core";
import { initUpload } from "./upload.js";
import { renderSummary, renderRules, renderTestPanel, renderError, clearError, clearViewer } from "./render.js";
import "./style.css";

// ---------------------------------------------------------------------------
// Tab types and state
// ---------------------------------------------------------------------------

type TabType = "viewer";

interface TabEntry {
  id: string;
  type: TabType;
  filter: HsfFilter | null;
  fileName: string | null;
}

const MAX_TABS = 5;
const TAB_TYPES: { type: TabType; label: string }[] = [
  { type: "viewer", label: "Viewer" },
];

const tabs: TabEntry[] = [];
let activeTabId: string | null = null;
let tabCounter = 0;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const tabBar = document.getElementById("tab-bar")!;
const tabContent = document.getElementById("tab-content")!;
const emptyState = document.getElementById("empty-state")!;
const dropZone = document.getElementById("drop-zone")!;

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
  addBtn.title = "New Viewer tab";
  addBtn.addEventListener("click", () => {
    addTab("viewer");
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
    clearError();
    renderError(`Maximum of ${MAX_TABS} tabs reached. Close a tab first.`);
    return;
  }

  const id = `tab-${++tabCounter}`;
  const entry: TabEntry = { id, type, filter: null, fileName: null };
  tabs.push(entry);
  activateTab(id);
}

function removeTab(id: string): void {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

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

  if (tab.filter) {
    // Re-render stored filter data
    dropZone.hidden = true;
    clearError();
    renderSummary(tab.filter, tab.fileName!);
    renderTestPanel(tab.filter);
    renderRules(tab.filter);
  } else {
    // No filter loaded yet — show upload zone
    clearViewer();
    dropZone.hidden = false;
  }
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
    if (!tab) return;

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
// Initialize with one tab
// ---------------------------------------------------------------------------

addTab("viewer");
