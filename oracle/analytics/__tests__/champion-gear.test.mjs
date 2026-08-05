// oracle/analytics/__tests__/champion-gear.test.mjs
import { test, expect } from "vitest";
import { CHAMP_ROLE, CHAMP_ROLE_LABEL, champRole, quantile, inReplacementPool, bucketKeyFor } from "../champion-gear.mjs";

// Minimal Champs row: an Attack champion unless overridden.
const champ = (o = {}) => ({ ID: 110, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60, ...o });

test("champRole maps the four Champs.Role values onto the analytics archetypes", () => {
  expect(champRole(champ({ Role: 0 }))).toBe("ATK-DPS");
  expect(champRole(champ({ Role: 1 }))).toBe("DEF-DPS");
  expect(champRole(champ({ Role: 2 }))).toBe("HP-DPS");
  expect(champRole(champ({ Role: 3 }))).toBe("Support");
});

test("champRole returns null for an unrecognised Role", () => {
  expect(champRole(champ({ Role: 9 }))).toBe(null);
  expect(champRole(champ({ Role: -1 }))).toBe(null);
});

// A SQL NULL Role is unrecognised, not Attack — the column carries no NOT NULL constraint, and a
// silent fallback to role 0 would grade the champion against the wrong archetype.
test("champRole returns null for a missing or null Role", () => {
  expect(champRole(champ({ Role: null }))).toBe(null);
  expect(champRole(champ({ Role: undefined }))).toBe(null);
  expect(champRole({ ID: 999, Name: "No role column" })).toBe(null);
});

test("CHAMP_ROLE covers exactly the four archetypes", () => {
  expect(Object.values(CHAMP_ROLE).sort())
    .toEqual(["ATK-DPS", "DEF-DPS", "HP-DPS", "Support"]);
});

// The two maps are hand-maintained in parallel and indexed by the same Role value.
test("CHAMP_ROLE_LABEL is keyed in lockstep with CHAMP_ROLE", () => {
  expect(Object.keys(CHAMP_ROLE_LABEL)).toEqual(Object.keys(CHAMP_ROLE));
});

test("quantile is index-based and handles degenerate inputs", () => {
  expect(quantile([], 0.5)).toBe(0);
  expect(quantile([7], 0.5)).toBe(7);
  expect(quantile([7], 0)).toBe(7);
  expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
  expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
});

test("quantile sorts an unordered input without mutating it", () => {
  const xs = [3, 1, 2];
  expect(quantile(xs, 0.5)).toBe(2); // fails if the implementation drops its sort
  expect(xs).toEqual([3, 1, 2]);
});

// Minimal decoded item: an unequipped, demanded-set, SPD-main boots unless overridden.
const gear = (o = {}) => ({
  id: 1, slot: 4, set: 66, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, mainStat: { statId: 4, isFlat: true, value: 45 },
  substats: [], ascLevel: -1, equippedChampId: 0, ...o,
});
// An accessory (Ring) on faction 2.
const acc = (o = {}) => gear({
  slot: 7, isAccessory: true, faction: 2, mainStat: { statId: 2, isFlat: true, value: 265 }, ...o,
});

test("inReplacementPool: accepts an unequipped demanded-set spare with the same slot and main", () => {
  expect(inReplacementPool(gear({ id: 2 }), gear())).toBe(true);
});

test("inReplacementPool: rejects equipped spares, other slots, and other main stats", () => {
  expect(inReplacementPool(gear({ id: 2, equippedChampId: 55 }), gear())).toBe(false);
  expect(inReplacementPool(gear({ id: 2, slot: 5 }), gear())).toBe(false);
  expect(inReplacementPool(gear({ id: 2, mainStat: { statId: 1, isFlat: false, value: 60 } }), gear()))
    .toBe(false);
});

test("inReplacementPool: same stat id but different isFlat is a different main", () => {
  const flat = gear({ mainStat: { statId: 2, isFlat: true, value: 265 } });
  const pct = gear({ id: 2, mainStat: { statId: 2, isFlat: false, value: 60 } });
  expect(inReplacementPool(pct, flat)).toBe(false);
});

test("inReplacementPool: rejects spares on low-demand sets", () => {
  expect(inReplacementPool(gear({ id: 2, set: 9 }), gear())).toBe(false);   // Lifesteal, premium 1
  expect(inReplacementPool(gear({ id: 2, set: 44 }), gear())).toBe(false);  // Guardian, premium 1
  expect(inReplacementPool(gear({ id: 2, set: 29 }), gear())).toBe(true);   // Cruel, premium 6
});

test("inReplacementPool: accessories are faction-locked, artifacts are not", () => {
  expect(inReplacementPool(acc({ id: 2, faction: 2 }), acc())).toBe(true);
  expect(inReplacementPool(acc({ id: 2, faction: 3 }), acc())).toBe(false);
  // artifacts ignore faction entirely
  expect(inReplacementPool(gear({ id: 2, faction: 3 }), gear({ faction: 2 }))).toBe(true);
});

test("bucketKeyFor: two items share a key iff inReplacementPool accepts them for each other", () => {
  const base = gear();
  const same = gear({ id: 2 });
  const otherSlot = gear({ id: 3, slot: 5 });
  const otherMain = gear({ id: 4, mainStat: { statId: 1, isFlat: false, value: 60 } });
  expect(bucketKeyFor(same)).toBe(bucketKeyFor(base));
  expect(bucketKeyFor(otherSlot)).not.toBe(bucketKeyFor(base));
  expect(bucketKeyFor(otherMain)).not.toBe(bucketKeyFor(base));
});

test("bucketKeyFor: faction participates for accessories only", () => {
  expect(bucketKeyFor(acc({ faction: 3 }))).not.toBe(bucketKeyFor(acc({ faction: 2 })));
  expect(bucketKeyFor(gear({ faction: 3 }))).toBe(bucketKeyFor(gear({ faction: 2 })));
});

// The "other main stats" case above moves statId and isFlat together, so nothing pins the statId
// clause on its own. This is the implementation comment's own example held at a fixed isFlat: a
// C.DMG glove must not be replaced by an HP glove, and both of those mains are percentages.
test("inReplacementPool: a different stat id at the same isFlat is a different main", () => {
  const cdmg = gear({ slot: 3, mainStat: { statId: 6, isFlat: false, value: 60 } });
  const hpPct = gear({ id: 2, slot: 3, mainStat: { statId: 1, isFlat: false, value: 60 } });
  expect(inReplacementPool(hpPct, cdmg)).toBe(false);
});

// The "iff" claimed above, checked exhaustively rather than on three hand-picked items. This is
// the invariant Task 4's bucketed index rests on. Every item here is unequipped and on a demanded
// set, so the two candidate-only clauses hold throughout and the equivalence is exact.
test("bucketKeyFor agrees with inReplacementPool over every slot/main/faction combination", () => {
  const matrix = [];
  for (const slot of [4, 7]) {                 // one artifact, one accessory
    for (const statId of [2, 4]) {
      for (const isFlat of [true, false]) {
        for (const faction of [2, 3]) {
          matrix.push(gear({
            id: matrix.length + 1, slot, faction, isAccessory: slot >= 7,
            mainStat: { statId, isFlat, value: 1 },
          }));
        }
      }
    }
  }
  expect(matrix.length).toBe(16);

  let accepted = 0;
  for (const a of matrix) {
    for (const b of matrix) {
      const sameKey = bucketKeyFor(a) === bucketKeyFor(b);
      expect(sameKey, `${bucketKeyFor(a)} vs ${bucketKeyFor(b)}`).toBe(inReplacementPool(a, b));
      if (sameKey) accepted++;
    }
  }
  // Non-degenerate, and both branches occur: the 8 artifacts form 4 main-stat groups of 2 (faction
  // is not in their key) = 16 ordered pairs; the 8 accessories each match only themselves = 8.
  expect(accepted).toBe(24);
});
