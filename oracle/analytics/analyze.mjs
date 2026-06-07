import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { census } from "./census.mjs";
import { triage } from "./triage.mjs";
import { ARTIFACT_SLOT_NAMES, statDisplayName, lookupName, ARTIFACT_SET_NAMES, FACTION_NAMES } from "@rslh/core";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dbPath = process.argv[2] || here("../resources/RSLHelper.db");

const { items, corrupt, total } = readArtifacts(dbPath);
const cen = census(items);
const scored = triage(items);

const subLine = (it) => it.substats.map((s) => `${statDisplayName(s.statId, s.isFlat)} ${s.value}`).join(", ");
const label = (s) => {
  const it = s.item;
  const set = it.set === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, it.set);
  const fac = it.isAccessory ? ` ${lookupName(FACTION_NAMES, it.faction)}` : "";
  const badge = [s.inv.ascended ? "💎" : "", s.inv.glyphed ? "🔹" : ""].join("");
  return `#${it.id} ${lookupName(ARTIFACT_SLOT_NAMES, it.slot)} ${set}${fac} lvl${it.level} q${s.q.score}/${s.q.role} ${badge}\n      ${subLine(it)} — ${s.reason}`;
};

const dele = scored.filter((s) => s.verdict === "delete").sort((a, b) => a.q.score - b.q.score);
const focus = scored.filter((s) => s.verdict === "focus").sort((a, b) => b.q.score - a.q.score);

const slotName = (id) => lookupName(ARTIFACT_SLOT_NAMES, id);
const md = [
  `# Gear Vault Analytics — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `**${total} rows** (${corrupt.length} corrupt skipped) · equipped ${cen.equipped} · fully-ascended ${cen.ascended} · glyphed ${cen.glyphed} · accessories ${cen.accessories} (setless ${cen.setless})`,
  ``,
  `## Verdicts`,
  `- delete candidates: **${dele.length}**`,
  `- focus: **${focus.length}**`,
  `- keep: ${scored.length - dele.length - focus.length}`,
  ``,
  `## By slot`,
  [...cen.bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `- ${slotName(s)}: ${n}`).join("\n"),
  ``,
  `## Top focus (50)`,
  focus.slice(0, 50).map((s) => `- ${label(s)}`).join("\n"),
  ``,
  `## Delete candidates (first 100 of ${dele.length})`,
  dele.slice(0, 100).map((s) => `- ${label(s)}`).join("\n"),
  ``,
].join("\n");

const outDir = here("./out");
mkdirSync(outDir, { recursive: true });
const json = {
  generatedFor: dbPath, total, corrupt, census: {
    ...cen, bySlot: Object.fromEntries(cen.bySlot), bySet: Object.fromEntries(cen.bySet),
    byRarity: Object.fromEntries(cen.byRarity), byLevel: Object.fromEntries(cen.byLevel),
  },
  verdicts: scored.map((s) => ({
    id: s.item.id, slot: s.item.slot, set: s.item.set, faction: s.item.faction,
    score: s.q.score, role: s.q.role, percentile: Math.round(s.percentile),
    premium: s.premium, belowFloor: s.belowFloor, ascended: s.inv.ascended,
    glyphed: s.inv.glyphed, verdict: s.verdict, reason: s.reason,
  })),
};
writeFileSync(here("./out/report.json"), JSON.stringify(json, null, 2));
writeFileSync(here("./out/report.md"), md);
console.log(`decoded ${items.length} (skipped ${corrupt.length}); delete ${dele.length}, focus ${focus.length}. Wrote out/report.{json,md}`);
