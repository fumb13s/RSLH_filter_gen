// Exact maximum-speed gear solver. See the design doc for why this is plan enumeration plus a small
// assignment DP rather than one DP over all set counts.

export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// slot -> setId -> the fastest item of that set in that slot. For a fixed slot->set assignment
// nothing else about a slot matters, so this IS the search space: 8474 items collapse to about 1011
// entries. Accessory slots (7-9) are filtered to the champion's faction, a hard game constraint.
// Ties break on the lower item id so a rerun prints the same build.
export function buildIndex(items, faction, speedOf) {
  const index = new Map();
  for (const item of items) {
    if (item.isAccessory && item.faction !== faction) continue;
    let bySet = index.get(item.slot);
    if (!bySet) index.set(item.slot, (bySet = new Map()));
    const speed = speedOf(item);
    const current = bySet.get(item.set);
    if (!current || speed > current.speed
      || (speed === current.speed && item.id < current.item.id)) {
      bySet.set(item.set, { item, speed });
    }
  }
  return index;
}
