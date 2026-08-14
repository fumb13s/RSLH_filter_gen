// Shared DB-decode primitives for RSLHelper.db gear. Imported by oracle/probe (differential
// probe vs Sellfile Creator) and oracle/analytics (gear triage) so the two never drift.
import { DatabaseSync } from "node:sqlite";

export const POW32 = 2 ** 32;
export const N = (v) => (v == null ? 0 : Number(v)); // node:sqlite returns BigInt
// DB stat enum (1HP 2ATK 3DEF 4SPD 5RES 6ACC 7CRATE 8CDMG) -> our STAT_NAMES id.
export const DBSTAT_TO_OURSTAT = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 5, 8: 6 };
export const PCT_ALWAYS = new Set([7, 8]);        // DB CR, CDMG -> always *100
export const PCT_WHEN_PCT = new Set([1, 2, 3]);   // DB HP/ATK/DEF -> *100 only when not flat

// value = lvlid/2**32, *100 for percentages. Same encoding for substat base values, glyphs,
// and the Mythical bonus roll (sNmlvlid).
export function decodeValue(dbStatId, isFlat, rawBase) {
  const raw = N(rawBase);
  if (raw === 0) return 0;
  const v = raw / POW32;
  const pct = PCT_ALWAYS.has(dbStatId) || (!isFlat && PCT_WHEN_PCT.has(dbStatId));
  if (pct) return Math.round(v * 100 * 100) / 100;
  if (dbStatId >= 1 && dbStatId <= 6) return Math.round(v);
  return Math.round(v * 1000) / 1000;
}

// s1..s4 substat column names. `gv` (glyph) and `myth` (Mythical bonus roll, sNmlvlid) are used
// by analytics; probe's SELECT lists [id, fl, lvl, base] explicitly, so the extras are invisible to it.
export const SUB = [1, 2, 3, 4].map((i) => ({
  id: `s${i}id`, fl: `s${i}fl`, lvl: `s${i}lvl`, base: `s${i}lvlid`, gv: `s${i}gv`, myth: `s${i}mlvlid`,
}));

// The artifact ascension bonus stat, encoded exactly like a substat. There is deliberately no glyph
// column here: ASCGV is 0 in all 8474 rows of the 2026-08-12 snapshot, as is the main-stat glyph
// mgv, so glyphs only ever apply to substats. probe.mjs names its columns explicitly and never sees
// this.
export const ASC = { id: "ASCID", fl: "ASCFL", base: "ASCLVLID" };

// The single Artifacts-table read mechanism, shared by probe + analytics — adjust gear reads here
// only. Integers come back as BigInt (setReadBigInts): the live DB occasionally holds a corrupt row
// with 64-bit garbage in sNgv/sNmlvlid that overflows a JS number, and node:sqlite throws on .all()
// unless BigInt reads are on. N() coerces every column back to a Number downstream; callers filter
// corrupt rows (see isCorrupt). `cols` is a comma-separated column list; rows are returned ORDER BY ID.
export function readArtifactRows(dbPath, cols) {
  const db = new DatabaseSync(dbPath);
  const stmt = db.prepare(`SELECT ${cols} FROM Artifacts ORDER BY ID`);
  stmt.setReadBigInts(true);
  const rows = stmt.all();
  db.close();
  return rows;
}
