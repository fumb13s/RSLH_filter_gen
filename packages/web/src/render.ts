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
// Rules
// ---------------------------------------------------------------------------

export function renderRules(filter: HsfFilter): void {
  const container = document.getElementById("rules-container")!;
  container.innerHTML = "";

  filter.Rules.forEach((rule, i) => {
    container.appendChild(buildRuleCard(rule, i));
  });

  // Raw JSON collapsible
  const details = document.getElementById("raw-json")!;
  details.hidden = false;
  const pre = details.querySelector("pre")!;
  pre.textContent = JSON.stringify(filter, null, 2);
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

function buildRuleCard(rule: HsfRule, index: number): HTMLElement {
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
    <span class="badge badge-logic">${rule.IsRuleTypeAND ? "AND" : "OR"}</span>
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

  // Raw JSON toggle
  const rawPre = document.createElement("pre");
  rawPre.className = "rule-raw";
  rawPre.hidden = true;
  rawPre.textContent = JSON.stringify(rule, null, 2);
  card.appendChild(rawPre);

  const rawBtn = document.createElement("button");
  rawBtn.className = "badge badge-raw";
  rawBtn.textContent = "Raw";
  rawBtn.addEventListener("click", () => {
    rawPre.hidden = !rawPre.hidden;
    rawBtn.classList.toggle("badge-raw-active", !rawPre.hidden);
  });
  header.appendChild(rawBtn);

  return card;
}

function renderSubstat(s: HsfSubstat, rank: number): string {
  const name = lookupName(STAT_NAMES, s.ID);
  const cond = s.Condition || ">=";
  const rolls = minRollsNeeded(s, rank);
  const extra = rolls !== undefined ? rolls - 1 : 0;
  const rollNote = extra > 0 ? ` <span class="substat-rolls">(${extra})</span>` : "";
  return `<div class="substat-line">${esc(name)} ${esc(cond)} ${s.Value}${rollNote}</div>`;
}

/** Minimum number of rolls needed to reach the substat's threshold value, or undefined if unknown. */
function minRollsNeeded(s: HsfSubstat, rank: number): number | undefined {
  if (rank === 0) return undefined;
  const range = getRollRange(s.ID, rank);
  if (!range) return undefined;
  return Math.ceil(s.Value / range[1]);
}

function esc(text: string): string {
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

  const [statId] = statVal.split(":").map(Number);
  const rank = val("test-rank");
  const range = getRollRange(statId, rank);
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
    const [statId] = statVal.split(":").map(Number);
    const rolls = Number((document.getElementById(`test-sub-rolls-${i}`) as HTMLInputElement).value);
    const value = Number((document.getElementById(`test-sub-value-${i}`) as HTMLInputElement).value) || 1;
    result.push({ statId, rolls, value });
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
  resultEl.innerHTML = `${action} &mdash; matched <a href="#rule-${ruleNum}">rule #${ruleNum}</a>`;

  // Highlight matched rule card
  const card = document.getElementById(`rule-${ruleNum}`);
  if (card) card.classList.add("rule-matched");
}
