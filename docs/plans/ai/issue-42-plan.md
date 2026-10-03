# Generic Exact Build Solver Implementation Plan

**Goal:** Add `oracle/analytics/build-solve.mjs`, a stat-agnostic solver that returns the provably best build for an objective of "per-item value plus per-(set, count) bonus", and stays exact when sets pay out from a single piece — the case `speed-solve.mjs`'s four-active-sets argument cannot cover.

**Architecture:** Plan enumeration as in `speed-solve.mjs`, but the per-plan inner solve becomes a **maximum-weight assignment** (Kuhn–Munkres) over three kinds of column instead of a counts-state DP. Plans still name only sets held at a *multi-piece* count — at most four, because a useful count is at least two and there are nine slots — and every **one-piece** bonus is bought instead by a **singleton column**, one per set, usable once. A third kind of column (one **free** column per slot, usable only by its own row) fills whatever is left. Every resulting build is then re-scored on the **items it actually contains**, never on the plan, so a free pick that completes a set by accident is credited. No branch-and-bound: the speed solver's bound does not transfer once singleton bonuses exist outside the plan.

**Tech Stack:** Plain Node ESM (`.mjs`) under `oracle/`, outside the TypeScript project references. vitest 3 for unit tests, fast-check 4.5 for property tests. No new dependencies. No build step touches this directory.

---

## Scope Check

**Single subsystem.** Everything lands in `oracle/analytics/` — one new pure module and two new test files. Nothing in `packages/`, no config change, no CLI, no documentation file outside this plan. No split is warranted.

---

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Create | `oracle/analytics/build-solve.mjs` | The solver: index, plan enumeration, per-plan assignment, scoring, `solve` |
| Create | `oracle/analytics/__tests__/build-solve.test.mjs` | Unit tests for every exported function and every case in the issue's Change 2 |
| Create | `oracle/analytics/__tests__/build-solve.prop.test.mjs` | Brute-force equivalence property, generator-coverage test, performance test |
| Unchanged | `oracle/analytics/speed-solve.mjs` | **Must not be touched.** Acceptance criterion. |
| Unchanged | `oracle/analytics/speed.mjs` | **Must not be touched.** Acceptance criterion. |
| Unchanged | `vitest.config.ts` | Its `include` already has `"oracle/analytics/**/*.test.mjs"`, which matches both new files |
| Unchanged | `eslint.config.js` | Its `files: ["oracle/**/*.mjs"]` block already grants Node globals to both new files |
| Unchanged | `oracle/analytics/README.md` | Documents CLI tools only; `speed-solve.mjs` is not listed there either, and neither is this |

No existing file is modified. If you find yourself editing one, stop and re-read this table.

---

## Context An Executing Engineer Needs

Read this whole section before Task 1. Every claim was verified against the working tree during exploration; the file:line references are load-bearing.

### What the data looks like

A decoded item (`oracle/analytics/decode.mjs:46-53`) is:

```js
{ id, slot, set, rank, rarity, level, faction, isAccessory, mainStat, substats, ascStat, ascLevel, equippedChampId }
```

`build-solve.mjs` reads only **five** of those fields — `id`, `slot`, `set`, `isAccessory`, `faction` — plus whatever the injected `valueOf(item)` reads. `slot` is 1–9; 7, 8 and 9 are the accessory slots and `isAccessory` is derived from that. `set` is an integer set id, and **`0` means "no set"** (setless). `faction` is the DB's `accset` column.

### The module this one is modelled on

`oracle/analytics/speed-solve.mjs` (134 lines, pure, no CLI, no `main()`). Read it before starting. Its `buildIndex` at lines 12–26 is the direct ancestor of this module's — same body, `value` in place of `speed`. Its `slotsSupplying` (30–34), `freeBest` (65–72) and `enumeratePlans` (46–62) are the shapes to follow.

**It must not be modified.** The duplicated `buildIndex` is deliberate; folding the two together means moving `speed.mjs` onto this solver, which the issue puts explicitly out of scope.

### Why `speed-model.mjs`'s `setCounts` is not imported

`speed-model.mjs:13` does `import { setEffect } from "./speed-sets.mjs"`, so importing `setCounts` from it would pull the speed set tables into a module whose whole point is knowing nothing about stats. Reimplement the three-line count locally (`countsOf`, Task 4). Its `if (!item.set) continue` is the precedent for skipping set 0.

### The three things most likely to be got wrong

1. **The tie-break is element-wise numeric, not lexicographic.** `[9, 30]` beats `[10, 20]` because `9 < 10`. But as joined strings `"9,30" > "10,20"`, because `"9"` sorts after `"1"`. The joined key is correct for **dedup equality** and wrong for **ordering**. `speed.mjs:179` uses the joined key for dedup only; do the same, and compare the id arrays element by element for order.

2. **`FORBIDDEN` must be finite.** The assignment matrix needs a sentinel for "this slot does not supply this set". Using `-Infinity` makes the Hungarian algorithm's potential updates produce `NaN` (`∞ − ∞`). Use a large finite negative number, sized as Task 5 describes.

3. **Two different filters keep a plan out of the plan space, and they are easy to confuse.** The *room* cap (`Math.min(slotsSupplying, slots.length - used)`) stops a single set asking for more pieces than exist. The *union* filter stops two sets that each fit alone from both being named when they draw on the same slots. A test meaning to exercise the union filter must leave enough spare slots that the room cap does not pre-empt it — see Task 3's last-but-one test, which needs four populated slots for exactly this reason.

### Test conventions in this tree

Unanimous across the 25 files in `oracle/analytics/__tests__/`:

- First line is a `// oracle/analytics/__tests__/<name>.test.mjs` self-identifying comment, often followed by a `//` paragraph saying why the file exists.
- `import { test, expect } from "vitest";` — **no `describe` blocks anywhere in this tree.**
- Property files use `import fc from "fast-check";` directly, **not** `@fast-check/vitest` (installed, but used only under `packages/`).
- A factory with every field defaulted (`speed-solve.test.mjs:9-13`), and small spec helpers (`spd`, `pool`).
- A `//` comment above almost every test saying **which weaker assertion would also have passed**, and why this one is stronger. This is the house style; match it. `speed-solve.test.mjs:78-79` and `:100-101` are good examples.
- Throw idiom: `expect(() => f()).toThrow(/regex/)`.
- Expected tables are written **longhand**, not computed from the thing under test (`speed-sets.test.mjs:105-116` explains why at length).

### Time budget and the fuzz workflow

`vitest.config.ts:11`: `testTimeout: Number(process.env.VITEST_TIMEOUT) || (process.env.FC_NUM_RUNS ? 120_000 : 10_000)`. Default **10 s**. An explicit third argument to `test()` overrides it — **no per-test timeout exists anywhere in this repo yet**, so the three timed tests in the property file will be the first.

`.github/workflows/fuzz.yml` runs the whole suite 10× every 15 minutes at `FC_NUM_RUNS=25000`, `VITEST_TIMEOUT=120000`. Vitest's birpc has a hardcoded 60 s RPC timeout; a test that runs past it fails the shard with `STACK_TRACE_ERROR` rather than a real property violation, and the workflow carries a Python shim (`fuzz.yml:40-53`) to paper over exactly that. Keeping each test under 60 s — and fast-check itself under 50 s via `interruptAfterTimeLimit` — avoids relying on the shim.

`interruptAfterTimeLimit` is supported: `node_modules/fast-check/lib/types/check/runner/configuration/Parameters.d.ts:90`. `markInterruptAsFailure` (`:96`) defaults to `false`, so an interrupted run that had at least one success **passes** — which is the behaviour wanted.

### Commit discipline

- `CLAUDE.md` requires `npm run build`, `npm test` and `npm run lint` to pass before **every** commit. There are no git hooks; run them by hand.
- Observe each RED state and record the failure text in your phase result, but **do not commit a RED state** — a committed broken state violates the gate above. Commit after GREEN.
- **No commit may contain a stub, a placeholder or a function body added only so the next commit can replace it.** The task order below is built so that never happens: each function arrives complete, together with its first caller.
- One command per Bash call. No `&&`, no `;`, no pipes, no `$(...)`.
- Edit files with `Write`/`Edit`, never by shelling out (no heredocs, no `sed -i`, no `echo >>`).
- Conventional commits with a scope. Co-author trailer is exactly `Co-Authored-By: Claude` — no email, no model version.

---

## Known Limitations — Do Not Chase These

- **The performance test adds ~20–30 s to every `npm test`.** It is not scaled by `FC_NUM_RUNS`, so it costs the same on a local gate run and on each of the ten fuzz shards every 15 minutes. The issue mandates it. Record the cost in the comment beside the test (Task 12) and do not try to skip it conditionally.
- **`enumeratePlans` is called twice in the performance test** — once by the test to record the plan count, once inside `solve`. Enumeration is a small fraction of the total, and the issue asks for the count. Leave it.
- **`speed-solve.mjs` has its own `buildIndex`, now duplicated here.** Out of scope, stated in the issue's Notes. Do not refactor either.
- **`CLAUDE.md:37` and `CONTRIBUTING.md:57` both claim tests live in `packages/*/src/__tests__/`.** Already stale (25 files live under `oracle/analytics/__tests__/`). Out of scope; do not edit.
- **The real 41-set stat table does not exist yet.** Branches `feature/issue-41-…` and `feature/issue-43-…` have zero commits beyond `main`. The performance test's 23/5/13 mix is synthesised inside the test file and must not import anything that does not exist.

---

## Chunk A — The module and its index

### Task 1: `SLOTS` and `buildIndex`

The module header carries the exactness argument for the whole module, so it is written now even though the functions it describes arrive over the next three chunks. It is the module's contract, fixed by the issue — not a placeholder.

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Create: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/build-solve.test.mjs` with the header, helpers and the first six tests:

  ```js
  // oracle/analytics/__tests__/build-solve.test.mjs
  import { test, expect } from "vitest";
  import { SLOTS, buildIndex } from "../build-solve.mjs";

  // Every item carries a plain `value` the injected valuation reads back. The module is
  // stat-agnostic — it never looks at a stat — so a number on the item is the honest way to
  // exercise it, and it keeps each expected score below readable arithmetic rather than a speed
  // calculation. Every other field is present because a real decoded artifact has it.
  const valueOf = (it) => it.value;

  const item = (o = {}) => ({
    id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
    isAccessory: false, value: 0, mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
  });

  const pool = (specs) => specs.map((s, i) => item({ id: i + 1, ...s }));
  const indexOf = (specs, faction = 0) => buildIndex(pool(specs), faction, valueOf);

  test("SLOTS covers all nine equipment slots", () => {
    expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("buildIndex keeps only the best item of each set in each slot", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 },
      { slot: 1, set: 4, value: 18 },
      { slot: 1, set: 38, value: 14 },
    ]);
    expect(index.get(1).get(4).item.id).toBe(2);
    expect(index.get(1).get(4).value).toBe(18);
    expect(index.get(1).get(38).item.id).toBe(3);
  });

  // The id is a TIE-break, subordinate to value — it must never unseat a better incumbent. The
  // worse item has to arrive second for this to bite: an id-dominant comparison is invisible
  // whenever the pool happens to be id-ascending, which a database read usually is.
  test("buildIndex keeps the better item even when the worse one has the lower id", () => {
    const index = indexOf([
      { id: 2, slot: 1, value: 18 }, { id: 1, slot: 1, value: 10 },
    ]);
    expect(index.get(1).get(4).item.id).toBe(2);
  });

  // The winner is the lowest id of the whole tied group, not of the first or last pair compared.
  // A tie that depended on row order would return a different build on a rerun.
  test("buildIndex breaks a three-way tie on the lowest id wherever it sits in the row order", () => {
    for (const order of [[7, 3, 5], [5, 7, 3], [3, 5, 7]]) {
      const index = indexOf(order.map((id) => ({ id, slot: 1, value: 12 })));
      expect(index.get(1).get(4).item.id).toBe(3);
    }
  });

  // The faction lock covers all three accessory slots and none of the six artifact slots. A filter
  // that reached one slot too far, or stopped one slot short, would pass a single-slot case.
  test("buildIndex applies the faction lock to every accessory slot and no artifact slot", () => {
    const wrong = [7, 8, 9].map((slot) => ({ id: slot, slot, isAccessory: true, faction: 5, value: 10 }));
    const artifacts = [1, 2, 3, 4, 5, 6].map((slot) => ({ id: slot, slot, faction: 5, value: 10 }));
    const index = buildIndex([...wrong, ...artifacts].map((o) => item(o)), 2, valueOf);
    for (const slot of [7, 8, 9]) expect(index.has(slot)).toBe(false);
    for (const slot of [1, 2, 3, 4, 5, 6]) expect(index.get(slot).get(4).item.id).toBe(slot);
  });

  // The valuation is injected, so the index must rank by it and not by any field it picks itself.
  // Ranking by a hardcoded field would pass every other test in this file.
  test("buildIndex ranks by the injected valuation rather than any field of its own", () => {
    const index = buildIndex([
      item({ id: 1, slot: 1, set: 4, value: 50 }),
      item({ id: 2, slot: 1, set: 4, value: 1 }),
    ], 0, (it) => it.id);
    expect(index.get(1).get(4).item.id).toBe(2);
    expect(index.get(1).get(4).value).toBe(2);
  });
  ```

- [ ] 2. Run the tests and watch them fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `Failed to resolve import "../build-solve.mjs"`. The feature is missing, which is the right reason.

- [ ] 3. Create `oracle/analytics/build-solve.mjs` with the module header. Copy it exactly; the exactness argument is the issue's own wording and a reviewer will check it.

  ```js
  // oracle/analytics/build-solve.mjs
  //
  // The provably best build for an objective that is a per-item VALUE plus a per-(set, count)
  // BONUS. Stat-agnostic by construction: it is handed `valueOf` and `bonusAt` and knows nothing
  // about what they measure.
  //
  // WHY A SECOND SOLVER. speed-solve.mjs enumerates set plans and runs a counts-state DP per plan.
  // Its exactness rests on every speed bonus needing at least TWO pieces, so at most four sets can
  // be active in nine slots and one plan can name all of them. Newer sets pay out from a SINGLE
  // piece. A build can then hold nine active sets at once — more than any plan can name — and that
  // argument collapses. The fix is not a bigger plan space (nine-set plans number in the billions)
  // but a different shape: plans still name only the sets held at a multi-piece count, and every
  // one-piece bonus is bought instead by a SINGLETON COLUMN in the assignment, one per set, usable
  // once.
  //
  // WHY IT IS EXACT. Take an optimal build B. Name each set B holds at or above one of its useful
  // counts, at the largest such count. At most four such sets fit in nine slots, so this plan is
  // enumerated. Map B into that plan: `count` pieces of each plan set go to that set's plan
  // columns; one piece of every other set with `bonusAt[1] > 0` goes to that set's singleton
  // column; every remaining piece goes to its slot's free column. Below its first useful count a
  // set gains nothing past its first piece, and a plan set gains nothing past its named count, so
  // this assignment credits all of B's value. No realized build scores below its assignment's
  // credited value, because bonuses never decrease with more pieces and singleton columns credit
  // distinct sets outside the plan, once each. So the best realized score over all plans equals B's.
  //
  // WHY AT MOST FOUR. A useful count is at least two — one-piece bonuses are bought by singleton
  // columns and never enter a plan — so a fifth named set would need a tenth slot.
  //
  // NO BRANCH AND BOUND. speed-solve.mjs prunes plans against an incumbent; that bound does not
  // carry over. Here a plan's assignment also collects singleton bonuses for sets OUTSIDE the plan,
  // so a bound computed from the sets a plan names is not an upper bound at all, and one that added
  // every singleton bonus to be safe would prune almost nothing. `top` needs every plan's best
  // anyway. So every plan is assigned, and the cost per call is uniform and predictable.
  //
  // SCORING IS ALWAYS ON THE ACTUAL ITEMS, never on the plan: a free pick carries an item that
  // belongs to some set and can complete one by accident, and that has to count. `credited` is what
  // an assignment paid for and is a LOWER bound on the realized score; `scoreBuild` is the realized
  // score.

  export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  // slot -> setId -> the best item of that set in that slot, by the caller's valuation. For a fixed
  // slot->set assignment nothing else about a slot matters, so this IS the search space. Accessory
  // slots (7-9) are filtered to the champion's faction, a hard game constraint. Ties break on the
  // lower item id so a rerun returns the same build.
  //
  // Identical in shape to speed-solve.mjs's buildIndex with a generic `value` in place of `speed`.
  // The duplication is deliberate: folding the two together means moving speed.mjs onto this
  // solver, which is its own change.
  export function buildIndex(items, faction, valueOf) {
    const index = new Map();
    for (const item of items) {
      if (item.isAccessory && item.faction !== faction) continue;
      let bySet = index.get(item.slot);
      if (!bySet) index.set(item.slot, (bySet = new Map()));
      const value = valueOf(item);
      const current = bySet.get(item.set);
      if (!current || value > current.value
        || (value === current.value && item.id < current.item.id)) {
        bySet.set(item.set, { item, value });
      }
    }
    return index;
  }
  ```

- [ ] 4. Run the tests and watch them pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  6 passed (6)`, no warnings.

- [ ] 5. Run the lint gate: `npm run lint`
     Expected: exit 0, no output.

- [ ] 6. Run the build gate: `npm run build`
     Expected: exit 0. (`oracle/` is outside the TS project references, so this only confirms nothing else broke.)

- [ ] 7. Run the full suite: `npm test`
     Expected: all tests pass, including the ~310 pre-existing ones.

- [ ] 8. Stage both files: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`

- [ ] 9. Commit:
  ```
  git commit -m "feat(analytics): candidate index for the generic build solver

  Co-Authored-By: Claude"
  ```

---

## Chunk B — The set model and the plan space

### Task 2: `slotsSupplying` and `usefulCounts`

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Change the test file's import to `import { SLOTS, buildIndex, slotsSupplying, usefulCounts } from "../build-solve.mjs";` and add two helpers directly below `indexOf`:

  ```js
  // A bonus profile over 0..9 pieces, as `bonusAt` wants it. `at` gives the TOTAL bonus from that
  // piece count upward, so tiers({ 2: 10, 4: 25 }) is [0,0,10,10,25,25,25,25,25,25]. A helper is
  // fine here because these are INPUTS; every expected score below is written out as arithmetic.
  const tiers = (at) => {
    const out = [0];
    let current = 0;
    for (let n = 1; n <= 9; n++) {
      if (at[n] !== undefined) current = at[n];
      out.push(current);
    }
    return out;
  };

  const bonusOf = (byId) => new Map(Object.entries(byId).map(([id, at]) => [Number(id), tiers(at)]));
  ```

- [ ] 2. Append the tests for both functions:

  ```js
  test("slotsSupplying counts distinct slots that can supply a set", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 },
      { slot: 2, set: 4, value: 12 }, { slot: 3, set: 38, value: 10 },
    ]);
    expect(slotsSupplying(index, 4)).toBe(2);
    expect(slotsSupplying(index, 38)).toBe(1);
    expect(slotsSupplying(index, 66)).toBe(0);
  });

  // Only counts where one more piece actually pays are worth planning around: a count between two
  // paying counts grants exactly the lower one's bonus, so planning it enumerates the same build
  // twice.
  test("usefulCounts lists only the counts where one more piece pays", () => {
    const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
    expect(usefulCounts(bonusAt, 4, 9)).toEqual([2, 4, 6]);
    expect(usefulCounts(bonusAt, 58, 9)).toEqual([3, 5, 8]);
  });

  // The cap is maxSlots, and it must INCLUDE a count landing exactly on it — off by one here
  // silently deletes the strongest plan a pool can reach rather than failing loudly.
  test("usefulCounts caps at maxSlots and includes a count landing exactly on it", () => {
    const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 }, 58: { 3: 10, 5: 20, 8: 32 } });
    expect(usefulCounts(bonusAt, 4, 6)).toEqual([2, 4, 6]);
    expect(usefulCounts(bonusAt, 4, 5)).toEqual([2, 4]);
    expect(usefulCounts(bonusAt, 58, 2)).toEqual([]);
  });

  // THE case this solver exists for. A set that pays from one piece has no useful count at all
  // unless it also pays again later, because one-piece bonuses are bought by a singleton column
  // instead of being planned. A solver that planned them would need nine-set plans.
  test("usefulCounts never reports 1, so a one-piece bonus is never planned", () => {
    const bonusAt = bonusOf({ 70: { 1: 9 }, 71: { 1: 9, 3: 20 } });
    expect(usefulCounts(bonusAt, 70, 9)).toEqual([]);
    expect(usefulCounts(bonusAt, 71, 9)).toEqual([3]);
  });

  test("usefulCounts is empty for a set the model says nothing about", () => {
    expect(usefulCounts(new Map(), 4, 9)).toEqual([]);
  });
  ```

- [ ] 3. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `slotsSupplying is not a function` and `usefulCounts is not a function`, 5 failing tests. The six from Task 1 still pass.

- [ ] 4. Append to `oracle/analytics/build-solve.mjs`, below `buildIndex`:

  ```js
  // How many distinct slots could contribute a piece of this set.
  export function slotsSupplying(index, setId) {
    let n = 0;
    for (const bySet of index.values()) if (bySet.has(setId)) n++;
    return n;
  }

  // The piece counts worth planning around: those where one more piece actually pays. Counts start
  // at TWO. A one-piece bonus is never planned — it is bought by a singleton column instead, which
  // is the whole reason this solver exists — and a count between two paying counts grants exactly
  // the lower one's bonus, so planning it would enumerate the same build twice. `maxSlots` is
  // however many slots of this set the pool can actually supply.
  export function usefulCounts(bonusAt, setId, maxSlots) {
    const bonus = bonusAt.get(setId);
    const out = [];
    if (!bonus) return out;
    const top = Math.min(maxSlots, SLOTS.length);
    for (let count = 2; count <= top; count++) if (bonus[count] > bonus[count - 1]) out.push(count);
    return out;
  }
  ```

- [ ] 5. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  11 passed (11)`.

- [ ] 6. Run `npm run lint`. Expected: exit 0.
- [ ] 7. Run `npm test`. Expected: all pass.
- [ ] 8. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 9. Commit:
  ```
  git commit -m "feat(analytics): useful piece counts for a generic set model

  Co-Authored-By: Claude"
  ```

---

### Task 3: `enumeratePlans`

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Add `enumeratePlans` to the test file's import list, then append these tests:

  ```js
  test("enumeratePlans always includes the empty plan", () => {
    const index = indexOf([{ slot: 1, set: 0, value: 10 }]);
    expect(enumeratePlans(index, new Map())).toEqual([[]]);
  });

  test("enumeratePlans lists each useful count for a single set", () => {
    const index = indexOf([1, 2, 3, 4].map((slot) => ({ slot, set: 4, value: 10 })));
    const bonusAt = bonusOf({ 4: { 2: 12, 4: 24, 6: 36 } });
    expect(enumeratePlans(index, bonusAt))
      .toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 4, count: 4 }]]);
  });

  // The cap is the POPULATED slots, not the nine there could be. A plan needing seven pieces on a
  // six-slot pool is unfillable, and enumerating it is wasted work on every one of a few hundred
  // thousand calls.
  test("enumeratePlans never names more pieces than there are slots to fill", () => {
    const specs = [];
    for (const set of [4, 34, 53, 57, 38]) {
      for (let slot = 1; slot <= 6; slot++) specs.push({ slot, set, value: 10 });
    }
    const index = indexOf(specs);
    const bonusAt = bonusOf(Object.fromEntries([4, 34, 53, 57, 38].map((s) => [s, { 2: 10, 4: 20 }])));
    for (const plan of enumeratePlans(index, bonusAt)) {
      expect(plan.reduce((sum, p) => sum + p.count, 0)).toBeLessThanOrEqual(6);
    }
  });

  // The cap is exactly four, not merely at-most-four: four two-piece sets fit inside nine slots, so
  // a four-set plan has to be reachable or the bound in the module header is vacuous.
  test("enumeratePlans reaches four named sets when the pool can supply them", () => {
    const specs = [];
    for (const [i, set] of [4, 34, 53, 35].entries()) {
      for (const slot of [i * 2 + 1, i * 2 + 2]) specs.push({ slot, set, value: 0 });
    }
    specs.push({ slot: 9, set: 0, value: 0 });
    const index = indexOf(specs);
    const bonusAt = bonusOf(Object.fromEntries([4, 34, 53, 35].map((s) => [s, { 2: 10 }])));
    expect(enumeratePlans(index, bonusAt).some((plan) => plan.length === 4)).toBe(true);
  });

  // A set that pays from one piece only has no count to plan, and naming it would be a fifth name
  // competing for a slot the singleton column gets for nothing.
  test("enumeratePlans never names a set whose only bonus is at one piece", () => {
    const index = indexOf([1, 2, 3].map((slot) => ({ slot, set: 70, value: 0 })));
    expect(enumeratePlans(index, bonusOf({ 70: { 1: 9 } }))).toEqual([[]]);
  });

  // Slots can be plentiful and a count still impossible: two pieces of a set only one slot supplies.
  test("enumeratePlans caps a set's count at the slots that supply it", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 0 }, { slot: 2, set: 0, value: 0 }, { slot: 3, set: 0, value: 0 },
    ]);
    expect(enumeratePlans(index, bonusOf({ 4: { 2: 12 } }))).toEqual([[]]);
  });

  // Two sets that each fit alone and cannot both fit, because they draw on the SAME two slots.
  // Slots 3 and 4 are here so the per-set room cap does NOT catch it: with four populated slots
  // there is room for 2 + 2, and only the union of the two sets' supplying slots shows that the
  // pieces have nowhere to go. Checking each set's supply independently passes this test with the
  // bad plan still in the list, and nothing downstream complains — assignPlan just returns null,
  // after the plan's full cost has been paid.
  test("enumeratePlans drops a plan whose sets share too few slots between them", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 0 }, { slot: 1, set: 34, value: 0 },
      { slot: 2, set: 4, value: 0 }, { slot: 2, set: 34, value: 0 },
      { slot: 3, set: 0, value: 0 }, { slot: 4, set: 0, value: 0 },
    ]);
    const bonusAt = bonusOf({ 4: { 2: 12 }, 34: { 2: 12 } });
    expect(enumeratePlans(index, bonusAt))
      .toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 34, count: 2 }]]);
  });

  // Set 0 is "no set", not a set. It is skipped when counting a build, so a bonus attached to it
  // could never be credited — planning it would produce plans that can only ever score as the
  // empty plan does.
  test("enumeratePlans ignores a bonus attached to set 0", () => {
    const index = indexOf([1, 2, 3].map((slot) => ({ slot, set: 0, value: 0 })));
    expect(enumeratePlans(index, bonusOf({ 0: { 2: 50 } }))).toEqual([[]]);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `enumeratePlans is not a function`, 8 failing tests.

- [ ] 3. Append to `oracle/analytics/build-solve.mjs`, below `usefulCounts`:

  ```js
  // The slots this index could fill, always ascending, so every column order and every pick list
  // below is the same on a rerun.
  const populated = (index) => SLOTS.filter((slot) => index.has(slot));

  // A plan names at most four sets. Not a tuning knob: a useful count is at least two pieces, so a
  // fifth named set would need a tenth slot. One-piece bonuses are bought by singleton columns and
  // never enter a plan, which is what keeps this bound true in a world that has one-piece sets.
  const MAX_PLAN_SETS = 4;

  function popcount(bits) {
    let n = 0;
    for (let b = bits; b !== 0; b &= b - 1) n++;
    return n;
  }

  // Every set allocation worth trying: up to four distinct sets, each at one of its useful counts,
  // with the counts summing to no more than there are slots to fill.
  //
  // Two filters, both NECESSARY conditions on a plan being fillable at all, and both cheap. A set
  // can only contribute as many pieces as there are slots supplying it — that is `room`. And the
  // UNION of the slots supplying a plan's sets must be at least as large as its counts sum to,
  // which is Hall's condition on the whole family. The union filter also prunes the RECURSION: a
  // plan that fails it is unfillable, and so is every plan containing it, because any assignment
  // for the larger plan restricts to one for the smaller. So no fillable plan is ever dropped.
  //
  // Slot sets are nine-bit masks rather than Sets. This runs a few hundred thousand times per
  // solve, and a Set per node is the difference between milliseconds and seconds.
  //
  // Set 0 is "no set" and is excluded: countsOf skips it, so a bonus attached to it could never be
  // credited, and planning it would enumerate plans that can only score as the empty plan does.
  export function enumeratePlans(index, bonusAt) {
    const slots = populated(index);
    const mask = new Map();
    for (let i = 0; i < slots.length; i++) {
      for (const setId of index.get(slots[i]).keys()) {
        mask.set(setId, (mask.get(setId) ?? 0) | (1 << i));
      }
    }
    const candidates = [...mask.keys()]
      .filter((setId) => setId !== 0 && bonusAt.has(setId))
      .sort((a, b) => a - b);

    const plans = [[]];
    const extend = (from, current, used, union) => {
      if (current.length === MAX_PLAN_SETS) return;
      for (let i = from; i < candidates.length; i++) {
        const setId = candidates[i];
        const bits = mask.get(setId);
        const room = Math.min(popcount(bits), slots.length - used);
        for (const count of usefulCounts(bonusAt, setId, room)) {
          const nextUnion = union | bits;
          if (popcount(nextUnion) < used + count) continue;
          const next = [...current, { setId, count }];
          plans.push(next);
          extend(i + 1, next, used + count, nextUnion);
        }
      }
    };
    extend(0, [], 0, 0);
    return plans;
  }
  ```

- [ ] 4. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  19 passed (19)`.

- [ ] 5. Prove the union filter is load-bearing and not accidentally satisfied by the room cap: temporarily delete the line `if (popcount(nextUnion) < used + count) continue;` and re-run.
     Expected: exactly one failure — "drops a plan whose sets share too few slots between them", reporting a fourth plan `[{setId:4,count:2},{setId:34,count:2}]`. Restore the line and re-run; back to 19 passing.

- [ ] 6. Run `npm run lint`. Expected: exit 0.
- [ ] 7. Run `npm test`. Expected: all pass.
- [ ] 8. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 9. Commit:
  ```
  git commit -m "feat(analytics): plan enumeration with a slot-union feasibility filter

  Co-Authored-By: Claude"
  ```

---

## Chunk C — Scoring and the per-plan assignment

### Task 4: `scoreBuild`

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Add `scoreBuild` to the test file's import list and append:

  ```js
  // `picks` is what assignPlan hands back; scoreBuild is tested on hand-written ones so the scoring
  // rule is pinned independently of whatever the assignment happens to produce.
  const pick = (slot, setId, value) =>
    ({ slot, setId, item: item({ id: slot, slot, set: setId }), value });

  test("scoreBuild sums the item values when no set pays", () => {
    expect(scoreBuild([pick(1, 4, 10), pick(2, 4, 7)], new Map())).toBe(17);
  });

  // The bonus is read at the count the build HOLDS. A rule that paid per piece would answer 24 for
  // the first case; a rule that paid once per set regardless of count would answer 12 for the last.
  test("scoreBuild credits each set once, at the count the build actually holds", () => {
    const bonusAt = bonusOf({ 4: { 2: 12, 4: 24 } });
    expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0)], bonusAt)).toBe(12);
    expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0), pick(3, 4, 0)], bonusAt)).toBe(12);
    expect(scoreBuild([pick(1, 4, 0), pick(2, 4, 0), pick(3, 4, 0), pick(4, 4, 0)], bonusAt)).toBe(24);
  });

  test("scoreBuild grants nothing for a set the model says nothing about", () => {
    expect(scoreBuild([pick(1, 66, 5), pick(2, 66, 5)], bonusOf({ 4: { 2: 12 } }))).toBe(10);
  });

  // Set 0 is "no set". Counting it would make nine setless pieces look like a nine-piece set.
  test("scoreBuild never counts set 0 as a set", () => {
    expect(scoreBuild([pick(1, 0, 5), pick(2, 0, 5)], bonusOf({ 0: { 2: 99 } }))).toBe(10);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `scoreBuild is not a function`, 4 failing tests.

- [ ] 3. Append to `oracle/analytics/build-solve.mjs`:

  ```js
  // setId -> how many picks carry it. Set 0 is "no set" and is skipped, as speed-model.mjs's
  // setCounts does, so a build of nine setless pieces has no counts rather than one count of nine.
  function countsOf(picks) {
    const counts = new Map();
    for (const p of picks) {
      if (!p.setId) continue;
      counts.set(p.setId, (counts.get(p.setId) ?? 0) + 1);
    }
    return counts;
  }

  // What a build is actually worth: its items' values, plus each set's bonus AT THE COUNT THE BUILD
  // HOLDS. Never at a plan's count — a free pick can complete a set the plan never named, and
  // scoring the plan would under-report it.
  export function scoreBuild(picks, bonusAt) {
    let total = 0;
    for (const p of picks) total += p.value;
    for (const [setId, count] of countsOf(picks)) total += bonusAt.get(setId)?.[count] ?? 0;
    return total;
  }
  ```

- [ ] 4. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  23 passed (23)`.

- [ ] 5. Run `npm run lint`. Expected: exit 0.
- [ ] 6. Run `npm test`. Expected: all pass.
- [ ] 7. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 8. Commit:
  ```
  git commit -m "feat(analytics): score a build on the items it actually holds

  Co-Authored-By: Claude"
  ```

---

### Task 5: `assignPlan` — plan columns and free columns

Singleton columns arrive in Task 6. This task builds the assignment machinery and the two column kinds every plan needs. **No stub for the singleton list** — Task 6 adds the function and the loop that calls it together.

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Add `assignPlan` to the test file's import list and append:

  ```js
  const ids = (picks) => picks.map((p) => p.item.id).sort((a, b) => a - b);

  test("assignPlan with the empty plan takes the best value in every slot", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 30 },
      { slot: 2, set: 4, value: 40 }, { slot: 2, set: 0, value: 5 },
    ]);
    const { picks, credited } = assignPlan(index, new Map(), []);
    expect(picks.map((p) => p.slot)).toEqual([1, 2]);
    expect(ids(picks)).toEqual([2, 3]);
    expect(credited).toBe(70);
  });

  // The whole reason this is an assignment and not nine independent choices. Slot 1 holds the
  // pool's best item outright, but the plan's two pieces can only come from slots 1 and 2, so slot
  // 1 has to give its best up. A per-slot greedy takes the 50 and then cannot fill the plan at all.
  test("assignPlan gives up a slot's best item when the plan needs that slot", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 50 },
      { slot: 2, set: 4, value: 10 },
      { slot: 3, set: 0, value: 7 },
    ]);
    const { picks, credited } = assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }]);
    expect(picks.filter((p) => p.setId === 4)).toHaveLength(2);
    expect(credited).toBe(10 + 10 + 7 + 12);
  });

  test("assignPlan returns null when the plan needs more pieces than there are slots", () => {
    const index = indexOf([{ slot: 1, set: 4, value: 10 }]);
    expect(assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }])).toBe(null);
  });

  // Slots can be plentiful and the plan still impossible — two pieces of a set only one slot
  // supplies. A build that quietly ignored the plan's counts would be scored as if it had honoured
  // them, which is a wrong answer rather than a missing one.
  test("assignPlan returns null when a plan's set cannot fill its count", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 2, set: 0, value: 10 }, { slot: 3, set: 0, value: 10 },
    ]);
    expect(assignPlan(index, bonusOf({ 4: { 2: 12 } }), [{ setId: 4, count: 2 }])).toBe(null);
  });

  // Two sets that each fit alone and cannot both fit, because they draw on the same two slots.
  // enumeratePlans filters this plan out, so assignPlan is the only place the behaviour can be
  // checked — and it has to hold, because assignPlan is exported for the power solver to call.
  test("assignPlan returns null when two plan sets compete for the same slots", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 0 }, { slot: 1, set: 34, value: 0 },
      { slot: 2, set: 4, value: 0 }, { slot: 2, set: 34, value: 0 },
      { slot: 3, set: 0, value: 0 }, { slot: 4, set: 0, value: 0 },
    ]);
    const bonusAt = bonusOf({ 4: { 2: 12 }, 34: { 2: 12 } });
    expect(assignPlan(index, bonusAt, [{ setId: 4, count: 2 }, { setId: 34, count: 2 }])).toBe(null);
  });

  // `credited` is what the assignment PAID FOR; scoreBuild is what the build is worth. They agree
  // when nothing is completed by accident, and credited is the lower one when something is — never
  // the other way round, because that would mean the solver had over-claimed.
  test("credited equals scoreBuild when no free pick completes a set by accident", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 }, { slot: 3, set: 0, value: 7 },
    ]);
    const bonusAt = bonusOf({ 4: { 2: 12 } });
    const { picks, credited } = assignPlan(index, bonusAt, [{ setId: 4, count: 2 }]);
    expect(credited).toBe(39);
    expect(scoreBuild(picks, bonusAt)).toBe(39);
  });

  // The empty plan names nothing, so it credits nothing — and still lands three pieces of set 40,
  // which pays 30. Scoring the plan would report 30 for a build worth 60.
  test("credited is below scoreBuild when a free pick completes a set by accident", () => {
    const index = indexOf([
      { slot: 1, set: 40, value: 10 }, { slot: 2, set: 40, value: 10 },
      { slot: 3, set: 40, value: 10 }, { slot: 3, set: 0, value: 9 },
    ]);
    const bonusAt = bonusOf({ 40: { 2: 30 } });
    const { picks, credited } = assignPlan(index, bonusAt, []);
    expect(credited).toBe(30);
    expect(scoreBuild(picks, bonusAt)).toBe(60);
  });

  test("assignPlan reports each pick's slot, set, item and value", () => {
    const index = indexOf([{ slot: 3, set: 66, value: 11 }]);
    const { picks } = assignPlan(index, new Map(), []);
    expect(picks).toHaveLength(1);
    expect(picks[0].slot).toBe(3);
    expect(picks[0].setId).toBe(66);
    expect(picks[0].value).toBe(11);
    expect(picks[0].item.id).toBe(1);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `assignPlan is not a function`, 8 failing tests.

- [ ] 3. Append the assignment algorithm to `oracle/analytics/build-solve.mjs`:

  ```js
  // Maximum-weight assignment of rows to distinct columns, rows <= columns, every row matched. The
  // Kuhn-Munkres shortest-augmenting-path form with potentials: O(rows^2 * cols), which at nine
  // rows and about thirty columns is a few thousand operations — small enough to run once per plan
  // over a few hundred thousand plans.
  //
  // `weight` is a flat rows*cols array, row-major. Returns the column each row took. Written as a
  // MINIMISER fed negated weights, because every published form of this algorithm minimises and
  // transcribing one is less error-prone than inventing a maximiser.
  //
  // Ties go to the lowest column index: both comparisons below are strict, so the first column to
  // reach a value keeps it. That makes the result a fixed function of the matrix, which is what
  // `solve` needs in order to return the same build on a rerun.
  function maxWeightAssignment(weight, rows, cols) {
    const u = new Float64Array(rows + 1);
    const v = new Float64Array(cols + 1);
    const p = new Int32Array(cols + 1);     // p[j] = the 1-based row holding column j, 0 = unheld
    const way = new Int32Array(cols + 1);
    const minv = new Float64Array(cols + 1);
    const used = new Uint8Array(cols + 1);
    for (let i = 1; i <= rows; i++) {
      p[0] = i;
      let j0 = 0;
      minv.fill(Infinity);
      used.fill(0);
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity;
        let j1 = 0;
        for (let j = 1; j <= cols; j++) {
          if (used[j]) continue;
          const cur = -weight[(i0 - 1) * cols + (j - 1)] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= cols; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0);
    }
    const rowCol = new Int32Array(rows);
    for (let j = 1; j <= cols; j++) if (p[j] > 0) rowCol[p[j] - 1] = j - 1;
    return rowCol;
  }

  // Best item in a slot regardless of set — what a free column takes. Ties break on item id.
  function freeBest(bySet) {
    let best = null;
    for (const entry of bySet.values()) {
      if (!best || entry.value > best.value
        || (entry.value === best.value && entry.item.id < best.item.id)) best = entry;
    }
    return best;
  }

  const PLAN = 0, FREE = 2;

  // The best build this plan can reach, as a maximum-weight assignment of slots to columns.
  //
  // PLAN columns: `count` of them per named set, each taking that set's indexed item in whichever
  // slot it lands, and ALL of them must be filled or the plan is unfillable. FREE columns: one per
  // slot, usable only by its own row, taking that slot's best item with no bonus at all.
  //
  // Column ORDER is fixed — plan pieces in plan order, then free columns in slot order — so two
  // runs over the same index return the same build.
  export function assignPlan(index, bonusAt, plan) {
    const slots = populated(index);
    const need = plan.reduce((sum, p) => sum + p.count, 0);
    if (need > slots.length) return null;

    const cols = [];
    for (const { setId, count } of plan) {
      for (let k = 0; k < count; k++) cols.push({ kind: PLAN, setId, bonus: 0 });
    }
    for (const slot of slots) cols.push({ kind: FREE, slot, bonus: 0 });

    const rows = slots.length;
    const n = cols.length;
    const frees = slots.map((slot) => freeBest(index.get(slot)));
    const base = new Float64Array(rows * n);
    const allowed = new Uint8Array(rows * n);
    let span = 0;
    for (let r = 0; r < rows; r++) {
      const bySet = index.get(slots[r]);
      for (let c = 0; c < n; c++) {
        const col = cols[c];
        let w;
        if (col.kind === FREE) {
          if (col.slot !== slots[r]) continue;
          w = frees[r].value;
        } else {
          const entry = bySet.get(col.setId);
          if (!entry) continue;
          w = entry.value + col.bonus;
        }
        base[r * n + c] = w;
        allowed[r * n + c] = 1;
        if (Math.abs(w) > span) span = Math.abs(w);
      }
    }

    // Two constants large enough that no arrangement of real weights can outvote them. Any
    // assignment's real total lies in [-rows*span, rows*span], so BIG — added to every plan column
    // — makes one more filled plan column beat every possible rearrangement of everything else, and
    // a maximum-weight assignment therefore fills as many plan columns as can be filled. FORBIDDEN
    // costs more than all `rows` plan columns and all the real weight put together, and the
    // all-free assignment is always available, so a maximum-weight assignment never takes one.
    const BIG = 2 * rows * span + 1;
    const FORBIDDEN = -(rows + 1) * BIG;

    const weight = new Float64Array(rows * n);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * n + c;
        weight[k] = allowed[k] ? base[k] + (cols[c].kind === PLAN ? BIG : 0) : FORBIDDEN;
      }
    }

    const rowCol = maxWeightAssignment(weight, rows, n);

    // A plan is fillable exactly when every one of its columns got a row. BIG makes the assignment
    // fill as many as it can, so a gap here means no assignment could have filled them all.
    let filled = 0;
    for (let r = 0; r < rows; r++) if (cols[rowCol[r]].kind === PLAN) filled++;
    if (filled < need) return null;

    const picks = [];
    let credited = 0;
    for (let r = 0; r < rows; r++) {
      const c = rowCol[r];
      // Unreachable by the argument above. Loud rather than silent if BIG and FORBIDDEN are ever
      // made too small, because the quiet failure is a build naming an item that is not there.
      if (!allowed[r * n + c]) {
        throw new Error("build-solve: the assignment took a forbidden cell —"
          + " BIG and FORBIDDEN are no longer large enough to rule one out");
      }
      const col = cols[c];
      const entry = col.kind === FREE ? frees[r] : index.get(slots[r]).get(col.setId);
      picks.push({ slot: slots[r], setId: entry.item.set, item: entry.item, value: entry.value });
      credited += base[r * n + c];
    }
    for (const { setId, count } of plan) credited += bonusAt.get(setId)[count];
    return { picks, credited };
  }
  ```

- [ ] 4. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  31 passed (31)`.

- [ ] 5. Run `npm run lint`. Expected: exit 0.
- [ ] 6. Run `npm test`. Expected: all pass.
- [ ] 7. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 8. Commit:
  ```
  git commit -m "feat(analytics): per-plan maximum-weight assignment over plan and free columns

  Co-Authored-By: Claude"
  ```

---

### Task 6: Singleton columns

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Append these tests:

  ```js
  // Two sets that each pay from a single piece, and nothing in the plan. Without a column apiece
  // the free picks take the higher RAW value in each slot and collect neither bonus: 6 + 3 = 9.
  // One column only reaches 11. Both of them is 12, and only crediting both gets there.
  test("assignPlan credits two singleton sets at once", () => {
    const index = indexOf([
      { slot: 1, set: 10, value: 0 }, { slot: 1, set: 0, value: 6 },
      { slot: 2, set: 11, value: 0 }, { slot: 2, set: 0, value: 3 },
    ]);
    const bonusAt = bonusOf({ 10: { 1: 7 }, 11: { 1: 5 } });
    const { picks, credited } = assignPlan(index, bonusAt, []);
    expect(credited).toBe(12);
    expect(scoreBuild(picks, bonusAt)).toBe(12);
  });

  // A singleton column is usable ONCE, so two pieces of the same set collect its one-piece bonus a
  // single time: 10 + 10 + 9 = 29. A column per PIECE would answer 38.
  //
  // `credited` is the assertion that bites. The free columns here already pick both set-20 pieces
  // on their own, so scoreBuild reads 29 whether or not a singleton column exists — the realized
  // score cannot tell the two apart. Only credited can: without the column it is the bare 20 of
  // item values, with one column 29, and with one per piece 38.
  test("two pieces of a set whose second piece pays nothing are credited once", () => {
    const index = indexOf([
      { slot: 1, set: 20, value: 10 }, { slot: 1, set: 0, value: 3 },
      { slot: 2, set: 20, value: 10 }, { slot: 2, set: 0, value: 3 },
    ]);
    const bonusAt = bonusOf({ 20: { 1: 9 } });
    const { picks, credited } = assignPlan(index, bonusAt, []);
    expect(credited).toBe(29);
    expect(scoreBuild(picks, bonusAt)).toBe(29);
  });

  // A set the plan already names must not also get a singleton column, or its one-piece bonus is
  // paid on top of the bonus its named count already includes.
  //
  // Slot 3 supplies set 30 too, and that is what makes the case bite: with the plan's two pieces
  // already placed in slots 1 and 2, a stray singleton column for set 30 is something slot 3 can
  // actually take, for +4 over its free column. Drop slot 3's set-30 item and the column would go
  // unused, and the test would pass with the guard removed.
  test("a set named by the plan gets no singleton column", () => {
    const index = indexOf([
      { slot: 1, set: 30, value: 0 }, { slot: 2, set: 30, value: 0 },
      { slot: 3, set: 30, value: 0 }, { slot: 3, set: 0, value: 0 },
    ]);
    const bonusAt = bonusOf({ 30: { 1: 4, 2: 10 } });
    const { credited } = assignPlan(index, bonusAt, [{ setId: 30, count: 2 }]);
    expect(credited).toBe(10);
  });

  // Set 0 is "no set". countsOf skips it, so a singleton column for it would credit a bonus
  // scoreBuild can never award — credited would exceed the realized score, which must never happen.
  test("set 0 never gets a singleton column", () => {
    const index = indexOf([{ slot: 1, set: 0, value: 5 }]);
    const bonusAt = bonusOf({ 0: { 1: 50 } });
    const { picks, credited } = assignPlan(index, bonusAt, []);
    expect(credited).toBe(5);
    expect(scoreBuild(picks, bonusAt)).toBe(5);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — exactly two of the four. The first reports `9` where `12` was expected (both bonuses missed). The second reports a `credited` of `20` where `29` was expected, while its `scoreBuild` assertion passes, because the free picks reach those items anyway. The third and fourth already pass: they are guards against crediting too much, and nothing is credited yet. **Confirm that exact shape before continuing** — any other failure means something else is wrong.

- [ ] 3. In `oracle/analytics/build-solve.mjs`, add `SINGLE` to the column-kind constants. Replace:

  ```js
  const PLAN = 0, FREE = 2;
  ```

  with:

  ```js
  const PLAN = 0, SINGLE = 1, FREE = 2;

  // The sets worth a singleton column: they pay from a single piece, the plan does not already name
  // them, and the index can actually supply them.
  //
  // Dropping the sets no slot supplies cannot change the answer — every cell of such a column is
  // forbidden and a row always has its own free column to take instead — and it keeps the matrix at
  // nine rows by about thirty columns on a full vault, rather than growing with the size of the
  // bonus table. Set 0 is excluded for the same reason it is excluded from a plan: countsOf skips
  // it, so crediting it would make `credited` exceed the realized score.
  //
  // Ascending set id, so the column order is the same on a rerun.
  function singletonSets(index, bonusAt, inPlan) {
    const out = [];
    for (const setId of [...bonusAt.keys()].sort((a, b) => a - b)) {
      if (setId === 0 || inPlan.has(setId)) continue;
      if (!(bonusAt.get(setId)[1] > 0)) continue;
      if (slotsSupplying(index, setId) === 0) continue;
      out.push(setId);
    }
    return out;
  }
  ```

- [ ] 4. In `assignPlan`, replace the column-building block. Replace:

  ```js
    const cols = [];
    for (const { setId, count } of plan) {
      for (let k = 0; k < count; k++) cols.push({ kind: PLAN, setId, bonus: 0 });
    }
    for (const slot of slots) cols.push({ kind: FREE, slot, bonus: 0 });
  ```

  with:

  ```js
    const inPlan = new Set(plan.map((p) => p.setId));
    const cols = [];
    for (const { setId, count } of plan) {
      for (let k = 0; k < count; k++) cols.push({ kind: PLAN, setId, bonus: 0 });
    }
    // SINGLE columns are what let a build hold more active sets than a plan can name: one per set
    // outside the plan that pays from a single piece, carrying that bonus, usable once.
    for (const setId of singletonSets(index, bonusAt, inPlan)) {
      cols.push({ kind: SINGLE, setId, bonus: bonusAt.get(setId)[1] });
    }
    for (const slot of slots) cols.push({ kind: FREE, slot, bonus: 0 });
  ```

- [ ] 5. Update `assignPlan`'s doc comment: after the `PLAN columns:` sentence, insert
     `SINGLE columns: one per set outside the plan that pays from a single piece, carrying that bonus and usable once, which is how a build reaches more active sets than a plan can name.`
     and change `then free columns in slot order` to `then singletons by ascending set id, then free columns in slot order`.

- [ ] 6. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  35 passed (35)`.

- [ ] 7. Run `npm run lint`. Expected: exit 0.
- [ ] 8. Run `npm test`. Expected: all pass.
- [ ] 9. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 10. Commit:
  ```
  git commit -m "feat(analytics): singleton columns so a build can out-run its plan's set count

  Co-Authored-By: Claude"
  ```

---

## Chunk D — `solve`

### Task 7: `solve` returns the best build

The three beyond-four-active-sets cases, the dedup case and the `top` case all belong in **this** RED batch. `solve` is the function they exercise and it does not exist yet, so they fail for the right reason now. Written after the code they cover, they would pass on first run and prove nothing.

The score tie-break is deliberately **not** part of this task — it gets its own RED in Task 9.

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Add `solve` to the test file's import list and append the basic cases:

  ```js
  const best = (index, bonusAt, opts) => solve(index, bonusAt, opts)[0];

  test("solve returns an empty list for an empty index", () => {
    expect(solve(new Map(), new Map())).toEqual([]);
  });

  // The set bonus has to beat the value given up to earn it, and the solver has to notice both ways.
  test("solve commits slots to a set only when the bonus beats the value forgone", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 11 },
      { slot: 2, set: 4, value: 10 }, { slot: 2, set: 0, value: 11 },
    ]);
    expect(best(index, bonusOf({ 4: { 2: 12 } })).score).toBe(32);
    expect(best(index, bonusOf({ 4: { 2: 1 } })).score).toBe(22);
  });

  // A free pick carries an item that belongs to some set and can complete one by accident. Scoring
  // the plan instead of the items would report 30 for a build worth 60.
  test("solve scores the items it picked, not the plan it picked them under", () => {
    const index = indexOf([
      { slot: 1, set: 40, value: 10 }, { slot: 2, set: 40, value: 10 },
      { slot: 3, set: 40, value: 10 },
    ]);
    expect(best(index, bonusOf({ 40: { 2: 30 } })).score).toBe(60);
  });

  test("solve returns the item objects and a set-0-free count map", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 2, set: 4, value: 10 }, { slot: 3, set: 0, value: 10 },
    ]);
    const result = best(index, bonusOf({ 4: { 2: 12 } }));
    expect(result.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result.items[0].slot).toBe(1);
    expect(result.counts).toEqual(new Map([[4, 2]]));
  });

  // The floor under every answer: a solver that returned something worse than taking the best item
  // in each slot would be worse than no solver at all.
  test("solve is never worse than taking the best item in each slot", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 13 }, { slot: 1, set: 58, value: 20 },
      { slot: 2, set: 4, value: 9 }, { slot: 2, set: 58, value: 4 },
      { slot: 3, set: 58, value: 15 }, { slot: 3, set: 0, value: 2 },
    ]);
    const bonusAt = bonusOf({ 4: { 2: 6 }, 58: { 3: 40 } });
    const greedy = [...index.values()]
      .map((bySet) => [...bySet.values()].reduce((b, e) => (e.value > b.value ? e : b)).value)
      .reduce((sum, v) => sum + v, 0);
    expect(best(index, bonusAt).score).toBeGreaterThanOrEqual(greedy);
  });

  // Four plans, one build: every slot holds exactly one candidate, so naming set 10, set 11, both,
  // or neither all land on the same four items. Reporting them as four runners-up would be four
  // copies of one answer wearing different labels.
  test("solve deduplicates builds that several plans reach", () => {
    const index = indexOf([
      { slot: 1, set: 10, value: 0 }, { slot: 2, set: 10, value: 0 },
      { slot: 3, set: 11, value: 0 }, { slot: 4, set: 11, value: 0 },
    ]);
    const bonusAt = bonusOf({ 10: { 2: 5 }, 11: { 2: 5 } });
    expect(enumeratePlans(index, bonusAt)).toHaveLength(4);
    const ranked = solve(index, bonusAt, { top: 5 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(10);
  });

  test("solve with top greater than one returns distinct builds, best first", () => {
    const index = indexOf([
      { slot: 1, set: 4, value: 10 }, { slot: 1, set: 0, value: 11 },
      { slot: 2, set: 4, value: 10 }, { slot: 2, set: 0, value: 11 },
    ]);
    const ranked = solve(index, bonusOf({ 4: { 2: 12 } }), { top: 5 });
    expect(ranked.map((r) => r.score)).toEqual([32, 22]);
  });
  ```

- [ ] 2. Append the three beyond-four-active-sets cases:

  ```js
  // (a) Nine sets, each paying from one piece and each supplied by one slot. Every slot also offers
  // a setless item worth 5, so a slot takes its set only because the bonus beats that. The answer
  // is 11 + 12 + ... + 19 = 135. A solver that could credit only the four sets a plan can name
  // would answer 16+17+18+19 plus five setless at 5 = 95, and would look perfectly healthy doing it.
  test("solve credits nine distinct one-piece sets at once", () => {
    const specs = [];
    for (const slot of SLOTS) {
      specs.push({ slot, set: 100 + slot, value: 0 });
      specs.push({ slot, set: 0, value: 5 });
    }
    const bonusAt = bonusOf(Object.fromEntries(SLOTS.map((s) => [100 + s, { 1: 10 + s }])));
    const result = best(indexOf(specs), bonusAt);
    expect(result.score).toBe(135);
    expect(result.counts.size).toBe(9);
  });

  // (b) Two sets at two pieces each, plus five more bought one piece at a time — seven active sets
  // under a plan that can name four. Each singleton slot offers a setless item worth 5 against the
  // set's 9, so the free columns would take the setless one: without singleton columns this is
  // 40 + 40 + 25 = 105.
  test("solve pairs two multi-piece sets with five singletons", () => {
    const specs = [];
    for (const [setId, slots] of [[10, [1, 2]], [11, [3, 4]]]) {
      for (const slot of slots) specs.push({ slot, set: setId, value: 0 });
    }
    for (const slot of [1, 2, 3, 4]) specs.push({ slot, set: 0, value: 15 });
    for (const slot of [5, 6, 7, 8, 9]) {
      specs.push({ slot, set: 15 + slot, value: 0 });
      specs.push({ slot, set: 0, value: 5 });
    }
    const bonusAt = bonusOf({
      10: { 2: 40 }, 11: { 2: 40 },
      ...Object.fromEntries([5, 6, 7, 8, 9].map((s) => [15 + s, { 1: 9 }])),
    });
    const result = best(indexOf(specs), bonusAt);
    expect(result.score).toBe(125);
    expect(result.counts).toEqual(new Map([
      [10, 2], [11, 2], [20, 1], [21, 1], [22, 1], [23, 1], [24, 1],
    ]));
  });

  // (c) The fourth multi-piece set and a pair of one-piece sets want the same two slots. Taking the
  // fourth set is 20+20+20+10 = 70 and four active sets; taking the pair instead is 60+9+9 = 78 and
  // five. A solver that maximised NAMED sets would stop at 70 and call it optimal.
  test("solve takes a fifth active set over a fourth multi-piece set", () => {
    const specs = [];
    for (const [setId, slots] of [[1, [1, 2]], [2, [3, 4]], [3, [5, 6]], [4, [7, 8]]]) {
      for (const slot of slots) specs.push({ slot, set: setId, value: 0 });
    }
    specs.push({ slot: 7, set: 5, value: 0 });
    specs.push({ slot: 8, set: 6, value: 0 });
    const bonusAt = bonusOf({
      1: { 2: 20 }, 2: { 2: 20 }, 3: { 2: 20 }, 4: { 2: 10 }, 5: { 1: 9 }, 6: { 1: 9 },
    });
    const result = best(indexOf(specs), bonusAt);
    expect(result.score).toBe(78);
    expect(result.counts).toEqual(new Map([[1, 2], [2, 2], [3, 2], [5, 1], [6, 1]]));
  });
  ```

- [ ] 3. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — `solve is not a function`, 10 failing tests.

- [ ] 4. Append to `oracle/analytics/build-solve.mjs`:

  ```js
  // Every plan, assigned and then scored on the items it actually produced, best first.
  //
  // Deduplicated on the sorted item ids, with the FIRST plan to reach a build keeping it, so a
  // build is listed under the least committed description of it — a build that completes a set only
  // because the best free pieces happened to carry it stays reported under the plan that never
  // named that set. Same rule as speed.mjs's topBuilds.
  //
  // `top` is per-PLAN bests, ranked. Entry 0 is the exact optimum. Entries after it are NOT
  // guaranteed to be the true second- and third-best builds: they are the best each OTHER plan
  // could reach, and the true runner-up may be a second build under the winning plan, which is
  // never generated. Said plainly rather than claimed otherwise.
  export function solve(index, bonusAt, { top = 1 } = {}) {
    const slots = populated(index);
    if (slots.length === 0) return [];
    const seen = new Map();
    for (const plan of enumeratePlans(index, bonusAt)) {
      const assigned = assignPlan(index, bonusAt, plan);
      if (!assigned) continue;
      const itemIds = assigned.picks.map((p) => p.item.id).sort((a, b) => a - b);
      const key = itemIds.join(",");
      if (seen.has(key)) continue;
      seen.set(key, {
        score: scoreBuild(assigned.picks, bonusAt),
        items: assigned.picks.map((p) => p.item),
        counts: countsOf(assigned.picks),
        itemIds,
      });
    }
    const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
    return ranked.slice(0, Math.max(1, top))
      .map(({ score, items, counts }) => ({ score, items, counts }));
  }
  ```

- [ ] 5. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  45 passed (45)`.

- [ ] 6. Run `npm run lint`. Expected: exit 0.
- [ ] 7. Run `npm test`. Expected: all pass.
- [ ] 8. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 9. Commit:
  ```
  git commit -m "feat(analytics): solve over every plan, exact past four active sets

  Co-Authored-By: Claude"
  ```

---

### Task 8: `bonusAt` validation

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Append:

  ```js
  // Both rules are load-bearing, not hygiene. `[0] === 0` is what lets a set absent from a build be
  // ignored rather than subtracted; non-decreasing is what makes `credited` a lower bound on the
  // realized score, and therefore what makes the exactness argument at the top of the module hold.
  // Violated quietly, each produces a confident wrong answer rather than a crash.
  test("solve rejects a model that pays for zero pieces", () => {
    const index = indexOf([{ slot: 1, set: 4, value: 1 }]);
    const bonusAt = new Map([[4, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]]]);
    expect(() => solve(index, bonusAt)).toThrow(/\[0\]/);
  });

  test("solve rejects a model whose bonus shrinks with more pieces", () => {
    const index = indexOf([{ slot: 1, set: 4, value: 1 }]);
    const bonusAt = new Map([[4, [0, 0, 9, 4, 4, 4, 4, 4, 4, 4]]]);
    expect(() => solve(index, bonusAt)).toThrow(/decrease/);
  });

  // A nine-entry array reads bonus[9] as undefined, and undefined poisons the arithmetic into NaN
  // rather than failing — a build whose score is NaN sorts below everything and is silently never
  // returned.
  test("solve rejects a model that is not ten entries long", () => {
    const index = indexOf([{ slot: 1, set: 4, value: 1 }]);
    expect(() => solve(index, new Map([[4, [0, 0, 5]]]))).toThrow(/10/);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — 3 tests, each reporting that the function did not throw.

- [ ] 3. Add `checkBonusAt` to `oracle/analytics/build-solve.mjs`, immediately above `solve`:

  ```js
  // The model has to be a staircase from zero: zero pieces grant nothing, and a piece never takes a
  // bonus away. Checked once per solve rather than trusted, because both failures are quiet — a
  // non-zero [0] credits a set nobody wears, and a decreasing entry breaks the lower-bound argument
  // `credited` rests on. Either way the solver still returns an answer, and it still looks
  // reasonable.
  function checkBonusAt(bonusAt) {
    for (const [setId, bonus] of bonusAt) {
      if (!Array.isArray(bonus) || bonus.length !== SLOTS.length + 1) {
        throw new Error(`build-solve: bonusAt[${setId}] must be an array of ${SLOTS.length + 1}`
          + " numbers, the bonus at 0..9 pieces");
      }
      if (bonus[0] !== 0) {
        throw new Error(`build-solve: bonusAt[${setId}][0] is ${bonus[0]}, must be 0 —`
          + " a set nobody wears grants nothing");
      }
      for (let count = 1; count < bonus.length; count++) {
        if (bonus[count] < bonus[count - 1]) {
          throw new Error(`build-solve: bonusAt[${setId}] decreases at ${count}`
            + ` (${bonus[count - 1]} -> ${bonus[count]}) —`
            + " a bonus must never shrink with more pieces");
        }
      }
    }
  }
  ```

- [ ] 4. Add the call as the first line of `solve`'s body, above `const slots = populated(index);`:

  ```js
    checkBonusAt(bonusAt);
  ```

- [ ] 5. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  48 passed (48)`.

- [ ] 6. Run `npm run lint`. Expected: exit 0.
- [ ] 7. Run `npm test`. Expected: all pass.
- [ ] 8. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 9. Commit:
  ```
  git commit -m "feat(analytics): reject a set model that is not a staircase from zero

  Co-Authored-By: Claude"
  ```

---

### Task 9: The score tie-break

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.test.mjs`
- Modify: `oracle/analytics/build-solve.mjs`

**Steps:**

- [ ] 1. Append:

  ```js
  // Two plans reach exactly 10, with items [9, 30] and [10, 20]. Set 11 sorts after set 10, so the
  // [10, 20] build is enumerated FIRST and keeping insertion order returns it — the tie-break is
  // the only thing that can move [9, 30] ahead.
  //
  // And the tie-break has to be element-wise NUMERIC. The dedup key is the joined id list, and as
  // text "9,30" sorts after "10,20"; reusing that key for ORDER answers [10, 20], and no score
  // assertion anywhere can see the difference.
  test("solve breaks a score tie on the element-wise smaller id list", () => {
    const index = buildIndex([
      item({ id: 9, slot: 1, set: 11, value: 0 }), item({ id: 10, slot: 1, set: 10, value: 0 }),
      item({ id: 30, slot: 2, set: 11, value: 0 }), item({ id: 20, slot: 2, set: 10, value: 0 }),
    ], 0, valueOf);
    const result = best(index, bonusOf({ 10: { 2: 10 }, 11: { 2: 10 } }));
    expect(result.score).toBe(10);
    expect(result.items.map((it) => it.id).sort((a, b) => a - b)).toEqual([9, 30]);
    expect("9,30" > "10,20").toBe(true);
  });
  ```

- [ ] 2. Run and watch fail: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: FAIL — one test, reporting `[10, 20]` where `[9, 30]` was expected. The score assertion passes; only the id assertion fails. Confirm that shape before continuing.

- [ ] 3. Add `compareIds` to `oracle/analytics/build-solve.mjs`, immediately above `checkBonusAt`:

  ```js
  // Element by element as numbers. Comparing the joined ids as text answers [10, 20] < [9, 30],
  // which is the wrong build and a difference no score assertion can ever see.
  function compareIds(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }
  ```

- [ ] 4. In `solve`, replace:

  ```js
    const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  ```

  with:

  ```js
    const ranked = [...seen.values()]
      .sort((a, b) => b.score - a.score || compareIds(a.itemIds, b.itemIds));
  ```

- [ ] 5. Extend `solve`'s doc comment with a final paragraph:

  ```js
  // Ties on score go to the numerically smaller sorted id list, compared ELEMENT BY ELEMENT. The
  // joined key above is right for equality and wrong for order: "9,30" sorts after "10,20" as text.
  ```

- [ ] 6. Run and watch pass: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  49 passed (49)`.

- [ ] 7. Run `npm run lint`. Expected: exit 0.
- [ ] 8. Run `npm test`. Expected: all pass.
- [ ] 9. Stage: `git add oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs`
- [ ] 10. Commit:
  ```
  git commit -m "feat(analytics): break a score tie on the element-wise smaller id list

  Co-Authored-By: Claude"
  ```

---

## Chunk E — Property, coverage and performance

### Task 10: Brute-force equivalence property

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.prop.test.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/build-solve.prop.test.mjs` with the header, run parameters and generators:

  ```js
  // oracle/analytics/__tests__/build-solve.prop.test.mjs
  // build-solve claims a PROVABLE maximum over a search space far too large to inspect. On
  // instances small enough to enumerate exhaustively that claim is checkable directly — so check
  // it. Mirrors speed-solve.prop.test.mjs, including the generator-coverage test at the bottom,
  // which is what stops the generator quietly narrowing until the property proves nothing.
  import { test, expect } from "vitest";
  import fc from "fast-check";
  import { SLOTS, buildIndex, enumeratePlans, slotsSupplying, solve } from "../build-solve.mjs";

  // vitest.config.ts gives a test 10 s, or 120 s when FC_NUM_RUNS is set; the scheduled fuzz
  // workflow runs the whole suite at FC_NUM_RUNS=25000. Each test below carries an explicit 60 s
  // timeout, which overrides both. Vitest's birpc has a hardcoded 60 s RPC timeout, so a test that
  // runs past it fails a shard with STACK_TRACE_ERROR rather than a real property violation — which
  // is why a fuzz run also caps fast-check itself at 50 s and passes on however many instances fit.
  const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
  const PARAMS = process.env.FC_NUM_RUNS
    ? { numRuns: NUM_RUNS, interruptAfterTimeLimit: 50_000 }
    : { numRuns: NUM_RUNS };

  const valueOf = (it) => it.value;

  const mkItem = (id, slot, set, value) => ({
    id, slot, set, value, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0,
  });

  // A bonus profile over 0..9 pieces. `at` gives the TOTAL bonus from that piece count upward.
  const tiers = (at) => {
    const out = [0];
    let current = 0;
    for (let n = 1; n <= SLOTS.length; n++) {
      if (at[n] !== undefined) current = at[n];
      out.push(current);
    }
    return out;
  };

  // The shapes the real table has, each parameterised by one magnitude so the generator can vary
  // how MUCH a set is worth without varying WHERE it pays.
  //
  //   stack2    a classic two-piece set that stacks        pays at 2, 4, 6
  //   stack4    a classic four-piece set                   pays at 4
  //   onePiece  the shape this solver exists for           pays at 1, 2, 3, 5, 7, 8
  //   from2     a nine-slot tiered set opening at two      pays at 2, 4, 8
  //   from3     a nine-slot tiered set opening at three    pays at 3, 5, 8
  //
  // stack4 deliberately has no eight-piece rung: the four-piece sets in the real table are
  // artifact-only, so six slots is their ceiling and a second stack is unreachable.
  const SHAPES = {
    stack2: (p) => tiers({ 2: p, 4: 2 * p, 6: 3 * p }),
    stack4: (p) => tiers({ 4: p }),
    onePiece: (p) => tiers({ 1: p, 2: 2 * p, 3: 3 * p, 5: 4 * p, 7: 5 * p, 8: 6 * p }),
    from2: (p) => tiers({ 2: p, 4: 2 * p, 8: 3 * p }),
    from3: (p) => tiers({ 3: p, 5: 2 * p, 8: 3 * p }),
  };

  // Eight sets per instance, which keeps plan enumeration in the thousands rather than the hundreds
  // of thousands the full table reaches. Set 0 is setless and never appears in bonusAt.
  const SET_IDS = [11, 12, 13, 14, 15, 16, 17, 18];

  const ANY_SHAPE = fc.constantFrom("stack2", "stack4", "onePiece", "from2", "from3");
  // Reaching the four-set cap needs four sets whose FIRST useful count is 2, because 4 x 2 = 8 fits
  // in nine slots and 4 x 3 = 12 does not. from3 and stack4 have no count-2 rung, so the draw that
  // targets that state excludes them. Same trick as speed-solve.prop.test.mjs's CHEAP_SETS.
  const OPENS_AT_2 = fc.constantFrom("stack2", "onePiece", "from2");
  const TIERED = fc.constantFrom("onePiece", "from2", "from3");

  const bonusAtArb = (shapeArb) => fc.array(
    fc.record({ shape: shapeArb, p: fc.integer({ min: 1, max: 15 }) }),
    { minLength: SET_IDS.length, maxLength: SET_IDS.length },
  ).map((specs) => new Map(specs.map((s, i) => [SET_IDS[i], SHAPES[s.shape](s.p)])));

  // One list of items PER SLOT rather than a flat array whose slots are drawn at random. An
  // instance can then put a set in all nine slots — which is what the eight-piece rung and the
  // four-set cap need, and what a flat array of a dozen items reaches only by accident. At most two
  // items per slot caps the exhaustive search at 2^9.
  //
  // The populated slots are always a prefix of SLOTS. That costs nothing: buildIndex, assignPlan
  // and solve key on the slot rather than reading it, and every generated item is a non-accessory,
  // so which nine slots they are is not a distinction any of them can make.
  //
  // `minSlots` is what makes the targeted draws below land. fc.array biases short, so an
  // unconstrained nine-slot generator averages five populated slots and reaches eight or nine only
  // by luck.
  const itemsArb = (setArb, minSlots) => fc.array(
    fc.array(fc.record({ set: setArb, value: fc.integer({ min: 0, max: 40 }) }),
      { minLength: 1, maxLength: 2 }),
    { minLength: minSlots, maxLength: SLOTS.length },
  ).map((perSlot) => perSlot.flatMap((specs, i) => specs.map((s) => ({ ...s, slot: SLOTS[i] }))));

  // Weighted three-to-one so one set really does reach eight of the nine slots often. An even draw
  // puts the eight-piece rung — the top of the ladder and the rung most easily missed — out of
  // reach in practice.
  const heavilyOneSet = (setId) => fc.oneof(
    { arbitrary: fc.constant(setId), weight: 3 },
    { arbitrary: fc.constant(0), weight: 1 },
  );

  // Items and set models are drawn TOGETHER. A layout that piles one set into eight slots only
  // exercises the eight-piece rung if that set's model has one, so drawing the two independently
  // would leave the targeted states to coincidence.
  const instanceOf = (setArb, minSlots, shapeArb) =>
    fc.record({ specs: itemsArb(setArb, minSlots), bonusAt: bonusAtArb(shapeArb) });

  // Four draws, one per state the coverage test at the bottom holds the generator to: a wide one
  // mixing every shape on any number of slots; one piling a single tiered set high enough to unlock
  // its top rung; one keeping four two-piece-opening sets in play at once; and one where every set
  // pays from a single piece, so optima run past four active sets routinely.
  const instance = fc.oneof(
    instanceOf(fc.constantFrom(0, ...SET_IDS), 1, ANY_SHAPE),
    instanceOf(heavilyOneSet(SET_IDS[0]), 8, TIERED),
    instanceOf(fc.constantFrom(...SET_IDS.slice(0, 4)), 8, OPENS_AT_2),
    instanceOf(fc.constantFrom(...SET_IDS), 8, fc.constant("onePiece")),
  );

  // Exhaustive search over every combination of one item per populated slot. Filling every slot
  // loses nothing: values are non-negative and bonuses never decrease, so an empty slot never helps.
  //
  // The score is written out LONGHAND rather than calling scoreBuild, so the property compares two
  // independent implementations instead of one against itself. Push/pop rather than a fresh array
  // per node, because the coverage test below runs this two thousand times.
  function bruteForceBest(items, bonusAt) {
    const bySlot = new Map();
    for (const it of items) {
      if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
      bySlot.get(it.slot).push(it);
    }
    const slots = [...bySlot.keys()].sort((a, b) => a - b);
    const chosen = [];
    let best = null;
    const walk = (i) => {
      if (i === slots.length) {
        let score = 0;
        const counts = new Map();
        for (const it of chosen) {
          score += it.value;
          if (!it.set) continue;
          counts.set(it.set, (counts.get(it.set) ?? 0) + 1);
        }
        for (const [setId, n] of counts) score += bonusAt.get(setId)?.[n] ?? 0;
        if (best === null || score > best.score) best = { score, chosen: [...chosen] };
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

  // Measured locally: NN.N s at the default 300 runs.
  test("solve returns the same maximum as exhaustive search", () => {
    fc.assert(
      fc.property(instance, ({ specs, bonusAt }) => {
        const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.value));
        const index = buildIndex(items, 0, valueOf);
        expect(solve(index, bonusAt)[0].score).toBe(bruteForceBest(items, bonusAt).score);
      }),
      PARAMS,
    );
  }, 60_000);
  ```

- [ ] 2. Run it: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  1 passed (1)`. An equivalence property written against finished code passes on its first run; that is inherent to the kind, and the next two steps are what make it earn its place rather than faking a RED.

- [ ] 3. **Mutation check 1 — singleton columns are load-bearing.** Temporarily edit `oracle/analytics/build-solve.mjs` so `singletonSets` returns `[]` unconditionally. Re-run the property.
     Expected: FAIL, with a counterexample where `solve` scores **below** brute force. Record the counterexample in your phase result, then restore `singletonSets`.

- [ ] 4. **Mutation check 2 — the plan cap really is four.** Temporarily change `MAX_PLAN_SETS` from `4` to `3`. Re-run the property.
     Expected: FAIL with a counterexample. Record it, then restore `4`.

- [ ] 5. Confirm the module is back to its committed state: `git diff --stat oracle/analytics/build-solve.mjs`
     Expected: no output.

- [ ] 6. Re-run clean: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  1 passed (1)`. Note the wall time vitest prints.

- [ ] 7. Stress it once before committing, because a property that has never been pushed is worth little:
     `FC_NUM_RUNS=5000 npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: pass. Note that with `FC_NUM_RUNS` set, `PARAMS` also applies `interruptAfterTimeLimit: 50_000`, so this stops at 50 s rather than completing all 5,000 instances — which is the behaviour being verified as well. If it reports a property failure, that is a real bug in the solver: fix the solver, and add the counterexample to `build-solve.test.mjs` as a unit test first.

- [ ] 8. Replace `NN.N` in the comment above the test with the wall time from step 6.

- [ ] 9. Run `npm run lint`. Expected: exit 0.
- [ ] 10. Run `npm test`. Expected: all pass.
- [ ] 11. Stage: `git add oracle/analytics/__tests__/build-solve.prop.test.mjs`
- [ ] 12. Commit:
  ```
  git commit -m "test(analytics): brute-force equivalence property for the build solver

  Co-Authored-By: Claude"
  ```

---

### Task 11: Generator-coverage test

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.prop.test.mjs`

**Steps:**

- [ ] 1. Append to the property file:

  ```js
  // A set is TIERED here if it pays at seven or eight pieces. Only the three nine-slot shapes do;
  // stack2 tops out at six and stack4 at four. Reading the shape back off the profile keeps this
  // check independent of how the generator happened to label it.
  const isTiered = (bonus) => bonus[8] > bonus[7] || bonus[7] > bonus[6];

  // The generator IS the test. When it narrows, nothing else here complains — which is how a
  // property file can come to draw four slots and one shape while claiming to prove a nine-slot
  // solver exact. So the states the property exists to cover are asserted reachable rather than
  // left to inspection.
  //
  // Unseeded and sampled wide on purpose: a fixed seed would make the floor below hostage to
  // fast-check changing how it generates between versions.
  //
  // Measured locally: NN.N s.
  test("the generator reaches every state the property is supposed to cover", () => {
    const seen = { nineSlots: 0, fourSetPlan: 0, fiveActiveSets: 0, eightSlotTiered: 0 };
    for (const { specs, bonusAt } of fc.sample(instance, 2000)) {
      const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.value));
      const index = buildIndex(items, 0, valueOf);
      if (index.size === SLOTS.length) seen.nineSlots++;
      if (enumeratePlans(index, bonusAt).some((plan) => plan.length === 4)) seen.fourSetPlan++;
      // "Active" is read off the BRUTE-FORCE optimum, not off solve's answer: the point is that the
      // best build really does run past four active sets, which is the regime speed-solve.mjs
      // cannot reach. Reading it off solve would make the check circular.
      const counts = new Map();
      for (const it of bruteForceBest(items, bonusAt).chosen) {
        if (!it.set) continue;
        counts.set(it.set, (counts.get(it.set) ?? 0) + 1);
      }
      let active = 0;
      for (const [setId, n] of counts) if ((bonusAt.get(setId)?.[n] ?? 0) > 0) active++;
      if (active >= 5) seen.fiveActiveSets++;
      for (const [setId, bonus] of bonusAt) {
        if (isTiered(bonus) && slotsSupplying(index, setId) >= 8) { seen.eightSlotTiered++; break; }
      }
    }
    // More than 100 of 2,000, not "at least once": a state reached twice in 2,000 draws is not
    // covered by the 300 instances the property above actually runs. At 5% each of these is hit a
    // dozen times or more in a default run, and hundreds of times in a fuzz shard.
    for (const [state, hits] of Object.entries(seen)) {
      expect(hits, `${state} is generated too rarely to count as covered`).toBeGreaterThan(100);
    }
  }, 60_000);
  ```

- [ ] 2. Run it: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  2 passed (2)`.

- [ ] 3. If any state is at or below 100, **widen the generator — never lower the floor.** The intended lever for each:
     - `nineSlots` — raise the wide draw's `minSlots` from 1 toward 8.
     - `fourSetPlan` — raise the third draw's `minSlots` to 9, or drop `"stack2"` from `OPENS_AT_2` so its sets open at exactly 2 more often.
     - `fiveActiveSets` — raise the fourth draw's `minSlots` to 9.
     - `eightSlotTiered` — raise `heavilyOneSet`'s weight from 3 to 5.
     Re-run until all four clear 100. Record the final counts in your phase result.

- [ ] 4. Replace `NN.N` in the comment above the test with the wall time vitest reports for it.

- [ ] 5. Re-run: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  2 passed (2)`, both under 60 s.

- [ ] 6. Run `npm run lint`. Expected: exit 0.
- [ ] 7. Run `npm test`. Expected: all pass.
- [ ] 8. Stage: `git add oracle/analytics/__tests__/build-solve.prop.test.mjs`
- [ ] 9. Commit:
  ```
  git commit -m "test(analytics): hold the build-solve generator to the states it claims to cover

  Co-Authored-By: Claude"
  ```

---

### Task 12: Performance test on a full-size index

**Files:**

- Test: `oracle/analytics/__tests__/build-solve.prop.test.mjs`
- Possibly modify: `oracle/analytics/build-solve.mjs` (only if step 4 is needed)

**Steps:**

- [ ] 1. Append to the property file:

  ```js
  // The real table's mix of stat-bearing set shapes: 23 stacking two-piece and 5 stacking
  // four-piece sets, both artifact-only, plus 13 nine-slot tiered sets that pay from a single
  // piece. Every set is present in every slot it can roll on, which is plan enumeration at its
  // worst — a real vault is sparser than this.
  const PERF_SETS = [
    ...Array.from({ length: 23 }, (_, i) => ({ id: 1 + i, shape: "stack2", slots: [1, 2, 3, 4, 5, 6] })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: 24 + i, shape: "stack4", slots: [1, 2, 3, 4, 5, 6] })),
    ...Array.from({ length: 13 }, (_, i) => ({ id: 29 + i, shape: "onePiece", slots: SLOTS })),
  ];

  // A deterministic 32-bit LCG. The wall time recorded below only means something if the instance
  // is identical every run, and seeding fast-check for 285 numbers would be heavier than this.
  function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // Measured locally: NNN,NNN plans from enumeratePlans, NN.N s wall. The budget is the 60 s
  // timeout on this test, with a target of 30 s to leave room for a slower CI runner and for
  // vitest's hardcoded 60 s birpc limit. This test is NOT scaled by FC_NUM_RUNS, so it costs the
  // same on every `npm test` and on each of the ten fuzz shards every fifteen minutes — a known and
  // accepted charge on the local gate, not an oversight.
  test("a full-size index solves inside the time budget", () => {
    const rand = lcg(20261003);
    const items = [];
    let id = 0;
    for (const set of PERF_SETS) {
      for (const slot of set.slots) items.push(mkItem(++id, slot, set.id, Math.floor(rand() * 41)));
    }
    const bonusAt = new Map(
      PERF_SETS.map((s) => [s.id, SHAPES[s.shape](1 + Math.floor(rand() * 15))]));
    const index = buildIndex(items, 0, valueOf);

    const plans = enumeratePlans(index, bonusAt);
    const ranked = solve(index, bonusAt);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].items.map((it) => it.slot).sort((a, b) => a - b)).toEqual(SLOTS);
    // Recomputed longhand from the items returned, so this is an independent check on the score
    // rather than a read-back of whatever solve put in the field.
    const recomputed = ranked[0].items.reduce((sum, it) => sum + it.value, 0)
      + [...ranked[0].counts].reduce((sum, [setId, n]) => sum + bonusAt.get(setId)[n], 0);
    expect(ranked[0].score).toBe(recomputed);
    // A floor, not the measured figure — the measured one is in the comment above. This catches the
    // set mix collapsing to a handful of plans, which would make the timing meaningless.
    expect(plans.length).toBeGreaterThan(50_000);
  }, 60_000);
  ```

- [ ] 2. Run it: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  3 passed (3)`. Note the wall time vitest prints for this test.

- [ ] 3. Read the real plan count: temporarily change the last assertion to `expect(plans.length).toBe(0);` and re-run. The failure message names the actual count. Change it back to `toBeGreaterThan(50_000)`. **Do not leave a `console.log` behind** — test output must stay pristine.

- [ ] 4. **If step 2's wall time exceeded 30 s**, apply these optimizations in order, re-measuring after each, and stop as soon as it is under 30 s. Each is behaviour-preserving; none changes an answer.
     1. **Memoize `freeBest` per slot.** `assignPlan` already computes `frees` once per call, but that is still 9 slots × 41 sets on each of a few hundred thousand calls. Cache it in a module-scope `WeakMap` keyed by the slot's `bySet` Map. Safe because an index is immutable for the life of a solve; say so in a comment.
     2. **Memoize `singletonSets`.** It sorts all of `bonusAt`'s keys and calls `slotsSupplying` for every set on every call. Cache the sorted, supply-filtered, one-piece-paying list in a `WeakMap` keyed by the index, and subtract the plan's sets from it per call.
     3. **Reuse the Hungarian's scratch arrays.** `maxWeightAssignment` allocates six typed arrays per call. Hoist them to module scope, grown on demand to the largest size seen. Safe because the function is synchronous and never re-entered; say so in a comment.
     Record which optimizations you applied, and the before/after timings, in your phase result.

- [ ] 5. Replace `NNN,NNN` and `NN.N` in the comment above the test with the plan count from step 3 and the final wall time.

- [ ] 6. Re-run: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  3 passed (3)`, with no stray output.

- [ ] 7. Run `npm run lint`. Expected: exit 0.
- [ ] 8. Run `npm test`. Expected: all pass. Note the total suite time; it should be the previous total plus roughly this test's wall time.
- [ ] 9. Stage: `git add oracle/analytics/__tests__/build-solve.prop.test.mjs`
     If step 4 changed the module, also: `git add oracle/analytics/build-solve.mjs`
- [ ] 10. Commit:
  ```
  git commit -m "test(analytics): full-vault performance budget for the build solver

  Co-Authored-By: Claude"
  ```

---

## Chunk F — Final verification

### Task 13: Verify every acceptance criterion

No code changes. This task is the checklist the review phase will re-run.

**Files:** none.

**Steps:**

- [ ] 1. Confirm the required exports exist and nothing unintended leaked out:
     `grep -n "^export" oracle/analytics/build-solve.mjs`
     Expected: `SLOTS`, `buildIndex`, `slotsSupplying`, `usefulCounts`, `enumeratePlans`, `scoreBuild`, `assignPlan`, `solve`. The issue requires all but `slotsSupplying` and `usefulCounts`; those two are exported because they are unit-tested directly and because `speed-solve.mjs` exports its equivalents.

- [ ] 2. Confirm the exactness argument is in the header:
     `grep -n "Take an optimal build B" oracle/analytics/build-solve.mjs`
     Expected: one match near the top of the file.

- [ ] 3. Confirm the two protected files are untouched:
     `git diff main --stat -- oracle/analytics/speed-solve.mjs oracle/analytics/speed.mjs`
     Expected: no output.

- [ ] 4. Confirm which files changed:
     `git diff main --stat`
     Expected: the three new files under `oracle/analytics/`, plus `docs/plans/ai/issue-42-plan.md` and `docs/plans/ai/issue-42-exploration.md`. Nothing else.

- [ ] 5. Confirm no stub or placeholder survived:
     `grep -rn "TODO\|FIXME\|Placeholder\|placeholder" oracle/analytics/build-solve.mjs oracle/analytics/__tests__/build-solve.test.mjs oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: no output.

- [ ] 6. Confirm the recorded measurements are real numbers, not the `NNN,NNN` / `NN.N` templates:
     `grep -n "Measured locally" oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: three lines, every one of them containing digits and none containing `N`.

- [ ] 7. Run the unit file: `npx vitest run oracle/analytics/__tests__/build-solve.test.mjs`
     Expected: `Tests  49 passed (49)`.

- [ ] 8. Run the property file: `npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: `Tests  3 passed (3)`.

- [ ] 9. Run the fuzz-shard configuration once, to prove `interruptAfterTimeLimit` behaves and the suite does not blow the birpc limit:
     `FC_NUM_RUNS=25000 VITEST_TIMEOUT=120000 npx vitest run oracle/analytics/__tests__/build-solve.prop.test.mjs`
     Expected: pass, with the equivalence property stopping at ~50 s rather than running to 25,000 instances. If it reports a property failure, that is a real bug — fix it and add the counterexample as a unit test.

- [ ] 10. Run `npm run build`. Expected: exit 0.
- [ ] 11. Run `npm test`. Expected: all pass.
- [ ] 12. Run `npm run lint`. Expected: exit 0.
- [ ] 13. Confirm the working tree is clean: `git status --short`
     Expected: no output. Everything is committed.

---

## Acceptance Criteria Map

| Issue criterion | Where it is satisfied |
| --- | --- |
| Exports `SLOTS`, `buildIndex`, `enumeratePlans`, `assignPlan`, `scoreBuild`, `solve` | Tasks 1, 3, 4, 5, 6, 7; verified Task 13 step 1 |
| Exactness argument in the header | Task 1 step 3; verified Task 13 step 2 |
| Brute-force property passes at the default run count | Task 10 step 6 |
| Generator-coverage test asserts all four listed states | Task 11 step 1 |
| Both follow the time budget (60 s timeout, `interruptAfterTimeLimit: 50_000`) | Tasks 10, 11; verified Task 13 step 9 |
| Two singleton sets both credited | Task 6 test 1 |
| Two pieces of a tiered set whose 2-piece tier adds nothing, credited once | Task 6 test 2 |
| A plan whose pieces cannot all be placed is skipped | Task 5 tests 4 and 5 |
| Accidental completion through a free pick scored on actual items | Task 5 test 7, Task 7 test 3 |
| Accessories filtered to the faction | Task 1 test 5 |
| Empty index → `[]` | Task 7 test 1 |
| `top` deduplicates builds reached by two plans | Task 7 test 6 |
| Never worse than best-value-per-slot | Task 7 test 5 |
| (a) nine distinct one-piece sets | Task 7 step 2, case (a) |
| (b) two multi-piece sets plus five singletons | Task 7 step 2, case (b) |
| (c) a fifth active set beating a fourth multi-piece set | Task 7 step 2, case (c) |
| Non-zero `[0]` or a decreasing entry throws | Task 8 |
| Tie-break: `[9, 30]` beats `[10, 20]` | Task 9 |
| `credited` ≤ `scoreBuild`, equal when nothing is accidental | Task 5 tests 6 and 7 |
| Performance test with the 23/5/13 mix, plan count and wall time recorded | Task 12 |
| `items` are item objects, `counts` is a set-0-free Map | Task 7 test 4 |
| `speed-solve.mjs` and `speed.mjs` unchanged | Verified Task 13 step 3 |
| `npm run build`, `npm test`, `npm run lint` pass | Every task's verification steps; final sweep Task 13 steps 10–12 |
