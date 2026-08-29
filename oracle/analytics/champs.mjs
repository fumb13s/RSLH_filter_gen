// Reading and selecting rows from the snapshot's Champs table. Shared by champion-gear.mjs and
// speed.mjs so the champion-selection UX (exact ID vs name substring, "did you mean") is written
// once.
import { DatabaseSync } from "node:sqlite";

// Empty-Name rows are placeholders (they hold no gear, and they are the one place Role disagrees
// across copies of a name), so they never reach the matcher. `typeof` first because Name has no NOT
// NULL constraint, and `null.trim()` throws.
export const isRealChamp = (r) => typeof r.Name === "string" && r.Name.trim() !== "";

// An arg ending .db or containing a separator is the snapshot; the first other arg is the selector.
//
// An EMPTY arg is no arg. `speed.mjs ""` reaches here as [""], and an empty selector matches every
// champion by substring. Dropped here rather than in selectChamps because callers gate their mode on
// the parse result, not on the matcher.
export function parseArgs(argv) {
  const args = argv.filter((a) => a !== "");
  const dbArg = args.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  return { selector: args.find((a) => a !== dbArg) ?? null, dbArg };
}

// All digits -> the exact Champs.ID (IDs are opaque, so a substring match on one means nothing);
// any other text -> a case-insensitive Name substring; no selector -> everyone. Falsy rather than
// `=== null` so an empty or absent selector can't reach `.toLowerCase()`.
export function selectChamps(rows, selector) {
  if (!selector) return rows;
  if (/^\d+$/.test(selector)) return rows.filter((r) => Number(r.ID) === Number(selector));
  const nf = selector.toLowerCase();
  return rows.filter((r) => r.Name.toLowerCase().includes(nf));
}

// What to offer after a selector matched nothing. A shared prefix, not an edit distance: the
// realistic miss is a half-remembered or half-typed name, and the opening characters are what the
// user is most likely to have right. Deduplicated because the roster holds one row per COPY, and
// capped because a three-character prefix can cover a lot of a 500-champion roster.
export function suggestNames(rows, selector, limit = 8) {
  const prefix = String(selector).slice(0, 3).toLowerCase();
  const near = rows.filter((r) => r.Name.toLowerCase().startsWith(prefix));
  return [...new Set(near.map((r) => r.Name))].slice(0, limit);
}

// --- I/O --------------------------------------------------------------------

// readOnly makes SELECT-only structural rather than conventional, and — the reason it's here — it
// refuses to CREATE the file: without it a typo'd snapshot path leaves a stray 0-byte .db behind
// before failing on the missing table.
//
// The column list is the union of what three consumers want, and each ignores the rest:
// Fraction/SPD/EmpLvl are speed.mjs's, and the nine gear-slot columns are gear-moves.mjs's.
// Those nine carry the schema's own misspellings (Glouves, Amulett) and must be copied verbatim.
// Their ORDER IS NOT SLOT-ID ORDER — Weapon is slot 5, Helmet is 1, Shield 6, Glouves 3, Chest 2,
// Shoes 4, and only Ring/Amulett/Banner line up — so a consumer takes an item's slot from the item,
// never from the column that referenced it.
//
// Naming the columns is load-bearing, not stylistic: SELECT * throws RangeError ERR_OUT_OF_RANGE
// because RecentBattleTicks holds values beyond JS number range.
export function readChampRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const st = db.prepare(
      "SELECT ID, Name, Role, Rarity, Rang, Lvl, Fraction, SPD, EmpLvl,"
      + " Weapon, Helmet, Shield, Glouves, Chest, Shoes, Ring, Amulett, Banner FROM Champs");
    st.setReadBigInts(true);
    const rows = st.all().map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    return rows.filter(isRealChamp);
  } finally {
    db.close();
  }
}
