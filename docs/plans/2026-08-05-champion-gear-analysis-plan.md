# Per-Champion Gear Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `oracle/analytics/champion-gear.mjs`, which rates each of a champion's nine equipped pieces KEEP / BORDERLINE / SELL with the numbers that justify the call.

**Architecture:** A standalone analytics script shaped like `spare-copies.mjs` — pure exported functions plus a `main()` behind a `realpathSync` guard, so importing it from tests has no side effects. It reuses the existing vault machinery (`decode.mjs`, `score.mjs`, `triage.mjs`, `rollquality.mjs`) rather than re-deriving anything; the only change to existing code is a behaviour-preserving extraction in `score.mjs` and three new constants in `weights.mjs`.

**Tech Stack:** Node ESM (`.mjs`), `node:sqlite` via `--experimental-sqlite`, vitest, `@rslh/core` for name/stat lookups.

**Design doc:** `docs/plans/2026-08-05-champion-gear-analysis-design.md` — read it first.

## Global Constraints

- All new code is ESM `.mjs` in `oracle/analytics/`; no TypeScript, no build step.
- `node:sqlite` reads require `--experimental-sqlite` and `stmt.setReadBigInts(true)`; coerce BigInt to Number at the boundary.
- Advisory only: never write to a snapshot or the live DB.
- Tests live in `oracle/analytics/__tests__/*.test.mjs` and run under the repo suite (`npm test`).
- Pre-commit gate for every commit: `npm run build && npm test && npm run lint`.
- Commit straight to `main` (solo repo). Co-author line is exactly `Co-Authored-By: Claude`.
- Terminology: *item* = any piece, *artifact* = slots 1–6, *accessory* = slots 7–9.
- `oracle/resources/*.db` and `oracle/analytics/out/` are gitignored personal data — never commit them, never assert against them in tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `oracle/analytics/score.mjs` (modify) | Add `qualityAtRole()`; `quality()` delegates to it |
| `oracle/analytics/weights.mjs` (modify) | Add `gearKeepQuantile`, `gearSellQuantile`, `roleGapFlag` to `CUTS` |
| `oracle/analytics/champion-gear.mjs` (create) | Everything else: champion role, replacement pool, verdict, CLI |
| `oracle/analytics/__tests__/champion-gear.test.mjs` (create) | Unit tests for the pure functions |
| `oracle/analytics/__tests__/score.test.mjs` (modify) | Guard the `qualityAtRole` refactor |
| `oracle/analytics/README.md` (modify) | Document the new script |

`champion-gear.mjs` stays one file: it is ~200 lines and every part of it serves one job. That matches `spare-copies.mjs` and `worst-artifacts.mjs`.

---

### Task 1: Extract `qualityAtRole` from `quality`

The role-gap flag needs an item's score at one *specific* role. `quality()` only exposes the max over set-allowed roles, so extract the per-role body. Purely behaviour-preserving.

**Files:**
- Modify: `oracle/analytics/score.mjs:101-110`
- Test: `oracle/analytics/__tests__/score.test.mjs`

**Interfaces:**
- Produces: `qualityAtRole(item, role, potential = false) -> number` (0–100). `role` is one of `"ATK-DPS" | "DEF-DPS" | "HP-DPS" | "Support"`. `quality(item, potential)` keeps its exact current signature and return shape `{ role, score }`.

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/score.test.mjs`:

```js
test("qualityAtRole: quality() equals the max over the set's allowed roles", () => {
  // Cruel (29) allows the three DPS roles but not Support.
  const it = item(4, 29, main(4, 4, true), goodSubs);
  const best = quality(it);
  const dps = ["ATK-DPS", "DEF-DPS", "HP-DPS"].map((r) => qualityAtRole(it, r));
  expect(best.score).toBe(Math.max(...dps));
  expect(qualityAtRole(it, best.role)).toBe(best.score);
});

test("qualityAtRole: honours the potential flag the same way quality() does", () => {
  const it = item(4, 29, main(4, 4, true, 0.2), goodSubs, { level: 8 });
  const best = quality(it, true);
  const dps = ["ATK-DPS", "DEF-DPS", "HP-DPS"].map((r) => qualityAtRole(it, r, true));
  expect(best.score).toBe(Math.max(...dps));
});

test("qualityAtRole: a support-statted piece scores higher as Support than as ATK-DPS", () => {
  const supportish = [sub(7, true, 0.9), sub(8, true, 0.9), sub(1, false, 0.9)]; // RES / ACC / HP%
  const it = item(4, 4, main(4, 4, true), supportish);
  expect(qualityAtRole(it, "Support")).toBeGreaterThan(qualityAtRole(it, "ATK-DPS"));
});
```

Update the import at the top of that file from `import { quality, investment, desir, mainDesir } from "../score.mjs";` to:

```js
import { quality, qualityAtRole, investment, desir, mainDesir } from "../score.mjs";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/score.test.mjs -t "qualityAtRole"`
Expected: FAIL — `qualityAtRole is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `oracle/analytics/score.mjs`, replace the existing `quality` function (currently lines 101–110) with:

```js
// Score `item` at ONE specific role. Default scores it as-is (value-completeness of main + subs);
// potential=true scores it as if taken to 6★+16, judged on TYPES only (level-independent).
export function qualityAtRole(item, role, potential = false) {
  const mc = potential ? mainFit(item, role) : mainComponent(item, role);
  const sc = potential ? subTypeFit(item, role) : subComponent(item, role);
  return Math.round(100 * (BLEND.main * mc + BLEND.sub * sc) / (BLEND.main + BLEND.sub));
}

// quality(item, potential?) -> { role, score } in [0,100], best-matching role among those the
// item's set is annotated for. See qualityAtRole for what `potential` changes.
export function quality(item, potential = false) {
  let best = { role: ALL_ROLES[0], score: -1 };
  for (const role of rolesForSet(item.set)) {
    const score = qualityAtRole(item, role, potential);
    if (score > best.score) best = { role, score };
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run oracle/analytics`
Expected: PASS — all existing analytics tests still green (this is the point of the refactor).

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/score.mjs oracle/analytics/__tests__/score.test.mjs
git commit -m "refactor(analytics): extract qualityAtRole from quality

Per-champion gear analysis needs an item's score at one specific role to
detect miscast gear. Behaviour-preserving: quality() now delegates.

Co-Authored-By: Claude"
```

---

### Task 2: Champion role + quantile helper

**Files:**
- Create: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champion-gear.test.mjs`

**Interfaces:**
- Produces: `CHAMP_ROLE` (`{0..3} -> archetype`), `CHAMP_ROLE_LABEL` (`{0..3} -> "Attack"|"Defense"|"HP"|"Support"`), `champRole(row) -> string|null`, `quantile(values, p) -> number`.

`Champs.Role` is the game's champion type, verified against the 2026-07-12 snapshot (see the design doc's evidence table). It is static champion data — bare level-1 copies already carry it.

- [ ] **Step 1: Write the failing test**

Create `oracle/analytics/__tests__/champion-gear.test.mjs`:

```js
// oracle/analytics/__tests__/champion-gear.test.mjs
import { test, expect } from "vitest";
import { CHAMP_ROLE, champRole, quantile } from "../champion-gear.mjs";

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

test("CHAMP_ROLE covers exactly the four archetypes", () => {
  expect(Object.values(CHAMP_ROLE).sort())
    .toEqual(["ATK-DPS", "DEF-DPS", "HP-DPS", "Support"]);
});

test("quantile is index-based and handles degenerate inputs", () => {
  expect(quantile([], 0.5)).toBe(0);
  expect(quantile([7], 0.5)).toBe(7);
  expect(quantile([7], 0)).toBe(7);
  expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
  expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
});

test("quantile does not mutate its input", () => {
  const xs = [3, 1, 2];
  quantile(xs, 0.5);
  expect(xs).toEqual([3, 1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — cannot resolve `../champion-gear.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `oracle/analytics/champion-gear.mjs`:

```js
// Per-champion gear triage: rate each piece a champion is WEARING as KEEP / BORDERLINE / SELL.
//
// The vault report (analyze.mjs) can't answer this — its two delete passes (junkTrim, slotBalance)
// skip equipped items by construction, so worn gear always comes back "keep" on supply floors
// rather than merit. Here the call is driven by REPLACEABILITY: how many unequipped spares could
// actually take this piece's place and would finish better. Advisory only; nothing is ever deleted.
//
//   node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
//     name|ID     all digits -> exact Champs.ID; otherwise a case-insensitive Name substring.
//                 Omit for summary mode: one line per geared champion, worst first.
//     snapshot.db an arg ending in .db or containing a slash (default: newest snapshot).

// Champs.Role is the game's champion type and maps 1:1 onto the analytics archetypes. Verified
// against the 2026-07-12 snapshot: Role=1 champs are uniformly DEF-scaling, Role=2 top the HP
// medians, Role=3 bottom the crit medians. It's static champion data — bare level-1 copies already
// carry it, and 368 of 369 multi-copy names agree across copies (the one exception is a block of
// empty-Name placeholder rows, which hold no gear and are filtered out on read).
export const CHAMP_ROLE = { 0: "ATK-DPS", 1: "DEF-DPS", 2: "HP-DPS", 3: "Support" };
export const CHAMP_ROLE_LABEL = { 0: "Attack", 1: "Defense", 2: "HP", 3: "Support" };

// null for an unrecognised Role — suppresses the role-gap flag, leaves verdicts intact.
export const champRole = (row) => CHAMP_ROLE[Number(row.Role)] ?? null;

// p in [0,1], index-based (no interpolation) to match the analytics' existing percentile style.
export function quantile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) * p)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): champion role mapping and quantile helper

Champs.Role is the game's champion type (0 Attack / 1 Defense / 2 HP /
3 Support) and maps onto the four scoring archetypes.

Co-Authored-By: Claude"
```

---

### Task 3: Replacement pool membership and its bucket key

The replacement pool for an equipped piece is the set of unequipped spares that could *actually* take its place on this champion. The predicate stays exported even though the hot path (Task 4) goes through an index — the predicate is what the tests assert against, and it keeps the bucket key honest.

**Files:**
- Modify: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champion-gear.test.mjs`

**Interfaces:**
- Consumes: `keepPremium(setId)` and `CUTS.focusPremium` from `./triage.mjs` / `./weights.mjs`.
- Produces: `inReplacementPool(candidate, item) -> boolean`, `bucketKeyFor(item) -> string`.

Set ids used in the tests, with their `keepPremium`: Mercurial `66` → 8 (demanded), Cruel `29` → 6 (demanded), Lifesteal `9` → 1 (not demanded), Guardian `44` → 1 (not demanded). `CUTS.focusPremium` is 4.

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/champion-gear.test.mjs`, adding `inReplacementPool, bucketKeyFor` to the existing import from `../champion-gear.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — `inReplacementPool is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `oracle/analytics/champion-gear.mjs` (after the header comment):

```js
import { keepPremium } from "./triage.mjs";
import { CUTS } from "./weights.mjs";
```

and append:

```js
// Could `candidate` (an unequipped spare) actually take `item`'s place on its champion?
//   same slot · same MAIN stat (a C.DMG glove isn't replaced by an HP glove; for Weapon/Helmet/
//   Shield the main is slot-fixed so this is a natural no-op) · same FACTION for accessories
//   (a hard game constraint) · on a set you'd actually build on.
export function inReplacementPool(candidate, item) {
  if (candidate.equippedChampId !== 0) return false;
  if (candidate.slot !== item.slot) return false;
  if (candidate.mainStat.statId !== item.mainStat.statId) return false;
  if (candidate.mainStat.isFlat !== item.mainStat.isFlat) return false;
  if (item.isAccessory && candidate.faction !== item.faction) return false;
  return keepPremium(candidate.set) >= CUTS.focusPremium;
}

// Index key matching inReplacementPool's slot/main/faction clauses. The equipped and demanded-set
// clauses are applied when the index is BUILT (they're properties of the candidate alone), so they
// deliberately don't appear here.
export function bucketKeyFor(item) {
  const m = item.mainStat;
  const base = `${item.slot}|${m.statId}|${m.isFlat ? 1 : 0}`;
  return item.isAccessory ? `${base}|${item.faction}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): replacement-pool membership for equipped gear

A spare can replace a worn piece only at the same slot and main stat, on a
demanded set, and — for accessories — in the same faction.

Co-Authored-By: Claude"
```

---

### Task 4: Bucketed pool index and `betterCount`

`better` is the count of spares in the pool that would finish strictly better — read as "how many concrete upgrade paths do I have for this slot". Calibrating the cut points (Task 6) needs this for every equipped piece (~4200), so a naive per-piece scan is ~21M predicate evaluations. Index instead.

**Files:**
- Modify: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champion-gear.test.mjs`

**Interfaces:**
- Consumes: `inReplacementPool`, `bucketKeyFor` (Task 3).
- Produces: `buildPoolIndex(items, ceilingOf) -> Map<string, number[]>` (each value ascending), `betterCount(index, item, ceiling) -> number`.

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/champion-gear.test.mjs`, adding `buildPoolIndex, betterCount` to the import:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — `buildPoolIndex is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `oracle/analytics/champion-gear.mjs`:

```js
// Bucket the UNEQUIPPED demanded-set pool by bucketKeyFor, holding each bucket's ceilings in an
// ascending array so betterCount is a binary search instead of a scan. `ceilingOf(item) -> number`.
export function buildPoolIndex(items, ceilingOf) {
  const buckets = new Map();
  for (const it of items) {
    if (it.equippedChampId !== 0) continue;
    if (keepPremium(it.set) < CUTS.focusPremium) continue;
    const k = bucketKeyFor(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(ceilingOf(it));
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a - b);
  return buckets;
}

// Upgrade paths for this slot: pool members whose ceiling is STRICTLY higher (ties are not upgrades).
export function betterCount(index, item, ceiling) {
  const arr = index.get(bucketKeyFor(item));
  if (!arr || !arr.length) return 0;
  let lo = 0, hi = arr.length;                       // first index with arr[i] > ceiling
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= ceiling) lo = mid + 1; else hi = mid;
  }
  return arr.length - lo;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: PASS — 17 tests.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): bucketed pool index and upgrade-path count

better = spares that would finish strictly better. Indexed by slot/main/
faction with sorted ceilings so calibrating over ~4200 equipped pieces is a
binary search rather than a 21M-predicate scan.

Co-Authored-By: Claude"
```

---

### Task 5: Role-gap flag

Flags a piece whose stat profile suits a different archetype than its wearer — support gear on a nuker. An annotation, **not** a verdict input.

**Files:**
- Modify: `oracle/analytics/weights.mjs:41`
- Modify: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champion-gear.test.mjs`

**Interfaces:**
- Consumes: `qualityAtRole` (Task 1), `ALL_ROLES` from `./sets.mjs`.
- Produces: `roleGap(item, champRoleName) -> { gap, bestRole, atChampRole } | null`. Returns `null` when `champRoleName` is null. The caller decides whether `gap >= CUTS.roleGapFlag`.

The max is over **all four** roles, unrestricted by the set annotation — this is a statement about the item's stats, not its set.

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/champion-gear.test.mjs`, adding `roleGap` to the import and these two imports at the top of the file:

```js
import { subMax } from "../rolls.mjs";
import { CUTS } from "../weights.mjs";
```

```js
// a substat at a fraction of its theoretical max
const sub = (statId, isFlat, frac = 1) =>
  ({ statId, isFlat, rolls: 4, value: subMax(statId, isFlat) * frac, glyph: 0 });

test("roleGap: support-statted gear on an Attack champion flags above the threshold", () => {
  const it = gear({ set: 4, substats: [sub(7, true, 0.9), sub(8, true, 0.9), sub(1, false, 0.9)] });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — `roleGap is not a function`, and `CUTS.gearKeepQuantile` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `oracle/analytics/weights.mjs`, replace the `CUTS` export (line 41) with:

```js
export const CUTS = { junkKeepFrac: 0.30, junkKeepFloor: 4, lowPremium: 2, focusPremium: 4, focusPerGroup: 2, upgradeMaxLevel: 12, balanceFactor: 1,
  // champion-gear.mjs: KEEP at/below the p50 of the vault's own equipped-gear upgrade-path counts,
  // SELL at/above p75 (runtime quantiles, so they self-calibrate as the vault grows). roleGapFlag is
  // in score points — the shoulder of the gap distribution, where ~25% of equipped gear sits.
  gearKeepQuantile: 0.50, gearSellQuantile: 0.75, roleGapFlag: 10 };
```

Also extend the comment block above `CUTS` (currently lines 33–40) by appending this line before `export const CUTS`:

```js
// gearKeepQuantile/gearSellQuantile/roleGapFlag drive champion-gear.mjs (see its header).
```

In `oracle/analytics/champion-gear.mjs`, add to the imports:

```js
import { qualityAtRole } from "./score.mjs";
import { ALL_ROLES } from "./sets.mjs";
```

and append:

```js
// How miscast is this piece for the champion wearing it? gap = the item's best score across ALL
// FOUR archetypes (unrestricted by the set annotation — this is about the item's stats, not its
// set) minus its score at the champion's own role. Caller flags at CUTS.roleGapFlag.
export function roleGap(item, champRoleName) {
  if (!champRoleName) return null;
  const atChampRole = qualityAtRole(item, champRoleName);
  let best = { role: champRoleName, score: atChampRole };
  for (const role of ALL_ROLES) {
    const score = qualityAtRole(item, role);
    if (score > best.score) best = { role, score };
  }
  return { gap: best.score - atChampRole, bestRole: best.role, atChampRole };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run oracle/analytics`
Expected: PASS — 22 champion-gear tests, and `weights.test.mjs` still green.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/weights.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): role-gap flag for miscast gear

Flags a piece whose stats suit a different archetype than its wearer. An
annotation only — replaceability alone decides the verdict.

Co-Authored-By: Claude"
```

---

### Task 6: Verdict, cut resolution, and context

The verdict. The **triage override is load-bearing**: 488 of 4192 equipped pieces are setless-dominated and sit at a median of 0 upgrade paths, so replaceability alone inverts exactly those pieces.

**Files:**
- Modify: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champion-gear.test.mjs`

**Interfaces:**
- Consumes: `quantile` (Task 2), `buildPoolIndex`/`betterCount` (Task 4), `roleGap` (Task 5), `triage()` from `./triage.mjs`, `quality` from `./score.mjs`, `rollStats` from `./rollquality.mjs`.
- Produces:
  - `verdictFor({ triageVerdict, triageReason, better }, cuts) -> { verdict, reason }` where `verdict` is `"KEEP" | "BORDERLINE" | "SELL"` and `cuts` is `{ keepCut, sellCut }`.
  - `resolveCuts(betterCounts) -> { keepCut, sellCut, n }`
  - `buildContext(items, scored) -> { ceiling, index, byId, cuts }`
  - `rateItem(item, ctx, champRoleName) -> rating` with fields `{ item, better, ceiling, verdict, reason, q, role, percentile, premium, rolls, roleGap }`
  - `analyzeChampionGear(champRow, items, ctx) -> { champ, role, ratings, tally }`

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/champion-gear.test.mjs`, adding `verdictFor, resolveCuts, buildContext, rateItem, analyzeChampionGear` to the import:

```js
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

test("verdictFor: reason names the upgrade-path count, singular for one", () => {
  expect(verdictFor({ triageVerdict: "keep", triageReason: "keep", better: 1 }, cuts).reason)
    .toBe("1 upgrade path");
  expect(verdictFor({ triageVerdict: "keep", triageReason: "keep", better: 6 }, cuts).reason)
    .toBe("6 upgrade paths");
});

test("resolveCuts reads the quantiles off the supplied population", () => {
  const c = resolveCuts([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(c.n).toBe(10);
  expect(c.keepCut).toBe(quantile([0,1,2,3,4,5,6,7,8,9], CUTS.gearKeepQuantile));
  expect(c.sellCut).toBe(quantile([0,1,2,3,4,5,6,7,8,9], CUTS.gearSellQuantile));
});

test("resolveCuts survives an empty population", () => {
  expect(resolveCuts([])).toEqual({ keepCut: 0, sellCut: 0, n: 0 });
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
  expect(g.ratings.map((r) => r.item.id)).toEqual([1, 2]);   // more upgrade paths first
  expect(g.ratings[0].better).toBeGreaterThan(g.ratings[1].better);
  expect(g.ratings[1].better).toBe(0);                        // no C.DMG-main gloves in the pool
  expect(g.tally.SELL + g.tally.BORDERLINE + g.tally.KEEP).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — `verdictFor is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the imports in `oracle/analytics/champion-gear.mjs`:

```js
import { quality } from "./score.mjs";
import { rollStats } from "./rollquality.mjs";
```

(`qualityAtRole` is already imported from `./score.mjs` — merge them into one import statement.)

Append:

```js
// The triage verdict WINS OUTRIGHT. For equipped gear the only rule that can fire is
// setless-domination (junkTrim and slotBalance both skip equipped items), and it is load-bearing:
// 488 of 4192 equipped pieces are setless-dominated yet sit at a MEDIAN of 0 upgrade paths, because
// the replacement pool only counts demanded sets while setlessDominated compares against ANY
// set-bearing accessory. Without this override the metric inverts exactly those pieces.
export function verdictFor({ triageVerdict, triageReason, better }, cuts) {
  if (triageVerdict === "delete") return { verdict: "SELL", reason: `triage: ${triageReason}` };
  const reason = `${better} upgrade path${better === 1 ? "" : "s"}`;
  if (better <= cuts.keepCut) return { verdict: "KEEP", reason };
  if (better >= cuts.sellCut) return { verdict: "SELL", reason };
  return { verdict: "BORDERLINE", reason };
}

// Cut points are quantiles of the vault's OWN equipped gear, so they self-calibrate as it grows.
// Global rather than per-slot on purpose: per-slot quantiles rate a weapon with 149 upgrade paths
// as KEEP (the weapon slot's own p50 is 181). Holding more spare weapons than spare gloves genuinely
// does make weapons more disposable.
export function resolveCuts(betterCounts) {
  return {
    keepCut: quantile(betterCounts, CUTS.gearKeepQuantile),
    sellCut: quantile(betterCounts, CUTS.gearSellQuantile),
    n: betterCounts.length,
  };
}

// One pass over the vault: ceilings, the pool index, the triage lookup, and the resolved cuts.
// `scored` is the output of triage(items).
export function buildContext(items, scored) {
  const ceiling = new Map(items.map((it) => [it.id, quality(it, true).score]));
  const index = buildPoolIndex(items, (it) => ceiling.get(it.id));
  const byId = new Map(scored.map((s) => [s.item.id, s]));
  // Calibrate on equipped gear the triage hasn't already condemned.
  const counts = items
    .filter((it) => it.equippedChampId > 0 && byId.get(it.id)?.verdict === "keep")
    .map((it) => betterCount(index, it, ceiling.get(it.id)));
  return { ceiling, index, byId, cuts: resolveCuts(counts) };
}

export function rateItem(item, ctx, champRoleName) {
  const s = ctx.byId.get(item.id);
  const ceil = ctx.ceiling.get(item.id);
  const better = betterCount(ctx.index, item, ceil);
  const { verdict, reason } = verdictFor(
    { triageVerdict: s.verdict, triageReason: s.reason, better }, ctx.cuts);
  const rg = roleGap(item, champRoleName);
  return {
    item, better, ceiling: ceil, verdict, reason,
    q: s.q.score, role: s.q.role, percentile: Math.round(s.percentile),
    premium: keepPremium(item.set), rolls: rollStats(item, s.q.role),
    roleGap: rg && rg.gap >= CUTS.roleGapFlag ? rg : null,
  };
}

const VERDICT_ORDER = { SELL: 0, BORDERLINE: 1, KEEP: 2 };

export function analyzeChampionGear(champRow, items, ctx) {
  const role = champRole(champRow);
  const ratings = items
    .filter((it) => it.equippedChampId === Number(champRow.ID))
    .map((it) => rateItem(it, ctx, role))
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
      || b.better - a.better || a.item.slot - b.item.slot);
  const tally = { SELL: 0, BORDERLINE: 0, KEEP: 0 };
  for (const r of ratings) tally[r.verdict]++;
  return { champ: champRow, role, ratings, tally };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run oracle/analytics`
Expected: PASS — 28 champion-gear tests, rest of analytics green.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): keep/borderline/sell verdict for worn gear

Cut points are runtime quantiles of the vault's own equipped gear so they
self-calibrate. The vault-wide triage verdict overrides outright — without it
setless-dominated accessories read as irreplaceable.

Co-Authored-By: Claude"
```

---

### Task 7: CLI — snapshot resolution, champion selection, output

Wires the pure functions to a runnable script. Not unit-tested (it is I/O and formatting), matching `spare-copies.mjs`; verified by running it against a real snapshot.

**Files:**
- Modify: `oracle/analytics/champion-gear.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `readChampRows(dbPath) -> row[]`, `selectChamps(rows, selector) -> row[]`, `parseArgs(argv) -> { selector, dbArg }`, and a guarded `main()`.

- [ ] **Step 1: Write the failing test**

Append to `oracle/analytics/__tests__/champion-gear.test.mjs`, adding `selectChamps, parseArgs` to the import:

```js
const roster = [
  { ID: 110, Name: "Elhain", Role: 0 },
  { ID: 42277, Name: "Elhain", Role: 0 },
  { ID: 76414, Name: "Supreme Elhain", Role: 0 },
  { ID: 117731, Name: "Dark Elhain", Role: 1 },
  { ID: 900, Name: "Kael", Role: 0 },
];

test("selectChamps: an all-digits selector is an exact ID", () => {
  expect(selectChamps(roster, "110").map((r) => r.ID)).toEqual([110]);
});

test("selectChamps: a text selector is a case-insensitive name substring", () => {
  expect(selectChamps(roster, "elhain").map((r) => r.ID))
    .toEqual([110, 42277, 76414, 117731]);
  expect(selectChamps(roster, "DARK").map((r) => r.ID)).toEqual([117731]);
});

test("selectChamps: a null selector returns the whole roster", () => {
  expect(selectChamps(roster, null).length).toBe(5);
});

test("parseArgs: routes digits to selector, .db and paths to the snapshot", () => {
  expect(parseArgs(["110"])).toEqual({ selector: "110", dbArg: undefined });
  expect(parseArgs(["Elhain"])).toEqual({ selector: "Elhain", dbArg: undefined });
  expect(parseArgs(["snap.db"])).toEqual({ selector: null, dbArg: "snap.db" });
  expect(parseArgs(["Elhain", "a/b.db"])).toEqual({ selector: "Elhain", dbArg: "a/b.db" });
  expect(parseArgs(["../x/y.db", "110"])).toEqual({ selector: "110", dbArg: "../x/y.db" });
  expect(parseArgs([])).toEqual({ selector: null, dbArg: undefined });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: FAIL — `selectChamps is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the imports at the top of `oracle/analytics/champion-gear.mjs`:

```js
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readArtifacts } from "./decode.mjs";
import { triage } from "./triage.mjs";
import { ARTIFACT_SLOT_NAMES, ARTIFACT_SET_NAMES, FACTION_NAMES, lookupName } from "@rslh/core";
```

(`keepPremium` is already imported from `./triage.mjs` — merge into one statement.)

Append:

```js
// --- CLI -------------------------------------------------------------------

function resolveDb(arg) {
  if (arg) return arg;
  const dir = fileURLToPath(new URL("../resources", import.meta.url));
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

// An arg ending .db or containing a slash is the snapshot; the first other arg is the selector.
export function parseArgs(argv) {
  const dbArg = argv.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  return { selector: argv.find((a) => a !== dbArg) ?? null, dbArg };
}

// Empty-Name rows are placeholders (they hold no gear and are the one place Role disagrees
// across copies of a name), so they never reach the matcher.
export function readChampRows(dbPath) {
  const db = new DatabaseSync(dbPath);
  const st = db.prepare("SELECT ID, Name, Role, Rarity, Rang, Lvl FROM Champs");
  st.setReadBigInts(true);
  const rows = st.all().map((r) => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
  db.close();
  return rows.filter((r) => typeof r.Name === "string" && r.Name.trim() !== "");
}

export function selectChamps(rows, selector) {
  if (selector === null) return rows;
  if (/^\d+$/.test(selector)) return rows.filter((r) => Number(r.ID) === Number(selector));
  const nf = selector.toLowerCase();
  return rows.filter((r) => r.Name.toLowerCase().includes(nf));
}

const RARITY = { 0: "?", 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary", 6: "Mythical" };
const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setName = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

function printChampion(g) {
  const c = g.champ;
  console.log(`\n${c.Name} #${c.ID} — ${CHAMP_ROLE_LABEL[Number(c.Role)] ?? "?"} (${g.role ?? "?"})`
    + ` · ${RARITY[c.Rarity] ?? "?"} ${c.Rang}★ +${c.Lvl}`);
  for (const r of g.ratings) {
    const it = r.item;
    const fac = it.isAccessory ? `  [${lookupName(FACTION_NAMES, it.faction)}]` : "";
    const gap = r.roleGap ? `  [role: better as ${r.roleGap.bestRole}, +${r.roleGap.gap}]` : "";
    console.log(` ${r.verdict.padEnd(10)} ${slotName(it.slot).padEnd(7)} ${setName(it.set).padEnd(13)}`
      + ` +${String(it.level).padStart(2)}  q${String(r.q).padStart(2)}  p${String(r.percentile).padStart(2)}`
      + `  ceil ${String(r.ceiling).padStart(3)}  ${r.rolls.good}/${r.rolls.total}`
      + `  prem ${r.premium}${fac}${gap}`);
    console.log(`              ${r.reason}`);
  }
}

function main() {
  const { selector, dbArg } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDb(dbArg);
  const rows = readChampRows(dbPath);
  const { items } = readArtifacts(dbPath);
  const scored = triage(items);
  const ctx = buildContext(items, scored);

  const geared = new Set(items.filter((it) => it.equippedChampId > 0).map((it) => it.equippedChampId));
  const matched = selectChamps(rows, selector);
  const targets = matched.filter((r) => geared.has(Number(r.ID))).sort((a, b) => a.ID - b.ID);

  if (selector !== null && !matched.length) {
    console.error(`no champion matches "${selector}".`);
    const near = rows.filter((r) => r.Name.toLowerCase().startsWith(String(selector).slice(0, 3).toLowerCase()));
    if (near.length) console.error(`did you mean: ${[...new Set(near.map((r) => r.Name))].slice(0, 8).join(", ")}?`);
    process.exit(1);
  }
  if (!targets.length) {
    console.error(`"${selector}" matched ${matched.length} copies, none of which hold any gear.`);
    process.exit(1);
  }

  console.log(`# Champion gear — snapshot ${dbPath.split(/[\\/]/).pop()}`);
  console.log(`cuts: KEEP <=${ctx.cuts.keepCut} · SELL >=${ctx.cuts.sellCut}`
    + `   (p${Math.round(CUTS.gearKeepQuantile * 100)}/p${Math.round(CUTS.gearSellQuantile * 100)}`
    + ` of ${ctx.cuts.n} triage-keep equipped pieces)`);

  const groups = targets.map((c) => analyzeChampionGear(c, items, ctx));
  if (selector === null) {
    groups.sort((a, b) => b.tally.SELL - a.tally.SELL || b.ratings.length - a.ratings.length);
    console.log(`${groups.length} geared champions, most sellable first\n`);
    for (const g of groups) {
      console.log(`${g.champ.Name} #${g.champ.ID} (${CHAMP_ROLE_LABEL[Number(g.champ.Role)] ?? "?"})`
        + `  ${g.ratings.length} slots · ${g.tally.SELL} SELL · ${g.tally.BORDERLINE} BORDERLINE · ${g.tally.KEEP} KEEP`);
    }
  } else {
    for (const g of groups) printChampion(g);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run tests, then verify against a real snapshot**

Run: `npx vitest run oracle/analytics`
Expected: PASS — 34 champion-gear tests.

Then run the script for real:

```bash
node --experimental-sqlite oracle/analytics/champion-gear.mjs 110
```

Expected: an Elhain #110 readout, `Attack (ATK-DPS) · Rare 6★ +60`, nine slots, with these verdicts — the design's regression anchor, which matches the owner's real sell/keep decisions on 8 of 9:

| Slot | set | better | verdict |
|---|---|---|---|
| Shield | Cruel | 392 | SELL |
| Weapon | Lifesteal | 149 | SELL |
| Helmet | Cruel | 106 | SELL |
| Ring | (setless) | — | SELL (triage: setless) |
| Banner | (setless) | — | SELL (triage: setless) |
| Boots | Guardian | 47 | BORDERLINE |
| Gloves | Lifesteal | 6 | KEEP |
| Chest | Slayer | 1 | KEEP |
| Amulet | Slayer | 0 | KEEP |

Also check the three other entry points behave:

```bash
node --experimental-sqlite oracle/analytics/champion-gear.mjs Elhain   # 2 geared copies
node --experimental-sqlite oracle/analytics/champion-gear.mjs Zzzznope # exit 1 + suggestions
node --experimental-sqlite oracle/analytics/champion-gear.mjs | head -20  # summary mode
```

If the Elhain numbers don't match, stop and diagnose rather than adjusting thresholds — the cut points are derived, so a mismatch means an upstream bug.

- [ ] **Step 5: Commit**

```bash
git add oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champion-gear.test.mjs
git commit -m "feat(analytics): champion-gear CLI

node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
Name substring or exact ID; no selector gives a per-champion summary.

Co-Authored-By: Claude"
```

---

### Task 8: Document the script

**Files:**
- Modify: `oracle/analytics/README.md`

- [ ] **Step 1: Update the README**

`oracle/analytics/README.md` currently documents only `analyze.mjs`. Replace its `## Run` section with:

```markdown
## Run

1. Build core: `npx tsc -b packages/core`
2. Vault-wide triage report:
   `node --experimental-sqlite oracle/analytics/analyze.mjs [path-to.db]`
   (defaults to the newest `../resources/*-RSLHelper.db`; writes `out/<date>-report.{json,md}`)
3. One champion's worn gear:
   `node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]`

   Rates each equipped piece KEEP / BORDERLINE / SELL. The vault report can't answer this — its
   delete passes skip equipped items, so worn gear always comes back "keep" on supply floors rather
   than merit. Verdicts here are driven by *replaceability*: how many unequipped spares could
   actually take the piece's place (same slot and main stat, same faction for accessories, on a
   demanded set) and would finish with a higher ceiling. Cut points are quantiles of the vault's own
   equipped gear, so they self-calibrate; the vault-wide triage verdict overrides outright.
   Omit the selector for a per-champion summary, worst first.
```

- [ ] **Step 2: Verify the documented commands actually run**

Run each command block from the README verbatim. Expected: all three succeed.

- [ ] **Step 3: Run the full pre-commit gate**

Run: `npm run build && npm test && npm run lint`
Expected: build clean, tests pass, lint clean.

Note: `packages/web/src/__tests__/pipeline.prop.test.ts` has a known seed-dependent 10s timeout that
is not a property violation. If it fails, re-run that file alone to confirm it passes before
proceeding.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/README.md
git commit -m "docs(analytics): document champion-gear.mjs

Co-Authored-By: Claude"
```

---

## Self-Review

**Spec coverage** — every section of the design doc maps to a task:

| Design section | Task |
|---|---|
| CLI / arg conventions | 7 |
| Architecture / data flow | 6 (`buildContext`), 7 (`main`) |
| Champion role + `CHAMP_ROLE` | 2 |
| Replacement pool (slot / main / faction / demanded set) | 3 |
| Implementation note (bucketed index, exported predicate) | 3 (predicate + key), 4 (index) |
| Verdict + triage override | 6 |
| Thresholds / runtime quantiles | 2 (`quantile`), 5 (`CUTS`), 6 (`resolveCuts`) |
| Role mismatch | 5 |
| `qualityAtRole` extraction | 1 |
| Output format | 7 |
| Error handling | 7 |
| Testing | 2–7 (unit), 7 (snapshot regression anchor) |

**Type consistency** — `bucketKeyFor` is used identically in `buildPoolIndex` and `betterCount`; `ctx` is created once in `buildContext` and consumed with the same field names (`ceiling`, `index`, `byId`, `cuts`) in `rateItem`; `cuts` carries `{ keepCut, sellCut, n }` everywhere; `roleGap` returns `{ gap, bestRole, atChampRole }` and is read with those names in `rateItem` and `printChampion`.

**Deliberate gaps:** `main()`, `printChampion()` and `resolveDb()` are not unit-tested — they are I/O and formatting, matching how `spare-copies.mjs` and `worst-artifacts.mjs` are already treated. Task 7 verifies them by running against a real snapshot. The Elhain regression anchor lives in this plan and the design doc rather than in a test, because `oracle/resources/` snapshots are gitignored personal data.
