# power.mjs --glyph Implementation Plan

**Goal:** Add `power.mjs --glyph <grade>`, which re-solves a champion's gear with every glyphable substat holding the cap of a chosen glyph grade, and prints the result as a second block under the plain BEST.

**Architecture:** A new pure module `oracle/analytics/glyphs.mjs` owns the five grades, their display labels, the per-grade per-stat caps, and a vault lift (`liftVault`) that returns a copy of every item with its glyphable substats' `glyph` raised to the grade's cap. Because `champion-stats.mjs`'s `itemEntries` already reads a substat as `value + glyph`, a lifted item is simply a better item — so **neither solver changes**: `power.mjs` lifts the pool and runs the existing `solvePower` / `solvePowerExact` over it. Three new pure formatters in `power.mjs` (`formatGlyphGain`, `liftDelta`, `formatLift`) and one new optional argument on `printBuild` produce the block; a `printGlyphBlock` function assembles it. The block is guaranteed never below the plain BEST by re-scoring BEST's own pieces in their lifted versions and reporting whichever build scores higher.

**Tech Stack:** Plain Node ESM (`.mjs`, no transpile, no imports in `glyphs.mjs`), Vitest 3 (`npx vitest run`), ESLint 9 flat config, npm workspaces monorepo.

---

## File Structure

| File | Action | Single responsibility |
| --- | --- | --- |
| `oracle/analytics/glyphs.mjs` | **Create** | The glyph grade tables and the pure vault lift. No I/O, no imports. |
| `oracle/analytics/__tests__/glyphs.test.mjs` | **Create** | Tests for `glyphs.mjs` only. |
| `oracle/analytics/power.mjs` | **Modify** | `--glyph` parsing, the three pure glyph formatters, `printBuild`'s `linesById`, and `printGlyphBlock`. |
| `oracle/analytics/__tests__/power-cli.test.mjs` | **Modify** | `--glyph` parser tests, pure-formatter tests, and the end-to-end glyph tests. |
| `oracle/analytics/README.md` | **Modify** | The `power.mjs` entry's run line and one `--glyph` paragraph. |
| `CHANGELOG.md` | **Modify** | One `[minor]` line under `## [Unreleased]` → `### Added`. |

No other file changes. In particular: `speed.mjs` and `speed-model.mjs` are untouched (explicitly out of scope), `power-solve.mjs` is untouched (a lifted item needs no solver change), and `docs/plans/2026-10-03-champion-power-design.md` is untouched (#47 left it as a frozen record and this issue does not ask for an edit).

---

## Design decisions settled here

The issue leaves seven details open. Each is settled below so no step requires a judgement call.

1. **Indentation lives in the formatter.** Every existing formatter in `power.mjs` embeds its own leading spaces (`formatGain` and `formatOffBest` use 2; `formatCertificate`, `formatTotals` and `printBuild`'s piece lines use 4). So:
   - `formatGlyphGain` embeds **2 spaces** (`  WITH 6★ Epic GLYPHS  …`), matching `formatGain`.
   - `formatLift` embeds **6 spaces** (`      glyph SPD 0→12  (+0.26)`), one level deeper than the 4-space piece line it sits under.
   - `glyphs to apply: N` is printed by `printGlyphBlock` at **4 spaces**, the same level as `sets:` and `totals:`.
   - `printBuild`'s `linesById` loop adds **no** indent of its own — it `console.log`s each line verbatim, exactly as it already does for `formatTotals`.
2. **The grade is validated inside the parser loop**, as `--power` and `--top` validate via `positiveInt`. Consequence, stated plainly: `power.mjs fit Elhain --glyph bogus` reports the unknown grade, not the wrong mode. That matches `--top`'s existing precedent (`fit Elhain --top 0` reports "needs a positive integer" before any mode check), so it is the consistent choice. The mode refusal goes after the loop, beside the two `--exact` refusals.
3. **`formatGlyphGain` mirrors `formatGain`'s zero guard**, on `bestLin` (the denominator). Without it, `bestLin = 0` would print `+0.0%` for a lift that is in fact an infinite improvement — the exact failure `formatGain:242-248` exists to avoid.
4. **`liftItem` copies shallowly:** `{ ...item, substats: newArray }`, with each *raised* substat a new `{ ...s, glyph: cap }` and each *unchanged* substat the **same object reference**. This satisfies "the input item is never mutated" with the smallest possible number of new objects.
5. **`glyphs.mjs`'s key table is a second table that must agree with `champion-stats.mjs`'s `itemKey`**, which is module-private there and cannot be imported. A header comment says so. Unlike `itemKey`, an unknown stat id is **not** refused — it is simply not glyphable.
6. **`liftDelta` uses `linearizedWeights(weights, 0, 0)`** per the issue, read as a plain per-stat scalar table rather than as a linearization. At that reference its `C.RATE` scalar is `k * 100`, not 0 — harmless only because `lift.key` is never a crit key. A comment says so and names `nonCritWeights` as the function to reach for if that ever changes.
7. **The reported glyph build is `{ items, totals, lin }`**, the same shape `solvePower` returns, so `printBuild`, `formatOffBest` and `formatCertificate` all read it unchanged. The "never below the plain BEST" floor is built from `buildTotals` + `lin` directly.

**Known test-coverage limit (carry forward as a concern):** on the issue's fixture the lifted solve always wins, so the floor branch of "never below the plain BEST" is implemented and commented but *not* exercised by a test. Constructing a vault where a lift reorders the candidate ranking is outside the issue's test list. The comparison is a monotonicity guarantee, not a path the fixture reaches.

---

## Chunk 1 — `glyphs.mjs`

### Task 1: Build the project once, then pin the three constant tables

`npm run build` is a **one-time prerequisite**: `packages/core/dist` does not exist in a fresh worktree, and `power.mjs` imports `@rslh/core`, so `power-cli.test.mjs` fails to import for reasons unrelated to this change until the build runs. `glyphs.test.mjs` itself needs no build (`glyphs.mjs` imports nothing).

**Files:**

- Test: `oracle/analytics/__tests__/glyphs.test.mjs`
- Create: `oracle/analytics/glyphs.mjs`

**Steps:**

- [ ] 1. Build the workspace so `@rslh/core` resolves: `npm run build`
     Expected: three builds succeed (core, cli, web), exit 0.
- [ ] 2. Confirm the existing suite is green before any change: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass, exit 0. Note the reported count — it is the baseline every later task adds to.
- [ ] 3. Create `oracle/analytics/__tests__/glyphs.test.mjs` with the file header, the two fixture factories and the first three tests. The tables are written **longhand** rather than read back off the module, so a transposed row or a swapped `HP`/`HP%` names itself here.

  The import list carries **only the three tables**. Each later task extends it as it adds the
  export it needs — a named import of something the module does not export yet is its own failure,
  and keeping the list honest means every task's RED is a failure of the thing that task adds.

  ```javascript
  // oracle/analytics/__tests__/glyphs.test.mjs
  import { test, expect } from "vitest";
  import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS } from "../glyphs.mjs";

  // The Item shape both snapshot readers produce (gestal.mjs's gestalItem and decode.mjs's
  // decodeRow), cut down to what this module reads. `rank` is the RAW 1-6 star level, which is what
  // the rank rule tests against; `rarity` is 0-indexed and this module never reads it.
  const sub = (statId, value, glyph = 0, isFlat = false) =>
    ({ statId, isFlat, rolls: 0, value, glyph });
  const item = (o = {}) => ({
    id: 1, slot: 4, set: 4, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
    mainStat: { statId: 4, isFlat: true, value: 30 }, substats: [], ascStat: null,
    ascLevel: -1, equippedChampId: 0, ...o,
  });

  // --- the tables -----------------------------------------------------------------------

  // INCREASING order, which is what makes "at most a 5★ glyph" a meaningful sentence and what a
  // reader of the usage line assumes. A reordered list would silently change nothing about the
  // caps and everything about how the option reads.
  test("GLYPH_GRADES is the five grades in increasing order", () => {
    expect(GLYPH_GRADES).toEqual(["5", "normal", "rare", "epic", "legendary"]);
  });

  // "5 glyphs" in a headline would be read as a count, which is the whole reason a grade is never
  // printed raw.
  test("GLYPH_LABELS names a star level and a rarity for every grade", () => {
    expect(GLYPH_LABELS).toEqual({
      "5": "5★",
      normal: "6★ Normal",
      rare: "6★ Rare",
      epic: "6★ Epic",
      legendary: "6★ Legendary",
    });
  });

  // Written out longhand, the same way power-solve.test.mjs pins linearizedWeights: these are
  // measured game data, so reading them back off the module would assert nothing at all.
  test("GLYPH_CAPS holds the tops of each grade's roll ranges", () => {
    expect(GLYPH_CAPS).toEqual({
      "5": { HP: 475, ATK: 25, DEF: 25, "HP%": 5, "ATK%": 5, "DEF%": 5, SPD: 5, RES: 10, ACC: 10 },
      normal: { HP: 750, ATK: 40, DEF: 40, "HP%": 8, "ATK%": 8, "DEF%": 8, SPD: 8, RES: 16,
        ACC: 16 },
      rare: { HP: 850, ATK: 45, DEF: 45, "HP%": 9, "ATK%": 9, "DEF%": 9, SPD: 9, RES: 18,
        ACC: 18 },
      epic: { HP: 950, ATK: 50, DEF: 50, "HP%": 10, "ATK%": 10, "DEF%": 10, SPD: 10, RES: 20,
        ACC: 20 },
      legendary: { HP: 1150, ATK: 60, DEF: 60, "HP%": 12, "ATK%": 12, "DEF%": 12, SPD: 12, RES: 24,
        ACC: 24 },
    });
  });
  ```

- [ ] 4. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: the whole file fails to load with `Failed to resolve import "../glyphs.mjs"` — the module does not exist yet.
- [ ] 5. Create `oracle/analytics/glyphs.mjs` with its header comment and the three tables only. Nothing else yet.

  ```javascript
  // Glyph caps: what one substat could hold if a glyph of a chosen GRADE were applied to it.
  //
  // power.mjs values every piece with the glyphs it already carries — champion-stats.mjs's
  // itemEntries adds each substat's `glyph` to its value — so it cannot answer "what could this
  // champion reach if its gear were glyphed?". This module lifts a vault to a grade's caps, and the
  // solvers then run over it unchanged: a glyphed item is just a better item.
  //
  // A GRADE, NOT A NUMBER. speed.mjs's --glyph takes a raw number, which works because it values
  // one stat. Across all nine glyphable stats one number cannot: a SPD glyph tops out at 12 and a
  // flat HP one at 1,150. A grade — "every glyphable substat holds the cap of a 6★ Epic glyph" — is
  // an assumption a reader can state and control.
  //
  // PROVENANCE OF THE CAPS. The four 6★ rows are the TOPS of the 6★ roll ranges the account owner
  // gave, for Normal, Rare, Epic and Legendary in that order:
  //
  //   SPD and HP%/ATK%/DEF%     3-8,     4-9,     5-10,     7-12
  //   RES and ACC               6-16,    8-18,    10-20,    14-24
  //   ATK and DEF               30-40,   35-45,   40-50,    45-60
  //   HP                        250-750, 350-850, 450-950,  650-1150
  //
  // The 5★ row is the largest glyph the 2026-09-29 capture holds on any 5★ item, which the account
  // owner confirmed is the 5★ maximum. That capture agrees with both halves: its largest 6★ values
  // are SPD 12, % 12 and RES/ACC 24, and none exceeds a range. There are no Mythical glyphs.
  //
  // NOT VAULT CEILINGS, which is what speed-model.mjs's glyphCeilings records. Those maxima are
  // uneven across rarities — on the 2026-09-29 capture Epic 6★ pieces top out at DEF% 12 while
  // Legendary ones top out at 10 — because they record what was APPLIED, not what a grade can roll.
  //
  // THE RANK RULE. A 6★ item takes the grade asked for. A 5★ item takes at most a 5★ glyph, so it
  // gets the "5" row whatever was asked. Anything below 5★ is never lifted at all.
  //
  // THE CRIT RULE. Glyphs never touch crit. On the 2026-09-29 capture none of the 5,515 C.RATE and
  // C.DMG substats carries a glyph, and neither does any damage-type substat. So a lift only ever
  // adds to the LINEAR part of the power objective, which is what makes power.mjs's per-lift value
  // exact and additive across lifts.
  //
  // SUBSTATS ONLY. The main stat and the ascension stat are never lifted, since glyphs only ever
  // apply to substats — see speed-model.mjs's itemSpeed, where ASCGV and mgv are 0 in all 8474 rows
  // of the 2026-08-12 snapshot.
  //
  // NOT weights.mjs's GLYPH_THRESHOLDS, despite the name. That one is triage's test for whether a
  // piece is "highly glyphed" ALREADY: it reads applied glyphs and excludes flat HP/ATK/DEF. These
  // are per-grade ceilings over every glyphable stat. The two answer different questions and are
  // deliberately separate.
  //
  // Pure arithmetic on the Item shape, and it imports nothing.

  // In INCREASING order. "5" is a 5★ glyph; the other four are 6★ glyphs by rarity.
  export const GLYPH_GRADES = ["5", "normal", "rare", "epic", "legendary"];

  // Display labels. A headline reading "5 glyphs" would be read as a count, which is why a grade is
  // never printed raw.
  export const GLYPH_LABELS = {
    "5": "5★",
    normal: "6★ Normal",
    rare: "6★ Rare",
    epic: "6★ Epic",
    legendary: "6★ Legendary",
  };

  // grade -> key -> the largest value that grade can roll. The keys are champion-stats.mjs's
  // itemEntries key space, and the values are in the same display units as a substat's `glyph`
  // field: whole numbers for flat stats, percentage POINTS for a "%" key (12 means +12%).
  //
  // Written LONGHAND rather than derived from the groups that happen to share a number today. SPD
  // and HP% agreeing at every grade is a fact about the current game, not a constraint, and a
  // derived table would silently paper over the patch that separates them.
  export const GLYPH_CAPS = {
    "5":       { HP: 475,  ATK: 25, DEF: 25, "HP%": 5,  "ATK%": 5,  "DEF%": 5,  SPD: 5,  RES: 10, ACC: 10 },
    normal:    { HP: 750,  ATK: 40, DEF: 40, "HP%": 8,  "ATK%": 8,  "DEF%": 8,  SPD: 8,  RES: 16, ACC: 16 },
    rare:      { HP: 850,  ATK: 45, DEF: 45, "HP%": 9,  "ATK%": 9,  "DEF%": 9,  SPD: 9,  RES: 18, ACC: 18 },
    epic:      { HP: 950,  ATK: 50, DEF: 50, "HP%": 10, "ATK%": 10, "DEF%": 10, SPD: 10, RES: 20, ACC: 20 },
    legendary: { HP: 1150, ATK: 60, DEF: 60, "HP%": 12, "ATK%": 12, "DEF%": 12, SPD: 12, RES: 24, ACC: 24 },
  };
  ```

- [ ] 6. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 3 tests pass, output clean.
- [ ] 7. Commit: `git add oracle/analytics/glyphs.mjs oracle/analytics/__tests__/glyphs.test.mjs && git commit -m "feat(analytics): add glyphs.mjs grade, label and cap tables"`

---

### Task 2: `itemGrade` — which grade's caps apply to one item

**Files:**

- Test: `oracle/analytics/__tests__/glyphs.test.mjs`
- Modify: `oracle/analytics/glyphs.mjs`

**Steps:**

- [ ] 1. Extend the import at the top of `oracle/analytics/__tests__/glyphs.test.mjs` to pull in `itemGrade`:

  ```javascript
  import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS, itemGrade } from "../glyphs.mjs";
  ```

- [ ] 2. Append the `itemGrade` test section to the **end** of `oracle/analytics/__tests__/glyphs.test.mjs`.

  ```javascript
  // --- itemGrade ------------------------------------------------------------------------

  test("a 6★ item takes the grade that was asked for", () => {
    expect(itemGrade(item({ rank: 6 }), "epic")).toBe("epic");
    expect(itemGrade(item({ rank: 6 }), "5")).toBe("5");
  });

  // A 5★ item cannot hold a 6★ glyph, so asking for one has to come back as the 5★ row rather than
  // as the grade requested. Returning `grade` here would invent a glyph the item cannot carry,
  // which is the one wrong answer that looks right.
  test("a 5★ item takes at most a 5★ glyph whatever grade was asked for", () => {
    expect(itemGrade(item({ rank: 5 }), "legendary")).toBe("5");
    expect(itemGrade(item({ rank: 5 }), "normal")).toBe("5");
  });

  // Below 5★ nothing is lifted at all — the issue puts those items out of scope, and `null` is what
  // liftItem reads as "leave this piece exactly as it is".
  test("an item below 5★ takes no glyph at all", () => {
    expect(itemGrade(item({ rank: 4 }), "legendary")).toBe(null);
    expect(itemGrade(item({ rank: 1 }), "5")).toBe(null);
  });

  // A grade the table does not know is a caller bug — the CLI validates before it ever gets here —
  // and defaulting would lift a whole vault by a table nobody chose.
  test("an unknown grade is refused rather than defaulted", () => {
    expect(() => itemGrade(item(), "mythical"))
      .toThrow(/glyphs: unknown grade "mythical" — use one of 5, normal, rare, epic, legendary/);
    expect(() => itemGrade(item(), "6")).toThrow(/unknown grade "6"/);
    expect(() => itemGrade(item(), undefined)).toThrow(/unknown grade/);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: the 4 new tests fail. The message is either `does not provide an export named 'itemGrade'` (whole file fails to link) or `TypeError: itemGrade is not a function` (per test), depending on how Vite resolves the missing export — either is the right RED, and the three table tests must still pass if the file links.
- [ ] 4. Append the key table and `itemGrade` to `oracle/analytics/glyphs.mjs`, after `GLYPH_CAPS`.

  ```javascript
  // Item stat id -> the key its glyph is capped under, or null for a stat no glyph can touch.
  //
  // These are OUR item stat ids (STAT_NAMES order), and the mapping is champion-stats.mjs's itemKey
  // restricted to the glyphable ones: 1/2/3 take a flat or a percent key from `isFlat`, and 4, 7
  // and 8 are flat stats with one key each. itemKey is module-private there, so this is a SECOND
  // table that has to AGREE with it — if its mapping ever changes, this one changes with it.
  //
  // 5 (C.RATE), 6 (C.DMG) and 11-18 (the damage-type substats) fall through to null, which is THE
  // CRIT RULE in the header. Unlike itemKey, an id this table does not know is NOT refused: lifting
  // is advisory, so an unrecognised substat is simply left alone, while the stat model that has to
  // total it is the right place to refuse to guess.
  const SCALED_GLYPHABLE = { 1: "HP", 2: "ATK", 3: "DEF" };
  const FLAT_GLYPHABLE = { 4: "SPD", 7: "RES", 8: "ACC" };

  function glyphKey(stat) {
    const scaled = SCALED_GLYPHABLE[stat.statId];
    if (scaled) return stat.isFlat ? scaled : `${scaled}%`;
    return FLAT_GLYPHABLE[stat.statId] ?? null;
  }

  // Which grade's caps apply to one item, or null for an item no glyph is assumed on. See THE RANK
  // RULE in the header.
  //
  // `>= 6` rather than `=== 6` so a rank above 6 would take the grade asked for rather than being
  // silently skipped; on today's 1-6 domain the two are the same answer.
  //
  // An unknown grade THROWS rather than defaulting, because every caller has a grade the CLI parser
  // already validated — so reaching here with a bad one is a bug, and answering anyway would lift a
  // whole vault by a table nobody chose. The message is module-prefixed because this audience is a
  // developer; parsePowerArgs has its own user-facing wording for the same mistake.
  export function itemGrade(item, grade) {
    if (!GLYPH_GRADES.includes(grade)) {
      throw new Error(`glyphs: unknown grade "${grade}"`
        + ` — use one of ${GLYPH_GRADES.join(", ")}`);
    }
    if (item.rank >= 6) return grade;
    if (item.rank === 5) return "5";
    return null;
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 7 tests pass.
- [ ] 6. Commit: `git add oracle/analytics/glyphs.mjs oracle/analytics/__tests__/glyphs.test.mjs && git commit -m "feat(analytics): add glyphs.mjs itemGrade with the rank rule"`

---

### Task 3: `liftItem` — every glyphable substat rises to its cap

**Files:**

- Test: `oracle/analytics/__tests__/glyphs.test.mjs`
- Modify: `oracle/analytics/glyphs.mjs`

**Steps:**

- [ ] 1. Extend the import at the top of `oracle/analytics/__tests__/glyphs.test.mjs` to pull in `liftItem`:

  ```javascript
  import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS, itemGrade, liftItem } from "../glyphs.mjs";
  ```

- [ ] 2. Append the three `liftItem` tests to the **end** of `oracle/analytics/__tests__/glyphs.test.mjs`.

  ```javascript
  // --- liftItem: what rises -------------------------------------------------------------

  // All nine glyphable keys in one item, so a transposed cap row names itself. HP appears TWICE,
  // flat and percent, because they share a statId and differ only by `isFlat` — a lift that read
  // the flat cap for a percent substat would write 1150 where 12 belongs, which is a 95x error
  // that still looks like a number.
  test("every glyphable substat rises to its cap for the grade", () => {
    const it = item({ substats: [
      sub(1, 500, 0, true),    // HP flat   -> 1150
      sub(1, 5, 0, false),     // HP%       -> 12
      sub(2, 200, 0, true),    // ATK flat  -> 60
      sub(2, 5, 0, false),     // ATK%      -> 12
      sub(3, 200, 0, true),    // DEF flat  -> 60
      sub(3, 5, 0, false),     // DEF%      -> 12
      sub(4, 10, 0, true),     // SPD       -> 12
      sub(7, 20, 0, true),     // RES       -> 24
      sub(8, 20, 0, true),     // ACC       -> 24
    ] });
    const { item: lifted, lifts } = liftItem(it, "legendary");
    expect(lifted.substats.map((s) => s.glyph))
      .toEqual([1150, 12, 60, 12, 60, 12, 12, 24, 24]);
    expect(lifts.map((l) => l.key))
      .toEqual(["HP", "HP%", "ATK", "ATK%", "DEF", "DEF%", "SPD", "RES", "ACC"]);
  });

  // The grade chooses the row, so the same item lifts to different numbers. A 5★ item takes the
  // "5" row through itemGrade whatever was asked, which is the rank rule reaching liftItem.
  test("the grade chooses the cap row, and a 5★ item is capped at the 5★ row", () => {
    const it = item({ substats: [sub(4, 10, 0, true)] });
    expect(liftItem(it, "epic").item.substats[0].glyph).toBe(10);
    expect(liftItem(it, "normal").item.substats[0].glyph).toBe(8);
    expect(liftItem(item({ rank: 5, substats: [sub(4, 10, 0, true)] }), "legendary")
      .item.substats[0].glyph).toBe(5);
  });

  // `from` and `to` are what the CLI prints and what its per-lift value is computed from, so a
  // lift that reported the wrong `from` would print the right arrow and the wrong worth.
  test("lifts record each raised substat's old and new glyph, in substat order", () => {
    const it = item({ substats: [sub(4, 10, 3, true), sub(7, 20, 0, true)] });
    expect(liftItem(it, "epic").lifts).toEqual([
      { key: "SPD", from: 3, to: 10 },
      { key: "RES", from: 0, to: 20 },
    ]);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: the 3 new tests fail — either `does not provide an export named 'liftItem'` or `TypeError: liftItem is not a function`, as in Task 2.
- [ ] 4. Append `liftItem` to `oracle/analytics/glyphs.mjs`, after `itemGrade`.

  ```javascript
  // One item as it would be with a glyph of `grade` on every glyphable substat, plus the lifts that
  // took. The cap is a FLOOR: a substat already glyphed at or above it keeps what it has and is not
  // listed, so the lift is never a downgrade for a piece.
  //
  // The input is never mutated. An item with nothing to lift comes back AS ITSELF rather than as a
  // copy, and that identity matters: power-solve.mjs keys its per-item stat vectors by object
  // IDENTITY, so the fewer new objects a lift makes, the fewer places a caller can hand the solver
  // a piece its caches have never seen.
  export function liftItem(item, grade) {
    const applicable = itemGrade(item, grade);
    if (applicable === null) return { item, lifts: [] };
    const caps = GLYPH_CAPS[applicable];
    const lifts = [];
    const substats = item.substats.map((s) => {
      const key = glyphKey(s);
      if (key === null) return s;
      // `!(cap > s.glyph)` rather than a Math.max, because the same test decides both the new value
      // and whether there is a lift to list. It also leaves the substat alone for a key this table
      // somehow lacks, where a Math.max would write undefined into the glyph.
      const cap = caps[key];
      if (!(cap > s.glyph)) return s;
      lifts.push({ key, from: s.glyph, to: cap });
      return { ...s, glyph: cap };
    });
    if (lifts.length === 0) return { item, lifts: [] };
    return { item: { ...item, substats }, lifts };
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 10 tests pass.
- [ ] 6. Commit: `git add oracle/analytics/glyphs.mjs oracle/analytics/__tests__/glyphs.test.mjs && git commit -m "feat(analytics): add glyphs.mjs liftItem for the glyphable substats"`

---

### Task 4: `liftItem` — what it must leave alone

**Files:**

- Test: `oracle/analytics/__tests__/glyphs.test.mjs`

This task is tests only. `liftItem` as written in Task 3 already satisfies them, so each test must be **run and watched to pass for the right reason** — and to prove each is not vacuous, step 2 mutates the implementation to watch it fail first.

**Steps:**

- [ ] 1. Append the "left alone" tests to the **end** of `oracle/analytics/__tests__/glyphs.test.mjs`.

  ```javascript
  // --- liftItem: what it leaves alone ---------------------------------------------------

  // THE CRIT RULE. No C.RATE or C.DMG substat in the vault carries a glyph, and the whole per-lift
  // value in power.mjs is exact only because a lift never touches the one non-linear term in the
  // objective. A crit lift here would silently make that value wrong.
  test("C.RATE, C.DMG and a damage-type substat are never lifted", () => {
    const it = item({ substats: [sub(5, 20, 0, false), sub(6, 60, 0, false), sub(11, 5, 0, false)] });
    const { item: lifted, lifts } = liftItem(it, "legendary");
    expect(lifted.substats.map((s) => s.glyph)).toEqual([0, 0, 0]);
    expect(lifts).toEqual([]);
  });

  // A glyph already above the grade's cap is the reader's own better glyph. Lowering it would turn
  // a block headed "what glyphing would add" into a downgrade, and listing it as a lift would ask
  // for a glyph that is already on.
  test("an existing glyph above the cap stays, and is not listed as a lift", () => {
    const it = item({ substats: [sub(4, 10, 12, true)] });
    const { item: lifted, lifts } = liftItem(it, "epic");   // epic's SPD cap is 10
    expect(lifted.substats[0].glyph).toBe(12);
    expect(lifts).toEqual([]);
    // Nothing rose, so the item comes back AS ITSELF — which is what keeps power-solve's
    // identity-keyed caches valid for an unlifted piece.
    expect(lifted).toBe(it);
  });

  // A glyph exactly AT the cap is the boundary between the two tests above. It must not be listed,
  // or the CLI would print "glyph SPD 10→10  (+0)" and a glyph count that overstates the work.
  test("a glyph exactly at the cap is not a lift", () => {
    const it = item({ substats: [sub(4, 10, 10, true)] });
    expect(liftItem(it, "epic").lifts).toEqual([]);
    expect(liftItem(it, "epic").item).toBe(it);
  });

  // SUBSTATS ONLY. Glyphs only ever apply to substats — see speed-model.mjs's itemSpeed — so a main
  // or ascension stat lifted here would invent a stat the game cannot give.
  test("the main stat and the ascension stat are untouched", () => {
    const it = item({
      mainStat: { statId: 4, isFlat: true, value: 30 },
      substats: [sub(4, 10, 0, true)],
      ascStat: { statId: 7, isFlat: true, value: 20 },
    });
    const { item: lifted } = liftItem(it, "legendary");
    expect(lifted.mainStat).toEqual({ statId: 4, isFlat: true, value: 30 });
    expect(lifted.ascStat).toEqual({ statId: 7, isFlat: true, value: 20 });
  });

  // The id is how every caller finds a lifted piece again — power.mjs maps the worn gear's ids
  // through the lifted pool — and the rest of the fields are what the solver and the printer read.
  test("the lifted copy keeps the id and every other field", () => {
    const it = item({ id: 77, slot: 5, set: 12, level: 16, faction: 3, equippedChampId: 100,
      substats: [sub(4, 10, 0, true)] });
    const { item: lifted } = liftItem(it, "legendary");
    expect(lifted.id).toBe(77);
    expect(lifted).toMatchObject({ slot: 5, set: 12, rank: 6, rarity: 5, level: 16, faction: 3,
      isAccessory: false, ascLevel: -1, equippedChampId: 100 });
  });

  // The vault is read once and solved twice, plain and lifted, so a mutating lift would make the
  // plain BEST printed above the block disagree with the build it was computed from.
  test("the input item is never mutated", () => {
    const it = item({ substats: [sub(4, 10, 3, true)] });
    liftItem(it, "legendary");
    expect(it.substats[0].glyph).toBe(3);
    expect(it.substats).toHaveLength(1);
  });

  // Below 5★ nothing is lifted, so the whole item comes back untouched and by identity.
  test("an item below 5★ comes back as itself with no lifts", () => {
    const it = item({ rank: 4, substats: [sub(4, 10, 0, true)] });
    const { item: lifted, lifts } = liftItem(it, "legendary");
    expect(lifted).toBe(it);
    expect(lifts).toEqual([]);
  });
  ```

- [ ] 2. Prove the new tests are not vacuous. Temporarily break `glyphs.mjs`'s `glyphKey` so crit becomes glyphable — change `const FLAT_GLYPHABLE = { 4: "SPD", 7: "RES", 8: "ACC" };` to `const FLAT_GLYPHABLE = { 4: "SPD", 5: "SPD", 7: "RES", 8: "ACC" };` — then run `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: `C.RATE, C.DMG and a damage-type substat are never lifted` fails, reporting glyph `12` where `0` was expected.
- [ ] 3. Revert that one-character mutation: restore `const FLAT_GLYPHABLE = { 4: "SPD", 7: "RES", 8: "ACC" };`
- [ ] 4. Prove the floor test is not vacuous. Temporarily change `liftItem`'s `if (!(cap > s.glyph)) return s;` to `if (cap === s.glyph) return s;` and run `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: `an existing glyph above the cap stays, and is not listed as a lift` fails, reporting glyph `10` where `12` was expected.
- [ ] 5. Revert that mutation: restore `if (!(cap > s.glyph)) return s;`
- [ ] 6. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 17 tests pass, output clean.
- [ ] 7. Commit: `git add oracle/analytics/__tests__/glyphs.test.mjs && git commit -m "test(analytics): pin what glyphs.mjs liftItem must leave alone"`

---

### Task 5: `liftVault` — the whole pool, in order

**Files:**

- Test: `oracle/analytics/__tests__/glyphs.test.mjs`
- Modify: `oracle/analytics/glyphs.mjs`

**Steps:**

- [ ] 1. Extend the import at the top of `oracle/analytics/__tests__/glyphs.test.mjs` to its final form:

  ```javascript
  import { GLYPH_CAPS, GLYPH_GRADES, GLYPH_LABELS, itemGrade, liftItem, liftVault }
    from "../glyphs.mjs";
  ```

- [ ] 2. Append the `liftVault` tests to the **end** of `oracle/analytics/__tests__/glyphs.test.mjs`.

  ```javascript
  // --- liftVault ------------------------------------------------------------------------

  // ORDER IS LOAD-BEARING. build-solve breaks a tie between two equal pieces on the lower item id
  // by walking the pool, so a reordered pool can return a different build for the same vault — and
  // power.mjs locates each worn piece's lifted object in this array.
  test("liftVault returns every item in the input order", () => {
    const vault = [item({ id: 3 }), item({ id: 1 }), item({ id: 2 })];
    expect(liftVault(vault, "epic").items.map((it) => it.id)).toEqual([3, 1, 2]);
  });

  // Only the items that gained something, so `has(id)` is the test for "this piece needs a glyph"
  // and the map is as small as the answer is. A map holding every item would make the CLI's glyph
  // count the size of the vault rather than of the build.
  test("liftsById holds exactly the items that gained a glyph", () => {
    const vault = [
      item({ id: 1, substats: [sub(5, 20, 0, false)] }),             // crit only: nothing to lift
      item({ id: 2, substats: [sub(4, 10, 0, true)] }),              // SPD 0 -> 10
      item({ id: 3, rank: 4, substats: [sub(4, 10, 0, true)] }),     // below 5★: never lifted
    ];
    const { liftsById } = liftVault(vault, "epic");
    expect([...liftsById.keys()]).toEqual([2]);
    expect(liftsById.get(2)).toEqual([{ key: "SPD", from: 0, to: 10 }]);
  });

  // An unlifted item passes through by IDENTITY, which is what keeps power-solve's
  // identity-keyed per-item caches valid for the pieces the lift did not change.
  test("an unlifted item is the same object in the lifted vault", () => {
    const untouched = item({ id: 1, substats: [sub(6, 60, 0, false)] });
    const raised = item({ id: 2, substats: [sub(4, 10, 0, true)] });
    const { items: lifted } = liftVault([untouched, raised], "epic");
    expect(lifted[0]).toBe(untouched);
    expect(lifted[1]).not.toBe(raised);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: the 3 new tests fail — either `does not provide an export named 'liftVault'` or `TypeError: liftVault is not a function`, as in Task 2.
- [ ] 4. Append `liftVault` to the **end** of `oracle/analytics/glyphs.mjs`.

  ```javascript
  // The whole vault lifted, in the INPUT ORDER, plus the lifts per item id. Order is load-bearing:
  // a caller locates a worn piece's lifted object by id in this array, and build-solve breaks a tie
  // on the lower id, so a reordered pool could return a different build for the same vault.
  //
  // `liftsById` holds only the items that gained something, so `has(id)` is the test for "this
  // piece needs a glyph" and the map is as small as the answer is.
  export function liftVault(items, grade) {
    const liftsById = new Map();
    const lifted = items.map((item) => {
      const { item: one, lifts } = liftItem(item, grade);
      if (lifts.length) liftsById.set(one.id, lifts);
      return one;
    });
    return { items: lifted, liftsById };
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 20 tests pass.
- [ ] 6. Lint the new module: `npm run lint`
     Expected: exit 0, no output. Every import in both files is now used — `no-unused-vars` is an error under `eslint.configs.recommended` and applies to unused *imports* too, with no override anywhere in `oracle/`.
- [ ] 7. Commit: `git add oracle/analytics/glyphs.mjs oracle/analytics/__tests__/glyphs.test.mjs && git commit -m "feat(analytics): add glyphs.mjs liftVault"`

---

## Chunk 2 — the parser

### Task 6: `parsePowerArgs` accepts `--glyph <grade>` in solve mode only

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. In `oracle/analytics/__tests__/power-cli.test.mjs`, make the **required edit** to the default-output assertion. Replace the body of the test at lines 49–54:

  ```javascript
  test("parsePowerArgs defaults top to 1 and leaves the rest null", () => {
    expect(parsePowerArgs(["Elhain"])).toEqual({
      mode: "solve", selector: "Elhain", dbArg: undefined, power: null, top: 1, topGiven: false,
      exact: false, glyph: null, logPower: null,
    });
  });
  ```

- [ ] 2. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 1 failing test — `parsePowerArgs defaults top to 1 and leaves the rest null` — reporting an unexpected `glyph` key in the expected object and none in the received one.
- [ ] 3. Append the `--glyph` parser section to `power-cli.test.mjs` immediately **after** the `--exact` section (i.e. after the test `parsePowerArgs rejects --exact combined with any --top`, before the `// --- mainCopies ---` divider).

  ```javascript
  // --- parsePowerArgs: --glyph ----------------------------------------------------

  // A GRADE, not a number: glyph values differ per stat, so one number could not cover both a SPD
  // glyph that tops out at 12 and a flat HP one at 1,150.
  //
  // The second case is the one that matters most. `--glyph 5` carries an ALL-DIGIT value, and an
  // all-digit selector is an exact copy id to mainCopies — so a value that leaked into the
  // positionals would not merely be ignored, it would silently report a different champion.
  test("parsePowerArgs reads --glyph in solve mode and consumes its value", () => {
    expect(parsePowerArgs(["Elhain", "--glyph", "epic"]))
      .toMatchObject({ mode: "solve", glyph: "epic" });
    expect(parsePowerArgs(["--glyph", "5", "Elhain"]))
      .toMatchObject({ selector: "Elhain", glyph: "5" });
    expect(parsePowerArgs(["Elhain"]).glyph).toBe(null);
  });

  // The five grades are the whole vocabulary, and a near miss has to name them rather than being
  // guessed at: `--glyph 6` is someone reading the labels and typing the star level, and lifting a
  // vault by a table nobody chose is a plausible wrong answer rather than a crash.
  test("parsePowerArgs rejects an unknown glyph grade, naming the five", () => {
    expect(() => parsePowerArgs(["Elhain", "--glyph", "mythical"]))
      .toThrow(/unknown glyph grade "mythical" — use one of 5, normal, rare, epic, legendary/);
    expect(() => parsePowerArgs(["Elhain", "--glyph", "6"])).toThrow(/unknown glyph grade "6"/);
    expect(() => parsePowerArgs(["Elhain", "--glyph", "EPIC"]))
      .toThrow(/unknown glyph grade "EPIC"/);
  });

  // Same reason positiveInt checks blank before Number(): an option whose value went missing must
  // not read as something legal. Here a blank would fall through to the grade lookup and report
  // `unknown glyph grade ""`, which describes the symptom rather than the mistake.
  test("parsePowerArgs rejects a missing or blank glyph grade", () => {
    const wanted = /--glyph needs a grade — use one of 5, normal, rare, epic, legendary/;
    expect(() => parsePowerArgs(["Elhain", "--glyph"]), "missing").toThrow(wanted);
    expect(() => parsePowerArgs(["Elhain", "--glyph", ""]), "empty").toThrow(wanted);
    expect(() => parsePowerArgs(["Elhain", "--glyph", "  "]), "blank").toThrow(wanted);
  });

  // The other three modes run no solver at all, so --glyph there is a reader expecting a different
  // command to do something it cannot. Answering anyway — running `fit` and ignoring the flag —
  // would look like the lifted solve had been run.
  test("parsePowerArgs rejects --glyph outside solve mode", () => {
    for (const mode of ["log", "fit", "verify"]) {
      expect(() => parsePowerArgs([mode, "Elhain", "100", "--glyph", "epic"]), mode)
        .toThrow(/--glyph is only supported in solve mode/);
    }
  });

  // The grade is validated where it is READ, as --power and --top are, so a bad grade in the wrong
  // mode reports the grade. Pinned because the opposite order is just as defensible and a reader of
  // either message should not have to guess which one a run will give.
  test("parsePowerArgs reports a bad grade before it reports the wrong mode", () => {
    expect(() => parsePowerArgs(["fit", "Elhain", "--glyph", "bogus"]))
      .toThrow(/unknown glyph grade "bogus"/);
  });
  ```

- [ ] 4. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 6 failing tests — the `toEqual` default from step 1, plus 5 new ones. The four `--glyph` cases that expect a throw instead report `unknown option --glyph`; `parsePowerArgs reads --glyph in solve mode` reports the same.
- [ ] 5. In `oracle/analytics/power.mjs`, add the `glyphs.mjs` import. Insert it between the `./gestal.mjs` and `./power-fit.mjs` imports, keeping the block's alphabetical-by-path order.

  **Only `GLYPH_GRADES`.** `no-unused-vars` is an error under `eslint.configs.recommended` and applies to unused imports, with no override anywhere in `oracle/` — so importing `GLYPH_LABELS` or `liftVault` before anything uses them would fail `npm run lint` at this task's own lint step. Task 7 adds `GLYPH_LABELS` and Task 10 adds `liftVault`, each in the task that first uses it.

  ```javascript
  import { gestalChampRows, gestalChampStats, gestalItems, isGestalPath,
    readGestalSnapshot } from "./gestal.mjs";
  import { GLYPH_GRADES } from "./glyphs.mjs";
  import { fitWeights } from "./power-fit.mjs";
  ```

- [ ] 6. In `oracle/analytics/power.mjs`, append `[--glyph G]` to `USAGE.solve`:

  ```javascript
  export const USAGE = {
    solve: "power.mjs <name|ID> [snapshot.json.gz] [--power N] [--top N] [--exact] [--glyph G]",
    log: "power.mjs log <name|ID> <in-game power>",
    fit: "power.mjs fit <name|ID>",
    verify: "power.mjs verify [snapshot.json.gz]",
  };
  ```

- [ ] 7. In `parsePowerArgs`, add `glyph: null` to the initial record:

  ```javascript
    const out = { mode: "solve", selector: null, dbArg: undefined, power: null, top: 1,
      topGiven: false, exact: false, glyph: null, logPower: null };
  ```

- [ ] 8. In `parsePowerArgs`, add the `--glyph` branch immediately **after** the `--exact` branch and **before** the `startsWith("--")` throw:

  ```javascript
      // A bare flag: it consumes no value, so `--exact Elhain` still finds Elhain.
      if (arg === "--exact") { out.exact = true; continue; }
      // A GRADE rather than a number, so it is validated against the five names rather than by
      // positiveInt — and its value is consumed as it is read, because `--glyph 5 Elhain` would
      // otherwise read "5" as an all-digit selector, which mainCopies treats as an exact copy id.
      if (arg === "--glyph") { out.glyph = glyphGrade(argv[++i]); continue; }
      // Anything else beginning `--` is a typo, not a champion, and swallowing it as a positional is
  ```

- [ ] 9. In `parsePowerArgs`, add the mode refusal after the loop, immediately **after** the `--top is not supported with --exact` throw and **before** the `READS_SNAPSHOT` lines:

  ```javascript
    if (out.exact && out.topGiven) {
      throw new Error(`--top is not supported with --exact — the exact mode proves one maximum and`
        + " keeps no runner-up to rank");
    }
    // The same refusal, for the same reason: log, fit and verify run no solver, so a lifted vault
    // has nothing to be solved over and ignoring the flag would look like it had been.
    if (out.glyph !== null && out.mode !== "solve") {
      throw new Error(`--glyph is only supported in solve mode — usage: ${USAGE.solve}`);
    }
    if (READS_SNAPSHOT.has(out.mode)) out.dbArg = positional.find(isSnapshotArg);
  ```

- [ ] 10. In `oracle/analytics/power.mjs`, add `glyphGrade` immediately **after** the `positiveInt` function:

  ```javascript
  // A glyph GRADE, not a number. Glyph values differ per stat — a SPD glyph tops out at 12 and a
  // flat HP one at 1,150 — so one number cannot cover every stat, and "every glyphable substat at
  // the cap of a 6★ Epic glyph" is the assumption a reader can state and control. glyphs.mjs's
  // header has the provenance.
  //
  // Blank is checked BEFORE the lookup, for the reason positiveInt checks it before Number(): an
  // option whose value went missing would otherwise be reported as an unknown grade of "", which
  // names the symptom rather than the mistake. The grade list comes off GLYPH_GRADES, so the names
  // in this message cannot drift from the table they index.
  function glyphGrade(raw) {
    const valid = `use one of ${GLYPH_GRADES.join(", ")}`;
    if (raw === undefined || raw.trim() === "") {
      throw new Error(`--glyph needs a grade — ${valid}`);
    }
    if (!GLYPH_GRADES.includes(raw)) {
      throw new Error(`unknown glyph grade "${raw}" — ${valid}`);
    }
    return raw;
  }
  ```

- [ ] 11. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass, including the 5 new ones and the amended `toEqual`.
- [ ] 12. Run lint: `npm run lint`
     Expected: exit 0, no output.
- [ ] 13. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): parse power.mjs --glyph <grade> in solve mode"`

---

## Chunk 3 — the pure formatters

### Task 7: `formatGlyphGain` — the block's headline

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. In `power-cli.test.mjs`, add `formatGlyphGain` to the `../power.mjs` import list at the top of the file:

  ```javascript
  import { formatBreakdown, formatCertificate, formatGain, formatGlyphGain, formatOffBest,
    formatProven, formatSets, formatTotals, latestReading, mainCopies, parsePowerArgs, powerDir,
    readingsFor, readingsPath, weightsPath } from "../power.mjs";
  ```

- [ ] 2. Add the `formatGlyphGain` section to `power-cli.test.mjs` immediately **after** the `formatGain` section (i.e. after the test `formatGain names a zero current rather than reporting a ratio for it`, before the `// --- formatCertificate ---` divider).

  ```javascript
  // --- formatGlyphGain ------------------------------------------------------------

  // Measured against the plain BEST rather than against current: the question the block answers is
  // what glyphing the gear would add ON TOP of the best build the vault already allows, and the
  // gain over current is the line above it.
  //
  // The grade is printed through GLYPH_LABELS, never raw — a headline reading "WITH 5 GLYPHS" would
  // be read as a count of glyphs rather than as a star level.
  //   best (100 + 5)^2 = 11,025 · glyphed (120 + 5)^2 = 15,625 · gain 4,600
  test("formatGlyphGain reports power and the gain over BEST when the constant is known", () => {
    expect(formatGlyphGain(100, 120, 5, "epic"))
      .toBe("  WITH 6★ Epic GLYPHS  15625 power  (+4600 over BEST)");
  });

  // Same fallback as formatGain and for the same reason: power is (lin + c)^2, so without `c` every
  // absolute number is unavailable and only the ratio can be stated — computed at c = 0, where it
  // is an OVER-estimate, because a positive c raises both sides and shrinks it.
  //   (120 / 100)^2 - 1 = 0.44
  test("formatGlyphGain falls back to a percentage when the constant is unknown", () => {
    expect(formatGlyphGain(100, 120, null, "legendary")).toBe(
      "  WITH 6★ Legendary GLYPHS  ≈ +44.0% over BEST"
      + " (per-copy constant unknown: log a reading or pass --power)");
  });

  // The 5★ grade's label is the one that must never print as a bare "5".
  test("formatGlyphGain labels the 5★ grade as a star level, not a number", () => {
    expect(formatGlyphGain(100, 120, 5, "5")).toMatch(/^ {2}WITH 5★ GLYPHS {2}15625 power/);
  });

  // The guard formatGain carries, for the same reason: at bestLin = 0 the ratio would read "+0.0%"
  // for a lift that is in fact an infinite improvement. Unreachable for a real champion — BEST is a
  // real build and base stats alone put `lin` in the hundreds — so it is named rather than computed.
  test("formatGlyphGain names a zero BEST rather than reporting a ratio for it", () => {
    expect(formatGlyphGain(0, 120, null, "epic")).toMatch(/gain unknown/);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the 4 new tests fail — either `does not provide an export named 'formatGlyphGain'` or `TypeError: formatGlyphGain is not a function`, depending on how Vite resolves the missing export. Either is the right RED.
- [ ] 4. In `oracle/analytics/power.mjs`, extend the `glyphs.mjs` import to add the label table:

  ```javascript
  import { GLYPH_GRADES, GLYPH_LABELS } from "./glyphs.mjs";
  ```

- [ ] 5. In `oracle/analytics/power.mjs`, add `formatGlyphGain` immediately **after** `formatGain` and before the `formatCertificate` comment block:

  ```javascript
  // The glyph block's headline, measured against the PLAIN BEST rather than against current: the
  // question the block answers is what glyphing the gear would add on top of the best build the
  // vault already allows, and the gain over current is the line above it.
  //
  // The grade is printed through GLYPH_LABELS and never raw, because "WITH 5 GLYPHS" reads as a
  // count of glyphs rather than as the star level it is.
  //
  // Same two branches as formatGain, for the same reason: without `c` no absolute power exists and
  // the only honest thing left is the ratio at c = 0, an over-estimate.
  export function formatGlyphGain(bestLin, glyphLin, c, grade) {
    const label = GLYPH_LABELS[grade];
    if (c !== null) {
      const glyph = powerOf(glyphLin, c);
      return `  WITH ${label} GLYPHS  ${Math.round(glyph)} power`
        + `  (+${Math.round(glyph - powerOf(bestLin, c))} over BEST)`;
    }
    // The guard formatGain carries, unreachable for the same reason: BEST is a real build, and base
    // stats alone put `lin` in the hundreds. At bestLin = 0 the ratio would read "+0.0%" for a lift
    // that is in fact an infinite improvement.
    if (!(bestLin > 0)) {
      return `  WITH ${label} GLYPHS  gain unknown (BEST scores zero and the per-copy constant is`
        + " unknown: log a reading or pass --power)";
    }
    const pct = ((glyphLin / bestLin) ** 2 - 1) * 100;
    return `  WITH ${label} GLYPHS  ≈ +${pct.toFixed(1)}% over BEST`
      + " (per-copy constant unknown: log a reading or pass --power)";
  }
  ```

- [ ] 6. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): add formatGlyphGain, the glyph block headline"`

---

### Task 8: `liftDelta` — what one glyph is worth

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. In `power-cli.test.mjs`, add `liftDelta` to the `../power.mjs` import list:

  ```javascript
  import { formatBreakdown, formatCertificate, formatGain, formatGlyphGain, formatOffBest,
    formatProven, formatSets, formatTotals, latestReading, liftDelta, mainCopies, parsePowerArgs,
    powerDir, readingsFor, readingsPath, weightsPath } from "../power.mjs";
  ```

- [ ] 2. Add the `liftDelta` section to `power-cli.test.mjs` immediately **after** the `formatOffBest` section (i.e. after the test `formatOffBest measures it in sqrt(power) when the constant is unknown`, before the `// --- formatSets ---` divider).

  ```javascript
  // --- liftDelta ------------------------------------------------------------------
  //
  // What the build loses if ONE lift alone is undone, in sqrt(power). Every expected number below is
  // written out as the two multiplications a reader can check, the way power-solve.test.mjs pins
  // linearizedWeights — reading it back off the module would assert nothing.

  const LIFT_W = { b: 0.012, r: 0.28, a: 0.039, s: 0.022, k: 0.0015 };
  const LIFT_BASE = { HP: 15000, ATK: 1000, DEF: 1000, SPD: 100, "C.RATE": 15, "C.DMG": 50,
    RES: 30, ACC: 0 };

  // A flat key lands on its own stat as-is, so the delta is the glyph's rise times that stat's
  // scalar.
  //   12 points of SPD at s = 0.022 -> 0.264
  test("liftDelta values a flat lift at its stat's weight", () => {
    expect(liftDelta({ key: "SPD", from: 0, to: 12 }, LIFT_BASE, LIFT_W))
      .toBeCloseTo(0.264, 9);
  });

  // A percent key is a percentage of the champion's BASE stat, so the same rise is worth more on a
  // champion with more base. This is the trap: reading "HP% 10" as ten points of HP rather than as
  // ten percent of 15,000 would under-value the lift by 150x.
  //   2 -> 12 is +10% of base HP 15,000 = 1,500 HP, at b/15 = 0.0008 -> 1.2
  test("liftDelta scales a percent lift by the champion's base stat", () => {
    expect(liftDelta({ key: "HP%", from: 2, to: 12 }, LIFT_BASE, LIFT_W))
      .toBeCloseTo(1.2, 9);
  });

  // Flat HP and HP% share a stat COLUMN but not a key, and the two land on the same column by
  // completely different arithmetic. Pinned beside the test above so a lift that read the wrong one
  // names itself.
  //   1,150 flat HP at b/15 = 0.0008 -> 0.92
  test("liftDelta does not scale a flat lift on a percent-capable stat", () => {
    expect(liftDelta({ key: "HP", from: 0, to: 1150 }, LIFT_BASE, LIFT_W))
      .toBeCloseTo(0.92, 9);
  });

  // Only the RISE is valued, never the whole new glyph: a substat already glyphed at 3 and lifted to
  // 10 costs one glyph and is worth the 7 points it gained, not the 10 it ends up with.
  //   10 - 3 = 7 points of RES at r = 0.28 -> 1.96
  test("liftDelta values only the rise, not the whole new glyph", () => {
    expect(liftDelta({ key: "RES", from: 3, to: 10 }, LIFT_BASE, LIFT_W))
      .toBeCloseTo(1.96, 9);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the 4 new tests fail — either `does not provide an export named 'liftDelta'` or `TypeError: liftDelta is not a function`. Either is the right RED.
- [ ] 4. In `oracle/analytics/power.mjs`, extend two imports so `contribution` and `linearizedWeights` are available:

  ```javascript
  import { STATS, contribution, statBreakdown } from "./champion-stats.mjs";
  ```

  and

  ```javascript
  import { buildTotals, linearizedWeights, solvePower, solvePowerExact } from "./power-solve.mjs";
  ```

- [ ] 5. In `oracle/analytics/power.mjs`, add a new section with `liftDelta` immediately **after** `formatOffBest` and **before** the `// --- labels ---` divider:

  ```javascript
  // --- the glyph block's per-lift values -------------------------------------------

  // What the reported build would LOSE if one lift alone were undone, in sqrt(power). Exact, and
  // additive across lifts, because every glyphable stat enters `lin` LINEARLY — the one term that is
  // not linear is the crit product, and no lift is ever crit (glyphs.mjs's crit rule).
  //
  // linearizedWeights at (0, 0) is read here as a plain per-stat scalar table, NOT as a
  // linearization: at that reference its C.RATE scalar is k * 100 rather than 0, which a search
  // would double-count. That cannot bite, because `lift.key` is never a crit key — nonCritWeights
  // is the function to reach for the day one could be.
  //
  // `contribution` is what makes a "%" lift a percentage of the champion's BASE stat rather than a
  // flat addition, which is the difference between 10 points of HP and 10% of 15,000.
  export function liftDelta(lift, base, weights) {
    const [stat, amount] = contribution(lift.key, lift.to - lift.from, base);
    return linearizedWeights(weights, 0, 0)[stat] * amount;
  }
  ```

- [ ] 6. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): add liftDelta, what one glyph is worth to a build"`

---

### Task 9: `formatLift` — one glyph to apply, as a line

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. In `power-cli.test.mjs`, add `formatLift` to the `../power.mjs` import list:

  ```javascript
  import { formatBreakdown, formatCertificate, formatGain, formatGlyphGain, formatLift,
    formatOffBest, formatProven, formatSets, formatTotals, latestReading, liftDelta, mainCopies,
    parsePowerArgs, powerDir, readingsFor, readingsPath, weightsPath } from "../power.mjs";
  ```

- [ ] 2. Append the `formatLift` tests to the **end** of the `liftDelta` section added in Task 8, before the `// --- formatSets ---` divider.

  ```javascript
  // --- formatLift -----------------------------------------------------------------

  // SIX spaces, one level deeper than printBuild's four-space piece line, so a build reads as a list
  // of pieces each with its glyphs rather than as two interleaved lists.
  //
  // With the constant the worth is in POWER, and that needs the BUILD's own `lin`: power is a
  // square, so a fixed delta in sqrt(power) is worth more on a stronger build. Reporting `delta`
  // itself here would print a sqrt(power) number labelled as power.
  //   (120 + 5)^2 - (110 + 5)^2 = 15,625 - 13,225 = 2,400
  test("formatLift states one glyph's worth in power when the constant is known", () => {
    expect(formatLift({ key: "SPD", from: 0, to: 12 }, 10, 120, 5))
      .toBe("      glyph SPD 0→12  (+2400)");
  });

  // Without it, `delta` is already the answer and is printed in its own unit — two decimals, where
  // the numbers are fractions of a point.
  test("formatLift states it in sqrt(power) when the constant is unknown", () => {
    expect(formatLift({ key: "HP%", from: 2, to: 12 }, 1.2, 120, null))
      .toBe("      glyph HP% 2→12  (+1.20)");
  });

  // The arrow carries the glyph the piece HAS and the one the grade assumes, so a reader can tell a
  // fresh glyph from an upgrade of one already on the piece — which is the difference between
  // spending a glyph and re-rolling one.
  test("formatLift shows an existing glyph as the arrow's left side", () => {
    expect(formatLift({ key: "RES", from: 3, to: 10 }, 1.96, 300, null))
      .toBe("      glyph RES 3→10  (+1.96)");
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the 3 new tests fail — either `does not provide an export named 'formatLift'` or `TypeError: formatLift is not a function`. Either is the right RED.
- [ ] 4. In `oracle/analytics/power.mjs`, add `formatLift` immediately **after** `liftDelta`, still inside the `// --- the glyph block's per-lift values ---` section:

  ```javascript
  // One glyph to apply, printed under the piece it belongs to. Six spaces, one level deeper than the
  // four-space piece line above it, so a build reads as a list of pieces each with its glyphs rather
  // than as two interleaved lists.
  //
  // The value is what this ONE glyph is worth to the build it sits in. In power when `c` is known,
  // which needs the build's own `lin`: power is a square, so a fixed delta in sqrt(power) is worth
  // more on a stronger build and the two units are not interchangeable. In sqrt(power) otherwise,
  // where `delta` is already the answer.
  export function formatLift(lift, delta, buildLin, c) {
    const shown = c === null
      ? delta.toFixed(2)
      : String(Math.round(powerOf(buildLin, c) - powerOf(buildLin - delta, c)));
    return `      glyph ${lift.key} ${lift.from}→${lift.to}  (+${shown})`;
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 6. Run lint: `npm run lint`
     Expected: exit 0, no output.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): add formatLift, one glyph to apply as a line"`

---

## Chunk 4 — the glyph block

### Task 10: The E2E fixture and the block's headline

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. In `power-cli.test.mjs`, add the new fixture immediately **after** the `GEAR` definition and **before** the `TWO_CHAMPS` line. `GEAR` itself is **not** edited, so every existing BEST assertion keeps its arithmetic.

  ```javascript
  // Gestal stat id 7 is SPD, which maps to our 4 and comes back flat. Values are stored x100, so
  // 1200 is SPD 12, and `glyphBonusValue: null` decodes to a glyph of 0.
  const G_SPD = 7;

  // GEAR plus ONE unglyphed SPD substat, on worn piece #1 — the Critical Rate weapon the plain BEST
  // keeps (see the mixed-build arithmetic above). Nothing else in GEAR is glyphable at all: every
  // other substat is C.RATE or C.DMG and every main stat is one of the two, so this is the only lift
  // in the whole vault — which is what makes `glyphs to apply: 1` and a single lift line checkable.
  //
  // A SEPARATE fixture rather than an edit to GEAR, so the existing BEST arithmetic stays valid. The
  // SPD substat adds 0.022 x 12 = 0.264 to any build holding piece #1, which both crit-rate-heavy
  // candidates do and the 3-Crit-Damage one does not — far below the gaps between them, so the
  // winner is unchanged.
  const GEAR_WITH_SPD = [
    { ...GEAR[0], substats: [
      { statId: G_CDMG, value: 3000, glyphBonusValue: null, rolls: 2, isMythicalRoll: false },
      { statId: G_SPD, value: 1200, glyphBonusValue: null, rolls: 1, isMythicalRoll: false },
    ] },
    ...GEAR.slice(1),
  ];
  ```

- [ ] 2. Add the `--glyph` E2E section to `power-cli.test.mjs` immediately **after** the `--exact` E2E section (i.e. after the test `--exact exits 1 outside solve mode and with --top`, before the `// --- verify ---` divider). Start with the headline test only.

  ```javascript
  // --- solve: --glyph ---------------------------------------------------------------
  //
  // The whole vault re-valued as if every glyphable substat held the grade's cap, solved again, and
  // printed as a second block under the plain BEST. GEAR_WITH_SPD has exactly one glyphable substat,
  // so every number in this section is one multiplication.

  // The headline names the GRADE's label rather than the grade, so "5" can never read as a count.
  test("--glyph adds a glyph block headed with the grade's label", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}WITH 6★ Legendary GLYPHS /m);
    // The plain BEST is still printed, above it: the block is measured against BEST, so it is an
    // addition to the report rather than a replacement for it.
    expect(res.stdout).toMatch(/^ {2}BEST /m);
  });

  // The default is no block at all, so an ordinary run is not made longer by a feature it did not
  // ask for.
  test("solve prints no glyph block without --glyph", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).not.toMatch(/GLYPHS/);
    expect(res.stdout).not.toMatch(/glyphs to apply/);
  });

  // NEVER BELOW THE PLAIN BEST. A block headed "over BEST" that reported less than BEST would be
  // reporting a downgrade as an improvement. Both numbers are parsed out rather than pinned: they
  // depend on the role-default weights, which a later fit could legitimately change.
  test("--glyph reports a build at least as strong as the plain BEST", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary",
      "--power", "412000"]);
    expect(res.status, res.stderr).toBe(0);
    const best = Number(res.stdout.match(/^ {2}BEST {2}(\d+) power/m)[1]);
    const glyphed = Number(res.stdout.match(/^ {2}WITH 6★ Legendary GLYPHS {2}(\d+) power/m)[1]);
    expect(glyphed).toBeGreaterThanOrEqual(best);
  });
  ```

- [ ] 3. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 2 failing tests. `--glyph adds a glyph block headed with the grade's label` finds no `WITH … GLYPHS` line, and `--glyph reports a build at least as strong as the plain BEST` throws on `null[1]` because the headline regex matched nothing. `solve prints no glyph block without --glyph` passes already — it pins behaviour that must survive.
- [ ] 4. In `oracle/analytics/power.mjs`, extend the `glyphs.mjs` import to add the lift:

  ```javascript
  import { GLYPH_GRADES, GLYPH_LABELS, liftVault } from "./glyphs.mjs";
  ```

- [ ] 5. In `oracle/analytics/power.mjs`, add `printGlyphBlock` immediately **after** `printBuild` and **before** `printCopy`. This first version handles the default solver only; `--exact` arrives in Task 14.

  ```javascript
  // The glyph block: the whole vault re-valued as if every glyphable substat held `args.glyph`'s
  // cap, solved again, and printed under the plain BEST it is measured against.
  //
  // NEITHER SOLVER CHANGES, because a glyphed item is just a better item — champion-stats.mjs's
  // itemEntries already reads a substat as value + glyph, so glyphs.mjs lifts the pool and
  // everything here is the plain path over it.
  //
  // Reached only when the plain solve produced a build, so `plainBest` is real; the lifted pool
  // holds the same pieces in the same slots with the same sets and factions, so it can fill exactly
  // the same slots.
  function printGlyphBlock({ items, champStats, weights, faction, current, plainBest, c, args,
    wearers }) {
    const { items: pool, liftsById } = liftVault(items, args.glyph);
    const byId = new Map(pool.map((it) => [it.id, it]));
    // A build's pieces as the LIFTED pool's own objects. power-solve keys its per-item stat vectors
    // by object IDENTITY, and its header requires `current` to be drawn from the pool it searches —
    // a worn piece that is not in that pool could sit outside the crit box every bound rests on.
    const asLifted = (buildItems) => buildItems.map((it) => byId.get(it.id));
    const score = (buildItems) => {
      const totals = buildTotals(champStats, buildItems);
      return { items: buildItems, totals, lin: lin(totals, weights) };
    };
    // NEVER BELOW THE PLAIN BEST. The lifted solve seeds round 0 with the lifted WORN gear, not with
    // the plain BEST, so on a vault where the lift reorders the candidates it can come back with a
    // build worth less than the plain BEST's own pieces are once glyphed. Scoring those and taking
    // the better of the two makes the block monotone, which is what a reader assumes of a line that
    // says "over BEST".
    const floor = score(asLifted(plainBest.items));

    const result = solvePower({ items: pool, faction, champStats, current: asLifted(current),
      weights, top: args.top });
    // A TIE goes to the lifted solve, which is the answer the block was asked for; the floor is the
    // guarantee behind it rather than the preferred reading of it.
    const reported = result.builds[0].lin >= floor.lin ? result.builds[0] : floor;
    console.log(`\n${formatGlyphGain(plainBest.lin, reported.lin, c, args.glyph)}`);
    printBuild(reported, wearers);
  }
  ```

- [ ] 6. In `printCopy`, call the block after the plain runners-up. Replace the `rest.forEach` block's trailing lines so the function ends:

  ```javascript
    // The runners-up, each measured against BEST rather than against current: BEST is what a reader
    // compares them with when deciding whether one is worth its lower power.
    rest.forEach((build, i) => {
      console.log(`\n${formatOffBest(i + 2, build, best, c)}`);
      printBuild(build, wearers);
    });

    // The glyph block LAST, after the plain BEST and its runners-up: it is measured against BEST, so
    // it has to come after the number it is measured against.
    if (args.glyph) {
      printGlyphBlock({ items, champStats, weights, faction: row.Fraction, current,
        plainBest: best, c, args, wearers });
    }
  }
  ```

- [ ] 7. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass, including the 3 new ones.
- [ ] 8. Run lint: `npm run lint`
     Expected: exit 0, no output. Every binding added so far is used.
- [ ] 9. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): solve the lifted vault and head the glyph block"`

---

### Task 11: `printBuild`'s `linesById`, the lift lines and the glyph count

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append two tests to the **end** of the `--- solve: --glyph ---` E2E section.

  ```javascript
  // The one lift this vault has, under the piece it belongs to, with what that one glyph is worth.
  // Elhain is in no BUILT_IN row, so every weight falls through to a role default — the Attack
  // row's s = 0.022 — and the whole value is one multiplication:
  //   12 points of SPD x 0.022 = 0.264 -> +0.26 in sqrt(power), the unit with no constant to use
  test("--glyph names each glyph to apply and what it is worth", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {6}glyph SPD 0→12 {2}\(\+0\.26\)$/m);
  });

  // The count is of the lifts in the REPORTED BUILD, not in the vault: a glyph on a piece the build
  // does not wear is not work this answer asks for. Here the one lifted piece is in the build, so
  // the two happen to agree — and the plain block above prints no count at all.
  test("--glyph counts the glyphs the reported build would need", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {4}glyphs to apply: 1$/m);
    expect(res.stdout.match(/^ {4}glyphs to apply: /gm)).toHaveLength(1);
  });
  ```

- [ ] 2. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 2 failing tests — no `glyph SPD 0→12` line and no `glyphs to apply:` line in stdout.
- [ ] 3. In `oracle/analytics/power.mjs`, give `printBuild` its optional third argument. Replace the whole function:

  ```javascript
  // One build: its gear slot by slot, the sets it completes, the pieces it would have to take off
  // someone, and its totals.
  //
  // The sets line is computed from the ITEMS rather than read off the build, because solvePower
  // returns no counts — and computing it here is the honest version anyway: a free pick carries an
  // item that belongs to some set and can complete one by accident, which has to count.
  //
  // `linesById` is extra lines to print UNDER a given piece, which is how the glyph block puts each
  // glyph to apply beside the piece that needs it: a glyph is an instruction about one piece, and a
  // reader works down the list slot by slot rather than matching a trailing list back to ids.
  // Omitted by every other caller, which prints the build unchanged.
  function printBuild(build, wearers, linesById) {
    for (const it of [...build.items].sort((a, b) => a.slot - b.slot)) {
      const on = wearers.get(it.id);
      console.log(`    ${slotName(it.slot).padEnd(7)} ${setLabel(it.set).padEnd(14)}`
        + ` +${String(it.level).padStart(2)}   #${it.id}${on ? `   on ${on}` : ""}`);
      // Each line is printed verbatim: the formatter owns its own indentation, exactly as
      // formatTotals below does.
      for (const line of linesById?.get(it.id) ?? []) console.log(line);
    }
    console.log(`    sets: ${formatSets(setCounts(build.items))}`);
    console.log(`    on other champions: ${describeWearers(build.items, wearers)}`);
    console.log(formatTotals(build.totals));
  }
  ```

- [ ] 4. In `printGlyphBlock`, add the lift-line helpers after the `floor` line and route the build through them. Replace everything from the `floor` line to the end of the function:

  ```javascript
    const floor = score(asLifted(plainBest.items));

    // Each lift the build would have to pay for, and the lines that say so. Only the pieces the
    // build HOLDS: a vault full of lifts would otherwise bury the handful this answer needs.
    const liftsOf = (build) => build.items.flatMap((it) => liftsById.get(it.id) ?? []);
    const linesFor = (build) => new Map(build.items
      .filter((it) => liftsById.has(it.id))
      .map((it) => [it.id, liftsById.get(it.id).map((lift) =>
        formatLift(lift, liftDelta(lift, champStats.base, weights), build.lin, c))]));
    // Each lift is valued against THIS build's own `lin`, because power is a square and the same
    // delta is worth more on a stronger build — so a runner-up's lines are not the reported build's.
    const printOne = (build) => {
      printBuild(build, wearers, linesFor(build));
      console.log(`    glyphs to apply: ${liftsOf(build).length}`);
    };

    const result = solvePower({ items: pool, faction, champStats, current: asLifted(current),
      weights, top: args.top });
    // A TIE goes to the lifted solve, which is the answer the block was asked for; the floor is the
    // guarantee behind it rather than the preferred reading of it.
    const reported = result.builds[0].lin >= floor.lin ? result.builds[0] : floor;
    console.log(`\n${formatGlyphGain(plainBest.lin, reported.lin, c, args.glyph)}`);
    printOne(reported);
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass. The existing `printBuild` assertions in the BEST and `--top` sections still pass, because the third argument is absent at those call sites.
- [ ] 6. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): print each glyph to apply under its piece, with a count"`

---

### Task 12: The glyph block's certificate

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append the certificate test to the **end** of the `--- solve: --glyph ---` E2E section.

  ```javascript
  // The block gets its OWN certificate, against the lifted vault and the build it reported. Without
  // one the block would be the only build in the report with no statement of what was proved about
  // it — and the plain certificate above says nothing about a pool it never saw.
  //
  // Asserted on the text AFTER the headline, because the plain block prints a certificate of its own
  // above: a line found there would not be this block's.
  test("--glyph closes the glyph block with its own certificate", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("WITH 6★ Legendary GLYPHS");
    const [, tail] = res.stdout.split("WITH 6★ Legendary GLYPHS");
    expect(tail)
      .toMatch(/^ {4}at most -?[\d.]+ √power \([\d.]+%\) below the true maximum {3}\[\d+ rounds?, (converged|no fixed point)\]$/m);
  });
  ```

- [ ] 2. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 1 failing test — no certificate line after the glyph headline.
- [ ] 3. In `printGlyphBlock`, add the certificate immediately after `printOne(reported);`:

  ```javascript
    console.log(`\n${formatGlyphGain(plainBest.lin, reported.lin, c, args.glyph)}`);
    printOne(reported);
    // The certificate against the REPORTED build, so the two numbers on this block describe one
    // answer. The gap stays non-negative either way: `upperBound` bounds every assignment of the
    // LIFTED pool, and the floor build is one of them.
    console.log(formatCertificate({ ...result, gap: result.upperBound - reported.lin },
      reported.lin, c));
  }
  ```

- [ ] 4. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): certify the glyph block against the build it reports"`

---

### Task 13: `--top` runners-up inside the glyph block

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append the `--top` tests to the **end** of the `--- solve: --glyph ---` E2E section.

  ```javascript
  // The block gets its own runners-up, measured against the build IT reported rather than against
  // the plain BEST: a glyphed runner-up compared with an unglyphed winner would not add up.
  //
  // Asserted on the text after the headline, because the plain path prints its own #2 above.
  test("--glyph --top 2 adds a runner-up inside the glyph block", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary",
      "--top", "2"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("WITH 6★ Legendary GLYPHS");
    const [, tail] = res.stdout.split("WITH 6★ Legendary GLYPHS");
    expect(tail).toMatch(/^ {2}#2 {2}\(-?[\d.]+ √power off BEST\)$/m);
    // The runner-up gets the same per-build detail as the winner, its glyph count included, so it
    // can be acted on directly.
    expect(tail.match(/^ {4}glyphs to apply: /gm)).toHaveLength(2);
  });

  // The default is one build in the block, matching the plain path's default.
  test("--glyph prints only one build in the block without --top", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--glyph", "legendary"]);
    expect(res.status, res.stderr).toBe(0);
    const [, tail] = res.stdout.split("WITH 6★ Legendary GLYPHS");
    expect(tail).not.toMatch(/off BEST/);
    expect(tail.match(/^ {4}glyphs to apply: /gm)).toHaveLength(1);
  });
  ```

- [ ] 2. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 1 failing test — `--glyph --top 2 adds a runner-up inside the glyph block` finds no `#2` after the headline. `--glyph prints only one build in the block without --top` passes already; it pins behaviour that must survive.
- [ ] 3. In `oracle/analytics/power.mjs`, add `itemsKey` immediately **before** `printGlyphBlock`. It lands here rather than in Task 10 because this is the task that first uses it, and an unused module-level const would fail `npm run lint`:

  ```javascript
  // A build's identity: its item ids, sorted, so "the same set of items" is one string compare
  // however the solver ordered them. The same key power-solve.mjs dedups its own pool on, which is
  // module-private there.
  const itemsKey = (buildItems) => buildItems.map((it) => it.id).sort((a, b) => a - b).join(",");
  ```

- [ ] 4. In `printGlyphBlock`, add the runner-up loop at the end of the function, after the certificate:

  ```javascript
    console.log(formatCertificate({ ...result, gap: result.upperBound - reported.lin },
      reported.lin, c));

    // The lifted solve's own builds, in its order, each measured against the REPORTED build. ALL of
    // them rather than builds[1..], because when the floor won the lifted solve's best is itself a
    // runner-up; the one build that must not appear twice is the reported one, skipped by its items.
    //
    // Up to --top - 1 of them, as the plain path prints, so `--top 2` is two builds in each block.
    const reportedKey = itemsKey(reported.items);
    let rank = 1;
    for (const build of result.builds) {
      if (rank >= args.top) break;
      if (itemsKey(build.items) === reportedKey) continue;
      rank++;
      console.log(`\n${formatOffBest(rank, build, reported, c)}`);
      printOne(build);
    }
  }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 6. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): rank the glyph block's runners-up against its own winner"`

---

### Task 14: `--glyph` composes with `--exact`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append the `--exact` composition tests to the **end** of the `--- solve: --glyph ---` E2E section.

  ```javascript
  // --exact proves the LIFTED maximum exactly as it proves the plain one, so the block prints
  // `proven maximum` where its certificate would be. Asserted after the headline, because the plain
  // block prints the same line above.
  test("--glyph composes with --exact, proving the lifted maximum too", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR_WITH_SPD }), "--exact",
      "--glyph", "epic"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("WITH 6★ Epic GLYPHS");
    const [, tail] = res.stdout.split("WITH 6★ Epic GLYPHS");
    expect(tail).toMatch(/^ {4}proven maximum {3}\[\d+ ms, \d+\/\d+ plans pruned\]$/m);
    // Asserting the ABSENCE matters as much: a block printing both would be claiming a ceiling on a
    // number that has no ceiling left.
    expect(tail).not.toMatch(/below the true maximum/);
    // The build and its glyphs are still printed, with epic's SPD cap of 10 rather than 12.
    expect(tail).toMatch(/^ {6}glyph SPD 0→10 {2}\(\+0\.22\)$/m);
    expect(tail).toMatch(/^ {4}glyphs to apply: 1$/m);
  });

  // A champion with nothing wearable has no plain build, so there is nothing to lift toward and no
  // block to print — only --exact reaches this state, since solvePower always seeds the worn gear.
  test("--glyph prints no block when no slot can be filled", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: [] }), "--exact", "--glyph", "epic"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}no eligible items for any slot\.$/m);
    expect(res.stdout).not.toMatch(/GLYPHS/);
  });
  ```

  The `+0.22` above is `epic`'s SPD cap of 10 at the Attack role default `s = 0.022`: `10 × 0.022 = 0.22`.

- [ ] 2. Run the tests to verify failure: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 1 failing test — `--glyph composes with --exact` finds no `WITH 6★ Epic GLYPHS` in stdout, because `printCopy`'s `--exact` branch returns before the block. `--glyph prints no block when no slot can be filled` passes already; it pins the early return that must survive.
- [ ] 3. In `printGlyphBlock`, add the `--exact` branch immediately after `printOne` is defined and **before** the default-mode `solvePower` call:

  ```javascript
    const printOne = (build) => {
      printBuild(build, wearers, linesFor(build));
      console.log(`    glyphs to apply: ${liftsOf(build).length}`);
    };

    // --exact proves the lifted maximum, exactly as it proves the plain one. No runners-up — the
    // parser has already refused --top — and `proven maximum` where the certificate would be.
    //
    // `proven.build` is never null here: the lifted pool holds the same pieces in the same slots,
    // and the caller only reaches this function when the plain solve produced a build.
    if (args.exact) {
      const proven = solvePowerExact({ items: pool, faction, champStats,
        current: asLifted(current), weights });
      const reported = proven.build.lin >= floor.lin ? proven.build : floor;
      console.log(`\n${formatGlyphGain(plainBest.lin, reported.lin, c, args.glyph)}`);
      printOne(reported);
      console.log(formatProven(proven));
      return;
    }

    const result = solvePower({ items: pool, faction, champStats, current: asLifted(current),
      weights, top: args.top });
  ```

- [ ] 4. In `printCopy`, stop the `--exact` branch returning early so the block can follow. Replace the branch:

  ```javascript
    // --exact replaces the whole iterate-and-certify path. One build, no runners-up — the parser has
    // already refused --top — and `proven maximum` where the certificate would be.
    if (args.exact) {
      const proven = solvePowerExact({ items, faction: row.Fraction, champStats, current, weights });
      // No slot can be filled at all: the vault is empty, or every accessory is the wrong faction.
      // speed.mjs prints this same line for an empty index. There is no assignment to report, let
      // alone one to prove anything about, and an empty BEST block would read as a build. No glyph
      // block either: a lift makes a piece better, and there is no piece.
      if (!proven.build) return console.log("  no eligible items for any slot.");
      console.log(`\n${formatGain(currentLin, proven.build.lin, c)}`);
      printBuild(proven.build, wearers);
      console.log(formatProven(proven));
      if (args.glyph) {
        printGlyphBlock({ items, champStats, weights, faction: row.Fraction, current,
          plainBest: proven.build, c, args, wearers });
      }
      return;
    }
  ```

- [ ] 5. Run the tests to verify pass: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass.
- [ ] 6. Run lint: `npm run lint`
     Expected: exit 0, no output.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "feat(analytics): prove the lifted maximum when --glyph meets --exact"`

---

## Chunk 5 — documentation

### Task 15: The header usage block and the README entry

Documentation only, so no TDD cycle. The verification step is the existing usage-line test, which the `USAGE.solve` change from Task 6 already has to satisfy.

**Files:**

- Modify: `oracle/analytics/power.mjs`
- Modify: `oracle/analytics/README.md`

**Steps:**

- [ ] 1. In `oracle/analytics/power.mjs`, add `--glyph G` to the solve usage block at the top of the file, after the `--exact` lines:

  ```javascript
  //   node --experimental-sqlite oracle/analytics/power.mjs <name|ID> [snapshot.json.gz] [opts]
  //     --power N      this copy's in-game power right now, to measure its constant from
  //     --top N        print the N best builds rather than only the winner
  //     --exact        prove the maximum instead of certifying a fixed point. Slower, and takes no
  //                    --top: it proves one build and keeps no runner-up to rank.
  //     --glyph G      also solve with every glyphable substat at the cap of glyph grade G
  //                    (5, normal, rare, epic, legendary)
  ```

- [ ] 2. In `oracle/analytics/README.md`, add `[--glyph G]` to the solve run line (line 132):

  ```markdown
     `node --experimental-sqlite oracle/analytics/power.mjs <name|ID> [snapshot.json.gz] [--power N] [--top N] [--exact] [--glyph G]`
  ```

- [ ] 3. In `oracle/analytics/README.md`, add the `--glyph` paragraphs immediately **after** the `--exact` paragraph (the one ending "so it takes no `--top` — not even `--top 1`.") and **before** the `power.mjs verify` paragraph:

  ```markdown
     `--glyph G` answers a different question: what this champion could reach if its gear were
     glyphed. It re-values the whole vault with every glyphable substat holding the cap of glyph
     grade `G` — `5`, `normal`, `rare`, `epic` or `legendary`, a 5★ glyph and then the four 6★
     rarities — and solves again, printing a second block under the plain BEST. A grade rather than a
     number, because glyph values differ per stat: a SPD glyph tops out at 12 and a flat HP one at
     1,150, so no single number covers both. The caps are the tops of each grade's roll ranges, not
     the largest values the vault happens to hold — those record what was *applied*, not what is
     possible. `glyphs.mjs`'s header has the provenance.

     A 5★ item takes at most a 5★ glyph whatever grade was asked for, and nothing below 5★ is lifted
     at all. An existing glyph is never lowered: the cap is a floor, so a substat already glyphed
     above it keeps what it has and is not listed as work to do. Crit is never glyphable — no C.RATE
     or C.DMG substat in the vault carries a glyph, and neither does any damage-type substat — so a
     glyph only ever adds to the linear part of the objective, which is why neither solver changes
     and why each glyph's reported worth is exact.

     The block prints its own headline (`WITH 6★ Epic GLYPHS`, with the gain over BEST), the build
     slot by slot with one `glyph <stat> <from>→<to>` line under each piece that needs one and what
     that single glyph is worth, a `glyphs to apply: N` count for the build, and its own certificate
     — or `proven maximum` with `--exact`, which proves the lifted maximum as it proves the plain
     one. `--top N` gives the block its own runners-up, measured against the build it reported. It is
     never below the plain BEST: BEST's own pieces are re-scored with their glyphs applied and
     reported instead if that beats the lifted solve's answer.
  ```

- [ ] 4. Verify the usage line still satisfies the existing missing-selector test: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass. `solve without a selector exits 1 with solve's usage line` matches `usage: power\.mjs <name\|ID> \[snapshot\.json\.gz\]` as a prefix, so the appended `[--glyph G]` does not break it.
- [ ] 5. Confirm the README's two edits landed on the `power.mjs` entry and nowhere else: `grep -n "glyph" oracle/analytics/README.md`
     Expected: the `speed.mjs` entry's two existing `--glyph N` lines (around lines 62–63), the amended run line, and the new paragraphs. No other hits.
- [ ] 6. Commit: `git add oracle/analytics/power.mjs oracle/analytics/README.md && git commit -m "docs(analytics): describe power.mjs --glyph in the header and the README"`

---

### Task 16: CHANGELOG entry

Documentation only. Every one of the four dependency commits (#44, #45, #46, #47) added exactly one line here, so this follows the repo convention rather than the issue's acceptance criteria.

**Files:**

- Modify: `CHANGELOG.md`

**Steps:**

- [ ] 1. In `CHANGELOG.md`, add one line at the **end** of the `## [Unreleased]` → `### Added` list, immediately after the `(#47)` line and before the `## [0.4.0] - 2026-10-03` heading:

  ```markdown
  - [minor] Add `oracle/analytics/glyphs.mjs` and `power.mjs --glyph <grade>`: re-solve a champion's gear with every glyphable substat holding the cap of a chosen glyph grade (`5`, `normal`, `rare`, `epic` or `legendary`), which answers what the champion could reach if its gear were glyphed. A grade rather than a raw number, because glyph values differ per stat — a SPD glyph tops out at 12 and a flat HP one at 1,150 — and the largest values a vault happens to hold record what was applied, not what is possible. A 5★ item takes at most a 5★ glyph and nothing below 5★ is lifted; an existing glyph is never lowered; and crit is never glyphable, so a lift only ever adds to the linear part of the objective and neither solver changes. The glyph block prints the lifted build with one line per glyph to apply and what each is worth, a count for the build, and its own certificate — or `proven maximum` with `--exact` — and is never below the plain BEST (#56)
  ```

- [ ] 2. Confirm the entry sits under `[Unreleased]` and not under a released version: `grep -n -A 6 "^## \[Unreleased\]" CHANGELOG.md`
     Expected: `### Added` followed by four `- [minor]` lines, the last ending `(#56)`.
- [ ] 3. Commit: `git add CHANGELOG.md && git commit -m "docs: changelog entry for power.mjs --glyph (#56)"`

---

## Chunk 6 — the full gate

### Task 17: Run the whole pre-commit gate

**Files:** none modified.

**Steps:**

- [ ] 1. Build: `npm run build`
     Expected: core, cli and web all build, exit 0.
- [ ] 2. Full test suite: `npm test`
     Expected: every test passes, exit 0. No file reports a failure or an unhandled warning. The count is the Task 1 baseline plus the 20 in `glyphs.test.mjs` and the 17 added to `power-cli.test.mjs`.
- [ ] 3. Lint: `npm run lint`
     Expected: exit 0, no output.
- [ ] 4. Confirm the two targeted files are green in isolation: `npx vitest run oracle/analytics/__tests__/glyphs.test.mjs`
     Expected: 20 tests pass.
- [ ] 5. Confirm the CLI file: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all tests pass, including the 17 added across Tasks 6–14.
- [ ] 6. Review the complete diff against `main` for anything unintended: `git diff main --stat`
     Expected: exactly six files changed — `CHANGELOG.md`, `oracle/analytics/README.md`, `oracle/analytics/glyphs.mjs`, `oracle/analytics/power.mjs`, `oracle/analytics/__tests__/glyphs.test.mjs`, `oracle/analytics/__tests__/power-cli.test.mjs` — plus the two `docs/plans/ai/issue-56-*.md` artifacts.
- [ ] 7. Confirm nothing stray is staged or untracked: `git status --short`
     Expected: clean. `.hivemind/` is gitignored, so scratch files never appear here.

---

## Acceptance criteria coverage

| Issue criterion | Tasks |
| --- | --- |
| `glyphs.mjs` exports `GLYPH_GRADES`, `GLYPH_LABELS`, `GLYPH_CAPS` exactly as tabled | 1 |
| `glyphs.mjs` exports `itemGrade` with the rank rule and the unknown-grade throw | 2 |
| `glyphs.mjs` exports `liftItem` — caps as a floor, crit untouched, main/asc untouched, no mutation, `lifts` in substat order | 3, 4 |
| `glyphs.mjs` exports `liftVault` — input order, `liftsById` exactly the lifted | 5 |
| `glyphs.mjs` header records the caps' provenance, the rank rule and the crit rule | 1 |
| `parsePowerArgs` takes `--glyph <grade>` in solve mode only, with the three messages | 6 |
| `USAGE.solve` shows `[--glyph G]` | 6 |
| Lifted vault and lifted worn gear | 10 |
| Default solver, or the exact one with `--exact` | 10, 14 |
| Never below the plain BEST, ties to the lifted solve | 10 (and 14 for the exact path) |
| Headline from `formatGlyphGain` | 7, 10 |
| Per-lift lines from `liftDelta` and `formatLift`, via `printBuild`'s `linesById` | 8, 9, 11 |
| `glyphs to apply: N` | 11 |
| The certificate, or `proven maximum` with `--exact` | 12, 14 |
| `--top` runners-up by the stated rule | 13 |
| README entry and the header usage block describe `--glyph` | 15 |
| Every test under the issue's Testing section passes | 1–14 |
| `npm run build`, `npm test`, `npm run lint` pass | 17 |

## Out of scope, as the issue states

Not implemented and not stubbed: a limited glyph budget or an ordering of which glyphs to apply beyond the per-lift values; mid-range (expected) roll values; lifting main or ascension stats; items below 5★; any change to `speed.mjs` or `speed-model.mjs`.

The post-merge human check — comparing a lifted piece's printed stats with the game after applying a real glyph of the chosen grade at its cap — is the account owner's, not a step here.
