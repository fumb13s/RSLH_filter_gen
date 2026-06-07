import { ASCENDED_LEVEL } from "./weights.mjs";

const tally = (items, key) => {
  const m = new Map();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

export function census(items) {
  return {
    total: items.length,
    bySlot: tally(items, (it) => it.slot),
    bySet: tally(items, (it) => it.set),
    byRarity: tally(items, (it) => it.rarity),
    byLevel: tally(items, (it) => it.level),
    equipped: items.filter((it) => it.equippedChampId > 0).length,
    ascended: items.filter((it) => it.ascLevel === ASCENDED_LEVEL).length,
    glyphed: items.filter((it) => it.substats.some((s) => (s.glyph || 0) > 0)).length,
    accessories: items.filter((it) => it.isAccessory).length,
    setless: items.filter((it) => it.isAccessory && it.set === 0).length,
  };
}
