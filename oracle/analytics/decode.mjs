import { DatabaseSync } from "node:sqlite";
import { N, DBSTAT_TO_OURSTAT, decodeValue, SUB } from "../lib/decode.mjs";

// Re-export so tests/consumers can grab the primitive from this one module.
export { decodeValue, N } from "../lib/decode.mjs";

export function isCorrupt(row) {
  const id = N(row.ID), rarity = N(row.rarity), rank = N(row.rank);
  return id <= 0 || rarity < 1 || rarity > 6 || rank < 1 || rank > 6;
}

export function decodeRow(row) {
  const dbMain = N(row.mid), mainFlat = N(row.mfl) !== 0;
  const mainStat = {
    statId: DBSTAT_TO_OURSTAT[dbMain] ?? dbMain,
    isFlat: mainFlat,
    value: decodeValue(dbMain, mainFlat, row.mlvlid),
  };
  const substats = [];
  for (const s of SUB) {
    const dbId = N(row[s.id]);
    if (dbId <= 0) continue;
    const isFlat = N(row[s.fl]) !== 0;
    substats.push({
      statId: DBSTAT_TO_OURSTAT[dbId] ?? dbId,
      isFlat,
      rolls: N(row[s.lvl]),                  // raw 0-based upgrade count; base sub = 0 (probe's `|| 1` is SFC-only)
      value: decodeValue(dbId, isFlat, row[s.base]),
      glyph: decodeValue(dbId, isFlat, row[s.gv]),
    });
  }
  const slot = N(row.type);
  return {
    id: N(row.ID), slot, set: N(row.aset), rank: N(row.rank),
    rarity: N(row.rarity) - 1,                 // 0-5 index (dbRarity-1)
    level: N(row.lvl), faction: N(row.accset),
    isAccessory: slot >= 7 && slot <= 9,
    mainStat, substats,
    ascLevel: N(row.ASCLEVEL), equippedChampId: N(row.cID),
  };
}

const COLS = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset",
  "ASCLEVEL", "cID", ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv])].join(",");

export function readArtifacts(dbPath) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`SELECT ${COLS} FROM Artifacts ORDER BY ID`).all();
  db.close();
  const items = [], corrupt = [];
  for (const row of rows) {
    if (isCorrupt(row)) { corrupt.push(N(row.ID)); continue; }
    items.push(decodeRow(row));
  }
  return { items, corrupt, total: rows.length };
}
