// oracle/analytics/__tests__/set-bonuses.test.mjs
import { test, expect } from "vitest";
import { SET_BONUSES, NO_STAT_SETS, setCounts } from "../set-bonuses.mjs";
import { setCounts as setCountsFromSpeedModel } from "../speed-model.mjs";
import { SETS } from "../sets.mjs";
import { ARTIFACT_SET_NAMES } from "@rslh/core";

const asc = (a, b) => a - b;
const ROWS = () => Object.entries(SET_BONUSES).map(([id, row]) => [Number(id), row]);

// The eight stats the champion screen reflects. Nothing else belongs in the table: Gestal's
// catalogue also carries "Ignore DEF" and "HP-scaled damage", which no stat line shows.
const KEYS = ["HP%", "ATK%", "DEF%", "SPD%", "C.RATE", "C.DMG", "ACC", "RES"];

// --- Pinned rows ------------------------------------------------------------------------------
//
// One row per SHAPE the table has, written out LONGHAND rather than read back off the table under
// test. That redundancy is the point: it is a second copy that has to be edited in agreement, and
// it is the only thing that can catch a transcription slip in game data nothing downstream can
// re-derive from a snapshot.

test("Speed is a 2-piece stacker worth 12% SPD", () => {
  expect(SET_BONUSES[4]).toEqual({ name: "Speed", kind: "stack", pieces: 2, bonus: { "SPD%": 12 } });
});

test("Fatal is a 2-piece stacker granting two stats at once", () => {
  expect(SET_BONUSES[41]).toEqual({
    name: "Fatal", kind: "stack", pieces: 2, bonus: { "ATK%": 15, "C.RATE": 5 },
  });
});

test("Lethal is a 4-piece stacker worth 10 points of C.RATE", () => {
  expect(SET_BONUSES[46]).toEqual({
    name: "Lethal", kind: "stack", pieces: 4, bonus: { "C.RATE": 10 },
  });
});

// A one-piece tier is the shape most easily assumed away: "a nine-slot set grants nothing below
// three pieces" is the intuition, and it is wrong.
test("Stone Skin is tiered and its first tier is a SINGLE piece", () => {
  expect(SET_BONUSES[48]).toEqual({
    name: "Stone Skin", kind: "tiered",
    tiers: [[1, { "HP%": 8 }], [2, { "RES": 40 }], [3, { "DEF%": 15 }],
      [5, { "DEF%": 15 }], [7, { "HP%": 8 }], [8, { "RES": 40 }]],
  });
});

// --- Structure --------------------------------------------------------------------------------

test("every tier threshold is an integer in 1-9, strictly ascending", () => {
  for (const [id, row] of ROWS()) {
    if (row.kind !== "tiered") continue;
    let previous = 0;
    for (const [threshold] of row.tiers) {
      expect(Number.isInteger(threshold), `set ${id} threshold ${threshold}`).toBe(true);
      expect(threshold >= 1 && threshold <= 9, `set ${id} threshold ${threshold} in 1-9`).toBe(true);
      expect(threshold > previous, `set ${id} thresholds ascend past ${previous}`).toBe(true);
      previous = threshold;
    }
  }
});

test("every stacking set completes at 2 or 4 pieces", () => {
  for (const [id, row] of ROWS()) {
    if (row.kind !== "stack") continue;
    expect([2, 4], `set ${id} pieces`).toContain(row.pieces);
  }
});

test("every row is one of the two kinds, and carries the fields that kind needs", () => {
  for (const [id, row] of ROWS()) {
    expect(["stack", "tiered"], `set ${id} kind`).toContain(row.kind);
    expect(typeof row.name, `set ${id} name`).toBe("string");
    if (row.kind === "stack") expect(typeof row.bonus, `set ${id} bonus`).toBe("object");
    else expect(Array.isArray(row.tiers), `set ${id} tiers`).toBe(true);
  }
});

// Asserts equality, not containment: a key that appears nowhere would mean a stat was dropped in
// transcription, which is as much a defect as a key that should not be there.
test("the table uses exactly the eight stat keys and no others", () => {
  const seen = new Set();
  for (const [, row] of ROWS()) {
    const bonuses = row.kind === "stack" ? [row.bonus] : row.tiers.map(([, bonus]) => bonus);
    for (const bonus of bonuses) for (const key of Object.keys(bonus)) seen.add(key);
  }
  expect([...seen].sort()).toEqual([...KEYS].sort());
});

test("no id is both bonus-bearing and listed as granting nothing", () => {
  expect(ROWS().map(([id]) => id).filter((id) => NO_STAT_SETS.has(id))).toEqual([]);
});

// --- Coverage ---------------------------------------------------------------------------------
//
// Together the two exports have to account for every set the game has. Without this, a set added
// by a patch sits in neither, is silently worth zero stats, and nothing says so.

test("SET_BONUSES and NO_STAT_SETS together cover every set id in ARTIFACT_SET_NAMES", () => {
  const covered = [...ROWS().map(([id]) => id), ...NO_STAT_SETS].sort(asc);
  const known = Object.keys(ARTIFACT_SET_NAMES).map(Number).sort(asc);
  expect(covered).toEqual(known);
  expect(known).toHaveLength(69);
});

test("the table has 41 rows and NO_STAT_SETS has the other 28 ids", () => {
  expect(ROWS()).toHaveLength(41);
  expect(NO_STAT_SETS.size).toBe(28);
});

// sets.mjs is an independent, pre-existing table. Agreeing with it kills the wrong-id class
// outright: a mistyped id would have to land on a different real set that happens to carry the
// same name. Note the spellings differ from core's — SETS says "Crit Rate" where
// ARTIFACT_SET_NAMES says "Critical Rate" — and SETS is the one that wins.
test("every name agrees with sets.mjs, or with ARTIFACT_SET_NAMES where sets.mjs has no row", () => {
  for (const [id, row] of ROWS()) {
    expect(row.name, `set ${id}`).toBe(SETS[id]?.name ?? ARTIFACT_SET_NAMES[id]);
  }
});

// Pins the scope of that fallback: if sets.mjs later grows rows for 39 and 43, this says so rather
// than letting the fallback quietly stop being reachable.
test("ids 39 and 43 are exactly the rows sets.mjs does not carry", () => {
  expect(ROWS().filter(([id]) => !SETS[id]).map(([id]) => id)).toEqual([39, 43]);
});

// --- setCounts --------------------------------------------------------------------------------

test("setCounts tallies how many of these items carry each set", () => {
  const items = [{ set: 4 }, { set: 4 }, { set: 38 }];
  expect(Object.fromEntries(setCounts(items))).toEqual({ 4: 2, 38: 1 });
});

// Set 0 is "no set", not a set numbered 0. Counting it would make a pile of setless items look
// like a completion candidate to every caller that reads these counts.
test("setCounts skips setless items", () => {
  expect(setCounts([{ set: 4 }, { set: 0 }, { set: 0 }]).has(0)).toBe(false);
});

// speed-model.mjs used to define its own copy. It re-exports this one, so the two cannot drift —
// a stronger claim than "both happen to pass the same tests today", and the only one a reference
// check can make.
test("speed-model re-exports THIS setCounts rather than a second copy", () => {
  expect(setCountsFromSpeedModel).toBe(setCounts);
});
