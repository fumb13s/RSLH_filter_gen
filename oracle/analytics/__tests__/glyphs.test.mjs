// oracle/analytics/__tests__/glyphs.test.mjs
import { test, expect } from "vitest";
import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS, itemGrade } from "../glyphs.mjs";

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
