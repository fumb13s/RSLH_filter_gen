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

test("low-demand oversupplied set: worst spares trimmed, best kept per (set x slot)", () => {
  const items = [];
  // 12 unequipped Killstroke (low-demand) Boots of rising quality (higher id = better roll).
  for (let i = 0; i < 12; i++) items.push(mk(100 + i, 4, 49, main(4, 3, true), [sub(4, true, 0.15 + i * 0.06)]));
  const res = triage(items);
  expect(res.find((r) => r.item.id === 100).verdict).toBe("delete"); // worst spare -> trimmed
  expect(res.find((r) => r.item.id === 111).verdict).toBe("keep");   // best spare + floor bench -> kept
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

test("slot-balance evens an oversupplied accessory slot to its family cap, worst-first", () => {
  const items = [];
  // 30 unequipped Amulets, one faction+set, demanded (so the junk rule never fires), rising quality.
  for (let i = 0; i < 30; i++) {
    items.push(mk(100 + i, 8, 66, main(8, 6, false), [sub(2, false, 0.2 + i * 0.02)],
      { isAccessory: true, faction: 5 }));
  }
  const res = triage(items);
  const kept = res.filter((r) => r.item.slot === 8 && r.verdict === "keep");
  const del = res.filter((r) => r.item.slot === 8 && r.verdict === "delete");
  expect(kept.length).toBe(10);                       // family cap = 30 / 3 accessory slots
  expect(del.length).toBe(20);
  expect(del.every((r) => r.slotBalanced)).toBe(true); // demanded set -> not the junk rule
  expect(Math.min(...kept.map((r) => r.q.score))).toBeGreaterThanOrEqual(Math.max(...del.map((r) => r.q.score)));
});

test("slot-balance protects invested pieces from trimming", () => {
  const items = [];
  for (let i = 0; i < 30; i++) {
    items.push(mk(100 + i, 8, 66, main(8, 6, false), [sub(2, false, 0.2 + i * 0.02)],
      { isAccessory: true, faction: 5 }));
  }
  // a low-quality but ascended amulet — investment shields it from the balance trim.
  items.push(mk(999, 8, 66, main(8, 6, false), [sub(2, false, 0.01)],
    { isAccessory: true, faction: 5, ascLevel: 6 }));
  const res = triage(items);
  expect(res.find((r) => r.item.id === 999).verdict).toBe("keep");
});

test("slot-balance evens accessories per-faction, not across factions", () => {
  const items = [];
  // Faction 5: 30 Rings only; Faction 6: 30 Amulets only (both demanded set, rising quality).
  // Cross-faction the pool is 30 rings + 30 amulets -> a faction-blind cap of 60/3=20 would keep 20
  // each. Per-faction, each faction's 30 accessories cap at 30/3=10, so each kept slot drops to 10.
  for (let i = 0; i < 30; i++) {
    items.push(mk(100 + i, 7, 66, main(7, 2, false), [sub(2, false, 0.2 + i * 0.02)],
      { isAccessory: true, faction: 5 }));
    items.push(mk(200 + i, 8, 66, main(8, 6, false), [sub(2, false, 0.2 + i * 0.02)],
      { isAccessory: true, faction: 6 }));
  }
  const res = triage(items);
  const keptF5Ring = res.filter((r) => r.item.faction === 5 && r.item.slot === 7 && r.verdict === "keep");
  const keptF6Amu = res.filter((r) => r.item.faction === 6 && r.item.slot === 8 && r.verdict === "keep");
  expect(keptF5Ring.length).toBe(10); // per-faction cap = 30/3, NOT the cross-faction 60/3 = 20
  expect(keptF6Amu.length).toBe(10);
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
