// Spare-copy lookup: for each champion at/above a rarity floor (default Legendary) with 2+ copies,
// pick the most-invested copy as the KEEPER and report the rest as SPARES, tagged by how much
// you've sunk into each — so food-ready duplicates are easy to tell apart from copies you built on
// purpose (a 2nd maxed copy for a duplicate team, a rank-up in progress, etc.).
//
//   node oracle/analytics/spare-copies.mjs [minRarity=5] [name-substring] [snapshot.db]
//     minRarity   numeric 1-6 (5 = Legendary+, 6 = Mythical only); matches Rarity >= this.
//     name        a non-numeric arg without a slash or .db -> case-insensitive Name filter; also
//                 switches to per-copy detail (and shows a champ even when it has no spare).
//     snapshot.db an arg ending in .db or containing a slash -> which snapshot (default: newest).
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Gear columns on Champs — one per equip slot (6 artifacts + 3 accessories). Non-zero = something equipped.
export const GEAR_SLOTS = ["Weapon", "Helmet", "Shield", "Glouves", "Chest", "Shoes", "Ring", "Amulett", "Banner"];
export const gearCount = (row) => GEAR_SLOTS.reduce((n, g) => n + (Number(row[g]) > 0 ? 1 : 0), 0);

// Investment order for keeper selection: rank, then level, then gear, then empower, then blessing,
// then oldest ID (stable). Sorting a champion's copies with this puts the KEEPER first.
export function compareCopies(a, b) {
  return (b.Rang - a.Rang)
    || (b.Lvl - a.Lvl)
    || (gearCount(b) - gearCount(a))
    || (b.EmpLvl - a.EmpLvl)
    || ((b.Br ? 1 : 0) - (a.Br ? 1 : 0))
    || (a.ID - b.ID);
}

// How much a copy has been invested in — drives the food-vs-keep call.
//   maxed   6★ and level 60      — fully built; a duplicate maxed copy is almost always intentional.
//   bare    level <=1, ungeared, un-empowered — pristine; safe fusion food (rank shown separately).
//   partial anything in between   — some resources sunk in; look before you fuse.
export function classifyCopy(row) {
  if (Number(row.Rang) >= 6 && Number(row.Lvl) >= 60) return "maxed";
  if (Number(row.Lvl) <= 1 && gearCount(row) === 0 && Number(row.EmpLvl) === 0) return "bare";
  return "partial";
}

// Copies of one champion share a single BaseHeroID; Name is the readable 1:1 key, so group by Name.
export function groupByName(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.Name)) m.set(r.Name, []);
    m.get(r.Name).push(r);
  }
  return m;
}

// Pick keeper + tag spares for one champion's copies. A lone copy yields an empty spares list.
export function analyzeChampion(name, copies) {
  const [keeper, ...rest] = [...copies].sort(compareCopies);
  const spares = rest.map((row) => ({ row, tag: classifyCopy(row) }));
  const tags = { maxed: 0, partial: 0, bare: 0 };
  for (const s of spares) tags[s.tag]++;
  return { name, rarity: Number(keeper.Rarity), total: copies.length, keeper, spares, tags };
}

// Champs.Rarity is 1-indexed (1=Common … 6=Mythical) — NOT the 0-indexed scheme the .hsf/artifact
// tables use. Explicit map so the two never get confused again. (0 = a handful of untyped rows.)
const RARITY = { 0: "?", 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary", 6: "Mythical" };
const rTag = (r) => RARITY[r] || `r${r}`;
const copyLine = (row) => `#${row.ID}  ${row.Rang}★ +${row.Lvl}  ${gearCount(row)}/9 gear`
  + `${row.EmpLvl ? ` emp${row.EmpLvl}` : ""}${row.Br ? " ✦blessed" : ""}`;

function resolveDb(arg) {
  if (arg) return arg;
  const dir = fileURLToPath(new URL("../resources", import.meta.url));
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error("no snapshot found; run refresh.sh"); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

function main() {
  const argv = process.argv.slice(2);
  const minRarity = argv.filter((a) => /^\d+$/.test(a)).map(Number)[0] ?? 5;
  const rest = argv.filter((a) => !/^\d+$/.test(a));
  const dbArg = rest.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  const nameFilter = rest.find((a) => a !== dbArg) ?? null;
  const dbPath = resolveDb(dbArg);

  const db = new DatabaseSync(dbPath);
  const cols = ["ID", "Name", "Rarity", "Rang", "Lvl", "EmpLvl", "Br", "BaseHeroID", ...GEAR_SLOTS].join(", ");
  const rows = db.prepare(`SELECT ${cols} FROM Champs WHERE Rarity >= ?`).all(minRarity);
  db.close();

  const nf = nameFilter ? nameFilter.toLowerCase() : null;
  const pool = nf ? rows.filter((r) => r.Name.toLowerCase().includes(nf)) : rows;
  const groups = [...groupByName(pool).entries()]
    .map(([name, copies]) => analyzeChampion(name, copies))
    .filter((g) => (nf ? true : g.spares.length > 0)) // name lookup shows even 0-spare champs
    .sort((a, b) => b.spares.length - a.spares.length || b.total - a.total || a.name.localeCompare(b.name));

  const snap = dbPath.split(/[\\/]/).pop();
  const label = minRarity >= 6 ? "Mythical" : minRarity === 5 ? "Legendary+" : `${rTag(minRarity)}+`;
  const withSpares = groups.filter((g) => g.spares.length > 0);
  const totSpares = withSpares.reduce((n, g) => n + g.spares.length, 0);
  const tot = { maxed: 0, partial: 0, bare: 0 };
  for (const g of groups) for (const k of Object.keys(tot)) tot[k] += g.tags[k];

  console.log(`# Spare copies (${label}) — snapshot ${snap}`);
  console.log(`${withSpares.length} champion(s) with spares · ${totSpares} spare copies · `
    + `${tot.bare} bare (food-ready), ${tot.partial} partial, ${tot.maxed} maxed (likely intentional)`);
  console.log(nf
    ? `filter: name ~ "${nameFilter}" — per-copy detail\n`
    : `(one line per champion; pass a name to see per-copy detail)\n`);

  if (nf) {
    for (const g of groups) {
      console.log(`## ${g.name}  (${rTag(g.rarity)}) — ${g.total} copies, ${g.spares.length} spare(s)`);
      console.log(`   keeper   ${copyLine(g.keeper)}`);
      for (const { row, tag } of g.spares) console.log(`   ${tag.padEnd(8)} ${copyLine(row)}`);
      console.log("");
    }
  } else {
    for (const g of groups) {
      const parts = ["maxed", "partial", "bare"].filter((t) => g.tags[t]).map((t) => `${g.tags[t]} ${t}`);
      const k = g.keeper;
      console.log(`${String(g.total).padStart(2)}x  ${g.name}${g.rarity >= 6 ? " [Mythical]" : ""}  `
        + `→ keeper ${k.Rang}★ +${k.Lvl} ${gearCount(k)}/9${k.Br ? " ✦" : ""} · spares: ${parts.join(", ")}`);
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
