// Shared DB-decode primitives for RSLHelper.db gear. Imported by oracle/probe (differential
// probe vs Sellfile Creator) and oracle/analytics (gear triage) so the two never drift.
export const POW32 = 2 ** 32;
export const N = (v) => (v == null ? 0 : Number(v)); // node:sqlite returns BigInt
// DB stat enum (1HP 2ATK 3DEF 4SPD 5RES 6ACC 7CRATE 8CDMG) -> our STAT_NAMES id.
export const DBSTAT_TO_OURSTAT = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 5, 8: 6 };
export const PCT_ALWAYS = new Set([7, 8]);        // DB CR, CDMG -> always *100
export const PCT_WHEN_PCT = new Set([1, 2, 3]);   // DB HP/ATK/DEF -> *100 only when not flat

// value = lvlid/2**32, *100 for percentages. Same encoding for substat values AND glyphs.
export function decodeValue(dbStatId, isFlat, rawBase) {
  const raw = N(rawBase);
  if (raw === 0) return 0;
  const v = raw / POW32;
  const pct = PCT_ALWAYS.has(dbStatId) || (!isFlat && PCT_WHEN_PCT.has(dbStatId));
  if (pct) return Math.round(v * 100 * 100) / 100;
  if (dbStatId >= 1 && dbStatId <= 6) return Math.round(v);
  return Math.round(v * 1000) / 1000;
}

// s1..s4 substat column names. `gv` (glyph value) is used by analytics; probe's SELECT lists
// [id, fl, lvl, base] explicitly, so the extra field is invisible to it.
export const SUB = [1, 2, 3, 4].map((i) => ({
  id: `s${i}id`, fl: `s${i}fl`, lvl: `s${i}lvl`, base: `s${i}lvlid`, gv: `s${i}gv`,
}));
