// Roll-mechanics-derived quantities for substat scoring — all from core's modeled mechanics
// (ROLL_RANGES, STARTING_SUBSTATS, MAX_SUBSTATS, UPGRADE_LEVELS). No magic numbers, so the
// ceiling is the *theoretical* maximum and stays stable regardless of any snapshot's luck.
import { ROLL_RANGES, STARTING_SUBSTATS, MAX_SUBSTATS, UPGRADE_LEVELS, ITEM_RARITIES, SLOT_STATS } from "@rslh/core";

const MYTH = ITEM_RARITIES.indexOf("Mythical"); // 5
// 6 roll events on one substat: reveal (1) + Mythical's extra starting roll (1) + 4 upgrades.
export const MAX_ROLLS = 1 + (STARTING_SUBSTATS[MYTH] - MAX_SUBSTATS) + UPGRADE_LEVELS.length; // 6
// Total roll events on the best (Mythical) item: 5 starting rolls (4 subs, one doubled) + 4 upgrades.
export const TOTAL_ROLLS = STARTING_SUBSTATS[MYTH] + UPGRADE_LEVELS.length;                    // 9
const RANK = 6; // ceilings + maxima are taken at 6★

// ROLL_RANGES group for a stat. SPD/ACC/RES are non-flat groups regardless of our decoder's
// isFlat=true convention for them, so map by stat id directly.
function group(statId, isFlat) {
  if (statId <= 3 && isFlat) return statId === 1 ? "flatHp" : "flatAtkDef";
  if (statId === 4) return "speed";
  if (statId === 7 || statId === 8) return "accRes";
  return "percent"; // HP%/ATK%/DEF%/C.RATE/C.DMG
}

// Theoretical max value of one substat = MAX_ROLLS x max-per-roll at 6★. Snapshot-independent.
export function subMax(statId, isFlat) {
  return MAX_ROLLS * ROLL_RANGES[group(statId, isFlat)][RANK][1];
}

// Best ACHIEVABLE substat ceiling for a slot, given desirOf(statId, isFlat) -> desirability.
// Take the 4 highest-desirability achievable substats, then spend the roll budget greedily on
// the highest-desirability sub (capped at MAX_ROLLS); return the desirability-weighted completeness.
// `exclude` {statId, isFlat}: drop a stat from the pool — a substat can never duplicate the main.
export function subCeiling(slot, desirOf, exclude) {
  const desirs = SLOT_STATS[slot].substats
    .filter(([id, f]) => !(exclude && id === exclude.statId && f === exclude.isFlat))
    .map(([id, f]) => desirOf(id, f))
    .sort((a, b) => b - a)
    .slice(0, MAX_SUBSTATS);
  const rolls = desirs.map(() => 1);          // each of the 4 subs is revealed (1 roll)
  let extra = TOTAL_ROLLS - desirs.length;    // remaining rolls to distribute
  while (extra > 0) {
    let bi = -1;
    for (let i = 0; i < desirs.length; i++) {
      if (rolls[i] < MAX_ROLLS && (bi < 0 || desirs[i] > desirs[bi])) bi = i;
    }
    if (bi < 0) break;
    rolls[bi]++; extra--;
  }
  return desirs.reduce((s, d, i) => s + d * (rolls[i] / MAX_ROLLS), 0);
}
