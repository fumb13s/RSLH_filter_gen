// Gear restore map: diff two snapshots and say which piece belongs on whom, and where it is now.
//
// The use case is a "driver" session — the account is handed to someone else to build teams, they
// rearrange worn gear across dozens of champions, and afterwards it all has to go back. Bracket the
// session with two snapshots and this turns the delta into a worklist.
//
//   node oracle/analytics/restore.mjs [before.db] [after.db] [-o out.md]
//     before.db   the pre-session snapshot (default: the newest *-pre-driver.db)
//     after.db    the post-session snapshot (default: the newest *-post-driver.db)
//     -o          output path (default: findings/<after's date>-driver-restore.md)
//
// Two views of the same moves, because the restore is done by hand in the game and the round trips
// are the cost: §1 keyed by OWNER (open a champion, see its changed slots) and §2 keyed by CURRENT
// HOLDER (open a champion the driver geared up and strip it in one pass). A piece handed back closes
// a line in both.
//
// Items are described by what is VISIBLE on them in the game — rarity, rank, set, slot, level, main,
// substats with glyphs, faction — because that is what you match against on screen. Ids are a
// trailing reference only.

import { readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, FACTION_NAMES, ITEM_RARITIES, lookupName,
  statDisplayName } from "@rslh/core";
import { readArtifacts } from "./decode.mjs";

// The Champs equipped-slot columns. Two are misspelled in the schema (Glouves, Amulett) and one is
// named for the game's own wording (Shoes = Boots); SLOT_LABEL is what the reader sees.
export const SLOT_COLS = ["Weapon", "Helmet", "Shield", "Glouves", "Chest", "Shoes", "Ring",
  "Amulett", "Banner"];
export const SLOT_LABEL = { Weapon: "Weapon", Helmet: "Helmet", Shield: "Shield", Glouves: "Gloves",
  Chest: "Chest", Shoes: "Boots", Ring: "Ring", Amulett: "Amulet", Banner: "Banner" };

// --- pure helpers -----------------------------------------------------------

// Visible-attribute fingerprint, substats order-normalized. Two pieces that share one are
// indistinguishable on screen, so the report says "either will do" rather than sending the reader
// hunting for a specific id it cannot see. Order-normalized because the substat COLUMN order is
// storage detail: the game lists them in its own order, and an order-sensitive key would call two
// identical-looking pieces different.
export function fingerprint(it) {
  return [
    it.set, it.slot, it.rarity, it.rank, it.faction,
    `${it.mainStat.statId}:${it.mainStat.isFlat}:${it.mainStat.value}`,
    it.substats.map((s) => `${s.statId}:${s.isFlat}:${s.value}`).sort().join("+"),
  ].join("|");
}

// Every slot whose occupant changed, from both sides.
//   restore[champId]   what that champion LOST — the piece that belongs there, and where it is now
//   intruders[champId] what that champion GAINED — a piece to take back off, and where it came from
//
// Iterating the UNION of both rosters is load-bearing: a champion summoned mid-session exists only
// in `after`, and keying off `before` alone would drop them from the strip list while their slots
// hold someone else's gear.
export function diffSlots(before, after) {
  const restore = new Map(), intruders = new Map();
  let gone = 0;
  for (const cid of new Set([...before.champs.keys(), ...after.champs.keys()])) {
    const ca = before.champs.get(cid), cb = after.champs.get(cid);
    for (const col of SLOT_COLS) {
      const wasId = Number(ca?.[col] ?? 0), nowId = Number(cb?.[col] ?? 0);
      if (wasId === nowId) continue;
      if (wasId > 0) {
        if (!restore.has(cid)) restore.set(cid, []);
        const now = after.items.get(wasId), then = before.items.get(wasId);
        // Absent from `after` entirely = sold or consumed. Nothing to restore; say so and move on.
        if (!now) { gone++; restore.get(cid).push({ col, item: then, gone: true }); continue; }
        restore.get(cid).push({
          col, item: now, beforeLevel: then?.level, nowOn: after.loc.get(wasId) ?? null });
      }
      if (nowId > 0) {
        if (!intruders.has(cid)) intruders.set(cid, []);
        intruders.get(cid).push({
          col, item: after.items.get(nowId), cameFrom: before.loc.get(nowId) ?? null });
      }
    }
  }
  const slots = [...restore.values()].reduce((n, v) => n + v.length, 0);
  return { restore, intruders, gone, slots };
}

// --- I/O and formatting -----------------------------------------------------

const RESOURCES = fileURLToPath(new URL("../resources", import.meta.url));
const FINDINGS = fileURLToPath(new URL("./findings", import.meta.url));

// Newest snapshot matching a suffix. These names sit deliberately outside the /-RSLHelper\.db$/
// glob the other tools default to, so a bracketing snapshot is never picked up by accident.
function newest(suffix) {
  const hits = readdirSync(RESOURCES).filter((f) => f.endsWith(suffix)).sort();
  return hits.length ? `${RESOURCES}/${hits[hits.length - 1]}` : null;
}

function readChamps(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const st = db.prepare(`SELECT ID, Name, SPD, ${SLOT_COLS.join(", ")} FROM Champs`);
    st.setReadBigInts(true);
    return st.all().map((r) => Object.fromEntries(Object.entries(r)
      .map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
  } finally {
    db.close();
  }
}

// A snapshot as the diff wants it. `loc` is built from the Champs slot columns and NOT from
// Artifacts.cID: cID keeps naming the last wearer after a piece is unequipped, so it reports gear as
// still worn when it is sitting in the vault.
export function load(dbPath) {
  const { items } = readArtifacts(dbPath);
  const champs = readChamps(dbPath);
  const loc = new Map();
  for (const c of champs) {
    for (const col of SLOT_COLS) {
      const id = Number(c[col] ?? 0);
      if (id > 0) loc.set(id, Number(c.ID));
    }
  }
  return {
    items: new Map(items.map((i) => [i.id, i])), all: items,
    champs: new Map(champs.map((c) => [Number(c.ID), c])), loc,
  };
}

const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const stat = (s) => `${num(s.value)}${s.isFlat ? "" : "%"} ${statDisplayName(s.statId, s.isFlat)}`;
const setName = (id) => (id === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, id));

function describe(it, collisions, beforeLevel) {
  const subs = it.substats
    .map((s) => `${stat(s)}${s.glyph ? ` (+${num(s.glyph)} glyph)` : ""}`).join(", ");
  const fac = it.isAccessory && it.faction ? ` [${lookupName(FACTION_NAMES, it.faction)}]` : "";
  const asc = it.ascStat ? ` · asc ${stat(it.ascStat)}` : "";
  const dupes = collisions.get(fingerprint(it)) ?? 1;
  const dupe = dupes > 1 ? `  **(${dupes} identical — either will do)**` : "";
  // A piece the driver leveled reads higher than it did before, so flag it or the reader will think
  // they are looking at the wrong item.
  const lvl = beforeLevel != null && beforeLevel !== it.level
    ? ` **[leveled +${beforeLevel}→+${it.level} during the session]**` : "";
  return `${ITEM_RARITIES[it.rarity]} ${it.rank}★ ${setName(it.set)} `
    + `${lookupName(ARTIFACT_SLOT_NAMES, it.slot)} +${it.level}${fac}`
    + ` — main ${stat(it.mainStat)}; ${subs}${asc} · #${it.id}${lvl}${dupe}`;
}

export function buildReport(before, after, meta) {
  const { restore, intruders, gone, slots } = diffSlots(before, after);
  const collisions = new Map();
  for (const it of after.all) {
    collisions.set(fingerprint(it), (collisions.get(fingerprint(it)) || 0) + 1);
  }
  const newChamps = new Set([...after.champs.keys()].filter((id) => !before.champs.has(id)));
  const name = (id) => (before.champs.get(id) ?? after.champs.get(id))?.Name ?? `#${id}`;
  const holder = (id) => (after.champs.get(id) ?? before.champs.get(id))?.Name ?? `#${id}`;
  const label = (id) => {
    if (id == null) return "**the vault (unequipped)**";
    return after.champs.get(id) || before.champs.get(id) ? `**${name(id)}** #${id}`
      : `unknown champion #${id}`;
  };
  const spd = (id) => {
    const a = before.champs.get(id), b = after.champs.get(id);
    return a && b ? ` · SPD ${a.SPD} → ${b.SPD}` : "";
  };
  const bySize = (pick) => (x, y) => y[1].length - x[1].length || (pick(x[0]) > pick(y[0]) ? 1 : -1);

  const L = [];
  const P = (...s) => L.push(...s);
  P(`# Gear restore map — before → after (${meta.after.date})`);
  P(``);
  P(`Baselines: \`${meta.before.file}\` (${meta.before.when}) → \`${meta.after.file}\``
    + ` (${meta.after.when}).`);
  P(`Locations read from the \`Champs\` slot columns, not \`Artifacts.cID\``
    + ` (cID keeps naming the last wearer).`);
  P(``);
  P(`- **${slots} slots to put back** across **${restore.size} champions**.`);
  P(`- **${gone} items sold or consumed**`
    + `${gone === 0 ? " — nothing is unrecoverable." : " — see the ⚠️ GONE lines."}`);
  P(`- Items are described as they look **now** (after); a piece that was leveled is tagged, because`);
  P(`  its substat values read higher than they did before.`);
  if (newChamps.size) {
    P(`- ${newChamps.size} champion${newChamps.size > 1 ? "s were" : " was"} added to the roster`
      + ` during the session;`);
    P(`  ${[...newChamps].filter((id) => intruders.has(id)).length} of them hold moved gear.`);
  }
  P(``);
  P(`## 1. Put back, by champion`);
  P(``);
  P(`Each line is a slot that changed: the piece that belongs there, and where it is now. Equipping a`);
  P(`piece that another champion is wearing takes it off them in one step.`);
  P(``);
  for (const [cid, rows] of [...restore.entries()].sort(bySize(name))) {
    P(`### ${name(cid)} #${cid} — ${rows.length} slot${rows.length > 1 ? "s" : ""}${spd(cid)}`);
    P(``);
    for (const r of rows.sort((x, y) => SLOT_COLS.indexOf(x.col) - SLOT_COLS.indexOf(y.col))) {
      if (r.gone) {
        P(`- **${SLOT_LABEL[r.col]}** — ⚠️ GONE (sold/consumed): ${describe(r.item, collisions)}`);
        continue;
      }
      P(`- **${SLOT_LABEL[r.col]}** — now on ${label(r.nowOn)}`);
      P(`  - ${describe(r.item, collisions, r.beforeLevel)}`);
    }
    P(``);
  }

  P(`## 2. Strip list, by current holder`);
  P(``);
  P(`The same moves keyed the other way: open a champion that was geared up, and every piece on them`);
  P(`that moved is listed with the champion it came off — which is also where it goes back. Handing a`);
  P(`piece back empties the slot here, so a champion can be cleared in one pass.`);
  P(``);
  const onChamps = [...intruders.values()].reduce((n, v) => n + v.length, 0);
  const handBack = [...intruders.values()]
    .reduce((n, v) => n + v.filter((r) => r.cameFrom !== null).length, 0);
  P(`Only the ${onChamps} pieces sitting **on a champion** appear here (${handBack} off other`);
  P(`champions, ${onChamps - handBack} out of the vault). The other ${slots - handBack} moved pieces`);
  P(`are already unequipped — section 1 is the only place they show up.`);
  P(``);
  for (const [cid, rows] of [...intruders.entries()].sort(bySize(holder))) {
    const backHome = rows.filter((r) => r.cameFrom !== null).length;
    P(`### ${holder(cid)} #${cid} — wearing ${rows.length} moved`
      + ` piece${rows.length > 1 ? "s" : ""} (${backHome} to hand back,`
      + ` ${rows.length - backHome} from the vault)${spd(cid)}`
      + `${newChamps.has(cid) ? " · **new this session**" : ""}`);
    P(``);
    for (const r of rows.sort((x, y) => SLOT_COLS.indexOf(x.col) - SLOT_COLS.indexOf(y.col))) {
      P(`- **${SLOT_LABEL[r.col]}** ${r.cameFrom === null
        ? "→ back to **the vault** (displaced automatically when this slot is restored)"
        : `→ back to ${label(r.cameFrom)}`}`);
      P(`  - ${describe(r.item, collisions, before.items.get(r.item.id)?.level)}`);
    }
    P(``);
  }
  return { text: L.join("\n") + "\n", slots, gone, champs: restore.size, onChamps, newChamps };
}

// mtime rather than a typed-in date: the "after" snapshot is re-taken repeatedly during a restore,
// and a hand-written stamp silently mislabels which run a report describes. Shifted by the local
// offset before formatting so the stamp reads in the same clock the snapshot was taken in.
function stampOf(path) {
  const { mtime } = statSync(path);
  const iso = new Date(mtime.getTime() - mtime.getTimezoneOffset() * 60000).toISOString();
  return {
    file: path.split(/[\\/]/).pop(),
    when: iso.slice(0, 16).replace("T", " "),
    date: iso.slice(0, 10),
  };
}

function parseArgs(argv) {
  const out = { dbs: [], o: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-o") { out.o = argv[++i]; continue; }
    if (argv[i]) out.dbs.push(argv[i]);
  }
  return out;
}

function main() {
  const { dbs, o } = parseArgs(process.argv.slice(2));
  const beforePath = dbs[0] ?? newest("-pre-driver.db");
  const afterPath = dbs[1] ?? newest("-post-driver.db");
  if (!beforePath || !afterPath) {
    console.error("need two snapshots: node oracle/analytics/restore.mjs before.db after.db\n"
      + `looked for *-pre-driver.db and *-post-driver.db in ${RESOURCES}`);
    process.exit(1);
  }
  const meta = { before: stampOf(beforePath), after: stampOf(afterPath) };
  const r = buildReport(load(beforePath), load(afterPath), meta);
  const out = o ?? `${FINDINGS}/${meta.after.date}-driver-restore.md`;
  writeFileSync(out, r.text);
  console.log(`${meta.before.file} (${meta.before.when}) -> ${meta.after.file} (${meta.after.when})`);
  console.log(`slots to restore: ${r.slots} across ${r.champs} champions`);
  console.log(`gone (unrecoverable): ${r.gone}`);
  console.log(`pieces sitting on a champion: ${r.onChamps}`);
  console.log(`wrote ${out}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
