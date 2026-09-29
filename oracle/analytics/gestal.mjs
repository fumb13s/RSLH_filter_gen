// Gestal Desktop snapshots: reading the file refresh-gestal.mjs writes, and decoding Gestal's documents
// into exactly the Item objects (decode.mjs) and champion rows (champs.mjs) the RSLHelper.db readers
// produce, so every analytics tool runs on either source unchanged.
//
// Every mapping below was verified against real data on 2026-09-28: of the pieces and champions in both
// a Gestal capture and an RSLHelper.db snapshot, 7,509 pieces and 1,156 champions decoded identically and
// every other difference was a real change in between (leveling, glyphs, ascension, reworks, champion
// progress). The evidence, and what the mapping cannot provide, are in
// docs/plans/2026-09-28-gestal-snapshot-design.md; cross-check.mjs repeats the comparison whenever both
// sources exist.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { COLUMN_SLOT, SLOT_COLUMNS } from "./gear-common.mjs";

export const FORMAT = "gestal-snapshot";
export const FORMAT_VERSION = 1;

// What a capture takes from Gestal's account folder, keyed by the name each document carries inside the
// snapshot file. `versions` lists the schemaVersions this adapter has been verified against, and is
// enforced only where something here READS the document: gear and roster are decoded, and the last
// extraction dates the snapshot. The three stat sources are kept verbatim for later use whatever their
// version, because nothing reads them yet and refusing a capture over them would block the gear.
export const DOCUMENTS = {
  artifacts: { path: "artifacts.json", versions: [2], required: true },
  champions: { path: "champions.json", versions: [2], required: true },
  "last-extraction": { path: "diagnostics/last-extraction.json", versions: [1] },
  "relic-inventory": { path: "relic-inventory.json" },
  "great-hall-state": { path: "great-hall-state.json" },
  "account-bonuses": { path: "account-bonuses.json" },
};

// Gestal slot id -> our slot id. Gestal's slots are 0-based and ordered Weapon, Helmet, Shield,
// Gauntlets, Chestplate, Boots, Ring, Amulet, Banner; ours are ARTIFACT_SLOT_NAMES (the game's `type`).
export const GESTAL_SLOT = { 0: 5, 1: 1, 2: 6, 3: 3, 4: 2, 5: 4, 6: 7, 7: 8, 8: 9 };

// Gestal stat id -> [our statId, isFlat]. Gestal splits flat and % into separate ids; we keep one id and
// a flag. isFlat follows the RSLHelper.db `fl` flag, which is set for every ABSOLUTE stat — so SPD, ACC
// and RES come back flat, exactly as decode.mjs hands them back.
//
// 16-23 are the damage-type substats (PvE, PvP, Boss, Dungeon DMG +, then the same four −). The game
// numbers them 11-18 in the same order, and that raw id is also what decode.mjs passes through for them,
// so both sources name them alike even though nothing downstream knows them yet.
export const GESTAL_STAT = {
  1: [1, true], 2: [3, true], 3: [2, true], 4: [1, false], 5: [3, false], 6: [2, false],
  7: [4, true], 8: [5, false], 9: [6, false], 10: [8, true], 11: [7, true],
  16: [11, false], 17: [12, false], 18: [13, false], 19: [14, false],
  20: [15, false], 21: [16, false], 22: [17, false], 23: [18, false],
};

// Gestal stores every value as an integer x100 of what the game displays, and the Mythical bonus roll
// is already inside a substat's value. The rounding mirrors decodeValue in lib/decode.mjs — absolute
// stats to whole numbers, percentages to two decimals — so a piece decodes to the SAME number from
// either source, which cross-check.mjs and the gear-diff fingerprints rely on.
//
// One deliberate difference: decodeValue leaves the damage-type substats unscaled (it does not treat
// DB stats 11-18 as percentages), while this reads them as the percent the game shows. Nothing reads
// their values yet; the day something does, decodeValue is the one to fix.
function statValue(ourId, isFlat, raw100) {
  const raw = Number(raw100 ?? 0);
  const absolute = isFlat && (ourId <= 4 || ourId === 7 || ourId === 8);
  return absolute ? Math.round(raw / 100) : Math.round(raw) / 100;
}

function stat(gestalId, what) {
  const hit = GESTAL_STAT[gestalId];
  if (!hit) throw new Error(`unknown Gestal stat id ${gestalId} (${what}) — the adapter needs updating`);
  return hit;
}

// One Gestal artifact -> the Item decode.mjs's decodeRow returns, same keys in the same order.
export function gestalItem(a) {
  const slot = GESTAL_SLOT[a.slot];
  if (slot === undefined) throw new Error(`unknown Gestal slot id ${a.slot} on piece ${a.id} — the adapter needs updating`);
  const [mainId, mainFlat] = stat(a.mainStatId, `main stat of piece ${a.id}`);
  const substats = (a.substats ?? []).map((s) => {
    const [id, flat] = stat(s.statId, `substat of piece ${a.id}`);
    return {
      statId: id, isFlat: flat,
      rolls: s.rolls,                                   // upgrades into it; the reveal is 0, as in the DB
      value: statValue(id, flat, s.value),
      glyph: statValue(id, flat, s.glyphBonusValue),
    };
  });
  const asc = a.ascensionStat;
  const ascStat = asc ? (() => {
    const [id, flat] = stat(asc.statId, `ascension bonus of piece ${a.id}`);
    return { statId: id, isFlat: flat, value: statValue(id, flat, asc.value) };
  })() : null;
  return {
    id: a.id, slot, set: a.gearSetId ?? 0, rank: a.rank,
    rarity: a.rarityId - 1,                             // 0-5 index, as decodeRow
    level: a.level, faction: a.factionId ?? 0,
    isAccessory: slot >= 7 && slot <= 9,
    mainStat: { statId: mainId, isFlat: mainFlat, value: statValue(mainId, mainFlat, a.mainStatValue) },
    substats, ascStat,
    ascLevel: a.ascensionLevel > 0 ? a.ascensionLevel : -1,   // RSLHelper.db's "not ascended" is -1
    equippedChampId: a.equippedOnHeroId ?? 0,
  };
}

// In id order, as the SQLite path returns them (lib/decode.mjs reads ORDER BY ID). Gestal's own order is
// not id order — on the 2026-09-28 capture 2,189 neighbours were out of it — and it is not idle: triage
// sorts on integer scores with no id tiebreak, so which of several equal-score pieces gets deleted,
// focused or trimmed follows input order. Sorting here keeps both sources, and every re-capture, alike.
export function gestalItems(snapshot) {
  return snapshot.documents.artifacts.payload.artifacts.map(gestalItem).sort((a, b) => a.id - b.id);
}

// Champion rows shaped like champs.mjs's readAllChampRows rows, in ID order. The nine slot columns come
// from each piece's CURRENT wearer — Gestal has no per-champion slot list — which is also what the
// SQLite path's slot columns mean. Two pieces claiming one champion's slot would be a broken dump, so
// it throws.
//
// A piece can name a wearer the roster does not list: the gear and roster documents are read on
// separate polls (53 s apart on 2026-09-28), so a champion acquired and geared in between is in one and
// not yet the other. Dropping it would put its gear "in the vault" for restore.mjs and gear-moves.mjs,
// which locate pieces by slot column. It gets the same unnamed placeholder row RSL Helper uses for such
// holders instead: readChampRows leaves it out, readAllChampRows keeps it as a location.
//
// SPD (geared speed as RSL Helper computes it) and Br (meaning unconfirmed) have no Gestal source and
// read null; see the design doc's Gaps.
export function gestalChampRows(snapshot, items = gestalItems(snapshot)) {
  const columnOf = Object.fromEntries(Object.entries(COLUMN_SLOT).map(([col, slot]) => [slot, col]));
  const worn = new Map();
  for (const it of items) {
    if (!it.equippedChampId) continue;
    const slots = worn.get(it.equippedChampId) ?? worn.set(it.equippedChampId, {}).get(it.equippedChampId);
    const col = columnOf[it.slot];
    if (slots[col]) {
      throw new Error(`champion ${it.equippedChampId} wears two ${col} pieces (${slots[col]}, ${it.id})`);
    }
    slots[col] = it.id;
  }
  const slotColumns = (id) => Object.fromEntries(SLOT_COLUMNS.map((col) => [col, worn.get(id)?.[col] ?? 0]));
  const roster = snapshot.documents.champions.payload.champions;
  const rows = roster.map((c) => ({
    ID: c.heroId, Name: c.name, Role: c.roleId, Rarity: c.rarityId, Rang: c.grade, Lvl: c.level,
    Fraction: c.factionId, SPD: null, EmpLvl: c.empowerLevel, ...slotColumns(c.heroId),
    HeroID: c.typeId, BaseHeroID: c.baseTypeId, BId: c.blessingId ?? 0, Br: null,
  }));
  const listed = new Set(roster.map((c) => c.heroId));
  for (const id of worn.keys()) {
    if (listed.has(id)) continue;
    rows.push({ ID: id, Name: "", Role: 0, Rarity: 0, Rang: 0, Lvl: 0, Fraction: 0, SPD: null, EmpLvl: 0,
      ...slotColumns(id), HeroID: null, BaseHeroID: null, BId: 0, Br: null });
  }
  return rows.sort((a, b) => a.ID - b.ID);
}

// Wearer ids no roster row lists (see gestalChampRows) — for the capture to report.
export function unlistedWearers(snapshot, items = gestalItems(snapshot)) {
  const listed = new Set(snapshot.documents.champions.payload.champions.map((c) => c.heroId));
  return [...new Set(items.map((it) => it.equippedChampId).filter((id) => id && !listed.has(id)))];
}

// Throws unless `doc` is a Gestal document this adapter has been verified against.
export function checkDocument(name, doc) {
  const spec = DOCUMENTS[name];
  if (doc == null || typeof doc !== "object" || !doc.payload) {
    throw new Error(`${spec.path}: not a Gestal document`);
  }
  if (spec.versions && !spec.versions.includes(doc.schemaVersion)) {
    throw new Error(`${spec.path}: schemaVersion ${doc.schemaVersion} is not one this adapter knows`
      + ` (${spec.versions.join(", ")}) — Gestal changed its format; update oracle/analytics/gestal.mjs`);
  }
  const list = name === "artifacts" ? "artifacts" : name === "champions" ? "champions" : null;
  if (list && !Array.isArray(doc.payload[list])) throw new Error(`${spec.path}: payload.${list} is missing`);
  return doc;
}

// Validate a parsed snapshot object; returns it.
export function checkSnapshot(snapshot, where = "snapshot") {
  if (snapshot?.format !== FORMAT) throw new Error(`${where}: not a Gestal snapshot`);
  if (snapshot.formatVersion !== FORMAT_VERSION) {
    throw new Error(`${where}: formatVersion ${snapshot.formatVersion} is not ${FORMAT_VERSION}`);
  }
  for (const [name, spec] of Object.entries(DOCUMENTS)) {
    const doc = snapshot.documents?.[name];
    if (doc == null) {
      if (spec.required) throw new Error(`${where}: missing the ${name} document`);
      continue;
    }
    checkDocument(name, doc);
  }
  return snapshot;
}

export function readGestalSnapshot(path) {
  const snapshot = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
  return checkSnapshot(snapshot, path);
}

// A snapshot file is recognised by extension alone: `.json.gz` is Gestal, anything else is SQLite.
export const isGestalPath = (p) => typeof p === "string" && p.endsWith(".json.gz");
