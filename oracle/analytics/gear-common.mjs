// What the two gear-diff tools must not disagree about.
//
// gear-moves.mjs and restore.mjs answer overlapping questions about the same pair of snapshots, and
// a disagreement between them has no adjudicator: the owner reads two reports and has no way to tell
// which is right. Everything they must answer identically lives here so it cannot silently fork —
// and it had already forked once, restore.mjs's fingerprint having omitted the substat glyph its own
// describe() prints, so the two tools could report different "N identical" counts for one snapshot.
//
// Whether both tools should survive at all is open (see the note in gear-moves.mjs's header); this
// is the floor either way.

// The Champs equipped-slot columns, in the schema's own spelling — Glouves and Amulett are
// misspelled there and copying them verbatim is the only thing that makes the SELECT work.
//
// This list is an iteration order over columns and NOTHING ELSE. Its position is not the slot id:
// Weapon is slot 5, Helmet 1, Shield 6, Glouves 3, Chest 2, Shoes 4, and only Ring/Amulett/Banner
// line up. Indexing 1..9 as slot ids mislabels six of the nine, so an item's slot is always read
// from `item.slot`, never from the column that referenced it.
export const SLOT_COLUMNS = ["Weapon", "Helmet", "Shield", "Glouves", "Chest", "Shoes", "Ring",
  "Amulett", "Banner"];

// A key over everything a person can SEE on a piece. Two items sharing one are indistinguishable on
// screen, so a report says "either will do" rather than sending the reader hunting for a specific id
// the game never displays.
//
// The substat terms are SORTED before joining, and that is load-bearing rather than tidy. Substats
// are stored in an arbitrary order, so two visually identical pieces can differ only in storage
// order: measured over 8485 items an order-sensitive key finds 0 collisions, while the real group of
// 2 appears only order-insensitively. Getting it wrong does not miss a case — it reports every item
// as unique, turning the ambiguity marker into dead code that never fires.
//
// The ascension bonus is in the key because both tools PRINT it (`· asc HP 204`). Leaving it out
// pooled two pieces that read differently on screen, so the report would show two visibly unlike
// lines each tagged "(2 identical — either will do)" and "pick any match" would hand over a piece
// with a different bonus stat.
//
// Faction is keyed only on accessories, because that is the only place either tool PRINTS it — both
// describeItem and restore.mjs's describe() gate the label on `isAccessory && faction`. Keying the
// raw `accset` everywhere is the ascension-bonus mistake run backwards: there a field that IS shown
// was missing from the key and pooled two pieces that read differently, here a field that is NOT
// shown was in the key and split two that read identically, so the "either will do" marker stayed
// quiet on a genuine pair. Slots 1-6 all carry `accset: 0` in the committed fixture, so this is a
// consistency fix with no demonstrated effect there rather than a bug with a reproduction.
//
// Gating cannot pool an accessory with an artifact by accident: `it.slot` is already in the key and
// isAccessory is derived from it, so the two can never share one.
//
// Level is deliberately absent and costs nothing: it is implied by the rarity, rank and stat values
// already in the key, since the values printed on a piece are what its level bought.
export function fingerprint(it) {
  return [
    it.slot, it.set, it.rarity, it.rank, it.isAccessory ? it.faction : 0,
    `${it.mainStat.statId}:${it.mainStat.isFlat}:${it.mainStat.value}`,
    it.substats.map((s) => `${s.statId}:${s.isFlat}:${s.value}:${s.glyph}`).sort().join("+"),
    it.ascStat ? `${it.ascStat.statId}:${it.ascStat.isFlat}:${it.ascStat.value}` : "",
  ].join("|");
}
