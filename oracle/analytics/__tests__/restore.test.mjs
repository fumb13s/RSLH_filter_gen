// oracle/analytics/__tests__/restore.test.mjs
//
// restore.mjs's pure half: the slot diff and the one thing the rendered report must not get wrong —
// which snapshot a lookalike count is taken over. Hand-built snapshots in the shape load() returns,
// because at this level a database would only be a slower way to reach the same objects.
//
// It exists because restore.mjs and gear-moves.mjs answer overlapping questions about the same pair of
// snapshots and a disagreement between them has no adjudicator (see gear-common.mjs). The last test
// here is that agreement, asserted across both tools rather than assumed.
import { test, expect } from "vitest";
import { SLOT_COLUMNS, collisionCounts, fingerprint } from "../gear-common.mjs";
import { lostAmbiguity } from "../gear-moves.mjs";
import { buildReport, diffSlots } from "../restore.mjs";

// A Champs row as readChamps returns it. Slot columns default to 0 (the schema's "empty"), so a
// fixture names only the slots it cares about.
const champ = (o = {}) => ({
  ID: 1, Name: "Elhain", SPD: 242,
  Weapon: 0, Helmet: 0, Shield: 0, Glouves: 0, Chest: 0, Shoes: 0, Ring: 0, Amulett: 0, Banner: 0,
  ...o,
});

// A decoded artifact as readArtifacts returns it: a Mythical r6 +16 Critical Rate weapon.
const item = (o = {}) => ({
  id: 1, slot: 5, set: 5, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: true, value: 265 },
  substats: [{ statId: 4, isFlat: true, rolls: 2, value: 12, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
  ...o,
});

// A snapshot in the shape load() hands back, minus the database. `loc` is derived from the slot
// columns rather than passed in, for the same reason load() derives it: Artifacts.cID keeps naming the
// last wearer after a piece is unequipped.
const snap = (items, champs) => ({
  items: new Map(items.map((i) => [i.id, i])), all: items,
  champs: new Map(champs.map((c) => [Number(c.ID), c])),
  loc: new Map(champs.flatMap((c) => SLOT_COLUMNS
    .map((col) => [Number(c[col] ?? 0), Number(c.ID)]).filter(([id]) => id > 0))),
});

const META = {
  before: { file: "2026-09-01-pre-driver.db", when: "2026-09-01 10:00", date: "2026-09-01" },
  after: { file: "2026-09-02-post-driver.db", when: "2026-09-02 18:00", date: "2026-09-02" },
};

// Two pairs of twins, each chosen so that an after-scoped count and a before-scoped one give
// DIFFERENT answers — scope the wrong way and one of the two markers disappears:
//   71 exists only in the after snapshot, so weapon 11's line is ambiguous only counted over after
//   15 is sold, so its twin 16 makes it ambiguous only counted over before
const weapon = item({ id: 11, slot: 5 });
const weaponTwin = item({ id: 71, slot: 5 });
const chestSold = item({ id: 15, slot: 2, mainStat: { statId: 3, isFlat: true, value: 100 } });
const chestTwin = item({ id: 16, slot: 2, mainStat: { statId: 3, isFlat: true, value: 100 } });

const BEFORE = snap([weapon, chestSold, chestTwin],
  [champ({ ID: 1, Name: "Elhain", Weapon: 11, Chest: 15 }), champ({ ID: 2, Name: "Kael" })]);
const AFTER = snap([weapon, chestTwin, weaponTwin],
  [champ({ ID: 1, Name: "Elhain" }), champ({ ID: 2, Name: "Kael", Weapon: 11 })]);

const report = () => buildReport(BEFORE, AFTER, META).text;
const lineWith = (text, needle) => text.split("\n").find((l) => l.includes(needle));

// --- diffSlots --------------------------------------------------------------

// The premise of everything below: a piece absent from `after` has no after row, so the line that
// describes it is the one line in the report rendered from the BEFORE snapshot.
test("diffSlots files a piece absent from the after snapshot as gone, carrying its before row", () => {
  const { restore, gone } = diffSlots(BEFORE, AFTER);
  expect(gone).toBe(1);
  const rows = restore.get(1);
  expect(rows.find((r) => r.gone).item).toBe(chestSold);
  // ...and a piece that merely moved carries the after row, as every other line does.
  expect(rows.find((r) => !r.gone).item).toBe(weapon);
});

// --- which snapshot a lookalike count is taken over -------------------------

// The failure this guards, and why it was invisible: a gone item's own row is by definition absent from
// the after snapshot, so an after-scoped count can only ever see the twins that outlived it — one here,
// which is what "unique" looks like. Nothing breaks; the marker just never prints.
test("an after-scoped count under-counts a gone piece, or misses it altogether", () => {
  expect(collisionCounts(AFTER.all).get(fingerprint(chestSold))).toBe(1);
  expect(collisionCounts(BEFORE.all).get(fingerprint(chestSold))).toBe(2);
  // With no twin left behind it misses the map entirely, and describe()'s `?? 1` reads that as unique
  // too — so the two ways of getting it wrong are indistinguishable in the output.
  expect(collisionCounts(AFTER.all).get(fingerprint(item({ id: 41, slot: 6 })))).toBeUndefined();
});

test("the GONE line counts lookalikes over the before snapshot, where the twin still is", () => {
  expect(lineWith(report(), "GONE (sold/consumed)")).toContain("(2 pieces looked like this before)");
});

// Both scopes are live in one report, which is the only way to show that the fix is a second map and
// not a switch: the surviving weapon's twin exists only in the after snapshot.
test("every other line still counts lookalikes over the after snapshot", () => {
  expect(lineWith(report(), "now on **Kael**")).toBeTruthy();
  expect(lineWith(report(), "265 ATK")).toContain("(2 identical — either will do)");
});

// "either will do" is a promise of a substitute and a sold piece has none. Printed on a line that
// opens "⚠️ GONE" it invites the reader to stop worrying about something they have actually lost, and
// even where a twin does survive the report never says which one it is.
test("nothing that is gone offers the reader a choice it does not have", () => {
  expect(lineWith(report(), "GONE (sold/consumed)")).not.toContain("either will do");
});

// The reason gear-common.mjs exists, asserted rather than assumed: on one snapshot pair the two tools
// report the SAME count for the same gone piece. The owner reads both reports and has no way to
// adjudicate a disagreement, so a divergence here is worse than either tool alone.
test("gear-moves.mjs and restore.mjs agree about a gone piece's lookalikes", () => {
  const shared = "(2 pieces looked like this before)";
  expect(lostAmbiguity(chestSold, collisionCounts(BEFORE.all))).toContain(shared);
  expect(lineWith(report(), "GONE (sold/consumed)")).toContain(shared);
});
