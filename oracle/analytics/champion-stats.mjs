// The champion stat model: the game's Total Stats screen for a copy and a gear assignment.

// The eight stats the screen shows, in its column order.
export const STATS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"];

// The Great Hall, which the game labels "Affinity Bonuses". MAXED: these are the level-10 values,
// identical for all four affinities, confirmed on a 2026-09-29 capture where every affinity is at
// 10. A snapshot does carry great-hall-state.json, so reading the real levels is a one-module
// change the day a partly-levelled account needs it; until then this assumption is a one-line edit.
export const GREAT_HALL = [["HP%", 20], ["ATK%", 20], ["DEF%", 20], ["RES", 80], ["ACC", 80], ["C.DMG", 25]];

// Classic Arena, assuming the GOLD 5 league — the account owner's stated assumption, and the other
// one-line edit. account-bonuses.json carries the real league, likewise unread for now.
export const ARENA = [["HP%", 22], ["ATK%", 22], ["DEF%", 22]];

// What one [key, value] bonus adds, and to which stat. A "X%" key is a percentage of the
// champion's BASE X; everything else lands on its own stat as-is, which is what makes C.RATE and
// C.DMG additive POINTS rather than percentages of the base crit stats.
//
// Deliberately unrounded and unfloored. The Total Stats screen rounds each COLUMN once and then
// sums, so statBreakdown is the only place a number is rounded.
export function contribution(key, value, base) {
  if (!key.endsWith("%")) return [key, value];
  const stat = key.slice(0, -1);
  return [stat, base[stat] * value / 100];
}

// Item stat id -> key. These are OUR ids (STAT_NAMES order), which are NOT the statKindId enum
// gestal.mjs's bonusesV2 tables use: the two agree on 1-4 and swap around on 5-8, where an item's
// 5 is C.RATE and 7 is RES while a stat kind's 5 is RES and 7 is C.RATE. Two tables on purpose.
const SCALED_ITEM_KEY = { 1: "HP", 2: "ATK", 3: "DEF" };
const ITEM_KEY = { 4: "SPD", 5: "C.RATE", 6: "C.DMG", 7: "RES", 8: "ACC" };

// null for a stat that belongs on no column. Ids 11-18 are the damage-type substats (PvE, PvP,
// Boss, Dungeon DMG +, then the same four -); no Total Stats column reflects them, so they are
// skipped. Anything else is a stat this model has never seen and refuses to guess at.
function itemKey(stat) {
  const scaled = SCALED_ITEM_KEY[stat.statId];
  if (scaled) return stat.isFlat ? scaled : `${scaled}%`;
  if (ITEM_KEY[stat.statId]) return ITEM_KEY[stat.statId];
  if (stat.statId >= 11 && stat.statId <= 18) return null;
  throw new Error(`unknown item stat id ${stat.statId} — champion-stats.mjs needs updating`);
}

// Every [key, value] one item contributes: its main stat, each substat and its ascension stat.
// A substat's glyph is ADDITIVE — substat.value does not already include it, as itemSpeed
// established — so it is added here rather than read as an alternative.
export function itemEntries(item) {
  const out = [];
  const push = (stat, value) => {
    const key = itemKey(stat);
    if (key) out.push([key, value]);
  };
  push(item.mainStat, item.mainStat.value);
  for (const s of item.substats) push(s, s.value + s.glyph);
  if (item.ascStat) push(item.ascStat, item.ascStat.value);
  return out;
}
