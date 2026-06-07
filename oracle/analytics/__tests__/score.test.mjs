// oracle/analytics/__tests__/score.test.mjs
import { test, expect } from "vitest";
import { quality, investment, desir } from "../score.mjs";

const sub = (statId, isFlat, rolls = 2, value = 10) => ({ statId, isFlat, rolls, value, glyph: 0 });
// helper item; set picks the role pool
const item = (slot, set, substats, over = {}) => ({
  id: 1, slot, set, rank: 6, rarity: 4, level: 16, faction: 0,
  isAccessory: slot >= 7, mainStat: { statId: 4, isFlat: true, value: 0 },
  substats, ascLevel: -1, equippedChampId: 0, ...over,
});
// SPD, C.RATE, C.DMG, ATK% — ideal DPS line
const dpsSubs = [sub(4, true), sub(5, false), sub(6, false), sub(2, false)];

test("desir: every % stat beats flat for ATK-DPS", () => {
  expect(desir("ATK-DPS", 2, false) > desir("ATK-DPS", 2, true)).toBeTruthy(); // ATK% > flat ATK
  expect(desir("ATK-DPS", 3, false) > desir("ATK-DPS", 1, true)).toBeTruthy(); // DEF% > flat HP
});
test("DPS subs score high on a DPS set, low on a Support-only set", () => {
  const onCrit = quality(item(4, 6, dpsSubs));   // set 6 Crit Damage -> DPS roles
  const onImmortal = quality(item(4, 30, dpsSubs)); // set 30 Immortal -> Support only
  expect(onCrit.score, `crit-set DPS line high: ${onCrit.score}`).toBeGreaterThan(70);
  expect(onImmortal.score, `support-set lower: ${onImmortal.score}`).toBeLessThan(onCrit.score - 20);
  expect(onCrit.role).toBe("ATK-DPS");
});
test("flat subs: amulet not crushed the way a chest is (slot-relative)", () => {
  const flat = [sub(1, true), sub(2, true), sub(3, true), sub(8, false)]; // flat HP/ATK/DEF + ACC
  const amulet = quality(item(8, 30, flat)).score; // amulet: flat is largely forced
  const chest = quality(item(2, 30, flat)).score;  // chest: %-variants were available
  expect(amulet, `amulet(${amulet}) > chest(${chest}) for same flat line`).toBeGreaterThan(chest);
});
test("investment: ascended at level 6, glyphed at SPD>=4", () => {
  expect(investment(item(4, 6, dpsSubs, { ascLevel: 6 })).ascended).toBe(true);
  expect(investment(item(4, 6, dpsSubs, { ascLevel: 2 })).ascended).toBe(false);
  const glyphed = [{ ...sub(4, true), glyph: 4 }, sub(5, false), sub(6, false), sub(2, false)];
  expect(investment(item(4, 6, glyphed)).glyphed).toBe(true);
  expect(investment(item(4, 6, dpsSubs)).glyphed).toBe(false);
});
