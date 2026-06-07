// oracle/analytics/__tests__/triage.test.mjs
import { test, expect } from "vitest";
import { triage, keepPremium } from "../triage.mjs";
import { subMax } from "../rolls.mjs";
import { mainMax } from "../mainstats.mjs";

const sub = (statId, isFlat, frac = 1) => ({ statId, isFlat, rolls: 4, value: subMax(statId, isFlat) * frac, glyph: 0 });
const main = (slot, statId, isFlat, frac = 1) => ({ statId, isFlat, value: (mainMax(slot, statId, isFlat) ?? 1) * frac });
const mk = (id, slot, set, mainStat, substats, over = {}) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: slot >= 7, mainStat, substats, ascLevel: -1, equippedChampId: 0, ...over,
});

test("keepPremium is demand-led (scarcity only counts when demand>=3)", () => {
  expect(keepPremium(49)).toBe(1);  // Killstroke 4/1
  expect(keepPremium(66)).toBe(8);  // Mercurial 5/5 -> 5 + (5-2)
  expect(keepPremium(0)).toBe(1);   // setless 3/1
});

test("oversupplied low-demand armor lands in delete", () => {
  const junk = [sub(1, true, 0.3), sub(3, true, 0.3)]; // flat HP/DEF, weak
  const good = [sub(4, true), sub(5, false), sub(6, false)];
  const items = [];
  for (let i = 0; i < 12; i++) items.push(mk(100 + i, 4, 49, main(4, 3, true), junk)); // Killstroke, flat-DEF main
  items.push(mk(1, 4, 49, main(4, 4, true), good)); // one good piece lifts the top of the slot
  const res = triage(items);
  expect(res.find((r) => r.item.id === 100).verdict).toBe("delete");
});

test("setless accessory dominated by a set accessory is delete", () => {
  const items = [
    mk(1, 7, 0, main(7, 2, true), [sub(1, true, 0.2)], { isAccessory: true, faction: 5 }), // setless, weak
    mk(2, 7, 60, main(7, 2, true), [sub(2, false), sub(1, false)], { isAccessory: true, faction: 5 }), // set, good
  ];
  const res = triage(items);
  expect(res.find((r) => r.item.id === 1).verdict).toBe("delete");
});

test("focus tags the top couple per slot x archetype on demanded sets", () => {
  const items = [
    mk(1, 4, 66, main(4, 4, true), [sub(5, false), sub(6, false), sub(2, false)]), // best
    mk(2, 4, 66, main(4, 4, true), [sub(5, false), sub(6, false)]),                // 2nd
    mk(3, 4, 66, main(4, 4, true), [sub(2, false, 0.2)]),                          // worst
  ];
  const focused = triage(items).filter((r) => r.focus).map((r) => r.item.id).sort();
  expect(focused).toEqual([1, 2]); // top-2 of the (Boots, ATK-DPS) group
});

test("upgrade tags under-leveled demanded gear, not leveled gear", () => {
  const crit = [sub(5, false), sub(6, false), sub(2, false)];
  const items = [
    mk(1, 4, 66, main(4, 4, true), crit, { level: 16 }),     // leveled -> not an upgrade candidate
    mk(2, 4, 66, main(4, 4, true, 0.3), crit, { level: 8 }), // under-leveled SPD boots, good bones
  ];
  const res = triage(items);
  expect(res.find((r) => r.item.id === 2).upgrade).toBe(true);
  expect(res.find((r) => r.item.id === 1).upgrade).toBe(false);
});
