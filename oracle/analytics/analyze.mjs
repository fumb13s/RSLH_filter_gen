import { writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { census } from "./census.mjs";
import { triage } from "./triage.mjs";
import { CUTS, SUPPLY } from "./weights.mjs";
import { ARTIFACT_SLOT_NAMES, statDisplayName, lookupName, ARTIFACT_SET_NAMES, FACTION_NAMES } from "@rslh/core";
import { rollStats, rollQualityMarkdown } from "./rollquality.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Snapshot to analyze: explicit arg, else the newest date-prefixed snapshot in resources/.
function resolveDb() {
  if (process.argv[2]) return process.argv[2];
  const dir = here("../resources");
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no resources/*-RSLHelper.db snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}
// The account-snapshot date drives the report (NOT today's date): the YYYY-MM-DD filename prefix,
// falling back to the file's last-write day.
function snapshotDate(p) {
  const m = (p.split(/[\\/]/).pop() || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : statSync(p).mtime.toISOString().slice(0, 10);
}
const dbPath = resolveDb();
const date = snapshotDate(dbPath);

const { items, corrupt, total } = readArtifacts(dbPath);
const cen = census(items);
const scored = triage(items);
// Good-roll metric per item (judged at its best-matching role); computed once, reused below.
const rolls = new Map(scored.map((s) => [s.item.id, rollStats(s.item, s.q.role)]));

const slotName = (id) => lookupName(ARTIFACT_SLOT_NAMES, id);
const setName = (id) => (id === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, id));
const facName = (id) => lookupName(FACTION_NAMES, id);
const subLine = (it) => it.substats.map((s) => `${statDisplayName(s.statId, s.isFlat)} ${s.value}`).join(", ");
const accLabel = (it) => `${facName(it.faction)} ${slotName(it.slot)}`;
const setFac = (it) => (it.isAccessory ? `${setName(it.set)} / ${facName(it.faction)}` : setName(it.set));
const ROLES = ["ATK-DPS", "DEF-DPS", "HP-DPS", "Support"];
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ARTIFACT_SLOTS = [1, 2, 3, 4, 5, 6], ACC = [7, 8, 9];

// Per-slot unequipped distribution (the pool the slot-balance pass evens out).
function slotRow(slot) {
  const uneq = items.filter((i) => i.slot === slot && i.equippedChampId === 0).length;
  const delUneq = scored.filter((s) => s.item.slot === slot && s.verdict === "delete" && s.item.equippedChampId === 0).length;
  return { uneq, delUneq, kept: uneq - delUneq };
}
// Slot-balance cap = pre-trim family mean (reconstructed by adding the balance deletes back).
const balDelInSlot = (slot, balDel) => balDel.filter((s) => s.item.slot === slot).length;
const familyCap = (slots, balDel) =>
  Math.round(slots.reduce((a, s) => a + slotRow(s).kept + balDelInSlot(s, balDel), 0) / slots.length);

const deletes = scored.filter((s) => s.verdict === "delete");
const focus = scored.filter((s) => s.focus);
const upgrades = scored.filter((s) => s.upgrade);
const delAcc = deletes.filter((s) => s.item.isAccessory);
const delArt = deletes.filter((s) => !s.item.isAccessory);
const balDel = deletes.filter((s) => s.slotBalanced);
const junkDel = deletes.filter((s) => !s.slotBalanced);
const setlessDel = junkDel.filter((s) => s.item.isAccessory && s.item.set === 0);
const accOversupply = junkDel.filter((s) => s.item.isAccessory && s.item.set !== 0);
const junkArt = junkDel.filter((s) => !s.item.isAccessory);
const balArt = balDel.filter((s) => !s.item.isAccessory);
const balAcc = balDel.filter((s) => s.item.isAccessory);
const muleDel = deletes.filter((s) => s.item.equippedChampId > 0); // equipped junk (mule context)

// top-N count buckets for a delete-analysis group
function topGroups(arr, keyFn, n = 15) {
  const m = new Map();
  for (const s of arr) { const k = keyFn(s); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

const md = [];
const P = (...lines) => md.push(...lines);

P(`# Gear Vault Analytics — ${date}`, ``);
P(`**${total} rows** (${corrupt.length} corrupt skipped) · equipped ${cen.equipped} · fully-ascended ${cen.ascended} · glyphed ${cen.glyphed} · accessories ${cen.accessories} (setless ${cen.setless})`, ``);

P(`## Recommendation summary`, ``);
P(`- **Delete: ${deletes.length}** — ${delAcc.length} accessories · ${delArt.length} artifacts`);
P(`  - junk **${junkDel.length}**: ${setlessDel.length} setless-dominated + ${accOversupply.length} oversupplied accessories + ${junkArt.length} low-demand artifacts`);
P(`  - slot-balance **${balDel.length}**: ${balArt.length} artifacts + ${balAcc.length} accessories — worst-first to even the unequipped pool`);
P(`  - by pool: **${deletes.length - muleDel.length} unequipped** + ${muleDel.length} equipped mules (junk parked on champs — unequip-then-sell). The evened distribution below counts unequipped only.`);
P(`- **Focus: ${focus.length}** — your best ${CUTS.focusPerGroup} per slot × archetype to build around`);
P(`- **Upgrade: ${upgrades.length}** — under-leveled (≤${CUTS.upgradeMaxLevel}) demanded gear worth taking to 16`, ``);

P(`## Delete analysis`, ``);
P(`### Junk — accessories (${setlessDel.length + accOversupply.length})`, ``);
P(`**Setless, dominated (${setlessDel.length})** — for each, a set accessory you already own in the same faction + slot scores at least as high, so the setless piece is redundant. By faction × slot:`, ``);
for (const [k, n] of topGroups(setlessDel, (s) => accLabel(s.item))) P(`- ${k}: ${n}`);
P(``);
if (accOversupply.length) {
  P(`**Oversupplied set accessories (${accOversupply.length})** — beyond ${SUPPLY.accessoryFloor} kept per faction + slot + set, low quality and low demand. By faction × slot × set:`, ``);
  for (const [k, n] of topGroups(accOversupply, (s) => `${accLabel(s.item)} ${setName(s.item.set)}`)) P(`- ${k}: ${n}`);
  P(``);
}
P(`### Junk — artifacts (${junkArt.length})`, ``);
P(`**Trimmed spares** — for each low-demand set (premium ≤ ${CUTS.lowPremium}) × slot, keep the best max(${Math.round(CUTS.junkKeepFrac * 100)}%, ${CUTS.junkKeepFloor}) unequipped by quality and delete the rest. By slot × set:`, ``);
for (const [k, n] of topGroups(junkArt, (s) => `${slotName(s.item.slot)} · ${setName(s.item.set)}`)) P(`- ${k}: ${n}`);
P(``);
P(`### Slot-balance trims (${balDel.length})`, ``);
P(`Evens the **unequipped** pool worst-first (equipped mules excluded; invested 💎/🔹 pieces and below-floor buckets protected). **Artifacts** are one family — tall slots capped at the family mean (~${familyCap(ARTIFACT_SLOTS, balDel)}/slot). **Accessories** are evened **per faction**: ring/amulet/banner balanced within each faction (faction-locked gear), cross-faction totals left alone. By slot:`, ``);
for (const [k, n] of topGroups(balDel, (s) => slotName(s.item.slot), 9)) P(`- ${k}: ${n}`);
P(``);
P(`Resulting unequipped distribution (the evened pool):`, ``);
P(`| Slot | unequipped | deleted | kept-unequipped |`, `|---|---|---|---|`);
for (const slot of SLOTS) { const r = slotRow(slot); P(`| ${slotName(slot)} | ${r.uneq} | ${r.delUneq} | ${r.kept} |`); }
P(``);

// Per-faction accessory balance — kept-unequipped Ring/Amulet/Banner within each faction (the
// pool the per-faction pass evens). A balanced faction reads roughly flat across the three.
const accKept = (faction, slot) => scored.filter((s) => s.item.faction === faction
  && s.item.slot === slot && s.verdict === "keep" && s.item.equippedChampId === 0).length;
const accFactions = [...new Set(items.filter((i) => i.isAccessory).map((i) => i.faction))]
  .sort((a, b) => a - b)
  .filter((f) => ACC.some((slot) => accKept(f, slot) > 0));
if (accFactions.length) {
  P(`Per-faction accessory balance (kept-unequipped — each faction's ring/amulet/banner evened):`, ``);
  P(`| Faction | Ring | Amulet | Banner |`, `|---|--:|--:|--:|`);
  for (const f of accFactions) P(`| ${facName(f)} | ${accKept(f, 7)} | ${accKept(f, 8)} | ${accKept(f, 9)} |`);
  P(``);
}
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

P(`## Roll-quality vs rating`, ``);
P(`Good substats are slot-aware (artifacts = the filter generator's presets; accessories use their own restricted pools). Roll-events = initial + upgrades (rolls+1). How well the q-score tracks rolls landing in good substats.`, ``);
const rqRows = scored
  .map((s) => { const gr = rolls.get(s.item.id); return { score: s.q.score, role: s.q.role, isAccessory: s.item.isAccessory, level: s.item.level, good: gr.good, total: gr.total, frac: gr.frac }; })
  .filter((r) => r.total > 0);
P(...rollQualityMarkdown(rqRows));
P(``);

P(`## Appendix — full inventory by slot`, ``);
P(`All ${scored.length} decoded items, best-first per slot. **Status:** ⚙ = equipped (mule context) · focus/upgrade = highlighted keep · else keep/delete. **Inv:** 💎 ascended · 🔹 glyphed.`, ``);
const bySlotItems = new Map();
for (const s of scored) { if (!bySlotItems.has(s.item.slot)) bySlotItems.set(s.item.slot, []); bySlotItems.get(s.item.slot).push(s); }
for (const slot of SLOTS) {
  const arr = (bySlotItems.get(slot) || []).slice().sort((a, b) => b.q.score - a.q.score || a.item.id - b.item.id);
  P(`### ${slotName(slot)} — ${arr.length}`, ``);
  P(`| ID | Set | Main | Substats | Lvl | q | Good | Inv | Status |`, `|---|---|---|---|---|---|---|---|---|`);
  for (const s of arr) {
    const it = s.item;
    const inv = `${s.inv.ascended ? "💎" : ""}${s.inv.glyphed ? "🔹" : ""}`;
    const status = `${it.equippedChampId > 0 ? "⚙ " : ""}${s.focus ? "focus" : s.upgrade ? "upgrade" : s.verdict}`;
    const gr = rolls.get(it.id);
    P(`| ${it.id} | ${setFac(it)} | ${statDisplayName(it.mainStat.statId, it.mainStat.isFlat)} | ${subLine(it)} | ${it.level} | ${s.q.score} | ${gr.good}/${gr.total} | ${inv} | ${status} |`);
  }
  P(``);
}

const outDir = here("./out");
mkdirSync(outDir, { recursive: true });
const json = {
  snapshotDate: date, generatedFor: dbPath, total, corrupt,
  census: {
    ...cen, bySlot: Object.fromEntries(cen.bySlot), bySet: Object.fromEntries(cen.bySet),
    byRarity: Object.fromEntries(cen.byRarity), byLevel: Object.fromEntries(cen.byLevel),
  },
  summary: {
    delete: deletes.length, deleteAccessories: delAcc.length, deleteArtifacts: delArt.length,
    junk: junkDel.length, slotBalance: balDel.length, slotBalanceArtifacts: balArt.length, slotBalanceAccessories: balAcc.length,
    setless: setlessDel.length, focus: focus.length, upgrades: upgrades.length,
  },
  verdicts: scored.map((s) => ({
    id: s.item.id, slot: s.item.slot, set: s.item.set, faction: s.item.faction, level: s.item.level,
    score: s.q.score, role: s.q.role, goodRolls: rolls.get(s.item.id).good, totalRolls: rolls.get(s.item.id).total,
    percentile: Math.round(s.percentile), premium: s.premium,
    belowFloor: s.belowFloor, ascended: s.inv.ascended, glyphed: s.inv.glyphed,
    verdict: s.verdict, slotBalanced: s.slotBalanced, focus: s.focus, upgrade: s.upgrade,
    potential: s.qPotential ? s.qPotential.score : null, reason: s.reason,
  })),
};
writeFileSync(here(`./out/${date}-report.json`), JSON.stringify(json, null, 2));
writeFileSync(here(`./out/${date}-report.md`), md.join("\n"));
console.log(`snapshot ${date}: decoded ${items.length} (skipped ${corrupt.length}); delete ${deletes.length} (acc ${delAcc.length}, artifacts ${delArt.length}), focus ${focus.length}, upgrade ${upgrades.length}. Wrote out/${date}-report.{json,md}`);
