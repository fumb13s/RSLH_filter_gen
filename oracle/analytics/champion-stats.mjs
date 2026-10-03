// The game's TOTAL STATS screen, reproduced for any champion copy and any gear assignment. Pure
// and weight-free: it reads a champion's stat record (gestal.mjs's gestalChampStats) and a plain
// array of Items, and knows nothing about power, scoring or snapshots.
//
//   total(stat) = Σ over the nine columns of round(column(stat))
//
// VERIFIED column for column against the in-game screen on five champions — Ultimate Deathknight,
// Helicath, Madame Serris, Thor Faehammer and Pelops the Victor — apart from ±1 on some totals,
// which is the per-column rounding below and is reproduced rather than smoothed away.
//
// ROUNDING. The game rounds EACH COLUMN to a whole number and then sums. Column vectors are
// therefore left unrounded and unfloored, and `totals` is the only place a number is rounded.
// This is also why the Artifacts column uses setBonusTotals rather than setBonusTerms: the
// warning on setBonusTotals is about the SPEED model, where the game floors each set term
// against base separately (speed-sets.mjs's setEffect). The Total Stats screen does not — it
// rounds per column — so the two genuinely differ, and statBreakdown's SPD column is NOT
// speed.mjs's number. Do not reconcile them here.
//
// LORE OF STEEL multiplies EVERY set's stat bonus, not only the eight basic sets, and the game
// shows that extra under Masteries rather than inside the set bonus. Verified on a champion with
// the mastery, whose Merciless, Zeal and Pinpoint bonuses were all scaled. set-bonuses.mjs stays
// multiplier-free and this module applies it, so a caller that forgets it under-counts rather
// than double-counts.
//
// ACCOUNT-WIDE SOURCES ARE CONSTANTS. The Great Hall is assumed MAXED and the Classic Arena
// league GOLD 5 — both named constants below, so changing either is a one-line edit. A snapshot
// does carry great-hall-state.json and account-bonuses.json; nothing reads them yet.
//
// STAT IDS. itemEntries reads OUR item stat ids (STAT_NAMES order). They are NOT the statKindId
// enum gestal.mjs uses for bonusesV2 — the two agree on 1-4 and swap on 5-8. The two tables are
// deliberately separate.
import { setBonusTotals, setCounts } from "./set-bonuses.mjs";

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

const zeros = () => Object.fromEntries(STATS.map((stat) => [stat, 0]));

// The game's Total Stats screen for one copy and one gear assignment: its nine columns, each an
// unrounded vector over STATS, and the totals.
//
// TOTALS ROUND PER COLUMN, then sum. That is what the game does, and it is where the ±1
// differences against a plain sum of the unrounded columns come from. Reproducing it is the point.
export function statBreakdown(champStats, items) {
  const { base, sources, loreOfSteel } = champStats;
  const vector = (entries) => {
    const out = zeros();
    for (const [key, value] of entries) {
      const [stat, amount] = contribution(key, value, base);
      out[stat] += amount;
    }
    return out;
  };
  const setTotals = [...setBonusTotals(setCounts(items))];
  const columns = [
    ["Basic", { ...zeros(), ...base }],
    ["Artifacts", vector([...items.flatMap(itemEntries), ...setTotals])],
    ["Affinity", vector(GREAT_HALL)],
    ["Classic Arena", vector(ARENA)],
    // Lore of Steel scales EVERY set's bonus, not only the eight basic sets, and the game shows
    // that extra here rather than inside the set bonus. Verified on a champion with the mastery,
    // whose Merciless, Zeal and Pinpoint bonuses were all scaled. Scaling the summed totals is
    // the same number as scaling each term: with no flooring, k * Σ terms == Σ (k * terms).
    ["Masteries", vector([...sources.mastery,
      ...setTotals.map(([key, value]) => [key, value * loreOfSteel])])],
    ["Faction Guardians", vector(sources.factionGuardian)],
    ["Empowerment", vector(sources.empower)],
    ["Blessing", vector(sources.blessing)],
    ["Relic", vector(sources.relic)],
  ];
  const totals = Object.fromEntries(STATS.map((stat) =>
    [stat, columns.reduce((sum, [, v]) => sum + Math.round(v[stat]), 0)]));
  return { columns, totals };
}
