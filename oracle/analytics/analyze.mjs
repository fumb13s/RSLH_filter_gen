import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { census } from "./census.mjs";
import { triage } from "./triage.mjs";
import { CUTS, SUPPLY } from "./weights.mjs";
import { ARTIFACT_SLOT_NAMES, statDisplayName, lookupName, ARTIFACT_SET_NAMES, FACTION_NAMES } from "@rslh/core";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dbPath = process.argv[2] || here("../resources/RSLHelper.db");

const { items, corrupt, total } = readArtifacts(dbPath);
const cen = census(items);
const scored = triage(items);

const slotName = (id) => lookupName(ARTIFACT_SLOT_NAMES, id);
const setName = (id) => (id === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, id));
const facName = (id) => lookupName(FACTION_NAMES, id);
const subLine = (it) => it.substats.map((s) => `${statDisplayName(s.statId, s.isFlat)} ${s.value}`).join(", ");
const accLabel = (it) => `${facName(it.faction)} ${slotName(it.slot)}`;
const ROLES = ["ATK-DPS", "DEF-DPS", "HP-DPS", "Support"];

const deletes = scored.filter((s) => s.verdict === "delete");
const focus = scored.filter((s) => s.focus);
const upgrades = scored.filter((s) => s.upgrade);
const delAcc = deletes.filter((s) => s.item.isAccessory);
const delArm = deletes.filter((s) => !s.item.isAccessory);
const setlessDel = delAcc.filter((s) => s.item.set === 0);
const accOversupply = delAcc.filter((s) => s.item.set !== 0);

// top-N count buckets for a delete-analysis group
function topGroups(arr, keyFn, n = 15) {
  const m = new Map();
  for (const s of arr) { const k = keyFn(s); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const md = [];
const P = (...lines) => md.push(...lines);

P(`# Gear Vault Analytics — ${new Date().toISOString().slice(0, 10)}`, ``);
P(`**${total} rows** (${corrupt.length} corrupt skipped) · equipped ${cen.equipped} · fully-ascended ${cen.ascended} · glyphed ${cen.glyphed} · accessories ${cen.accessories} (setless ${cen.setless})`, ``);

P(`## Recommendation summary`, ``);
P(`- **Delete: ${deletes.length}** — ${delAcc.length} accessories (${setlessDel.length} setless-dominated + ${accOversupply.length} oversupplied) · ${delArm.length} armor`);
P(`- **Focus: ${focus.length}** — your best ${CUTS.focusPerGroup} per slot × archetype to build around`);
P(`- **Upgrade: ${upgrades.length}** — under-leveled (≤${CUTS.upgradeMaxLevel}) demanded gear worth taking to 16`, ``);

P(`## Delete analysis`, ``);
P(`### Accessories — ${delAcc.length}`, ``);
P(`**Setless, dominated (${setlessDel.length})** — for each, a set accessory you already own in the same faction + slot scores at least as high, so the setless piece is redundant. By faction × slot:`, ``);
for (const [k, n] of topGroups(setlessDel, (s) => accLabel(s.item))) P(`- ${k}: ${n}`);
P(``);
if (accOversupply.length) {
  P(`**Oversupplied set accessories (${accOversupply.length})** — beyond ${SUPPLY.accessoryFloor} kept per faction + slot + set, low quality and low demand. By faction × slot × set:`, ``);
  for (const [k, n] of topGroups(accOversupply, (s) => `${accLabel(s.item)} ${setName(s.item.set)}`)) P(`- ${k}: ${n}`);
  P(``);
}
P(`### Armor — ${delArm.length}`, ``);
P(`**Oversupplied low-quality** — below slot-percentile ${CUTS.deletePct}, above the keep-floor, on a low-demand set (premium ≤ ${CUTS.lowPremium}). By slot × set:`, ``);
for (const [k, n] of topGroups(delArm, (s) => `${slotName(s.item.slot)} · ${setName(s.item.set)}`)) P(`- ${k}: ${n}`);
P(``);
P(`### Spot-check — worst 50 deletes (worst first)`, ``);
for (const s of deletes.slice().sort((a, b) => a.q.score - b.q.score).slice(0, 50)) {
  const it = s.item, fac = it.isAccessory ? ` ${facName(it.faction)}` : "";
  P(`- #${it.id} ${slotName(it.slot)} ${setName(it.set)}${fac} lvl${it.level} q${s.q.score} — ${s.reason}`);
}
P(``);

P(`## Focus — build around these (top ${CUTS.focusPerGroup} per slot × archetype, demanded sets)`, ``);
for (const role of ROLES) {
  const inRole = focus.filter((s) => s.q.role === role).sort((a, b) => a.item.slot - b.item.slot || b.q.score - a.q.score);
  if (!inRole.length) continue;
  P(`### ${role}`);
  for (const s of inRole) {
    const it = s.item, fac = it.isAccessory ? ` ${facName(it.faction)}` : "";
    const badge = `${s.inv.ascended ? "💎" : ""}${s.inv.glyphed ? "🔹" : ""}`;
    P(`- ${slotName(it.slot)}: #${it.id} ${setName(it.set)}${fac} q${s.q.score} ${badge} — ${subLine(it)}`);
  }
  P(``);
}

P(`## Upgrade candidates — take to 16 (under-leveled, top ${CUTS.focusPerGroup} per slot × archetype by potential)`, ``);
for (const role of ROLES) {
  const inRole = upgrades.filter((s) => s.qPotential.role === role).sort((a, b) => a.item.slot - b.item.slot || b.qPotential.score - a.qPotential.score);
  if (!inRole.length) continue;
  P(`### ${role}`);
  for (const s of inRole) {
    const it = s.item, fac = it.isAccessory ? ` ${facName(it.faction)}` : "";
    P(`- ${slotName(it.slot)}: #${it.id} ${setName(it.set)}${fac} lvl${it.level} q${s.q.score}→**${s.qPotential.score}** — ${subLine(it)}`);
  }
  P(``);
}

const outDir = here("./out");
mkdirSync(outDir, { recursive: true });
const json = {
  generatedFor: dbPath, total, corrupt,
  census: {
    ...cen, bySlot: Object.fromEntries(cen.bySlot), bySet: Object.fromEntries(cen.bySet),
    byRarity: Object.fromEntries(cen.byRarity), byLevel: Object.fromEntries(cen.byLevel),
  },
  summary: {
    delete: deletes.length, deleteAccessories: delAcc.length, deleteArmor: delArm.length,
    setless: setlessDel.length, focus: focus.length, upgrades: upgrades.length,
  },
  verdicts: scored.map((s) => ({
    id: s.item.id, slot: s.item.slot, set: s.item.set, faction: s.item.faction, level: s.item.level,
    score: s.q.score, role: s.q.role, percentile: Math.round(s.percentile), premium: s.premium,
    belowFloor: s.belowFloor, ascended: s.inv.ascended, glyphed: s.inv.glyphed,
    verdict: s.verdict, focus: s.focus, upgrade: s.upgrade,
    potential: s.qPotential ? s.qPotential.score : null, reason: s.reason,
  })),
};
writeFileSync(here("./out/report.json"), JSON.stringify(json, null, 2));
writeFileSync(here("./out/report.md"), md.join("\n"));
console.log(`decoded ${items.length} (skipped ${corrupt.length}); delete ${deletes.length} (acc ${delAcc.length}, armor ${delArm.length}), focus ${focus.length}, upgrade ${upgrades.length}. Wrote out/report.{json,md}`);
