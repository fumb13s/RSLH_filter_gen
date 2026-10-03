# Power solver `--exact` Implementation Plan

**Goal:** Add an opt-in `solvePowerExact` to `oracle/analytics/power-solve.mjs` that returns the provable maximum of the true power objective (crit product included) over every gear assignment of the vault, and expose it as `power.mjs --exact`.

**Architecture:** The default `solvePower` iterates a linearization of `k·C.RATE·(100 + C.DMG)` to a fixed point and certifies it with a McCormick upper bound. The exact mode keeps that answer as an **incumbent**, then (a) screens `build-solve.mjs`'s whole set-plan space with a per-plan McCormick bound — reporting `plansTotal`/`plansPruned`, and skipping the search outright when every plan falls below the incumbent — and (b) runs one depth-first **branch-and-bound over full builds**, where each slot's candidates are the Pareto frontier of its `(slot, set)` groups on the only three numbers an item can affect the objective through (non-crit linear value, C.RATE, C.DMG). Each node is pruned against the smaller of three sound ceilings: the issue's `NC⁺ + k·CR⁺·(100 + CD⁺)` product bound and the two McCormick estimators read as affine "lanes". Leaves are scored on the true objective from actual set counts, through the same totals helper the default mode scores its pool with.

**Tech Stack:** Plain Node ESM (`.mjs`) under `oracle/analytics/`, outside the TypeScript project references. Vitest for tests, `fast-check` for property tests. No new dependencies.

---

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Modify | `oracle/analytics/power-solve.mjs` | Add `nonCritWeights`, `solvePowerExact`; factor out `totalsFrom` and `critBox` so both modes share one implementation |
| Modify | `oracle/analytics/power.mjs` | `--exact` parsing (`exact`, `topGiven`), `formatProven`, the `printCopy` branch, header usage block |
| Modify | `oracle/analytics/README.md` | `--exact` in the `power.mjs` usage block and a paragraph under it |
| Modify | `CHANGELOG.md` | One `[minor]` line under `## [Unreleased]` → `### Added` |
| Create | `oracle/analytics/__tests__/power-solve-exact.test.mjs` | Unit tests: precondition, null build, plan counts, the constructed non-optimal fixed point |
| Create | `oracle/analytics/__tests__/power-solve-exact.prop.test.mjs` | fast-check brute-force equality, never-worse-than-`solvePower`, generator coverage, performance |
| Modify | `oracle/analytics/__tests__/power-cli.test.mjs` | `--exact` parser tests, the end-to-end `proven maximum` run, and the `toEqual` default-shape fix |

**Design decisions settled here** (the exploration flagged each as open):

1. **Step 5's scope** — ONE global branch-and-bound over full builds, not a per-plan constrained search. The plan pass (steps 3–4) is a cheap global screen that can prove optimality with no search at all; a per-plan search would need the naming-plan predicate, which is a property of a *complete* build and therefore cannot prune mid-branch, so it would re-walk the whole space once per surviving plan.
2. **Dominance** — the **weak** rule with an id tiebreak: drop `X` when some `Y` of the same `(slot, set)` has `Y ≥ X` on all three keys and (`Y > X` on some key, or `Y.id < X.id`). Exactly one member of an all-equal group survives, the lowest id, as `buildIndex` does.
3. **`plansPruned`** — plans that needed no search, whether unfillable (`assignPlan` → `null`) or bound strictly below the incumbent. `plansTotal` is `enumeratePlans(...).length`, which includes the empty plan.
4. **Empty pool** — `plansTotal: 0, plansPruned: 0`, decided before any plan is enumerated.
5. **The trap fixture** — newly derived below; it needs a non-zero **non-crit** weight. With pure-crit weights a fixed point is provably globally optimal (see Task 5.1's comment), so the existing `CYCLE` fixture cannot serve.

**Commit convention:** every commit message starts `#47 ` and ends with the line `Co-Authored-By: Claude` (no email), per the repo's commit preferences.

---

## Chunk 0: Preflight

### Task 0.1: Build the workspace and record the baseline

**Files:** none (verification only)

**Steps:**

- [ ] 1. Build the TypeScript packages. `packages/core/dist` is absent in a fresh worktree and `power.mjs` imports `@rslh/core`, so the suite fails for an unrelated reason until this runs.
  ```bash
  npm run build
  ```
  Expected: exits 0, `packages/core/dist/` now exists.
- [ ] 2. Record the baseline for the three files this plan touches.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs oracle/analytics/__tests__/power-cli.test.mjs oracle/analytics/__tests__/build-solve.test.mjs
  ```
  Expected: all pass. Note the test counts — Chunk 1 is a refactor and these must stay green and at the same count.
- [ ] 3. Confirm the lint baseline is clean.
  ```bash
  npm run lint
  ```
  Expected: exits 0, no output.

---

## Chunk 1: Shared internals

Three refactors, all guarded by the existing `power-solve.test.mjs`. No new behaviour, so no new tests — but each has a verification step proving the existing suite still passes. (TDD note: these are pure refactors of code that already has tests; the Iron Law applies to new behaviour, which starts in Chunk 2.)

### Task 1.1: Factor `buildTotals` into a cache-taking `totalsFrom`

`solvePowerExact` scores every surviving leaf. `buildTotals` recomputes `nonGearTotals` (a nine-column `statBreakdown`) and `setVectors` (ten `setBonusTotals` calls per set) on every call, which is far too expensive per leaf. Splitting out a cache-taking core means the exact search and the default mode score a build through **one** implementation and can never drift apart on a build's `lin`.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Replace the whole `buildTotals` block (currently lines 130–143, from the `// The unrounded stat totals` comment through the closing brace) with the split version.
  ```javascript
  // The unrounded stat totals of one copy wearing one set of items: what it has before any gear,
  // plus each piece, plus each set's bonus AT THE COUNT THE BUILD HOLDS.
  //
  // Summing per set is exact rather than an approximation: setBonusTerms walks its counts set by
  // set independently, so the sum of each set's own totals is the whole build's set totals.
  //
  // The non-gear part and the two caches are PARAMETERS because solvePowerExact scores a build per
  // leaf and already holds all three; recomputing nonGearTotals and every set's ten-entry tier
  // table per leaf is the difference between a search that finishes and one that does not. One
  // implementation, so the exact search and the default mode can never disagree on a build's score.
  //
  // `vectorOf` is keyed by item IDENTITY and `setVecs` by set id; both must cover every item and
  // every set the build holds. `nonGear` is COPIED rather than mutated, since callers share one.
  function totalsFrom(nonGear, items, vectorOf, setVecs) {
    const out = { ...nonGear };
    for (const item of items) addInto(out, vectorOf.get(item));
    for (const [setId, count] of setCounts(items)) addInto(out, setVecs.get(setId)[count]);
    return out;
  }

  export function buildTotals(champStats, items) {
    const { base, loreOfSteel } = champStats;
    const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
    const setVecs = new Map([...setCounts(items).keys()]
      .map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
    return totalsFrom(nonGearTotals(champStats), items, vectorOf, setVecs);
  }
  ```
- [ ] 2. Verify the arithmetic is unchanged — `buildTotals` has three tests pinning it against `statBreakdown`'s columns summed unrounded, with and without Lore of Steel.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs
  ```
  Expected: all pass, same count as Task 0.1 step 2.

### Task 1.2: Factor the certificate box into `critBox`

The issue's step 2 requires the exact mode to use `CRlo`/`CRhi`/`CDlo`/`CDhi` "exactly as `solvePower`'s certificate computes them". They are currently inline in `solvePower` and neither exported nor returned.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Insert `critBox` immediately above `export function solvePower` (i.e. after the `itemsKey` one-liner at line 164), moving the existing `THE BOX` comment onto it.
  ```javascript
  // THE BOX: the C.RATE and C.DMG every assignment of this pool lies between. Gear only ADDS crit
  // — every item stat and every set bonus is non-negative — so the non-gear totals are the floor,
  // and the ceiling is that floor plus the most any assignment can add, which is one exact solve
  // weighting that stat alone. Those two solves are cheap: a set with no crit gets an all-zero
  // column, which build-solve's usefulCounts skips (no increase) and singletonSets skips
  // (bonus[1] > 0 fails), so plan enumeration collapses onto the crit sets alone rather than
  // walking all 41.
  //
  // Shared by the certificate and by solvePowerExact, which needs the SAME box: a McCormick
  // estimator is an upper bound only over a box that covers every assignment, so a box computed two
  // ways is a bound that holds for one mode and not the other.
  function critBox(items, faction, vectorOf, setVecs, nonGear) {
    const maxGear = (stat) => {
      const index = buildIndex(items, faction, (item) => vectorOf.get(item)[stat]);
      const bonusAt = new Map([...setVecs]
        .map(([setId, vectors]) => [setId, vectors.map((v) => v[stat])]));
      const ranked = solve(index, bonusAt, { top: 1 });
      return ranked.length ? ranked[0].score : 0;
    };
    const CRlo = nonGear["C.RATE"];
    const CDlo = nonGear["C.DMG"];
    return { CRlo, CDlo, CRhi: CRlo + maxGear("C.RATE"), CDhi: CDlo + maxGear("C.DMG") };
  }
  ```
- [ ] 2. In `solvePower`, replace the inline box — the `// --- the certificate ---` divider's following block, from the `// THE BOX.` comment through `const CDhi = CDlo + maxGear("C.DMG");` (currently lines 233–249) — with one call. Keep the `// --- the certificate ---` divider line above it.
  ```javascript
    const { CRlo, CDlo, CRhi, CDhi } = critBox(items, faction, vectorOf, setVecs, nonGear);
  ```
- [ ] 3. Verify the certificate is unchanged — four tests pin `upperBound` and `gap` by hand-computed arithmetic.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs
  ```
  Expected: all pass, including `the certificate is the smaller of the two McCormick bounds` and `a pool with no crit to gain certifies a zero gap`.

### Task 1.3: Extend the `build-solve` import

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Replace the first import line (line 48) so the plan decomposition's two functions are available.
  ```javascript
  import { assignPlan, buildIndex, enumeratePlans, SLOTS, solve } from "./build-solve.mjs";
  ```
- [ ] 2. Verify nothing broke and the new names resolve.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs
  ```
  Expected: all pass.
- [ ] 3. Commit the refactor.
  ```bash
  git add oracle/analytics/power-solve.mjs && git commit -m "#47 power-solve: share one build-totals core and one crit box between the two modes

Co-Authored-By: Claude"
  ```

---

## Chunk 2: `nonCritWeights` and the two edges of `solvePowerExact`

### Task 2.1: `nonCritWeights` — `lin` without its crit product

The search needs an item's non-crit linear value as a single scalar. `linearizedWeights(w, 0, 0)` cannot supply it: at a zero reference its C.RATE scalar is `k * 100`, not 0.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/power-solve-exact.test.mjs` with the fixture preamble and the first failing test. The fixture factories are `power-solve.test.mjs`'s, copied rather than shared — every test file in `oracle/analytics/__tests__/` defines its own.
  ```javascript
  // oracle/analytics/__tests__/power-solve-exact.test.mjs
  //
  // solvePowerExact claims a PROVEN maximum. This file pins the claims a hand-built instance can
  // show directly: the precondition, the empty-pool answer, the plan counts, and the constructed
  // case where the default mode converges to a fixed point that is NOT the optimum. The claim
  // itself — equality with an exhaustive search — is power-solve-exact.prop.test.mjs's job.
  import { test, expect } from "vitest";
  import { buildTotals, nonCritWeights, solvePower, solvePowerExact } from "../power-solve.mjs";
  import { STATS } from "../champion-stats.mjs";
  import { lin } from "../power-model.mjs";

  // Every field a decoded artifact carries (oracle/analytics/decode.mjs's decodeRow), so the
  // fixtures exercise the real Item shape rather than a hand-rolled stat bag.
  const item = (o = {}) => ({
    id: 1, slot: 1, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 1, isFlat: true, value: 0 }, substats: [], ascStat: null,
    ascLevel: 0, equippedChampId: 0, ...o,
  });

  // Our item stat ids (STAT_NAMES order): 4 SPD, 5 C.RATE, 6 C.DMG. ids 4-8 are POINTS whatever
  // `isFlat` says — champion-stats.mjs's ITEM_KEY ignores it for them — so only 1-3 (HP/ATK/DEF)
  // read it at all.
  const spd = (id, slot, value) =>
    item({ id, slot, mainStat: { statId: 4, isFlat: true, value } });
  const crate = (id, slot, value) =>
    item({ id, slot, mainStat: { statId: 5, isFlat: false, value } });
  const cdmg = (id, slot, value) =>
    item({ id, slot, mainStat: { statId: 6, isFlat: false, value } });

  // Zero on every stat. base MUST carry HP, ATK and DEF as numbers: GREAT_HALL and ARENA both hold
  // "HP%"/"ATK%"/"DEF%" keys, and contribution would turn a missing one into NaN.
  const ZERO_BASE = Object.fromEntries(STATS.map((stat) => [stat, 0]));
  const NO_SOURCES = { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] };

  const champStats = (o = {}) => ({
    base: { ...ZERO_BASE, ...o.base },
    sources: { ...NO_SOURCES, ...o.sources },
    observedSets: new Map(), loreOfSteel: o.loreOfSteel ?? 0, awaken: 0,
  });

  // --- nonCritWeights ----------------------------------------------------------------------------

  // Written out longhand rather than read back off the module: the point of this export is that it
  // is `lin` MINUS its crit product, and the one thing that could go wrong quietly is a C.RATE
  // scalar of k * 100 left in by reaching for linearizedWeights(w, 0, 0) instead.
  test("nonCritWeights is lin without its crit product", () => {
    const w = { b: 3, r: 5, a: 7, s: 11, k: 13 };
    const totals = { HP: 150, ATK: 20, DEF: 30, SPD: 40,
      "C.RATE": 50, "C.DMG": 60, RES: 70, ACC: 80 };
    const ncW = nonCritWeights(w);
    expect(ncW["C.RATE"]).toBe(0);
    expect(ncW["C.DMG"]).toBe(0);
    // b*(150/15 + 20 + 30) + r*70 + a*80 + s*40
    //   = 3*60 + 5*70 + 7*80 + 11*40 = 180 + 350 + 560 + 440 = 1,530
    const nc = STATS.reduce((sum, stat) => sum + ncW[stat] * totals[stat], 0);
    expect(nc).toBeCloseTo(1530, 9);
    // And the two halves really do add back up to lin: 1,530 + 13 * 50 * 160 = 105,530.
    expect(nc + w.k * totals["C.RATE"] * (100 + totals["C.DMG"]))
      .toBeCloseTo(lin(totals, w), 9);
    expect(lin(totals, w)).toBeCloseTo(105530, 9);
  });
  ```
- [ ] 2. Run it and watch it fail for the right reason.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: fails with `nonCritWeights is not a function` (the export does not exist yet), not a syntax or import-path error.
- [ ] 3. Add the export to `oracle/analytics/power-solve.mjs`, immediately below `linearizedWeights`'s closing brace (after line 83).
  ```javascript
  // `lin`'s non-crit weights alone, as one scalar per stat. The crit scalars are ZERO rather than
  // frozen at a reference, so dot(nonCritWeights(w), totals) is exactly `lin` less its crit
  // product. linearizedWeights cannot stand in: at a reference of (0, 0) its C.RATE scalar is
  // k * 100, not 0, and a search that used it would double-count every point of crit rate.
  export function nonCritWeights(w) {
    return {
      HP: w.b / 15,
      ATK: w.b,
      DEF: w.b,
      SPD: w.s,
      "C.RATE": 0,
      "C.DMG": 0,
      RES: w.r,
      ACC: w.a,
    };
  }
  ```
- [ ] 4. Run it and watch it pass.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 1 passing test.

### Task 2.2: The weights precondition

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Append the precondition tests to `power-solve-exact.test.mjs`.
  ```javascript
  // --- solvePowerExact: the weights precondition -------------------------------------------------

  const ONE_PIECE = [crate(1, 1, 50)];
  const CRIT_ONLY = { b: 0, r: 0, a: 0, s: 0, k: 1 };
  const callWith = (weights) => () => solvePowerExact({
    items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE, weights,
  });

  // The SAME precondition solvePower checks, and checked here too rather than inherited: the
  // exactness argument rests on it directly — with a negative weight a piece can LOWER the
  // objective, and then the best full build is no longer the best build and the search space is
  // the wrong one. The failure would be quiet: a confident "proven maximum" over builds that are
  // not maximal.
  test("solvePowerExact refuses a negative weight, naming it", () => {
    expect(callWith({ ...CRIT_ONLY, r: -0.1 })).toThrow(/power-solve: weight r/);
    expect(callWith({ ...CRIT_ONLY, k: -1 })).toThrow(/power-solve: weight k/);
    expect(callWith({ ...CRIT_ONLY, b: -0.001 })).toThrow(/power-solve: weight b/);
  });

  test("solvePowerExact refuses a weight that is not a finite number", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "1"]) {
      expect(callWith({ ...CRIT_ONLY, s: bad }), `s = ${bad}`).toThrow(/power-solve: weight s/);
    }
  });

  // Zero is LEGAL, as in solvePower: the precondition is >= 0, unlike weightsFor's own `measured`
  // test, which is > 0. Every crit-only case below leans on it.
  test("solvePowerExact accepts a zero weight", () => {
    expect(callWith(CRIT_ONLY)).not.toThrow();
  });
  ```
- [ ] 2. Run and watch all three fail.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 3 failures, each `solvePowerExact is not a function`.
- [ ] 3. Add the `--- solvePowerExact ---` section divider and the minimal function at the **end** of `oracle/analytics/power-solve.mjs` (after `solvePower`'s closing brace).
  ```javascript

  // --- solvePowerExact ---------------------------------------------------------------------------

  export function solvePowerExact({ items, faction, champStats, current, weights }) {
    checkWeights(weights);
    return { build: null, provenOptimal: true, plansTotal: 0, plansPruned: 0, runtimeMs: 0 };
  }
  ```
- [ ] 4. Run and watch them pass. `npm run lint` will flag the unused destructured parameters; that is expected and Task 2.3 consumes them.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 4 passing tests.

### Task 2.3: `build` is `null` when no slot can be filled

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Append the null-build tests.
  ```javascript
  // --- solvePowerExact: nothing to search --------------------------------------------------------

  // speed-solve.mjs returns null for an empty index, and this is the same state: there is no build
  // to prove anything about. NOT the empty build — solvePower reports the worn gear as round 0 even
  // when it is nothing, and `null` is the honest answer to "which assignment is best" when no
  // assignment exists.
  test("build is null when the pool is empty", () => {
    const got = solvePowerExact({
      items: [], faction: 0, champStats: champStats(), current: [], weights: CRIT_ONLY,
    });
    expect(got.build).toBe(null);
    expect(got.provenOptimal).toBe(true);
  });

  // No plan was enumerated, because the decision came before the plan pass. Pinned so the counts
  // cannot drift into enumeratePlans' own answer for an empty index, which is one (the empty plan)
  // and would read as a plan that was considered.
  test("an empty pool reports no plans at all", () => {
    const got = solvePowerExact({
      items: [], faction: 0, champStats: champStats(), current: [], weights: CRIT_ONLY,
    });
    expect(got.plansTotal).toBe(0);
    expect(got.plansPruned).toBe(0);
  });

  // The faction lock is build-solve's, not the item's, so the exact search has to apply it too —
  // otherwise it would prove a maximum over builds the champion cannot wear. A pool of nothing but
  // wrong-faction accessories fills no slot at all, which is the strongest form of that check.
  test("build is null when every accessory is the wrong faction", () => {
    const items = [
      item({ id: 1, slot: 7, isAccessory: true, faction: 4,
        mainStat: { statId: 5, isFlat: false, value: 60 } }),
      item({ id: 2, slot: 8, isAccessory: true, faction: 4,
        mainStat: { statId: 6, isFlat: false, value: 90 } }),
    ];
    const got = solvePowerExact({
      items, faction: 3, champStats: champStats(), current: [], weights: CRIT_ONLY,
    });
    expect(got.build).toBe(null);
  });

  // The flag's whole point is that it costs more than the default mode, so the number has to be
  // real rather than a placeholder a reader would mistake for a measurement.
  test("runtimeMs is a non-negative number", () => {
    const got = solvePowerExact({
      items: ONE_PIECE, faction: 0, champStats: champStats(), current: ONE_PIECE,
      weights: CRIT_ONLY,
    });
    expect(typeof got.runtimeMs).toBe("number");
    expect(got.runtimeMs).toBeGreaterThanOrEqual(0);
  });

  // A one-slot pool has exactly one build, so the answer is forced — which makes this the cheapest
  // possible check that `build` carries the SAME shape as a solvePower entry, re-derived rather
  // than read back off the field.
  test("the returned build carries its unrounded totals and the lin they give", () => {
    const champ = champStats();
    const got = solvePowerExact({
      items: ONE_PIECE, faction: 0, champStats: champ, current: ONE_PIECE, weights: CRIT_ONLY,
    });
    expect(got.build.items.map((it) => it.id)).toEqual([1]);
    expect(got.build.totals).toEqual(buildTotals(champ, got.build.items));
    expect(got.build.lin).toBeCloseTo(lin(got.build.totals, CRIT_ONLY), 9);
    // C.RATE 50 and the Great Hall's C.DMG 25: 50 * (100 + 25) = 6,250.
    expect(got.build.lin).toBeCloseTo(6250, 6);
  });
  ```
- [ ] 2. Run and watch the last two fail (the three null tests already pass against the stub — that is the stub's whole behaviour, and the next step is what makes them meaningful).
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: `runtimeMs is a non-negative number` passes (0 ≥ 0), and `the returned build carries its unrounded totals` fails on `got.build` being `null`.
- [ ] 3. Replace the stub `solvePowerExact` body with the per-champion caches, the candidate list and the real empty-pool branch. `candidatesBySlot` and the `ONES`/`unitWeights` helpers go **above** `solvePowerExact`, under the same section divider.
  ```javascript
  // A weights object that reads one stat and ignores the rest, so every quantity the search bounds
  // is the same shape — one dot product against a stat vector — and the lanes in searchBest need no
  // special case for the two crit stats.
  const unitWeights = (stat) => Object.fromEntries(STATS.map((s) => [s, s === stat ? 1 : 0]));

  // The probe linearization's weight row. Strictly positive on every stat, which is the only
  // property plan enumeration needs — see WHICH PLANS in the header.
  const ONES = { b: 1, r: 1, a: 1, s: 1, k: 1 };

  // The pieces worth branching on, slot by slot. Once a piece's slot and set are fixed it affects
  // the objective only through three numbers — see (2) in the header — so within one (slot, set)
  // group every piece no better than another on all three is dropped. Of pieces equal on all three
  // the lowest id survives, as buildIndex's tie-break does, so a rerun returns the same build.
  //
  // Accessory slots are filtered to the champion's faction HERE as well as in buildIndex: a
  // candidate list that skipped it would prove a maximum over builds the champion cannot wear.
  // Slots outside SLOTS are skipped, because build-solve's `populated` skips them too.
  //
  // Returns slot -> entry[], ascending slot, each list non-empty and ordered by item id — the
  // search re-orders it for speed, and starting from a fixed order is what makes that reproducible.
  function candidatesBySlot(items, faction, ncW, vectorOf) {
    const groups = new Map();
    for (const item of items) {
      if (item.isAccessory && item.faction !== faction) continue;
      if (!SLOTS.includes(item.slot)) continue;
      let bySet = groups.get(item.slot);
      if (!bySet) groups.set(item.slot, (bySet = new Map()));
      let group = bySet.get(item.set);
      if (!group) bySet.set(item.set, (group = []));
      const v = vectorOf.get(item);
      group.push({ item, nc: dot(ncW, v), cr: v["C.RATE"], cd: v["C.DMG"] });
    }
    const out = new Map();
    for (const slot of SLOTS) {
      const bySet = groups.get(slot);
      if (!bySet) continue;
      const kept = [];
      for (const group of bySet.values()) {
        for (const x of group) {
          // Weak domination with an id tie-break. At least one member of every group survives: the
          // piece nothing strictly dominates, with the lowest id among those equal to it.
          const beaten = group.some((y) => y !== x
            && y.nc >= x.nc && y.cr >= x.cr && y.cd >= x.cd
            && (y.nc > x.nc || y.cr > x.cr || y.cd > x.cd || y.item.id < x.item.id));
          if (!beaten) kept.push(x);
        }
      }
      kept.sort((a, b) => a.item.id - b.item.id);
      out.set(slot, kept);
    }
    return out;
  }

  export function solvePowerExact({ items, faction, champStats, current, weights }) {
    checkWeights(weights);
    const started = Date.now();
    const { base, loreOfSteel } = champStats;

    const vectorOf = new Map(items.map((item) => [item, itemVector(item, base)]));
    // Every set the bonus table knows, PLUS any set id the pool actually carries, so totalsFrom can
    // look up a held set unconditionally. A set with no row gets an all-zero column, exactly as
    // setBonusTerms gives it nothing — and an all-zero column is inert in build-solve too, which
    // usefulCounts reads as "no count ever pays" and singletonSets as "nothing to buy".
    const setIds = [...new Set([...Object.keys(SET_BONUSES).map(Number),
      ...items.map((item) => item.set)])].filter((setId) => setId !== 0).sort((a, b) => a - b);
    const setVecs = new Map(setIds.map((setId) => [setId, setVectors(setId, base, loreOfSteel)]));
    const nonGear = nonGearTotals(champStats);

    const ncW = nonCritWeights(weights);
    const cands = candidatesBySlot(items, faction, ncW, vectorOf);
    // No slot can be filled at all — the pool is empty, or every accessory is the wrong faction.
    // The same answer speed-solve.mjs gives for an empty index, and the only honest one: there is
    // no assignment to prove anything about. No plan was considered, so both counts are zero.
    if (cands.size === 0) {
      return { build: null, provenOptimal: true, plansTotal: 0, plansPruned: 0,
        runtimeMs: Date.now() - started };
    }

    const build = solvePower({ items, faction, champStats, current, weights }).builds[0];
    return { build, provenOptimal: true, plansTotal: 0, plansPruned: 0,
      runtimeMs: Date.now() - started };
  }
  ```
- [ ] 4. Run and watch them all pass.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 9 passing tests.
- [ ] 5. Confirm nothing in the existing suite regressed.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs
  ```
  Expected: all pass.
- [ ] 6. Commit.
  ```bash
  git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve-exact.test.mjs && git commit -m "#47 solvePowerExact: the weights precondition, the candidate frontier and the empty-pool answer

Co-Authored-By: Claude"
  ```

---

## Chunk 3: the plan screen

### Task 3.1: `plansTotal`, `plansPruned` and the per-plan McCormick bound

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`
- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Append the fixture and the plan-count tests to `power-solve-exact.test.mjs`.
  ```javascript
  // --- solvePowerExact: the plan screen ----------------------------------------------------------

  // Three slots, each offering one Critical Rate piece (set 5, +12 C.RATE per 2 pieces) and one
  // Crit Damage piece (set 6, +20 C.DMG per 2 pieces). Each set can reach its only useful count of
  // two but the two together need four slots, so build-solve enumerates exactly three plans: the
  // empty one, {5: 2} and {6: 2}.
  //
  // Non-gear crit is the Great Hall's C.DMG 25 and nothing else, so with CRIT_ONLY weights every
  // build's lin is one multiplication:
  //
  //   3 x set 5   C.RATE 60 + 12 = 72, C.DMG  25            -> 72 * 125 =  9,000   <- worn
  //   2 x 5, 1 x 6  C.RATE 40 + 12 = 52, C.DMG  25 + 60 = 85 -> 52 * 185 =  9,620   <- the optimum
  //   1 x 5, 2 x 6  C.RATE 20,            C.DMG  25 + 140    -> 20 * 265 =  5,300
  //   3 x set 6   C.RATE  0,            C.DMG  25 + 200    ->  0 * 225 =      0
  const SETS = [
    item({ id: 1, slot: 1, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
    item({ id: 2, slot: 1, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
    item({ id: 3, slot: 2, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
    item({ id: 4, slot: 2, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
    item({ id: 5, slot: 3, set: 5, mainStat: { statId: 5, isFlat: false, value: 20 } }),
    item({ id: 6, slot: 3, set: 6, mainStat: { statId: 6, isFlat: false, value: 60 } }),
  ];
  const SETS_ARGS = {
    items: SETS, faction: 0, champStats: champStats(),
    current: [SETS[0], SETS[2], SETS[4]], weights: CRIT_ONLY,
  };

  test("provenOptimal is true and plansPruned never exceeds plansTotal", () => {
    const got = solvePowerExact(SETS_ARGS);
    expect(got.provenOptimal).toBe(true);
    expect(got.plansPruned).toBeLessThanOrEqual(got.plansTotal);
  });

  // The three plans build-solve enumerates for this pool, counted rather than assumed: a pool that
  // collapsed to the empty plan alone would make every plan-screen assertion below vacuous and
  // nothing else here would notice.
  test("plansTotal counts every plan build-solve enumerates, the empty one included", () => {
    expect(solvePowerExact(SETS_ARGS).plansTotal).toBe(3);
  });

  // The screen does real work on this pool. Against the worn gear's 9,000, the {6: 2} plan's bound
  // is the SMALLER of its two estimators, and the second one — linearized at (CRlo, CDhi) = (0,
  // 225), where C.DMG is worth k * CRlo = 0 — values a Crit Damage build at 6,500, below the
  // incumbent. So that plan is ruled out with no search at all.
  //
  //   estimator 2 at (0, 225): C.RATE x 325, C.DMG x 0, offset 0
  //     {6: 2}  two set-6 columns at 0 each, one free pick of 20 C.RATE x 325 = 6,500
  //
  // A floor rather than the figure, so the assertion survives a tighter bound ruling out more.
  test("the per-plan bound rules out a plan the incumbent already beats", () => {
    const got = solvePowerExact(SETS_ARGS);
    expect(got.plansPruned).toBeGreaterThanOrEqual(1);
  });
  ```
- [ ] 2. Run and watch the three fail.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: `plansTotal counts every plan…` fails with `expected 0 to be 3`, and `the per-plan bound rules out…` fails with `expected 0 to be >= 1`. `provenOptimal is true and plansPruned never exceeds plansTotal` passes already (0 ≤ 0) — it is an invariant, not a driver.
- [ ] 3. In `solvePowerExact`, replace the two closing lines (`const build = solvePower(...)` and the `return` after it) with the incumbent, the box, the estimators and the plan screen.
  ```javascript
    // THE INCUMBENT. The default mode's answer, which is already the worn gear or better, so the
    // screen below starts from a build the champion could actually wear rather than from nothing —
    // and a pool whose every plan falls below it needs no search at all.
    let best = solvePower({ items, faction, champStats, current, weights }).builds[0];

    const box = critBox(items, faction, vectorOf, setVecs, nonGear);
    const bonusOf = (w) => new Map([...setVecs]
      .map(([setId, vectors]) => [setId, vectors.map((v) => dot(w, v))]));

    // THE TWO McCORMICK ESTIMATORS, at the box corners (CRhi, CDlo) and (CRlo, CDhi) — the only two
    // references at which the bound holds, and the same two the certificate uses. Each is affine in
    // the build's C.RATE and C.DMG, so each is one linearization plus a constant; `offset` is
    // everything in it that does not come off gear, namely the non-gear totals at this estimator's
    // weights and its own affine correction of -k * crRef * cdRef.
    const estimators = [[box.CRhi, box.CDlo], [box.CRlo, box.CDhi]].map(([crRef, cdRef]) => {
      const w = linearizedWeights(weights, crRef, cdRef);
      return {
        w,
        bonusAt: bonusOf(w),
        offset: dot(w, nonGear) - weights.k * crRef * cdRef,
        index: buildIndex(items, faction, (item) => dot(w, vectorOf.get(item))),
      };
    });

    // WHICH PLANS. From a STRICTLY POSITIVE linearization, never from `weights`, which may legally
    // be all zero — and an all-zero valuation gives every set an all-zero bonus column, which
    // usefulCounts reads as "no count ever pays" and which would collapse the plan space to the
    // empty plan alone. With every scalar positive a set's bonus rises at exactly the counts its
    // stat bonus does, so the plans are the same whichever positive row is used. enumeratePlans
    // reads the index only for which (slot, set) pairs exist, so the valuation cannot move them
    // either.
    const probeW = linearizedWeights(ONES, 1, 1);
    const probeIndex = buildIndex(items, faction, (item) => dot(probeW, vectorOf.get(item)));
    const plans = enumeratePlans(probeIndex, bonusOf(probeW));
    const plansTotal = plans.length;

    // THE PER-PLAN BOUND, valid for every build whose NAMING PLAN is this plan: the build's true
    // objective is at most its estimator value (McCormick, over a box that covers every
    // assignment); that estimator value is exactly what the assignment credits it under its naming
    // plan (build-solve's exactness argument); and that credited value is at most the plan's
    // assignment maximum, which is what assignPlan returns. So the plan's own maximum plus the
    // estimator's constant terms bounds every build under it, and the smaller of the two estimators
    // is the bound.
    //
    // This does NOT contradict build-solve's own "NO BRANCH AND BOUND": that note is about bounds
    // computed from the sets a plan NAMES, which miss the singleton bonuses an assignment also
    // collects. This bound is the assignment's own `credited`, so it misses nothing.
    const survivors = [];
    for (const plan of plans) {
      let bound = Infinity;
      for (const estimator of estimators) {
        const assigned = assignPlan(estimator.index, estimator.bonusAt, plan);
        // Unfillable, so no build names this plan and there is nothing under it to search. Both
        // estimators agree here: fillability reads only which (slot, set) pairs the index has.
        if (!assigned) { bound = -Infinity; break; }
        bound = Math.min(bound, assigned.credited + estimator.offset);
      }
      // STRICTLY below, so the plan holding the optimum survives a bound that merely equals the
      // incumbent — in which case the incumbent is already optimal and the search confirms it.
      if (bound < best.lin) continue;
      survivors.push(plan);
    }
    const plansPruned = plansTotal - survivors.length;

    return { build: best, provenOptimal: true, plansTotal, plansPruned,
      runtimeMs: Date.now() - started };
  ```
- [ ] 4. Run and watch them pass.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 12 passing tests.
- [ ] 5. Confirm nothing regressed.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs oracle/analytics/__tests__/build-solve.test.mjs
  ```
  Expected: all pass.
- [ ] 6. Commit.
  ```bash
  git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve-exact.test.mjs && git commit -m "#47 solvePowerExact: screen build-solve's whole plan space with a per-plan McCormick bound

Co-Authored-By: Claude"
  ```

---

## Chunk 4: the search

### Task 4.1: The constructed non-optimal fixed point (RED)

This is the acceptance criterion's case and the fixture needs deriving, because the obvious one does not exist. **With pure-crit weights a fixed point is provably globally optimal**, so `power-solve.test.mjs`'s `CYCLE` fixture cannot be adapted: write `f(CR, CD) = k·CR·(100 + CD)`; then `f(Q) = tangent_P(Q) + k·ΔCR·ΔCD`, and a fixed point means `tangent_P(Q) ≤ f(P)`, so beating `P` needs `ΔCR·ΔCD > 0` — both totals up (impossible, since positive linear weights would then have preferred `Q`) or both down (impossible, since both factors would be smaller). The gap only opens once a **non-crit** weight is in play, because then `Q` can buy crit on both axes by giving up non-crit value.

**Files:**

- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Append the fixture, the guard test that it really is a fixed point, and the test that drives the search.
  ```javascript
  // --- solvePowerExact: a fixed point that is not the optimum -------------------------------------

  // SPD AND CRIT, because a crit-only pool cannot produce this case at all. Write
  // f(CR, CD) = k * CR * (100 + CD); then f(Q) = tangent_P(Q) + k * dCR * dCD, and a fixed point
  // means tangent_P(Q) <= f(P) for every Q, so beating P needs dCR * dCD > 0 — both totals up,
  // which positive linear weights would already have preferred, or both down, which makes both
  // factors smaller. Either way impossible. The gap opens only once a NON-CRIT weight is in play,
  // because then a build can buy crit on BOTH axes by giving up non-crit value, which the
  // linearization at a low-crit reference prices at almost nothing.
  const SPD_AND_CRIT = { b: 0, r: 0, a: 0, s: 1, k: 1 };

  // Two slots. Each offers a pure-SPD piece or a pure-crit one, and nothing in between. Non-gear
  // crit is the Great Hall's C.DMG 25; non-gear SPD is zero. lin = SPD + C.RATE * (100 + C.DMG).
  //
  //   worn  {1, 3}  SPD 210, C.RATE 0, C.DMG  25   true 210 +   0 * 125 =   210
  //         {1, 4}  SPD 200, C.RATE 0, C.DMG 325   true 200 +   0 * 425 =   200
  //         {2, 3}  SPD  10, C.RATE 1, C.DMG  25   true  10 +   1 * 125 =   135
  //   best  {2, 4}  SPD   0, C.RATE 1, C.DMG 325   true   0 +   1 * 425 =   425
  //
  // Round 1 linearizes at the worn build's own crit, (C.RATE 0, C.DMG 25), which prices SPD at 1,
  // C.RATE at k * (100 + 25) = 125 and C.DMG at k * C.RATE = 0 — the champion has no crit rate, so
  // crit damage is worth literally nothing to it:
  //
  //   slot 1   SPD 200 -> 200   vs   C.RATE 1 -> 125     keeps the SPD piece
  //   slot 2   SPD  10 ->  10   vs   C.DMG 300 ->   0    keeps the SPD piece
  //
  // so round 1 returns the worn build itself: a FIXED POINT, at 210 against a true optimum of 425.
  const TRAP = [spd(1, 1, 200), crate(2, 1, 1), spd(3, 2, 10), cdmg(4, 2, 300)];
  const TRAP_ARGS = {
    items: TRAP, faction: 0, champStats: champStats(),
    current: [TRAP[0], TRAP[2]], weights: SPD_AND_CRIT,
  };

  // The fixture is only a trap while solvePower really does converge on it. Pinned here, so a
  // change to the default mode that escapes this pool fails THIS test rather than quietly turning
  // the one below into a test of nothing.
  test("solvePower converges to this pool's fixed point, which is not its optimum", () => {
    const got = solvePower(TRAP_ARGS);
    expect(got.converged).toBe(true);
    expect(got.rounds).toBe(1);
    expect(got.builds[0].items.map((it) => it.id).sort((a, b) => a - b)).toEqual([1, 3]);
    expect(got.builds[0].lin).toBeCloseTo(210, 6);
  });

  test("the exact search finds the build the fixed point missed", () => {
    const got = solvePowerExact(TRAP_ARGS);
    expect(got.build.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([2, 4]);
    expect(got.build.lin).toBeCloseTo(425, 6);
    expect(got.provenOptimal).toBe(true);
  });

  // Stated as a comparison rather than as two numbers, because that is the claim the mode exists to
  // make: whatever the default mode found, the exact search is never below it.
  test("the exact answer beats the default mode's on the same pool", () => {
    expect(solvePowerExact(TRAP_ARGS).build.lin)
      .toBeGreaterThan(solvePower(TRAP_ARGS).builds[0].lin);
  });
  ```
- [ ] 2. Run and watch the fixture guard pass and the two search tests fail.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: `solvePower converges to this pool's fixed point…` **passes** (it describes existing behaviour and proves the fixture is a real trap); `the exact search finds the build the fixed point missed` fails with `expected [ 1, 3 ] to deeply equal [ 2, 4 ]`; `the exact answer beats the default mode's…` fails with `expected 210 to be greater than 210`.

### Task 4.2: The branch-and-bound (GREEN)

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Add `searchBest` to `oracle/analytics/power-solve.mjs`, between `candidatesBySlot` and `solvePowerExact`.
  ```javascript
  // Depth-first branch and bound over the slots, exhaustive over FULL builds and seeded with the
  // incumbent. See (1) to (4) in the header for why it is exact. Everything here that is not a
  // bound — the slot order, the candidate order — is a speed choice that cannot move the answer,
  // because the search visits every unpruned leaf whatever order it visits them in.
  function searchBest({ cands, weights, ncW, estimators, setVecs, nonGear, box, vectorOf, best }) {
    // ONE LANE per quantity the bound tracks. Lanes 0-2 are the non-crit linear value, C.RATE and
    // C.DMG, which the product bound combines; lanes 3 and 4 are the two McCormick estimators, each
    // affine and therefore exactly the same shape — one scalar per piece. Every lane is a
    // NON-NEGATIVE linear functional of a stat vector, which is what makes a per-slot maximum and a
    // set-bonus headroom upper bounds on what the remaining slots can add to it.
    //
    // The estimator lanes are the TIGHT ones: each collapses the crit product into a single scalar
    // per piece, so a slot's maximum is attainable rather than three maxima that may belong to
    // three different pieces. The product bound is the loose one, and the one the issue specifies.
    // Taking the smaller of all three is sound because each is sound on its own.
    const laneW = [ncW, unitWeights("C.RATE"), unitWeights("C.DMG"),
      estimators[0].w, estimators[1].w];
    const laneSet = laneW.map((w) => new Map([...setVecs]
      .map(([setId, vectors]) => [setId, vectors.map((v) => dot(w, v))])));
    // What each lane holds before any gear. The two crit lanes carry the box floors, which ARE the
    // non-gear crit totals; the estimator lanes carry their own affine offsets.
    const laneBase = [dot(ncW, nonGear), box.CRlo, box.CDlo,
      estimators[0].offset, estimators[1].offset];
    const L = laneW.length;

    for (const list of cands.values()) {
      for (const entry of list) entry.lane = laneW.map((w) => dot(w, vectorOf.get(entry.item)));
    }

    // An optimistic single scalar per piece, used ONLY to order the search: its non-crit value plus
    // the most the crit product could ever pay for its crit, at the top of the global box. Ordering
    // by it tries likely-good leaves first, which raises the incumbent early and prunes more.
    const proxy = (entry) =>
      entry.nc + weights.k * (entry.cr * (100 + box.CDhi) + entry.cd * box.CRhi);
    for (const list of cands.values()) {
      list.sort((a, b) => proxy(b) - proxy(a) || a.item.id - b.item.id);
    }
    // Slots whose candidates differ most go FIRST: that is where a choice moves the bound, and a
    // bound that falls early prunes a whole subtree rather than a leaf. Ties on the slot id, so a
    // rerun searches in the same order and returns the same build.
    const spreadOf = (slot) => {
      const list = cands.get(slot);
      return proxy(list[0]) - proxy(list[list.length - 1]);
    };
    const order = [...cands.keys()].sort((a, b) => spreadOf(b) - spreadOf(a) || a - b);
    const n = order.length;

    // suffMax[lane][i]: the largest value each slot from i on could still contribute in that lane,
    // summed. Every slot's candidate list is non-empty, so the inner maximum is always a real one.
    const suffMax = laneW.map((_, lane) => {
      const out = new Float64Array(n + 1);
      for (let i = n - 1; i >= 0; i--) {
        let max = -Infinity;
        for (const entry of cands.get(order[i])) {
          if (entry.lane[lane] > max) max = entry.lane[lane];
        }
        out[i] = out[i + 1] + max;
      }
      return out;
    });

    // suffSupply[i]: setId -> how many slots from i on could supply a piece of it. A tighter cap on
    // a set's remaining headroom than the number of slots left on its own, and the only place the
    // bound uses WHICH sets the remaining slots actually carry. A set no remaining slot supplies is
    // absent, and contributes nothing — correctly, since its count cannot rise.
    const suffSupply = new Array(n + 1);
    suffSupply[n] = new Map();
    for (let i = n - 1; i >= 0; i--) {
      const here = new Map(suffSupply[i + 1]);
      for (const setId of new Set(cands.get(order[i]).map((entry) => entry.item.set))) {
        if (setId !== 0) here.set(setId, (suffSupply[i + 1].get(setId) ?? 0) + 1);
      }
      suffSupply[i] = here;
    }

    // An upper bound on the TOTAL set-bonus increase the remaining slots can still buy in one lane.
    // Per set, its count can rise by at most however many remaining slots supply it, capped by how
    // many slots remain at all; a lane's set column is non-decreasing in count, so that count's
    // bonus less the bonus at the count already held is that set's own ceiling. Summing over sets
    // is LOOSE — the remaining slots cannot feed every set at once — and sound, which is what a
    // bound has to be.
    const laneGain = (lane, depth, counts) => {
      const columns = laneSet[lane];
      const left = n - depth;
      let total = 0;
      for (const [setId, supply] of suffSupply[depth]) {
        const column = columns.get(setId);
        if (!column) continue;
        const held = counts.get(setId) ?? 0;
        const reach = Math.min(held + Math.min(supply, left), SLOTS.length);
        total += column[reach] - column[held];
      }
      return total;
    };

    const laneCeiling = (lane, depth, acc, counts) =>
      laneBase[lane] + acc[lane] + suffMax[lane][depth] + laneGain(lane, depth, counts);

    // The smaller of three sound ceilings on the FINAL objective of every completion of this
    // partial build: the product of the three tracked totals, and each McCormick estimator read off
    // its own lane.
    const ceilingAt = (depth, acc, counts) => {
      let bound = laneCeiling(0, depth, acc, counts)
        + weights.k * laneCeiling(1, depth, acc, counts)
          * (100 + laneCeiling(2, depth, acc, counts));
      for (let lane = 3; lane < L; lane++) {
        const estimate = laneCeiling(lane, depth, acc, counts);
        if (estimate < bound) bound = estimate;
      }
      return bound;
    };

    const chosen = new Array(n);
    const counts = new Map();

    // `acc` is rebuilt per node rather than incremented and undone. Integer counts undo exactly;
    // float lane sums do not, and an add/subtract cycle over a deep search drifts — which would
    // move a ceiling, and a ceiling that drifts DOWN prunes the optimum.
    const walk = (depth, acc) => {
      if (depth === n) {
        // Scored on the TRUE objective from the ACTUAL set counts — so a one-piece tier and a set
        // completed by accident both count — through the same totalsFrom the default mode scores
        // its pool with, so a build's reported `lin` is the one number both modes agree on. Sorted
        // by slot first, so the sum is in the same order whatever order the search reached the
        // slots in and two runs cannot differ in the last bits.
        const picked = chosen.slice().sort((a, b) => a.item.slot - b.item.slot)
          .map((entry) => entry.item);
        const totals = totalsFrom(nonGear, picked, vectorOf, setVecs);
        const score = lin(totals, weights);
        if (score > best.lin) best = { items: picked, totals, lin: score };
        return;
      }
      for (const entry of cands.get(order[depth])) {
        const setId = entry.item.set;
        const held = setId ? counts.get(setId) ?? 0 : 0;
        const next = Float64Array.from(acc);
        for (let lane = 0; lane < L; lane++) {
          next[lane] += entry.lane[lane];
          if (setId) {
            const column = laneSet[lane].get(setId);
            next[lane] += column[held + 1] - column[held];
          }
        }
        if (setId) counts.set(setId, held + 1);
        chosen[depth] = entry;
        // Pruned only when the ceiling is STRICTLY below the incumbent, so the branch holding the
        // optimum survives a ceiling that merely equals it.
        if (ceilingAt(depth + 1, next, counts) >= best.lin) walk(depth + 1, next);
        if (setId) { if (held === 0) counts.delete(setId); else counts.set(setId, held); }
      }
    };
    walk(0, new Float64Array(L));
    return best;
  }
  ```
- [ ] 2. Wire the search into `solvePowerExact`: insert these four lines between `const plansPruned = ...` and the final `return`.
  ```javascript
    // Every build has a naming plan, so when every plan's bound fell below the incumbent the
    // incumbent IS the maximum and there is nothing left to search.
    if (survivors.length > 0) {
      best = searchBest({ cands, weights, ncW, estimators, setVecs, nonGear, box, vectorOf, best });
    }
  ```
- [ ] 3. Run and watch the trap tests pass.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 15 passing tests, including `the exact search finds the build the fixed point missed`.
- [ ] 4. Confirm nothing regressed.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve.test.mjs oracle/analytics/__tests__/build-solve.test.mjs
  ```
  Expected: all pass.

### Task 4.3: The optimum on a set-bearing pool

The trap has no sets at all, so nothing yet pins that the search scores leaves on **actual** set counts. The `SETS` fixture's optimum is a build neither the worn gear nor a named plan reaches cleanly.

**Files:**

- Test: `oracle/analytics/__tests__/power-solve-exact.test.mjs`

**Steps:**

- [ ] 1. Append the test, below the `the per-plan bound rules out a plan…` test in the plan-screen section.
  ```javascript
  // The optimum here is MIXED — two Critical Rate and one Crit Damage, at 9,620 — and neither the
  // worn three-of-a-kind (9,000) nor either single-set plan reaches it. A search that scored leaves
  // on their PLAN rather than on their actual set counts would miss the +12 the two Critical Rate
  // pieces earn when the third slot went elsewhere, and would answer 9,000 while looking healthy.
  test("the exact search scores leaves on their actual set counts", () => {
    const got = solvePowerExact(SETS_ARGS);
    expect(got.build.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([1, 3, 6]);
    expect(got.build.lin).toBeCloseTo(9620, 6);
    expect(got.build.lin).toBeGreaterThan(solvePower(SETS_ARGS).builds[0].lin);
  });
  ```
- [ ] 2. Run it.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs
  ```
  Expected: 16 passing tests. If the id list differs, the optimum is a different mixed build of the same shape — recompute by hand from the four-line table above the fixture and correct the expectation rather than the solver, then re-run.
- [ ] 3. Commit.
  ```bash
  git add oracle/analytics/power-solve.mjs oracle/analytics/__tests__/power-solve-exact.test.mjs && git commit -m "#47 solvePowerExact: branch and bound over full builds, pruned on three sound ceilings

Co-Authored-By: Claude"
  ```

---

## Chunk 5: the module header

### Task 5.1: State why the method is exact

Documentation only — no TDD cycle, but the acceptance criterion is explicit ("Its module comment states why the method is exact"), and the house style is an all-caps-sectioned prose essay that names what is *not* claimed as plainly as what is.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Reword the opening summary (lines 3–5) so the exact mode is no longer only "a separate mode".
  ```javascript
  // The gear assignment, out of the whole vault, that maximizes a champion's in-game POWER. Two
  // modes. The DEFAULT linearizes the crit term, solves exactly, iterates to a fixed point, and
  // certifies how far the answer could still be from the maximum. solvePowerExact PROVES the
  // maximum instead, and costs more.
  ```
- [ ] 2. Replace the tail of the `WHAT IS PROVED` paragraph (the clause from `— and a wide `gap` is the signal` through the end of that sentence, currently lines 40–41) so it points at the export by name.
  ```javascript
  // — and a wide `gap` is the signal to pay for solvePowerExact instead of trusting this one.
  ```
- [ ] 3. Insert the four-part exactness argument immediately **after** the `` `current` IS ASSUMED DRAWN FROM `items` `` paragraph (i.e. after line 47, before the `import` block).
  ```javascript
  //
  // WHY solvePowerExact IS EXACT. Four claims, in the order the code makes them.
  //
  // (1) FULL BUILDS ARE ENOUGH. With every weight >= 0 and every stat a piece or a set adds >= 0,
  // `lin` is non-decreasing in every stat total: its non-crit part is a non-negative combination,
  // and the crit product k * C.RATE * (100 + C.DMG) grows with each factor while both stay
  // non-negative. A set's bonus never shrinks with more pieces either — setVectors is
  // non-decreasing in count, which power-solve.test.mjs pins against the real table. So filling a
  // slot never lowers the objective, and the best build taking one piece in EVERY slot the pool can
  // fill is the best build over "at most one piece per slot". The search therefore enumerates full
  // builds only. This rests on CRlo >= 0 and 100 + CDlo >= 0 — true for every champion the game
  // has, and documented rather than checked, as `current` is.
  //
  // (2) A PIECE MATTERS THROUGH THREE NUMBERS. Fix a slot and a set. Then which piece of that set
  // fills the slot cannot change the build's set COUNTS, and the objective reads the piece only
  // through its non-crit linear value, its C.RATE and its C.DMG — because the non-crit part of
  // `lin` is a single linear functional of the stat vector, so a piece enters it as one scalar, and
  // the crit part reads those two stats and nothing else. Those three are a sufficient statistic
  // for a piece, so one that is no better than another of the same slot and set on all three can be
  // dropped with nothing lost. Of pieces equal on all three exactly one survives, the lowest id, as
  // buildIndex's tie-break does.
  //
  // (3) NO BOUND PRUNES THE OPTIMUM. Two bounds, both strict-only: a branch is cut when its
  // ceiling is STRICTLY below the incumbent, so the branch holding the optimum survives a ceiling
  // that merely equals it. The PLAN bound is valid for every build whose naming plan is that plan —
  // the build's true objective is at most its McCormick estimator value, that estimator value is
  // exactly what the assignment credits the build under its naming plan, and that credited value is
  // at most the plan's assignment maximum. Every build has a naming plan, so the surviving plans
  // cover every build that could beat the incumbent. The NODE bound is the smaller of three
  // ceilings on the final objective of any completion: the issue's product of three independently
  // maximized totals, and each McCormick estimator read as one affine lane. Each is sound alone
  // because every lane is a non-negative linear functional, so a per-slot maximum and a per-set
  // headroom are both upper bounds on what the remaining slots can add.
  //
  // (4) THE SEARCH IS OTHERWISE EXHAUSTIVE. Slot order and candidate order are speed choices: the
  // search visits every unpruned leaf whatever order it visits them in.
  //
  // WHAT THE PLAN COUNTS MEAN. `plansTotal` is every plan build-solve would enumerate for this
  // pool, the empty one included; `plansPruned` counts the ones that needed no search, because
  // either no assignment can fill them or their bound fell strictly below the incumbent. When every
  // plan is pruned the incumbent is already the maximum and no search runs at all. In practice the
  // EMPTY plan almost never prunes — its assignment is the best free pick in every slot plus every
  // one-piece bonus the pool can reach, which an estimator values above any real build — so the
  // counts are a diagnostic on how much of the plan space the bound could rule out, not usually an
  // early exit. Said plainly rather than claimed otherwise.
  //
  // The largest per-plan bound is also a global upper bound, and a tighter one than the
  // certificate's: both maximize the same estimator over the same plans, but this one uses each
  // plan's `credited`, which never exceeds the realized score solve() maximizes. It is not
  // reported, because `provenOptimal` makes it redundant.
  //
  // FLOAT ORDER, SAID PLAINLY. A leaf's ceiling is the same sum as the score the leaf is then
  // given, added in a different order, so the two can differ in the last bits. A leaf dropped that
  // way ties the incumbent to within rounding and cannot move the maximum by more than float noise;
  // the property test compares against an exhaustive search with a relative tolerance of 1e-9 for
  // exactly this reason. `provenOptimal` is a claim about the SEARCH, not about IEEE arithmetic.
  //
  // WHY NOT ALWAYS. Nothing here bounds the runtime. On a full vault the plan space runs to
  // hundreds of thousands of plans and the search to a branching factor per slot, which is why the
  // mode is opt-in and the default one certifies instead.
  ```
- [ ] 4. Verify the file still parses and every test still passes — a comment block with a stray `*/` or an unbalanced backtick would break the module, not just the prose.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.test.mjs oracle/analytics/__tests__/power-solve.test.mjs
  ```
  Expected: all pass.
- [ ] 5. Verify the four claims are present under the names the acceptance criterion will be read against.
  ```bash
  grep -n "WHY solvePowerExact IS EXACT\|WHAT THE PLAN COUNTS MEAN\|FLOAT ORDER" oracle/analytics/power-solve.mjs
  ```
  Expected: three matching lines.
- [ ] 6. Check the lint gate, which is also the only check on line length in this repo.
  ```bash
  npm run lint
  ```
  Expected: exits 0.
- [ ] 7. Commit.
  ```bash
  git add oracle/analytics/power-solve.mjs && git commit -m "#47 power-solve: state why the exact search is exact, and what the plan counts do not prove

Co-Authored-By: Claude"
  ```

---

## Chunk 6: the property test

### Task 6.1: Brute-force equality and never-worse-than-`solvePower`

**Files:**

- Create: `oracle/analytics/__tests__/power-solve-exact.prop.test.mjs`

**Steps:**

- [ ] 1. Create the file with the preamble, generators and brute force.
  ```javascript
  // oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  // solvePowerExact claims a PROVEN maximum. On instances small enough to enumerate exhaustively
  // that claim is checkable directly — so check it, against a brute force that goes through
  // champion-stats.mjs and power-model.mjs and touches nothing in the module under test.
  import { test, expect } from "vitest";
  import fc from "fast-check";
  import { setVectors, solvePower, solvePowerExact } from "../power-solve.mjs";
  import { STATS, statBreakdown } from "../champion-stats.mjs";
  import { lin } from "../power-model.mjs";
  import { SET_BONUSES, setCounts } from "../set-bonuses.mjs";

  // vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
  // workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
  // timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
  // runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
  // is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
  const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
  const PARAMS = process.env.FC_NUM_RUNS
    ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
    : { numRuns: NUM_RUNS };

  // A relative tolerance, IN THE TEST ONLY. The solver and the brute force sum the same terms in
  // different orders, so they agree mathematically and can differ in the last bits. Nothing inside
  // power-solve.mjs has a tolerance, and smearing an epsilon into the search would hide a real
  // pruning bug instead of surfacing it here.
  const TOL = 1e-9;
  const near = (a, b) => Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
  const noLessThan = (a, b) => a >= b - TOL * Math.max(1, Math.abs(b));

  // Nine slots, so the brute force is at most 2^9 = 512 builds at two items a slot. All
  // non-accessory with faction 0, so the faction lock never fires and which nine slots they are is
  // not a distinction buildIndex, candidatesBySlot or the brute force can make — the lock has its
  // own case in power-solve-exact.test.mjs.
  const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ZERO_STATS = Object.fromEntries(STATS.map((stat) => [stat, 0]));

  // Non-negative throughout, and that is load-bearing rather than tidy: it is exactly the
  // precondition claim (1) in power-solve.mjs's header rests on. Every stat a piece or a set adds is
  // then non-negative, so C.RATE and 100 + C.DMG both only grow and the crit PRODUCT grows with
  // them — a piece can never lower the objective, which is what makes the full-build enumeration
  // below the optimum over "at most one piece per slot".
  //
  // C.DMG RANGES FAR WIDER THAN C.RATE, which is both what the game does — a C.DMG total runs into
  // the hundreds while C.RATE caps at 100 — and what makes the crit box wide enough that the
  // McCormick lanes are loose and the product bound has to carry its share of the pruning.
  const statsArb = fc.record({
    HP: fc.integer({ min: 0, max: 2000 }),
    ATK: fc.integer({ min: 0, max: 200 }),
    DEF: fc.integer({ min: 0, max: 200 }),
    SPD: fc.integer({ min: 0, max: 30 }),
    "C.RATE": fc.integer({ min: 0, max: 30 }),
    "C.DMG": fc.integer({ min: 0, max: 200 }),
    RES: fc.integer({ min: 0, max: 40 }),
    ACC: fc.integer({ min: 0, max: 40 }),
  });

  // A real decoded-artifact Item whose vector is exactly `stats`. HP, ATK and DEF go in FLAT so the
  // vector is the drawn numbers rather than a percentage of a base the generator also draws — the
  // property is about the search, not about re-deriving contribution's percent branch, which
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

  // The set models the search has to reason about, kept to five so plan enumeration stays cheap at
  // 25,000 instances: 0 is setless; 5 Critical Rate and 6 Crit Damage are two-piece stackers on the
  // two stats the crit product reads; 60 Slayer is TIERED AND PAYS FROM ONE PIECE, with C.RATE +5
  // at a single piece, which is the one-piece-tier state the coverage test asserts; 48 Stone Skin is
  // a one-piece tier on a NON-crit stat (HP% +8), so the non-crit lane meets one too.
  const SETS = [0, 5, 6, 60, 48];

  // Weighted toward the crit sets so an instance often COMPLETES one. Drawing flat over 41 sets
  // would complete a crit set only by accident, and the crit term is the whole reason this solver is
  // not just build-solve.
  const setArb = fc.oneof(
    { arbitrary: fc.constantFrom(5, 6, 60), weight: 6 },
    { arbitrary: fc.constantFrom(...SETS), weight: 3 },
    { arbitrary: fc.constant(0), weight: 1 },
  );

  // Positive, as weightsFor always returns. Small integers rather than doubles, so an instance that
  // fails can be read by hand instead of through fifteen significant digits.
  const weightsArb = fc.record({
    b: fc.integer({ min: 1, max: 20 }),
    r: fc.integer({ min: 1, max: 20 }),
    a: fc.integer({ min: 1, max: 20 }),
    s: fc.integer({ min: 1, max: 20 }),
    k: fc.integer({ min: 1, max: 20 }),
  });

  // One list of items PER SLOT rather than a flat array whose slots are drawn at random, so an
  // instance can pile a set into enough slots to complete it — and so nine populated slots is an
  // ordinary draw rather than a coincidence. At most two items a slot caps the brute force at 2^9.
  //
  // `minSlots` is what makes the nine-slot draw land: fc.array biases short, so an unconstrained
  // nine-slot generator averages five populated slots and reaches nine only by luck.
  const instanceWith = ({ setArb: sets, minSlots = 1, baseArb = statsArb }) => fc.record({
    perSlot: fc.array(
      fc.array(fc.record({ set: sets, stats: statsArb }), { minLength: 1, maxLength: 2 }),
      { minLength: minSlots, maxLength: SLOT_IDS.length },
    ),
    weights: weightsArb,
    base: baseArb,
    loreOfSteel: fc.constantFrom(0, 0.15),
    // Which item each slot is currently wearing, or none when the draw is -1: a copy can have an
    // empty slot, and the worn build is then NOT one of the full builds the brute force enumerates.
    wornPick: fc.array(fc.integer({ min: -1, max: 1 }),
      { minLength: SLOT_IDS.length, maxLength: SLOT_IDS.length }),
  });

  // THE TRAP DRAW, and the band on `cd` below is derived rather than guessed. Every slot offers the
  // SAME pure-C.RATE piece or the SAME pure-C.DMG piece — power-solve.test.mjs's CYCLE fixture
  // generalized — and the worn build takes C.RATE everywhere. Identical ratios in every slot are
  // what makes this a trap: the linearization picks per slot on whether cr/cd beats CR/(100 + CD),
  // which is one threshold for all slots at once, so the iteration can only ever reach the two
  // CORNERS and never the mixed build that is the real optimum.
  //
  // With non-gear C.RATE 0 and C.DMG 25 (the Great Hall's, since base crit is drawn as zero here),
  // a build with j of the n slots on C.RATE is worth cr * [j(125) + j(n - j)cd], a downward
  // parabola in j peaking at j* = (125/cd + n)/2. The corner j = n is beaten by an interior j
  // whenever j* <= n - 1, i.e. cd >= 125/(n - 2) — so n >= 3 and cd >= 125 makes every instance a
  // trap. Round 1 also has to leave the worn corner, which it does when 125 < n * cd: at n >= 3 and
  // cd >= 125 that is 375 > 125, always.
  const trapInstance = fc.record({
    slots: fc.integer({ min: 3, max: SLOT_IDS.length }),
    cr: fc.integer({ min: 10, max: 60 }),
    cd: fc.integer({ min: 125, max: 300 }),
    weights: weightsArb,
    // Crit drawn as ZERO, so the worn corner really has no crit rate and round 1 prices C.DMG at
    // k * C.RATE = next to nothing. The other six stats are drawn, since they are constant across
    // every build of one instance and cannot change which build wins.
    base: statsArb.map((stats) => ({ ...stats, "C.RATE": 0, "C.DMG": 0 })),
    loreOfSteel: fc.constantFrom(0, 0.15),
  }).map(({ slots, cr, cd, ...rest }) => ({
    ...rest,
    perSlot: Array.from({ length: slots }, () => [
      { set: 0, stats: { ...ZERO_STATS, "C.RATE": cr } },
      { set: 0, stats: { ...ZERO_STATS, "C.DMG": cd } },
    ]),
    // The C.RATE piece in every slot: index 0 of each pair.
    wornPick: SLOT_IDS.map(() => 0),
  }));

  // Three draws: a wide one that mixes every set model on any number of slots, one that forces all
  // nine slots, and the trap. The coverage test at the bottom of this file holds the mix to the
  // three states the properties exist to cover.
  const instance = fc.oneof(
    { arbitrary: instanceWith({ setArb, minSlots: 1 }), weight: 2 },
    { arbitrary: instanceWith({ setArb, minSlots: SLOT_IDS.length }), weight: 1 },
    { arbitrary: trapInstance, weight: 1 },
  );

  // `current` is drawn from `items` BY REFERENCE, not rebuilt. solvePower's documented assumption is
  // that the worn gear is in the pool, and every bound rests on it: the crit box is the non-gear
  // totals plus the most any assignment of `items` can add, so a worn piece absent from the pool
  // could sit outside that box.
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

  // The stat model's columns summed WITHOUT rounding. This is the INDEPENDENT second implementation
  // of buildTotals: it goes through champion-stats.mjs and nothing in power-solve.mjs, so the
  // property compares two implementations rather than one against itself.
  const totalsVia = (champStats, items) => {
    const { columns } = statBreakdown(champStats, items);
    return Object.fromEntries(STATS.map((stat) =>
      [stat, columns.reduce((sum, [, v]) => sum + v[stat], 0)]));
  };

  // Every combination of one item per populated slot, scored on the TRUE objective, best first.
  // Filling every slot loses nothing: every stat a piece adds is non-negative, so C.RATE and
  // 100 + C.DMG both only grow and the crit product grows with them — a piece can never lower the
  // objective, so the best FULL build is the best build, and a worn build with an empty slot cannot
  // beat it. The same argument claim (1) in power-solve.mjs's header makes, checked here against a
  // search that makes no such assumption beyond enumerating full builds.
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
    let best = { lin: -Infinity, items: [] };
    const walk = (i) => {
      if (i === slots.length) {
        const score = lin(totalsVia(champStats, chosen), weights);
        if (score > best.lin) best = { lin: score, items: [...chosen] };
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
- [ ] 2. Append the two properties. Both live in ONE property so an instance runs the brute force, the exact search and the default mode once between them, rather than three times over three different vaults.
  ```javascript
  // Measured locally: RECORD ME at the default 300 runs, and RECORD ME at a fuzz shard's 25,000.
  // (Fill both in from step 3's output and step 5's; if the 25,000 figure exceeds 50 s the
  // interrupt above stops fast-check there and the shard still passes on however many fit.)
  test("the exact search equals an exhaustive search and never trails the default mode", () => {
    fc.assert(
      fc.property(instance, (spec) => {
        const { items, current } = vaultOf(spec);
        const champStats = champStatsOf(spec);
        const { weights } = spec;
        const optimum = bruteForceBest(items, champStats, weights);
        const exact = solvePowerExact({ items, faction: 0, champStats, current, weights });
        const iterated = solvePower({ items, faction: 0, champStats, current, weights });

        // EQUALITY, not a bound in one direction: an answer below the optimum means the search
        // pruned the optimum, and an answer above it means the brute force is wrong or the reported
        // `lin` does not belong to the items returned.
        expect(near(exact.build.lin, optimum.lin),
          `exact ${exact.build.lin} must equal the optimum ${optimum.lin}`).toBe(true);
        // The reported lin really belongs to the items returned, recomputed through the independent
        // stat model rather than read back off the field.
        expect(near(exact.build.lin, lin(totalsVia(champStats, exact.build.items), weights)),
          "the reported lin must be the lin of the items returned").toBe(true);
        expect(noLessThan(exact.build.lin, iterated.builds[0].lin),
          `exact ${exact.build.lin} cannot trail solvePower's ${iterated.builds[0].lin}`).toBe(true);
        expect(exact.provenOptimal).toBe(true);
        expect(exact.plansPruned).toBeLessThanOrEqual(exact.plansTotal);
      }),
      PARAMS,
    );
  }, 60_000);
  ```
- [ ] 3. Run it at the default run count and record the wall time.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: passes. Note the reported duration and write it into the `RECORD ME` comment (the first figure). It should be of the order of a few seconds; if it exceeds 60 s, stop and go to Task 7.2's contingency before continuing.

### Task 6.2: Prove the property is not vacuous

The property tests code written in Chunk 4, so it passed on its first run. That is not evidence it tests anything — this repo's convention (`power-solve.prop.test.mjs:195-207`, `build-solve.prop.test.mjs`) is to mutate the implementation, watch the property fail, restore, and record the result beside the test. That is this property's "watch it fail" step.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs` (temporarily, twice)
- Modify: `oracle/analytics/__tests__/power-solve-exact.prop.test.mjs`

**Steps:**

- [ ] 1. MUTATION 1 — make the node bound unsound by scaling it down. In `searchBest`'s `ceilingAt`, change the final `return bound;` to `return bound * 0.9;`.
- [ ] 2. Run the property and confirm it fails.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: fails with `exact … must equal the optimum …`. Note how many instances it took. If it does NOT fail, the search is never pruning on this generator — a real finding: record it and raise it in the result, because the property would then be proving nothing about the bound.
- [ ] 3. Revert mutation 1 (restore `return bound;`) and confirm green.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: passes.
- [ ] 4. MUTATION 2 — make the candidate filter unsound by dropping on two keys instead of three. In `candidatesBySlot`, delete the `&& y.cd >= x.cd` clause from the `beaten` test.
- [ ] 5. Run the property and confirm it fails.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: fails with `exact … must equal the optimum …`.
- [ ] 6. Revert mutation 2 and confirm green.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: passes.
- [ ] 7. Record both results above the property, replacing nothing and adding below the measured-times comment.
  ```javascript
  // TWO MUTATIONS were run against this property, and both fail it — recorded here because a
  // property written after the code it tests passed on its first run, which is no evidence at all
  // that it tests anything:
  //
  //   - Scaling the node ceiling to 0.9 of itself, so the bound is no longer sound, fails on
  //     instance RECORD ME. The pruning really is load-bearing.
  //   - Dropping the C.DMG key from the candidate dominance test, so a piece worse on non-crit
  //     value and C.RATE but better on C.DMG is discarded, fails on instance RECORD ME.
  ```
  Fill both `RECORD ME`s with the instance counts from steps 2 and 5.
- [ ] 8. Confirm the file is back to green and the implementation is unmutated.
  ```bash
  git diff --stat oracle/analytics/power-solve.mjs
  ```
  Expected: no output — the two mutations are fully reverted and `power-solve.mjs` matches the last commit.

### Task 6.3: Generator coverage

**Files:**

- Modify: `oracle/analytics/__tests__/power-solve-exact.prop.test.mjs`

**Steps:**

- [ ] 1. Append the one-piece-tier helpers and the coverage test.
  ```javascript
  // The one-piece tiers the real table has, READ OFF SET_BONUSES rather than listed, so a set whose
  // first tier moves in a patch does not quietly drop out of the state below.
  const ONE_PIECE_TIERS = Object.entries(SET_BONUSES)
    .filter(([, row]) => row.kind === "tiered" && row.tiers.some(([threshold]) => threshold === 1))
    .map(([id]) => Number(id));

  // ACTIVE, not merely present: a one-piece tier granting HP% pays nothing to a champion whose base
  // HP is zero, and counting such a set would make the state look covered while the non-crit lane
  // never met a real one-piece bonus at all.
  const paysFromOnePiece = (setId, base, loreOfSteel) => {
    const vector = setVectors(setId, base, loreOfSteel)[1];
    return STATS.some((stat) => vector[stat] > 0);
  };

  // The generator IS the test. When it narrows, nothing else here complains — which is how a
  // property file can come to draw four setless slots while claiming to prove a nine-slot
  // crit-product search exact. So the three states the property exists to cover are asserted
  // REACHABLE rather than left to inspection.
  //
  // Unseeded and sampled wide on purpose: a fixed seed would make the floor hostage to fast-check
  // changing how it generates between versions.
  //
  // `belowOptimum` is the state that matters most: it is the only one under which the exact search
  // has to BEAT its incumbent rather than confirm it, so a generator that never reached it would
  // leave the whole branch-and-bound untested by this file. The trap draw exists for it, and reads
  // the optimum off the BRUTE FORCE rather than off solvePowerExact, so the check is not circular.
  //
  // Measured locally: RECORD ME s, with RECORD ME below-optimum, RECORD ME nine-slot and RECORD ME
  // active-one-piece-tier instances out of 2,000.
  test("the generator reaches every state the property is supposed to cover", () => {
    const seen = { belowOptimum: 0, nineSlots: 0, onePieceTier: 0 };
    for (const spec of fc.sample(instance, 2000)) {
      const { items, current } = vaultOf(spec);
      const champStats = champStatsOf(spec);
      const { weights } = spec;
      const optimum = bruteForceBest(items, champStats, weights);
      const iterated = solvePower({ items, faction: 0, champStats, current, weights });
      if (iterated.builds[0].lin < optimum.lin - TOL * Math.max(1, optimum.lin)) {
        seen.belowOptimum++;
      }
      if (new Set(items.map((it) => it.slot)).size === SLOT_IDS.length) seen.nineSlots++;
      const held = [...setCounts(optimum.items).keys()];
      if (held.some((setId) => ONE_PIECE_TIERS.includes(setId)
        && paysFromOnePiece(setId, spec.base, spec.loreOfSteel))) {
        seen.onePieceTier++;
      }
    }
    // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
    // covered by the 300 instances the property above actually runs. At 5% each is hit a dozen
    // times or more in a default run, and hundreds of times in a fuzz shard.
    for (const [state, hits] of Object.entries(seen)) {
      expect(hits, `${state} is generated too rarely to count as covered`).toBeGreaterThan(100);
    }
  }, 60_000);
  ```
- [ ] 2. Run it and read the three counts out of the failure message, or out of a temporary `console.log(seen)` if it passes.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs -t "reaches every state"
  ```
  Expected: passes. `belowOptimum` should land near a third of the sample, since the trap draw is one of three equally weighted arbitraries and every trap instance is suboptimal by construction; `nineSlots` likewise, from the `minSlots: 9` draw plus the trap's 3-to-9 slot draw; `onePieceTier` from the two set-bearing draws.
- [ ] 3. If any count is at or below 100, raise that draw's weight in the `instance` `fc.oneof` and re-run until all three clear it. Do **not** lower the floor — it is the whole point of the test.
- [ ] 4. Record the three measured counts and the wall time in the `RECORD ME` slots of the comment above the test.
- [ ] 5. If the test takes more than 45 s locally, apply the documented reduction: delete the `bruteForceBest` call and read the optimum off `solvePowerExact` instead, adding this note above the test. The property above is what makes that sound — it proves `solvePowerExact` IS the optimum — so it is a shortcut, not a circularity.
  ```javascript
  // The optimum is read off solvePowerExact rather than off the brute force, because 2,000 brute
  // forces of up to 512 builds each ran past this test's budget. Not circular: the property above
  // proves solvePowerExact equals the brute force on this very generator, so it IS the optimum
  // here. `belowOptimum` then compares two independent code paths, which is what the state is.
  ```
- [ ] 6. Confirm the whole file is green.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: 2 passing tests.
- [ ] 7. Commit.
  ```bash
  git add oracle/analytics/__tests__/power-solve-exact.prop.test.mjs && git commit -m "#47 power-solve-exact: property-test the proven maximum against an exhaustive search

Co-Authored-By: Claude"
  ```

---

## Chunk 7: performance

### Task 7.1: A medium synthetic instance inside the budget

**Files:**

- Modify: `oracle/analytics/__tests__/power-solve-exact.prop.test.mjs`

**Steps:**

- [ ] 1. Append the seeded generator and the performance test.
  ```javascript
  // --- performance --------------------------------------------------------------------------------

  // Eight set models spanning every mechanic the search has to price: 5 and 6 are two-piece
  // stackers on the two crit stats; 41 Fatal and 2 Offense are two-piece stackers that pay ATK%
  // (and, for Fatal, C.RATE) off the champion's base; and 60, 59, 48 and 35 are tiered sets that all
  // pay from a SINGLE piece, which is what puts one-piece bonuses on every lane at once.
  const PERF_SETS = [5, 6, 41, 2, 60, 59, 48, 35];

  // A deterministic 32-bit LCG. The wall time recorded below only means something if the instance is
  // identical every run, and seeding fast-check for 216 items would be heavier than this.
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Measured locally: RECORD ME s wall, against a 15 s TARGET and the 60 s timeout that is the
  // actual pass condition. RECORD ME plans, RECORD ME pruned.
  //
  // A plain seeded test, NOT an fc.property, so FC_NUM_RUNS does not multiply it. It therefore costs
  // the same on every `npm test` and on each of the ten fuzz shards every fifteen minutes — a known
  // and accepted charge on the local gate, matching build-solve.prop.test.mjs's own.
  //
  // This is a MEDIUM instance and deliberately not a full vault: 9 slots x 8 sets x 3 items is 216
  // pieces, where a real vault is thousands. power-solve.mjs's header says outright that nothing
  // bounds this mode's runtime; a real snapshot is a manual timing after merge, not a test.
  test("a medium synthetic instance proves its maximum inside the time budget", () => {
    const rand = lcg(20261003);
    const items = [];
    let id = 0;
    for (const slot of SLOT_IDS) {
      for (const set of PERF_SETS) {
        for (let n = 0; n < 3; n++) {
          // FOUR stats drawn from all eight, so crit appears throughout rather than on a dedicated
          // minority of pieces, and the non-crit lane has something to weigh against it everywhere.
          const stats = { ...ZERO_STATS };
          const pool = [...STATS];
          for (let pick = 0; pick < 4; pick++) {
            const stat = pool.splice(Math.floor(rand() * pool.length), 1)[0];
            const scale = { HP: 2000, ATK: 200, DEF: 200, SPD: 30,
              "C.RATE": 30, "C.DMG": 60, RES: 40, ACC: 40 }[stat];
            stats[stat] = Math.floor(rand() * scale);
          }
          items.push(mkItem(++id, slot, set, stats));
        }
      }
    }
    const champStats = {
      base: { HP: 20000, ATK: 1500, DEF: 1200, SPD: 100,
        "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 },
      sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
      observedSets: new Map(), loreOfSteel: 0.15, awaken: 0,
    };
    // A real role-default weight row, so the lanes have the magnitudes they will meet in use.
    const weights = { b: 0.0122, r: 0.277, a: 0.0387, s: 0.022, k: 0.00154 };
    // One worn piece per slot, drawn from the vault BY REFERENCE, so solvePower's documented
    // assumption holds.
    const current = SLOT_IDS.map((slot) => items.find((it) => it.slot === slot));

    expect(items).toHaveLength(216);
    expect(current.filter(Boolean)).toHaveLength(9);

    const started = Date.now();
    const got = solvePowerExact({ items, faction: 0, champStats, current, weights });
    const elapsed = Date.now() - started;

    expect(got.provenOptimal).toBe(true);
    expect(got.build.items.map((it) => it.slot).sort((a, b) => a - b)).toEqual(SLOT_IDS);
    // Recomputed from the items returned through the INDEPENDENT stat model, so this checks the
    // reported lin rather than reading back whatever the search put in the field.
    expect(got.build.lin)
      .toBeCloseTo(lin(totalsVia(champStats, got.build.items), weights), 6);
    // Never worse than what the champion is wearing, and never worse than the default mode.
    expect(noLessThan(got.build.lin, lin(totalsVia(champStats, current), weights))).toBe(true);
    expect(noLessThan(got.build.lin,
      solvePower({ items, faction: 0, champStats, current, weights }).builds[0].lin)).toBe(true);
    // A floor, not the measured figure — the measured one is in the comment above. This catches the
    // set mix collapsing to a handful of plans, which would make the timing meaningless.
    expect(got.plansTotal).toBeGreaterThan(100);
    // The pass condition is this test's 60 s timeout; asserting it here names the budget at the
    // point a reader is looking at the number, rather than leaving it implicit in the timeout.
    expect(elapsed).toBeLessThan(60_000);
  }, 60_000);
  ```
- [ ] 2. Run it and record the wall time, `plansTotal` and `plansPruned`.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs -t "medium synthetic"
  ```
  Expected: passes. Note the duration.
- [ ] 3. Fill the three `RECORD ME` slots in the comment with the measured wall time and the two plan counts. Record the measured time **whether or not** it meets the 15 s target — the comment's job is to say what the number is, not that it was good.
- [ ] 4. Confirm the whole property file is green.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: 3 passing tests.
- [ ] 5. Commit.
  ```bash
  git add oracle/analytics/__tests__/power-solve-exact.prop.test.mjs && git commit -m "#47 power-solve-exact: time a medium synthetic instance against the 60 s budget

Co-Authored-By: Claude"
  ```

### Task 7.2: Contingency if the performance test exceeds 60 s

Only run this task if Task 7.1 step 2 failed on time. The 15 s target is explicitly not a pass condition, so a run between 15 s and 60 s needs nothing but the recorded number.

**Files:**

- Modify: `oracle/analytics/power-solve.mjs`

**Steps:**

- [ ] 1. Measure where the time goes before changing anything. Write a scratch probe that reports the plan-pass time and the search time separately.
  ```bash
  mkdir -p .hivemind/scratch
  ```
  Then create `.hivemind/scratch/probe-exact.mjs` importing `solvePowerExact` and the perf instance's construction, logging `plansTotal`, `plansPruned` and `runtimeMs`, and run it with `node .hivemind/scratch/probe-exact.mjs`.
- [ ] 2. If the plan pass dominates (`plansTotal` in the hundreds of thousands), cut `PERF_SETS` from eight models to six in the test, keeping both crit stackers and at least two one-piece tiers, and record in the comment that the mix was sized down and what the eight-set figure was — the same thing `power-solve.prop.test.mjs:261-276` does for its own vault.
- [ ] 3. If the search dominates, apply the one sound tightening left: in `laneGain`, skip a set whose `column[reach] === column[held]` before the subtraction, and hoist `suffSupply[depth]` lookups out of the loop. Re-run the property test to confirm the answer is unchanged.
  ```bash
  npx vitest run oracle/analytics/__tests__/power-solve-exact.prop.test.mjs
  ```
  Expected: the equality property still passes — a tighter bound must not change the answer, only the time.
- [ ] 4. Do **not** weaken the exactness to make the budget: do not loosen the strict-only prune, do not cap the search depth, do not add a node limit. If the instance still exceeds 60 s after steps 2 and 3, record the measured time and the plan counts in the comment, leave the test skipped with `test.skip` and a comment naming the measured figure, and report it as a concern in the implementation result. The issue already treats real-vault runtime as unknown and out of scope; an honest skipped timing is better than a search that is no longer exact.
