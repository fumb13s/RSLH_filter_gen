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
