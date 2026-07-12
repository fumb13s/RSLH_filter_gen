// oracle/analytics/__tests__/score.test.mjs
import { test, expect } from "vitest";
import { quality, investment, desir, mainDesir } from "../score.mjs";
import { subMax } from "../rolls.mjs";
import { mainMax } from "../mainstats.mjs";

// a substat at a given completeness fraction of its theoretical max (default fully maxed)
const sub = (statId, isFlat, frac = 1, rolls = 4) => ({ statId, isFlat, rolls, value: subMax(statId, isFlat) * frac, glyph: 0 });
// a main stat at a given fraction of its 6★+16 ceiling (default fully built)
const main = (slot, statId, isFlat, frac = 1) => ({ statId, isFlat, value: (mainMax(slot, statId, isFlat) ?? 1) * frac });
const item = (slot, set, mainStat, substats, over = {}) => ({
  id: 1, slot, set, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: slot >= 7, mainStat, substats, ascLevel: -1, equippedChampId: 0, ...over,
});

test("substat desir: every % beats flat for ATK-DPS", () => {
  expect(desir("ATK-DPS", 2, false) > desir("ATK-DPS", 2, true)).toBe(true);
});

test("main desir: SPD top; C.DMG-main > C.RATE-main; flat artifact main is junk", () => {
  expect(mainDesir("ATK-DPS", 4, true, 4)).toBe(1.0);                                   // SPD boots
  expect(mainDesir("ATK-DPS", 6, false, 3)).toBeGreaterThan(mainDesir("ATK-DPS", 5, false, 3)); // CD>CR gloves
  expect(mainDesir("ATK-DPS", 3, true, 4)).toBe(0.1);                                   // flat-DEF boots main (artifact)
});

test("main desir: flat accessory main counts as %, and role synergy", () => {
  expect(mainDesir("ATK-DPS", 2, true, 7)).toBe(0.8);   // flat-ATK Ring main -> atkPct (dmg%)
  expect(mainDesir("Support", 1, true, 8)).toBe(0.8);   // flat-HP Amulet main -> hpPct (support)
  expect(mainDesir("ATK-DPS", 6, false, 8)).toBe(0.95); // C.DMG Amulet (DPS) high
  expect(mainDesir("Support", 6, false, 8)).toBe(0.25); // C.DMG Amulet (support) low
});

const goodSubs = [sub(5, false, 0.6), sub(6, false, 0.6), sub(2, false, 0.6)]; // CR/CD/ATK%
const junkSubs = [sub(1, true, 0.5), sub(3, true, 0.5), sub(1, false, 0.3)];   // flat HP/DEF + weak HP%

test("SPD-main boots ranks above a flat-DEF-main boots with the same subs", () => {
  const spd = quality(item(4, 4, main(4, 4, true), goodSubs));   // SPD main
  const flat = quality(item(4, 4, main(4, 3, true), goodSubs));  // flat-DEF main
  expect(spd.score).toBeGreaterThan(flat.score);
});

test("same main, good subs beat junk subs", () => {
  const good = quality(item(4, 4, main(4, 4, true), goodSubs));
  const junk = quality(item(4, 4, main(4, 4, true), junkSubs));
  expect(good.score).toBeGreaterThan(junk.score);
});

test("value-completeness: a maxed main outscores an under-built one (same subs)", () => {
  const built = quality(item(4, 4, main(4, 4, true, 1.0), goodSubs));
  const unbuilt = quality(item(4, 4, main(4, 4, true, 0.2), goodSubs));
  expect(built.score).toBeGreaterThan(unbuilt.score);
});

test("PRINCIPLE: best main + junk subs ranks below second-best main + perfect subs", () => {
  const spdJunk = quality(item(4, 4, main(4, 4, true), junkSubs));                    // SPD main, junk subs
  const atkPerfect = quality(item(4, 4, main(4, 2, false),                            // ATK% main, great subs
    [sub(4, true, 0.95), sub(5, false, 0.95), sub(6, false, 0.95)]));
  expect(atkPerfect.score).toBeGreaterThan(spdJunk.score);
});

test("best-role: a C.DMG-main amulet with crit subs picks a DPS role over Support", () => {
  const amulet = quality(item(8, 4, main(8, 6, false), [sub(5, false, 0.7), sub(6, false, 0.7), sub(2, false, 0.7)]));
  expect(["ATK-DPS", "DEF-DPS", "HP-DPS"]).toContain(amulet.role);
});

test("potential (worth leveling) scores by type and is level-independent", () => {
  const crit = [sub(5, false, 0.3), sub(6, false, 0.3)]; // crit types, barely rolled
  const lo = quality(item(4, 66, main(4, 4, true, 0.2), crit, { level: 8 }), true);  // SPD boots, +8, low values
  const hi = quality(item(4, 66, main(4, 4, true, 1.0), crit, { level: 16 }), true); // same types, +16, maxed
  expect(lo.score).toBe(hi.score);                          // type-based -> level/value-independent
  const flat = quality(item(4, 66, main(4, 3, true), crit, { level: 8 }), true);     // flat-DEF main instead
  expect(lo.score).toBeGreaterThan(flat.score);             // SPD-main potential beats flat-DEF-main
});

test("investment: ascended at level 6, glyphed at SPD>=4", () => {
  const it = (over) => item(4, 6, main(4, 4, true), goodSubs, over);
  expect(investment(it({ ascLevel: 6 })).ascended).toBe(true);
  expect(investment(it({ ascLevel: 2 })).ascended).toBe(false);
  const glyphed = [{ ...sub(4, true), glyph: 4 }, sub(5, false), sub(6, false)];
  expect(investment(item(4, 6, main(4, 4, true), glyphed)).glyphed).toBe(true);
  expect(investment(item(4, 6, main(4, 4, true), goodSubs)).glyphed).toBe(false);
});
