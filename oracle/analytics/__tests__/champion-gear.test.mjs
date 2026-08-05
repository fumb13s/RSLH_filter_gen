// oracle/analytics/__tests__/champion-gear.test.mjs
import { test, expect } from "vitest";
import { CHAMP_ROLE, CHAMP_ROLE_LABEL, champRole, quantile, inReplacementPool, bucketKeyFor, buildPoolIndex, betterCount, roleGap } from "../champion-gear.mjs";
import { subMax } from "../rolls.mjs";
import { qualityAtRole } from "../score.mjs";
import { CUTS } from "../weights.mjs";

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

// ceilingOf stub: read the ceiling straight off a `ceil` property on the test item.
const ceilOf = (it) => it.ceil;

test("buildPoolIndex: only unequipped demanded-set spares get indexed, ceilings ascending", () => {
  const items = [
    gear({ id: 1, ceil: 90 }),
    gear({ id: 2, ceil: 70 }),
    gear({ id: 3, ceil: 80 }),
    gear({ id: 4, ceil: 99, equippedChampId: 55 }),  // equipped -> excluded
    gear({ id: 5, ceil: 99, set: 9 }),               // Lifesteal, premium 1 -> excluded
  ];
  const idx = buildPoolIndex(items, ceilOf);
  expect(idx.get(bucketKeyFor(gear()))).toEqual([70, 80, 90]);
});

test("buildPoolIndex: separates buckets by slot, main stat and accessory faction", () => {
  const items = [
    gear({ id: 1, ceil: 50 }),
    gear({ id: 2, ceil: 60, slot: 5 }),
    acc({ id: 3, ceil: 70, faction: 2 }),
    acc({ id: 4, ceil: 80, faction: 3 }),
  ];
  const idx = buildPoolIndex(items, ceilOf);
  expect(idx.get(bucketKeyFor(gear()))).toEqual([50]);
  expect(idx.get(bucketKeyFor(gear({ slot: 5 })))).toEqual([60]);
  expect(idx.get(bucketKeyFor(acc({ faction: 2 })))).toEqual([70]);
  expect(idx.get(bucketKeyFor(acc({ faction: 3 })))).toEqual([80]);
});

test("betterCount: counts strictly higher ceilings, ties excluded", () => {
  const idx = buildPoolIndex(
    [70, 80, 80, 90].map((c, i) => gear({ id: i + 1, ceil: c })), ceilOf);
  const it = gear({ id: 99 });
  expect(betterCount(idx, it, 60)).toBe(4);
  expect(betterCount(idx, it, 70)).toBe(3);   // its own tie excluded
  expect(betterCount(idx, it, 80)).toBe(1);   // both 80s excluded
  expect(betterCount(idx, it, 90)).toBe(0);
  expect(betterCount(idx, it, 95)).toBe(0);
});

test("betterCount: an empty or missing bucket means zero upgrade paths", () => {
  const idx = buildPoolIndex([], ceilOf);
  expect(betterCount(idx, gear(), 10)).toBe(0);
});

test("betterCount agrees with a brute-force scan over inReplacementPool", () => {
  const pool = [];
  for (let i = 0; i < 40; i++) {
    pool.push(gear({
      id: i + 1,
      ceil: (i * 7) % 100,
      slot: i % 3 === 0 ? 5 : 4,
      set: i % 5 === 0 ? 9 : 66,
      equippedChampId: i % 7 === 0 ? 55 : 0,
    }));
  }
  const idx = buildPoolIndex(pool, ceilOf);
  const target = gear({ id: 999, ceil: 50 });
  const brute = pool.filter((c) => inReplacementPool(c, target) && ceilOf(c) > 50).length;
  expect(betterCount(idx, target, 50)).toBe(brute);
});

// The tie test above probes a 4-element bucket at 5 thresholds, which is too coarse to pin the
// binary search: an off-by-one (`hi = mid - 1`) agrees on all five and still miscounts elsewhere.
// Sweep every threshold over a longer bucket with duplicates and gaps against the naive scan the
// search stands in for.
test("betterCount matches a naive scan at every threshold", () => {
  const ceilings = [10, 20, 20, 30, 40, 55, 55, 55, 70, 90, 91, 92, 100];
  const idx = buildPoolIndex(ceilings.map((c, i) => gear({ id: i + 1, ceil: c })), ceilOf);
  const it = gear({ id: 999 });
  for (let c = -5; c <= 105; c++) {
    expect(betterCount(idx, it, c), `ceiling ${c}`).toBe(ceilings.filter((x) => x > c).length);
  }
});

// Ceilings must be read THROUGH the callback: Task 6 passes the level-independent quality score,
// which is computed, not a column on the row. `ceilOf` is identity on `ceil`, so it can't tell a
// hardcoded `it.ceil` apart from a real call — this reads a different property so it can. The
// reversed input order also pins the sort as applying to the callback's output.
test("buildPoolIndex reads ceilings through the ceilingOf callback", () => {
  const items = [gear({ id: 1, ceil: 10, score: 80 }), gear({ id: 2, ceil: 20, score: 60 })];
  const idx = buildPoolIndex(items, (it) => it.score);
  expect(idx.get(bucketKeyFor(gear()))).toEqual([60, 80]);
});

// CUTS.focusPremium is 4 and sets sit exactly on it (19, 39, 42, ...), so the demanded-set cut is
// inclusive at a live value. Every other test here uses premium 1 or 8, which leaves the boundary
// free to slip by one and silently drop a whole class of demanded sets out of the pool.
test("buildPoolIndex admits sets exactly at the premium cut", () => {
  const items = [
    gear({ id: 1, ceil: 50, set: 19 }),  // premium 4 == focusPremium -> indexed
    gear({ id: 2, ceil: 60, set: 15 }),  // premium 2 -> excluded
  ];
  expect(buildPoolIndex(items, ceilOf).get(bucketKeyFor(gear()))).toEqual([50]);
});

// a substat at a fraction of its theoretical max
const sub = (statId, isFlat, frac = 1) =>
  ({ statId, isFlat, rolls: 4, value: subMax(statId, isFlat) * frac, glyph: 0 });

// frac 0.5, not 0.9: both score components are Math.min(1, ...)-capped, so subs at 0.9 of their
// THEORETICAL max saturate this piece at 100 for HP-DPS as well as Support, and roleGap's strict `>`
// then reports the earlier of the tied roles. 0.5 keeps Support the outright best (99 vs 80).
test("roleGap: support-statted gear on an Attack champion flags above the threshold", () => {
  const it = gear({ set: 4, substats: [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)] });
  const rg = roleGap(it, "ATK-DPS");                 // RES / ACC / HP% on a SPD-main boots
  expect(rg.bestRole).toBe("Support");
  expect(rg.gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);
});

test("roleGap: crit gear on an Attack champion does not flag", () => {
  const it = gear({ set: 4, substats: [sub(5, false, 0.9), sub(6, false, 0.9), sub(2, false, 0.9)] });
  const rg = roleGap(it, "ATK-DPS");                 // C.RATE / C.DMG / ATK%
  expect(rg.gap).toBeLessThan(CUTS.roleGapFlag);
});

test("roleGap: gap is zero when the champion's role IS the item's best role", () => {
  const it = gear({ set: 4, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] });
  const rg = roleGap(it, "ATK-DPS");
  expect(rg.gap).toBe(0);
  expect(rg.bestRole).toBe("ATK-DPS");
  expect(typeof rg.atChampRole).toBe("number");
});

test("roleGap: returns null when the champion's role is unknown", () => {
  expect(roleGap(gear(), null)).toBe(null);
});

test("CUTS carries the gear thresholds", () => {
  expect(CUTS.gearKeepQuantile).toBe(0.50);
  expect(CUTS.gearSellQuantile).toBe(0.75);
  expect(CUTS.roleGapFlag).toBe(10);
});

// The three gear thresholds were appended to a CUTS literal that triage.mjs and analyze.mjs read
// too, so the whole line was rewritten. Nothing above pins the cuts that were already there, and a
// perturbed one is invisible to the rest of the suite: focusPremium 4 -> 3 leaves all 12 analytics
// files green while quietly widening the vault report's demanded-set pool.
test("CUTS still carries the vault-report cuts it had before the gear thresholds", () => {
  expect(CUTS).toMatchObject({
    junkKeepFrac: 0.30, junkKeepFloor: 4, lowPremium: 2, focusPremium: 4,
    focusPerGroup: 2, upgradeMaxLevel: 12, balanceFactor: 1,
  });
});

// THE design point of this function: the max ranges over all four archetypes, NOT over the roles
// the item's SET is annotated for — the flag is a claim about the item's stats, not its set. Every
// test above uses set 4 (Speed, annotated "All"), where the two are the same set of roles, so
// scoring via the set annotation instead would pass all of them. These sets are single-role.
test("roleGap ranges over all four roles, ignoring the set's role annotation", () => {
  const supportSubs = [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)];
  const onOffense = roleGap(gear({ set: 2, substats: supportSubs }), "ATK-DPS");   // set 2 -> ATK-DPS only
  expect(onOffense.bestRole).toBe("Support");
  expect(onOffense.gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);

  const critSubs = [sub(5, false, 0.5), sub(6, false, 0.5), sub(2, false, 0.5)];
  const onAccuracy = roleGap(gear({ set: 7, substats: critSubs }), "Support");     // set 7 -> Support only
  expect(onAccuracy.bestRole).toBe("ATK-DPS");
  expect(onAccuracy.gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);

  // Same stats, three differently-annotated sets, one identical answer.
  for (const set of [4, 2, 7]) {
    expect(roleGap(gear({ set, substats: supportSubs }), "ATK-DPS"), `set ${set}`).toEqual(onOffense);
  }
});

// `typeof rg.atChampRole === "number"` above holds for any number, so nothing says WHICH score this
// is — returning best.score in that field satisfies every other assertion in this file.
test("roleGap: atChampRole is the score at the champion's role, not at the best role", () => {
  const it = gear({ set: 4, substats: [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)] });
  const rg = roleGap(it, "ATK-DPS");
  expect(rg.gap).toBeGreaterThan(0);            // else the two scores coincide and prove nothing
  expect(rg.atChampRole).toBe(qualityAtRole(it, "ATK-DPS"));
  expect(rg.atChampRole + rg.gap).toBe(qualityAtRole(it, rg.bestRole));
});

// A null role must short-circuit, not score and discard. Today scoring a null role happens to throw
// on WEIGHTS[null], so `toBe(null)` catches a moved guard only by accident — this pins it directly.
test("roleGap: a null champion role does no scoring work at all", () => {
  let reads = 0;
  const spy = gear();
  Object.defineProperty(spy, "mainStat",
    { get() { reads++; return { statId: 4, isFlat: true, value: 45 }; } });

  expect(roleGap(spy, null)).toBe(null);
  expect(reads).toBe(0);                        // scoring reads mainStat first thing
  expect(roleGap(spy, "ATK-DPS").atChampRole).toBeGreaterThan(0);
  expect(reads).toBeGreaterThan(0);             // ...and the spy does register that, so 0 meant it
});

// Judged as BUILT, not at its potential: qualityAtRole's `potential` flag scores stat TYPES only,
// and CUTS.roleGapFlag is calibrated against the as-built distribution. These two pieces carry the
// identical support stat types on an Attack champion; only the rolled values differ, and only the
// rolled one is miscast enough to matter. Scored on types alone both would read the same gap.
test("roleGap scores the piece as built, not at its potential", () => {
  const barely = gear({ set: 4, substats: [sub(7, true, 0.1), sub(8, true, 0.1), sub(1, false, 0.1)] });
  expect(roleGap(barely, "ATK-DPS").gap).toBeLessThan(CUTS.roleGapFlag);
  const rolled = gear({ set: 4, substats: [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)] });
  expect(roleGap(rolled, "ATK-DPS").gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);
});

// A tie is not a miscast, so the wearer's own role must win it. The tie here is structural, not a
// saturation artefact: with only C.RATE/C.DMG subs under a SPD main, the three DPS roles weight
// every stat present identically. The zero-gap test above ties too, but only for an ATK-DPS
// champion — which is already ALL_ROLES[0], so seeding `best` from the role list instead of from
// the champion passes it. Sweeping all three tied roles is what pins the tie-break.
test("roleGap: a tie among equal-scoring roles resolves to the champion's own role", () => {
  const it = gear({ set: 4, substats: [sub(5, false, 0.5), sub(6, false, 0.5)] });
  expect(qualityAtRole(it, "ATK-DPS")).toBe(qualityAtRole(it, "HP-DPS"));  // the tie is real
  expect(qualityAtRole(it, "ATK-DPS")).toBeLessThan(100);                  // and not the score cap
  for (const role of ["ATK-DPS", "DEF-DPS", "HP-DPS"]) {
    expect(roleGap(it, role).bestRole, role).toBe(role);
    expect(roleGap(it, role).gap, role).toBe(0);
  }
});
