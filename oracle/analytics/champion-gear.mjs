// Per-champion gear triage: rate each piece a champion is WEARING as KEEP / BORDERLINE / SELL.
//
// The vault report (analyze.mjs) can't answer this — its two delete passes (junkTrim, slotBalance)
// skip equipped items by construction, so worn gear always comes back "keep" on supply floors
// rather than merit. Here the call is driven by REPLACEABILITY: how many unequipped spares could
// actually take this piece's place and would finish better. Advisory only; nothing is ever deleted.
//
//   node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
//     name|ID     all digits -> exact Champs.ID; otherwise a case-insensitive Name substring.
//                 Omit for summary mode: one line per geared champion, worst first.
//     snapshot.db an arg ending in .db or containing a slash (default: newest snapshot).

// Champs.Role is the game's champion type and maps 1:1 onto the analytics archetypes. Verified
// against the 2026-07-12 snapshot: Role=1 champs are uniformly DEF-scaling, Role=2 top the HP
// medians, Role=3 bottom the crit medians. It's static champion data — bare level-1 copies already
// carry it, and 368 of 369 multi-copy names agree across copies (the one exception is a block of
// empty-Name placeholder rows, which hold no gear and are filtered out on read).
export const CHAMP_ROLE = { 0: "ATK-DPS", 1: "DEF-DPS", 2: "HP-DPS", 3: "Support" };
export const CHAMP_ROLE_LABEL = { 0: "Attack", 1: "Defense", 2: "HP", 3: "Support" };

// null for an unrecognised Role — suppresses the role-gap flag, leaves verdicts intact. Indexed
// raw, NOT via Number(): the column has no NOT NULL constraint, and Number(null) is 0, which would
// quietly grade a role-less champion as Attack instead of suppressing the flag.
export const champRole = (row) => CHAMP_ROLE[row?.Role] ?? null;

// p in [0,1], index-based (no interpolation) to match the analytics' existing percentile style.
export function quantile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) * p)];
}
