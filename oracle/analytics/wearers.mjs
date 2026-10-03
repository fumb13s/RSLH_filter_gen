// Who is wearing what, for a build report that proposes moving gear.
//
// Shared by speed.mjs and power.mjs. Both solve over the WHOLE vault, worn gear included — gear
// can be moved, so a build is not usually a set of spare pieces — and both therefore have to say
// which pieces would have to come off someone else. Lifted out of speed.mjs unchanged when the
// second caller arrived; speed.mjs re-exports them, so its own importers never saw the move.

// itemId -> the name of the champion wearing it right now, for the pieces that would have to come
// OFF someone. A free piece costs nothing to fit, and neither does one already on `champId`, so
// neither is listed — including them would bury the ones that do cost something.
//
// Built once per champion over the whole vault rather than per build, because --top prints several
// builds drawn from the same pool.
export function otherWearers(items, champId, rows) {
  const names = new Map(rows.map((r) => [Number(r.ID), r.Name]));
  const out = new Map();
  for (const it of items) {
    const owner = it.equippedChampId;
    if (!owner || owner === champId) continue;
    // `owner` is Artifacts.cID, and it can name a row the roster read dropped — a placeholder
    // (empty-Name) row, or a champion since consumed. Naming it by id beats reporting the piece as
    // free, which is the one answer that is certainly wrong.
    //
    // It is not the same claim as a placeholder row WEARING something. Worn gear is recorded in the
    // Champs slot columns; cID is a back-pointer that is not cleared on unequip, so one pointing at a
    // placeholder row says nothing about what that row holds. A caller that needs the slot columns
    // reads them off every row — see readAllChampRows in champs.mjs.
    out.set(it.id, names.get(owner) ?? `#${owner}`);
  }
  return out;
}

// "8 of 9 — Kantra the Cyclone x3, Elhain x2, Kael", or "none".
//
// The solver's pool is the WHOLE vault, worn gear included — a deliberate choice, since gear can be
// moved. The consequence is that solving several champions independently proposes the same physical
// pieces to each, so the builds are mutually exclusive. Printed for every build, `none` included:
// silence would be indistinguishable from a report that does not check.
//
// Busiest wearer first, then alphabetical, so a rerun on one snapshot prints the same line. Names
// past the fourth become "+N more" — nine pieces off nine champions is a 200-character line, and
// the tail of it is singletons already named against their own item a few lines above.
const NAMED_WEARERS = 4;

export function describeWearers(items, wearers) {
  const byChamp = new Map();
  for (const it of items) {
    const who = wearers.get(it.id);
    if (who === undefined) continue;
    byChamp.set(who, (byChamp.get(who) ?? 0) + 1);
  }
  if (byChamp.size === 0) return "none";
  const taken = [...byChamp.values()].reduce((sum, n) => sum + n, 0);
  const ranked = [...byChamp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.slice(0, NAMED_WEARERS).map(([who, n]) => (n > 1 ? `${who} x${n}` : who));
  const rest = ranked.length - named.length;
  return `${taken} of ${items.length} — ${[...named, ...(rest ? [`+${rest} more`] : [])].join(", ")}`;
}
