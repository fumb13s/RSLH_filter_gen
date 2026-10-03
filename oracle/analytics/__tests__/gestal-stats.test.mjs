// oracle/analytics/__tests__/gestal-stats.test.mjs
//
// gestalChampStats: Gestal's per-champion stat records -> the champion stat model's inputs. Every
// fixture here is synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds
// personal account data and never belongs in the repo.
import { expect, test } from "vitest";
import { FORMAT, FORMAT_VERSION, gestalChampStats } from "../gestal.mjs";

// --- fixtures -----------------------------------------------------------------

// A Gestal champion record carrying the three stat fields gestalChampRows ignores. The bonus
// shapes are the ones a real capture shows: HP/ATK/DEF flat or %, SPD flat (or % from sets),
// RES and ACC always flat, C.RATE and C.DMG always fractions.
function champion(o = {}) {
  return {
    heroId: 100, typeId: 1496, baseTypeId: 1490, grade: 6, level: 60, empowerLevel: 0,
    blessingId: null, factionId: 2, rarityId: 3, roleId: 0, name: "Elhain", awakenLevel: 2,
    baseStats: { hp: 15000, atk: 1000, def: 900, spd: 100, crate: 15, cdmg: 50, res: 30, acc: 0 },
    loreOfSteelMultiplier: 0.15,
    bonusesV2: {
      sets: [{ statKindId: 2, isAbsolute: false, value: 0.15 }],
      mastery: [{ statKindId: 4, isAbsolute: true, value: 8 }],
      blessing: [{ statKindId: 5, isAbsolute: true, value: 40 }],
      relic: [{ statKindId: 6, isAbsolute: true, value: 50 }],
      empower: null,
      factionGuardian: [{ statKindId: 1, isAbsolute: true, value: 2000 }],
    },
    ...o,
  };
}

const doc = (schemaVersion, payload) => ({ schemaVersion, payload });

function snapshotOf(champions = [champion()]) {
  return {
    format: FORMAT, formatVersion: FORMAT_VERSION, capturedAt: "2026-09-29T12:05:00Z",
    gestalVersion: "0.8.15",
    documents: {
      artifacts: doc(2, { extractedAt: "2026-09-29T12:00:00Z", gameVersion: "11.75.0", artifacts: [] }),
      champions: doc(2, { extractedAt: "2026-09-29T12:00:30Z", gameVersion: "11.75.0", champions }),
    },
  };
}

// The one champion of a one-champion snapshot.
const only = (o = {}) => gestalChampStats(snapshotOf([champion(o)])).get(100);

// --- base -----------------------------------------------------------------------

test("base renames Gestal's lower-case stat fields onto the model's stat names", () => {
  expect(only().base).toEqual({
    HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0,
  });
});

// crate/cdmg are already percentage POINTS in baseStats (15 and 50), unlike the bonusesV2
// fractions below. Copying them as-is is the whole rule; scaling them would be a silent x100.
test("base copies the crit fields as points rather than scaling them", () => {
  const base = only({ baseStats: { hp: 1, atk: 1, def: 1, spd: 1, crate: 15, cdmg: 50, res: 1, acc: 1 } }).base;
  expect(base["C.RATE"]).toBe(15);
  expect(base["C.DMG"]).toBe(50);
});

test("a champion with no baseStats is named rather than silently read as zeroes", () => {
  expect(() => only({ baseStats: undefined })).toThrow(/champion Elhain 100 has no baseStats/);
});

// --- sources ----------------------------------------------------------------------

// The five per-source breakdowns, in set-bonuses.mjs's key space. The statKindId enum here is
// the GAME's (1 HP, 2 ATK, 3 DEF, 4 SPD, 5 RES, 6 ACC, 7 C.RATE, 8 C.DMG), which agrees with our
// item stat ids on 1-4 and disagrees on 5-8.
test("sources carries the five bonus breakdowns as [key, value] pairs", () => {
  expect(only().sources).toEqual({
    mastery: [["SPD", 8]],
    blessing: [["RES", 40]],
    relic: [["ACC", 50]],
    empower: [],
    factionGuardian: [["HP", 2000]],
  });
});

test("an absolute bonus takes the flat key and keeps its value", () => {
  const src = (statKindId, value) => ({ bonusesV2: { mastery: [{ statKindId, isAbsolute: true, value }] } });
  expect(only(src(1, 2000)).sources.mastery).toEqual([["HP", 2000]]);
  expect(only(src(2, 150)).sources.mastery).toEqual([["ATK", 150]]);
  expect(only(src(3, 120)).sources.mastery).toEqual([["DEF", 120]]);
  expect(only(src(4, 8)).sources.mastery).toEqual([["SPD", 8]]);
  expect(only(src(5, 40)).sources.mastery).toEqual([["RES", 40]]);
  expect(only(src(6, 50)).sources.mastery).toEqual([["ACC", 50]]);
});

// Gestal stores a relative bonus as a FRACTION. The model's key space is percentage points, so
// every one of these is x100.
test("a relative HP/ATK/DEF/SPD bonus becomes a percent key scaled by 100", () => {
  const src = (statKindId, value) => ({ bonusesV2: { mastery: [{ statKindId, isAbsolute: false, value }] } });
  expect(only(src(1, 0.15)).sources.mastery).toEqual([["HP%", 15]]);
  expect(only(src(2, 0.15)).sources.mastery).toEqual([["ATK%", 15]]);
  expect(only(src(3, 0.1)).sources.mastery).toEqual([["DEF%", 10]]);
  expect(only(src(4, 0.12)).sources.mastery).toEqual([["SPD%", 12]]);
});

// C.RATE and C.DMG are percentage POINTS, not percentages of a base, so the x100 turns Gestal's
// fraction into the number the screen shows and nothing scales it again later.
test("a crit bonus is a fraction that becomes points, keeping the unsuffixed key", () => {
  const src = (statKindId, value) => ({ bonusesV2: { mastery: [{ statKindId, isAbsolute: false, value }] } });
  expect(only(src(7, 0.12)).sources.mastery).toEqual([["C.RATE", 12]]);
  expect(only(src(8, 0.3)).sources.mastery).toEqual([["C.DMG", 30]]);
});

// Gestal's fractions carry float noise: 0.0799999998 is how it stores 8%.
test("a fraction scaled to points is rounded to two decimals, clearing Gestal's float noise", () => {
  const src = (value) => ({ bonusesV2: { mastery: [{ statKindId: 1, isAbsolute: false, value }] } });
  expect(only(src(0.0799999998)).sources.mastery).toEqual([["HP%", 8]]);
  expect(only(src(0.12345)).sources.mastery).toEqual([["HP%", 12.35]]);
});

test("a source that is null or missing reads as an empty list", () => {
  expect(only({ bonusesV2: { mastery: null, relic: undefined } }).sources)
    .toEqual({ mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] });
});

test("a champion with no bonusesV2 at all reads as five empty lists", () => {
  expect(only({ bonusesV2: undefined }).sources)
    .toEqual({ mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] });
});

// --- shapes the adapter refuses -----------------------------------------------------
//
// Guessing a meaning for an unseen shape would put wrong numbers on the Total Stats screen
// silently. Refusing makes the next Gestal change visible, as it does for item stat ids.

test("an unknown stat kind is refused, naming the champion and the source", () => {
  const bad = { bonusesV2: { relic: [{ statKindId: 9, isAbsolute: true, value: 1 }] } };
  expect(() => only(bad)).toThrow(/unknown Gestal stat kind 9/);
  expect(() => only(bad)).toThrow(/relic bonus of champion Elhain 100/);
});

// RES and ACC arrive flat on every capture seen. A relative one would mean a percentage of a base
// the model has no rule for.
test("a relative RES or ACC bonus is refused rather than read as a percentage", () => {
  expect(() => only({ bonusesV2: { blessing: [{ statKindId: 5, isAbsolute: false, value: 0.4 }] } }))
    .toThrow(/relative Gestal stat kind 5 \(blessing bonus of champion Elhain 100\)/);
  expect(() => only({ bonusesV2: { blessing: [{ statKindId: 6, isAbsolute: false, value: 0.4 }] } }))
    .toThrow(/relative Gestal stat kind 6/);
});

// The mirror: both crits arrive as fractions. An absolute one would already be in points, and
// scaling it would be a silent x100.
test("an absolute C.RATE or C.DMG bonus is refused rather than read as points", () => {
  expect(() => only({ bonusesV2: { mastery: [{ statKindId: 7, isAbsolute: true, value: 15 }] } }))
    .toThrow(/absolute Gestal stat kind 7 \(mastery bonus of champion Elhain 100\)/);
  expect(() => only({ bonusesV2: { mastery: [{ statKindId: 8, isAbsolute: true, value: 50 }] } }))
    .toThrow(/absolute Gestal stat kind 8/);
});

test("every refusal ends in the adapter's standard advice", () => {
  expect(() => only({ bonusesV2: { relic: [{ statKindId: 9, isAbsolute: true, value: 1 }] } }))
    .toThrow(/— the adapter needs updating$/);
});

// --- observedSets -------------------------------------------------------------------
//
// The game's OWN set bonus for this copy's current gear, which a later power.mjs verify compares
// against the set table. A Map rather than a list, so diffSetBonuses can read it directly.

test("observedSets is a Map in the same key space as setBonusTotals", () => {
  const sets = only().observedSets;
  expect(sets).toBeInstanceOf(Map);
  expect(Object.fromEntries(sets)).toEqual({ "ATK%": 15 });
});

// SPD% is the one key that reaches us from sets alone — no ITEM grants it, so it never appears in
// the other four sources.
test("observedSets carries SPD% from a set bonus", () => {
  const spd = { bonusesV2: { sets: [{ statKindId: 4, isAbsolute: false, value: 0.12 }] } };
  expect(Object.fromEntries(only(spd).observedSets)).toEqual({ "SPD%": 12 });
});

test("observedSets sums a key Gestal lists twice rather than keeping the last", () => {
  const twice = { bonusesV2: { sets: [
    { statKindId: 1, isAbsolute: false, value: 0.15 },
    { statKindId: 1, isAbsolute: false, value: 0.08 },
  ] } };
  expect(Object.fromEntries(only(twice).observedSets)).toEqual({ "HP%": 23 });
});

test("observedSets is empty when the copy wears no set, and refuses an unknown shape", () => {
  expect(only({ bonusesV2: { sets: null } }).observedSets.size).toBe(0);
  expect(() => only({ bonusesV2: { sets: [{ statKindId: 9, isAbsolute: true, value: 1 }] } }))
    .toThrow(/unknown Gestal stat kind 9 \(sets bonus of champion Elhain 100\)/);
});

// --- loreOfSteel and awaken -----------------------------------------------------------

// 0.15 when the mastery is taken, 0 otherwise. Four decimals is well past the precision the
// multiplier is stored at and clears the same float noise the bonus fractions carry.
test("loreOfSteel is the multiplier, rounded to four decimals", () => {
  expect(only().loreOfSteel).toBe(0.15);
  expect(only({ loreOfSteelMultiplier: 0.1500000001 }).loreOfSteel).toBe(0.15);
  expect(only({ loreOfSteelMultiplier: 0.123456789 }).loreOfSteel).toBe(0.1235);
});

// A champion without the mastery must scale set bonuses by zero, not by undefined — which would
// make every Masteries column NaN.
test("a null or missing loreOfSteelMultiplier reads as 0", () => {
  expect(only({ loreOfSteelMultiplier: null }).loreOfSteel).toBe(0);
  expect(only({ loreOfSteelMultiplier: undefined }).loreOfSteel).toBe(0);
});

test("awaken is the copy's awaken level", () => {
  expect(only().awaken).toBe(2);
  expect(only({ awakenLevel: 0 }).awaken).toBe(0);
});

// --- the whole record and the Map ------------------------------------------------------

test("one champion decodes to the whole record, keyed by heroId", () => {
  expect(only()).toEqual({
    base: { HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 },
    sources: {
      mastery: [["SPD", 8]],
      blessing: [["RES", 40]],
      relic: [["ACC", 50]],
      empower: [],
      factionGuardian: [["HP", 2000]],
    },
    observedSets: new Map([["ATK%", 15]]),
    loreOfSteel: 0.15,
    awaken: 2,
  });
});

test("every champion in the roster document gets an entry, keyed by its heroId", () => {
  const snap = snapshotOf([champion(), champion({ heroId: 200, name: "Kael" })]);
  const stats = gestalChampStats(snap);
  expect([...stats.keys()]).toEqual([100, 200]);
  expect(stats.get(200).base.HP).toBe(15000);
});

test("an empty roster gives an empty Map rather than throwing", () => {
  expect(gestalChampStats(snapshotOf([])).size).toBe(0);
});
