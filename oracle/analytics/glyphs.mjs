// Glyph caps: what one substat could hold if a glyph of a chosen GRADE were applied to it.
//
// power.mjs values every piece with the glyphs it already carries — champion-stats.mjs's
// itemEntries adds each substat's `glyph` to its value — so it cannot answer "what could this
// champion reach if its gear were glyphed?". This module lifts a vault to a grade's caps, and the
// solvers then run over it unchanged: a glyphed item is just a better item.
//
// A GRADE, NOT A NUMBER. speed.mjs's --glyph takes a raw number, which works because it values
// one stat. Across all nine glyphable stats one number cannot: a SPD glyph tops out at 12 and a
// flat HP one at 1,150. A grade — "every glyphable substat holds the cap of a 6★ Epic glyph" — is
// an assumption a reader can state and control.
//
// PROVENANCE OF THE CAPS. The four 6★ rows are the TOPS of the 6★ roll ranges the account owner
// gave, for Normal, Rare, Epic and Legendary in that order:
//
//   SPD and HP%/ATK%/DEF%     3-8,     4-9,     5-10,     7-12
//   RES and ACC               6-16,    8-18,    10-20,    14-24
//   ATK and DEF               30-40,   35-45,   40-50,    45-60
//   HP                        250-750, 350-850, 450-950,  650-1150
//
// The 5★ row is the largest glyph the 2026-09-29 capture holds on any 5★ item, which the account
// owner confirmed is the 5★ maximum. That capture agrees with both halves: its largest 6★ values
// are SPD 12, % 12 and RES/ACC 24, and none exceeds a range. There are no Mythical glyphs.
//
// NOT VAULT CEILINGS, which is what speed-model.mjs's glyphCeilings records. Those maxima are
// uneven across rarities — on the 2026-09-29 capture Epic 6★ pieces top out at DEF% 12 while
// Legendary ones top out at 10 — because they record what was APPLIED, not what a grade can roll.
//
// THE RANK RULE. A 6★ item takes the grade asked for. A 5★ item takes at most a 5★ glyph, so it
// gets the "5" row whatever was asked. Anything below 5★ is never lifted at all.
//
// THE CRIT RULE. Glyphs never touch crit. On the 2026-09-29 capture none of the 5,515 C.RATE and
// C.DMG substats carries a glyph, and neither does any damage-type substat. So a lift only ever
// adds to the LINEAR part of the power objective, which is what makes power.mjs's per-lift value
// exact and additive across lifts.
//
// SUBSTATS ONLY. The main stat and the ascension stat are never lifted, since glyphs only ever
// apply to substats — see speed-model.mjs's itemSpeed, where ASCGV and mgv are 0 in all 8474 rows
// of the 2026-08-12 snapshot.
//
// NOT weights.mjs's GLYPH_THRESHOLDS, despite the name. That one is triage's test for whether a
// piece is "highly glyphed" ALREADY: it reads applied glyphs and excludes flat HP/ATK/DEF. These
// are per-grade ceilings over every glyphable stat. The two answer different questions and are
// deliberately separate.
//
// Pure arithmetic on the Item shape, and it imports nothing.

// In INCREASING order. "5" is a 5★ glyph; the other four are 6★ glyphs by rarity.
export const GLYPH_GRADES = ["5", "normal", "rare", "epic", "legendary"];

// Display labels. A headline reading "5 glyphs" would be read as a count, which is why a grade is
// never printed raw.
export const GLYPH_LABELS = {
  "5": "5★",
  normal: "6★ Normal",
  rare: "6★ Rare",
  epic: "6★ Epic",
  legendary: "6★ Legendary",
};

// grade -> key -> the largest value that grade can roll. The keys are champion-stats.mjs's
// itemEntries key space, and the values are in the same display units as a substat's `glyph`
// field: whole numbers for flat stats, percentage POINTS for a "%" key (12 means +12%).
//
// Written LONGHAND rather than derived from the groups that happen to share a number today. SPD
// and HP% agreeing at every grade is a fact about the current game, not a constraint, and a
// derived table would silently paper over the patch that separates them.
export const GLYPH_CAPS = {
  "5":       { HP: 475,  ATK: 25, DEF: 25, "HP%": 5,  "ATK%": 5,  "DEF%": 5,  SPD: 5,  RES: 10, ACC: 10 },
  normal:    { HP: 750,  ATK: 40, DEF: 40, "HP%": 8,  "ATK%": 8,  "DEF%": 8,  SPD: 8,  RES: 16, ACC: 16 },
  rare:      { HP: 850,  ATK: 45, DEF: 45, "HP%": 9,  "ATK%": 9,  "DEF%": 9,  SPD: 9,  RES: 18, ACC: 18 },
  epic:      { HP: 950,  ATK: 50, DEF: 50, "HP%": 10, "ATK%": 10, "DEF%": 10, SPD: 10, RES: 20, ACC: 20 },
  legendary: { HP: 1150, ATK: 60, DEF: 60, "HP%": 12, "ATK%": 12, "DEF%": 12, SPD: 12, RES: 24, ACC: 24 },
};
