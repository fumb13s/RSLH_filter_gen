/**
 * Rule card rendering — DOM construction and human-readable labels.
 */
import type { HsfFilter, HsfRule, HsfSubstat, Item, ItemSubstat } from "@rslh/core";
import {
  lookupName,
  describeRarity,
  matchesRule,
  getRollRange,
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  STAT_NAMES,
  ITEM_RARITIES,
  FACTION_NAMES,
  SLOT_STATS,
  statDisplayName,
} from "@rslh/core";

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

export function renderError(message: string): void {
  const banner = document.getElementById("error-banner")!;
  banner.innerText = message;
  banner.hidden = false;

  // Hide results when showing error
  document.getElementById("filter-summary")!.hidden = true;
  document.getElementById("test-panel")!.hidden = true;
  document.getElementById("rules-container")!.innerHTML = "";
  document.getElementById("raw-json")!.hidden = true;
}

export function clearError(): void {
  const banner = document.getElementById("error-banner")!;
  banner.textContent = "";
  banner.hidden = true;
}

/** Reset all viewer content areas to their initial hidden/empty state. */
export function clearViewer(): void {
  clearError();
  abortPageListeners();
  currentFilter = null;
  document.getElementById("filter-summary")!.hidden = true;
  document.getElementById("test-panel")!.hidden = true;
  document.getElementById("test-panel-body")!.innerHTML = "";
  const pag = document.getElementById("rules-pagination")!;
  pag.innerHTML = "";
  pag.hidden = true;
  document.getElementById("rules-container")!.innerHTML = "";
  const pagBot = document.getElementById("rules-pagination-bottom")!;
  pagBot.innerHTML = "";
  pagBot.hidden = true;
  const rawJson = document.getElementById("raw-json")!;
  rawJson.hidden = true;
  rawJson.querySelector("pre")!.textContent = "";
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function renderSummary(filter: HsfFilter, fileName: string): void {
  const el = document.getElementById("filter-summary")!;
  el.hidden = false;

  const rules = filter.Rules;
  const active = rules.filter((r) => r.Use).length;
  const inactive = rules.length - active;
  const keep = rules.filter((r) => r.Keep).length;
  const sell = rules.length - keep;

  el.innerHTML = `
    <div class="summary-row">
      <div class="summary-stat"><span class="summary-value">${fileName}</span><span class="summary-label">File</span></div>
      <div class="summary-stat"><span class="summary-value">${rules.length}</span><span class="summary-label">Rules</span></div>
      <div class="summary-stat"><span class="summary-value">${active}</span><span class="summary-label">Active</span></div>
      <div class="summary-stat"><span class="summary-value">${inactive}</span><span class="summary-label">Inactive</span></div>
      <div class="summary-stat"><span class="summary-value">${keep}</span><span class="summary-label">Keep</span></div>
      <div class="summary-stat"><span class="summary-value">${sell}</span><span class="summary-label">Sell</span></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Rules — paginated rendering
// ---------------------------------------------------------------------------

const PAGE_SIZES = [50, 100, 250, 500, 1000];
let currentPage = 0;
let pageSize = 100;
let currentFilter: HsfFilter | null = null;
let currentCardBuilder: (rule: HsfRule, index: number, signal: AbortSignal) => HTMLElement = buildRuleCard;

// AbortController for tearing down event listeners when pages change.
// Aborted before each page render so detached DOM nodes become collectible.
let pageController = new AbortController();

/** Abort all event listeners registered on the current page's DOM nodes. */
export function abortPageListeners(): void {
  pageController.abort();
}

// Track the raw-json toggle handler so we can remove it before re-adding
// (the <details> element persists across tab switches).
let rawJsonToggleHandler: (() => void) | null = null;

export function renderRules(filter: HsfFilter): void {
  renderPaginatedCards(filter, buildRuleCard, true);

  // Raw JSON collapsible — lazy-populate on first open
  const details = document.getElementById("raw-json")!;
  details.hidden = false;
  const pre = details.querySelector("pre")!;
  pre.textContent = "";

  // Remove previous handler to avoid accumulating listeners
  if (rawJsonToggleHandler) {
    details.removeEventListener("toggle", rawJsonToggleHandler);
  }
  let populated = false;
  rawJsonToggleHandler = () => {
    if (details.open && !populated) {
      pre.textContent = JSON.stringify(filter, null, 2);
      populated = true;
    }
  };
  details.addEventListener("toggle", rawJsonToggleHandler);
}

/**
 * Set up paginated card rendering. Resets to page 0 when a new filter is
 * loaded; preserves current page when re-rendering the same filter (e.g.
 * after an edit-mode rule move/delete/add).
 */
export function renderPaginatedCards(
  filter: HsfFilter,
  cardBuilder: (rule: HsfRule, index: number, signal: AbortSignal) => HTMLElement,
  resetPage = false,
): void {
  if (resetPage || filter !== currentFilter) {
    currentPage = 0;
  }
  currentFilter = filter;
  currentCardBuilder = cardBuilder;
  renderCurrentPage();
}

/** Navigate to the page containing the given 0-based rule index and scroll to it. */
export function goToRule(ruleIndex: number): void {
  if (!currentFilter) return;
  const total = currentFilter.Rules.length;
  if (ruleIndex < 0 || ruleIndex >= total) return;
  const targetPage = Math.floor(ruleIndex / pageSize);
  if (targetPage !== currentPage) {
    currentPage = targetPage;
    renderCurrentPage();
  }
  // Scroll to the card after render
  const ruleNum = ruleIndex + 1;
  const card = document.getElementById(`rule-${ruleNum}`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief highlight
    card.classList.add("rule-matched");
  }
}

function renderCurrentPage(): void {
  if (!currentFilter) return;

  // Tear down all event listeners from the previous page so that
  // detached DOM nodes become eligible for garbage collection.
  pageController.abort();
  pageController = new AbortController();
  const { signal } = pageController;

  const rules = currentFilter.Rules;
  const total = rules.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage >= totalPages) currentPage = totalPages - 1;

  const start = currentPage * pageSize;
  const end = Math.min(start + pageSize, total);

  // Render rule cards for this page
  const container = document.getElementById("rules-container")!;
  container.innerHTML = "";
  for (let i = start; i < end; i++) {
    container.appendChild(currentCardBuilder(rules[i], i, signal));
  }

  // Render pagination controls (top and bottom)
  for (const id of ["rules-pagination", "rules-pagination-bottom"]) {
    const el = document.getElementById(id)!;
    el.hidden = total <= pageSize; // hide if everything fits on one page
    el.innerHTML = "";
    if (el.hidden) {
      el.className = "";
    } else {
      renderPaginationControls(el, total, totalPages, id === "rules-pagination", signal);
    }
  }
}

function renderPaginationControls(
  container: HTMLElement,
  totalRules: number,
  totalPages: number,
  includeGoTo: boolean,
  signal: AbortSignal,
): void {
  container.className = "rules-pagination";

  // Prev button
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "pagination-btn";
  prevBtn.textContent = "\u25c0 Prev";
  prevBtn.disabled = currentPage === 0;
  prevBtn.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderCurrentPage();
      scrollToRulesTop();
    }
  }, { signal });
  container.appendChild(prevBtn);

  // Page indicator
  const info = document.createElement("span");
  info.className = "pagination-info";
  const start = currentPage * pageSize + 1;
  const end = Math.min((currentPage + 1) * pageSize, totalRules);
  info.textContent = `Rules ${start}\u2013${end} of ${totalRules} (page ${currentPage + 1}/${totalPages})`;
  container.appendChild(info);

  // Next button
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "pagination-btn";
  nextBtn.textContent = "Next \u25b6";
  nextBtn.disabled = currentPage >= totalPages - 1;
  nextBtn.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderCurrentPage();
      scrollToRulesTop();
    }
  }, { signal });
  container.appendChild(nextBtn);

  // Page size selector
  const sizeLabel = document.createElement("label");
  sizeLabel.className = "pagination-size";
  sizeLabel.textContent = "Per page: ";
  const sizeSelect = document.createElement("select");
  for (const size of PAGE_SIZES) {
    const opt = document.createElement("option");
    opt.value = String(size);
    opt.textContent = String(size);
    if (size === pageSize) opt.selected = true;
    sizeSelect.appendChild(opt);
  }
  sizeSelect.addEventListener("change", () => {
    pageSize = Number(sizeSelect.value);
    currentPage = 0;
    renderCurrentPage();
    scrollToRulesTop();
  }, { signal });
  sizeLabel.appendChild(sizeSelect);
  container.appendChild(sizeLabel);

  // Go-to-rule input (top bar only)
  if (includeGoTo) {
    const goWrap = document.createElement("span");
    goWrap.className = "pagination-goto";

    const goInput = document.createElement("input");
    goInput.type = "number";
    goInput.min = "1";
    goInput.max = String(totalRules);
    goInput.placeholder = "Rule #";
    goInput.className = "pagination-goto-input";

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "pagination-btn";
    goBtn.textContent = "Go";
    const doGo = () => {
      const num = Number(goInput.value);
      if (num >= 1 && num <= totalRules) goToRule(num - 1);
    };
    goBtn.addEventListener("click", doGo, { signal });
    goInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doGo();
    }, { signal });

    goWrap.appendChild(goInput);
    goWrap.appendChild(goBtn);
    container.appendChild(goWrap);
  }
}

function scrollToRulesTop(): void {
  document.getElementById("rules-pagination")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildRuleCard(rule: HsfRule, index: number, signal: AbortSignal): HTMLElement {
  const card = document.createElement("div");
  card.className = "rule-card";
  card.id = `rule-${index + 1}`;
  if (!rule.Use) card.classList.add("inactive");
  card.classList.add(rule.Keep ? "keep" : "sell");

  // Header
  const header = document.createElement("div");
  header.className = "rule-header";
  header.innerHTML = `
    <span class="rule-index">#${index + 1}</span>
    <span class="badge ${rule.Keep ? "badge-keep" : "badge-sell"}">${rule.Keep ? "Keep" : "Sell"}</span>
    <span class="badge ${rule.Use ? "badge-active" : "badge-inactive"}">${rule.Use ? "Active" : "Inactive"}</span>
  `;
  card.appendChild(header);

  // Body grid
  const body = document.createElement("div");
  body.className = "rule-body";

  const setIds = rule.ArtifactSet?.filter((id) => id !== 0);
  const sets = setIds && setIds.length > 0
    ? setIds.map((id) => lookupName(ARTIFACT_SET_NAMES, id)).join(", ")
    : "Any";
  const slots = rule.ArtifactType
    ? rule.ArtifactType.map((id) => lookupName(ARTIFACT_SLOT_NAMES, id)).join(", ")
    : "Any";
  const mainStat = rule.MainStatID === -1 ? "Any" : lookupName(STAT_NAMES, rule.MainStatID);
  const faction = rule.Faction === 0 ? "Any" : String(rule.Faction);

  body.innerHTML = `
    <div class="field"><span class="field-label">Sets</span><span class="field-value">${esc(sets)}</span></div>
    <div class="field"><span class="field-label">Slots</span><span class="field-value">${esc(slots)}</span></div>
    <div class="field"><span class="field-label">Rank</span><span class="field-value">${rule.Rank === 0 ? "Any" : `${rule.Rank}-star`}</span></div>
    <div class="field"><span class="field-label">Rarity</span><span class="field-value">${esc(describeRarity(rule.Rarity))}</span></div>
    <div class="field"><span class="field-label">Main Stat</span><span class="field-value">${esc(mainStat)}</span></div>
    <div class="field"><span class="field-label">Level</span><span class="field-value">${rule.LVLForCheck}</span></div>
    <div class="field"><span class="field-label">Faction</span><span class="field-value">${esc(faction)}</span></div>
  `;
  card.appendChild(body);

  // Substats
  const activeStats = rule.Substats.filter((s) => s.ID !== -1);
  if (activeStats.length > 0) {
    const substatsEl = document.createElement("div");
    substatsEl.className = "rule-substats";
    substatsEl.innerHTML =
      '<div class="substats-title">Substats</div>' +
      activeStats.map((s) => renderSubstat(s, rule.Rank)).join("");
    card.appendChild(substatsEl);
  }

  // Raw JSON toggle — lazy-populate on first click
  const rawPre = document.createElement("pre");
  rawPre.className = "rule-raw";
  rawPre.hidden = true;
  card.appendChild(rawPre);

  const rawBtn = document.createElement("button");
  rawBtn.className = "badge badge-raw";
  rawBtn.textContent = "Raw";
  rawBtn.addEventListener("click", () => {
    rawPre.hidden = !rawPre.hidden;
    if (!rawPre.hidden && !rawPre.textContent) {
      rawPre.textContent = JSON.stringify(rule, null, 2);
    }
    rawBtn.classList.toggle("badge-raw-active", !rawPre.hidden);
  }, { signal });
  header.appendChild(rawBtn);

  return card;
}

function renderSubstat(s: HsfSubstat, rank: number): string {
  const name = statDisplayName(s.ID, s.IsFlat);
  const cond = s.Condition || ">=";
  const rolls = minRollsNeeded(s, rank);
  const extra = rolls !== undefined ? rolls - 1 : 0;
  const rollNote = extra > 0 ? ` <span class="substat-rolls">(${extra})</span>` : "";
  return `<div class="substat-line">${esc(name)} ${esc(cond)} ${s.Value}${rollNote}</div>`;
}

/** Minimum number of rolls needed to reach the substat's threshold value, or undefined if unknown. */
function minRollsNeeded(s: HsfSubstat, rank: number): number | undefined {
  if (rank === 0) return undefined;
  const range = getRollRange(s.ID, rank, s.IsFlat);
  if (!range) return undefined;
  return Math.ceil(s.Value / range[0]);
}

export function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Test panel
// ---------------------------------------------------------------------------

function buildOptions(map: Record<number, string>): string {
  return Object.entries(map)
    .map(([id, name]) => `<option value="${id}">${esc(name)}</option>`)
    .join("");
}

export function renderTestPanel(filter: HsfFilter): void {
  const panel = document.getElementById("test-panel")!;
  panel.hidden = false;

  const body = document.getElementById("test-panel-body")!;
  body.innerHTML = `
    <div class="test-form">
      <div class="test-field">
        <label for="test-set">Set</label>
        <select id="test-set">
          <option value="0">Any</option>
          ${buildOptions(ARTIFACT_SET_NAMES)}
        </select>
      </div>
      <div class="test-field">
        <label for="test-slot">Slot</label>
        <select id="test-slot">
          ${buildOptions(ARTIFACT_SLOT_NAMES)}
        </select>
      </div>
      <div class="test-field">
        <label for="test-rank">Rank</label>
        <select id="test-rank">
          ${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${n === 6 ? " selected" : ""}>${n}-star</option>`).join("")}
        </select>
      </div>
      <div class="test-field">
        <label for="test-rarity">Rarity</label>
        <select id="test-rarity">
          ${ITEM_RARITIES.map((name, i) => `<option value="${i}"${i === 4 ? " selected" : ""}>${esc(name)}</option>`).join("")}
        </select>
      </div>
      <div class="test-field">
        <label for="test-main-stat">Main Stat</label>
        <select id="test-main-stat">
        </select>
      </div>
      <div class="test-field">
        <label for="test-faction">Faction</label>
        <select id="test-faction">
          <option value="0" selected>None</option>
          ${buildOptions(FACTION_NAMES)}
        </select>
      </div>
      <div class="test-field">
        <label for="test-level">Level</label>
        <select id="test-level">
          ${Array.from({ length: 17 }, (_, i) => i).map((n) => `<option value="${n}">${n}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="test-substats">
      <div class="substats-title">Substats</div>
      ${[0, 1, 2, 3].map((i) => `
      <div class="test-substat-row">
        <select id="test-sub-stat-${i}" class="test-sub-stat">
          <option value="">None</option>
        </select>
        <label for="test-sub-rolls-${i}">Rolls</label>
        <input id="test-sub-rolls-${i}" type="range" min="1" max="6" value="1" class="test-sub-rolls" />
        <span id="test-sub-rolls-val-${i}" class="test-sub-rolls-val">0</span>
        <label for="test-sub-value-${i}">Value</label>
        <input id="test-sub-value-${i}" type="number" min="1" value="1" class="test-sub-value" />
      </div>`).join("")}
    </div>
    <button id="test-btn" class="test-btn" type="button">Test</button>
    <div id="test-result"></div>
  `;

  // Populate stat dropdowns for the initial slot
  const slotSelect = document.getElementById("test-slot") as HTMLSelectElement;
  populateMainStatOptions(Number(slotSelect.value));
  populateSubstatOptions(Number(slotSelect.value));
  slotSelect.addEventListener("change", () => {
    const slotId = Number(slotSelect.value);
    populateMainStatOptions(slotId);
    populateSubstatOptions(slotId);
  });

  // Wire up roll sliders to show current value and update substat range
  for (let i = 0; i < 4; i++) {
    const slider = document.getElementById(`test-sub-rolls-${i}`) as HTMLInputElement;
    const label = document.getElementById(`test-sub-rolls-val-${i}`)!;
    slider.addEventListener("input", () => {
      label.textContent = String(Number(slider.value) - 1);
      updateSubstatRange(i);
    });

    // Update substat range when stat selection changes
    const statSelect = document.getElementById(`test-sub-stat-${i}`) as HTMLSelectElement;
    statSelect.addEventListener("change", () => updateSubstatRange(i));
  }

  // Update all substat ranges when rank changes
  const rankSelect = document.getElementById("test-rank") as HTMLSelectElement;
  rankSelect.addEventListener("change", () => {
    for (let i = 0; i < 4; i++) updateSubstatRange(i);
  });

  document.getElementById("test-btn")!.addEventListener("click", () => {
    runTest(filter);
  });
}

function val(id: string): number {
  return Number((document.getElementById(id) as HTMLSelectElement).value);
}

/** Read a stat ID from a select whose value is "statId:isFlat" or "-1". */
function readStatId(id: string): number {
  const v = (document.getElementById(id) as HTMLSelectElement).value;
  if (v === "-1") return -1;
  return Number(v.split(":")[0]);
}

function populateMainStatOptions(slotId: number): void {
  const select = document.getElementById("test-main-stat") as HTMLSelectElement;
  const prev = select.value;
  const config = SLOT_STATS[slotId];
  const refs = config?.primaryStats ?? [];
  select.innerHTML =
    '<option value="-1">Any</option>' +
    refs.map(([statId, isFlat]) => {
      const key = `${statId}:${isFlat ? 1 : 0}`;
      return `<option value="${key}">${esc(statDisplayName(statId, isFlat))}</option>`;
    }).join("");
  if ([...select.options].some((o) => o.value === prev)) {
    select.value = prev;
  } else {
    select.value = "-1";
  }
}

function populateSubstatOptions(slotId: number): void {
  const config = SLOT_STATS[slotId];
  const refs = config?.substats ?? [];
  for (let i = 0; i < 4; i++) {
    const select = document.getElementById(`test-sub-stat-${i}`) as HTMLSelectElement;
    const prev = select.value;
    select.innerHTML =
      '<option value="">None</option>' +
      refs.map(([statId, isFlat]) => {
        const key = `${statId}:${isFlat ? 1 : 0}`;
        return `<option value="${key}">${esc(statDisplayName(statId, isFlat))}</option>`;
      }).join("");
    // Restore previous selection if still valid
    if ([...select.options].some((o) => o.value === prev)) {
      select.value = prev;
    } else {
      select.value = "";
    }
  }
}

/** Constrain the value input for substat row `i` based on stat, rank, and rolls. */
function updateSubstatRange(i: number): void {
  const statVal = (document.getElementById(`test-sub-stat-${i}`) as HTMLSelectElement).value;
  const valueInput = document.getElementById(`test-sub-value-${i}`) as HTMLInputElement;

  if (!statVal) {
    // "None" selected — reset constraints
    valueInput.min = "1";
    valueInput.removeAttribute("max");
    return;
  }

  const [statId, flatFlag] = statVal.split(":").map(Number);
  const rank = val("test-rank");
  const range = getRollRange(statId, rank, flatFlag === 1);
  if (!range) {
    valueInput.min = "1";
    valueInput.removeAttribute("max");
    return;
  }

  const rolls = Number((document.getElementById(`test-sub-rolls-${i}`) as HTMLInputElement).value);
  const min = rolls * range[0];
  const max = rolls * range[1];
  valueInput.min = String(min);
  valueInput.max = String(max);

  // Clamp current value into the new range
  const cur = Number(valueInput.value);
  if (cur < min) valueInput.value = String(min);
  else if (cur > max) valueInput.value = String(max);
}

function readSubstats(): ItemSubstat[] {
  const result: ItemSubstat[] = [];
  for (let i = 0; i < 4; i++) {
    const statVal = (document.getElementById(`test-sub-stat-${i}`) as HTMLSelectElement).value;
    if (!statVal) continue;
    const [statId, flatFlag] = statVal.split(":").map(Number);
    const isFlat = flatFlag === 1;
    const rolls = Number((document.getElementById(`test-sub-rolls-${i}`) as HTMLInputElement).value);
    const value = Number((document.getElementById(`test-sub-value-${i}`) as HTMLInputElement).value) || 1;
    result.push({ statId, isFlat, rolls, value });
  }
  return result;
}

function runTest(filter: HsfFilter): void {
  // Clear previous highlights
  document.querySelectorAll(".rule-matched").forEach((el) => {
    el.classList.remove("rule-matched");
  });

  const item: Item = {
    set: val("test-set"),
    slot: val("test-slot"),
    rank: val("test-rank"),
    rarity: val("test-rarity"),
    mainStat: readStatId("test-main-stat"),
    substats: readSubstats(),
    level: val("test-level"),
    faction: val("test-faction") || undefined,
  };

  const resultEl = document.getElementById("test-result")!;

  let matchedIndex = -1;
  for (let i = 0; i < filter.Rules.length; i++) {
    const rule = filter.Rules[i];
    if (!rule.Use) continue;
    if (matchesRule(rule, item)) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    resultEl.className = "test-result test-result-default";
    resultEl.innerHTML = "Keep &mdash; no rule matched (default)";
    return;
  }

  const rule = filter.Rules[matchedIndex];
  const ruleNum = matchedIndex + 1;
  const action = rule.Keep ? "Keep" : "Sell";
  const cls = rule.Keep ? "test-result-keep" : "test-result-sell";

  resultEl.className = `test-result ${cls}`;
  resultEl.innerHTML = `${action} &mdash; matched <a href="#">rule #${ruleNum}</a>`;

  // Wire the link to navigate to the correct page and highlight the card
  const link = resultEl.querySelector("a")!;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    goToRule(matchedIndex);
  });
}
