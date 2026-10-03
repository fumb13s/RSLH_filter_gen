// Every artifact set's STAT bonus, for every stat. The companion to sets.mjs (which carries names,
// roles and demand rather than numbers), and the table speed-sets.mjs now derives its SPD view from.
//
// PROVENANCE. Generated from Gestal Desktop's set catalogue (`Desktop/gearsets.json`), whose game
// set ids come through `Desktop/mappings.json` -> `gearSets` into the `aset` / `.hsf` id space this
// table is keyed by — the same space as `Item.set` and ARTIFACT_SET_NAMES. Our snapshots do NOT
// capture that catalogue (gestal.mjs's DOCUMENTS takes gear, roster and the stat documents only), so
// nothing here can be re-derived from a snapshot on disk; a refresh means reading Gestal's data root.
//
// VERIFIED 532/532. With the two stacking rules below, this table reproduces the game's OWN
// per-champion set bonuses — Gestal's `bonusesV2.sets`, which is what the champion screen shows —
// for all 532 geared champions on the 2026-09-29 capture. That is why it is trusted over the
// hand-typed speed values it replaces, which it showed to be wrong for six sets (see speed-sets.mjs).
//
// TWO KINDS, mapping onto Gestal's four categories:
//   `stack`   Gestal `2-set` and `4-set`. A set contributes floor(count / pieces) completions, each
//             granting `bonus` in full. Six pieces of Life is three completions, +45% HP.
//   `tiered`  Gestal `Variable` — the nine-slot sets. Every tier whose threshold is <= count applies
//             ONCE, and they accumulate. ONE-PIECE TIERS EXIST: Stone Skin grants +8% HP off a
//             single piece, so a tiered set is not inert below three pieces.
// Gestal's fourth category, `1-set` (the accessory-only sets 1000-1004), carries no stats at all and
// sits in NO_STAT_SETS with the rest.
//
// STAT KEYS. "HP%", "ATK%", "DEF%" and "SPD%" are percentages of the champion's BASE stat. "C.RATE"
// and "C.DMG" are percentage POINTS, added as-is. "ACC" and "RES" are flat. No set grants flat
// HP/ATK/DEF/SPD, so there is no flat-versus-percent ambiguity to carry per row. The spellings match
// statDisplayName in @rslh/core except "SPD%", which core has no name for because no ITEM grants it.
//
// NOT HERE: non-stat effects. The catalogue also lists Lethal's ignore-DEF and Merciless's tier-6
// ignore-DEF (Gestal stat ids 14 "Ignore DEF" and 15 "HP-scaled damage"). They are left out because
// no stat on the champion screen reflects them, so a stat model has nothing to do with them.
//
// NOT HERE EITHER: Lore of Steel. That mastery multiplies every set's stat bonus by (1 + multiplier),
// and the game shows the extra under Masteries rather than inside the set bonus. The champion stat
// model applies it; this module stays multiplier-free, so a caller that forgets it under-counts
// rather than double-counts.
//
// This is GAME DATA and will drift on a game patch. The guard is `power.mjs verify`, which re-checks
// the table against the game's own set bonuses on a fresh Gestal capture.

export const SET_BONUSES = {
  1:   { name: "Life",                  kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
  2:   { name: "Offense",               kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
  3:   { name: "Defense",               kind: "stack", pieces: 2, bonus: { "DEF%": 15 } },
  4:   { name: "Speed",                 kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
  5:   { name: "Crit Rate",             kind: "stack", pieces: 2, bonus: { "C.RATE": 12 } },
  6:   { name: "Crit Damage",           kind: "stack", pieces: 2, bonus: { "C.DMG": 20 } },
  7:   { name: "Accuracy",              kind: "stack", pieces: 2, bonus: { "ACC": 40 } },
  8:   { name: "Resistance",            kind: "stack", pieces: 2, bonus: { "RES": 40 } },
  29:  { name: "Cruel",                 kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
  30:  { name: "Immortal",              kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
  31:  { name: "Divine Offense",        kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
  32:  { name: "Divine Crit Rate",      kind: "stack", pieces: 2, bonus: { "C.RATE": 12 } },
  33:  { name: "Divine Life",           kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
  34:  { name: "Divine Speed",          kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
  35:  { name: "Swift Parry",           kind: "tiered", tiers: [[1, { "C.DMG": 15 }], [2, { "SPD%": 8 }], [3, { "C.DMG": 15 }], [4, { "SPD%": 10 }], [5, { "HP%": 10 }], [7, { "HP%": 15 }], [8, { "SPD%": 10 }]] },
  36:  { name: "Deflection",            kind: "tiered", tiers: [[1, { "ACC": 20 }], [2, { "SPD%": 10 }], [3, { "ACC": 20 }], [5, { "SPD%": 10 }], [7, { "ACC": 20 }], [8, { "SPD%": 12 }]] },
  37:  { name: "Resilience",            kind: "stack", pieces: 2, bonus: { "HP%": 10, "DEF%": 10 } },
  38:  { name: "Perception",            kind: "stack", pieces: 2, bonus: { "ACC": 40, "SPD%": 5 } },
  39:  { name: "Affinitybreaker",       kind: "stack", pieces: 4, bonus: { "C.DMG": 30 } },
  40:  { name: "Untouchable",           kind: "stack", pieces: 4, bonus: { "RES": 40 } },
  41:  { name: "Fatal",                 kind: "stack", pieces: 2, bonus: { "ATK%": 15, "C.RATE": 5 } },
  43:  { name: "Bloodthirst",           kind: "stack", pieces: 4, bonus: { "C.RATE": 12 } },
  45:  { name: "Fortitude",             kind: "stack", pieces: 2, bonus: { "DEF%": 10, "RES": 40 } },
  46:  { name: "Lethal",                kind: "stack", pieces: 4, bonus: { "C.RATE": 10 } },
  47:  { name: "Protection",            kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 12 }], [5, { "SPD%": 12 }], [7, { "RES": 20 }], [8, { "SPD%": 8 }]] },
  48:  { name: "Stone Skin",            kind: "tiered", tiers: [[1, { "HP%": 8 }], [2, { "RES": 40 }], [3, { "DEF%": 15 }], [5, { "DEF%": 15 }], [7, { "HP%": 8 }], [8, { "RES": 40 }]] },
  49:  { name: "Killstroke",            kind: "stack", pieces: 2, bonus: { "C.DMG": 20, "SPD%": 5 } },
  50:  { name: "Instinct",              kind: "stack", pieces: 4, bonus: { "SPD%": 12 } },
  52:  { name: "Defiant",               kind: "stack", pieces: 2, bonus: { "DEF%": 10 } },
  53:  { name: "Impulse",               kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
  54:  { name: "Zeal",                  kind: "stack", pieces: 2, bonus: { "C.DMG": 20 } },
  57:  { name: "Righteous",             kind: "stack", pieces: 2, bonus: { "RES": 40, "SPD%": 10 } },
  58:  { name: "Supersonic",            kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 10 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
  59:  { name: "Merciless",             kind: "tiered", tiers: [[1, { "ATK%": 10 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "ATK%": 15 }], [7, { "SPD%": 5 }], [8, { "C.DMG": 15 }]] },
  60:  { name: "Slayer",                kind: "tiered", tiers: [[1, { "C.RATE": 5 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "C.RATE": 10 }], [7, { "C.DMG": 15 }], [8, { "SPD%": 5 }]] },
  61:  { name: "Feral",                 kind: "tiered", tiers: [[1, { "ACC": 40 }], [2, { "SPD%": 5 }], [3, { "ACC": 40 }], [5, { "SPD%": 5 }], [7, { "ACC": 40 }], [8, { "SPD%": 5 }]] },
  62:  { name: "Pinpoint",              kind: "tiered", tiers: [[1, { "ACC": 20 }], [2, { "SPD%": 10 }], [3, { "ACC": 20 }], [5, { "SPD%": 10 }], [7, { "ACC": 20 }], [8, { "SPD%": 12 }]] },
  63:  { name: "Stonecleaver",          kind: "tiered", tiers: [[1, { "ATK%": 10 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "ATK%": 15 }], [7, { "SPD%": 5 }], [8, { "C.DMG": 15 }]] },
  64:  { name: "Rebirth",               kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "SPD%": 10 }], [3, { "RES": 20 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
  65:  { name: "Chronophage",           kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "SPD%": 10 }], [3, { "RES": 20 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
  66:  { name: "Mercurial",             kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 8 }], [5, { "SPD%": 12 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
};

// The other 28 ids the catalogue knows, which grant no stats at all: 9-28 (the original effect sets
// — Lifesteal, Fury, Stun and so on), Frostbite (42), Guardian (44), Bolster (51), and the five
// accessory-only `1-set` sets. Listed explicitly rather than inferred by absence, so that
// SET_BONUSES and this together can be proven to cover every set id the game has — which is what
// turns "a set added by a patch" from a silent zero into a failing test.
export const NO_STAT_SETS = new Set([
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  42, 44, 51,
  1000, 1001, 1002, 1003, 1004,
]);

// setId -> how many of these items carry it. Setless items (set 0) belong to no set and are skipped.
export function setCounts(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item.set) continue;
    counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
  }
  return counts;
}

// Every stat bonus a build earns, as a flat list — one entry per completed `stack` set and per
// unlocked `tiered` tier, per stat. `counts` maps setId -> how many of the nine equipped items
// carry that set. A set the table has no row for contributes nothing.
export function setBonusTerms(counts) {
  const terms = [];
  for (const [setId, count] of counts) {
    const row = SET_BONUSES[setId];
    if (!row) continue;
    if (row.kind === "stack") {
      for (let n = Math.floor(count / row.pieces); n > 0; n--) {
        for (const [key, value] of Object.entries(row.bonus)) terms.push({ setId, key, value });
      }
      continue;
    }
    // Cumulative, not exclusive: EVERY tier at or below `count` applies, once each.
    for (const [threshold, bonus] of row.tiers) {
      if (count < threshold) continue;
      for (const [key, value] of Object.entries(bonus)) terms.push({ setId, key, value });
    }
  }
  return terms;
}
