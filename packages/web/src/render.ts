/**
 * Rule card rendering — DOM construction and human-readable labels.
 */
import type { HsfFilter, HsfRule, HsfSubstat } from "@rslh/core";
import {
  lookupName,
  describeRarity,
  ARTIFACT_SET_NAMES,
  ARTIFACT_SLOT_NAMES,
  STAT_NAMES,
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
      activeStats.map(renderSubstat).join("");
    card.appendChild(substatsEl);
  }

  return card;
}

function renderSubstat(s: HsfSubstat): string {
  const name = lookupName(STAT_NAMES, s.ID);
  const flat = s.IsFlat ? " (flat)" : "";
  const cond = s.Condition || ">=";
  return `<div class="substat-line">${esc(name)} ${esc(cond)} ${s.Value}${flat}</div>`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
