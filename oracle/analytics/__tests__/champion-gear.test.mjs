// oracle/analytics/__tests__/champion-gear.test.mjs
import { test, expect } from "vitest";
import { CHAMP_ROLE, CHAMP_ROLE_LABEL, champRole, quantile, inReplacementPool, bucketKeyFor, buildPoolIndex, betterCount, roleGap, verdictFor, resolveCuts, buildContext, rateItem, analyzeChampionGear } from "../champion-gear.mjs";
import { subMax } from "../rolls.mjs";
import { quality, qualityAtRole } from "../score.mjs";
import { rollStats } from "../rollquality.mjs";
import { keepPremium } from "../triage.mjs";
import { ALL_ROLES } from "../sets.mjs";
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
// scoring via the set annotation instead would pass all of them. These sets are strict subsets.
test("roleGap ranges over all four roles, ignoring the set's role annotation", () => {
  const supportSubs = [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)];
  const onOffense = roleGap(gear({ set: 2, substats: supportSubs }), "ATK-DPS");   // set 2 -> ATK-DPS only
  expect(onOffense.bestRole).toBe("Support");
  expect(onOffense.gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);

  const critSubs = [sub(5, false, 0.5), sub(6, false, 0.5), sub(2, false, 0.5)];
  const onAccuracy = roleGap(gear({ set: 7, substats: critSubs }), "Support");     // set 7 -> Support only
  expect(onAccuracy.bestRole).toBe("ATK-DPS");
  expect(onAccuracy.gap).toBeGreaterThanOrEqual(CUTS.roleGapFlag);

  // Same stats, five differently-annotated sets, one identical answer. 29 (Cruel, the three DPS
  // roles) is the subtlest and the commonest annotation shape: restricted to those three, this
  // piece still reads gap 13 and would clear the flag anyway — only bestRole gives it away.
  for (const set of [4, 2, 7, 29, 44]) {
    expect(roleGap(gear({ set, substats: supportSubs }), "ATK-DPS"), `set ${set}`).toEqual(onOffense);
  }
});

// bestRole is the argmax, checked without reference to ALL_ROLES' ORDER (see the tie test below for
// the one ordering rule that is real: the wearer wins its own tie). Math.max over the four scores
// is an independent path to the same answer as roleGap's running accumulator.
test("roleGap: bestRole and gap agree with the max over the four roles, for any wearer", () => {
  const items = [
    gear({ set: 4, substats: [sub(7, true, 0.5), sub(8, true, 0.5), sub(1, false, 0.5)] }),
    gear({ set: 4, substats: [sub(5, false, 0.5), sub(6, false, 0.5), sub(2, false, 0.5)] }),
    gear({ slot: 3, set: 29, mainStat: { statId: 6, isFlat: false, value: 60 },
      substats: [sub(4, true, 0.4), sub(3, false, 0.6)] }),
    gear(),                                                   // no substats at all
  ];
  for (const it of items) {
    for (const role of ALL_ROLES) {
      const rg = roleGap(it, role);
      const top = Math.max(...ALL_ROLES.map((r) => qualityAtRole(it, r)));
      expect(rg.atChampRole + rg.gap, `${role}`).toBe(top);
      expect(qualityAtRole(it, rg.bestRole), `${role}`).toBe(top);
      expect(rg.gap, `${role}`).toBeGreaterThanOrEqual(0);
    }
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

// --- verdict, cut resolution, context ---------------------------------------

const cuts = { keepCut: 10, sellCut: 50 };

test("verdictFor: KEEP at/below keepCut, SELL at/above sellCut, BORDERLINE between", () => {
  const v = (better) => verdictFor({ triageVerdict: "keep", triageReason: "keep", better }, cuts).verdict;
  expect(v(0)).toBe("KEEP");
  expect(v(10)).toBe("KEEP");          // boundary is inclusive
  expect(v(11)).toBe("BORDERLINE");
  expect(v(49)).toBe("BORDERLINE");
  expect(v(50)).toBe("SELL");          // boundary is inclusive
  expect(v(400)).toBe("SELL");
});

test("verdictFor: a triage delete overrides even zero upgrade paths", () => {
  const r = verdictFor({
    triageVerdict: "delete",
    triageReason: "setless: dominated by a set accessory in the same faction + slot",
    better: 0,
  }, cuts);
  expect(r.verdict).toBe("SELL");
  expect(r.reason).toContain("setless");
});

// The override has to precede BOTH cut branches, not just the KEEP one. At a count in the SELL band
// the verdict comes back SELL either way and only the REASON gives the ordering away, so demoting
// the override to (say) the BORDERLINE fallthrough is invisible to the test above.
test("verdictFor: a triage delete keeps its own reason in every band", () => {
  const condemned = "setless: dominated by a set accessory in the same faction + slot";
  for (const better of [0, 10, 11, 49, 50, 400]) {
    const r = verdictFor({ triageVerdict: "delete", triageReason: condemned, better }, cuts);
    expect(r.verdict, `better ${better}`).toBe("SELL");
    expect(r.reason, `better ${better}`).toBe(`triage: ${condemned}`);
  }
});

test("verdictFor: reason names the upgrade-path count, singular for one", () => {
  expect(verdictFor({ triageVerdict: "keep", triageReason: "keep", better: 1 }, cuts).reason)
    .toBe("1 upgrade path");
  expect(verdictFor({ triageVerdict: "keep", triageReason: "keep", better: 6 }, cuts).reason)
    .toBe("6 upgrade paths");
});

// ...and the same count-shaped reason in all three bands, zero included — nothing about a KEEP or a
// SELL changes what the number means.
test("verdictFor: the count is the reason in every band", () => {
  const reason = (better) => verdictFor({ triageVerdict: "keep", triageReason: "keep", better }, cuts).reason;
  expect(reason(0)).toBe("0 upgrade paths");
  expect(reason(11)).toBe("11 upgrade paths");
  expect(reason(50)).toBe("50 upgrade paths");
});

// An empty calibration population leaves keepCut = sellCut = 0, and 0 is a cut BOTH branches match:
// `better <= 0` catches only a zero count, so every piece with even one upgrade path would read
// SELL. A vault too small (or too thoroughly condemned) to calibrate must not be told to sell nearly
// everything, so a population size of 0 short-circuits to KEEP — with a reason that says calibration
// wasn't possible rather than dressing up a count as evidence.
test("verdictFor: an uncalibrated cut set keeps everything instead of selling it", () => {
  const none = resolveCuts([]);
  for (const better of [0, 1, 400]) {
    const r = verdictFor({ triageVerdict: "keep", triageReason: "keep", better }, none);
    expect(r.verdict, `better ${better}`).toBe("KEEP");
    expect(r.reason, `better ${better}`).toContain("uncalibrated");
    expect(r.reason, `better ${better}`).not.toContain("upgrade path");
  }
});

// The REACHABLE form of the same failure, and the one that matters: a sell cut of 0 needs only a
// p75 of zero, not an empty population. Any vault where three quarters of the worn, uncondemned gear
// has no strictly-better spare in its bucket lands here — normal for a small or new vault, given how
// narrow inReplacementPool is (same slot, same main, same faction for accessories, premium >= 4).
// A single upgrade path would then clear the SELL cut. Degenerate cuts have to fall to BORDERLINE.
test("verdictFor: a zero sell cut cannot condemn, however many upgrade paths there are", () => {
  for (const pop of [[60, 0], [0, 0, 0, 0, 0, 0, 5]]) {
    const c = resolveCuts(pop);
    expect(c, `${pop}`).toMatchObject({ keepCut: 0, sellCut: 0 });   // degenerate, but n > 0
    expect(c.n, `${pop}`).toBeGreaterThan(0);
    for (const better of [1, 2, 60, 400]) {
      const r = verdictFor({ triageVerdict: "keep", triageReason: "keep", better }, c);
      expect(r.verdict, `${pop} @ ${better}`).toBe("BORDERLINE");
      expect(r.reason, `${pop} @ ${better}`).toBe(`${better} upgrade path${better === 1 ? "" : "s"}`);
    }
  }
});

// ...while the KEEP signal at zero upgrade paths survives, which is why the guard sits on the SELL
// branch rather than short-circuiting the whole function: "nothing in the vault beats this" is real
// information even when the cuts themselves are degenerate.
test("verdictFor: a zero sell cut still keeps a piece with no upgrade paths", () => {
  const c = resolveCuts([60, 0]);
  expect(verdictFor({ triageVerdict: "keep", triageReason: "keep", better: 0 }, c))
    .toEqual({ verdict: "KEEP", reason: "0 upgrade paths" });
});

// The control: a positive sell cut still sells. The guard must not disable the SELL branch at large.
test("verdictFor: a calibrated population still condemns at the sell cut", () => {
  const c = resolveCuts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(c).toEqual({ keepCut: 4, sellCut: 6, n: 10 });
  const v = (better) => verdictFor({ triageVerdict: "keep", triageReason: "keep", better }, c).verdict;
  expect(v(1)).toBe("KEEP");
  expect(v(6)).toBe("SELL");
  expect(v(60)).toBe("SELL");
});

test("verdictFor: a degenerate cut set still lets a triage delete through", () => {
  const r = verdictFor({
    triageVerdict: "delete",
    triageReason: "setless: dominated by a set accessory in the same faction + slot",
    better: 60,
  }, resolveCuts([60, 0]));
  expect(r.verdict).toBe("SELL");
  expect(r.reason).toContain("setless");
});

// Why a zero sell cut can be treated as "no SELL band" rather than "sell everything": the two cuts
// are quantiles of one ascending array at p50 and p75, so the keep cut is never the higher of the
// two, and upgrade-path counts are never negative. sellCut === 0 therefore forces keepCut === 0,
// and the fall-through catches exactly the counts above zero.
test("resolveCuts never puts the keep cut above the sell cut", () => {
  const pops = [[0], [5, 5], [60, 0], [0, 0, 0, 0, 0, 0, 5], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]];
  for (let i = 0; i < 200; i++) {
    pops.push(Array.from({ length: 1 + (i % 17) }, (_, k) => (i * 7 + k * 13) % 40));
  }
  for (const pop of pops) {
    const c = resolveCuts(pop);
    expect(c.keepCut, `${pop}`).toBeLessThanOrEqual(c.sellCut);
  }
});

test("verdictFor: an uncalibrated cut set still lets a triage delete through", () => {
  const r = verdictFor({
    triageVerdict: "delete",
    triageReason: "setless: dominated by a set accessory in the same faction + slot",
    better: 0,
  }, resolveCuts([]));
  expect(r.verdict).toBe("SELL");
  expect(r.reason).toContain("setless");
});

// A hand-built cut pair carries no population size, and that is a caller saying "use these cuts" —
// not an uncalibrated vault. `cuts` above is exactly that shape, so this pins the guard to a
// population size of 0 specifically rather than to any falsy `n`.
test("verdictFor: cuts supplied without a population size are honoured", () => {
  const sell = { triageVerdict: "keep", triageReason: "keep", better: 400 };
  expect(verdictFor(sell, cuts).verdict).toBe("SELL");
  expect(verdictFor(sell, { ...cuts, n: 3 }).verdict).toBe("SELL");
});

test("resolveCuts reads the quantiles off the supplied population", () => {
  const c = resolveCuts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(c.n).toBe(10);
  expect(c.keepCut).toBe(quantile([0,1,2,3,4,5,6,7,8,9], CUTS.gearKeepQuantile));
  expect(c.sellCut).toBe(quantile([0,1,2,3,4,5,6,7,8,9], CUTS.gearSellQuantile));
});

// The assertions above are written through quantile(), which keeps them honest about WHICH quantile
// each cut is but leaves both free to move together. These are the literal values, and they also say
// the keep cut is the LOWER of the two — a swap would open a KEEP band wider than the SELL band's
// floor and inverts the middle of the distribution.
test("resolveCuts puts the keep cut below the sell cut, at the documented p50/p75", () => {
  const c = resolveCuts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(c.keepCut).toBe(4);
  expect(c.sellCut).toBe(6);
});

test("resolveCuts survives an empty population", () => {
  expect(resolveCuts([])).toEqual({ keepCut: 0, sellCut: 0, n: 0 });
});

// n is the population SIZE, not its number of distinct values: it's the flag verdictFor reads to
// decide whether the cuts mean anything, and every population above has distinct entries, so a
// de-duplicating implementation would pass them all. A one-item population is calibrated (thinly),
// not uncalibrated.
test("resolveCuts counts the whole population, duplicates included", () => {
  expect(resolveCuts([3, 3, 3]).n).toBe(3);
  expect(resolveCuts([0]).n).toBe(1);
});

// A triage() output that condemns nothing, with q at each item's own best-matching role.
const keepAll = (items) => items.map((it) => ({
  item: it, q: quality(it), percentile: 50, verdict: "keep", reason: "keep",
}));

// Ceilings are the item's POTENTIAL (level-independent, substat TYPES only), not its as-built score:
// the pool is spares that would have to be leveled, and the question is "would this finish better".
// This +4 spare carries three good substat types against the worn piece's two, so it out-ceilings it
// 92 to 79 — while as built it scores 18 against the worn piece's 100 and would count for nothing.
test("buildContext ceilings are the item's potential, not its as-built score", () => {
  const lowSpare = gear({ id: 200, level: 4, mainStat: { statId: 4, isFlat: true, value: 12 },
    substats: [sub(5, false, 0.05), sub(6, false, 0.05), sub(2, false, 0.05)] });
  const worn = gear({ id: 1, equippedChampId: 110, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] });
  const items = [lowSpare, worn];
  const ctx = buildContext(items, keepAll(items));

  expect(ctx.ceiling.get(200)).toBe(quality(lowSpare, true).score);
  expect(ctx.ceiling.get(200)).toBeGreaterThan(ctx.ceiling.get(1));       // 92 > 79 at potential
  expect(quality(lowSpare).score).toBeLessThan(quality(worn).score);      // 18 < 100 as built
  expect(betterCount(ctx.index, worn, ctx.ceiling.get(1))).toBe(1);       // so it IS an upgrade path
});

// The calibration population is EQUIPPED gear only. Folding the spares in floods it with zeros — a
// spare rarely beats its own bucket-mates — which drags both cuts to 0 and turns every worn piece
// with a single upgrade path into a SELL.
test("buildContext calibrates on equipped gear only", () => {
  const spares = [0, 1, 2, 3].map((i) =>
    gear({ id: 100 + i, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] }));  // ceiling 79 each
  const worn = gear({ id: 1, equippedChampId: 110 });                            // no subs -> 50
  const items = [...spares, worn];
  const ctx = buildContext(items, keepAll(items));

  expect(ctx.cuts).toEqual({ keepCut: 4, sellCut: 4, n: 1 });   // with the spares folded in: 0, 0, 5
  expect(rateItem(worn, ctx, "ATK-DPS").verdict).toBe("KEEP");  // ...which reads BORDERLINE instead
});

// ...and on gear the vault report hasn't already condemned. A condemned piece is on its way out;
// letting its upgrade-path count set the cuts calibrates the advice against gear being sold.
test("buildContext leaves triage-condemned gear out of the calibration population", () => {
  const spares = [0, 1, 2, 3].map((i) =>
    gear({ id: 100 + i, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] }));
  const worn = gear({ id: 1, equippedChampId: 110 });                          // better 4
  const condemned = gear({ id: 2, equippedChampId: 110, slot: 3,               // better 0 (empty bucket)
    mainStat: { statId: 6, isFlat: false, value: 80 } });
  const items = [...spares, worn, condemned];
  const scored = keepAll(items);
  Object.assign(scored.find((s) => s.item.id === 2),
    { verdict: "delete", reason: "setless: dominated by a set accessory in the same faction + slot" });
  const ctx = buildContext(items, scored);

  expect(ctx.cuts).toEqual({ keepCut: 4, sellCut: 4, n: 1 });   // with the condemned piece: 0, 0, 2
  expect(rateItem(worn, ctx, "ATK-DPS").verdict).toBe("KEEP");  // ...which reads BORDERLINE instead
});

// The other face of the empty population: nothing equipped at all, so there is nothing to calibrate
// on. This spare has 9 strictly-better bucket-mates and would read SELL against the zeroed cuts.
test("rateItem: an uncalibrated context keeps a piece the triage did not condemn", () => {
  const spares = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    gear({ id: 100 + i, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] }));
  const plain = gear({ id: 1 });
  const items = [...spares, plain];
  const ctx = buildContext(items, keepAll(items));

  expect(ctx.cuts.n).toBe(0);
  const r = rateItem(plain, ctx, "ATK-DPS");
  expect(r.better).toBe(9);
  expect(r.verdict).toBe("KEEP");
  expect(r.reason).toContain("uncalibrated");
});

// Every field here feeds a column of the CLI's output line, and nothing else in this file reads one.
test("rateItem carries the triage row's own numbers through", () => {
  const worn = gear({ id: 1, equippedChampId: 110, set: 29,
    substats: [sub(5, false, 0.9), sub(6, false, 0.9)] });
  const scored = [{ item: worn, q: { score: 63, role: "ATK-DPS" }, percentile: 61.6,
    verdict: "keep", reason: "keep" }];
  const ctx = buildContext([worn], scored);
  const r = rateItem(worn, ctx, "ATK-DPS");

  expect(r.item).toBe(worn);
  expect(r.q).toBe(63);
  expect(r.role).toBe("ATK-DPS");
  expect(r.percentile).toBe(62);                          // rounded, not truncated
  expect(r.premium).toBe(keepPremium(29));                // Cruel, 6
  expect(r.ceiling).toBe(quality(worn, true).score);
  expect(r.better).toBe(0);
  expect(r.verdict).toBe("KEEP");
  expect(r.rolls).toEqual(rollStats(worn, "ATK-DPS"));
  expect(r.rolls.good).toBe(10);                          // non-degenerate: 2 subs x (4 upgrades + 1)
});

// The roll metric is read at the ITEM's best-matching role — the role its q-score was computed at —
// not at the champion's. It answers "were these rolls spent well for what this piece is", which is
// the question the q column already answers; re-asking it at the wearer's role would double-count
// the miscast that roleGap reports separately.
test("rateItem reads roll quality at the item's own role, not the champion's", () => {
  const worn = gear({ id: 1, equippedChampId: 110,
    substats: [sub(5, false, 0.9), sub(6, false, 0.9)] });
  const scored = [{ item: worn, q: { score: 63, role: "ATK-DPS" }, percentile: 50,
    verdict: "keep", reason: "keep" }];
  const ctx = buildContext([worn], scored);

  expect(rollStats(worn, "Support").good).not.toBe(rollStats(worn, "ATK-DPS").good);  // they differ
  expect(rateItem(worn, ctx, "Support").rolls).toEqual(rollStats(worn, "ATK-DPS"));
  // ...and the reported role is the item's too. This is the only fixture where the two disagree, so
  // it's the only place `role: s.q.role` can be told apart from `role: champRoleName`.
  expect(rateItem(worn, ctx, "Support").role).toBe("ATK-DPS");
});

// roleGap is a FLAG, not a measurement: below the threshold rateItem reports null rather than a
// small gap, so the CLI has nothing to print. CUTS.roleGapFlag is inclusive, and this fixture sits
// exactly on it — RES at 0.4 of its theoretical max reads a gap of exactly 10 on an Attack champion.
test("rateItem flags a role gap at the threshold and suppresses one below it", () => {
  const at = gear({ id: 1, equippedChampId: 110, set: 4, substats: [sub(7, true, 0.4)] });
  const below = gear({ id: 2, equippedChampId: 110, set: 4, substats: [sub(7, true, 0.3)] });
  expect(roleGap(at, "ATK-DPS").gap).toBe(CUTS.roleGapFlag);              // ON the boundary
  expect(roleGap(below, "ATK-DPS").gap).toBeLessThan(CUTS.roleGapFlag);
  const items = [at, below];
  const ctx = buildContext(items, keepAll(items));

  expect(rateItem(at, ctx, "ATK-DPS").roleGap).toEqual(roleGap(at, "ATK-DPS"));
  expect(rateItem(below, ctx, "ATK-DPS").roleGap).toBe(null);
});

// An unrecognised Champs.Role suppresses the flag rather than scoring the piece against a default.
test("rateItem leaves roleGap null when the champion's role is unknown", () => {
  const worn = gear({ id: 1, equippedChampId: 110, set: 4, substats: [sub(7, true, 1)] });
  expect(roleGap(worn, "ATK-DPS").gap).toBeGreaterThan(CUTS.roleGapFlag);  // it WOULD flag
  const ctx = buildContext([worn], keepAll([worn]));
  expect(rateItem(worn, ctx, null).roleGap).toBe(null);
});

// A ceiling the context doesn't hold reads as `undefined`, and `arr[mid] <= undefined` is false all
// the way down betterCount's binary search — the piece would come back maximally replaceable (every
// spare in its bucket counted as an upgrade) and get sold, silently. Rating an item the context
// never saw is a caller error, and it has to be loud.
test("rateItem refuses to rate an item the context has no ceiling for", () => {
  const inCtx = gear({ id: 1, equippedChampId: 110 });
  const stranger = gear({ id: 77, equippedChampId: 110 });
  const ctx = buildContext([inCtx], keepAll([inCtx]));
  ctx.byId.set(77, keepAll([stranger])[0]);        // triage row present, ceiling absent

  expect(() => rateItem(stranger, ctx, "ATK-DPS")).toThrow(/77/);
});

// The mirror case. A missing triage row is the same caller error and deserves the same diagnosis:
// without a guard it surfaces as a bare "Cannot read properties of undefined (reading 'verdict')"
// naming neither the item nor the context — and buildContext tolerates the identical absence with
// `?.` when it calibrates, so nothing upstream has already complained.
test("rateItem refuses to rate an item the context has no triage row for", () => {
  const inCtx = gear({ id: 1, equippedChampId: 110 });
  const stranger = gear({ id: 77, equippedChampId: 110 });
  const ctx = buildContext([inCtx, stranger], keepAll([inCtx]));   // ceiling present, row absent
  expect(ctx.ceiling.get(77)).toBe(quality(stranger, true).score);

  expect(() => rateItem(stranger, ctx, "ATK-DPS")).toThrow(/77/);
});

test("analyzeChampionGear rates only the champion's own gear and orders it worst-first", () => {
  // Two worn pieces plus a big pool of spares that out-ceiling one of them. The spares carry crit
  // substat TYPES and the worn piece carries none, so the spares' potential is strictly higher —
  // identical items would tie, and ties are not upgrades.
  const spares = [];
  for (let i = 0; i < 60; i++) {
    spares.push(gear({ id: 100 + i, level: 16, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] }));
  }
  const wornReplaceable = gear({ id: 1, equippedChampId: 110, level: 16 });
  const wornScarce = gear({ id: 2, equippedChampId: 110, slot: 3, level: 16,
    mainStat: { statId: 6, isFlat: false, value: 80 } });
  const items = [...spares, wornReplaceable, wornScarce];

  const scored = items.map((it) => ({
    item: it, q: { score: 50, role: "ATK-DPS" }, percentile: 50, verdict: "keep", reason: "keep",
  }));
  const ctx = buildContext(items, scored);
  const g = analyzeChampionGear({ ID: 110, Name: "Elhain", Role: 0 }, items, ctx);

  expect(g.role).toBe("ATK-DPS");
  expect(g.ratings.length).toBe(2);
  expect(g.ratings.map((r) => r.item.id)).toEqual([1, 2]);   // worse verdict first
  expect(g.ratings[0].better).toBeGreaterThan(g.ratings[1].better);
  expect(g.ratings[1].better).toBe(0);                        // no C.DMG-main gloves in the pool
  expect(g.tally.SELL + g.tally.BORDERLINE + g.tally.KEEP).toBe(2);
});

// ...and the verdicts that fixture actually produces, which it asserts nothing about. Two equipped
// pieces at 60 and 0 upgrade paths put BOTH quantiles at 0 — the degenerate shape. The piece with 60
// spares ahead of it is genuinely replaceable and sorts first, but a two-item population is not the
// evidence needed to condemn it, so it comes back BORDERLINE carrying its count.
test("analyzeChampionGear: degenerate cuts flag a replaceable piece without condemning it", () => {
  const spares = [];
  for (let i = 0; i < 60; i++) {
    spares.push(gear({ id: 100 + i, level: 16, substats: [sub(5, false, 0.9), sub(6, false, 0.9)] }));
  }
  const wornReplaceable = gear({ id: 1, equippedChampId: 110, level: 16 });
  const wornScarce = gear({ id: 2, equippedChampId: 110, slot: 3, level: 16,
    mainStat: { statId: 6, isFlat: false, value: 80 } });
  const items = [...spares, wornReplaceable, wornScarce];
  const ctx = buildContext(items, keepAll(items));

  expect(ctx.cuts).toEqual({ keepCut: 0, sellCut: 0, n: 2 });
  const g = analyzeChampionGear(champ(), items, ctx);
  expect(g.ratings.map((r) => [r.item.id, r.better, r.verdict]))
    .toEqual([[1, 60, "BORDERLINE"], [2, 0, "KEEP"]]);
  expect(g.tally).toEqual({ SELL: 0, BORDERLINE: 1, KEEP: 1 });
});

// The canonical main stat of each artifact slot, so a multi-slot fixture stays a legal item (and,
// incidentally, lands in a bucket of its own — see buildFakeCtx).
const MAIN_BY_SLOT = {
  1: { statId: 1, isFlat: true, value: 4080 },   // Helmet  flat HP
  2: { statId: 8, isFlat: true, value: 96 },     // Chest   ACC
  3: { statId: 6, isFlat: false, value: 80 },    // Gloves  C.DMG
  4: { statId: 4, isFlat: true, value: 45 },     // Boots   SPD
  5: { statId: 2, isFlat: true, value: 265 },    // Weapon  flat ATK
  6: { statId: 3, isFlat: true, value: 265 },    // Shield  flat DEF
};
const worn = (slot, o = {}) => gear({ slot, mainStat: MAIN_BY_SLOT[slot], equippedChampId: 110, ...o });

// A context assembled by hand: each entry states its piece's upgrade-path count outright (a pool
// bucket holding that many strictly-better ceilings) instead of arranging a vault that happens to
// calibrate that way. Sorting and tallying are about ORDER and COUNTS, not about the arithmetic that
// produced them, and buildContext's own calibration is pinned by its own tests above.
function buildFakeCtx(entries, fakeCuts) {
  const ceiling = new Map(), byId = new Map(), index = new Map();
  for (const { item, better, verdict = "keep", reason = "keep" } of entries) {
    const key = bucketKeyFor(item);
    if (index.has(key)) throw new Error(`buildFakeCtx: ${key} is taken — give each item its own slot`);
    ceiling.set(item.id, 50);
    index.set(key, Array.from({ length: better }, () => 60));
    byId.set(item.id, { item, q: quality(item), percentile: 50, verdict, reason });
  }
  return { ceiling, index, byId, cuts: fakeCuts };
}

test("analyzeChampionGear ignores gear worn by other champions and gear in the bank", () => {
  const mine = worn(1, { id: 1 });
  const alsoMine = worn(2, { id: 2 });
  const theirs = worn(3, { id: 3, equippedChampId: 220 });
  const bench = worn(4, { id: 4, equippedChampId: 0 });
  const items = [mine, alsoMine, theirs, bench];
  const ctx = buildFakeCtx(items.map((item) => ({ item, better: 0 })), { keepCut: 0, sellCut: 9, n: 4 });

  const row = champ();
  const g = analyzeChampionGear(row, items, ctx);
  expect(g.ratings.map((r) => r.item.id)).toEqual([1, 2]);
  expect(g.champ).toBe(row);
  expect(g.role).toBe("ATK-DPS");
});

// node:sqlite hands integer columns back as BigInt when a reader turns that on (oracle/lib/decode.mjs
// does, because corrupt gear rows overflow a JS number), so Champs.ID can arrive as 110n. `===`
// against a decoded item's plain-number cID is false for a BigInt, and the champion would come back
// wearing nothing at all.
test("analyzeChampionGear matches a Champs.ID that arrives as a BigInt", () => {
  const mine = worn(1, { id: 1 });
  const ctx = buildFakeCtx([{ item: mine, better: 0 }], { keepCut: 0, sellCut: 9, n: 1 });
  expect(analyzeChampionGear({ ID: 110n, Name: "Elhain", Role: 0 }, [mine], ctx).ratings.length).toBe(1);
});

test("analyzeChampionGear tallies each verdict separately", () => {
  const keep = worn(1, { id: 1 });
  const border = worn(2, { id: 2 });
  const sell = worn(3, { id: 3 });
  const items = [keep, border, sell];
  const ctx = buildFakeCtx(
    [{ item: keep, better: 0 }, { item: border, better: 5 }, { item: sell, better: 9 }],
    { keepCut: 1, sellCut: 9, n: 3 });

  const g = analyzeChampionGear(champ(), items, ctx);
  expect(g.ratings.map((r) => r.verdict)).toEqual(["SELL", "BORDERLINE", "KEEP"]);
  expect(g.tally).toEqual({ SELL: 1, BORDERLINE: 1, KEEP: 1 });
});

// The verdict key outranks the upgrade-path key. A triage-condemned piece with NO upgrade paths
// still sorts ahead of a keeper with several — it's the one the user can act on. Both the
// upgrade-path key and the slot key order this pair the other way round, as does the input order, so
// only the verdict key produces this answer.
test("analyzeChampionGear sorts by verdict ahead of upgrade paths", () => {
  const condemned = worn(5, { id: 1 });
  const keeper = worn(4, { id: 2 });
  const ctx = buildFakeCtx([
    { item: condemned, better: 0, verdict: "delete", reason: "setless: dominated by a set accessory in the same faction + slot" },
    { item: keeper, better: 3 },
  ], { keepCut: 3, sellCut: 9, n: 4 });

  const g = analyzeChampionGear(champ(), [keeper, condemned], ctx);
  expect(g.ratings.map((r) => r.verdict)).toEqual(["SELL", "KEEP"]);
  expect(g.ratings.map((r) => r.item.id)).toEqual([1, 2]);
});

// Within one verdict: most upgrade paths first (the most replaceable piece is the most actionable),
// then slot ASCENDING. All three pieces here land in the same band, so the verdict key can't order
// them; the input order, a reversed upgrade-path key, a dropped one, and a reversed slot key each
// produce a different sequence.
test("analyzeChampionGear breaks a verdict tie by upgrade paths, then by slot", () => {
  const many = worn(4, { id: 1 });
  const fewHighSlot = worn(5, { id: 2 });
  const fewLowSlot = worn(3, { id: 3 });
  const ctx = buildFakeCtx([
    { item: many, better: 3 }, { item: fewHighSlot, better: 1 }, { item: fewLowSlot, better: 1 },
  ], { keepCut: 3, sellCut: 9, n: 3 });

  const g = analyzeChampionGear(champ(), [fewHighSlot, many, fewLowSlot], ctx);
  expect(g.ratings.map((r) => r.verdict)).toEqual(["KEEP", "KEEP", "KEEP"]);
  expect(g.ratings.map((r) => r.item.id)).toEqual([1, 3, 2]);
});

// An uncalibrated vault is not a free pass. n = 0 is reachable through buildContext exactly when
// every equipped piece is already condemned, and each of those still has to come back SELL, with
// triage's own reason rather than a made-up one.
test("analyzeChampionGear: an uncalibrated context still passes triage's condemnations through", () => {
  const condemned = worn(4, { id: 1 });
  const scored = [{ item: condemned, q: quality(condemned), percentile: 50, verdict: "delete",
    reason: "setless: dominated by a set accessory in the same faction + slot" }];
  const ctx = buildContext([condemned], scored);

  expect(ctx.cuts.n).toBe(0);
  const g = analyzeChampionGear(champ(), [condemned], ctx);
  expect(g.ratings[0].verdict).toBe("SELL");
  expect(g.ratings[0].reason).toContain("setless");
  expect(g.tally).toEqual({ SELL: 1, BORDERLINE: 0, KEEP: 0 });
});

// A champion whose Role the mapping doesn't recognise still gets verdicts — only the miscast flag
// is suppressed. (champRole returns null there; nothing downstream may treat that as Attack.)
test("analyzeChampionGear rates gear for a champion with an unrecognised role", () => {
  const piece = worn(4, { id: 1, set: 4, substats: [sub(7, true, 1)] });
  const ctx = buildFakeCtx([{ item: piece, better: 9 }], { keepCut: 0, sellCut: 9, n: 3 });

  const g = analyzeChampionGear(champ({ Role: 9 }), [piece], ctx);
  expect(g.role).toBe(null);
  expect(g.ratings.length).toBe(1);
  expect(g.ratings[0].verdict).toBe("SELL");
  expect(g.ratings[0].roleGap).toBe(null);
});
