// Worst ARTIFACTS — the non-accessory items (slots 1–6: Helmet/Chest/Gloves/Boots/Weapon/Shield),
// EXCLUDING the keepers: "triple rolls waiting for an ore in a good set" (= set-analysis ore-gems:
// a demanded set + a 3+ roll substat, or a 2+ roll on the scarce Chest/Gloves slots). Ranks the
// rest worst-first and resolves the equipped champ (equipped + unequipped both shown). Includes
// under-16 items down to minLevel, ranked by their POTENTIAL q (score if finished to 6★+16) — a
// +12's current q is depressed by being unleveled, so low potential = "not worth finishing, delete",
// while high potential is an upgrade candidate, not junk.
//   node oracle/analytics/worst-artifacts.mjs [limit=100] [minLevel=12] [snapshot.db]
//   (numeric args -> limit then minLevel; a non-numeric arg -> db path)
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

const argv = process.argv.slice(2);
const nums = argv.filter((a) => /^\d+$/.test(a)).map(Number);
const LIMIT = nums[0] ?? 100;
const MIN_LEVEL = nums[1] ?? 12;
const dbPath = resolveDb(argv.find((a) => !/^\d+$/.test(a)));

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

// artifacts = non-accessory items (slots 1–6); accessories are slots 7–9.
const isArtifact = (it) => it.slot >= 1 && it.slot <= 6;
const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setName = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);
const RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical"];
const statStr = (st) => `${statDisplayName(st.statId, st.isFlat)} ${st.value}`;
const subStr = (it) => it.substats.map((s) => `${statStr(s)}[${s.rolls}r]`).join(", ");
const champOf = (it) => (it.equippedChampId > 0 ? (champName.get(it.equippedChampId) || `cID ${it.equippedChampId}?`) : "unequipped");

const artifacts = items.filter(isArtifact).map((it) => {
  const q = quality(it).score;                 // as-is: value-completeness of main + subs
  const potential = quality(it, true).score;   // if finished to 6★+16, judged on stat TYPES only
  // +16 judged as-is; under-16 judged on finished potential so we don't flag finishable gems as junk.
  const removal = it.level >= 16 ? q : potential;
  return { it, q, potential, removal, mr: maxRoll(it), good: goodSet(it), keep: keeper(it) };
});
const pool = artifacts.filter((a) => a.it.level >= MIN_LEVEL);
const worst = pool.filter((a) => !a.keep).sort((a, b) => a.removal - b.removal).slice(0, LIMIT);

const n16 = pool.filter((a) => a.it.level === 16).length;
console.log(`# Worst artifacts (non-accessory items, slots 1–6) — snapshot ${dbPath.split(/[\\/]/).pop()}`);
console.log(`pool +${MIN_LEVEL}.. ${pool.length} (+16 ${n16}, under-16 ${pool.length - n16}) · excluded good-set ore-gems ${pool.filter((a) => a.keep).length} · showing worst ${worst.length}`);
console.log(`(sorted by potential q; under-16 shown "q<now>→<if finished>"; good-set-but-not-a-gem marked *; sub "Stat v[Nr]" = value & extra rolls)\n`);

for (let i = 0; i < worst.length; i++) {
  const { it, q, potential, mr, good } = worst[i];
  const qTag = it.level >= 16 ? `q${q}` : `q${q}→${potential}`; // under-16: current -> finished potential
  console.log(`${String(i + 1).padStart(3)}. #${it.id} ${qTag} r${mr} ${slotName(it.slot)} · ${setName(it.set)}${good ? "*" : ""} +${it.level} ${RARITY[it.rarity]} | ${statStr(it.mainStat)} | ${subStr(it)} | ${champOf(it)}`);
}
