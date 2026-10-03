// oracle/analytics/__tests__/glyphs.test.mjs
import { test, expect } from "vitest";
import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS, itemGrade, liftItem } from "../glyphs.mjs";

// The Item shape both snapshot readers produce (gestal.mjs's gestalItem and decode.mjs's
// decodeRow), cut down to what this module reads. `rank` is the RAW 1-6 star level, which is what
// the rank rule tests against; `rarity` is 0-indexed and this module never reads it.
const sub = (statId, value, glyph = 0, isFlat = false) =>
  ({ statId, isFlat, rolls: 0, value, glyph });
const item = (o = {}) => ({
  id: 1, slot: 4, set: 4, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 4, isFlat: true, value: 30 }, substats: [], ascStat: null,
  ascLevel: -1, equippedChampId: 0, ...o,
});

// --- the tables -----------------------------------------------------------------------

// INCREASING order, which is what makes "at most a 5★ glyph" a meaningful sentence and what a
// reader of the usage line assumes. A reordered list would silently change nothing about the
// caps and everything about how the option reads.
test("GLYPH_GRADES is the five grades in increasing order", () => {
  expect(GLYPH_GRADES).toEqual(["5", "normal", "rare", "epic", "legendary"]);
});

// "5 glyphs" in a headline would be read as a count, which is the whole reason a grade is never
// printed raw.
test("GLYPH_LABELS names a star level and a rarity for every grade", () => {
  expect(GLYPH_LABELS).toEqual({
    "5": "5★",
    normal: "6★ Normal",
    rare: "6★ Rare",
    epic: "6★ Epic",
    legendary: "6★ Legendary",
  });
});

// Written out longhand, the same way power-solve.test.mjs pins linearizedWeights: these are
// measured game data, so reading them back off the module would assert nothing at all.
test("GLYPH_CAPS holds the tops of each grade's roll ranges", () => {
  expect(GLYPH_CAPS).toEqual({
    "5": { HP: 475, ATK: 25, DEF: 25, "HP%": 5, "ATK%": 5, "DEF%": 5, SPD: 5, RES: 10, ACC: 10 },
    normal: { HP: 750, ATK: 40, DEF: 40, "HP%": 8, "ATK%": 8, "DEF%": 8, SPD: 8, RES: 16,
      ACC: 16 },
    rare: { HP: 850, ATK: 45, DEF: 45, "HP%": 9, "ATK%": 9, "DEF%": 9, SPD: 9, RES: 18,
      ACC: 18 },
    epic: { HP: 950, ATK: 50, DEF: 50, "HP%": 10, "ATK%": 10, "DEF%": 10, SPD: 10, RES: 20,
      ACC: 20 },
    legendary: { HP: 1150, ATK: 60, DEF: 60, "HP%": 12, "ATK%": 12, "DEF%": 12, SPD: 12, RES: 24,
      ACC: 24 },
  });
});

// --- itemGrade ------------------------------------------------------------------------

test("a 6★ item takes the grade that was asked for", () => {
  expect(itemGrade(item({ rank: 6 }), "epic")).toBe("epic");
  expect(itemGrade(item({ rank: 6 }), "5")).toBe("5");
});

// A 5★ item cannot hold a 6★ glyph, so asking for one has to come back as the 5★ row rather than
// as the grade requested. Returning `grade` here would invent a glyph the item cannot carry,
// which is the one wrong answer that looks right.
test("a 5★ item takes at most a 5★ glyph whatever grade was asked for", () => {
  expect(itemGrade(item({ rank: 5 }), "legendary")).toBe("5");
  expect(itemGrade(item({ rank: 5 }), "normal")).toBe("5");
});

// Below 5★ nothing is lifted at all — the issue puts those items out of scope, and `null` is what
// liftItem reads as "leave this piece exactly as it is".
test("an item below 5★ takes no glyph at all", () => {
  expect(itemGrade(item({ rank: 4 }), "legendary")).toBe(null);
  expect(itemGrade(item({ rank: 1 }), "5")).toBe(null);
});

// A grade the table does not know is a caller bug — the CLI validates before it ever gets here —
// and defaulting would lift a whole vault by a table nobody chose.
test("an unknown grade is refused rather than defaulted", () => {
  expect(() => itemGrade(item(), "mythical"))
    .toThrow(/glyphs: unknown grade "mythical" — use one of 5, normal, rare, epic, legendary/);
  expect(() => itemGrade(item(), "6")).toThrow(/unknown grade "6"/);
  expect(() => itemGrade(item(), undefined)).toThrow(/unknown grade/);
});

// --- liftItem: what rises -------------------------------------------------------------

// All nine glyphable keys in one item, so a transposed cap row names itself. HP appears TWICE,
// flat and percent, because they share a statId and differ only by `isFlat` — a lift that read
// the flat cap for a percent substat would write 1150 where 12 belongs, which is a 95x error
// that still looks like a number.
test("every glyphable substat rises to its cap for the grade", () => {
  const it = item({ substats: [
    sub(1, 500, 0, true),    // HP flat   -> 1150
    sub(1, 5, 0, false),     // HP%       -> 12
    sub(2, 200, 0, true),    // ATK flat  -> 60
    sub(2, 5, 0, false),     // ATK%      -> 12
    sub(3, 200, 0, true),    // DEF flat  -> 60
    sub(3, 5, 0, false),     // DEF%      -> 12
    sub(4, 10, 0, true),     // SPD       -> 12
    sub(7, 20, 0, true),     // RES       -> 24
    sub(8, 20, 0, true),     // ACC       -> 24
  ] });
  const { item: lifted, lifts } = liftItem(it, "legendary");
  expect(lifted.substats.map((s) => s.glyph))
    .toEqual([1150, 12, 60, 12, 60, 12, 12, 24, 24]);
  expect(lifts.map((l) => l.key))
    .toEqual(["HP", "HP%", "ATK", "ATK%", "DEF", "DEF%", "SPD", "RES", "ACC"]);
});

// The grade chooses the row, so the same item lifts to different numbers. A 5★ item takes the
// "5" row through itemGrade whatever was asked, which is the rank rule reaching liftItem.
test("the grade chooses the cap row, and a 5★ item is capped at the 5★ row", () => {
  const it = item({ substats: [sub(4, 10, 0, true)] });
  expect(liftItem(it, "epic").item.substats[0].glyph).toBe(10);
  expect(liftItem(it, "normal").item.substats[0].glyph).toBe(8);
  expect(liftItem(item({ rank: 5, substats: [sub(4, 10, 0, true)] }), "legendary")
    .item.substats[0].glyph).toBe(5);
});

// `from` and `to` are what the CLI prints and what its per-lift value is computed from, so a
// lift that reported the wrong `from` would print the right arrow and the wrong worth.
test("lifts record each raised substat's old and new glyph, in substat order", () => {
  const it = item({ substats: [sub(4, 10, 3, true), sub(7, 20, 0, true)] });
  expect(liftItem(it, "epic").lifts).toEqual([
    { key: "SPD", from: 3, to: 10 },
    { key: "RES", from: 0, to: 20 },
  ]);
});

// --- liftItem: what it leaves alone ---------------------------------------------------

// THE CRIT RULE. No C.RATE or C.DMG substat in the vault carries a glyph, and the whole per-lift
// value in power.mjs is exact only because a lift never touches the one non-linear term in the
// objective. A crit lift here would silently make that value wrong.
test("C.RATE, C.DMG and a damage-type substat are never lifted", () => {
  const it = item({ substats: [sub(5, 20, 0, false), sub(6, 60, 0, false), sub(11, 5, 0, false)] });
  const { item: lifted, lifts } = liftItem(it, "legendary");
  expect(lifted.substats.map((s) => s.glyph)).toEqual([0, 0, 0]);
  expect(lifts).toEqual([]);
});

// A glyph already above the grade's cap is the reader's own better glyph. Lowering it would turn
// a block headed "what glyphing would add" into a downgrade, and listing it as a lift would ask
// for a glyph that is already on.
test("an existing glyph above the cap stays, and is not listed as a lift", () => {
  const it = item({ substats: [sub(4, 10, 12, true)] });
  const { item: lifted, lifts } = liftItem(it, "epic");   // epic's SPD cap is 10
  expect(lifted.substats[0].glyph).toBe(12);
  expect(lifts).toEqual([]);
  // Nothing rose, so the item comes back AS ITSELF — which is what keeps power-solve's
  // identity-keyed caches valid for an unlifted piece.
  expect(lifted).toBe(it);
});

// A glyph exactly AT the cap is the boundary between the two tests above. It must not be listed,
// or the CLI would print "glyph SPD 10→10  (+0)" and a glyph count that overstates the work.
test("a glyph exactly at the cap is not a lift", () => {
  const it = item({ substats: [sub(4, 10, 10, true)] });
  expect(liftItem(it, "epic").lifts).toEqual([]);
  expect(liftItem(it, "epic").item).toBe(it);
});

// SUBSTATS ONLY. Glyphs only ever apply to substats — see speed-model.mjs's itemSpeed — so a main
// or ascension stat lifted here would invent a stat the game cannot give.
test("the main stat and the ascension stat are untouched", () => {
  const it = item({
    mainStat: { statId: 4, isFlat: true, value: 30 },
    substats: [sub(4, 10, 0, true)],
    ascStat: { statId: 7, isFlat: true, value: 20 },
  });
  const { item: lifted } = liftItem(it, "legendary");
  expect(lifted.mainStat).toEqual({ statId: 4, isFlat: true, value: 30 });
  expect(lifted.ascStat).toEqual({ statId: 7, isFlat: true, value: 20 });
});

// The id is how every caller finds a lifted piece again — power.mjs maps the worn gear's ids
// through the lifted pool — and the rest of the fields are what the solver and the printer read.
test("the lifted copy keeps the id and every other field", () => {
  const it = item({ id: 77, slot: 5, set: 12, level: 16, faction: 3, equippedChampId: 100,
    substats: [sub(4, 10, 0, true)] });
  const { item: lifted } = liftItem(it, "legendary");
  expect(lifted.id).toBe(77);
  expect(lifted).toMatchObject({ slot: 5, set: 12, rank: 6, rarity: 5, level: 16, faction: 3,
    isAccessory: false, ascLevel: -1, equippedChampId: 100 });
});

// The vault is read once and solved twice, plain and lifted, so a mutating lift would make the
// plain BEST printed above the block disagree with the build it was computed from.
test("the input item is never mutated", () => {
  const it = item({ substats: [sub(4, 10, 3, true)] });
  liftItem(it, "legendary");
  expect(it.substats[0].glyph).toBe(3);
  expect(it.substats).toHaveLength(1);
});

// Below 5★ nothing is lifted, so the whole item comes back untouched and by identity.
test("an item below 5★ comes back as itself with no lifts", () => {
  const it = item({ rank: 4, substats: [sub(4, 10, 0, true)] });
  const { item: lifted, lifts } = liftItem(it, "legendary");
  expect(lifted).toBe(it);
  expect(lifts).toEqual([]);
});
