// oracle/analytics/__tests__/cross-check.test.mjs
//
// The classifier behind cross-check.mjs: two decodes of the same record either agree, differ for a
// reason that happened between the two snapshots, or differ unexplained — the last being the only
// finding, since it would mean one of the decoders is wrong.
import { expect, test } from "vitest";
import { compareChamp, comparePiece, locations, wearerDisagreements } from "../cross-check.mjs";

const item = (o = {}) => ({
  id: 1, slot: 4, set: 4, rank: 6, rarity: 4, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 4, isFlat: true, value: 45 },
  substats: [{ statId: 5, isFlat: false, rolls: 2, value: 12, glyph: 0 }],
  ascStat: null, ascLevel: -1, equippedChampId: 0, ...o,
});
const champ = (o = {}) => ({ ID: 100, Name: "Elhain", Role: 0, Rarity: 3, Fraction: 2, Rang: 6, Lvl: 60,
  EmpLvl: 0, HeroID: 1496, BaseHeroID: 1490, BId: 0, ...o });

test("identical decodes agree", () => {
  expect(comparePiece(item(), item(), false)).toBeNull();
  expect(compareChamp(champ(), champ())).toBeNull();
});

test("a piece's identity can never change, so any difference there is unexplained", () => {
  expect(comparePiece(item(), item({ slot: 3 }), false)).toMatchObject({ unexplained: expect.stringMatching(/slot 4 vs 3/) });
  expect(comparePiece(item({ isAccessory: true, faction: 2 }), item({ isAccessory: true, faction: 13 }), false))
    .toMatchObject({ unexplained: expect.stringMatching(/faction/) });
});

test("levelling, glyphing and ascending are explained", () => {
  expect(comparePiece(item(), item({ level: 12 }), false)).toEqual({ cause: "leveled" });
  const glyphed = item({ substats: [{ statId: 5, isFlat: false, rolls: 2, value: 12, glyph: 3 }] });
  expect(comparePiece(item(), glyphed, false)).toEqual({ cause: "glyphs changed" });
  expect(comparePiece(item(), item({ ascLevel: 2, ascStat: { statId: 6, isFlat: false, value: 4 } }), false))
    .toEqual({ cause: "ascension changed" });
});

test("changed stats are explained only by a rework Gestal recorded", () => {
  const rerolled = item({ mainStat: { statId: 2, isFlat: false, value: 60 } });
  expect(comparePiece(item(), rerolled, true)).toEqual({ cause: "reworked" });
  expect(comparePiece(item(), rerolled, false)).toMatchObject({ unexplained: expect.stringMatching(/stats differ/) });
  const off = item({ substats: [{ statId: 5, isFlat: false, rolls: 2, value: 13, glyph: 0 }] });
  expect(comparePiece(item(), off, false)).toMatchObject({ unexplained: expect.any(String) });
});

test("a champion's role, rarity, faction and base type never change; progress and spelling are explained", () => {
  expect(compareChamp(champ(), champ({ Fraction: 13 }))).toMatchObject({ unexplained: expect.stringMatching(/Fraction 2 vs 13/) });
  expect(compareChamp(champ(), champ({ BaseHeroID: 7 }))).toMatchObject({ unexplained: expect.any(String) });
  expect(compareChamp(champ(), champ({ Lvl: 50 }))).toEqual({ cause: "progressed" });
  expect(compareChamp(champ(), champ({ BId: 1301 }))).toEqual({ cause: "progressed" });
  expect(compareChamp(champ(), champ({ Name: "Elhain the Swift" }))).toEqual({ cause: "name spelled differently" });
});

// An RSL Helper row read from a minimal Champs table has no BaseHeroID; that must not read as a change.
test("a column one side lacks is not compared", () => {
  expect(compareChamp(champ({ BaseHeroID: null, HeroID: null, BId: null }), champ())).toBeNull();
});

// --- wearers ------------------------------------------------------------------

const noSlots = { Weapon: 0, Helmet: 0, Shield: 0, Glouves: 0, Chest: 0, Shoes: 0, Ring: 0, Amulett: 0, Banner: 0 };

test("locations reads who wears what from the slot columns", () => {
  const rows = [champ({ ...noSlots, ID: 100, Shoes: 1, Ring: 9 }), champ({ ...noSlots, ID: 200 })];
  expect([...locations(rows)]).toEqual([[1, 100], [9, 100]]);
});

test("a wearer the slot columns agree with is no disagreement", () => {
  const items = [item({ id: 1, slot: 4, equippedChampId: 100 }), item({ id: 2, slot: 4 })];
  expect(wearerDisagreements(items, [champ({ ...noSlots, ID: 100, Shoes: 1 })])).toEqual([]);
});

// The failure the review named: a type mismatch between wearer ids and champion ids would empty every
// slot column silently, and restore.mjs would then report all gear as sitting in the vault.
test("a worn piece missing from its wearer's slot column is a disagreement, and so is the reverse", () => {
  const worn = [item({ id: 1, slot: 4, equippedChampId: 100 })];
  expect(wearerDisagreements(worn, [champ({ ...noSlots, ID: 100 })]))
    .toEqual([expect.stringMatching(/1: worn by 100, but not in that champion's Shoes column/)]);
  expect(wearerDisagreements(worn, [champ({ ...noSlots, ID: "100", Shoes: 1 })])).toHaveLength(2);
  const loose = [item({ id: 1, slot: 4 })];
  expect(wearerDisagreements(loose, [champ({ ...noSlots, ID: 100, Shoes: 1 })]))
    .toEqual([expect.stringMatching(/1: in 100's Shoes column, but not worn by it/)]);
});
