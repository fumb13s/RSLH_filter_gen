// oracle/analytics/__tests__/gear-moves.test.mjs
//
// The pure half of gear-moves.mjs: the diff, the groupings, and the wording of a line. Hand-built
// rows and items throughout, because at this level a database would only be a slower way to reach
// the same objects.
//
// It stops at console.log. The other half — section order, the DB reads, the warnings — is covered
// by gear-moves.cli.test.mjs, which builds throwaway snapshots and runs the tool over them. An
// earlier version of this header claimed a fixture-based test would be unrunnable for anyone else
// because real snapshots hold personal data and are gitignored; that is true of the REAL snapshots
// and false of a synthetic one, as decode.test.mjs's makeTempDb and the committed oracle/known-gear.db
// both already showed.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { action, ambiguity, byHolder, byOwner, champNames, collisionCounts, describeItem,
  diffLocations, label, leveledTag, locationsFrom, slotsBefore,
  sortedGroups } from "../gear-moves.mjs";
import { fingerprint } from "../gear-common.mjs";
import { readArtifacts } from "../decode.mjs";
import { readChampRows } from "../champs.mjs";

// A Champs row as readChampRows returns it. Slot columns default to 0 (the schema's "empty"), so a
// test names only the slots it cares about.
export const champ = (o = {}) => ({
  ID: 100, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60, Fraction: 2, SPD: 242, EmpLvl: 0,
  Weapon: 0, Helmet: 0, Shield: 0, Glouves: 0, Chest: 0, Shoes: 0, Ring: 0, Amulett: 0, Banner: 0,
  ...o,
});

// A decoded artifact as readArtifacts returns it: a Mythical r6 +16 Critical Rate weapon.
export const item = (o = {}) => ({
  id: 1, slot: 5, set: 5, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: true, value: 265 },
  substats: [{ statId: 4, isFlat: true, rolls: 2, value: 12, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
  ...o,
});

const sub = (statId, isFlat, value, glyph = 0) => ({ statId, isFlat, rolls: 1, value, glyph });

// --- locationsFrom ----------------------------------------------------------

// All nine, because the column names carry the schema's own misspellings (Glouves, Amulett) and a
// typo in the list would silently drop that slot from every location map the tool builds.
test("locationsFrom maps every one of the nine slot columns to its champion", () => {
  const rows = [champ({
    ID: 7, Weapon: 11, Helmet: 12, Shield: 13, Glouves: 14, Chest: 15, Shoes: 16, Ring: 17,
    Amulett: 18, Banner: 19,
  })];
  const loc = locationsFrom(rows);
  expect(loc.size).toBe(9);
  for (const id of [11, 12, 13, 14, 15, 16, 17, 18, 19]) expect(loc.get(id)).toBe(7);
});

// An empty slot is 0 in the schema, and Name is the only column with a NOT NULL guarantee, so null
// has to be tolerated too. Mapping either would put a phantom item id 0 in the location map.
test("locationsFrom ignores empty slots held as 0 or null", () => {
  const loc = locationsFrom([champ({ ID: 7, Weapon: 11, Helmet: 0, Shield: null })]);
  expect([...loc.keys()]).toEqual([11]);
});

test("locationsFrom keys each champion's items to that champion", () => {
  const loc = locationsFrom([champ({ ID: 1, Weapon: 11 }), champ({ ID: 2, Weapon: 22 })]);
  expect(loc.get(11)).toBe(1);
  expect(loc.get(22)).toBe(2);
});

// --- champNames -------------------------------------------------------------

test("champNames prefers the after snapshot's name for a champion present in both", () => {
  const names = champNames([champ({ ID: 1, Name: "Elhain" })], [champ({ ID: 1, Name: "Elhain" })]);
  expect(names.get(1)).toEqual({ name: "Elhain", missing: false });
});

// Champions can be consumed between snapshots, and their gear still needs a home named. Falling back
// to a bare id would leave the report telling the owner to put a piece on "#412" (FR-011).
test("champNames falls back to the before name and flags a champion absent from after", () => {
  const names = champNames([champ({ ID: 9, Name: "Varkos Headsplitter" })], []);
  expect(names.get(9)).toEqual({ name: "Varkos Headsplitter", missing: true });
});

// A champion summoned mid-session exists only in the after snapshot. It is present, not missing —
// `missing` is about champions and never about the gone item list.
test("champNames treats a champion seen only in the after snapshot as present", () => {
  const names = champNames([], [champ({ ID: 5, Name: "Turvold" })]);
  expect(names.get(5)).toEqual({ name: "Turvold", missing: false });
});

// --- diffLocations ----------------------------------------------------------

test("diffLocations reports an item that moved from one champion to another", () => {
  const it = item({ id: 11 });
  const { moved, gone } = diffLocations(
    [it], new Map([[11, 1]]), [it], new Map([[11, 2]]));
  expect(gone).toEqual([]);
  expect(moved).toEqual([{ id: 11, from: 1, to: 2, item: it, leveledFrom: null }]);
});

// `to: null` is the unequipped state, and it has to be a value the printer can act on. A move the
// diff simply omitted would read as "this piece never moved" (FR-004).
test("diffLocations reports an item taken off a champion and left in the vault", () => {
  const it = item({ id: 11 });
  const { moved } = diffLocations([it], new Map([[11, 1]]), [it], new Map());
  expect(moved).toEqual([{ id: 11, from: 1, to: null, item: it, leveledFrom: null }]);
});

test("diffLocations reports an item taken out of the vault and equipped", () => {
  const it = item({ id: 11 });
  const { moved } = diffLocations([it], new Map(), [it], new Map([[11, 2]]));
  expect(moved).toEqual([{ id: 11, from: null, to: 2, item: it, leveledFrom: null }]);
});

// A move is a change of LOCATION and nothing else. Levelling a piece in place is not a move, and
// reporting it as one would send the owner looking for a swap that never happened (SC-002).
test("diffLocations excludes an item whose location did not change, even if it leveled", () => {
  const before = item({ id: 11, level: 12 });
  const after = item({ id: 11, level: 16 });
  const worn = new Map([[11, 1]]);
  expect(diffLocations([before], worn, [after], worn).moved).toEqual([]);
  expect(diffLocations([before], new Map(), [after], new Map()).moved).toEqual([]);
});

// Levelling changes the substat values printed on a piece, so one that moved AND leveled cannot be
// matched by eye against what the baseline would have shown. The tag is what warns the reader
// (FR-008); `leveledFrom` is what the tag is built from.
test("diffLocations records the before level only when the level changed", () => {
  const before = item({ id: 11, level: 12 });
  const after = item({ id: 11, level: 16 });
  expect(diffLocations([before], new Map([[11, 1]]), [after], new Map()).moved[0].leveledFrom)
    .toBe(12);
  expect(diffLocations([before], new Map([[11, 1]]), [before], new Map()).moved[0].leveledFrom)
    .toBe(null);
});

// The item carried on a move is the AFTER row, because the owner is matching the printed values
// against what is in the game right now (FR-007).
test("diffLocations carries the after row on a moved item", () => {
  const before = item({ id: 11, level: 12 });
  const after = item({ id: 11, level: 16 });
  const { moved } = diffLocations([before], new Map([[11, 1]]), [after], new Map());
  expect(moved[0].item).toBe(after);
});

// A piece acquired during the session did not move and is not lost. It surfaces only as the "now
// holding" side of a restore line, never as a move of its own.
test("diffLocations ignores an item that exists only in the after snapshot", () => {
  const fresh = item({ id: 99 });
  const { moved, gone } = diffLocations([], new Map(), [fresh], new Map([[99, 2]]));
  expect(moved).toEqual([]);
  expect(gone).toEqual([]);
});

// --- fingerprint (shared with restore.mjs via gear-common.mjs) --------------

// The regression test for the whole ambiguity feature. Substats are stored in an arbitrary order, so
// two pieces that look identical in the game can differ only in storage order. Measured over 8485
// items, an order-SENSITIVE key finds 0 collisions while an order-insensitive one finds the real
// group of 2 — so getting this wrong does not merely miss a case, it silently turns the "N
// identical" marker into dead code that never fires, which looks exactly like success.
test("fingerprint ignores the order substats happen to be stored in", () => {
  const a = item({ substats: [sub(4, true, 12), sub(5, false, 9), sub(1, true, 402)] });
  const b = item({ substats: [sub(1, true, 402), sub(4, true, 12), sub(5, false, 9)] });
  expect(fingerprint(a)).toBe(fingerprint(b));
});

test("fingerprint separates items differing in any visible attribute", () => {
  const base = item();
  for (const change of [{ slot: 6 }, { set: 9 }, { rarity: 4 }, { rank: 5 }, { faction: 3 }]) {
    expect(fingerprint(item(change))).not.toBe(fingerprint(base));
  }
  expect(fingerprint(item({ mainStat: { statId: 2, isFlat: true, value: 200 } })))
    .not.toBe(fingerprint(base));
  expect(fingerprint(item({ mainStat: { statId: 4, isFlat: true, value: 265 } })))
    .not.toBe(fingerprint(base));
  // A glyph is printed on the piece, so two otherwise-identical substats with different glyphs are
  // distinguishable on screen and must not be pooled as "either will do".
  expect(fingerprint(item({ substats: [sub(4, true, 12, 3)] }))).not.toBe(fingerprint(base));
  // Flat vs percent is a different stat to the eye: "HP 402" and "HP% 402" are not the same piece.
  expect(fingerprint(item({ substats: [sub(1, true, 12)] })))
    .not.toBe(fingerprint(item({ substats: [sub(1, false, 12)] })));
});

// The ascension bonus is printed on the line (`· asc HP 204`), so two pieces alike everywhere else
// but differing in it read differently on screen. Pooled as "either will do", "pick any match" hands
// over a piece with a different bonus stat — and ascension is live data, not hypothetical: items in
// the committed fixture carry one.
test("fingerprint separates items differing only in their ascension bonus", () => {
  const asc = (o) => item({ ascStat: o });
  const base = asc({ statId: 1, isFlat: true, value: 204 });
  expect(fingerprint(base)).not.toBe(fingerprint(asc(null)));
  expect(fingerprint(base)).not.toBe(fingerprint(asc({ statId: 1, isFlat: true, value: 180 })));
  expect(fingerprint(base)).not.toBe(fingerprint(asc({ statId: 4, isFlat: true, value: 204 })));
  expect(fingerprint(base)).not.toBe(fingerprint(asc({ statId: 1, isFlat: false, value: 204 })));
  expect(fingerprint(base)).toBe(fingerprint(asc({ statId: 1, isFlat: true, value: 204 })));
});

// --- collisionCounts --------------------------------------------------------

test("collisionCounts counts how many items share each fingerprint", () => {
  const twin = { substats: [sub(4, true, 12), sub(5, false, 9)] };
  const counts = collisionCounts([
    item({ id: 1, ...twin }), item({ id: 2, ...twin }), item({ id: 3, slot: 6 })]);
  expect(counts.get(fingerprint(item(twin)))).toBe(2);
  expect(counts.get(fingerprint(item({ slot: 6 })))).toBe(1);
});

// --- describeItem -----------------------------------------------------------

// The trap this guards: STAT_NAMES is a percent-only placeholder, so a flat HP substat renders
// through it as "HP%" — wrong on precisely the field a human matches by eye. statDisplayName takes
// the flat flag and is the only correct choice.
test("describeItem renders a flat HP substat as flat, never as HP%", () => {
  const line = describeItem(item({ substats: [sub(1, true, 402)] }));
  expect(line).toContain("HP 402");
  expect(line).not.toContain("HP%");
});

test("describeItem renders a percent HP substat as a percentage", () => {
  expect(describeItem(item({ substats: [sub(1, false, 8)] }))).toContain("HP% 8");
});

// Slot comes from the item, never from which champion column referenced it — Weapon is slot 5 while
// its column sits first, and six of the nine columns disagree with their slot id.
test("describeItem names the slot from item.slot", () => {
  expect(describeItem(item({ slot: 5 }))).toContain("Weapon");
  expect(describeItem(item({ slot: 1 }))).toContain("Helmet");
  expect(describeItem(item({ slot: 4 }))).toContain("Boots");
});

// FR-005: the restore happens in a game UI that never shows internal ids, so every attribute a
// person can read off the piece has to be on the line. The id may ride along, but removing it must
// still leave the piece identifiable.
test("describeItem identifies a piece by its visible attributes, not by its id", () => {
  const line = describeItem(item({
    id: 4242, rarity: 5, rank: 6, level: 16, set: 5, slot: 5,
    mainStat: { statId: 2, isFlat: true, value: 265 },
    substats: [sub(4, true, 12), sub(1, true, 402, 25)],
    ascStat: { statId: 6, isFlat: false, value: 11 },
  }));
  expect(line).toContain("Mythical");        // rarity
  expect(line).toContain("r6");              // rank
  expect(line).toContain("+16");             // level
  expect(line).toContain("Critical Rate");   // set
  expect(line).toContain("Weapon");          // slot
  expect(line).toContain("ATK 265");         // main stat and value
  expect(line).toContain("SPD 12");          // substat and value
  expect(line).toContain("HP 402");
  expect(line).toContain("25");              // the glyph on that substat
  expect(line).toContain("C.DMG 11");        // ascension bonus
  expect(line.replace(/4242/g, "")).toContain("ATK 265");
});

// Faction is a hard constraint on accessories and is shown on them in the game; it is not shown on
// slots 1-6, so printing it there would be noise the reader cannot verify.
test("describeItem shows faction on an accessory and omits it elsewhere", () => {
  expect(describeItem(item({ slot: 7, isAccessory: true, faction: 3 }))).toContain("Sacred Order");
  expect(describeItem(item({ slot: 5, isAccessory: false, faction: 3 })))
    .not.toContain("Sacred Order");
});

// --- gone items (US3) -------------------------------------------------------

// A sold piece is not a move — no amount of re-equipping brings it back, so it must never reach the
// moved list where it would send the owner hunting for something that no longer exists (FR-010).
test("diffLocations files an item absent from the after snapshot as gone, not as moved", () => {
  const sold = item({ id: 41 });
  const { moved, gone } = diffLocations([sold], new Map([[41, 3]]), [], new Map());
  expect(moved).toEqual([]);
  expect(gone).toEqual([sold]);
});

// There is no after row to describe it from, so it carries the before row — the single exception to
// "describe everything as it looks now" (FR-007).
test("a gone item carries its before row, since no after row exists", () => {
  const before = item({ id: 41, level: 12 });
  const { gone } = diffLocations([before], new Map([[41, 3]]), [], new Map());
  expect(gone[0]).toBe(before);
  expect(gone[0].level).toBe(12);
});

// The exception propagates to collision counts, and this is where it bites. A gone item's appearance
// is by definition absent from the after snapshot, so an after-scoped lookup returns undefined for
// EVERY one of them — all 47 in the reference window — and a template interpolating that count
// prints "undefined identical" on every line. The count has to be taken over the before snapshot.
test("a gone item's collision count comes from the before snapshot, never the after one", () => {
  const sold = item({ id: 41, set: 6 });
  const survivor = item({ id: 11, set: 5 });
  const beforeItems = [sold, survivor], afterItems = [survivor];

  expect(collisionCounts(afterItems).get(fingerprint(sold))).toBeUndefined();
  expect(collisionCounts(beforeItems).get(fingerprint(sold))).toBe(1);
});

// --- slotsBefore (US4) ------------------------------------------------------

// Slot comes from the ITEM. The champion table's column order is not slot-id order — Weapon sits
// first but is slot 5, Helmet second but slot 1 — so six of the nine columns disagree with their
// position. Keying off column position would mislabel two thirds of the map.
test("slotsBefore keys a champion's items by item.slot, not by column position", () => {
  const weapon = item({ id: 11, slot: 5 });
  const helmet = item({ id: 12, slot: 1 });
  const slots = slotsBefore([weapon, helmet], new Map([[11, 1], [12, 1]]));
  expect(slots.get(1).get(5)).toBe(weapon);
  expect(slots.get(1).get(1)).toBe(helmet);
});

test("slotsBefore separates two champions' items", () => {
  const mine = item({ id: 11, slot: 5 });
  const theirs = item({ id: 21, slot: 5 });
  const slots = slotsBefore([mine, theirs], new Map([[11, 1], [21, 2]]));
  expect(slots.get(1).get(5)).toBe(mine);
  expect(slots.get(2).get(5)).toBe(theirs);
});

// An unequipped piece has no champion to file it under, so a vault-only snapshot yields nothing and
// a champion wearing nothing simply has no entry. byHolder has to tolerate the absence.
test("slotsBefore returns an empty map when nothing is worn", () => {
  expect(slotsBefore([item({ id: 11 })], new Map()).size).toBe(0);
  expect(slotsBefore([], new Map()).size).toBe(0);
  expect(slotsBefore([item({ id: 11 })], new Map([[11, 1]])).get(2)).toBeUndefined();
});

const move = (o = {}) => ({ id: 11, from: 1, to: 2, item: item({ id: 11 }), leveledFrom: null, ...o });

// --- byOwner (US2) ----------------------------------------------------------

// FR-009: a champion appears only if it LOST something, and only the slots that changed are listed.
// A champion that merely gained gear belongs in the strip list, not here — listing it would tell the
// owner to restore slots that were never disturbed.
test("byOwner groups moved pieces under the champion that lost them", () => {
  const a = move({ id: 11, from: 1, to: 9, item: item({ id: 11, slot: 5 }) });
  const b = move({ id: 12, from: 1, to: 3, item: item({ id: 12, slot: 1 }) });
  const c = move({ id: 13, from: 2, to: 9, item: item({ id: 13, slot: 2 }) });
  const owners = byOwner([a, b, c]);
  expect([...owners.keys()].sort()).toEqual([1, 2]);
  expect(owners.get(1)).toEqual([a, b]);
  expect(owners.get(2)).toEqual([c]);
  expect(owners.has(9)).toBe(false);          // 9 only GAINED gear
});

// A piece taken out of the vault leaves nobody short of it, so no champion is missing anything on its
// account. Filing it under a champion would invent a restore step.
test("byOwner omits moves that came out of the vault", () => {
  expect(byOwner([move({ from: null, to: 9 })]).size).toBe(0);
});

// An item taken off a champion and left unequipped is still a loss for that champion, so it must
// appear — the destination being the vault changes nothing about who is missing it.
test("byOwner keeps a move that ended in the vault", () => {
  const toVault = move({ id: 11, from: 4, to: null });
  expect(byOwner([toVault]).get(4)).toEqual([toVault]);
});

// --- byHolder (US4) ---------------------------------------------------------

// The point of the view: open a champion the swapper built up and empty it in one pass, instead of
// one round trip per piece (SC-007).
test("byHolder groups moved pieces by the champion now wearing them", () => {
  const a = move({ id: 11, from: 1, to: 9, item: item({ id: 11, slot: 5 }) });
  const b = move({ id: 12, from: 3, to: 9, item: item({ id: 12, slot: 1 }) });
  const holders = byHolder([a, b], new Set(), new Map());
  expect([...holders.keys()]).toEqual([9]);
  expect(holders.get(9)).toHaveLength(2);
});

// A piece sitting in the vault has no champion to open, so it has no holder entry. It remains the
// per-owner view's business.
test("byHolder omits moves that ended in the vault, and champions wearing nothing moved", () => {
  const toVault = move({ id: 11, from: 1, to: null });
  const holders = byHolder([toVault], new Set(), new Map());
  expect(holders.size).toBe(0);
});

// A piece that came off another champion goes back to that champion — origin and destination are the
// same, so the entry needs no more thought than naming it.
test("byHolder marks a piece taken off another champion as `return`, naming that champion", () => {
  const holders = byHolder([move({ from: 4, to: 9 })], new Set(), new Map());
  expect(holders.get(9)[0]).toMatchObject({ from: 4, disposition: "return", replaced: null });
});

// The common vault case, and an explicit no-op rather than an omission: restoring the slot puts the
// original back and displaces this piece by itself, so telling the owner to unequip it invents a
// step they do not have to perform.
test("byHolder marks a vault piece `auto` when the slot's original still exists", () => {
  const original = item({ id: 77, slot: 5 });
  const slots = new Map([[9, new Map([[5, original]])]]);
  const vaultPiece = move({ id: 11, from: null, to: 9, item: item({ id: 11, slot: 5 }) });
  expect(byHolder([vaultPiece], new Set(), slots).get(9)[0])
    .toMatchObject({ from: null, disposition: "auto", replaced: null });
});

// Nothing will ever displace a piece that landed in a slot which was empty before, so omitting it
// leaves the account short of its pre-session state with no sign why. This case appears in NEITHER
// reference snapshot pair — running the tool can never show it, so this test is its only coverage.
test("byHolder marks a vault piece `unequip` when the slot was empty before", () => {
  const slots = new Map([[9, new Map()]]);
  const vaultPiece = move({ id: 11, from: null, to: 9, item: item({ id: 11, slot: 5 }) });
  expect(byHolder([vaultPiece], new Set(), slots).get(9)[0])
    .toMatchObject({ from: null, disposition: "unequip", replaced: null });
  // Same when the holder has no before entry at all rather than an empty one.
  expect(byHolder([vaultPiece], new Set(), new Map()).get(9)[0].disposition).toBe("unequip");
});

// The branch whose failure mode is harmful rather than merely wrong: treated as `unequip` it would
// tell the owner to strip a working piece and leave a slot they have nothing to refill, because the
// piece that "belongs" there was sold. Also absent from both reference pairs.
test("byHolder marks a vault piece `keep` when the slot's original was sold, naming it", () => {
  const sold = item({ id: 41, slot: 2 });
  const slots = new Map([[9, new Map([[2, sold]])]]);
  const vaultPiece = move({ id: 51, from: null, to: 9, item: item({ id: 51, slot: 2 }) });
  const entry = byHolder([vaultPiece], new Set([41]), slots).get(9)[0];
  expect(entry).toMatchObject({ from: null, disposition: "keep" });
  expect(entry.replaced).toBe(sold);
});

// FR-018. The two grouped views are separate traversals of one `moved` array and could drift, so the
// agreement is asserted rather than assumed: whatever byHolder names as a piece's origin is the same
// champion the per-owner view files it under, which is what makes handing a piece back close a line
// in both.
//
// Both sides call the SHIPPED function — byOwner is what printRestoreByChampion groups with. An
// earlier version of this test re-derived the per-owner grouping inline, which pinned a copy: the
// printer's grouping could have been changed to disagree and nothing here would have failed, on the
// one requirement the CLI contract calls out as a contract term rather than an assumption.
test("byHolder and byOwner name the same origin for a piece", () => {
  const handedBack = move({ id: 11, from: 1, to: 2 });
  const fromVault = move({ id: 12, from: null, to: 2, item: item({ id: 12, slot: 1 }) });
  const holders = byHolder([handedBack, fromVault], new Set(), new Map());
  const owners = byOwner([handedBack, fromVault]);

  const [returned, vaulted] = holders.get(2);
  expect(returned.disposition).toBe("return");
  expect(owners.get(returned.from).map((m) => m.item)).toContain(returned.item);

  // The other direction of the same term: a piece with no owner to hand it back to appears in the
  // strip list only, so its holder entry must not claim an origin the per-owner view never lists.
  expect(vaulted.from).toBe(null);
  expect([...owners.keys()]).toEqual([1]);
});

// --- the wording of a line --------------------------------------------------

const names = (o) => new Map(Object.entries(o).map(([id, v]) => [Number(id), v]));

// FR-004: a location is a name or an explicit "(unequipped)", never blank and never a bare id. A
// blank would read as "this piece did not move" and an id identifies nothing in a UI that never
// shows one.
test("label names every location, including the vault and an unknown id", () => {
  const n = names({ 1: { name: "Elhain", missing: false } });
  expect(label(null, n)).toBe("(unequipped)");
  expect(label(1, n)).toBe("Elhain");
  expect(label(99, n)).toBe("unknown champion #99");
});

// FR-011: a champion consumed mid-session still has to have its gear housed somewhere, so it keeps
// the name the before snapshot recorded and is marked rather than dropped to an id.
test("label marks a champion that no longer exists but still names it", () => {
  expect(label(9, names({ 9: { name: "Varkos Headsplitter", missing: true } })))
    .toBe("Varkos Headsplitter (champion no longer exists)");
});

// FR-008. The values printed on a leveled piece read higher than the baseline showed, so without the
// tag the reader concludes they are holding the wrong item.
test("leveledTag fires only on a piece that leveled, and states both levels", () => {
  expect(leveledTag(move({ leveledFrom: null }))).toBe("");
  expect(leveledTag(move({ leveledFrom: 12, item: item({ level: 16 }) })))
    .toBe("   [leveled +12->+16 during session]");
});

// FR-006. Silence has to mean "this description is unique", so the marker appears exactly when the
// count says more than one piece looks like this.
test("ambiguity marks a shared appearance and stays silent on a unique one", () => {
  const twin = item({ id: 1 });
  const counts = collisionCounts([twin, item({ id: 2 })]);
  expect(ambiguity(twin, counts)).toContain("(2 identical — either will do)");
  expect(ambiguity(item({ slot: 6 }), counts)).toBe("");
});

// The scope is the caller's to get right, and this is what getting it wrong looks like: a gone item
// counted against the after snapshot is absent from the map on every line, so every one of them
// reads as unique. The `?? 1` fallback keeps the line printable — it does not make the scope safe.
test("ambiguity reads as unique for an item missing from the counts it was handed", () => {
  const sold = item({ id: 41, set: 6 });
  expect(ambiguity(sold, collisionCounts([item({ id: 11, set: 5 })]))).toBe("");
  expect(ambiguity(sold, collisionCounts([sold, item({ id: 42, set: 6 })])))
    .toContain("(2 identical");
});

// FR-017. All four dispositions say what to DO, and `auto` is a stated no-op rather than an omission
// — silence there reads as "this piece was missed".
test("action gives each disposition its own instruction", () => {
  const n = names({ 4: { name: "Turvold", missing: false } });
  expect(action({ disposition: "return", from: 4 }, n)).toBe("to Turvold");
  expect(action({ disposition: "auto" }, n)).toContain("no action");
  expect(action({ disposition: "unequip" }, n)).toContain("take off deliberately");
  expect(action({ disposition: "keep" }, n)).toContain("leave it on");
});

// FR-016. Where the piece came from is STATED on every line, not left to be inferred from the
// disposition word or from the group header further up. An entry read on its own — which is how the
// report is used, one champion at a time — has to name an origin, and for a vault piece the vault
// is that origin.
test("action states an origin for every disposition, not just the one with a champion", () => {
  const n = names({ 4: { name: "Turvold", missing: false } });
  expect(action({ disposition: "return", from: 4 }, n)).toContain("Turvold");
  for (const disposition of ["auto", "unequip", "keep"]) {
    expect(action({ disposition }, n), disposition).toContain("came from the vault");
  }
});

// The regression test for the harmful direction. `keep` used to be the default arm, so ANY
// unrecognised disposition — a typo, a fourth one added without a line — rendered "leave it on":
// advice that costs the owner a slot they cannot refill. It has to fail where it can be seen.
test("action refuses to guess at a disposition it does not know", () => {
  expect(() => action({ disposition: "kepe" }, new Map())).toThrow(/unknown disposition/);
  expect(() => action({ disposition: undefined }, new Map())).toThrow(/unknown disposition/);
});

// Biggest job first so the reader starts where the work is, then by name so two runs over the same
// snapshots produce the same report.
test("sortedGroups orders by size, then by the printed name", () => {
  const n = names({
    1: { name: "Zavia", missing: false }, 2: { name: "Ashra", missing: false },
    3: { name: "Marius", missing: false },
  });
  const groups = new Map([[1, ["a"]], [2, ["b"]], [3, ["c", "d"]]]);
  expect(sortedGroups(groups, n).map(([id]) => id)).toEqual([3, 2, 1]);
});

// --- reading a snapshot that is not there (FR-012, FR-015) ------------------

// The failure mode this guards is not the throw — it is the FILE. A read-write open CREATES a
// mistyped path as an empty database before failing on the missing table, and a later run then
// reads that stray file as a real snapshot holding no gear: a wrong report that looks like a right
// one. Both readers must refuse to bring the file into existence.
test("neither reader creates a file when the snapshot path does not exist", () => {
  const missing = join(tmpdir(), `rslh-gear-moves-absent-${process.pid}.db`);
  expect(existsSync(missing)).toBe(false);

  expect(() => readArtifacts(missing)).toThrow();
  expect(existsSync(missing)).toBe(false);

  expect(() => readChampRows(missing)).toThrow();
  expect(existsSync(missing)).toBe(false);
});
