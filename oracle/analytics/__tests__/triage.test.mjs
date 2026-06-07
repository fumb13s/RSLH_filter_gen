// oracle/analytics/__tests__/triage.test.mjs
import { test, expect } from "vitest";
import { triage, keepPremium } from "../triage.mjs";

const sub = (statId, isFlat, rolls = 2) => ({ statId, isFlat, rolls, value: 10, glyph: 0 });
const mk = (id, slot, set, substats, over = {}) => ({ id, slot, set, rank: 6, rarity: 4, level: 16,
  faction: 0, isAccessory: slot >= 7, mainStat: { statId: 4, isFlat: true, value: 0 },
  substats, ascLevel: -1, equippedChampId: 0, ...over });
const dps = [sub(4, true), sub(5, false), sub(6, false), sub(2, false)]; // good
const junk = [sub(1, true), sub(2, true), sub(3, true), sub(1, true)];   // flat junk

test("keepPremium is demand-led (scarcity only counts when demand>=3)", () => {
  expect(keepPremium(49)).toBe(1);  // Killstroke 4/1 -> demand only
  expect(keepPremium(66)).toBe(8);  // Mercurial 5/5 -> 5 + (5-2)
  expect(keepPremium(0)).toBe(1);   // setless 3/1
});
test("low-quality oversupplied low-demand armor is a delete candidate", () => {
  // 12 junk Killstroke (demand1, floor 4) boots so the bucket is above floor and percentiles populate
  const items = [];
  for (let i = 0; i < 12; i++) items.push(mk(100 + i, 4, 49, junk));
  items.push(mk(1, 4, 49, dps)); // one good piece to lift the top of the slot
  const res = triage(items);
  const aJunk = res.find((r) => r.item.id === 100);
  expect(aJunk.verdict, aJunk.reason).toBe("delete");
});
test("high-demand high-quality piece is focus", () => {
  const items = [mk(1, 4, 66, dps)]; // Mercurial, premium 8, single piece -> top of slot
  const res = triage(items);
  expect(res[0].verdict, res[0].reason).toBe("focus");
});
test("setless accessory dominated by a set accessory is delete", () => {
  const items = [mk(1, 7, 0, junk, { isAccessory: true, faction: 5 }),
                 mk(2, 7, 60, dps, { isAccessory: true, faction: 5 })];
  const res = triage(items);
  expect(res.find((r) => r.item.id === 1).verdict).toBe("delete");
});
