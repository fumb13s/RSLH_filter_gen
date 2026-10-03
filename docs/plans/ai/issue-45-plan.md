# Power Solver (Default Mode) Implementation Plan

**Goal:** Add `oracle/analytics/power-solve.mjs`, which finds the gear assignment from a whole vault that maximizes a champion's in-game power by linearizing the crit product, solving exactly, iterating to a fixed point, and certifying the remaining gap with a McCormick upper bound.

**Architecture:** `lin` from `power-model.mjs` is additive over pieces and set bonuses in every term but `k·C.RATE·(100 + C.DMG)`, a product of two build totals. Freezing C.RATE and C.DMG at reference levels turns that product into two per-stat scalars, leaving an objective that is a per-item value plus a per-`(set, count)` bonus — exactly what `build-solve.mjs` solves exactly. The solver therefore linearizes at the worn gear, runs one exact solve, re-linearizes at the answer and repeats until the build stops changing (fixed point), repeats an earlier build (cycle), or hits `maxRounds`. Every build any round produced — plus the gear already worn, seeded as round 0 — goes into one candidate pool, and the answer is the pool's best on the **true** objective, so the result can never be a downgrade. Two further exact solves give a proven upper bound over every assignment of the vault, from McCormick estimators of the crit product over the crit box the vault can actually reach.

**Tech Stack:** Plain Node ESM (`.mjs`) under `oracle/`, outside the TypeScript project references. Vitest for tests, fast-check v4 for property tests. Dependencies are four already-merged sibling modules: `build-solve.mjs` (#42), `champion-stats.mjs` (#44), `set-bonuses.mjs` (#41), `power-model.mjs` (#43). No new npm packages.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `oracle/analytics/power-solve.mjs` | **Create** | The six exports: stat vectors (`itemVector`, `setVectors`, `nonGearTotals`, `buildTotals`), the linearization (`linearizedWeights`), and the iteration + certificate (`solvePower`). |
| `oracle/analytics/__tests__/power-solve.test.mjs` | **Create** | Unit tests: vector construction, Lore of Steel, breakdown agreement, the weights precondition, and the four iteration outcomes (convergence, cycle, `maxRounds`, never-worse-than-worn) plus `top > 1` and the certificate. |
| `oracle/analytics/__tests__/power-solve.prop.test.mjs` | **Create** | The four properties against an independent brute force, the generator-coverage floor, and the full-vault performance test. |
| `CHANGELOG.md` | **Modify** | One `[minor]` line under `## [Unreleased]` → `### Added`. |

Nothing else is touched. The CLI, output formatting and the provably exact `--exact` mode are explicitly out of scope per the issue.

---

## Key Facts An Implementer Must Not Re-derive

These are verified against the merged source. Trust them.

**`build-solve.mjs`**
- `buildIndex(items, faction, valueOf)` → `Map(slot → Map(setId → { item, value }))`. Drops an item when `item.isAccessory && item.faction !== faction`. **Keeps only the single best item per `(slot, set)`** by `valueOf` — so a one-slot pool of three setless pieces offers `solve` exactly **one** build, not three.
- `solve(index, bonusAt, { top = 1 })` → `[{ score, items, counts }]`, best first. Returns `[]` for an empty index. `score` is the **gear part only** (items + set bonuses); it knows nothing about non-gear totals.
- `bonusAt` is a `Map(setId → number[10])` indexed by piece count `0..9`. `checkBonusAt` throws unless every entry is an array of **exactly 10** numbers, with `[0] === 0` and **non-decreasing**.
- A set whose `bonusAt` row is all zeros is skipped by both `usefulCounts` (no increase) and `singletonSets` (`bonus[1] > 0` fails), so it contributes no plans. This is what makes the two single-stat box solves cheap.

**`champion-stats.mjs`**
- `STATS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"]`. `"C.RATE"` and `"C.DMG"` need bracket access.
- `contribution(key, value, base)`: a `"X%"` key → `[X, base[X] * value / 100]`; anything else → `[key, value]` unchanged. **Linear in `value`**, unrounded, unfloored.
- `itemEntries(item)`: main stat, then each substat as **`value + glyph`**, then `ascStat`. Item stat ids are the `STAT_NAMES` space: `1 HP, 2 ATK, 3 DEF` (flat or `%` from `isFlat`), `4 SPD, 5 C.RATE, 6 C.DMG, 7 RES, 8 ACC`.
- `GREAT_HALL` includes `["C.DMG", 25]`. `ARENA` grants **no** crit. So a champion with a zero base has non-gear `C.RATE = 0` and `C.DMG = 25` — every crit fixture below is built on that.
- `statBreakdown(champStats, items)` → `{ columns: [[name, vector], …×9], totals }`. `totals` rounds **each column** then sums; this module deliberately does **not** use `totals`.
- ⚠️ `base` **must** define `HP`, `ATK` and `DEF` numerically. `GREAT_HALL` and `ARENA` both carry `"HP%"`/`"ATK%"`/`"DEF%"`, and `contribution` would compute `undefined * 20 / 100 = NaN`.
- `champStats` shape: `{ base, sources: { mastery, blessing, relic, empower, factionGuardian }, loreOfSteel }`. All five `sources` arrays must exist.

**`set-bonuses.mjs`**
- `setBonusTotals(counts)` → `Map(key → summed value)`, **multiplier-free** (no Lore of Steel).
- `setBonusTerms` iterates `counts` set by set independently, so `Σ_s setBonusTotals(Map([[s, n_s]])) === setBonusTotals(setCounts(items))`. **This exact decomposition is what `setVectors` rests on.**
- `setCounts(items)` skips set 0.
- `SET_BONUSES` has 41 rows: **28 `stack`** (23 with `pieces: 2`, 5 with `pieces: 4`) and **13 `tiered`** (ids 35, 36, 47, 48, 58–66). The 13 tiered sets are the ones that roll on accessories; the 28 stacking sets are artifact-only.
- Crit sets used by the generator: **5** Crit Rate (`C.RATE` 12 per 2 pieces), **6** Crit Damage (`C.DMG` 20 per 2 pieces), **60** Slayer (tiered, `C.RATE` 5 from a **single** piece).
- ⚠️ `set-bonuses.mjs:129-131` warns that a percentage stat should go through `setBonusTerms` because the game floors each term. `champion-stats.mjs:11-17` **explicitly overrules that for the Total Stats screen** ("Do not reconcile them here"). This module follows `champion-stats.mjs` and uses `setBonusTotals`. **Do not "fix" this.**

**`power-model.mjs`**
- `lin(totals, w) = w.b*(HP/15 + ATK + DEF) + w.r*RES + w.a*ACC + w.s*SPD + w.k*C.RATE*(100 + C.DMG)`.
- `weightsFor` returns strictly **positive** weights and its internal `measured` test is `> 0`. `solvePower`'s precondition is deliberately **`>= 0`** — looser, because every fixture below uses `b = r = a = s = 0, k = 1`. **Do not tighten it to `> 0`.**

**The McCormick reduction (derived, verified).** With `x = C.RATE ∈ [CRlo, CRhi]` and `y = 100 + C.DMG ∈ [Dlo, Dhi]`:
- `(CRhi − x)(y − Dlo) ≥ 0` ⟹ `x·y ≤ CRhi·y + Dlo·x − CRhi·Dlo`
- `(x − CRlo)(Dhi − y) ≥ 0` ⟹ `x·y ≤ CRlo·y + Dhi·x − CRlo·Dhi`

Substituting `y = 100 + C.DMG`, the first estimator's per-stat coefficients are `C.RATE → k·Dlo` and `C.DMG → k·CRhi` — which is **exactly `linearizedWeights(w, crRef = CRhi, cdRef = CDlo)`** — plus the constant `−k·CRhi·CDlo`. The second is `linearizedWeights(w, crRef = CRlo, cdRef = CDhi)` plus `−k·CRlo·CDhi`. So:

```
UB_i = dot(LW_i, nonGearTotals) + solve(index_i, bonusAt_i)[0].score − k·crRef_i·cdRef_i
```

Each certificate bound is **one more call of the same linearized solve**, with a reference pair and a scalar correction. Nothing bespoke is needed.

**Float monotonicity.** `bonusAt[setId][n]` must be non-decreasing in `n` or `build-solve` throws. Every set-vector stat amount is non-decreasing in `n` (`floor(n/pieces)` for `stack`, cumulative thresholds for `tiered`), every linearized weight is `≥ 0`, and IEEE multiplication and addition are each monotonic in their operands — so a fixed-order sum of non-negative terms cannot decrease when a term grows. Summing `dot` over `STATS` in a fixed order is therefore sufficient; no epsilon is needed.

**Stated assumption (header, not a throw).** `current` is assumed drawn from `items`. The crit box is the non-gear totals plus the most any assignment of `items` can add, so a worn piece absent from the pool could sit outside the box and make `gap` negative. The issue specifies exactly one precondition check (the weights); this assumption is documented in the header instead of enforced, and every test and the property generator honour it.

---

## Chunk A — Prerequisite

### Task 1: Build the workspace so the existing suite is green

`packages/core/dist` does not exist in a fresh worktree, and `set-bonuses.test.mjs` plus `mainstats.test.mjs` import `@rslh/core`. Without this, every later `npm test` fails for a reason that has nothing to do with this issue.

**Files:**

- None (build only)

**Steps:**

- [ ] 1. Build all packages: `npm run build`
     Expected: three workspace builds succeed, `packages/core/dist/index.js` now exists
- [ ] 2. Confirm the existing suite is green before adding anything: `npm test`
     Expected: all tests pass, 0 failures. If `set-bonuses.test.mjs` fails on `@rslh/core`, step 1 did not complete — re-run it before continuing.
- [ ] 3. Confirm the lint baseline is clean: `npm run lint`
     Expected: no output, exit 0

---

## Chunk B — Stat vectors and the linearization

### Task 2: Create the test file's shared fixtures and `linearizedWeights`

`oracle/analytics/__tests__/` has **no** shared-fixtures module — every file defines its own factories. Follow that.

**Files:**

- Test: `oracle/analytics/__tests__/power-solve.test.mjs` (Create)
- Create: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/power-solve.test.mjs` with the imports and fixtures that every later test reuses
  ```javascript
  // oracle/analytics/__tests__/power-solve.test.mjs
  import { test, expect } from "vitest";
  import {
    buildTotals, itemVector, linearizedWeights, nonGearTotals, setVectors, solvePower,
  } from "../power-solve.mjs";
  import { STATS, statBreakdown } from "../champion-stats.mjs";
  import { lin } from "../power-model.mjs";

  // Every field a decoded artifact carries (oracle/analytics/decode.mjs's decodeRow), so the
  // fixtures exercise the real Item shape rather than a hand-rolled stat bag.
  const item = (o = {}) => ({
    id: 1, slot: 1, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 1, isFlat: true, value: 0 }, substats: [], ascStat: null,
    ascLevel: 0, equippedChampId: 0, ...o,
  });

  const sub = (statId, value, isFlat = false) => ({ statId, isFlat, rolls: 0, value, glyph: 0 });

  // A crit piece as the game rolls one: C.RATE and C.DMG in percentage POINTS. statId 5 is C.RATE
  // and 6 is C.DMG in OUR item id space (STAT_NAMES order), NOT the statKindId space where 5 is
  // RES and 7 is C.RATE.
  const crit = (id, slot, cr, cd) => item({
    id, slot,
    mainStat: { statId: 5, isFlat: false, value: cr },
    substats: cd ? [sub(6, cd)] : [],
  });

  // Zero on every stat. base MUST carry HP, ATK and DEF as numbers: GREAT_HALL and ARENA both hold
  // "HP%"/"ATK%"/"DEF%" keys, and contribution would turn a missing one into NaN.
  const ZERO_BASE = Object.fromEntries(STATS.map((stat) => [stat, 0]));
  const NO_SOURCES = { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] };

  const champStats = (o = {}) => ({
    base: { ...ZERO_BASE, ...o.base },
    sources: { ...NO_SOURCES, ...o.sources },
    observedSets: new Map(), loreOfSteel: o.loreOfSteel ?? 0, awaken: 0,
  });

  // k alone. Every other weight is zero, so lin collapses to C.RATE * (100 + C.DMG) and every
  // expected number below is one multiplication a reader can check. A zero weight is LEGAL here —
  // the precondition is >= 0, unlike weightsFor's own `measured` test, which is > 0.
  const CRIT_ONLY = { b: 0, r: 0, a: 0, s: 0, k: 1 };
  ```
- [ ] 2. Append the first two tests to that file
  ```javascript
  // --- linearizedWeights -------------------------------------------------------------------------

  // Written out longhand rather than read back off the module, so a swapped crRef/cdRef names
  // itself. The crit row is the whole point: C.RATE carries k * (100 + cdRef) and C.DMG carries
  // k * crRef, so the two references are NOT interchangeable.
  test("linearizedWeights spreads the five weights over the eight stats", () => {
    const w = { b: 0.012, r: 0.28, a: 0.039, s: 0.022, k: 0.0015 };
    expect(linearizedWeights(w, 60, 150)).toEqual({
      HP: 0.012 / 15,
      ATK: 0.012,
      DEF: 0.012,
      SPD: 0.022,
      "C.RATE": 0.0015 * 250,
      "C.DMG": 0.0015 * 60,
      RES: 0.28,
      ACC: 0.039,
    });
  });

  // A missing key would make the dot product NaN, and a NaN score sorts below everything and is
  // silently never returned rather than failing.
  test("linearizedWeights is keyed by exactly the eight stats", () => {
    const got = linearizedWeights({ b: 1, r: 1, a: 1, s: 1, k: 1 }, 0, 0);
    expect(Object.keys(got).sort()).toEqual([...STATS].sort());
  });
  ```
- [ ] 3. Run the test to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: FAIL — `Failed to load url ../power-solve.mjs`, because the module does not exist yet
- [ ] 4. Create `oracle/analytics/power-solve.mjs` with a one-line placeholder header, the imports, the two private helpers and `linearizedWeights`. The full header is written in Task 19.
  ```javascript
  // oracle/analytics/power-solve.mjs — header completed in Task 19.
  import { buildIndex, SLOTS, solve } from "./build-solve.mjs";
  import { STATS, contribution, itemEntries, statBreakdown } from "./champion-stats.mjs";
  import { SET_BONUSES, setBonusTotals, setCounts } from "./set-bonuses.mjs";
  import { lin } from "./power-model.mjs";

  const zeros = () => Object.fromEntries(STATS.map((stat) => [stat, 0]));

  // Summed over STATS in a FIXED order, and two things rest on that. A rerun returns the same
  // build; and bonusAt stays non-decreasing, because IEEE multiplication and addition are each
  // monotonic in their operands, so a fixed-order sum of non-negative terms cannot shrink when one
  // term grows. That is what lets a set whose bonus at n+1 differs from its bonus at n only in the
  // last bits still pass build-solve's checkBonusAt, with no epsilon anywhere.
  const dot = (weights, vector) =>
    STATS.reduce((sum, stat) => sum + weights[stat] * vector[stat], 0);

  const addInto = (target, vector) => {
    for (const stat of STATS) target[stat] += vector[stat];
    return target;
  };

  // `lin`'s five weights as one scalar per stat, with the crit PRODUCT frozen at a reference
  // build's C.RATE and C.DMG. HP/15 shares `b` with ATK and DEF because fifteen points of HP buy
  // what one point of ATK does. Every scalar is non-negative when the weights are, which is what
  // makes the per-set bonus tables non-decreasing and so acceptable to build-solve.
  export function linearizedWeights(w, crRef, cdRef) {
    return {
      HP: w.b / 15,
      ATK: w.b,
      DEF: w.b,
      SPD: w.s,
      "C.RATE": w.k * (100 + cdRef),
      "C.DMG": w.k * crRef,
      RES: w.r,
      ACC: w.a,
    };
  }
  ```
- [ ] 5. Run the test to verify RED for the right reason: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: FAIL — `does not provide an export named 'itemVector'`. The two `linearizedWeights` tests cannot run until the other five exports exist, which is Tasks 3–7.
- [ ] 6. Add five temporary throwing stubs at the bottom of `power-solve.mjs` so the import resolves and the two tests under test can actually run. Each is replaced by a real implementation in Tasks 3–7.
  ```javascript
  export const itemVector = () => { throw new Error("not implemented"); };
  export const setVectors = () => { throw new Error("not implemented"); };
  export const nonGearTotals = () => { throw new Error("not implemented"); };
  export const buildTotals = () => { throw new Error("not implemented"); };
  export const solvePower = () => { throw new Error("not implemented"); };
  ```
- [ ] 7. Run the test to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 2 passed, 0 failed
- [ ] 8. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 9. Commit: `git commit -m "#45 power-solve: linearizedWeights"`

### Task 3: `itemVector`

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- itemVector --------------------------------------------------------------------------------

  test("itemVector sums the piece's main stat, substats and ascension stat", () => {
    const piece = item({
      mainStat: { statId: 2, isFlat: true, value: 150 },
      substats: [sub(4, 10, true), sub(5, 20)],
      ascStat: { statId: 6, isFlat: false, value: 12 },
    });
    const got = itemVector(piece, ZERO_BASE);
    expect(got.ATK).toBe(150);
    expect(got.SPD).toBe(10);
    expect(got["C.RATE"]).toBe(20);
    expect(got["C.DMG"]).toBe(12);
    expect(got.HP).toBe(0);
  });

  // A percent main stat is a percentage of the champion's BASE, so the same piece is worth a
  // different amount on a different champion. Reading it as a flat value would pass with a zero base.
  test("itemVector scales a percent stat against the champion's base", () => {
    const piece = item({ mainStat: { statId: 2, isFlat: false, value: 60 } });
    expect(itemVector(piece, { ...ZERO_BASE, ATK: 1000 }).ATK).toBeCloseTo(600, 9);
  });

  // The glyph is ADDITIVE: substat.value does not already include it.
  test("itemVector adds a substat's glyph to its value", () => {
    const piece = item({ substats: [{ statId: 4, isFlat: true, rolls: 0, value: 10, glyph: 5 }] });
    expect(itemVector(piece, ZERO_BASE).SPD).toBe(15);
  });

  test("itemVector is keyed by all eight stats", () => {
    expect(Object.keys(itemVector(item(), ZERO_BASE)).sort()).toEqual([...STATS].sort());
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 4 failing tests, each `Error: not implemented`
- [ ] 3. Replace the `itemVector` stub in `power-solve.mjs` with the implementation, placed under a new section divider after `addInto`
  ```javascript
  // --- stat vectors ------------------------------------------------------------------------------

  // What one piece contributes, as an unrounded vector over STATS. UNROUNDED on purpose: the
  // objective is evaluated on unrounded totals, and champion-stats.mjs's per-column rounding exists
  // to reproduce the game's DISPLAY, not its arithmetic.
  export function itemVector(item, base) {
    const out = zeros();
    for (const [key, value] of itemEntries(item)) {
      const [stat, amount] = contribution(key, value, base);
      out[stat] += amount;
    }
    return out;
  }
  ```
- [ ] 4. Delete the now-dead `export const itemVector = …` stub line from the bottom of the file
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 6 passed, 0 failed
- [ ] 6. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 7. Commit: `git commit -m "#45 power-solve: itemVector"`

### Task 4: `setVectors`, with Lore of Steel applied once

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- setVectors --------------------------------------------------------------------------------

  // Set 1 is Life, "HP%" 15 per 2-piece completion, so the vector is base-relative: a 20,000 HP
  // champion earns 3,000 HP per completion, not 15. One piece completes nothing.
  test("setVectors turns a percent key into an amount relative to the champion's base", () => {
    const vectors = setVectors(1, { ...ZERO_BASE, HP: 20000 }, 0);
    expect(vectors[0].HP).toBe(0);
    expect(vectors[1].HP).toBe(0);
    expect(vectors[2].HP).toBeCloseTo(3000, 9);
    expect(vectors[4].HP).toBeCloseTo(6000, 9);
  });

  // C.RATE and C.DMG are percentage POINTS and carry no "%" suffix, so set 5 (Crit Rate, +12 per
  // 2-piece completion) adds 12 points however large the champion's base crit rate is. Reading it
  // as a percent key would give 12% of 15 — 1.8 — which is wrong and plausible-looking.
  test("setVectors adds a crit key as points rather than a percentage of base crit", () => {
    expect(setVectors(5, { ...ZERO_BASE, "C.RATE": 15 }, 0)[2]["C.RATE"]).toBeCloseTo(12, 9);
  });

  // Lore of Steel scales EVERY set's bonus, once. Applying it twice is the quiet failure this
  // pins: 12 * 1.15 is 13.8 and 12 * 1.15 * 1.15 is 15.87, and neither looks wrong on its own.
  test("setVectors applies Lore of Steel exactly once", () => {
    expect(setVectors(5, ZERO_BASE, 0.15)[2]["C.RATE"]).toBeCloseTo(13.8, 9);
    expect(setVectors(5, ZERO_BASE, 0.15)[4]["C.RATE"]).toBeCloseTo(27.6, 9);
  });

  // A tiered set's FIRST tier can be a single piece — set 60 is Slayer, C.RATE +5 off one piece —
  // which is the shape most easily assumed away, and the reason build-solve has singleton columns.
  test("setVectors credits a one-piece tier at one piece", () => {
    expect(setVectors(60, ZERO_BASE, 0)[1]["C.RATE"]).toBeCloseTo(5, 9);
  });

  // Ten entries, zero at zero pieces: build-solve's checkBonusAt rejects anything else, and a
  // nine-entry array would read bonus[9] as undefined and poison the score into NaN.
  test("setVectors is a ten-entry array that is zero at zero pieces", () => {
    const vectors = setVectors(60, ZERO_BASE, 0);
    expect(vectors).toHaveLength(10);
    expect(vectors[0]).toEqual(ZERO_BASE);
  });

  // The precondition build-solve leans on, checked against the real table rather than assumed.
  test("every set's vectors are non-decreasing in piece count on every stat", () => {
    for (const setId of Object.keys(SET_BONUSES_IDS)) {
      const vectors = setVectors(Number(setId), { ...ZERO_BASE, HP: 20000, SPD: 100 }, 0.15);
      for (let n = 1; n < vectors.length; n++) {
        for (const stat of STATS) {
          expect(vectors[n][stat], `set ${setId} stat ${stat} at ${n}`)
            .toBeGreaterThanOrEqual(vectors[n - 1][stat]);
        }
      }
    }
  });
  ```
- [ ] 2. Add the `SET_BONUSES` import the last test needs, to the import block at the top of `power-solve.test.mjs`
  ```javascript
  import { SET_BONUSES as SET_BONUSES_IDS } from "../set-bonuses.mjs";
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 6 failing tests, each `Error: not implemented`
- [ ] 4. Replace the `setVectors` stub with the implementation, directly after `itemVector`
  ```javascript
  // One set's bonus at 0..9 pieces, as stat vectors. set-bonuses.mjs is multiplier-free, so Lore of
  // Steel is applied HERE, once, to every set — the mastery scales all of them, not only the eight
  // basic ones. Scaling the summed contribution is the same number as scaling each term, because
  // nothing on this path floors: (1 + l) * SUM terms == SUM (1 + l) * terms.
  //
  // setBonusTotals, not setBonusTerms. The warning on setBonusTotals is about the SPEED model,
  // where the game floors each set term against base separately; the Total Stats screen does not,
  // and champion-stats.mjs says so outright. Do not reconcile the two here.
  export function setVectors(setId, base, loreOfSteel) {
    const scale = 1 + loreOfSteel;
    return Array.from({ length: SLOTS.length + 1 }, (_, count) => {
      const out = zeros();
      for (const [key, value] of setBonusTotals(new Map([[setId, count]]))) {
        const [stat, amount] = contribution(key, value, base);
        out[stat] += amount * scale;
      }
      return out;
    });
  }
  ```
- [ ] 5. Delete the now-dead `export const setVectors = …` stub line
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 12 passed, 0 failed
- [ ] 7. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 8. Commit: `git commit -m "#45 power-solve: setVectors, with Lore of Steel applied once"`

### Task 5: `nonGearTotals`

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- nonGearTotals -----------------------------------------------------------------------------

  // The Great Hall's C.DMG +25 is the whole of a zero-base champion's non-gear crit, and every crit
  // case further down is built around it. Classic Arena grants no crit at all.
  test("nonGearTotals carries the Great Hall's crit, resistance and accuracy", () => {
    const got = nonGearTotals(champStats());
    expect(got["C.DMG"]).toBeCloseTo(25, 9);
    expect(got["C.RATE"]).toBe(0);
    expect(got.RES).toBeCloseTo(80, 9);
    expect(got.ACC).toBeCloseTo(80, 9);
  });

  // Base plus 20% Great Hall plus 22% Classic Arena on HP, and the two flat per-source bonuses
  // landing on their own stats.
  test("nonGearTotals sums the champion's base with every per-source bonus", () => {
    const got = nonGearTotals(champStats({
      base: { HP: 20000, SPD: 100 },
      sources: { blessing: [["SPD", 7]], relic: [["ACC", 50]] },
    }));
    expect(got.HP).toBeCloseTo(20000 + 4000 + 4400, 9);
    expect(got.SPD).toBeCloseTo(107, 9);
    expect(got.ACC).toBeCloseTo(80 + 50, 9);
  });

  // No gear means no set bonus, so Lore of Steel has nothing to scale and must not appear.
  test("nonGearTotals is unaffected by Lore of Steel", () => {
    const withMastery = nonGearTotals(champStats({ base: { HP: 20000 }, loreOfSteel: 0.15 }));
    const without = nonGearTotals(champStats({ base: { HP: 20000 } }));
    expect(withMastery).toEqual(without);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 3 failing tests, each `Error: not implemented`
- [ ] 3. Replace the `nonGearTotals` stub with the implementation, after `setVectors`
  ```javascript
  // Everything a copy has before any gear: its base, the Great Hall, Classic Arena, masteries,
  // faction guardians, empowerment, blessing and relic. Read off statBreakdown with NO items, so
  // the two models can never drift apart, and summed WITHOUT rounding — statBreakdown's own
  // `totals` rounds each column to reproduce the game's screen, which is not what an objective
  // should be evaluated on.
  export function nonGearTotals(champStats) {
    const out = zeros();
    for (const [, vector] of statBreakdown(champStats, []).columns) addInto(out, vector);
    return out;
  }
  ```
- [ ] 4. Delete the now-dead `export const nonGearTotals = …` stub line
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 15 passed, 0 failed
- [ ] 6. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 7. Commit: `git commit -m "#45 power-solve: nonGearTotals"`

### Task 6: `buildTotals`

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the agreement helper and tests to `power-solve.test.mjs`
  ```javascript
  // --- buildTotals -------------------------------------------------------------------------------

  // The stat model's columns summed WITHOUT rounding — deliberately not statBreakdown().totals,
  // which rounds each column to reproduce the game's screen. This is the independent second
  // implementation buildTotals is checked against.
  const summedColumns = (stats, items) => {
    const { columns } = statBreakdown(stats, items);
    return Object.fromEntries(STATS.map((stat) =>
      [stat, columns.reduce((sum, [, v]) => sum + v[stat], 0)]));
  };

  // Two Offense pieces (set 2, a 2-piece stacker) and one Stone Skin (set 48, whose FIRST tier is a
  // single piece), so both set mechanics are in play at once.
  const GEAR = [
    item({ id: 1, slot: 1, set: 2, mainStat: { statId: 1, isFlat: true, value: 1000 } }),
    item({ id: 2, slot: 2, set: 2, mainStat: { statId: 2, isFlat: false, value: 60 },
      substats: [sub(4, 10, true)] }),
    item({ id: 3, slot: 3, set: 48, mainStat: { statId: 5, isFlat: false, value: 20 },
      ascStat: { statId: 6, isFlat: false, value: 12 } }),
  ];

  const WORN_STATS = champStats({
    base: { HP: 20000, ATK: 1500, DEF: 1200, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30 },
    sources: { mastery: [["ATK%", 5], ["C.RATE", 5]], blessing: [["SPD", 7]] },
    loreOfSteel: 0.15,
  });

  // LORE OF STEEL AT 0.15 is the case that matters. The stat model splits a set's bonus across the
  // Artifacts column and the Masteries column, and buildTotals has to land on the same number from
  // a single (1 + 0.15) scaling applied per set. A champion with the mastery OFF would pass this
  // with the scaling missing altogether.
  //
  // toBeCloseTo, not toBe: the two sum the same terms in different orders, so they agree
  // mathematically and can differ in the last bits.
  test("buildTotals equals the stat model's columns summed unrounded, with Lore of Steel", () => {
    const got = buildTotals(WORN_STATS, GEAR);
    const want = summedColumns(WORN_STATS, GEAR);
    for (const stat of STATS) expect(got[stat], stat).toBeCloseTo(want[stat], 9);
  });

  test("buildTotals equals the stat model's columns summed unrounded, without Lore of Steel", () => {
    const none = champStats({ base: WORN_STATS.base, sources: WORN_STATS.sources });
    const got = buildTotals(none, GEAR);
    const want = summedColumns(none, GEAR);
    for (const stat of STATS) expect(got[stat], stat).toBeCloseTo(want[stat], 9);
  });

  test("buildTotals with no items is nonGearTotals", () => {
    expect(buildTotals(WORN_STATS, [])).toEqual(nonGearTotals(WORN_STATS));
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 3 failing tests, each `Error: not implemented`
- [ ] 3. Replace the `buildTotals` stub with the implementation, after `nonGearTotals`
  ```javascript
  // The unrounded stat totals of one copy wearing one set of items: what it has before any gear,
  // plus each piece, plus each set's bonus AT THE COUNT THE BUILD HOLDS.
  //
  // Summing per set is exact rather than an approximation: setBonusTerms walks its counts set by
  // set independently, so the sum of each set's own totals is the whole build's set totals.
  export function buildTotals(champStats, items) {
    const { base, loreOfSteel } = champStats;
    const out = nonGearTotals(champStats);
    for (const item of items) addInto(out, itemVector(item, base));
    for (const [setId, count] of setCounts(items)) {
      addInto(out, setVectors(setId, base, loreOfSteel)[count]);
    }
    return out;
  }
  ```
- [ ] 4. Delete the now-dead `export const buildTotals = …` stub line
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 18 passed, 0 failed
- [ ] 6. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 7. Commit: `git commit -m "#45 power-solve: buildTotals"`

### Task 7: Lint the stat-vector half

**Files:**

- Modify: `oracle/analytics/power-solve.mjs` (only if lint reports something)

**Steps:**

- [ ] 1. Run lint: `npm run lint`
     Expected: no output, exit 0. A likely finding is `no-shadow`-style noise from the `item` parameter in `itemVector` shadowing nothing — if ESLint flags any rule, fix it in place rather than disabling the rule.
- [ ] 2. If lint changed a file, re-run the tests: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 18 passed
- [ ] 3. Commit only if step 1 or 2 changed a file: `git add oracle/analytics/power-solve.mjs`
- [ ] 4. Commit only if step 3 staged something: `git commit -m "#45 power-solve: lint fixes for the stat vectors"`

---

## Chunk C — `solvePower`: the iteration

Tasks 8–14 build `solvePower` one stop-condition at a time. Each task's test is RED against the previous task's implementation — the ladder is deliberate, so read the "Expected" lines rather than skipping ahead and writing the whole function.

### Task 8: The weights precondition

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: the weights precondition ------------------------------------------------------

  const ONE_PIECE = [crit(1, 1, 50, 0)];
  const callWith = (weights) => () => solvePower({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE, weights,
  });

  // Both consequences are quiet rather than loud. A negative per-stat scalar makes a set's bonus
  // DECREASE with more pieces, which build-solve rejects for one weight and silently mis-solves
  // for another; and the McCormick estimators are upper bounds only for k >= 0, so a negative k
  // turns the certificate into a confident wrong number.
  test("solvePower refuses a negative weight, naming it", () => {
    expect(callWith({ ...CRIT_ONLY, r: -0.1 })).toThrow(/power-solve: weight r/);
    expect(callWith({ ...CRIT_ONLY, k: -1 })).toThrow(/power-solve: weight k/);
    expect(callWith({ ...CRIT_ONLY, b: -0.001 })).toThrow(/power-solve: weight b/);
  });

  // A least-squares fit can return null for a weight it could not determine and NaN from a broken
  // one. Neither is a measurement, and lin turns either into NaN, which sorts below everything and
  // is silently never returned rather than failing.
  test("solvePower refuses a weight that is not a finite number", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1"]) {
      expect(callWith({ ...CRIT_ONLY, s: bad }), `s = ${bad}`).toThrow(/power-solve: weight s/);
    }
  });

  // Zero is LEGAL, unlike weightsFor's own `measured` test which requires > 0. Every crit case in
  // this file leans on it: k alone, with b, r, a and s all zero.
  test("solvePower accepts a zero weight", () => {
    expect(callWith(CRIT_ONLY)).not.toThrow();
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 3 failing tests. The two `toThrow` tests fail with `Error: not implemented` instead of the expected message; the third fails because `not.toThrow()` saw `not implemented`.
- [ ] 3. Add the precondition and a minimal body to `power-solve.mjs`, replacing the `solvePower` stub. Place a new section divider above it.
  ```javascript
  // --- solvePower --------------------------------------------------------------------------------

  const WEIGHT_NAMES = ["b", "r", "a", "s", "k"];

  // Checked once per call rather than trusted, because both failures are quiet. See the two
  // consequences spelled out in the header. weightsFor never returns a bad weight, so this fires on
  // a hand-built weights object or a fit that came back undetermined.
  function checkWeights(weights) {
    for (const name of WEIGHT_NAMES) {
      const value = weights?.[name];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`power-solve: weight ${name} is ${value}, must be a finite number >= 0 —`
          + " build-solve needs non-decreasing set bonuses and the McCormick bound needs k >= 0");
      }
    }
  }

  export function solvePower({ items, faction, champStats, current, weights, top = 1,
    maxRounds = 20 }) {
    checkWeights(weights);
    // The published signature is complete from the start, but only `weights` is read yet. These
    // `void`s keep ESLint's no-unused-vars quiet without an eslint-disable; each one disappears as
    // Tasks 9 to 15 consume its parameter.
    void items; void faction; void champStats; void current; void top; void maxRounds;
    return { builds: [], rounds: 0, converged: false, upperBound: 0, gap: 0 };
  }
  ```
- [ ] 4. Delete the now-dead `export const solvePower = …` stub line
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 21 passed, 0 failed
- [ ] 6. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 7. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 8. Commit: `git commit -m "#45 power-solve: check the weights precondition"`

### Task 9: Round 0 — the worn gear enters the pool

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: round 0, the gear already worn ------------------------------------------------

  // With a zero base the only crit a build has that did not come off gear is GREAT_HALL's C.DMG 25.
  // A worn C.RATE 50 piece therefore gives C.RATE 50, C.DMG 25 and lin = 50 * (100 + 25) = 6,250.
  test("the worn gear is scored on the true objective and reported", () => {
    const got = solvePower({
      items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
      weights: CRIT_ONLY, maxRounds: 0,
    });
    expect(got.builds).toHaveLength(1);
    expect(got.builds[0].items.map((it) => it.id)).toEqual([1]);
    expect(got.builds[0].lin).toBeCloseTo(6250, 6);
  });

  // The totals are the UNROUNDED build totals, and `lin` is that vector through power-model's own
  // formula — so a caller can re-derive the score rather than take the field on trust.
  test("each build carries its unrounded totals alongside its lin", () => {
    const got = solvePower({
      items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
      weights: CRIT_ONLY, maxRounds: 0,
    });
    expect(got.builds[0].totals["C.RATE"]).toBeCloseTo(50, 9);
    expect(got.builds[0].totals["C.DMG"]).toBeCloseTo(25, 9);
    expect(got.builds[0].lin).toBeCloseTo(lin(got.builds[0].totals, CRIT_ONLY), 9);
  });

  // An empty slot is a real state — a copy can be wearing nothing — and the worn "build" is then
  // the non-gear totals alone.
  test("an empty worn build is still round 0", () => {
    const got = solvePower({
      items: ONE_PIECE, faction: 0, champStats: champStats(), current: [],
      weights: CRIT_ONLY, maxRounds: 0,
    });
    expect(got.builds[0].items).toEqual([]);
    expect(got.builds[0].lin).toBe(0);   // C.RATE 0, so the crit term is 0 whatever C.DMG is
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 3 failing tests — `builds` is `[]`, so `toHaveLength(1)` fails and `builds[0]` is undefined
- [ ] 3. Add the pool, the build identity key and round-0 seeding to `solvePower` in `power-solve.mjs`. Insert `itemsKey` above `solvePower`, and replace the function body.
  ```javascript
  // A build's identity: its item ids, sorted, so "the same set of items" is one string compare
  // however the solver happened to order them. Same key build-solve dedups on.
  const itemsKey = (items) => items.map((it) => it.id).sort((a, b) => a - b).join(",");

  export function solvePower({ items, faction, champStats, current, weights, top = 1,
    maxRounds = 20 }) {
    checkWeights(weights);
    const { base, loreOfSteel } = champStats;

    // Precomputed once: neither depends on the linearization, only on the champion. Rebuilding them
    // per round would re-walk every item's substats and every set's tier table on each pass.
    const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
    const setVecs = new Map(Object.keys(SET_BONUSES).map(Number).sort((a, b) => a - b)
      .map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
    const nonGear = nonGearTotals(champStats);

    // One linearized exact solve: value every piece and every (set, count) by `linWeights`, then
    // hand the pair to build-solve. The score it returns is the GEAR part alone, and every build
    // that comes back is re-scored on the true objective by the caller.
    const solveAt = (linWeights, howMany) => {
      const index = buildIndex(items, faction, (item) => dot(linWeights, vectorOf.get(item)));
      const bonusAt = new Map([...setVecs]
        .map(([setId, vectors]) => [setId, vectors.map((v) => dot(linWeights, v))]));
      return solve(index, bonusAt, { top: howMany });
    };

    // The pool every answer comes out of, keyed on the sorted item ids so a build two rounds both
    // reached is one entry.
    const pool = new Map();
    const record = (buildItems) => {
      const key = itemsKey(buildItems);
      if (!pool.has(key)) {
        const totals = buildTotals(champStats, buildItems);
        pool.set(key, { items: buildItems, totals, lin: lin(totals, weights) });
      }
      return pool.get(key);
    };

    // ROUND 0 is the gear already worn, scored on the true objective and entered FIRST. Without it
    // a cycle can end on a build below what the champion is wearing, and the answer would be a
    // downgrade reported as an improvement.
    const start = record(current);
    const roundOf = new Map([[itemsKey(current), 0]]);
    let reference = { cr: start.totals["C.RATE"], cd: start.totals["C.DMG"] };

    const rounds = 0;
    const converged = false;
    // Not read until Tasks 10 to 15 wire the round loop and the certificate. See the note in
    // Task 8 on why these are `void`s rather than an eslint-disable.
    void solveAt; void reference; void maxRounds; void top; void nonGear;

    const builds = [start];
    return { builds, rounds, converged, upperBound: 0, gap: 0 };
  }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 24 passed, 0 failed
- [ ] 5. Run lint: `npm run lint`
     Expected: no output, exit 0. The `void` statements keep the not-yet-used locals legal; Tasks 10, 12 and 15 remove them one at a time as each name is consumed.
- [ ] 6. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 7. Commit: `git commit -m "#45 power-solve: seed the worn gear as round 0"`

### Task 10: The round loop, and convergence to a fixed point

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the fixture and test to `power-solve.test.mjs`. The arithmetic is written out in full; every line is one multiplication.
  ```javascript
  // --- solvePower: convergence -------------------------------------------------------------------

  // Linearizing at the worn gear picks a build WORSE than what is worn — C.DMG 400 with no crit
  // rate at all scores zero — and only the next round's reference makes the crit-heavy optimum the
  // best linear pick. One slot and three setless pieces, so nothing but the crit term is in play.
  //
  //   non-gear crit: C.RATE 0, C.DMG 25 (the Great Hall)
  //   worn  id 1  C.RATE 20              true 20 * (100 +  25) =  2,500
  //   lure  id 2  C.DMG 400              true  0 * (100 + 425) =      0
  //   best  id 3  C.RATE 30, C.DMG 150   true 30 * (100 + 175) =  8,250
  //
  //   round 1 at (20,  25): C.RATE x 125, C.DMG x 20 -> lure 8,000 > best 6,750 > worn 2,500
  //   round 2 at ( 0, 425): C.RATE x 525, C.DMG x  0 -> best 15,750 > worn 10,500 > lure 0
  //   round 3 at (30, 175): C.RATE x 275, C.DMG x 30 -> best 12,750 > lure 12,000 > worn 5,500
  //                         best repeats round 2's build: a FIXED POINT.
  const CONVERGE = [crit(1, 1, 20, 0), crit(2, 1, 0, 400), crit(3, 1, 30, 150)];
  const CONVERGE_ARGS = {
    items: CONVERGE, faction: 0, champStats: champStats(),
    current: [CONVERGE[0]], weights: CRIT_ONLY,
  };

  // rounds > 1 is the assertion that matters: a solver that linearized ONCE around the worn gear
  // would stop at the lure and report a build worth nothing.
  test("the iteration walks off a low-crit linear pick onto the crit-heavy optimum", () => {
    const got = solvePower(CONVERGE_ARGS);
    expect(got.converged).toBe(true);
    expect(got.rounds).toBe(3);
    expect(got.builds[0].items.map((it) => it.id)).toEqual([3]);
    expect(got.builds[0].lin).toBeCloseTo(8250, 6);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 1 failing test — `converged` is `false` and `rounds` is `0`, because no round has been run yet
- [ ] 3. In `power-solve.mjs`, replace the five lines from `const rounds = 0;` through `const builds = [start];` with the round loop. The only stop condition implemented here is "the round's best repeats the **previous** round's build"; the cycle and `maxRounds` stops come in Tasks 11 and 12.
  ```javascript
    let rounds = 0;
    let converged = false;
    let best = start;
    while (rounds < 20) {
      rounds++;
      const ranked = solveAt(linearizedWeights(weights, reference.cr, reference.cd), top);
      // No slot has an eligible item, so there is nothing to iterate on.
      if (ranked.length === 0) break;
      // Every build the round produced joins the pool, and the round's own best is chosen on the
      // TRUE objective rather than on the linearized score it was found by. With top = 1 the two
      // agree by construction; with top > 1 the linearized order is the wrong one.
      let roundBest = null;
      for (const { items: buildItems } of ranked) {
        const scored = record(buildItems);
        if (!roundBest || scored.lin > roundBest.lin) roundBest = scored;
      }
      best = roundBest;
      const key = itemsKey(roundBest.items);
      if (roundOf.get(key) === rounds - 1) { converged = true; break; }
      roundOf.set(key, rounds);
      reference = { cr: roundBest.totals["C.RATE"], cd: roundBest.totals["C.DMG"] };
    }

    const builds = [best];
  ```
- [ ] 4. The round loop now reads `solveAt`, `reference` and `top`, so narrow the `void` line to the two names still unused
  ```javascript
    void maxRounds; void nonGear;
  ```
- [ ] 5. Move that `void` line to sit immediately above `const builds = [best];`, after the loop, so it reads as a note on what is still to come rather than as part of the loop's setup
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 25 passed, 0 failed
- [ ] 7. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 8. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 9. Commit: `git commit -m "#45 power-solve: iterate the linearization to a fixed point"`

### Task 11: Cycle detection

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the fixture and test to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: a cycle -----------------------------------------------------------------------

  // Two slots, each offering a C.RATE 50 piece or a C.DMG 150 piece and nothing else. The
  // linearization alternates between the two corners and never looks at the mixed build, which is
  // the actual optimum. Built from ordinary items — no injected valuation is needed to produce it.
  //
  //   worn (both C.RATE)  C.RATE 100, C.DMG  25  true 100 * 125 = 12,500
  //   both C.DMG          C.RATE   0, C.DMG 325  true   0 * 425 =      0
  //   one of each         C.RATE  50, C.DMG 175  true  50 * 275 = 13,750  <- never reached
  //
  //   round 1 at (100,  25): C.RATE x 125, C.DMG x 100 -> per slot 15,000 > 6,250, so both C.DMG
  //   round 2 at (  0, 325): C.RATE x 425, C.DMG x   0 -> per slot 21,250 > 0, so both C.RATE,
  //                          which is ROUND 0's build — a cycle, and no fixed point exists.
  const CYCLE = [
    crit(1, 1, 50, 0), crit(2, 1, 0, 150),
    crit(3, 2, 50, 0), crit(4, 2, 0, 150),
  ];
  const CYCLE_ARGS = {
    items: CYCLE, faction: 0, champStats: champStats(),
    current: [CYCLE[0], CYCLE[2]], weights: CRIT_ONLY,
  };
  const idsOf = (build) => build.items.map((it) => it.id).sort((a, b) => a - b);

  test("a cycle stops the iteration and is reported as not converged", () => {
    const got = solvePower(CYCLE_ARGS);
    expect(got.converged).toBe(false);
    expect(got.rounds).toBe(2);
  });

  // The answer is below the true optimum, and that is the point: this mode is a fixed-point search,
  // not a proof. A solver claiming optimality here would be claiming 12,500 is the best of a pool
  // whose best is 13,750.
  test("a cycle still returns the best build it saw", () => {
    const got = solvePower(CYCLE_ARGS);
    expect(idsOf(got.builds[0])).toEqual([1, 3]);
    expect(got.builds[0].lin).toBeCloseTo(12500, 6);
    expect(got.builds[0].lin).toBeLessThan(13750);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 2 failing tests. `rounds` is `20`, not `2` — with only the previous-round check the iteration alternates between the two corners until the hardcoded bound, so the cycle is never noticed.
- [ ] 3. In `power-solve.mjs`, replace the single stop line `if (roundOf.get(key) === rounds - 1) { converged = true; break; }` with the two-way check
  ```javascript
      // Repeating the PREVIOUS round's build is a fixed point. Repeating any EARLIER one is a
      // cycle, and there is no fixed point to report — the iteration would alternate forever.
      const earlier = roundOf.get(key);
      if (earlier !== undefined) { converged = earlier === rounds - 1; break; }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 27 passed, 0 failed
- [ ] 5. Confirm the convergence test still distinguishes the two outcomes — it must report `converged: true` while the cycle reports `false`. Both assertions are already in the suite; a run where both read `false` means the `earlier === rounds - 1` comparison was dropped.
- [ ] 6. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 7. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 8. Commit: `git commit -m "#45 power-solve: detect a cycle and report it as not converged"`

### Task 12: `maxRounds` bounds the iteration

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the test to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: maxRounds ---------------------------------------------------------------------

  // Cut the cycle off before it closes. One round runs, nothing has repeated yet, so there is no
  // fixed point to claim.
  test("maxRounds stops the iteration and leaves converged false", () => {
    const got = solvePower({ ...CYCLE_ARGS, maxRounds: 1 });
    expect(got.rounds).toBe(1);
    expect(got.converged).toBe(false);
  });

  // Zero rounds is a legal request — it reports the worn gear and nothing else, which is what the
  // round-0 tests above use.
  test("maxRounds of zero runs no round at all", () => {
    const got = solvePower({ ...CYCLE_ARGS, maxRounds: 0 });
    expect(got.rounds).toBe(0);
    expect(got.converged).toBe(false);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 1 failing test — `maxRounds: 1` gives `rounds` `2`, because the loop bound is still the hardcoded `20`. The `maxRounds: 0` test already passes, since `rounds < 20` with an immediate cycle cannot reach 0 — it is a regression lock on the bound being read, not a new behaviour.
- [ ] 3. In `power-solve.mjs`, change the loop bound to read the parameter
  ```javascript
    while (rounds < maxRounds) {
  ```
- [ ] 4. Narrow the `void` line, since `maxRounds` is now read by the loop bound
  ```javascript
    void nonGear;
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 29 passed, 0 failed
- [ ] 6. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 7. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 8. Commit: `git commit -m "#45 power-solve: bound the iteration with maxRounds"`

### Task 13: The answer comes from the whole pool, never below the worn gear

This is the task that makes round-0 seeding load-bearing. Until now `builds[0]` is whatever the **last** round produced, which on the fixture below is a downgrade.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the fixture and test to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: never worse than the gear already worn ---------------------------------------

  // A cycle every member of which is WORSE than what is worn. Without round 0 in the pool the
  // answer is C.RATE 60 at 7,500 — a downgrade, reported as a result. Same weights and same
  // non-gear crit as the cycle case above.
  //
  //   worn   id 1  C.RATE 50, C.DMG 50  true 50 * (100 +  75) = 8,750
  //   lure   id 2  C.DMG 300            true  0 * (100 + 325) =     0
  //   second id 3  C.RATE 60            true 60 * (100 +  25) = 7,500
  //
  //   round 1 at (50,  75): C.RATE x 175, C.DMG x 50 -> lure 15,000 > worn 11,250 > second 10,500
  //   round 2 at ( 0, 325): C.RATE x 425, C.DMG x  0 -> second 25,500 > worn 21,250 > lure 0
  //   round 3 at (60,  25): C.RATE x 125, C.DMG x 60 -> lure 18,000 > worn 9,250 > second 7,500
  //                         lure is ROUND 1's build, so this is a cycle whose own best is 7,500.
  const BELOW_WORN = [crit(1, 1, 50, 50), crit(2, 1, 0, 300), crit(3, 1, 60, 0)];

  test("the answer is never worse than the worn gear, even when every round is", () => {
    const got = solvePower({
      items: BELOW_WORN, faction: 0, champStats: champStats(),
      current: [BELOW_WORN[0]], weights: CRIT_ONLY,
    });
    expect(got.converged).toBe(false);
    expect(got.rounds).toBe(3);
    expect(got.builds[0].items.map((it) => it.id)).toEqual([1]);
    expect(got.builds[0].lin).toBeCloseTo(8750, 6);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 1 failing test — `builds[0]` is item `2` with `lin` `0`, the last round's pick, not the worn gear at 8,750
- [ ] 3. In `power-solve.mjs`, replace `const builds = [best];` with the pool-wide answer
  ```javascript
    // The whole POOL, not the last round: the best build may have come from any round, or be the
    // gear already worn. Stable sort, so a tie falls to insertion order — round order, then
    // build-solve's own deterministic ranking — and a rerun returns the same list.
    const builds = [...pool.values()].sort((a, b) => b.lin - a.lin);
  ```
- [ ] 4. Delete the now-unused `let best = start;` declaration and the `best = roundBest;` assignment inside the loop
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 30 passed, 0 failed
- [ ] 6. Extend the `maxRounds` test from Task 12 so it also pins the pool-wide answer — add these two lines inside `test("maxRounds stops the iteration and leaves converged false", …)`
  ```javascript
    expect(idsOf(got.builds[0])).toEqual([1, 3]);
    expect(got.builds[0].lin).toBeCloseTo(12500, 6);
  ```
- [ ] 7. Extend the cycle test from Task 11 the same way — it already asserts `builds[0]`, so confirm it still reads `[1, 3]` and `12500` rather than the last round's all-C.DMG build at 0
- [ ] 8. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 30 passed, 0 failed
- [ ] 9. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 10. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 11. Commit: `git commit -m "#45 power-solve: answer from the whole candidate pool"`

### Task 14: `top` ranks and caps the pool

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: top --------------------------------------------------------------------------

  // The POOL is what `top` ranks, not one round's output. buildIndex keeps only the best piece of
  // each set in each slot, so a one-slot pool of three setless pieces offers the solver exactly one
  // build per round — all three entries below were found in three DIFFERENT rounds.
  test("top greater than one returns distinct builds from the whole pool, best first", () => {
    const got = solvePower({ ...CONVERGE_ARGS, top: 3 });
    expect(got.builds.map((b) => b.items.map((it) => it.id))).toEqual([[3], [1], [2]]);
    expect(got.builds.map((b) => Math.round(b.lin))).toEqual([8250, 2500, 0]);
  });

  test("top caps the number of builds returned", () => {
    const got = solvePower({ ...CONVERGE_ARGS, top: 2 });
    expect(got.builds).toHaveLength(2);
    expect(got.builds[0].items.map((it) => it.id)).toEqual([3]);
  });

  // Entries are distinct SETS of items, so a build two rounds both reached is listed once.
  test("top does not list the same set of items twice", () => {
    const got = solvePower({ ...CONVERGE_ARGS, top: 9 });
    const keys = got.builds.map((b) => b.items.map((it) => it.id).sort((a, c) => a - c).join(","));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The default is one build, and `top` can never shrink the answer to nothing.
  test("top defaults to one build", () => {
    expect(solvePower(CONVERGE_ARGS).builds).toHaveLength(1);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 2 failing tests — `top: 2` returns 3 builds and the default returns 3, because the pool is sorted but never sliced
- [ ] 3. In `power-solve.mjs`, replace the `builds` assignment with the sliced form
  ```javascript
    // The whole POOL, not the last round: the best build may have come from any round, or be the
    // gear already worn. Stable sort, so a tie falls to insertion order — round order, then
    // build-solve's own deterministic ranking — and a rerun returns the same list.
    //
    // These are the best DISTINCT SETS OF ITEMS this iteration happened to see. That is not a
    // proved top-N, and build-solve's own `top` is not either: its entries after the first are the
    // best each OTHER plan could reach. Said plainly rather than claimed otherwise.
    const builds = [...pool.values()]
      .sort((a, b) => b.lin - a.lin)
      .slice(0, Math.max(1, top));
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 34 passed, 0 failed
- [ ] 5. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 6. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 7. Commit: `git commit -m "#45 power-solve: rank and cap the pool with top"`

---

## Chunk D — The certificate

### Task 15: The crit box and the two McCormick bounds

The box is not exported, so it is driven through `upperBound` and `gap`. The arithmetic below is worked out in full for the cycle pool, so a wrong reference pair or a dropped correction constant names itself.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve.test.mjs`

**Steps:**

- [ ] 1. Append the tests to `power-solve.test.mjs`
  ```javascript
  // --- solvePower: the certificate ---------------------------------------------------------------

  // The box is the non-gear crit plus the most any assignment of the pool can ADD, each found by
  // one exact solve weighting that stat alone. On the cycle pool the most gear can add is C.RATE
  // 100 and C.DMG 300, so the box is C.RATE 0..100 and C.DMG 25..325, giving Dlo = 125 and
  // Dhi = 425. The two estimators then maximise to
  //
  //   UB_1 at (crRef, cdRef) = (CRhi, CDlo) = (100,  25)
  //     non-gear   125 * 0 + 100 *  25 =  2,500
  //     best gear  per slot max(50 * 125, 150 * 100) = 15,000, twice = 30,000
  //     constant   -k * CRhi * CDlo = -100 * 25 = -2,500
  //     UB_1 = 2,500 + 30,000 - 2,500 = 30,000
  //
  //   UB_2 at (crRef, cdRef) = (CRlo, CDhi) = (  0, 325)
  //     non-gear   425 * 0 + 0 * 25 = 0
  //     best gear  per slot max(50 * 425, 150 * 0) = 21,250, twice = 42,500
  //     constant   -k * CRlo * CDhi = 0
  //     UB_2 = 42,500
  //
  // and the bound is the smaller. Loose by design: a pool whose crit can swing that far is exactly
  // the case the provably exact mode exists for.
  test("the certificate is the smaller of the two McCormick bounds", () => {
    const got = solvePower(CYCLE_ARGS);
    expect(got.upperBound).toBeCloseTo(30000, 6);
    expect(got.gap).toBeCloseTo(30000 - 12500, 6);
  });

  // The bound has to hold over EVERY assignment, including the mixed build the iteration never
  // reaches. A bound that only covered the builds the rounds happened to visit would certify
  // nothing.
  test("the bound covers the true optimum the iteration never reached", () => {
    expect(solvePower(CYCLE_ARGS).upperBound).toBeGreaterThanOrEqual(13750);
  });

  // When the pool cannot move crit at all the box collapses to a point, both estimators become
  // exact, and the bound is the build's own value. This is the degenerate case the algebra has to
  // survive rather than divide by a zero-width box.
  test("a pool with no crit to gain certifies a zero gap", () => {
    const flat = [item({ id: 1, slot: 1, mainStat: { statId: 4, isFlat: true, value: 30 } })];
    const got = solvePower({
      items: flat, faction: 0, champStats: champStats(), current: flat,
      weights: { b: 0, r: 0, a: 0, s: 1, k: 1 },
    });
    expect(got.builds[0].lin).toBeCloseTo(30, 9);   // s * SPD 30; C.RATE is 0, so no crit term
    expect(got.gap).toBeCloseTo(0, 9);
  });

  // gap is a difference the caller does not have to recompute, and it must match the two fields it
  // is derived from.
  test("gap is upperBound less the best build's lin", () => {
    const got = solvePower(CONVERGE_ARGS);
    expect(got.gap).toBeCloseTo(got.upperBound - got.builds[0].lin, 9);
    expect(got.gap).toBeGreaterThanOrEqual(0);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 4 failing tests — `upperBound` is `0` and `gap` is `0`, the placeholders from Task 8
- [ ] 3. In `power-solve.mjs`, insert the certificate between the round loop and the `builds` assignment
  ```javascript
    // --- the certificate ------------------------------------------------------------------------

    // THE BOX. Gear only ADDS crit — every item stat and every set bonus is non-negative — so the
    // non-gear totals are the floor, and the ceiling is that floor plus the most any assignment can
    // add, which is one exact solve weighting that stat alone. Those two solves are cheap: a set
    // with no crit gets an all-zero column, which build-solve's usefulCounts skips (no increase)
    // and singletonSets skips (bonus[1] > 0 fails), so plan enumeration collapses onto the crit
    // sets alone rather than walking all 41.
    const maxGear = (stat) => {
      const index = buildIndex(items, faction, (item) => vectorOf.get(item)[stat]);
      const bonusAt = new Map([...setVecs]
        .map(([setId, vectors]) => [setId, vectors.map((v) => v[stat])]));
      const ranked = solve(index, bonusAt, { top: 1 });
      return ranked.length ? ranked[0].score : 0;
    };
    const CRlo = nonGear["C.RATE"];
    const CDlo = nonGear["C.DMG"];
    const CRhi = CRlo + maxGear("C.RATE");
    const CDhi = CDlo + maxGear("C.DMG");

    // McCORMICK. With x = C.RATE in [CRlo, CRhi] and y = 100 + C.DMG in [Dlo, Dhi], both
    // (CRhi - x)(y - Dlo) >= 0 and (x - CRlo)(Dhi - y) >= 0, which rearrange to
    //
    //   x*y <= CRhi*y + Dlo*x - CRhi*Dlo        and        x*y <= CRlo*y + Dhi*x - CRlo*Dhi
    //
    // valid for EVERY build. Each is AFFINE in the build's C.RATE and C.DMG, so each is the crit
    // term of a linearization plus a constant — the first at (crRef, cdRef) = (CRhi, CDlo), the
    // second at (CRlo, CDhi). Substituting y = 100 + C.DMG, that constant is -k * crRef * cdRef in
    // both cases, so each bound is ONE MORE call of the same solve, with a scalar correction. No
    // bespoke machinery, which is the whole reason the references are written this way round.
    const upperAt = (crRef, cdRef) => {
      const linWeights = linearizedWeights(weights, crRef, cdRef);
      const ranked = solveAt(linWeights, 1);
      const gear = ranked.length ? ranked[0].score : 0;
      return dot(linWeights, nonGear) + gear - weights.k * crRef * cdRef;
    };
    const upperBound = Math.min(upperAt(CRhi, CDlo), upperAt(CRlo, CDhi));
  ```
- [ ] 4. Delete the `void nonGear;` line — `maxGear` and `upperAt` both read it now, so it is the last of the Task 8 placeholders to go
- [ ] 5. Replace the `return` statement with one that reports the certificate
  ```javascript
    return { builds, rounds, converged, upperBound, gap: upperBound - builds[0].lin };
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 38 passed, 0 failed
- [ ] 7. Confirm no `void` placeholders survive: `grep -n "void " oracle/analytics/power-solve.mjs`
     Expected: no matches. A surviving one means a parameter or local is still unread, which is a wiring bug.
- [ ] 8. Confirm the gap is **not** clamped: `grep -n "gap" oracle/analytics/power-solve.mjs`
     Expected: `gap: upperBound - builds[0].lin` and nothing that floors it with `Math.max(0, …)`. A negative gap means a violated assumption and has to stay visible; clamping would hide it.
- [ ] 9. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 10. Run the whole suite to confirm nothing else regressed: `npm test`
     Expected: all tests pass, 0 failures
- [ ] 11. Commit: `git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve.test.mjs`
- [ ] 12. Commit: `git commit -m "#45 power-solve: certify the gap with a McCormick upper bound"`

---

## Chunk E — Property, coverage and performance tests

### Task 16: The four properties against an independent brute force

**Files:**

- Test: `oracle/analytics/__tests__/power-solve.prop.test.mjs` (Create)

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/power-solve.prop.test.mjs` with the header, the time-budget constants and the tolerance helper
  ```javascript
  // oracle/analytics/__tests__/power-solve.prop.test.mjs
  // solvePower makes two checkable claims: that the certificate really is an upper bound over every
  // assignment, and that its answer is in the pool and never below the worn gear. On instances
  // small enough to enumerate exhaustively both are checkable directly — so check them, against a
  // brute force that goes through champion-stats.mjs and power-model.mjs and touches nothing in the
  // module under test.
  import { test, expect } from "vitest";
  import fc from "fast-check";
  import { solvePower } from "../power-solve.mjs";
  import { STATS, statBreakdown } from "../champion-stats.mjs";
  import { lin } from "../power-model.mjs";
  import { SET_BONUSES, setBonusTotals } from "../set-bonuses.mjs";

  // vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
  // workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
  // timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
  // runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
  // is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
  const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
  const PARAMS = process.env.FC_NUM_RUNS
    ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
    : { numRuns: NUM_RUNS };

  // A relative tolerance, IN THE TEST ONLY. solvePower and the brute force sum the same terms in
  // different orders, so they agree mathematically and can differ in the last bits. Nothing inside
  // power-solve.mjs has a tolerance — build-solve compares scores exactly, and smearing an epsilon
  // into the solver would hide a real ordering bug instead of surfacing it here.
  const TOL = 1e-9;
  const noLessThan = (a, b) => a >= b - TOL * Math.max(1, Math.abs(b));

  // Five slots, so the exhaustive search below is at most 3^5 = 243 builds. All non-accessory, so
  // the faction lock never fires and which five slots they are is not a distinction any of
  // buildIndex, solve or the brute force can make.
  const SLOT_IDS = [1, 2, 3, 4, 5];
  ```
- [ ] 2. Append the item factory and the stat generator
  ```javascript
  // Non-negative throughout, and that is load-bearing rather than tidy. Every stat a piece or a set
  // adds is then non-negative, so C.RATE and 100 + C.DMG both only grow and the crit PRODUCT grows
  // with them — a piece can never lower the objective, which is what makes the full-build
  // enumeration below the optimum. One negative anywhere and the best build might have an empty
  // slot the brute force never visits.
  const statsArb = fc.record({
    HP: fc.integer({ min: 0, max: 2000 }),
    ATK: fc.integer({ min: 0, max: 200 }),
    DEF: fc.integer({ min: 0, max: 200 }),
    SPD: fc.integer({ min: 0, max: 30 }),
    "C.RATE": fc.integer({ min: 0, max: 30 }),
    "C.DMG": fc.integer({ min: 0, max: 60 }),
    RES: fc.integer({ min: 0, max: 40 }),
    ACC: fc.integer({ min: 0, max: 40 }),
  });

  // A real decoded-artifact Item whose vector is exactly `stats`. HP, ATK and DEF go in FLAT so the
  // vector is the drawn numbers rather than a percentage of a base the generator also draws — the
  // property is about the solver, not about re-deriving contribution's percent branch, which
  // power-solve.test.mjs pins directly.
  const mkItem = (id, slot, set, stats) => ({
    id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 1, isFlat: true, value: stats.HP },
    substats: [
      { statId: 2, isFlat: true, rolls: 0, value: stats.ATK, glyph: 0 },
      { statId: 3, isFlat: true, rolls: 0, value: stats.DEF, glyph: 0 },
      { statId: 4, isFlat: true, rolls: 0, value: stats.SPD, glyph: 0 },
      { statId: 5, isFlat: false, rolls: 0, value: stats["C.RATE"], glyph: 0 },
      { statId: 6, isFlat: false, rolls: 0, value: stats["C.DMG"], glyph: 0 },
      { statId: 7, isFlat: true, rolls: 0, value: stats.RES, glyph: 0 },
      { statId: 8, isFlat: true, rolls: 0, value: stats.ACC, glyph: 0 },
    ],
    ascStat: null, ascLevel: 0, equippedChampId: 0,
  });
  ```
- [ ] 3. Append the set draw, read off the real table
  ```javascript
  // The crit sets the generator leans on, with the piece count at which each FIRST pays anything
  // READ OFF set-bonuses.mjs rather than typed in. 5 and 6 are two-piece stackers and 60 (Slayer)
  // pays from a single piece — and keeping the threshold derived is what stops the coverage floor
  // below drifting away from the table if a patch moves a tier.
  const CRIT_SETS = [5, 6, 60];
  const ALL_SET_IDS = Object.keys(SET_BONUSES).map(Number);
  const firstPayingCount = (setId) => {
    for (let n = 1; n <= 9; n++) if (setBonusTotals(new Map([[setId, n]])).size > 0) return n;
    return Infinity;
  };

  // Weighted toward the crit sets so an instance often COMPLETES one. Five slots drawing flat over
  // 41 sets would complete a crit set only by accident, and the crit term is the whole reason this
  // solver is not just build-solve. Set 0 is setless and carries no bonus at all.
  const setArb = fc.oneof(
    { arbitrary: fc.constantFrom(...CRIT_SETS), weight: 6 },
    { arbitrary: fc.constantFrom(...ALL_SET_IDS), weight: 2 },
    { arbitrary: fc.constant(0), weight: 1 },
  );
  ```
- [ ] 4. Append the instance generator and its two derivations
  ```javascript
  // One list of items PER SLOT rather than a flat array whose slots are drawn at random, so an
  // instance can pile a set into enough slots to complete it. At most three items a slot.
  const instance = fc.record({
    perSlot: fc.array(
      fc.array(fc.record({ set: setArb, stats: statsArb }), { minLength: 1, maxLength: 3 }),
      { minLength: 1, maxLength: SLOT_IDS.length },
    ),
    // Positive, as weightsFor always returns. Small integers rather than doubles, so an instance
    // that fails can be read by hand instead of through fifteen significant digits.
    weights: fc.record({
      b: fc.integer({ min: 1, max: 20 }),
      r: fc.integer({ min: 1, max: 20 }),
      a: fc.integer({ min: 1, max: 20 }),
      s: fc.integer({ min: 1, max: 20 }),
      k: fc.integer({ min: 1, max: 20 }),
    }),
    base: statsArb,
    loreOfSteel: fc.constantFrom(0, 0.15),
    // Which item each slot is currently wearing, or none when the draw is -1: a copy can have an
    // empty slot, and the worn build is then NOT one of the full builds the brute force enumerates.
    wornPick: fc.array(fc.integer({ min: -1, max: 2 }),
      { minLength: SLOT_IDS.length, maxLength: SLOT_IDS.length }),
  });

  // `current` is drawn from `items` BY REFERENCE, not rebuilt. solvePower's documented assumption
  // is that the worn gear is in the pool, and every bound rests on it: the crit box is the non-gear
  // totals plus the most any assignment of `items` can add, so a worn piece absent from the pool
  // could sit outside that box and make `gap` negative.
  const vaultOf = (spec) => {
    const items = spec.perSlot.flatMap((specs, i) =>
      specs.map((s, j) => mkItem(i * 10 + j + 1, SLOT_IDS[i], s.set, s.stats)));
    const bySlot = new Map();
    for (const it of items) {
      if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
      bySlot.get(it.slot).push(it);
    }
    const current = [];
    spec.perSlot.forEach((specs, i) => {
      const inSlot = bySlot.get(SLOT_IDS[i]);
      const pick = spec.wornPick[i];
      if (pick >= 0 && pick < inSlot.length) current.push(inSlot[pick]);
    });
    return { items, current };
  };

  const champStatsOf = (spec) => ({
    base: { ...spec.base },
    sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
    observedSets: new Map(), loreOfSteel: spec.loreOfSteel, awaken: 0,
  });
  ```
- [ ] 5. Append the independent totals helper and the brute force
  ```javascript
  // The stat model's columns summed WITHOUT rounding. This is the INDEPENDENT second implementation
  // of buildTotals: it goes through champion-stats.mjs and nothing in power-solve.mjs, so the
  // property compares two implementations rather than one against itself.
  const totalsVia = (champStats, items) => {
    const { columns } = statBreakdown(champStats, items);
    return Object.fromEntries(STATS.map((stat) =>
      [stat, columns.reduce((sum, [, v]) => sum + v[stat], 0)]));
  };

  // Every combination of one item per populated slot, scored on the TRUE objective. Filling every
  // slot loses nothing: every stat a piece adds is non-negative, so C.RATE and 100 + C.DMG both
  // only grow and the crit product grows with them — a piece can never lower the objective, so the
  // best FULL build is the best build, and the worn build with an empty slot cannot beat it.
  //
  // Push/pop rather than a fresh array per node, because the coverage test below runs this shape
  // two thousand times.
  function bruteForceBest(items, champStats, weights) {
    const bySlot = new Map();
    for (const it of items) {
      if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
      bySlot.get(it.slot).push(it);
    }
    const slots = [...bySlot.keys()].sort((a, b) => a - b);
    const chosen = [];
    let best = -Infinity;
    const walk = (i) => {
      if (i === slots.length) {
        best = Math.max(best, lin(totalsVia(champStats, chosen), weights));
        return;
      }
      for (const it of bySlot.get(slots[i])) {
        chosen.push(it);
        walk(i + 1);
        chosen.pop();
      }
    };
    walk(0);
    return best;
  }
  ```
- [ ] 6. Append the single property, with all four assertions in one `fc.property` so each instance pays for one brute force and one `solvePower`
  ```javascript
  // Measured locally: MEASURED_PROPERTY s at the default 300 runs. (Replaced with the real figure
  // in step 10.)
  //
  // All four assertions live in ONE property so an instance runs the brute force and the solver
  // once between them, rather than four times over four properties drawing four different vaults.
  test("the certificate bounds the optimum and the answer never drops below the worn gear", () => {
    fc.assert(
      fc.property(instance, (spec) => {
        const { items, current } = vaultOf(spec);
        const champStats = champStatsOf(spec);
        const { weights } = spec;
        const optimum = bruteForceBest(items, champStats, weights);
        const got = solvePower({ items, faction: 0, champStats, current, weights });
        const wornLin = lin(totalsVia(champStats, current), weights);

        expect(noLessThan(got.upperBound, optimum),
          `upperBound ${got.upperBound} must bound the optimum ${optimum}`).toBe(true);
        expect(noLessThan(optimum, got.builds[0].lin),
          `the answer ${got.builds[0].lin} cannot beat the optimum ${optimum}`).toBe(true);
        expect(noLessThan(got.builds[0].lin, wornLin),
          `the answer ${got.builds[0].lin} cannot be below the worn gear ${wornLin}`).toBe(true);
        expect(noLessThan(got.gap, 0), `the gap ${got.gap} cannot be negative`).toBe(true);
      }),
      PARAMS,
    );
  }, 60_000);
  ```
- [ ] 7. Run the property test: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 1 passed. A failure here is a real defect in Chunks C or D — read the printed instance and the assertion message before changing the test.
- [ ] 8. Confirm the property is not vacuous by mutating the solver temporarily: in `power-solve.mjs`, change `const upperBound = Math.min(…)` to `const upperBound = Math.min(…) * 0.5;` and re-run
     Expected: FAIL on the `upperBound must bound the optimum` assertion
- [ ] 9. Revert that mutation and re-run: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 1 passed
- [ ] 10. Confirm the round-0 seeding is load-bearing under the property: temporarily change `const start = record(current);` to `const start = { items: [], totals: nonGear, lin: lin(nonGear, weights) };` so the worn gear never enters the pool, and re-run
     Expected: FAIL on the `cannot be below the worn gear` assertion
- [ ] 11. Revert that mutation and re-run: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 1 passed
- [ ] 12. Record both mutation results in a comment directly above the property, replacing the `MEASURED_PROPERTY` line's neighbours — the house style is to show the property is not vacuous
  ```javascript
  // Two mutations were run against this property to show it is not vacuous. Halving upperBound
  // fails the bound assertion; dropping the worn gear from the pool fails the never-worse one.
  ```
- [ ] 13. Read the duration vitest printed for the test and replace the literal `MEASURED_PROPERTY` in the comment with it, to one decimal place
- [ ] 14. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 15. Commit: `git add oracle/analytics/__tests__/power-solve.prop.test.mjs`
- [ ] 16. Commit: `git commit -m "#45 power-solve: property-test the certificate against a brute force"`

### Task 17: Generator coverage floor

**Files:**

- Test: `oracle/analytics/__tests__/power-solve.prop.test.mjs` (Modify)

**Steps:**

- [ ] 1. Append the coverage test to `power-solve.prop.test.mjs`
  ```javascript
  // The generator IS the test. When it narrows, nothing else here complains — which is how a
  // property file can come to draw setless pieces only while claiming to exercise a crit-set
  // solver. So the state the property exists to cover is asserted REACHABLE rather than left to
  // inspection.
  //
  // Unseeded and sampled wide on purpose: a fixed seed would make the floor below hostage to
  // fast-check changing how it generates between versions.
  //
  // Measured locally: MEASURED_COVERAGE of 2,000 instances complete some crit set, in
  // MEASURED_COVERAGE_TIME s. (Both replaced with the real figures in step 4.)
  test("the generator reaches a completed crit set often enough to count as covered", () => {
    let hits = 0;
    for (const spec of fc.sample(instance, 2000)) {
      const { items } = vaultOf(spec);
      // How many DISTINCT slots could supply each crit set — the same quantity build-solve's
      // slotsSupplying works from, and what decides whether a set is completable at all.
      const supply = new Map(CRIT_SETS.map((setId) => [setId, new Set()]));
      for (const it of items) if (supply.has(it.set)) supply.get(it.set).add(it.slot);
      if (CRIT_SETS.some((setId) => supply.get(setId).size >= firstPayingCount(setId))) hits++;
    }
    // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
    // covered by the 300 instances the property above actually runs. At 5% it is hit a dozen times
    // or more in a default run, and hundreds of times in a fuzz shard.
    expect(hits, "a completed crit set is generated too rarely to count as covered")
      .toBeGreaterThan(100);
  }, 60_000);
  ```
- [ ] 2. Run the coverage test: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 2 passed. The floor should clear by a wide margin — set 60 pays from a single piece and the crit draw is weighted 6-in-9, so most instances hit.
- [ ] 3. Confirm the floor is not a near miss: temporarily change `.toBeGreaterThan(100)` to `.toBeGreaterThan(1900)` and re-run to read the actual hit count off the failure message, then restore `100`
     Expected: the failure message names the real count. If it is below ~400, the `setArb` weighting has drifted and must be raised before restoring the floor.
- [ ] 4. Replace `MEASURED_COVERAGE` with the hit count from step 3 and `MEASURED_COVERAGE_TIME` with the duration vitest printed
- [ ] 5. Run both tests in the file: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 2 passed, 0 failed
- [ ] 6. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 7. Commit: `git add oracle/analytics/__tests__/power-solve.prop.test.mjs`
- [ ] 8. Commit: `git commit -m "#45 power-solve: hold the generator to a crit-set coverage floor"`

### Task 18: Full-vault performance test

**Budget analysis the implementer should know before running it.** `build-solve.prop.test.mjs:238-242` measured **188,061 plans and 9.7 s** for one `solve` on a full-size index. `solvePower` runs **one full enumeration per round plus the two the certificate needs** — the two single-stat box solves collapse onto the crit sets and cost almost nothing. With a random vault the iteration converges in about two rounds, so expect **four full solves, roughly 40 s**. That is inside the 60 s timeout and above the 30 s target, which the issue explicitly permits.

The vault below gives each set its **real slot eligibility**: the 28 stacking sets are artifact-only (`speed-sets.mjs:8-9` — "the classic sets here are artifact-only, so they cap at 6 pieces"), the 13 nine-slot tiered sets roll on accessories too. That is the same plan-space shape `build-solve`'s perf case measured, and it is the honest one: putting a two-piece stacker in an accessory slot would enumerate plans the game cannot build.

**Files:**

- Test: `oracle/analytics/__tests__/power-solve.prop.test.mjs` (Modify)

**Steps:**

- [ ] 1. Append the set-shape constants and the LCG to `power-solve.prop.test.mjs`
  ```javascript
  // The real table's two shapes at their real slot eligibility. Read off SET_BONUSES rather than
  // listed, so a set added by a patch joins the vault instead of being silently absent.
  const STACK_SETS = Object.entries(SET_BONUSES)
    .filter(([, row]) => row.kind === "stack").map(([id]) => Number(id));
  const TIERED_SETS = Object.entries(SET_BONUSES)
    .filter(([, row]) => row.kind === "tiered").map(([id]) => Number(id));

  // A deterministic 32-bit LCG. The wall time recorded below only means something if the vault is
  // identical every run, and seeding fast-check for nine thousand items would be heavier than this.
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  ```
- [ ] 2. Append the performance test
  ```javascript
  // Measured locally: MEASURED_PERF s wall, against a 30 s TARGET and the 60 s timeout that is the
  // actual pass condition. The budget is dominated by FOUR full plan enumerations — one per round,
  // plus the two the certificate needs — at roughly 10 s each. The two box solves weight a single
  // stat, so every set with no crit gets an all-zero column that build-solve's usefulCounts and
  // singletonSets both skip, and their enumeration collapses onto the crit sets.
  //
  // A plain seeded test, NOT an fc.property, so FC_NUM_RUNS does not multiply it. It therefore
  // costs the same on every `npm test` and on each of the ten fuzz shards every fifteen minutes —
  // a known and accepted charge on the local gate, matching build-solve.prop.test.mjs's own.
  test("a full-size vault solves inside the time budget", () => {
    const rand = lcg(20261003);
    const FACTIONS = 16;
    const FACTION = 3;
    const items = [];
    let id = 0;
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const isAccessory = slot >= 7;
      const eligible = [0, ...TIERED_SETS, ...(isAccessory ? [] : STACK_SETS)];
      for (let n = 0; n < 1000; n++) {
        const stats = {
          HP: Math.floor(rand() * 2000), ATK: Math.floor(rand() * 200),
          DEF: Math.floor(rand() * 200), SPD: Math.floor(rand() * 30),
          "C.RATE": Math.floor(rand() * 30), "C.DMG": Math.floor(rand() * 60),
          RES: Math.floor(rand() * 40), ACC: Math.floor(rand() * 40),
        };
        const set = eligible[Math.floor(rand() * eligible.length)];
        const piece = mkItem(++id, slot, set, stats);
        piece.isAccessory = isAccessory;
        piece.faction = isAccessory ? Math.floor(rand() * FACTIONS) : 0;
        items.push(piece);
      }
    }
    const champStats = {
      base: { HP: 20000, ATK: 1500, DEF: 1200, SPD: 100,
        "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 },
      sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
      observedSets: new Map(), loreOfSteel: 0.15, awaken: 0,
    };
    // A real role-default weight row, so the linearization has the magnitudes it will meet in use.
    const weights = { b: 0.0122, r: 0.277, a: 0.0387, s: 0.022, k: 0.00154 };

    // One worn piece per slot, drawn from the vault BY REFERENCE and through the faction lock, so
    // solvePower's documented assumption holds.
    const current = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) =>
      items.find((it) => it.slot === slot && (!it.isAccessory || it.faction === FACTION)));
    expect(items).toHaveLength(9000);
    expect(current.filter(Boolean)).toHaveLength(9);

    const started = Date.now();
    const got = solvePower({ items, faction: FACTION, champStats, current, weights });
    const elapsed = Date.now() - started;

    expect(got.builds).toHaveLength(1);
    expect(got.builds[0].items.map((it) => it.slot).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(got.rounds).toBeGreaterThanOrEqual(1);
    // Recomputed from the items returned through the INDEPENDENT stat model, so this checks the
    // reported lin rather than reading back whatever solvePower put in the field.
    expect(got.builds[0].lin)
      .toBeCloseTo(lin(totalsVia(champStats, got.builds[0].items), weights), 6);
    expect(noLessThan(got.gap, 0)).toBe(true);
    expect(noLessThan(got.builds[0].lin, lin(totalsVia(champStats, current), weights))).toBe(true);
    // The pass condition is this test's 60 s timeout; asserting it here names the budget at the
    // point a reader is looking at the number, rather than leaving it implicit in the timeout.
    expect(elapsed).toBeLessThan(60_000);
  }, 60_000);
  ```
- [ ] 3. Run the performance test alone and read its duration: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs -t "full-size vault"`
     Expected: 1 passed. Note the duration vitest prints.
- [ ] 4. If the duration exceeded ~50 s, reduce the vault to 500 items per slot (`n < 500`) and re-run. Item count drives only `buildIndex`, not plan enumeration, so this will **not** help materially — if it is still over, the lever is the set mix: drop the 5 four-piece stacking sets from `STACK_SETS` with a comment saying the enumeration budget forced it, and re-measure.
     Expected: under 60 s. Record whichever shape was kept.
- [ ] 5. Replace the literal `MEASURED_PERF` with the duration from step 3 (or step 4), to one decimal place, and state in that comment whether the 30 s target was met
- [ ] 6. Run all three tests in the file: `npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 3 passed, 0 failed
- [ ] 7. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 8. Commit: `git add oracle/analytics/__tests__/power-solve.prop.test.mjs`
- [ ] 9. Commit: `git commit -m "#45 power-solve: performance-test a full-size vault"`

---

## Chunk F — Header, changelog and the gate

### Task 19: The module header

Documentation only, so the TDD cycle does not apply — but the verification step does. The four points are an acceptance criterion, so the text is given in full rather than described.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Replace the placeholder first line of `power-solve.mjs` (`// oracle/analytics/power-solve.mjs — header completed in Task 19.`) with the full header, keeping the four `import` lines that follow it untouched
  ```javascript
  // oracle/analytics/power-solve.mjs
  //
  // The gear assignment, out of the whole vault, that maximizes a champion's in-game POWER. The
  // default mode: linearize the crit term, solve exactly, iterate to a fixed point, and certify how
  // far the answer could still be from the maximum. The provably exact search is a separate mode.
  //
  // WHY MAXIMIZING `lin` MAXIMIZES POWER. power-model.mjs gives power = (lin + c)^2, where `lin` is
  // a weighted sum of stat totals and `c` is a property of the COPY that no gear change can move.
  // Squaring is increasing on the non-negative reals, so ranking builds by (lin + c)^2 is ranking
  // them by lin + c, and ranking them by lin + c is ranking them by lin. That argument needs
  // lin + c > 0, which holds for every build this module reports: the candidate pool is seeded with
  // the gear already worn, whose power is an observed in-game number and therefore positive, and
  // every build reported scores at or above it. So `c` never enters this module at all, and a
  // caller does not have to measure one to rank builds.
  //
  // THE LINEARIZATION. `lin` is additive over pieces and over set bonuses in every term but one:
  // k * C.RATE * (100 + C.DMG) is a PRODUCT of two build totals, so a piece's crit value depends on
  // what the other eight slots hold, and no per-item value can express it. Freeze C.RATE and C.DMG
  // at reference levels and that term splits into two per-stat scalars — C.RATE weighted by
  // k * (100 + cdRef) and C.DMG by k * crRef — leaving an objective that is a per-item value plus a
  // per-(set, count) bonus, which is exactly what build-solve.mjs solves exactly. So: linearize at
  // the gear already worn, solve exactly, re-linearize at the answer, and repeat.
  //
  // A FIXED POINT, NOT AN OPTIMUM. When the iteration stops because the build stopped changing
  // (`converged`), the answer is a fixed point of that map — the exact optimum of the objective
  // linearized at its own crit totals. That is NOT the optimum of the true objective, and nothing
  // here claims it is. The iteration can also CYCLE between two builds, or run out at `maxRounds`,
  // and then there is no fixed point either; both report `converged: false`. In every case the
  // answer is the best build on the TRUE objective out of every build any round produced, plus the
  // gear already worn as round 0 — which is what makes it never worse than what the champion is
  // wearing. Without that seed a cycle can end on a build below the worn gear, and the answer would
  // be a downgrade reported as an improvement.
  //
  // WHAT IS PROVED. `upperBound` is a genuine upper bound on the true objective over EVERY
  // assignment of this vault, so `gap` is a proven ceiling on how much the answer could be
  // improved — "within X of the maximum", never "the maximum". It comes from McCormick estimators
  // of the crit product over the box of C.RATE and C.DMG the vault can actually reach, each of
  // which is affine and therefore one more exact solve. The bound is LOOSE exactly when that box is
  // wide — a champion whose crit can swing from almost nothing to a fully stacked double-crit build
  // — and a wide `gap` is the signal to pay for the provably exact mode instead of trusting this
  // one.
  //
  // `current` IS ASSUMED DRAWN FROM `items`. Every bound rests on it: the crit box is the non-gear
  // totals plus the most any assignment of `items` can add, so a worn piece that is not in the pool
  // could sit outside that box and make `gap` negative rather than zero. Not checked, because the
  // one precondition worth paying for on every call is the weights; a vault that omits worn gear is
  // a caller bug upstream of here.
  ```
- [ ] 2. Verify the header covers point 1 — why maximizing `lin` maximizes power: `grep -n "WHY MAXIMIZING" oracle/analytics/power-solve.mjs`
     Expected: one match
- [ ] 3. Verify point 2 — the linearization: `grep -n "THE LINEARIZATION" oracle/analytics/power-solve.mjs`
     Expected: one match
- [ ] 4. Verify point 3 — fixed point when converged, never proved optimal: `grep -n "A FIXED POINT, NOT AN OPTIMUM" oracle/analytics/power-solve.mjs`
     Expected: one match
- [ ] 5. Verify point 4 — the certificate is a proven bound, loose on a wide crit range: `grep -n "WHAT IS PROVED" oracle/analytics/power-solve.mjs`
     Expected: one match
- [ ] 6. Confirm the six exports are all present and named as the issue requires: `grep -n "^export" oracle/analytics/power-solve.mjs`
     Expected: exactly six lines — `linearizedWeights`, `itemVector`, `setVectors`, `nonGearTotals`, `buildTotals`, `solvePower`. Any leftover `export const … = () => { throw new Error("not implemented"); };` stub from Task 2 is a bug; delete it.
- [ ] 7. Run the unit tests: `npx vitest run oracle/analytics/__tests__/power-solve.test.mjs`
     Expected: 38 passed, 0 failed
- [ ] 8. Run lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 9. Commit: `git add oracle/analytics/power-solve.mjs`
- [ ] 10. Commit: `git commit -m "#45 power-solve: document the linearization, the fixed point and the bound"`

### Task 20: Changelog entry

**Files:**

- Modify: `CHANGELOG.md`

**Steps:**

- [ ] 1. Read the current `## [Unreleased]` → `### Added` block to confirm the entry format: `grep -n "minor" CHANGELOG.md`
     Expected: four existing `- [minor] Add …(#NN)` lines, the last ending `(#44)`
- [ ] 2. Add one line to the **end** of the `### Added` list under `## [Unreleased]`, directly after the `(#44)` entry
  ```markdown
  - [minor] Add `oracle/analytics/power-solve.mjs`: the gear assignment that maximizes a champion's in-game power, out of the whole vault. Power's crit term is a product of two build totals, so the solver freezes it at reference levels, solves exactly with `build-solve.mjs`, re-linearizes at the answer and iterates to a fixed point — then certifies the result with a McCormick upper bound, so the output says how far from the maximum it could be rather than claiming optimality. The gear already worn is always in the candidate pool, so the answer is never a downgrade (#45)
  ```
- [ ] 3. Confirm no other section of the changelog was touched: `git diff --stat CHANGELOG.md`
     Expected: `1 file changed, 1 insertion(+)`
- [ ] 4. Commit: `git add CHANGELOG.md`
- [ ] 5. Commit: `git commit -m "#45 docs: changelog for the power solver"`

### Task 21: The full gate

**Files:**

- None (verification only)

**Steps:**

- [ ] 1. Build: `npm run build`
     Expected: three workspace builds succeed, exit 0
- [ ] 2. Full test suite: `npm test`
     Expected: all tests pass, 0 failures. The three new files contribute 38 unit tests plus 3 property/perf tests.
- [ ] 3. Lint: `npm run lint`
     Expected: no output, exit 0
- [ ] 4. Confirm the fuzz-shard path works, since the scheduled workflow runs the whole suite at a raised run count. Run the property file alone at a high count: `FC_NUM_RUNS=5000 npx vitest run oracle/analytics/__tests__/power-solve.prop.test.mjs`
     Expected: 3 passed. The property picks up `interruptAfterTimeLimit: 50_000` and stops at 50 s with a pass rather than running past vitest's 60 s birpc limit.
- [ ] 5. Confirm nothing outside the four planned files changed: `git status --short`
     Expected: clean working tree (every task committed)
- [ ] 6. Review the full diff against `main`: `git diff --stat main...HEAD`
     Expected: exactly four files — `CHANGELOG.md`, `oracle/analytics/power-solve.mjs`, `oracle/analytics/__tests__/power-solve.test.mjs`, `oracle/analytics/__tests__/power-solve.prop.test.mjs`, plus the two `docs/plans/ai/issue-45-*.md` documents
- [ ] 7. Confirm every measured-time placeholder was replaced: `grep -rn "MEASURED_" oracle/analytics/__tests__/`
     Expected: no matches. A surviving `MEASURED_PROPERTY`, `MEASURED_COVERAGE`, `MEASURED_COVERAGE_TIME` or `MEASURED_PERF` means an acceptance criterion is unmet.

---

## Acceptance Criteria Traceability

| Criterion | Tasks |
|---|---|
| Exports `itemVector`, `setVectors`, `nonGearTotals`, `buildTotals`, `linearizedWeights`, `solvePower` | 2, 3, 4, 5, 6, 8; verified in 19 step 6 |
| The weights precondition is checked | 8 |
| The current build is seeded into the pool and counts as round 0 | 9, 13 |
| The round's best is chosen on the true objective | 10 (the `scored.lin` comparison), 14 |
| `builds` is the top distinct sets of items of the whole pool | 13, 14 |
| Convergence, cycle and `maxRounds` stop as specified | 10, 11, 12 |
| The McCormick certificate gives `upperBound` and `gap` | 15 |
| Lore of Steel scales every set's bonus, applied once | 4 |
| The header covers the four listed points | 19 |
| Every Change-2 test passes, including the four properties, the coverage floor, `maxRounds` and never-worse | 10–18 |
| Property and coverage tests follow the time budget | 16 step 1, 17 step 1, 21 step 4 |
| The performance test passes within 60 s with the measured time recorded | 18 |
| `npm run build`, `npm test`, `npm run lint` pass | 1, 21 |

---

## Self-Review

- Every change in the issue maps to a task; the traceability table above is the check.
- Every task names exact file paths and gives complete code blocks — no "similar to above", no TODOs.
- Every implementation step has a matching `npx vitest run …` or `npm run lint` step with an expected result.
- The TDD ladder is genuine: Tasks 10–14 each have a RED that the previous task's implementation cannot satisfy, and the two places where a test passes on first run (Task 12's `maxRounds: 0`, Task 13's extensions to earlier tests) say so explicitly instead of manufacturing a fake failure.
- Task 19 and Task 20 are documentation-only and are marked TDD-exempt, but both carry verification steps.
- Each of the four files has one responsibility: the module, the unit tests, the property/perf tests, the changelog line.

## Concerns To Flag

1. **Scope:** this is a single subsystem (`oracle/analytics`), not a multi-subsystem issue. No split is warranted.
2. **TDD exemption:** Tasks 19 and 20 are documentation and configuration, which the TDD reference lists as exceptions. Both still have verification steps.
3. **Performance is the one open risk.** The 60 s pass condition depends on four full plan enumerations at roughly 10 s each, extrapolated from `build-solve`'s own measured 9.7 s on an identically shaped index. It was not measured during planning — no `node` or `npx` was available in the plan phase. Task 18 step 4 carries the contingency if the measurement comes in over budget.
4. **`gap` is deliberately not clamped at zero** (Task 15 step 6). A negative gap means the `current ⊆ items` assumption was violated, and that has to stay visible. The property test asserts `gap ≥ 0` within a relative tolerance, so a real violation fails loudly.
5. **The `setBonusTotals` vs `setBonusTerms` contradiction** between `set-bonuses.mjs:129-131` and `champion-stats.mjs:11-17` is already adjudicated in favour of `setBonusTotals` for the Total Stats screen. Task 4's implementation comment records why, so a later reader does not "fix" it back.
6. **`solvePower` is published with its full signature from Task 8 onward**, before every parameter is read. The plan uses explicit `void` statements rather than an eslint-disable, and narrows them in Tasks 10, 12 and 15 as each name is consumed, so `npm run lint` is green at every commit. Task 15 step 7 verifies none survive.
7. **Task 2 creates five throwing export stubs** so the test file's import resolves while only `linearizedWeights` is real. Tasks 3–6 and 8 each delete the stub they replace, and Task 19 step 6 verifies exactly six real exports remain. If a stub survived, its export would throw `not implemented` at runtime for a caller.
