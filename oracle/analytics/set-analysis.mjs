// Ore-aware worth/garbage analysis for one set's corpus.
//
// Ore re-randomizes a piece's MAIN + all substat TYPES/VALUES but PRESERVES each substat's roll
// count, so the only permanent thing is the roll DISTRIBUTION. A substat with >= ORE_ROLLS rolls is
// a re-aimable "gem" (reroll it onto a top stat); a spread piece (max roll low) can't be made elite
// even by a perfect ore. Scarce slots (Chest, Gloves) relax the bar to a double-roll, supply-permitting.
//   node oracle/analytics/set-analysis.mjs <set name|id> [snapshot.db]
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { quality } from "./score.mjs";
import { bucketCounts, atOrBelowFloor } from "./supply.mjs";
import { ARTIFACT_SLOT_NAMES, ARTIFACT_SET_NAMES, FACTION_NAMES, statDisplayName, lookupName } from "@rslh/core";

// ---- tunables ----
const ELITE = 82;                      // curQ >= this = realized good (keep & use; ore not needed)
const ORE_ROLLS = 3;                   // a substat with >= this many rolls = re-aimable concentration
const SCARCE_SLOTS = new Set([2, 3]);  // Chest, Gloves — hardest slots to replace
const SCARCE_ORE_ROLLS = 2;            // ...where even a double-roll is an acceptable ore target

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
function resolveDb(arg) {
  if (arg) return arg;
  const dir = here("../resources");
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error("no snapshot found; run refresh.sh"); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}
function setIdOf(arg) {
  if (arg !== undefined && !Number.isNaN(Number(arg))) return Number(arg);
  for (let id = 0; id < 1100; id++) if ((lookupName(ARTIFACT_SET_NAMES, id) || "").toLowerCase() === String(arg).toLowerCase()) return id;
  console.error(`unknown set "${arg}"`); process.exit(1);
}

const setArg = process.argv[2];
if (!setArg) { console.error("usage: set-analysis.mjs <set name|id> [snapshot.db]"); process.exit(1); }
const setId = setIdOf(setArg);
const dbPath = resolveDb(process.argv[3]);
const { items } = readArtifacts(dbPath);
const pieces = items.filter((i) => i.set === setId);
if (!pieces.length) { console.error(`no pieces of set ${setId} (${lookupName(ARTIFACT_SET_NAMES, setId)})`); process.exit(1); }
const counts = bucketCounts(items); // unequipped per (faction×slot×set) — the keep-floor that protects spares

const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const facName = (f) => lookupName(FACTION_NAMES, f);
const maxRoll = (it) => it.substats.reduce((m, s) => Math.max(m, s.rolls), 0);
const scarce = (it) => SCARCE_SLOTS.has(it.slot);
const subLine = (it) => it.substats.map((s) => `${statDisplayName(s.statId, s.isFlat)} ${s.value}[${s.rolls}r]`).join(", ");
const line = (s) => {
  const it = s.item, fac = it.slot >= 7 ? `/${facName(it.faction)}` : "", eq = it.equippedChampId > 0 ? " ⚙" : "";
  return `  #${it.id} ${slotName(it.slot)}${fac} +${it.level} q${s.q}${eq}  — ${subLine(it)}`;
};
const histLine = (arr, keyFn) => {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ");
};

function tierOf(s) {
  if (s.q >= ELITE) return "elite";
  if (s.maxRoll >= ORE_ROLLS) return "gem";
  if (s.maxRoll >= SCARCE_ORE_ROLLS && scarce(s.item)) return "scarce";
  if (atOrBelowFloor(s.item, counts)) return "protected"; // faction/supply spare — below keep-floor
  return "garbage";
}
const scored = pieces.map((it) => ({ item: it, q: quality(it).score, maxRoll: maxRoll(it) }));
for (const s of scored) s.tier = tierOf(s);

const L = [], P = (...x) => L.push(...x);
P(`# ${lookupName(ARTIFACT_SET_NAMES, setId)} ore analysis — ${pieces.length} pieces  (snapshot ${dbPath.split(/[\\/]/).pop()})`, ``);
P(`Levels: ${histLine(pieces, (i) => "+" + i.level)}`);
P(`Tunables: realized-good q≥${ELITE} · ore gem = ${ORE_ROLLS}+ roll substat · scarce slots ${[...SCARCE_SLOTS].map(slotName).join("/")} accept ${SCARCE_ORE_ROLLS}-roll`, ``);

// Focus the verdict on settled (+16) pieces; the +12 pile is summarized separately.
const maxed = scored.filter((s) => s.item.level === 16);
const groups = { elite: [], gem: [], scarce: [], protected: [], garbage: [] };
for (const s of maxed) groups[s.tier].push(s);
const bySlotQ = (arr) => histLine(arr, (s) => slotName(s.item.slot));

P(`## +16 corpus (${maxed.length}) — settled roll distributions`);
P(`  max-roll histogram: ${histLine(maxed, (s) => s.maxRoll + "r")}`);
P(`  tiers: elite ${groups.elite.length} · ore-gems ${groups.gem.length} · scarce-slot ${groups.scarce.length} · floor-protected ${groups.protected.length} · garbage ${groups.garbage.length}`, ``);

P(`### ✅ Realized good (${groups.elite.length}) — keep & use, no ore needed`);
P(`  by slot: ${bySlotQ(groups.elite) || "—"}`);
for (const s of groups.elite.sort((a, b) => b.q - a.q).slice(0, 14)) P(line(s));
P(``);

P(`### 💎 Ore gems (${groups.gem.length}) — keep & ore: a ${ORE_ROLLS}+ roll substat to re-aim onto a top stat`);
P(`  by slot: ${bySlotQ(groups.gem) || "—"}`);
for (const s of groups.gem.sort((a, b) => b.maxRoll - a.maxRoll || a.q - b.q)) P(line(s));
P(``);

if (groups.scarce.length) {
  P(`### 🔸 Scarce-slot ore candidates (${groups.scarce.length}) — double-roll on ${[...SCARCE_SLOTS].map(slotName).join("/")}, supply-permitting`);
  for (const s of groups.scarce.sort((a, b) => a.item.slot - b.item.slot || b.q - a.q)) P(line(s));
  P(``);
}

if (groups.protected.length) {
  P(`### 🛡️ Floor-protected (${groups.protected.length}) — low roll, but a faction/supply spare (bucket ≤ keep-floor of 4 per faction×slot×set); keep`);
  P(`  by slot: ${bySlotQ(groups.protected)}`);
  for (const s of groups.protected.sort((a, b) => a.item.slot - b.item.slot || b.q - a.q).slice(0, 16)) P(line(s));
  P(``);
}
P(`### 🗑️ Garbage even with a perfect ore (${groups.garbage.length}) — spread rolls (max ≤2, non-scarce), above floor; ore can't elevate`);
P(`  by slot: ${bySlotQ(groups.garbage)}`);
P(`  worst 16 (lowest q):`);
for (const s of groups.garbage.sort((a, b) => a.q - b.q).slice(0, 16)) P(line(s));
P(``);

// The +12 pile: roll distribution not final (one more upgrade at +16 can add concentration).
const lvl12 = scored.filter((s) => s.item.level <= 12);
if (lvl12.length) {
  const concentrated = lvl12.filter((s) => s.maxRoll >= ORE_ROLLS);
  const building = lvl12.filter((s) => s.maxRoll === ORE_ROLLS - 1);
  P(`## Under-leveled (${lvl12.length}, ≤+12) — roll distribution NOT final; finish to +16 then re-judge`);
  P(`  already ${ORE_ROLLS}+ roll concentrated (future gems if finished): ${concentrated.length}`);
  for (const s of concentrated.sort((a, b) => b.maxRoll - a.maxRoll || a.item.slot - b.item.slot).slice(0, 12)) P(line(s));
  P(`  one roll away (${ORE_ROLLS - 1} roll): ${building.length}   ·   spread (≤${ORE_ROLLS - 2}): ${lvl12.length - concentrated.length - building.length}`, ``);
}

console.log(L.join("\n"));
