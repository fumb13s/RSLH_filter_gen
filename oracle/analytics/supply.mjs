import { getSet } from "./sets.mjs";
import { SUPPLY } from "./weights.mjs";

// Accessories bucket by faction x slot x set; armor by slot x set.
export function bucketKey(item) {
  return item.isAccessory
    ? `acc|${item.faction}|${item.slot}|${item.set}`
    : `arm|${item.slot}|${item.set}`;
}

// Floor: accessories flat 4 (setless = 0, no floor); armor 4 x demand.
export function floorFor(item) {
  if (item.isAccessory) return item.set === 0 ? 0 : SUPPLY.accessoryFloor;
  return SUPPLY.armorBase * getSet(item.set).demand;
}

// Counts of UNEQUIPPED items per bucket (worn excluded — the floor protects spares).
export function bucketCounts(items) {
  const counts = new Map();
  for (const it of items) {
    if (it.equippedChampId > 0) continue;
    const k = bucketKey(it);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

export function atOrBelowFloor(item, counts) {
  return (counts.get(bucketKey(item)) || 0) <= floorFor(item);
}

// A setless accessory is dominated when a set-bearing accessory in the same
// faction x slot has quality >= it. scoreOf(item) -> number.
export function setlessDominated(items, scoreOf) {
  const bestSet = new Map(); // `${faction}|${slot}` -> max set-accessory quality
  for (const it of items) {
    if (!it.isAccessory || it.set === 0) continue;
    const k = `${it.faction}|${it.slot}`;
    bestSet.set(k, Math.max(bestSet.get(k) ?? -1, scoreOf(it)));
  }
  const dominated = new Set();
  for (const it of items) {
    if (!it.isAccessory || it.set !== 0) continue;
    const k = `${it.faction}|${it.slot}`;
    if ((bestSet.get(k) ?? -1) >= scoreOf(it)) dominated.add(it.id);
  }
  return dominated;
}
