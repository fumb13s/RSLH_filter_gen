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

// --- I/O --------------------------------------------------------------------

// readOnly makes SELECT-only structural rather than conventional, and — the reason it's here — it
// refuses to CREATE the file: without it a typo'd snapshot path leaves a stray 0-byte .db behind
// before failing on the missing table. Fraction/SPD/EmpLvl are for speed.mjs; champion-gear.mjs
// ignores them.
export function readChampRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const st = db.prepare(
      "SELECT ID, Name, Role, Rarity, Rang, Lvl, Fraction, SPD, EmpLvl FROM Champs");
    st.setReadBigInts(true);
    const rows = st.all().map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    return rows.filter(isRealChamp);
  } finally {
    db.close();
  }
}
