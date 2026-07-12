// Worst NON-ACCESSORY items (slots 1–6: Helmet/Chest/Gloves/Boots/Weapon/Shield), EXCLUDING the
// keepers — "triple rolls waiting for an ore in a good set" (= set-analysis ore-gems: a demanded
// set + a 3+ roll substat, or a 2+ roll on the scarce Chest/Gloves slots). Ranks the rest worst-q
// first and resolves the equipped champ, so what's left is genuinely trashable.
//   node oracle/analytics/worst-items.mjs [limit=100] [snapshot.db]
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readArtifacts } from "./decode.mjs";
import { quality } from "./score.mjs";
import { keepPremium } from "./triage.mjs";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, statDisplayName, lookupName } from "@rslh/core";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
function resolveDb(arg) {
  if (arg) return arg;
  const dir = here("../resources");
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error("no snapshot found; run refresh.sh"); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

const LIMIT = Number(process.argv[2]) || 100;
const dbPath = resolveDb(process.argv[3]);

// equipped-champ map: Artifacts.cID -> Champs.ID -> Name
const db = new DatabaseSync(dbPath);
const cst = db.prepare("SELECT ID, Name FROM Champs");
cst.setReadBigInts(true);
const champName = new Map(cst.all().map((r) => [Number(r.ID), r.Name]));
db.close();

const { items } = readArtifacts(dbPath);
const SCARCE = new Set([2, 3]); // Chest, Gloves — hardest slots to replace
const maxRoll = (it) => it.substats.reduce((m, s) => Math.max(m, s.rolls), 0);
const goodSet = (it) => keepPremium(it.set) >= 4;                // demanded set (premium >= focusPremium)
const oreGem = (it) => { const mr = maxRoll(it); return mr >= 3 || (mr >= 2 && SCARCE.has(it.slot)); };
const keeper = (it) => goodSet(it) && oreGem(it);               // triple-roll waiting for an ore in a good set

const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setName = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);
const RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical"];
const statStr = (st) => `${statDisplayName(st.statId, st.isFlat)} ${st.value}`;
const subStr = (it) => it.substats.map((s) => `${statStr(s)}[${s.rolls}r]`).join(", ");
const champOf = (it) => (it.equippedChampId > 0 ? (champName.get(it.equippedChampId) || `cID ${it.equippedChampId}?`) : "unequipped");

const nonAcc = items.filter((it) => it.slot >= 1 && it.slot <= 6)
  .map((it) => ({ it, q: quality(it).score, mr: maxRoll(it), good: goodSet(it), keep: keeper(it) }));
const maxed = nonAcc.filter((a) => a.it.level === 16);
const worst = maxed.filter((a) => !a.keep).sort((a, b) => a.q - b.q).slice(0, LIMIT);

console.log(`# Worst non-accessory items — snapshot ${dbPath.split(/[\\/]/).pop()}`);
console.log(`non-accessory items ${nonAcc.length} · +16 ${maxed.length} · excluded good-set ore-gems ${maxed.filter((a) => a.keep).length} · showing worst ${worst.length} (q ${worst[0]?.q}..${worst[worst.length - 1]?.q})`);
console.log(`(good-set-but-not-a-gem marked *; sub "Stat v[Nr]" = value & extra-roll count)\n`);

for (let i = 0; i < worst.length; i++) {
  const { it, q, mr, good } = worst[i];
  console.log(`${String(i + 1).padStart(3)}. #${it.id} q${String(q).padStart(2)} r${mr} ${slotName(it.slot)} · ${setName(it.set)}${good ? "*" : ""} +${it.level} ${RARITY[it.rarity]} | ${statStr(it.mainStat)} | ${subStr(it)} | ${champOf(it)}`);
}
