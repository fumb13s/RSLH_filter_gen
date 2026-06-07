// Maximum main-stat values at 6★ / +16 — game facts, validated against the live vault
// (2026-06-07). Our stat ids: 1 HP, 2 ATK, 3 DEF, 4 SPD, 5 C.RATE, 6 C.DMG, 7 RES, 8 ACC.
// Keyed by `${statId}|${isFlat?1:0}`. Most ceilings are slot-independent; the exceptions are
// real (confirmed in-game): C.DMG differs by slot, and the Banner's flat HP/ATK/DEF run higher.

const BASE = {
  "1|1": 4080, "1|0": 60,   // HP flat / HP%
  "2|1": 265,  "2|0": 60,   // ATK flat / ATK%
  "3|1": 265,  "3|0": 60,   // DEF flat / DEF%
  "4|1": 45,                // SPD (boots)
  "5|0": 60,                // C.RATE
  "7|1": 96,                // RES
  "8|1": 96,                // ACC
};

// Slot-specific ceilings (override BASE). C.DMG exists only as a Gloves/Amulet main.
const SLOT = {
  3: { "6|0": 80 },                            // Gloves C.DMG
  8: { "6|0": 40 },                            // Amulet C.DMG
  9: { "1|1": 6120, "2|1": 398, "3|1": 398 },  // Banner flat HP/ATK/DEF run higher
};

// Ceiling for a (slot, statId, isFlat) main, or null if that stat is never a main there.
export function mainMax(slot, statId, isFlat) {
  const k = `${statId}|${isFlat ? 1 : 0}`;
  return SLOT[slot]?.[k] ?? BASE[k] ?? null;
}
