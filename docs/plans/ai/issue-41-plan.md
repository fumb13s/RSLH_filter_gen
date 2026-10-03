# Full-Stat Set Bonus Table Implementation Plan

**Goal:** Add `oracle/analytics/set-bonuses.mjs` — every artifact set's bonus for every stat, generated from Gestal Desktop's set catalogue — and make the existing SPD-only speed table a derived view of it, correcting six wrong set values in the process.

**Architecture:** One new pure data-plus-helpers module keyed by game set id (the `aset` / `.hsf` id space). `speed-sets.mjs` stops carrying hand-typed values and instead filters `SET_BONUSES` down to its `"SPD%"` entries at module load, keeping every existing export name, shape and signature. `setCounts` moves to the new module and `speed-model.mjs` re-exports it, so there is one definition instead of two. Game data is pinned by longhand transcription tests (an independent second copy), while the four helpers are driven test-first.

**Tech Stack:** Plain Node ESM (`.mjs`) under `oracle/`, outside the TypeScript project. Vitest 3 (`npx vitest run`), ESLint 9 flat config, npm workspaces. Analytics modules import the built core package by name (`@rslh/core`).

---

## Scope Check

**Single subsystem.** Every change lands in `oracle/analytics/` (one new module, two modified modules, three modified test files) plus two documentation files. No package under `packages/` is touched; `@rslh/core` is read-only here. No split is warranted.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `oracle/analytics/set-bonuses.mjs` | **Create** | `SET_BONUSES` (41 rows), `NO_STAT_SETS` (28 ids), `setCounts`, `setBonusTerms`, `setBonusTotals`, `diffSetBonuses` |
| `oracle/analytics/__tests__/set-bonuses.test.mjs` | **Create** | Transcription pins + structure/coverage invariants + helper behaviour |
| `oracle/analytics/speed-sets.mjs` | **Modify** | Derive `CLASSIC_SPEED_SETS` / `TIERED_SPEED_SETS` from `SET_BONUSES`; rewrite header |
| `oracle/analytics/speed-model.mjs` | **Modify** | Drop local `setCounts`; re-export it from `set-bonuses.mjs` |
| `oracle/analytics/__tests__/speed-sets.test.mjs` | **Modify** | Corrected profiles, Killstroke row, 19-id count, `firstThreshold >= 2` guard, stale wording |
| `oracle/analytics/__tests__/speed-solve.test.mjs` | **Modify** | One stale comment (Swift Parry is no longer the only 2-piece tiered set) |
| `oracle/analytics/__tests__/speed-solve.prop.test.mjs` | **Modify** | Stale shape comments; add the new 2/5/8 shape to the tiered generator |
| `docs/plans/2026-08-14-champion-speed-solver-design.md` | **Modify** | Dated correction note after the nine-slot tiered table |
| `CHANGELOG.md` | **Modify** | `[Unreleased]` Added + Fixed entries |

### Decisions taken in this plan

Two points the issue leaves open. Both are called out here so a reviewer can overrule them cheaply.

1. **`CHANGELOG.md` is included** (Task 15). The issue does not list it and it is not an acceptance criterion, but every recent feature commit in this repo adds an entry tagged with its issue number (`#39`, `#36`, `#33`, `#23`), the `## [Unreleased]` heading exists and is empty, and `speed.mjs` output genuinely changes for six sets — a user-visible fix, which is exactly what the changelog is for. Drop Task 15 if the reviewer disagrees; nothing else depends on it.

2. **`TIERED_SETS` in `speed-solve.prop.test.mjs` gains one member** (Task 13). The issue files this under "comments and titles only, no assertion changes", and asks for "the 'Every tier SHAPE' list, which now also needs 2/5/8". That comment's claim is that the array covers every tier shape. After this change a sixth shape (2/5/8) exists that the array does not supply, so mentioning 2/5/8 in the comment without adding a 2/5/8 set would make the comment a lie. Adding a generator member is not an assertion change — the assertions (`solve` equals brute force; the coverage floors) are untouched — so both halves are done. Task 13 includes a step that re-runs the coverage test to prove the floors still hold.

---

## Chunk 0: Prerequisite

### Task 0: Build the core package

`packages/core/dist/` does not exist in a fresh worktree, and the new test file imports `ARTIFACT_SET_NAMES` from `@rslh/core`. Without this, that test fails with a module-resolution error that looks like a bug in the test.

**Files:** none (build output only, gitignored)

**Steps:**

- [ ] 1. Install dependencies if `node_modules/` is absent: `npm install`
     Expected: completes without error. Skip if `node_modules/` already exists.
- [ ] 2. Build all packages: `npm run build`
     Expected: exits 0; `packages/core/dist/mappings.js` now exists.
- [ ] 3. Confirm the existing analytics suite is green before any change: `npx vitest run oracle/analytics`
     Expected: all tests pass. If anything fails here it is pre-existing — record it and do not attribute it to later tasks.

---

## Chunk 1: The `SET_BONUSES` data table

### Task 1: RED — pin the table's rows, structure and coverage

The table is game data transcribed from a catalogue our snapshots do not capture, so these tests are a deliberate **second independent copy**, not a read-back. That is the same convention `speed-sets.test.mjs` already documents and defends at its "Every row of both tables, pinned" comment.

**Files:**

- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs` (create)

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/set-bonuses.test.mjs` with the imports, helpers and data tests
  ```javascript
  // oracle/analytics/__tests__/set-bonuses.test.mjs
  import { test, expect } from "vitest";
  import { SET_BONUSES, NO_STAT_SETS } from "../set-bonuses.mjs";
  import { SETS } from "../sets.mjs";
  import { ARTIFACT_SET_NAMES } from "@rslh/core";

  const asc = (a, b) => a - b;
  const ROWS = () => Object.entries(SET_BONUSES).map(([id, row]) => [Number(id), row]);

  // The eight stats the champion screen reflects. Nothing else belongs in the table: Gestal's
  // catalogue also carries "Ignore DEF" and "HP-scaled damage", which no stat line shows.
  const KEYS = ["HP%", "ATK%", "DEF%", "SPD%", "C.RATE", "C.DMG", "ACC", "RES"];

  // --- Pinned rows ------------------------------------------------------------------------------
  //
  // One row per SHAPE the table has, written out LONGHAND rather than read back off the table under
  // test. That redundancy is the point: it is a second copy that has to be edited in agreement, and
  // it is the only thing that can catch a transcription slip in game data nothing downstream can
  // re-derive from a snapshot.

  test("Speed is a 2-piece stacker worth 12% SPD", () => {
    expect(SET_BONUSES[4]).toEqual({ name: "Speed", kind: "stack", pieces: 2, bonus: { "SPD%": 12 } });
  });

  test("Fatal is a 2-piece stacker granting two stats at once", () => {
    expect(SET_BONUSES[41]).toEqual({
      name: "Fatal", kind: "stack", pieces: 2, bonus: { "ATK%": 15, "C.RATE": 5 },
    });
  });

  test("Lethal is a 4-piece stacker worth 10 points of C.RATE", () => {
    expect(SET_BONUSES[46]).toEqual({
      name: "Lethal", kind: "stack", pieces: 4, bonus: { "C.RATE": 10 },
    });
  });

  // A one-piece tier is the shape most easily assumed away: "a nine-slot set grants nothing below
  // three pieces" is the intuition, and it is wrong.
  test("Stone Skin is tiered and its first tier is a SINGLE piece", () => {
    expect(SET_BONUSES[48]).toEqual({
      name: "Stone Skin", kind: "tiered",
      tiers: [[1, { "HP%": 8 }], [2, { "RES": 40 }], [3, { "DEF%": 15 }],
        [5, { "DEF%": 15 }], [7, { "HP%": 8 }], [8, { "RES": 40 }]],
    });
  });

  // --- Structure --------------------------------------------------------------------------------

  test("every tier threshold is an integer in 1-9, strictly ascending", () => {
    for (const [id, row] of ROWS()) {
      if (row.kind !== "tiered") continue;
      let previous = 0;
      for (const [threshold] of row.tiers) {
        expect(Number.isInteger(threshold), `set ${id} threshold ${threshold}`).toBe(true);
        expect(threshold >= 1 && threshold <= 9, `set ${id} threshold ${threshold} in 1-9`).toBe(true);
        expect(threshold > previous, `set ${id} thresholds ascend past ${previous}`).toBe(true);
        previous = threshold;
      }
    }
  });

  test("every stacking set completes at 2 or 4 pieces", () => {
    for (const [id, row] of ROWS()) {
      if (row.kind !== "stack") continue;
      expect([2, 4], `set ${id} pieces`).toContain(row.pieces);
    }
  });

  test("every row is one of the two kinds, and carries the fields that kind needs", () => {
    for (const [id, row] of ROWS()) {
      expect(["stack", "tiered"], `set ${id} kind`).toContain(row.kind);
      expect(typeof row.name, `set ${id} name`).toBe("string");
      if (row.kind === "stack") expect(typeof row.bonus, `set ${id} bonus`).toBe("object");
      else expect(Array.isArray(row.tiers), `set ${id} tiers`).toBe(true);
    }
  });

  // Asserts equality, not containment: a key that appears nowhere would mean a stat was dropped in
  // transcription, which is as much a defect as a key that should not be there.
  test("the table uses exactly the eight stat keys and no others", () => {
    const seen = new Set();
    for (const [, row] of ROWS()) {
      const bonuses = row.kind === "stack" ? [row.bonus] : row.tiers.map(([, bonus]) => bonus);
      for (const bonus of bonuses) for (const key of Object.keys(bonus)) seen.add(key);
    }
    expect([...seen].sort()).toEqual([...KEYS].sort());
  });

  test("no id is both bonus-bearing and listed as granting nothing", () => {
    expect(ROWS().map(([id]) => id).filter((id) => NO_STAT_SETS.has(id))).toEqual([]);
  });

  // --- Coverage ---------------------------------------------------------------------------------
  //
  // Together the two exports have to account for every set the game has. Without this, a set added
  // by a patch sits in neither, is silently worth zero stats, and nothing says so.

  test("SET_BONUSES and NO_STAT_SETS together cover every set id in ARTIFACT_SET_NAMES", () => {
    const covered = [...ROWS().map(([id]) => id), ...NO_STAT_SETS].sort(asc);
    const known = Object.keys(ARTIFACT_SET_NAMES).map(Number).sort(asc);
    expect(covered).toEqual(known);
    expect(known).toHaveLength(69);
  });

  test("the table has 41 rows and NO_STAT_SETS has the other 28 ids", () => {
    expect(ROWS()).toHaveLength(41);
    expect(NO_STAT_SETS.size).toBe(28);
  });

  // sets.mjs is an independent, pre-existing table. Agreeing with it kills the wrong-id class
  // outright: a mistyped id would have to land on a different real set that happens to carry the
  // same name. Note the spellings differ from core's — SETS says "Crit Rate" where
  // ARTIFACT_SET_NAMES says "Critical Rate" — and SETS is the one that wins.
  test("every name agrees with sets.mjs, or with ARTIFACT_SET_NAMES where sets.mjs has no row", () => {
    for (const [id, row] of ROWS()) {
      expect(row.name, `set ${id}`).toBe(SETS[id]?.name ?? ARTIFACT_SET_NAMES[id]);
    }
  });

  // Pins the scope of that fallback: if sets.mjs later grows rows for 39 and 43, this says so rather
  // than letting the fallback quietly stop being reachable.
  test("ids 39 and 43 are exactly the rows sets.mjs does not carry", () => {
    expect(ROWS().filter(([id]) => !SETS[id]).map(([id]) => id)).toEqual([39, 43]);
  });
  ```
- [ ] 2. Run the new test file to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: the suite fails to load — `Failed to resolve import "../set-bonuses.mjs"` (or `Cannot find module`). This is the correct failure: the module does not exist yet. **Do not proceed until you see this specific error.** If you instead see an error mentioning `@rslh/core`, Task 0 step 2 did not run.

### Task 2: GREEN — create the module with the table

The 41 rows are transcribed **verbatim** from the issue body. They were generated from Gestal's catalogue, not retyped from a wiki, and our snapshots do not capture that catalogue (`gestal.mjs`'s `DOCUMENTS` takes gear, roster and the stat documents only), so there is nothing on disk to re-derive them from. Copy the block exactly; do not reformat the values.

**Files:**

- Create: `oracle/analytics/set-bonuses.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/set-bonuses.mjs` with the header comment
  ```javascript
  // Every artifact set's STAT bonus, for every stat. The companion to sets.mjs (which carries names,
  // roles and demand rather than numbers), and the table speed-sets.mjs now derives its SPD view from.
  //
  // PROVENANCE. Generated from Gestal Desktop's set catalogue (`Desktop/gearsets.json`), whose game
  // set ids come through `Desktop/mappings.json` -> `gearSets` into the `aset` / `.hsf` id space this
  // table is keyed by — the same space as `Item.set` and ARTIFACT_SET_NAMES. Our snapshots do NOT
  // capture that catalogue (gestal.mjs's DOCUMENTS takes gear, roster and the stat documents only), so
  // nothing here can be re-derived from a snapshot on disk; a refresh means reading Gestal's data root.
  //
  // VERIFIED 532/532. With the two stacking rules below, this table reproduces the game's OWN
  // per-champion set bonuses — Gestal's `bonusesV2.sets`, which is what the champion screen shows —
  // for all 532 geared champions on the 2026-09-29 capture. That is why it is trusted over the
  // hand-typed speed values it replaces, which it showed to be wrong for six sets (see speed-sets.mjs).
  //
  // TWO KINDS, mapping onto Gestal's four categories:
  //   `stack`   Gestal `2-set` and `4-set`. A set contributes floor(count / pieces) completions, each
  //             granting `bonus` in full. Six pieces of Life is three completions, +45% HP.
  //   `tiered`  Gestal `Variable` — the nine-slot sets. Every tier whose threshold is <= count applies
  //             ONCE, and they accumulate. ONE-PIECE TIERS EXIST: Stone Skin grants +8% HP off a
  //             single piece, so a tiered set is not inert below three pieces.
  // Gestal's fourth category, `1-set` (the accessory-only sets 1000-1004), carries no stats at all and
  // sits in NO_STAT_SETS with the rest.
  //
  // STAT KEYS. "HP%", "ATK%", "DEF%" and "SPD%" are percentages of the champion's BASE stat. "C.RATE"
  // and "C.DMG" are percentage POINTS, added as-is. "ACC" and "RES" are flat. No set grants flat
  // HP/ATK/DEF/SPD, so there is no flat-versus-percent ambiguity to carry per row. The spellings match
  // statDisplayName in @rslh/core except "SPD%", which core has no name for because no ITEM grants it.
  //
  // NOT HERE: non-stat effects. The catalogue also lists Lethal's ignore-DEF and Merciless's tier-6
  // ignore-DEF (Gestal stat ids 14 "Ignore DEF" and 15 "HP-scaled damage"). They are left out because
  // no stat on the champion screen reflects them, so a stat model has nothing to do with them.
  //
  // NOT HERE EITHER: Lore of Steel. That mastery multiplies every set's stat bonus by (1 + multiplier),
  // and the game shows the extra under Masteries rather than inside the set bonus. The champion stat
  // model applies it; this module stays multiplier-free, so a caller that forgets it under-counts
  // rather than double-counts.
  //
  // This is GAME DATA and will drift on a game patch. The guard is `power.mjs verify`, which re-checks
  // the table against the game's own set bonuses on a fresh Gestal capture.
  ```
- [ ] 2. Append `SET_BONUSES` to the same file, copied verbatim from the issue
  ```javascript
  export const SET_BONUSES = {
    1:   { name: "Life",                  kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
    2:   { name: "Offense",               kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
    3:   { name: "Defense",               kind: "stack", pieces: 2, bonus: { "DEF%": 15 } },
    4:   { name: "Speed",                 kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
    5:   { name: "Crit Rate",             kind: "stack", pieces: 2, bonus: { "C.RATE": 12 } },
    6:   { name: "Crit Damage",           kind: "stack", pieces: 2, bonus: { "C.DMG": 20 } },
    7:   { name: "Accuracy",              kind: "stack", pieces: 2, bonus: { "ACC": 40 } },
    8:   { name: "Resistance",            kind: "stack", pieces: 2, bonus: { "RES": 40 } },
    29:  { name: "Cruel",                 kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
    30:  { name: "Immortal",              kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
    31:  { name: "Divine Offense",        kind: "stack", pieces: 2, bonus: { "ATK%": 15 } },
    32:  { name: "Divine Crit Rate",      kind: "stack", pieces: 2, bonus: { "C.RATE": 12 } },
    33:  { name: "Divine Life",           kind: "stack", pieces: 2, bonus: { "HP%": 15 } },
    34:  { name: "Divine Speed",          kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
    35:  { name: "Swift Parry",           kind: "tiered", tiers: [[1, { "C.DMG": 15 }], [2, { "SPD%": 8 }], [3, { "C.DMG": 15 }], [4, { "SPD%": 10 }], [5, { "HP%": 10 }], [7, { "HP%": 15 }], [8, { "SPD%": 10 }]] },
    36:  { name: "Deflection",            kind: "tiered", tiers: [[1, { "ACC": 20 }], [2, { "SPD%": 10 }], [3, { "ACC": 20 }], [5, { "SPD%": 10 }], [7, { "ACC": 20 }], [8, { "SPD%": 12 }]] },
    37:  { name: "Resilience",            kind: "stack", pieces: 2, bonus: { "HP%": 10, "DEF%": 10 } },
    38:  { name: "Perception",            kind: "stack", pieces: 2, bonus: { "ACC": 40, "SPD%": 5 } },
    39:  { name: "Affinitybreaker",       kind: "stack", pieces: 4, bonus: { "C.DMG": 30 } },
    40:  { name: "Untouchable",           kind: "stack", pieces: 4, bonus: { "RES": 40 } },
    41:  { name: "Fatal",                 kind: "stack", pieces: 2, bonus: { "ATK%": 15, "C.RATE": 5 } },
    43:  { name: "Bloodthirst",           kind: "stack", pieces: 4, bonus: { "C.RATE": 12 } },
    45:  { name: "Fortitude",             kind: "stack", pieces: 2, bonus: { "DEF%": 10, "RES": 40 } },
    46:  { name: "Lethal",                kind: "stack", pieces: 4, bonus: { "C.RATE": 10 } },
    47:  { name: "Protection",            kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 12 }], [5, { "SPD%": 12 }], [7, { "RES": 20 }], [8, { "SPD%": 8 }]] },
    48:  { name: "Stone Skin",            kind: "tiered", tiers: [[1, { "HP%": 8 }], [2, { "RES": 40 }], [3, { "DEF%": 15 }], [5, { "DEF%": 15 }], [7, { "HP%": 8 }], [8, { "RES": 40 }]] },
    49:  { name: "Killstroke",            kind: "stack", pieces: 2, bonus: { "C.DMG": 20, "SPD%": 5 } },
    50:  { name: "Instinct",              kind: "stack", pieces: 4, bonus: { "SPD%": 12 } },
    52:  { name: "Defiant",               kind: "stack", pieces: 2, bonus: { "DEF%": 10 } },
    53:  { name: "Impulse",               kind: "stack", pieces: 2, bonus: { "SPD%": 12 } },
    54:  { name: "Zeal",                  kind: "stack", pieces: 2, bonus: { "C.DMG": 20 } },
    57:  { name: "Righteous",             kind: "stack", pieces: 2, bonus: { "RES": 40, "SPD%": 10 } },
    58:  { name: "Supersonic",            kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 10 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
    59:  { name: "Merciless",             kind: "tiered", tiers: [[1, { "ATK%": 10 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "ATK%": 15 }], [7, { "SPD%": 5 }], [8, { "C.DMG": 15 }]] },
    60:  { name: "Slayer",                kind: "tiered", tiers: [[1, { "C.RATE": 5 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "C.RATE": 10 }], [7, { "C.DMG": 15 }], [8, { "SPD%": 5 }]] },
    61:  { name: "Feral",                 kind: "tiered", tiers: [[1, { "ACC": 40 }], [2, { "SPD%": 5 }], [3, { "ACC": 40 }], [5, { "SPD%": 5 }], [7, { "ACC": 40 }], [8, { "SPD%": 5 }]] },
    62:  { name: "Pinpoint",              kind: "tiered", tiers: [[1, { "ACC": 20 }], [2, { "SPD%": 10 }], [3, { "ACC": 20 }], [5, { "SPD%": 10 }], [7, { "ACC": 20 }], [8, { "SPD%": 12 }]] },
    63:  { name: "Stonecleaver",          kind: "tiered", tiers: [[1, { "ATK%": 10 }], [2, { "C.DMG": 15 }], [3, { "SPD%": 5 }], [5, { "ATK%": 15 }], [7, { "SPD%": 5 }], [8, { "C.DMG": 15 }]] },
    64:  { name: "Rebirth",               kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "SPD%": 10 }], [3, { "RES": 20 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
    65:  { name: "Chronophage",           kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "SPD%": 10 }], [3, { "RES": 20 }], [5, { "SPD%": 10 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
    66:  { name: "Mercurial",             kind: "tiered", tiers: [[1, { "RES": 20 }], [2, { "HP%": 15 }], [3, { "SPD%": 8 }], [5, { "SPD%": 12 }], [7, { "RES": 20 }], [8, { "SPD%": 12 }]] },
  };
  ```
- [ ] 3. Append `NO_STAT_SETS` to the same file
  ```javascript
  // The other 28 ids the catalogue knows, which grant no stats at all: 9-28 (the original effect sets
  // — Lifesteal, Fury, Stun and so on), Frostbite (42), Guardian (44), Bolster (51), and the five
  // accessory-only `1-set` sets. Listed explicitly rather than inferred by absence, so that
  // SET_BONUSES and this together can be proven to cover every set id the game has — which is what
  // turns "a set added by a patch" from a silent zero into a failing test.
  export const NO_STAT_SETS = new Set([
    9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    42, 44, 51,
    1000, 1001, 1002, 1003, 1004,
  ]);
  ```
- [ ] 4. Run the test file to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 13 passing tests, 0 failing. Output pristine — no warnings.
- [ ] 5. Lint the new files: `npx eslint oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: no output (exit 0).
- [ ] 6. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): add the full-stat set bonus table"`

---

## Chunk 2: The helpers

Each task appends its tests to `oracle/analytics/__tests__/set-bonuses.test.mjs` and its implementation to `oracle/analytics/set-bonuses.mjs`. Add every new import to the existing import block at the top of the test file as you go.

### Task 3: `setCounts` — moved from `speed-model.mjs`

**Files:**

- Modify: `oracle/analytics/set-bonuses.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Add `setCounts` to the test file's import from `../set-bonuses.mjs`
  ```javascript
  import { SET_BONUSES, NO_STAT_SETS, setCounts } from "../set-bonuses.mjs";
  ```
- [ ] 2. Append the two `setCounts` tests to the end of the test file
  ```javascript
  // --- setCounts --------------------------------------------------------------------------------

  test("setCounts tallies how many of these items carry each set", () => {
    const items = [{ set: 4 }, { set: 4 }, { set: 38 }];
    expect(Object.fromEntries(setCounts(items))).toEqual({ 4: 2, 38: 1 });
  });

  // Set 0 is "no set", not a set numbered 0. Counting it would make a pile of setless items look
  // like a completion candidate to every caller that reads these counts.
  test("setCounts skips setless items", () => {
    expect(setCounts([{ set: 4 }, { set: 0 }, { set: 0 }]).has(0)).toBe(false);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 2 failures, both `TypeError: setCounts is not a function`.
- [ ] 4. Append `setCounts` to `oracle/analytics/set-bonuses.mjs`, moved verbatim from `speed-model.mjs`
  ```javascript
  // setId -> how many of these items carry it. Setless items (set 0) belong to no set and are skipped.
  export function setCounts(items) {
    const counts = new Map();
    for (const item of items) {
      if (!item.set) continue;
      counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
    }
    return counts;
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 15 passing, 0 failing.
- [ ] 6. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): move setCounts next to the set table"`

### Task 4: `speed-model.mjs` re-exports `setCounts`

The RED here is an **identity** assertion. A behavioural test would pass before and after, because the behaviour is unchanged — the point of the refactor is that there is one definition, and only a reference check can observe that.

**Files:**

- Modify: `oracle/analytics/speed-model.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Add the `speed-model.mjs` import to the test file's import block
  ```javascript
  import { setCounts as setCountsFromSpeedModel } from "../speed-model.mjs";
  ```
- [ ] 2. Append the identity test to the end of the test file
  ```javascript
  // speed-model.mjs used to define its own copy. It re-exports this one, so the two cannot drift —
  // a stronger claim than "both happen to pass the same tests today", and the only one a reference
  // check can make.
  test("speed-model re-exports THIS setCounts rather than a second copy", () => {
    expect(setCountsFromSpeedModel).toBe(setCounts);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 1 failure on the identity test — two distinct function objects. The message names `[Function setCounts]` on both sides, which is the expected shape of this failure.
- [ ] 4. In `oracle/analytics/speed-model.mjs`, add the import and re-export immediately after the existing `speed-sets.mjs` import on line 13
  ```javascript
  import { setEffect } from "./speed-sets.mjs";
  import { setCounts } from "./set-bonuses.mjs";

  // Re-exported so every existing consumer keeps reading setCounts from the speed model, while the
  // one definition lives next to the set table it counts sets for.
  export { setCounts } from "./set-bonuses.mjs";
  ```
     The `import` and the `export ... from` together are deliberate and not a conflict: `export ... from` creates no local binding, so the imported local `setCounts` is what `buildSpeed` below uses. Same pattern as `oracle/analytics/decode.mjs:5`.
- [ ] 5. Delete the local definition from `oracle/analytics/speed-model.mjs` — the comment and function that currently occupy lines 61-69
  ```javascript
  // setId -> how many of these items carry it. Setless items (set 0) belong to no set and are skipped.
  export function setCounts(items) {
    const counts = new Map();
    for (const item of items) {
      if (!item.set) continue;
      counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
    }
    return counts;
  }
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 16 passing, 0 failing.
- [ ] 7. Verify the three existing consumers still work — `speed.mjs`, `speed-solve.mjs` and `speed-model.test.mjs` all import `setCounts` from `speed-model.mjs`: `npx vitest run oracle/analytics`
     Expected: every analytics test passes, including `speed-model.test.mjs`'s "setCounts tallies sets across a build and ignores setless items".
- [ ] 8. Lint: `npx eslint oracle/analytics/speed-model.mjs`
     Expected: no output. In particular no `no-unused-vars` on the imported `setCounts` — `buildSpeed` uses it.
- [ ] 9. Commit: `git add oracle/analytics/speed-model.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "refactor(analytics): speed-model re-exports setCounts instead of defining it"`

### Task 5: `setBonusTerms` — the stacking branch

**Files:**

- Modify: `oracle/analytics/set-bonuses.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Add `setBonusTerms` to the test file's `../set-bonuses.mjs` import, and add two helpers below the existing `ROWS` / `KEYS` declarations
  ```javascript
  const counts = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  ```
- [ ] 2. Append the stacking tests to the end of the test file
  ```javascript
  // --- setBonusTerms ----------------------------------------------------------------------------
  //
  // A LIST, not a sum, because the speed model floors each percentage term against base separately:
  // Σ floor(base * p) is not floor(base * Σ p). Summing here would quietly change the number
  // speed.mjs prints.

  test("a stacking set contributes one term per floor(count / pieces) completion", () => {
    expect(setBonusTerms(counts({ 1: 6 }))).toEqual([
      { setId: 1, key: "HP%", value: 15 },
      { setId: 1, key: "HP%", value: 15 },
      { setId: 1, key: "HP%", value: 15 },
    ]);
  });

  test("a stacking set contributes nothing below its piece count", () => {
    expect(setBonusTerms(counts({ 46: 3 }))).toEqual([]);
    expect(setBonusTerms(counts({ 46: 4 }))).toEqual([{ setId: 46, key: "C.RATE", value: 10 }]);
  });

  test("a two-stat completion contributes one term per stat, each naming its set", () => {
    expect(setBonusTerms(counts({ 41: 2 }))).toEqual([
      { setId: 41, key: "ATK%", value: 15 },
      { setId: 41, key: "C.RATE", value: 5 },
    ]);
  });

  test("setBonusTerms ignores a set the table grants no stats for", () => {
    expect(setBonusTerms(counts({ 1003: 3, 15: 6 }))).toEqual([]);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 4 failures, all `TypeError: setBonusTerms is not a function`.
- [ ] 4. Append `setBonusTerms` to `oracle/analytics/set-bonuses.mjs` with the stacking branch only
  ```javascript
  // Every stat bonus a build earns, as a flat list — one entry per completed `stack` set and per
  // unlocked `tiered` tier, per stat. `counts` maps setId -> how many of the nine equipped items
  // carry that set. A set the table has no row for contributes nothing.
  export function setBonusTerms(counts) {
    const terms = [];
    for (const [setId, count] of counts) {
      const row = SET_BONUSES[setId];
      if (!row) continue;
      if (row.kind === "stack") {
        for (let n = Math.floor(count / row.pieces); n > 0; n--) {
          for (const [key, value] of Object.entries(row.bonus)) terms.push({ setId, key, value });
        }
      }
    }
    return terms;
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 20 passing, 0 failing.
- [ ] 6. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): setBonusTerms lists stacking-set completions"`

### Task 6: `setBonusTerms` — the tiered branch

**Files:**

- Modify: `oracle/analytics/set-bonuses.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Append the tiered tests to the end of the test file
  ```javascript
  test("a tiered set's one-piece tier applies off a single piece", () => {
    expect(setBonusTerms(counts({ 48: 1 }))).toEqual([{ setId: 48, key: "HP%", value: 8 }]);
  });

  test("crossing a tiered set's next threshold ADDS a tier rather than replacing one", () => {
    expect(setBonusTerms(counts({ 48: 2 }))).toEqual([
      { setId: 48, key: "HP%", value: 8 },
      { setId: 48, key: "RES", value: 40 },
    ]);
  });

  // A count between two thresholds earns exactly the lower one's tiers — the property usefulCounts
  // in speed-sets.mjs is built on.
  test("a count between two thresholds unlocks no further tier", () => {
    expect(setBonusTerms(counts({ 48: 4 }))).toEqual(setBonusTerms(counts({ 48: 3 })));
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 2 failures. "one-piece tier" and "crossing a tiered set's next threshold" both get `[]`, because the tiered branch does not exist. The third test ("a count between two thresholds") **passes** — `[]` equals `[]` — which is why it is not the test driving this step.
- [ ] 3. In `oracle/analytics/set-bonuses.mjs`, add the tiered branch to `setBonusTerms`. Replace the body of the `for (const [setId, count] of counts)` loop
  ```javascript
      const row = SET_BONUSES[setId];
      if (!row) continue;
      if (row.kind === "stack") {
        for (let n = Math.floor(count / row.pieces); n > 0; n--) {
          for (const [key, value] of Object.entries(row.bonus)) terms.push({ setId, key, value });
        }
        continue;
      }
      // Cumulative, not exclusive: EVERY tier at or below `count` applies, once each.
      for (const [threshold, bonus] of row.tiers) {
        if (count < threshold) continue;
        for (const [key, value] of Object.entries(bonus)) terms.push({ setId, key, value });
      }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 23 passing, 0 failing.
- [ ] 5. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): setBonusTerms accumulates tiered-set tiers"`

### Task 7: `setBonusTotals`

**Files:**

- Modify: `oracle/analytics/set-bonuses.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Add `setBonusTotals` to the test file's `../set-bonuses.mjs` import, and add this helper next to `counts`
  ```javascript
  // Totals as a plain object, so an assertion reads clearly and does not depend on Map key order.
  const totalsOf = (o) => Object.fromEntries(setBonusTotals(counts(o)));
  ```
- [ ] 2. Append the totals tests to the end of the test file
  ```javascript
  // --- setBonusTotals ---------------------------------------------------------------------------

  test("setBonusTotals returns a Map keyed by stat", () => {
    const totals = setBonusTotals(counts({ 4: 2 }));
    expect(totals).toBeInstanceOf(Map);
    expect(totals.get("SPD%")).toBe(12);
  });

  test("setBonusTotals sums a stacking set's completions", () => {
    expect(totalsOf({ 1: 6 })).toEqual({ "HP%": 45 });
  });

  test("setBonusTotals sums two tiers of the same stat", () => {
    expect(totalsOf({ 48: 5 })).toEqual({ "HP%": 8, "RES": 40, "DEF%": 30 });
  });

  test("Stone Skin at eight pieces has every one of its six tiers applied once", () => {
    expect(totalsOf({ 48: 8 })).toEqual({ "HP%": 16, "RES": 80, "DEF%": 30 });
  });

  test("Merciless at all nine slots sums its three stats across six tiers", () => {
    expect(totalsOf({ 59: 9 })).toEqual({ "ATK%": 25, "C.DMG": 30, "SPD%": 10 });
  });

  test("setBonusTotals sums across different sets", () => {
    expect(totalsOf({ 4: 2, 38: 2 })).toEqual({ "SPD%": 17, "ACC": 40 });
  });

  test("setBonusTotals is empty for an ungeared build", () => {
    expect(setBonusTotals(new Map()).size).toBe(0);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 7 failures, all `TypeError: setBonusTotals is not a function`.
- [ ] 4. Append `setBonusTotals` to `oracle/analytics/set-bonuses.mjs`
  ```javascript
  // The same bonuses summed per stat. Fine for percentage-point and flat stats, which add; a caller
  // applying a PERCENTAGE stat to a base must use setBonusTerms instead, because the game floors each
  // term separately and the sum has already lost that structure.
  export function setBonusTotals(counts) {
    const totals = new Map();
    for (const { key, value } of setBonusTerms(counts)) {
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    return totals;
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 30 passing, 0 failing.
- [ ] 6. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): setBonusTotals sums the per-stat bonuses"`

### Task 8: `diffSetBonuses`

**Files:**

- Modify: `oracle/analytics/set-bonuses.mjs`
- Test: `oracle/analytics/__tests__/set-bonuses.test.mjs`

**Steps:**

- [ ] 1. Add `diffSetBonuses` to the test file's `../set-bonuses.mjs` import, and add this helper next to `counts`
  ```javascript
  const observed = (o) => new Map(Object.entries(o));
  ```
- [ ] 2. Append the diff tests to the end of the test file
  ```javascript
  // --- diffSetBonuses ---------------------------------------------------------------------------
  //
  // What a later `power.mjs verify` compares the table against the game's own set bonuses with.

  test("diffSetBonuses reports nothing when the table matches what was observed", () => {
    expect(diffSetBonuses(counts({ 4: 2 }), observed({ "SPD%": 12 }))).toEqual([]);
  });

  test("diffSetBonuses reports a mismatch with both values", () => {
    expect(diffSetBonuses(counts({ 4: 2 }), observed({ "SPD%": 10 })))
      .toEqual([{ key: "SPD%", table: 12, observed: 10 }]);
  });

  // A key on one side only is the shape a patch takes when a set gains or loses a stat, so it has to
  // be reported rather than skipped. Reading the missing side as 0 is what makes the same tolerance
  // apply to it.
  test("diffSetBonuses reports a key the table has and the observation does not, as 0", () => {
    expect(diffSetBonuses(counts({ 4: 2 }), new Map()))
      .toEqual([{ key: "SPD%", table: 12, observed: 0 }]);
  });

  test("diffSetBonuses reports a key the observation has and the table does not, as 0", () => {
    expect(diffSetBonuses(new Map(), observed({ "ACC": 40 })))
      .toEqual([{ key: "ACC", table: 0, observed: 40 }]);
  });

  // Gestal stores every value as an integer x100 and we divide back down, so exact equality would
  // report float noise as a table error. 0.01 is the display precision; nothing below it is real.
  test("diffSetBonuses ignores a difference below 0.01 and reports one above it", () => {
    expect(diffSetBonuses(counts({ 4: 2 }), observed({ "SPD%": 12.005 }))).toEqual([]);
    expect(diffSetBonuses(counts({ 4: 2 }), observed({ "SPD%": 12.02 })))
      .toEqual([{ key: "SPD%", table: 12, observed: 12.02 }]);
  });

  test("diffSetBonuses reports nothing when both sides are empty", () => {
    expect(diffSetBonuses(new Map(), new Map())).toEqual([]);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 6 failures, all `TypeError: diffSetBonuses is not a function`.
- [ ] 4. Append `diffSetBonuses` to `oracle/analytics/set-bonuses.mjs`
  ```javascript
  // Where this table and an observation disagree. `observed` is a Map(key -> value) in the same key
  // space as setBonusTotals. A key present on only one side reads as 0 on the other, so a set that
  // gained or lost a stat in a patch is reported rather than skipped — and the same tolerance covers
  // it. 0.01 is the precision the game displays; below that is float noise from Gestal's x100 ints.
  export function diffSetBonuses(counts, observed) {
    const totals = setBonusTotals(counts);
    const out = [];
    for (const key of new Set([...totals.keys(), ...observed.keys()])) {
      const fromTable = totals.get(key) ?? 0;
      const fromGame = observed.get(key) ?? 0;
      if (Math.abs(fromTable - fromGame) > 0.01) {
        out.push({ key, table: fromTable, observed: fromGame });
      }
    }
    return out;
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: 36 passing, 0 failing — the full module is now covered.
- [ ] 6. Lint: `npx eslint oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs`
     Expected: no output.
- [ ] 7. Commit: `git add oracle/analytics/set-bonuses.mjs oracle/analytics/__tests__/set-bonuses.test.mjs && git commit -m "feat(analytics): diffSetBonuses compares the table against an observation"`

---

## Chunk 3: Derive the speed table

### Task 9: RED — correct the speed-set profiles

This is where the six wrong values become failing tests. Write the corrections first and watch them fail against the hand-typed table, so the fix is observed rather than assumed.

**Files:**

- Test: `oracle/analytics/__tests__/speed-sets.test.mjs`

**Steps:**

- [ ] 1. In `oracle/analytics/__tests__/speed-sets.test.mjs`, add the Killstroke row to `CLASSIC_PROFILES`, between Perception and Instinct (keeping the existing descending-percentage, 4-piece-last ordering)
  ```javascript
  const CLASSIC_PROFILES = [
    [4,  "Speed",        [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
    [34, "Divine Speed", [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
    [53, "Impulse",      [[], [12], [12], [12, 12], [12, 12], [12, 12, 12]]],
    [57, "Righteous",    [[], [10], [10], [10, 10], [10, 10], [10, 10, 10]]],
    [38, "Perception",   [[], [5],  [5],  [5, 5],   [5, 5],   [5, 5, 5]]],
    [49, "Killstroke",   [[], [5],  [5],  [5, 5],   [5, 5],   [5, 5, 5]]],
    [50, "Instinct",     [[], [],   [],   [12],     [12],     [12]]],
  ];
  ```
- [ ] 2. Replace `TIERED_PROFILES` with the corrected rows. Rows 62, 36, 65, 64 gain a 2-piece first tier; row 61 likewise. Rows 58, 66, 47, 35, 59, 63, 60 are unchanged — the diff must touch exactly five rows.
  ```javascript
  const TIERED_PROFILES = [
    [58, "Supersonic",   [[], [], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
    [62, "Pinpoint",     [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
    [36, "Deflection",   [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
    [65, "Chronophage",  [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
    [64, "Rebirth",      [[], [10], [10], [10], [10, 10], [10, 10], [10, 10], [10, 10, 12], [10, 10, 12]]],
    [66, "Mercurial",    [[], [], [8],  [8],  [8, 12],  [8, 12],  [8, 12],  [8, 12, 12],  [8, 12, 12]]],
    [47, "Protection",   [[], [], [12], [12], [12, 12], [12, 12], [12, 12], [12, 12, 8],  [12, 12, 8]]],
    [35, "Swift Parry",  [[], [8], [8], [8, 10], [8, 10], [8, 10], [8, 10], [8, 10, 10],  [8, 10, 10]]],
    [61, "Feral",        [[], [5], [5], [5], [5, 5],   [5, 5],   [5, 5],   [5, 5, 5],    [5, 5, 5]]],
    [59, "Merciless",    [[], [], [5],  [5],  [5],      [5],      [5, 5],   [5, 5],       [5, 5]]],
    [63, "Stonecleaver", [[], [], [5],  [5],  [5],      [5],      [5, 5],   [5, 5],       [5, 5]]],
    [60, "Slayer",       [[], [], [5],  [5],  [5],      [5],      [5],      [5, 5],       [5, 5]]],
  ];
  ```
- [ ] 3. Change the `SPEED_SET_IDS` length test's title and expectation from 18 to 19 (currently lines 98-99)
  ```javascript
  test("SPEED_SET_IDS covers exactly the 19 sets in the two tables", () => {
    expect(SPEED_SET_IDS).toHaveLength(19);
  ```
- [ ] 4. Run to verify RED: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: **9 failures**, specifically —
     - `classic set 49 (Killstroke)` — gets `[]` where `[5]` is expected (not in the table at all)
     - `tiered set 62 (Pinpoint)`, `36 (Deflection)`, `65 (Chronophage)`, `64 (Rebirth)`, `61 (Feral)` — each gets `[]` at a count of 2
     - `SPEED_SET_IDS covers exactly the 19 sets` — length 18
     - `the profiles above cover every id in SPEED_SET_IDS` — 49 is profiled but absent from the table
     - `every id and name agrees with the independent SETS table` — `speedSetName(49)` is `null`
     Every other test in the file still passes. **Do not proceed until the failure list matches.**
- [ ] 5. Do **not** commit yet — the suite is red. Task 10 makes it green and the two commit together.

### Task 10: GREEN — rewrite `speed-sets.mjs` to derive both tables

**Files:**

- Modify: `oracle/analytics/speed-sets.mjs`

**Steps:**

- [ ] 1. Replace the header comment of `oracle/analytics/speed-sets.mjs` (lines 1-14) with one that says the values are derived and names the six corrections
  ```javascript
  // Which artifact sets grant SPEED, and how much. Two different mechanics live here:
  //
  //   CLASSIC sets STACK. A set contributes floor(count / pieces) completions, each worth `pct`.
  //     Six pieces of Speed is three completions, +36%.
  //   TIERED (nine-slot) sets DO NOT stack. Crossing each successive threshold unlocks an ADDITIONAL
  //     bonus, and they accumulate. Nine pieces of Supersonic is 10+10+12 = 32%, not four completions.
  //
  // Accessories count toward the piece total of any set that can roll on them (35, 36, 47, 48, 58-66);
  // the classic sets here are artifact-only, so they cap at 6 pieces.
  //
  // Every set absent from both tables grants 0% speed, including all accessory-only sets (1000-1004).
  //
  // Both tables are DERIVED from set-bonuses.mjs — they are its "SPD%" view — rather than dictated
  // here. That table is generated from Gestal's set catalogue and checked against the game's own
  // per-champion set bonuses, and checking it corrected the values this file used to carry by hand,
  // for six sets:
  //
  //   Deflection (36), Feral (61), Pinpoint (62), Rebirth (64) and Chronophage (65) open their first
  //     SPD tier at TWO pieces, not three. Supersonic (58) shares their 10/10/12 payouts and really
  //     does open at three — so the old shared `T(10, 10, 12)` shorthand hid four separate errors
  //     behind one that was right.
  //   Killstroke (49) grants +5% SPD per 2-piece completion, alongside its +20% C.DMG, and was
  //     missing from the table entirely.
  //
  // Deriving is what stops that recurring: one table to correct, not two. It does not make the values
  // checkable from a vault snapshot — relic speed is per-champion, invisible to the DB and the same
  // magnitude as these bonuses, so a fit over the vault still cannot separate the two. The check is
  // against the game's own numbers, in set-bonuses.mjs.
  ```
- [ ] 2. Replace the two table literals and the `T` shorthand (currently lines 16-41) with the derivation
  ```javascript
  import { SET_BONUSES } from "./set-bonuses.mjs";

  // The one stat key this module is a view of. Not to be confused with speed-model.mjs's `SPD`, which
  // is the STAT_NAMES id 4.
  const SPD_KEY = "SPD%";

  const rows = Object.entries(SET_BONUSES);

  // The stacking sets that grant SPD. `pieces` and `pct` are all the speed model needs from a row.
  export const CLASSIC_SPEED_SETS = Object.fromEntries(
    rows.filter(([, row]) => row.kind === "stack" && SPD_KEY in row.bonus)
      .map(([id, row]) => [id, { name: row.name, pieces: row.pieces, pct: row.bonus[SPD_KEY] }]),
  );

  // The nine-slot sets with at least one SPD tier, carrying ONLY their SPD tiers. Dropping the other
  // stats' tiers is what makes firstThreshold and usefulCounts answer about SPEED: a Deflection tier
  // that grants ACC changes no speed, and must not become a piece count the solver plans around.
  export const TIERED_SPEED_SETS = Object.fromEntries(
    rows.filter(([, row]) => row.kind === "tiered" && row.tiers.some(([, bonus]) => SPD_KEY in bonus))
      .map(([id, row]) => [id, {
        name: row.name,
        tiers: row.tiers.filter(([, bonus]) => SPD_KEY in bonus)
          .map(([threshold, bonus]) => [threshold, bonus[SPD_KEY]]),
      }]),
  );
  ```
     Leave everything from `export const SPEED_SET_IDS` (line 43) to the end of the file untouched. `Object.fromEntries` produces string keys, which is what an object literal with integer keys already had, so `CLASSIC_SPEED_SETS[4]` and `Object.keys(...).map(Number)` behave exactly as before.
- [ ] 3. Run the speed-set tests to verify GREEN: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: all tests pass, 0 failing — the nine failures from Task 9 are now green.
- [ ] 4. Run the whole analytics suite: `npx vitest run oracle/analytics`
     Expected: everything passes. Two things to watch if something does fail:
     - `speed-solve` tests asserting a build's *speed* are safe; the derived tables iterate set ids in ascending numeric order where the old literals did not, and `solve` keeps the first of two equal-speed plans. So a failure on `best.plan` or `best.counts` identity (not on `best.speed`) is a tie-break reordering, not a wrong answer.
     - A failure naming set 48, 46 or 1003 would mean a non-SPD set leaked into a table — check the `SPD_KEY in bonus` filters.
- [ ] 5. Lint: `npx eslint oracle/analytics/speed-sets.mjs`
     Expected: no output.
- [ ] 6. Commit both halves together: `git add oracle/analytics/speed-sets.mjs oracle/analytics/__tests__/speed-sets.test.mjs && git commit -m "fix(analytics): derive the speed set table from set-bonuses.mjs"`

### Task 11: Guard against a one-piece SPD tier

`enumeratePlans` in `speed-solve.mjs` caps a plan at four sets, and that cap is sound only because no speed set opens below two pieces (4 × 2 = 8 ≤ 9 slots; a fifth would need 10). Nothing currently asserts the premise. This is an **invariant guard**: it cannot fail-first against a correct table, so step 2 proves it works by perturbing the table instead.

**Files:**

- Test: `oracle/analytics/__tests__/speed-sets.test.mjs`

**Steps:**

- [ ] 1. Append the guard test to the end of `oracle/analytics/__tests__/speed-sets.test.mjs`
  ```javascript
  // The solver's "at most four active sets" cap (enumeratePlans in speed-solve.mjs) is sound only
  // because no speed set opens below two pieces: four sets at two pieces is eight of the nine slots,
  // and a fifth would need ten. One-piece tiers DO exist in set-bonuses.mjs — Stone Skin's first tier
  // is a single piece — so the day a patch puts SPD% on a one-piece tier, that cap starts silently
  // discarding the best build. This makes it fail loudly instead.
  test("no speed set grants anything below two pieces, which the solver's four-set cap needs", () => {
    for (const setId of SPEED_SET_IDS) {
      expect(firstThreshold(setId), `set ${setId} (${speedSetName(setId)})`).toBeGreaterThanOrEqual(2);
    }
  });
  ```
- [ ] 2. Prove the guard actually bites. Temporarily edit `oracle/analytics/set-bonuses.mjs` and change Deflection's (id 36) first tier from `[1, { "ACC": 20 }]` to `[1, { "SPD%": 20 }]`, then run: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: the guard fails with `set 36 (Deflection): expected 1 to be greater than or equal to 2`. Other tests in the file fail too — that is fine and expected, the table is deliberately wrong right now.
- [ ] 3. Revert that edit: restore `36`'s first tier to `[1, { "ACC": 20 }]`. Confirm with `git diff oracle/analytics/set-bonuses.mjs`
     Expected: no output — the file matches the last commit.
- [ ] 4. Run to verify the guard passes against the real table: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: all tests pass, 0 failing.
- [ ] 5. Commit: `git add oracle/analytics/__tests__/speed-sets.test.mjs && git commit -m "test(analytics): guard the solver's four-set cap against a one-piece SPD tier"`

---

## Chunk 4: Stale comments and titles

No assertion in this chunk changes. One generator array gains a member — see "Decisions taken in this plan" above for why.

### Task 12: Stale wording in `speed-sets.test.mjs`

**Files:**

- Test: `oracle/analytics/__tests__/speed-sets.test.mjs`

**Steps:**

- [ ] 1. Retitle the Swift Parry test and rewrite its comment (currently lines 33-34). Five tiered sets now share its 2-piece opening, so "unlike its neighbours" is false; what is still distinctive is its *second* tier at 4. Assertions unchanged.
  ```javascript
  // Swift Parry's thresholds are 2/4/8. It shares the 2-piece opening with Deflection, Feral,
  // Pinpoint, Rebirth and Chronophage, but its SECOND tier lands at 4 where every one of theirs
  // lands at 5 — so it is still the only set on this shape.
  test("Swift Parry uses 2/4/8 thresholds", () => {
  ```
- [ ] 2. Rewrite the "Every row of both tables, pinned" comment block (currently lines 105-115). The row count moves 18 → 19, and the values are derived rather than dictated — which moves the risk rather than removing it.
  ```javascript
  // --- Every row of both tables, pinned ---------------------------------------------------------
  //
  // The tests above cover eight of the nineteen rows; these cover all of them. The values are derived
  // from set-bonuses.mjs now rather than dictated here, which relocates the risk rather than removing
  // it: a wrong SPD% in that table, or a filter here that picks the wrong tiers out of it, reaches
  // speed.mjs unchallenged, because relic speed masks these magnitudes and nothing downstream can
  // re-derive them from the vault. The most exposed row is Protection's 12 / 12 / 8, whose third tier
  // is genuinely lower than its first and so reads like a typo waiting to be "fixed".
  //
  // Each profile is speedTerms at 1, 2, 3... pieces, written out LONGHAND rather than computed from
  // the table under test. That redundancy is the point: it is a second copy that has to be edited in
  // agreement, not a read-back of the thing it is checking.
  ```
- [ ] 3. Change "dictated" to "derived" in both `test.each` titles (currently lines 145 and 149)
  ```javascript
  test.each(CLASSIC_PROFILES)("classic set %i (%s) grants its derived bonus at every count 1-6", (id, name, profile) => {
  ```
  ```javascript
  test.each(TIERED_PROFILES)("tiered set %i (%s) grants its derived bonus at every count 1-9", (id, name, profile) => {
  ```
- [ ] 4. Run to confirm nothing broke: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: all tests pass. The two `test.each` suites now report "derived" in their names.
- [ ] 5. Search `oracle/analytics/__tests__/speed-sets.test.mjs` for the words `dictated`, `eighteen` and `the 18 sets` — with the Grep tool, or `grep -n "dictated\|eighteen\|the 18 sets" oracle/analytics/__tests__/speed-sets.test.mjs`
     Expected: no matches. (`grep` exiting 1 on no match is the success case here.)
- [ ] 6. Commit: `git add oracle/analytics/__tests__/speed-sets.test.mjs && git commit -m "test(analytics): the speed-set values are derived, not dictated"`

### Task 13: Stale comments in the two solver test files

**Files:**

- Test: `oracle/analytics/__tests__/speed-solve.test.mjs`
- Test: `oracle/analytics/__tests__/speed-solve.prop.test.mjs`

**Steps:**

- [ ] 1. In `oracle/analytics/__tests__/speed-solve.test.mjs`, fix the parenthetical on line 19 — Swift Parry is no longer the only tiered set that opens at two
  ```javascript
  // slots plus 2-piece Swift Parry (35, a tiered set that opens at two pieces and rolls on accessories)
  ```
- [ ] 2. In `oracle/analytics/__tests__/speed-solve.prop.test.mjs`, drop "the usual" from the `SETS` comment (currently lines 41-44). 3/5/8 is now one shape among several rather than the default.
  ```javascript
  // Sets chosen to span every mechanic the solver has to reason about: 0 is setless; 4 and 38 are
  // classic 2-piece stackers with different values; 50 is the classic 4-piece one; 35 is tiered on
  // 2/4/8; 58 and 47 are tiered on 3/5/8 with payouts in different orders; 59 is tiered but stops
  // after two rungs.
  ```
- [ ] 3. In the same file, rewrite the `TIERED_SETS` comment and add set 62 for the new 2/5/8 shape (currently lines 54-55)
  ```javascript
  // Every THRESHOLD shape the table has: 3/5/8 (58, 47 and 66, whose payouts differ in order), 2/4/8
  // (35), 3/7 (59), and 2/5/8 (62) — the shape five sets turned out to have once the table became
  // derived from set-bonuses.mjs. A shape missing from here is a tier rung the property never
  // exercises.
  const TIERED_SETS = [58, 47, 35, 59, 66, 62];
  ```
     Leave `CHEAP_SETS` and its comment alone: "four sets whose FIRST threshold is 2" is still true of `[4, 38, 53, 35]`.
- [ ] 4. Run the property test, which is the one that can notice the generator change: `npx vitest run oracle/analytics/__tests__/speed-solve.prop.test.mjs`
     Expected: all three tests pass. The last one ("the generator reaches every state the property is supposed to cover") asserts each of five states appears more than 100 times in 2,000 samples — adding a sixth tiered set dilutes that branch, so this is the step that proves the floors still hold. If any counter drops at or below 100, note which and stop: the fix is to weight 62 in rather than extend the list, and that is a judgment call for the reviewer.
- [ ] 5. Run the deterministic solver tests too: `npx vitest run oracle/analytics/__tests__/speed-solve.test.mjs`
     Expected: all tests pass.
- [ ] 6. Commit: `git add oracle/analytics/__tests__/speed-solve.test.mjs oracle/analytics/__tests__/speed-solve.prop.test.mjs && git commit -m "test(analytics): six sets now open at two pieces, not just Swift Parry"`

---

## Chunk 5: Documentation

No TDD cycle — these are prose files with no behaviour. Verification is a read-back.

### Task 14: Dated correction note in the speed solver design doc

**Files:**

- Modify: `docs/plans/2026-08-14-champion-speed-solver-design.md`

**Steps:**

- [ ] 1. Open `docs/plans/2026-08-14-champion-speed-solver-design.md` and locate the end of the nine-slot tiered table in the `### setEffect` section — the `| Slayer | 60 | 3 / 8 | +5 / +5 | 10% |` row at line 120, followed by a blank line and then `Accessory-only sets (1000–1004) and every set not listed grant **0%**.` at line 122.
- [ ] 2. Insert this note between them — after line 120's table row and its blank line, before the "Accessory-only sets" line. Plain bold-led paragraph, matching the `⚠️ **Suspected, not confirmed** (2026-08-15)` style used elsewhere in these docs; the file uses no blockquotes.
  ```markdown
  **Correction (2026-10-03).** Both tables above are now **derived** from
  `oracle/analytics/set-bonuses.mjs`, a full-stat set-bonus table generated from Gestal Desktop's set
  catalogue and verified against the game's own per-champion set bonuses — 532 of 532 geared champions
  on a 2026-09-29 capture. That check corrected six sets the values above get wrong:

  - **Deflection (36), Pinpoint (62), Rebirth (64) and Chronophage (65) are 2 / 5 / 8**, not 3 / 5 / 8.
    Supersonic (58), which shares their row above and their +10 / +10 / +12 payouts, really is
    3 / 5 / 8 — sharing the row is what hid four separate errors behind one correct value.
  - **Feral (61) is 2 / 5 / 8**, not 3 / 5 / 8.
  - **Killstroke (49)** is a classic 2-piece stacker worth **+5%** per completion, and was missing from
    the classic table entirely.

  The tables above are left as written, as the record of what was believed at design time.
  ```
- [ ] 3. Verify the note landed inside the `### setEffect` section and before the "Accessory-only sets" line. Search `docs/plans/2026-08-14-champion-speed-solver-design.md` for `setEffect`, `Correction (2026-10-03)` and `Accessory-only sets` — with the Grep tool, or `grep -n "Correction (2026-10-03)\|Accessory-only sets\|setEffect" docs/plans/2026-08-14-champion-speed-solver-design.md`
     Expected: the `### \`setEffect\`` heading comes first, then `Correction (2026-10-03)`, then `Accessory-only sets`, in ascending line order.
- [ ] 4. Commit: `git add docs/plans/2026-08-14-champion-speed-solver-design.md && git commit -m "docs(analytics): record the six corrected set-bonus values"`

### Task 15: Changelog entries

Beyond the issue's literal list — see "Decisions taken in this plan". Drop this task if the reviewer prefers.

**Files:**

- Modify: `CHANGELOG.md`

**Steps:**

- [ ] 1. In `CHANGELOG.md`, replace the empty `## [Unreleased]` heading (line 8) with the heading plus two sections, in Keep a Changelog order (Added before Fixed)
  ```markdown
  ## [Unreleased]

  ### Added

  - Add `oracle/analytics/set-bonuses.mjs`: every artifact set's bonus for every stat, generated from Gestal Desktop's set catalogue and verified against the game's own per-champion set bonuses for all 532 geared champions on a 2026-09-29 capture. `speed-sets.mjs` is now the SPD-only view of it rather than a second hand-typed table (#41)

  ### Fixed

  - Correct the set-bonus values `speed.mjs` solves against: Deflection, Feral, Pinpoint, Rebirth and Chronophage grant their first SPD tier at two pieces rather than three, and Killstroke (+5% SPD per 2-piece completion) was missing from the table entirely. Builds using any of those six sets were under-valued (#41)
  ```
- [ ] 2. Verify the `[0.3.0]` section below is untouched: `git diff CHANGELOG.md`
     Expected: an addition of 8 lines under `## [Unreleased]` and no other change.
- [ ] 3. Commit: `git add CHANGELOG.md && git commit -m "docs: changelog for the full-stat set bonus table"`

---

## Chunk 6: Full gate

### Task 16: Run the whole pre-commit gate

`CLAUDE.md` requires `npm run build && npm test && npm run lint` before every commit; there are no git hooks. Run the three separately so a failure names itself.

**Files:** none

**Steps:**

- [ ] 1. Build: `npm run build`
     Expected: exits 0. `core` then `cli` then `web`, in that order.
- [ ] 2. Full test suite: `npm test`
     Expected: every test passes. The count should be **38 above** the pre-change baseline recorded in Task 0 step 3: 36 from the new `set-bonuses.test.mjs`, plus the `firstThreshold >= 2` guard, plus one extra `test.each` case for the Killstroke profile row.
     **Known pre-existing macOS failure:** `oracle/battlelogs/__tests__/capture.test.mjs` — "a copy failure that is not an eviction still propagates" expects `EISDIR` and gets `ENOTSUP`. This fails on `main` too and passes on Linux CI. If it is the only failure, that is not a regression; confirm it also failed in Task 0 step 3.
- [ ] 3. Lint: `npm run lint`
     Expected: no output (exit 0).
- [ ] 4. Confirm nothing is left uncommitted: `git status --short`
     Expected: no output. Anything listed under `.hivemind/` is gitignored and will not appear.
- [ ] 5. Review the full branch diff against `main` for scope creep: `git diff main --stat`
     Expected: exactly the nine files in the File Structure table, and no others.

---

## Acceptance Criteria Traceability

| Issue criterion | Task(s) |
|---|---|
| `set-bonuses.mjs` exports `SET_BONUSES` (41 rows), `NO_STAT_SETS` (28 ids), `setCounts`, `setBonusTerms`, `setBonusTotals`, `diffSetBonuses` with the described semantics | 2, 3, 5, 6, 7, 8 |
| Its header records provenance, the 532/532 verification, the category mapping including `1-set`, and the Lore of Steel note | 2 step 1 |
| `speed-sets.mjs` derives both tables from `SET_BONUSES`; 19 ids; the five tiered sets open at 2; Killstroke is classic `{pieces: 2, pct: 5}`; no other row changes | 9, 10 |
| Its header says the values are derived and names the six corrections | 10 step 1 |
| `speed-model.mjs` re-exports `setCounts` instead of defining it | 4 |
| `speed-sets.test.mjs` carries the corrected profiles, the Killstroke row, the 19-id count, the `firstThreshold >= 2` guard and the retitled Swift Parry test | 9, 11, 12 |
| Stale comments updated in all three test files | 12, 13 |
| `set-bonuses.test.mjs` covers every case in Change 5 | 1, 3, 5, 6, 7, 8 |
| The speed design doc carries the dated correction note | 14 |
| `npm run build`, `npm test`, `npm run lint` pass | 16 |

## Out of Scope

Per the issue: applying Lore of Steel, the champion stat model, and anything about power — all separate follow-up issues that build on this module. `power.mjs verify`, named in the header comment as the guard against patch drift, is one of them and is **not** created here. `speed.mjs verify` is deliberately left alone: `oracle/analytics/README.md` already records that it is not a patch detector.

`speed.mjs` output changes for any build using the six corrected sets. That is the intended fix, not a regression.
