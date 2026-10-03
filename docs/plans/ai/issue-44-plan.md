# Champion Stat Model from Gestal Implementation Plan

**Goal:** Reproduce the game's **Total Stats** screen for any champion copy and any gear assignment from a Gestal snapshot, as two new pure exports: `gestalChampStats(snapshot)` in the Gestal adapter and a new weight-free `champion-stats.mjs`.

**Architecture:** Two layers with a clean seam. `gestalChampStats` is **adapter work** — it stays in `oracle/analytics/gestal.mjs` beside `gestalChampRows`, translating Gestal's `baseStats` / `bonusesV2` / `loreOfSteelMultiplier` records into `set-bonuses.mjs`'s stat-key space and throwing on any shape it has not been verified against. `champion-stats.mjs` is the **model** — it never reads a snapshot; it takes the adapter's output plus a plain array of `Item`s and emits the game's nine columns and their totals. The model's only dependency is `set-bonuses.mjs` (`setCounts`, `setBonusTotals`), which has no dependencies of its own, so `champion-stats.mjs` stays free of any `@rslh/core` build dependency.

**Tech Stack:** Node ESM (`.mjs`, no TypeScript — `oracle/` sits outside the TS project references), Vitest, ESLint flat config. No new runtime dependencies.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `oracle/analytics/gestal.mjs` | add `gestalChampStats` + its two private helpers; `gestalChampRows` untouched |
| Create | `oracle/analytics/champion-stats.mjs` | the pure stat model: `STATS`, `GREAT_HALL`, `ARENA`, `contribution`, `itemEntries`, `statBreakdown` |
| Create | `oracle/analytics/__tests__/gestal-stats.test.mjs` | tests for `gestalChampStats` only (synthetic fixtures) |
| Create | `oracle/analytics/__tests__/champion-stats.test.mjs` | tests for the stat model (synthetic fixtures) |
| Modify | `CHANGELOG.md` | one `[minor]` entry under `## [Unreleased]` |
| — | `oracle/analytics/__tests__/gestal.test.mjs` | **NOT modified.** Acceptance asks that its cases still pass; leaving it alone makes that trivially true |

**Why a new test file rather than extending `gestal.test.mjs`:** the issue permits either. `gestal.test.mjs` is already 509 lines and spans the adapter, the snapshot file, the capture CLI and `speed.mjs verify`. The champion fixture there also needs *different* defaults for this work (`baseStats`, `bonusesV2`, …), and adding them to the shared `champion()` would perturb a fixture six other tests rely on. The duplicated surface is ~20 lines of fixture builders, which every analytics test file already carries of its own.

---

## Decisions that must NOT be "corrected" during implementation

Read this section before writing code. Each item looks like a bug and is not.

### 1. The Artifacts column uses `setBonusTotals`, and nothing is floored

`oracle/analytics/set-bonuses.mjs:129-131` says, verbatim:

> The same bonuses summed per stat. Fine for percentage-point and flat stats, which add; a caller applying a PERCENTAGE stat to a base must use `setBonusTerms` instead, because the game floors each term separately and the sum has already lost that structure.

That warning is **about the speed model**, and does not apply here. `speed-sets.mjs:107` (`setEffect`) floors each term against base because that reproduces the game's *speed* number. The **Total Stats screen** does something different: it rounds each *column* once, after summing. The issue's model was checked column-for-column against the in-game screen on five champions (Ultimate Deathknight, Helicath, Madame Serris, Thor Faehammer, Pelops the Victor) and matched, with only the ±1 that per-column rounding produces.

Therefore:

- `contribution` does **no** flooring and **no** rounding. Column vectors are unrounded.
- The only rounding is in `totals`, per column, via `Math.round`.
- Use `setBonusTotals`, not `setBonusTerms`.

**Known and accepted consequence:** `statBreakdown`'s SPD column will not equal `speed-sets.mjs setEffect` for the same gear. The two model different quantities. Do not reconcile them in this issue. The module header must say this so the next reader does not rediscover it as a bug.

Lore of Steel is unaffected by the choice: with no flooring, `loreOfSteel × Σ terms ≡ Σ (loreOfSteel × terms)`, so scaling `setBonusTotals` gives exactly the issue's "`loreOfSteel ×` every set-bonus term".

### 2. Three stat id spaces are in play; two of them appear in this issue

| Stat | Game `statKindId` (`bonusesV2`) | Our `STAT_NAMES` (item `statId`) |
|---|---|---|
| HP | 1 | 1 |
| ATK | 2 | 2 |
| DEF | 3 | 3 |
| SPD | 4 | 4 |
| RES | **5** | **7** |
| ACC | **6** | **8** |
| C.RATE | **7** | **5** |
| C.DMG | **8** | **6** |

They agree on 1–4 and **disagree on 5–8**. `gestalChampStats` reads the left column; `itemEntries` reads the right column. Writing one table and using it for both is the defect this issue is most likely to ship. The two mappings live in different files for that reason — do not extract a shared one.

(There is also a third space, Gestal's own item ids, already handled by `GESTAL_STAT` in `gestal.mjs`. It does not appear in this issue.)

### 3. Do not import `statDisplayName` from `@rslh/core`

`packages/core/src/mappings.ts:209` maps ids 1–8 to exactly `itemEntries`' keys, so it is tempting. Do not use it:

- It returns `"Unknown(N)"` for an unknown id. `itemEntries` must **skip** ids 11–18 and **throw** on anything else — so an explicit guard has to exist either way, and the import saves nothing.
- It would give `champion-stats.mjs` a build dependency on `packages/core/dist`. Its only other dependency, `set-bonuses.mjs`, deliberately has none.

### 4. `Math.round` is the rounding function

JS `Math.round` is half-up toward +∞ (`Math.round(0.5) === 1`, `Math.round(-0.5) === -0`). Every value in a breakdown is a non-negative stat contribution, so the negative case cannot arise. Do not write a custom rounder.

### 5. `gestalChampStats` covers the roster document only

`gestalChampRows` appends placeholder rows for wearers the roster omits (`gestal.mjs:142-146`; gear and roster are polled ~53 s apart). `gestalChampStats` is roster-only, so the two can legitimately disagree on membership. That is correct — a champion with no roster record has no `baseStats` to report. Note it in the doc comment; do not add placeholders.

---

## TDD notes for this plan

Every task below follows RED → VERIFY RED → GREEN → VERIFY GREEN. Two RED shapes recur; both are legitimate "feature missing" failures:

- **Module does not exist yet** (first test against `champion-stats.mjs`):
  `Error: Failed to resolve import "../champion-stats.mjs" from "oracle/analytics/__tests__/champion-stats.test.mjs". Does the file exist?`
- **Export does not exist yet** (first test against `gestalChampStats`):
  `SyntaxError: The requested module '../gestal.mjs' does not provide an export named 'gestalChampStats'`

If you see anything else at a RED step — a typo, a bad fixture — fix it and re-run until the failure is one of the above or a clean assertion failure.

**One table is pinned longhand rather than driven test-first:** `GREAT_HALL` and `ARENA` are recorded observations (maxed Great Hall, all four affinities at level 10 on a 2026-09-29 capture; Gold 5 arena league, the account owner's stated assumption). They cannot be re-derived from anything in the repo — `oracle/resources/` is gitignored and empty here. Their test is a second hand-written copy that must be edited in agreement, exactly as `set-bonuses.test.mjs:21-26` defends. This is the TDD reference's "configuration" exception; everything else in this plan is real logic and is driven test-first.

---

## Chunk 0 — Pre-flight

### Task 1: Establish a green baseline

`packages/core/dist` does not exist in a fresh worktree, and several existing tests import `@rslh/core`. Build first, or later failures will be misread as your own.

**Files:** none (verification only)

**Steps:**

- [ ] 1. Build all packages: `npm run build`
     Expected: exits 0; `packages/core/dist/index.js` now exists.
- [ ] 2. Run the full suite: `npm test`
     Expected: all tests pass, 0 failed. Record the test count — you will compare against it at the end.
- [ ] 3. Run the linter: `npm run lint`
     Expected: exits 0, no output.

---

## Chunk 1 — `gestalChampStats` in the Gestal adapter

### Task 2: Base stats mapping, and the missing-`baseStats` throw

**Files:**

- Create: `oracle/analytics/__tests__/gestal-stats.test.mjs`
- Modify: `oracle/analytics/gestal.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/gestal-stats.test.mjs` with the header, imports and fixtures:

  ```javascript
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
  ```

- [ ] 2. Append the first two tests to the same file:

  ```javascript
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
  ```

- [ ] 3. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: the file fails to load with
     `SyntaxError: The requested module '../gestal.mjs' does not provide an export named 'gestalChampStats'`

- [ ] 4. In `oracle/analytics/gestal.mjs`, insert the minimal implementation **after** `unlistedWearers` (which ends at line 154) and **before** the `// Throws unless 'doc' is a Gestal document…` comment:

  ```javascript
  // Gestal's per-champion stat records, keyed by heroId: the champion stat model's input. Unlike
  // gestalChampRows this covers the ROSTER DOCUMENT ONLY — a wearer the roster omits has no
  // baseStats to report, so it gets no entry here, and the two can legitimately disagree on
  // membership.
  export function gestalChampStats(snapshot) {
    const out = new Map();
    for (const c of snapshot.documents.champions.payload.champions) {
      const b = c.baseStats;
      if (!b) throw new Error(`champion ${c.name} ${c.heroId} has no baseStats — the adapter needs updating`);
      out.set(c.heroId, {
        base: { HP: b.hp, ATK: b.atk, DEF: b.def, SPD: b.spd,
          "C.RATE": b.crate, "C.DMG": b.cdmg, RES: b.res, ACC: b.acc },
      });
    }
    return out;
  }
  ```

- [ ] 5. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 3 passed.

- [ ] 6. Commit: `git add oracle/analytics/gestal.mjs oracle/analytics/__tests__/gestal-stats.test.mjs && git commit -m "feat(analytics): gestalChampStats reads per-champion base stats"`

---

### Task 3: Normalize the five bonus sources

**Files:**

- Modify: `oracle/analytics/__tests__/gestal-stats.test.mjs`
- Modify: `oracle/analytics/gestal.mjs`

**Steps:**

- [ ] 1. Append to `gestal-stats.test.mjs`:

  ```javascript
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
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 7 failing, each `expected undefined to deeply equal …` (the record has no `sources` key yet). The 3 tests from Task 2 still pass.

- [ ] 3. In `gestal.mjs`, add the two key tables and the normalizer **immediately above** the `gestalChampStats` comment block:

  ```javascript
  // Gestal's bonusesV2 stat enum -> the key a bonus lands on, in set-bonuses.mjs's key space. This
  // is the GAME's stat numbering (the same one RSLHelper.db's `mid` uses), which agrees with our
  // item stat ids on 1-4 and DISAGREES on 5-8: here 5 is RES and 7 is C.RATE, where an item's
  // statId 5 is C.RATE and 7 is RES. Two tables, deliberately not shared with champion-stats.mjs.
  //
  // The split is also a shape check. On a real capture HP/ATK/DEF arrive flat or relative, SPD flat
  // (relative only from sets), RES and ACC always flat, and both crits always as fractions. A gap in
  // either table is therefore a shape we have never seen, and throws rather than guessing.
  const ABSOLUTE_BONUS_KEY = { 1: "HP", 2: "ATK", 3: "DEF", 4: "SPD", 5: "RES", 6: "ACC" };
  const RELATIVE_BONUS_KEY = { 1: "HP%", 2: "ATK%", 3: "DEF%", 4: "SPD%", 7: "C.RATE", 8: "C.DMG" };

  // One bonusesV2 list -> [key, value] pairs. A relative value is a FRACTION, scaled to the
  // percentage points the model works in and rounded to the 0.01 the game displays — Gestal stores
  // 0.0799999998 for 8%, and 0.01 is the same precision diffSetBonuses tolerates.
  function bonusEntries(list, what) {
    return (list ?? []).map((e) => {
      const table = e.isAbsolute ? ABSOLUTE_BONUS_KEY : RELATIVE_BONUS_KEY;
      const key = table[e.statKindId];
      if (!key) {
        const how = e.isAbsolute ? "absolute" : "relative";
        if (e.statKindId >= 1 && e.statKindId <= 8) {
          throw new Error(`${how} Gestal stat kind ${e.statKindId} (${what}) — the adapter needs updating`);
        }
        throw new Error(`unknown Gestal stat kind ${e.statKindId} (${what}) — the adapter needs updating`);
      }
      return [key, e.isAbsolute ? e.value : Math.round(e.value * 100 * 100) / 100];
    });
  }
  ```

- [ ] 4. In `gestalChampStats`, replace the `out.set(…)` call with the block below — keeping the `const b = c.baseStats;` line and the throw above it exactly as they are:

  ```javascript
      const v2 = c.bonusesV2 ?? {};
      const who = `champion ${c.name} ${c.heroId}`;
      const from = (name) => bonusEntries(v2[name], `${name} bonus of ${who}`);
      out.set(c.heroId, {
        base: { HP: b.hp, ATK: b.atk, DEF: b.def, SPD: b.spd,
          "C.RATE": b.crate, "C.DMG": b.cdmg, RES: b.res, ACC: b.acc },
        sources: {
          mastery: from("mastery"), blessing: from("blessing"), relic: from("relic"),
          empower: from("empower"), factionGuardian: from("factionGuardian"),
        },
      });
  ```

- [ ] 5. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 10 passed.

- [ ] 6. Commit: `git add oracle/analytics/gestal.mjs oracle/analytics/__tests__/gestal-stats.test.mjs && git commit -m "feat(analytics): normalize gestalChampStats bonus sources into the set-bonus key space"`

---

### Task 4: Refuse bonus shapes the adapter has not been verified against

**Files:**

- Modify: `oracle/analytics/__tests__/gestal-stats.test.mjs`

**Steps:**

- [ ] 1. Append to `gestal-stats.test.mjs`:

  ```javascript
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
  ```

- [ ] 2. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 14 passed. These pass immediately because Task 3 step 3 implemented the throws — that is intentional: the throws and their key tables are one indivisible behaviour, and splitting them would have meant writing a table with deliberate holes. If any of these four **fails**, the Task 3 implementation is wrong; fix `bonusEntries`, not the test.

- [ ] 3. Commit: `git add oracle/analytics/__tests__/gestal-stats.test.mjs && git commit -m "test(analytics): pin the bonus shapes gestalChampStats refuses"`

---

### Task 5: `observedSets` as a summed Map

**Files:**

- Modify: `oracle/analytics/__tests__/gestal-stats.test.mjs`
- Modify: `oracle/analytics/gestal.mjs`

**Steps:**

- [ ] 1. Append to `gestal-stats.test.mjs`:

  ```javascript
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
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 4 failing with `TypeError: Cannot read properties of undefined (reading 'size')` / `expected undefined to be an instance of Map`.

- [ ] 3. In `gestalChampStats`, add `observedSets` to the record. Insert these two lines directly above `out.set(c.heroId, {`:

  ```javascript
      const observedSets = new Map();
      for (const [key, value] of from("sets")) observedSets.set(key, (observedSets.get(key) ?? 0) + value);
  ```

  and add `observedSets,` to the object literal, after the `sources: { … },` entry.

- [ ] 4. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 18 passed.

- [ ] 5. Commit: `git add oracle/analytics/gestal.mjs oracle/analytics/__tests__/gestal-stats.test.mjs && git commit -m "feat(analytics): gestalChampStats reports the game's own set bonus as observedSets"`

---

### Task 6: `loreOfSteel`, `awaken`, and the whole-record shape

**Files:**

- Modify: `oracle/analytics/__tests__/gestal-stats.test.mjs`
- Modify: `oracle/analytics/gestal.mjs`

**Steps:**

- [ ] 1. Append to `gestal-stats.test.mjs`:

  ```javascript
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
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 4 failing (`expected undefined to be 0.15`, and the whole-record `toEqual` reporting the two missing keys). "every champion…" and "an empty roster…" pass already — they exercise the loop built in Task 2.

- [ ] 3. In `gestalChampStats`, add the last two fields to the object literal, after `observedSets,`:

  ```javascript
        loreOfSteel: Math.round((c.loreOfSteelMultiplier ?? 0) * 10000) / 10000,
        awaken: c.awakenLevel,
  ```

- [ ] 4. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: 24 passed.

- [ ] 5. Commit: `git add oracle/analytics/gestal.mjs oracle/analytics/__tests__/gestal-stats.test.mjs && git commit -m "feat(analytics): gestalChampStats reports loreOfSteel and awaken level"`

---

### Task 7: Document `gestalChampStats`, and confirm the adapter is otherwise unchanged

**Files:**

- Modify: `oracle/analytics/gestal.mjs`

**Steps:**

- [ ] 1. Replace the four-line comment above `gestalChampStats` (the one beginning `// Gestal's per-champion stat records, keyed by heroId: the champion stat model's input.`) with the full doc comment:

  ```javascript
  // Gestal's per-champion stat records, keyed by heroId: everything champion-stats.mjs needs to
  // reproduce the game's Total Stats screen for a copy.
  //
  //   base          the copy's stats at its CURRENT rank and level, renamed onto the model's stat
  //                 names. crate and cdmg are already percentage points (15, 50), not fractions.
  //   sources       the five per-source bonus breakdowns, as [key, value] in set-bonuses.mjs's key
  //                 space. A missing or null source reads as [], as does a missing bonusesV2.
  //   observedSets  the game's OWN set bonus for the copy's current gear, as a Map, summed per key.
  //                 Nothing here reads it; a later power.mjs verify diffs it against the set table.
  //   loreOfSteel   the mastery's multiplier: 0.15 when taken, else 0.
  //   awaken        the copy's awaken level, for picking a champion's main copy later.
  //
  // SHAPES SEEN on a real capture, which the two key tables above encode and refuse to guess past:
  // stat kinds 1-8 only; HP/ATK/DEF flat or relative; SPD flat, or relative from SETS only; RES and
  // ACC always flat; C.RATE and C.DMG always fractions.
  //
  // ROSTER DOCUMENT ONLY, unlike gestalChampRows. That one appends a placeholder row for a wearer
  // the roster does not list, because its gear still has to be locatable; a champion with no roster
  // record has no baseStats to report, so it gets no entry here and the two can legitimately
  // disagree on membership. gestalChampRows is unaffected by any of this — its rows keep the
  // SQLite row shape.
  export function gestalChampStats(snapshot) {
  ```

- [ ] 2. Confirm `gestalChampRows` was not touched: `git diff --stat HEAD~5 -- oracle/analytics/gestal.mjs`
     Expected: only `oracle/analytics/gestal.mjs` listed, with insertions only (no deletions beyond the comment you just replaced).

- [ ] 3. Confirm the pre-existing adapter tests still pass: `npx vitest run oracle/analytics/__tests__/gestal.test.mjs`
     Expected: all pass, 0 failed.

- [ ] 4. Lint the adapter: `npm run lint`
     Expected: exits 0, no output.

- [ ] 5. Commit: `git add oracle/analytics/gestal.mjs && git commit -m "docs(analytics): document gestalChampStats' fields and the shapes it refuses"`

---

## Chunk 2 — The `champion-stats.mjs` stat model

### Task 8: The module's constants

**Files:**

- Create: `oracle/analytics/__tests__/champion-stats.test.mjs`
- Create: `oracle/analytics/champion-stats.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/champion-stats.test.mjs` with the header, imports and the constants tests:

  ```javascript
  // oracle/analytics/__tests__/champion-stats.test.mjs
  import { expect, test } from "vitest";
  import { ARENA, GREAT_HALL, STATS, contribution, itemEntries, statBreakdown }
    from "../champion-stats.mjs";

  // --- the constants ------------------------------------------------------------------
  //
  // Written out LONGHAND rather than read back off the module under test. Both tables are recorded
  // observations that nothing in the repo can re-derive — a maxed Great Hall on a 2026-09-29
  // capture, and the Gold 5 arena league — so the redundancy is the point: a second copy that has
  // to be edited in agreement, and the only thing that can catch a transcription slip.

  test("STATS is the eight columns of the Total Stats screen, in the game's order", () => {
    expect(STATS).toEqual(["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"]);
  });

  test("GREAT_HALL is the maxed Affinity Bonuses", () => {
    expect(GREAT_HALL).toEqual([
      ["HP%", 20], ["ATK%", 20], ["DEF%", 20], ["RES", 80], ["ACC", 80], ["C.DMG", 25],
    ]);
  });

  test("ARENA is the Gold 5 Classic Arena bonus", () => {
    expect(ARENA).toEqual([["HP%", 22], ["ATK%", 22], ["DEF%", 22]]);
  });
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected:
     `Error: Failed to resolve import "../champion-stats.mjs" from "oracle/analytics/__tests__/champion-stats.test.mjs". Does the file exist?`

- [ ] 3. Create `oracle/analytics/champion-stats.mjs` with a one-line placeholder header and the three constants (the full header comes in Task 13):

  ```javascript
  // The champion stat model: the game's Total Stats screen for a copy and a gear assignment.

  // The eight stats the screen shows, in its column order.
  export const STATS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"];

  // The Great Hall, which the game labels "Affinity Bonuses". MAXED: these are the level-10 values,
  // identical for all four affinities, confirmed on a 2026-09-29 capture where every affinity is at
  // 10. A snapshot does carry great-hall-state.json, so reading the real levels is a one-module
  // change the day a partly-levelled account needs it; until then this assumption is a one-line edit.
  export const GREAT_HALL = [["HP%", 20], ["ATK%", 20], ["DEF%", 20], ["RES", 80], ["ACC", 80], ["C.DMG", 25]];

  // Classic Arena, assuming the GOLD 5 league — the account owner's stated assumption, and the other
  // one-line edit. account-bonuses.json carries the real league, likewise unread for now.
  export const ARENA = [["HP%", 22], ["ATK%", 22], ["DEF%", 22]];
  ```

- [ ] 4. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 3 passed.
     The `set-bonuses.mjs` import is deliberately **not** added yet: nothing uses it until Task 11, and ESLint's `no-unused-vars` flags an unused import binding, which would break `npm run lint` in between.

- [ ] 5. Commit: `git add oracle/analytics/champion-stats.mjs oracle/analytics/__tests__/champion-stats.test.mjs && git commit -m "feat(analytics): add champion-stats.mjs with the Great Hall and arena constants"`

---

### Task 9: `contribution`

**Files:**

- Modify: `oracle/analytics/__tests__/champion-stats.test.mjs`
- Modify: `oracle/analytics/champion-stats.mjs`

**Steps:**

- [ ] 1. Append the shared base fixture and the `contribution` tests to `champion-stats.test.mjs`:

  ```javascript
  // --- fixtures -------------------------------------------------------------------------

  const BASE = { HP: 15000, ATK: 1000, DEF: 1000, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30, ACC: 0 };

  // --- contribution ---------------------------------------------------------------------

  test("a percent key is that percentage of the champion's BASE stat", () => {
    expect(contribution("HP%", 20, BASE)).toEqual(["HP", 3000]);
    expect(contribution("ATK%", 22, BASE)).toEqual(["ATK", 220]);
    expect(contribution("DEF%", 20, BASE)).toEqual(["DEF", 200]);
    expect(contribution("SPD%", 12, BASE)).toEqual(["SPD", 12]);
  });

  test("a flat key contributes its value as-is", () => {
    expect(contribution("HP", 1000, BASE)).toEqual(["HP", 1000]);
    expect(contribution("RES", 80, BASE)).toEqual(["RES", 80]);
    expect(contribution("ACC", 80, BASE)).toEqual(["ACC", 80]);
    expect(contribution("SPD", 8, BASE)).toEqual(["SPD", 8]);
  });

  // The trap this pins: C.RATE and C.DMG are percentage POINTS and carry no "%" suffix, so the
  // Great Hall's C.DMG +25 adds 25 points. Reading it as a percent key would give 25% of base
  // C.DMG — 12.5 here — which is wrong and plausible-looking.
  test("a crit key is additive points, not a percentage of the base crit stat", () => {
    expect(contribution("C.DMG", 25, BASE)).toEqual(["C.DMG", 25]);
    expect(contribution("C.RATE", 12, BASE)).toEqual(["C.RATE", 12]);
  });

  // Unrounded and unfloored: the Total Stats screen rounds each COLUMN once, after summing, which
  // is what statBreakdown does. Rounding here would lose that.
  test("a contribution is left unrounded", () => {
    expect(contribution("HP%", 1.2, BASE)).toEqual(["HP", 180]);
    expect(contribution("ATK%", 2.25, BASE)).toEqual(["ATK", 22.5]);
    expect(contribution("DEF%", 0.05, BASE)).toEqual(["DEF", 0.5]);
  });
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 4 failing with `TypeError: contribution is not a function`.

- [ ] 3. Append `contribution` to `champion-stats.mjs`:

  ```javascript
  // What one [key, value] bonus adds, and to which stat. A "X%" key is a percentage of the
  // champion's BASE X; everything else lands on its own stat as-is, which is what makes C.RATE and
  // C.DMG additive POINTS rather than percentages of the base crit stats.
  //
  // Deliberately unrounded and unfloored. The Total Stats screen rounds each COLUMN once and then
  // sums, so statBreakdown is the only place a number is rounded.
  export function contribution(key, value, base) {
    if (!key.endsWith("%")) return [key, value];
    const stat = key.slice(0, -1);
    return [stat, base[stat] * value / 100];
  }
  ```

- [ ] 4. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 7 passed.

- [ ] 5. Commit: `git add oracle/analytics/champion-stats.mjs oracle/analytics/__tests__/champion-stats.test.mjs && git commit -m "feat(analytics): add contribution, resolving one bonus key against a base"`

---

### Task 10: `itemEntries`

**Files:**

- Modify: `oracle/analytics/__tests__/champion-stats.test.mjs`
- Modify: `oracle/analytics/champion-stats.mjs`

**Steps:**

- [ ] 1. Append the item fixtures and tests to `champion-stats.test.mjs`:

  ```javascript
  // --- itemEntries ------------------------------------------------------------------------

  const sub = (statId, value, glyph = 0, isFlat = false) => ({ statId, isFlat, rolls: 0, value, glyph });
  const item = (o = {}) => ({
    id: 1, slot: 4, set: 0, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 4, isFlat: true, value: 30 }, substats: [], ascStat: null,
    ascLevel: -1, equippedChampId: 0, ...o,
  });

  test("the main stat is the first entry", () => {
    expect(itemEntries(item())).toEqual([["SPD", 30]]);
  });

  // The ITEM stat ids are STAT_NAMES order, NOT the statKindId enum bonusesV2 uses: here 5 is
  // C.RATE and 7 is RES, where a statKindId 5 is RES and 7 is C.RATE.
  test("item stat ids 4-8 map onto SPD, C.RATE, C.DMG, RES and ACC", () => {
    const main = (statId) => itemEntries(item({ mainStat: { statId, isFlat: true, value: 11 } }))[0][0];
    expect([4, 5, 6, 7, 8].map(main)).toEqual(["SPD", "C.RATE", "C.DMG", "RES", "ACC"]);
  });

  test("HP, ATK and DEF take a flat or a percent key from the isFlat flag", () => {
    const main = (statId, isFlat) => itemEntries(item({ mainStat: { statId, isFlat, value: 7 } }))[0][0];
    expect([1, 2, 3].map((id) => main(id, true))).toEqual(["HP", "ATK", "DEF"]);
    expect([1, 2, 3].map((id) => main(id, false))).toEqual(["HP%", "ATK%", "DEF%"]);
  });

  // The glyph is ADDITIVE: substat.value does not already include it, as itemSpeed established.
  test("a substat contributes its value plus its glyph", () => {
    const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 }, substats: [sub(4, 10, 5, true)] });
    expect(itemEntries(it)).toEqual([["HP", 500], ["SPD", 15]]);
  });

  test("the ascension stat contributes like any other", () => {
    const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 },
      ascStat: { statId: 6, isFlat: false, value: 12 } });
    expect(itemEntries(it)).toEqual([["HP", 500], ["C.DMG", 12]]);
  });

  test("an item with no substats and no ascension stat yields its main stat alone", () => {
    expect(itemEntries(item({ substats: [], ascStat: null }))).toHaveLength(1);
  });

  // The damage-type substats (PvE/PvP/Boss/Dungeon DMG +/-) reflect on no Total Stats column, so
  // they are skipped rather than refused — unlike a genuinely unknown id.
  test("a damage-type substat is skipped, and does not stop the rest of the item", () => {
    const it = item({ mainStat: { statId: 1, isFlat: true, value: 500 },
      substats: [sub(11, 5), sub(18, 5), sub(4, 10, 0, true)] });
    expect(itemEntries(it)).toEqual([["HP", 500], ["SPD", 10]]);
  });

  test("an unknown item stat id is refused rather than silently dropped", () => {
    expect(() => itemEntries(item({ substats: [sub(99, 5)] }))).toThrow(/unknown item stat id 99/);
    expect(() => itemEntries(item({ substats: [sub(10, 5)] }))).toThrow(/unknown item stat id 10/);
  });
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 8 failing with `TypeError: itemEntries is not a function`.

- [ ] 3. Append the item key tables and `itemEntries` to `champion-stats.mjs`:

  ```javascript
  // Item stat id -> key. These are OUR ids (STAT_NAMES order), which are NOT the statKindId enum
  // gestal.mjs's bonusesV2 tables use: the two agree on 1-4 and swap around on 5-8, where an item's
  // 5 is C.RATE and 7 is RES while a stat kind's 5 is RES and 7 is C.RATE. Two tables on purpose.
  const SCALED_ITEM_KEY = { 1: "HP", 2: "ATK", 3: "DEF" };
  const ITEM_KEY = { 4: "SPD", 5: "C.RATE", 6: "C.DMG", 7: "RES", 8: "ACC" };

  // null for a stat that belongs on no column. Ids 11-18 are the damage-type substats (PvE, PvP,
  // Boss, Dungeon DMG +, then the same four -); no Total Stats column reflects them, so they are
  // skipped. Anything else is a stat this model has never seen and refuses to guess at.
  function itemKey(stat) {
    const scaled = SCALED_ITEM_KEY[stat.statId];
    if (scaled) return stat.isFlat ? scaled : `${scaled}%`;
    if (ITEM_KEY[stat.statId]) return ITEM_KEY[stat.statId];
    if (stat.statId >= 11 && stat.statId <= 18) return null;
    throw new Error(`unknown item stat id ${stat.statId} — champion-stats.mjs needs updating`);
  }

  // Every [key, value] one item contributes: its main stat, each substat and its ascension stat.
  // A substat's glyph is ADDITIVE — substat.value does not already include it, as itemSpeed
  // established — so it is added here rather than read as an alternative.
  export function itemEntries(item) {
    const out = [];
    const push = (stat, value) => {
      const key = itemKey(stat);
      if (key) out.push([key, value]);
    };
    push(item.mainStat, item.mainStat.value);
    for (const s of item.substats) push(s, s.value + s.glyph);
    if (item.ascStat) push(item.ascStat, item.ascStat.value);
    return out;
  }
  ```

- [ ] 4. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 15 passed.

- [ ] 5. Commit: `git add oracle/analytics/champion-stats.mjs oracle/analytics/__tests__/champion-stats.test.mjs && git commit -m "feat(analytics): add itemEntries, reading one item's stats into bonus keys"`

---

### Task 11: `statBreakdown` — the nine columns and the totals

This task carries the hand-computed verification. Every number below was derived by hand from the fixture; do not adjust a number to make a test pass without re-deriving it.

**Files:**

- Modify: `oracle/analytics/__tests__/champion-stats.test.mjs`
- Modify: `oracle/analytics/champion-stats.mjs`

**Reference — the hand-computed breakdown.** Base `{HP 15000, ATK 1000, DEF 1000, SPD 100, C.RATE 15, C.DMG 50, RES 30, ACC 0}`. Gear: two **Offense** (set 2 — `stack`, 2 pieces, `ATK% 15`) and one **Stone Skin** (set 48 — `tiered`, whose FIRST tier is a single piece, `HP% 8`). So `setBonusTotals` is `{ATK%: 15, HP% 8}`, and with `loreOfSteel` 0.15 the Masteries column also carries `ATK% 2.25` and `HP% 1.2`.

| Column | HP | ATK | DEF | SPD | C.RATE | C.DMG | RES | ACC |
|---|---|---|---|---|---|---|---|---|
| Basic | 15000 | 1000 | 1000 | 100 | 15 | 50 | 30 | 0 |
| Artifacts | 2200 | 750 | 0 | 15 | 20 | 12 | 0 | 0 |
| Affinity | 3000 | 200 | 200 | 0 | 0 | 25 | 80 | 80 |
| Classic Arena | 3300 | 220 | 220 | 0 | 0 | 0 | 0 | 0 |
| Masteries | 180 | 72.5 | 0 | 0 | 5 | 0 | 0 | 0 |
| Faction Guardians | 500 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Empowerment | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Blessing | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 |
| Relic | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 |
| **Totals** | **24180** | **2243** | **1420** | **122** | **40** | **87** | **110** | **130** |

Artifacts HP = 1000 flat + 15000×8/100 = 1200 → 2200. Artifacts ATK = 1000×60/100 + 1000×15/100 = 600 + 150 = 750. Masteries ATK = 1000×5/100 + 1000×2.25/100 = 50 + 22.5 = 72.5, which **rounds to 73** in the totals. Masteries HP = 15000×1.2/100 = 180.

**Steps:**

- [ ] 1. Append the `champStats` fixture and the column-shape tests to `champion-stats.test.mjs`:

  ```javascript
  // --- statBreakdown ---------------------------------------------------------------------

  const champStats = ({ base, sources, ...o } = {}) => ({
    base: { ...BASE, ...base },
    sources: { mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [], ...sources },
    observedSets: new Map(), loreOfSteel: 0, awaken: 0, ...o,
  });

  // Two Offense (a 2-piece stacker) and one Stone Skin, whose FIRST tier is a SINGLE piece — the
  // shape most easily assumed away, and the reason a one-piece set still feeds the Artifacts column.
  const GEAR = [
    item({ id: 1, set: 2, mainStat: { statId: 1, isFlat: true, value: 1000 } }),
    item({ id: 2, set: 2, mainStat: { statId: 2, isFlat: false, value: 60 },
      substats: [sub(4, 10, 5, true)] }),
    item({ id: 3, set: 48, mainStat: { statId: 5, isFlat: false, value: 20 },
      ascStat: { statId: 6, isFlat: false, value: 12 } }),
  ];

  const WORN = champStats({
    sources: {
      mastery: [["ATK%", 5], ["C.RATE", 5]],
      blessing: [["SPD", 7]],
      relic: [["ACC", 50]],
      factionGuardian: [["HP", 500]],
    },
    loreOfSteel: 0.15,
  });

  const columnNamed = (breakdown, name) => breakdown.columns.find(([n]) => n === name)[1];

  test("the columns are the game's nine, in its order", () => {
    expect(statBreakdown(WORN, GEAR).columns.map(([name]) => name)).toEqual([
      "Basic", "Artifacts", "Affinity", "Classic Arena", "Masteries",
      "Faction Guardians", "Empowerment", "Blessing", "Relic",
    ]);
  });

  test("every column vector is keyed by all eight stats, zero where nothing lands", () => {
    for (const [name, vector] of statBreakdown(WORN, GEAR).columns) {
      expect(Object.keys(vector).sort(), name).toEqual([...STATS].sort());
    }
    expect(columnNamed(statBreakdown(WORN, GEAR), "Empowerment"))
      .toEqual({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });
  });

  test("Basic is the champion's base, and is a copy rather than the same object", () => {
    const breakdown = statBreakdown(WORN, GEAR);
    expect(columnNamed(breakdown, "Basic")).toEqual(BASE);
    expect(columnNamed(breakdown, "Basic")).not.toBe(WORN.base);
  });
  ```

- [ ] 2. Run tests to verify failure: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 3 failing with `TypeError: statBreakdown is not a function`.

- [ ] 3. Add the `set-bonuses.mjs` import to the top of `champion-stats.mjs`, directly below the header comment and above `export const STATS`:

  ```javascript
  import { setBonusTotals, setCounts } from "./set-bonuses.mjs";
  ```

  This is the module's only dependency, and it has none of its own — which is what keeps `champion-stats.mjs` free of any `@rslh/core` build dependency.

- [ ] 4. Append `statBreakdown` to the end of `champion-stats.mjs`:

  ```javascript
  const zeros = () => Object.fromEntries(STATS.map((stat) => [stat, 0]));

  // The game's Total Stats screen for one copy and one gear assignment: its nine columns, each an
  // unrounded vector over STATS, and the totals.
  //
  // TOTALS ROUND PER COLUMN, then sum. That is what the game does, and it is where the ±1
  // differences against a plain sum of the unrounded columns come from. Reproducing it is the point.
  export function statBreakdown(champStats, items) {
    const { base, sources, loreOfSteel } = champStats;
    const vector = (entries) => {
      const out = zeros();
      for (const [key, value] of entries) {
        const [stat, amount] = contribution(key, value, base);
        out[stat] += amount;
      }
      return out;
    };
    const setTotals = [...setBonusTotals(setCounts(items))];
    const columns = [
      ["Basic", { ...zeros(), ...base }],
      ["Artifacts", vector([...items.flatMap(itemEntries), ...setTotals])],
      ["Affinity", vector(GREAT_HALL)],
      ["Classic Arena", vector(ARENA)],
      // Lore of Steel scales EVERY set's bonus, not only the eight basic sets, and the game shows
      // that extra here rather than inside the set bonus. Verified on a champion with the mastery,
      // whose Merciless, Zeal and Pinpoint bonuses were all scaled. Scaling the summed totals is
      // the same number as scaling each term: with no flooring, k * Σ terms == Σ (k * terms).
      ["Masteries", vector([...sources.mastery,
        ...setTotals.map(([key, value]) => [key, value * loreOfSteel])])],
      ["Faction Guardians", vector(sources.factionGuardian)],
      ["Empowerment", vector(sources.empower)],
      ["Blessing", vector(sources.blessing)],
      ["Relic", vector(sources.relic)],
    ];
    const totals = Object.fromEntries(STATS.map((stat) =>
      [stat, columns.reduce((sum, [, v]) => sum + Math.round(v[stat]), 0)]));
    return { columns, totals };
  }
  ```

- [ ] 5. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 18 passed.

- [ ] 6. Append the hand-computed column and totals tests. The `zeroVector` helper goes **first**, since the last test uses it:

  ```javascript
  const zeroVector = () => ({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });

  // Column vectors are unrounded, so a percentage term can land on a fraction. Compared with
  // toBeCloseTo rather than toBe: the exact binary value of 15000 * (0.15 * 8) / 100 is not
  // something a test should depend on, while the totals below are integers and are exact.
  test("Artifacts is the items' own stats plus the set bonuses they complete", () => {
    const artifacts = columnNamed(statBreakdown(WORN, GEAR), "Artifacts");
    expect(artifacts.HP).toBeCloseTo(2200, 9);     // 1000 flat + 15000 * 8% from Stone Skin's 1-piece tier
    expect(artifacts.ATK).toBeCloseTo(750, 9);     // 1000 * 60% main + 1000 * 15% from one Offense completion
    expect(artifacts.SPD).toBeCloseTo(15, 9);      // substat 10 + glyph 5
    expect(artifacts["C.RATE"]).toBeCloseTo(20, 9);
    expect(artifacts["C.DMG"]).toBeCloseTo(12, 9); // the ascension stat
    expect(artifacts.DEF).toBe(0);
  });

  test("Affinity applies the Great Hall, crediting C.DMG its 25 POINTS", () => {
    expect(columnNamed(statBreakdown(WORN, GEAR), "Affinity"))
      .toEqual({ HP: 3000, ATK: 200, DEF: 200, SPD: 0, "C.RATE": 0, "C.DMG": 25, RES: 80, ACC: 80 });
  });

  test("Classic Arena applies the Gold 5 bonus to HP, ATK and DEF alone", () => {
    expect(columnNamed(statBreakdown(WORN, GEAR), "Classic Arena"))
      .toEqual({ HP: 3300, ATK: 220, DEF: 220, SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 });
  });

  // Lore of Steel at 0.15 adds 15% of EVERY set term — Stone Skin's tiered HP% as much as Offense's
  // stacking ATK% — and the game shows that extra under Masteries rather than in the set bonus.
  test("Masteries carries the mastery bonuses plus Lore of Steel on every set term", () => {
    const masteries = columnNamed(statBreakdown(WORN, GEAR), "Masteries");
    expect(masteries.ATK).toBeCloseTo(72.5, 9);    // 1000 * 5% mastery + 1000 * (15% * 0.15)
    expect(masteries.HP).toBeCloseTo(180, 9);      // 15000 * (8% * 0.15)
    expect(masteries["C.RATE"]).toBe(5);
  });

  test("Lore of Steel at 0 leaves Masteries with the mastery bonuses alone", () => {
    const none = statBreakdown(champStats({ sources: WORN.sources }), GEAR);
    const masteries = columnNamed(none, "Masteries");
    expect(masteries.ATK).toBeCloseTo(50, 9);
    expect(masteries.HP).toBe(0);
  });

  test("the four remaining sources each land in their own column", () => {
    const breakdown = statBreakdown(WORN, GEAR);
    expect(columnNamed(breakdown, "Faction Guardians").HP).toBe(500);
    expect(columnNamed(breakdown, "Blessing").SPD).toBe(7);
    expect(columnNamed(breakdown, "Relic").ACC).toBe(50);
    expect(columnNamed(breakdown, "Empowerment").HP).toBe(0);
  });

  test("the totals reproduce the hand-computed Total Stats screen", () => {
    expect(statBreakdown(WORN, GEAR).totals).toEqual({
      HP: 24180, ATK: 2243, DEF: 1420, SPD: 122, "C.RATE": 40, "C.DMG": 87, RES: 110, ACC: 130,
    });
  });

  test("an ungeared champion totals its base plus the account-wide bonuses", () => {
    const bare = statBreakdown(champStats(), []);
    expect(columnNamed(bare, "Artifacts")).toEqual(zeroVector());
    expect(bare.totals).toEqual({
      HP: 21300, ATK: 1420, DEF: 1420, SPD: 100, "C.RATE": 15, "C.DMG": 75, RES: 110, ACC: 80,
    });
  });
  ```

  The ungeared totals above are: HP 15000 + 3000 + 3300 = 21300; ATK 1000 + 200 + 220 = 1420; DEF 1000 + 200 + 220 = 1420; SPD 100; C.RATE 15; C.DMG 50 + 25 = 75; RES 30 + 80 = 110; ACC 0 + 80 = 80.

- [ ] 7. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 26 passed. If "the totals reproduce the hand-computed Total Stats screen" fails on ATK with `2242` against `2243`, the implementation is summing the unrounded columns instead of rounding each one — fix `totals`, not the expectation.

- [ ] 8. Commit: `git add oracle/analytics/champion-stats.mjs oracle/analytics/__tests__/champion-stats.test.mjs && git commit -m "feat(analytics): add statBreakdown, the game's nine Total Stats columns"`

---

### Task 12: Pin the per-column rounding rule

**Files:**

- Modify: `oracle/analytics/__tests__/champion-stats.test.mjs`

**Steps:**

- [ ] 1. Append to `champion-stats.test.mjs`:

  ```javascript
  // --- per-column rounding ------------------------------------------------------------------
  //
  // The whole reason totals are not a plain sum. The halves below are contrived to isolate the rule
  // on one stat; in real data it shows up as the ±1 by which a total can differ from the sum of the
  // unrounded columns, which is exactly what the game's own screen does.

  test("totals round EACH column before summing, which a plain sum does not reproduce", () => {
    const halves = champStats({
      base: { ACC: 0 },
      sources: { blessing: [["ACC", 0.5]], relic: [["ACC", 0.5]] },
    });
    const breakdown = statBreakdown(halves, []);
    expect(columnNamed(breakdown, "Blessing").ACC).toBe(0.5);
    expect(columnNamed(breakdown, "Relic").ACC).toBe(0.5);
    // Per column: round(0.5) + round(0.5) = 2, on top of the Great Hall's 80.
    expect(breakdown.totals.ACC).toBe(82);
    // Rounding the unrounded sum instead would give 81 — the ±1 this rule exists to reproduce.
    const unrounded = breakdown.columns.reduce((sum, [, v]) => sum + v.ACC, 0);
    expect(Math.round(unrounded)).toBe(81);
  });

  test("a column that sums to a whole number is unaffected by the rule", () => {
    const whole = champStats({ sources: { blessing: [["ACC", 10]], relic: [["ACC", 10]] } });
    expect(statBreakdown(whole, []).totals.ACC).toBe(100);   // 80 Great Hall + 10 + 10
  });
  ```

- [ ] 2. Run tests to verify pass: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 28 passed. These pass against the Task 11 implementation; they exist to pin the rule against a future "simplification" that sums the unrounded columns. If the first one fails with `expected 81 to be 82`, `totals` is summing unrounded columns — fix the implementation.

- [ ] 3. Commit: `git add oracle/analytics/__tests__/champion-stats.test.mjs && git commit -m "test(analytics): pin that statBreakdown rounds each column before summing"`

---

### Task 13: The `champion-stats.mjs` module header

**Files:**

- Modify: `oracle/analytics/champion-stats.mjs`

**Steps:**

- [ ] 1. Replace the placeholder first line of `champion-stats.mjs` (`// The champion stat model: …`) with the full header, keeping the `import` line that follows it:

  ```javascript
  // The game's TOTAL STATS screen, reproduced for any champion copy and any gear assignment. Pure
  // and weight-free: it reads a champion's stat record (gestal.mjs's gestalChampStats) and a plain
  // array of Items, and knows nothing about power, scoring or snapshots.
  //
  //   total(stat) = Σ over the nine columns of round(column(stat))
  //
  // VERIFIED column for column against the in-game screen on five champions — Ultimate Deathknight,
  // Helicath, Madame Serris, Thor Faehammer and Pelops the Victor — apart from ±1 on some totals,
  // which is the per-column rounding below and is reproduced rather than smoothed away.
  //
  // ROUNDING. The game rounds EACH COLUMN to a whole number and then sums. Column vectors are
  // therefore left unrounded and unfloored, and `totals` is the only place a number is rounded.
  // This is also why the Artifacts column uses setBonusTotals rather than setBonusTerms: the
  // warning on setBonusTotals is about the SPEED model, where the game floors each set term
  // against base separately (speed-sets.mjs's setEffect). The Total Stats screen does not — it
  // rounds per column — so the two genuinely differ, and statBreakdown's SPD column is NOT
  // speed.mjs's number. Do not reconcile them here.
  //
  // LORE OF STEEL multiplies EVERY set's stat bonus, not only the eight basic sets, and the game
  // shows that extra under Masteries rather than inside the set bonus. Verified on a champion with
  // the mastery, whose Merciless, Zeal and Pinpoint bonuses were all scaled. set-bonuses.mjs stays
  // multiplier-free and this module applies it, so a caller that forgets it under-counts rather
  // than double-counts.
  //
  // ACCOUNT-WIDE SOURCES ARE CONSTANTS. The Great Hall is assumed MAXED and the Classic Arena
  // league GOLD 5 — both named constants below, so changing either is a one-line edit. A snapshot
  // does carry great-hall-state.json and account-bonuses.json; nothing reads them yet.
  //
  // STAT IDS. itemEntries reads OUR item stat ids (STAT_NAMES order). They are NOT the statKindId
  // enum gestal.mjs uses for bonusesV2 — the two agree on 1-4 and swap on 5-8. The two tables are
  // deliberately separate.
  ```

- [ ] 2. Lint: `npm run lint`
     Expected: exits 0, no output.

- [ ] 3. Re-run the module's tests to confirm the comment edit broke nothing: `npx vitest run oracle/analytics/__tests__/champion-stats.test.mjs`
     Expected: 28 passed.

- [ ] 4. Commit: `git add oracle/analytics/champion-stats.mjs && git commit -m "docs(analytics): record champion-stats' verification, rounding rule and assumptions"`

---

## Chunk 3 — Changelog and the full gate

### Task 14: Changelog entry

The issue's acceptance criteria do not ask for one, but every recent feature commit in this repo adds one — #41 did so although its issue listed none. Two new exports on a public analytics module is an `Added` at `[minor]`.

**Files:**

- Modify: `CHANGELOG.md`

**Steps:**

- [ ] 1. In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, append a third bullet after the existing `set-bonuses.mjs` one:

  ```markdown
  - [minor] Add `oracle/analytics/champion-stats.mjs`: the game's Total Stats screen for any champion copy and gear assignment, from a Gestal snapshot — nine columns, totals rounded per column as the game does, with Lore of Steel applied to every set's bonus. `gestal.mjs` gains `gestalChampStats`, which reads Gestal's per-copy base stats and per-source bonus breakdown. The Great Hall is assumed maxed and the Classic Arena league Gold 5, both as named constants (#44)
  ```

- [ ] 2. Verify the entry sits under `[Unreleased]` and not under `[0.3.0]`: `git diff CHANGELOG.md`
     Expected: a single `+` line, inside the `## [Unreleased]` / `### Added` block.

- [ ] 3. Commit: `git add CHANGELOG.md && git commit -m "docs: changelog for the champion stat model (#44)"`

---

### Task 15: Full gate

**Files:** none (verification only)

**Steps:**

- [ ] 1. Build: `npm run build`
     Expected: exits 0.
- [ ] 2. Full suite: `npm test`
     Expected: all pass, 0 failed, and the total is Task 1's count **+ 52** (24 in `gestal-stats.test.mjs`, 28 in `champion-stats.test.mjs`).
- [ ] 3. Lint: `npm run lint`
     Expected: exits 0, no output.
- [ ] 4. Confirm the two adapter test files agree the public surface is unchanged: `npx vitest run oracle/analytics/__tests__/gestal.test.mjs oracle/analytics/__tests__/gestal-stats.test.mjs`
     Expected: all pass, 0 failed.
- [ ] 5. Confirm nothing outside the planned file set changed: `git diff --stat HEAD~13`
     Expected: exactly five files — `CHANGELOG.md`, `oracle/analytics/champion-stats.mjs`, `oracle/analytics/gestal.mjs`, `oracle/analytics/__tests__/champion-stats.test.mjs`, `oracle/analytics/__tests__/gestal-stats.test.mjs`. (13 = the commits from Tasks 2–14; the plan document was committed before this one began, so it falls outside the range.)
- [ ] 6. Confirm no snapshot or account data was added: `git status --porcelain`
     Expected: empty. (`.hivemind/` is gitignored; `oracle/resources/` is deny-all.)

---

## Acceptance criteria traceability

| Criterion | Tasks |
|---|---|
| `gestal.mjs` exports `gestalChampStats` with the fields and normalization described, throwing on unknown shapes | 2, 3, 4, 5, 6, 7 |
| `gestalChampRows` is unchanged, and existing `gestal.test.mjs` cases still pass | 7 step 2–3, 15 step 4 |
| `champion-stats.mjs` exports `STATS`, `GREAT_HALL`, `ARENA`, `contribution`, `itemEntries`, `statBreakdown` | 8, 9, 10, 11 |
| Lore of Steel applied to every set's bonus and reported under Masteries | 11 steps 3, 5 |
| `statBreakdown`'s totals are sums of per-column rounded values | 11 step 3, 12 |
| Every test in the issue's Change 3 passes | 2–6 (gestal), 8–12 (model) |
| `npm run build`, `npm test`, `npm run lint` pass | 1, 15 |

**Issue Change 3 checklist, item by item:**

*`gestalChampStats`* — whole-record `toEqual` ✓ T6 · base key mapping ✓ T2, T6 · flat RES and ACC ✓ T3, T6 · Map keyed by heroId for every roster champion ✓ T6 · `awaken` ✓ T6 · flat HP ✓ T3 · ATK% ✓ T3 · SPD% from sets ✓ T5 · C.RATE/C.DMG fractions → points ✓ T3 · float noise 0.0799999998 → 8 ✓ T3 · `loreOfSteel` rounding and `null` → 0 ✓ T6 · missing source → `[]` ✓ T3 · throws on kind 9 ✓ T4 · throws on non-absolute RES ✓ T4 · throws on absolute C.RATE ✓ T4.

*`champion-stats`* — `contribution` per key kind ✓ T9 · Great Hall C.DMG +25 additive ✓ T9 · glyph added to substat ✓ T10 · ascension stat ✓ T10 · HP vs HP% ✓ T10 · damage-type substat skipped ✓ T10 · unknown id throws ✓ T10 · item ids 4–8 → SPD/C.RATE/C.DMG/RES/ACC ✓ T10 · `statBreakdown` hand-computed with a basic set and a one-piece tiered tier at `loreOfSteel` 0.15 ✓ T11 · per-column-rounded sum differs from rounding the unrounded total ✓ T12.

---

## Out of scope — do not add

Named by the issue and listed here so they are not drifted into: power weights, the solver, any CLI, a `power.mjs verify`, reading `great-hall-state.json` or `account-bonuses.json`, and any consumer of `awaken` or `observedSets` (their consumers are the later CLI issue). `speed.mjs` is **not** rewired onto this model in this issue.

**Human-run check, after merge, not a worker step:** compare one champion's `statBreakdown` against the in-game Total Stats screen.
