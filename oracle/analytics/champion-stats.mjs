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
