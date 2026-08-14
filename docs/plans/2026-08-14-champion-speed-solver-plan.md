# Champion Speed Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a champion, find the item assignment across all nine slots that maximizes their speed, drawing from the entire vault, and prove it is the maximum.

**Architecture:** Pure modules under `oracle/analytics/` — a speed model (`itemSpeed`, `setEffect`), a set-bonus table as data, and a solver that enumerates set plans and runs a small exact assignment DP per plan. A thin CLI wires them to a snapshot. Nothing writes to any database.

**Tech Stack:** Node ESM (`.mjs`), `node:sqlite` behind `--experimental-sqlite`, vitest, fast-check for property tests.

**Spec:** `docs/plans/2026-08-14-champion-speed-solver-design.md`

## Global Constraints

- Node ESM only. Every new file is `.mjs` with `import`/`export`. No CommonJS.
- Read-only against snapshots. Never write to `oracle/resources/*.db` or the game's own DB.
- Pure exported functions above a banner comment; I/O and formatting below it. `main()` sits behind `if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();` so tests can import without side effects.
- Tests live in `oracle/analytics/__tests__/<module>.test.mjs` and are picked up by the root `vitest.config.ts` glob `oracle/analytics/**/*.test.mjs`.
- SPD is stat id **4** in our id space (`STAT_NAMES` in `packages/core/src/mappings.ts`).
- Set bonus rounding is **floor per completion**: `Σ floor(base × pct / 100)`, never a single floor over the summed percentage.
- The champion base-stat corpus is an **external local dataset**. Its path comes from `--corpus` or `$RSLH_SPEED_CORPUS`. Never vendor it into this repo and never reference the repository it comes from.
- Before every commit run `npm run build && npm test && npm run lint`.
- Commit trailer is exactly `Co-Authored-By: Claude` — no email, no model version.

---

### Task 1: Decode the artifact ascension stat

An ascended artifact carries a bonus stat in `ASCID`/`ASCFL`/`ASCLVLID` that the decoder ignores entirely. 203 artifacts carry a SPD ascension, 164 of them at +12 — as much as a strong substat. It carries **no glyph**: `ASCGV` is 0 in all 8,474 rows, as is the main-stat glyph `mgv`.

**Files:**
- Modify: `oracle/lib/decode.mjs`
- Modify: `oracle/analytics/decode.mjs`
- Test: `oracle/analytics/__tests__/decode.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ASC` (column descriptor `{ id, fl, base }`) exported from `oracle/lib/decode.mjs`; decoded items gain `ascStat: { statId: number, isFlat: boolean, value: number } | null`.

- [ ] **Step 1: Write the failing tests**

Append to `oracle/analytics/__tests__/decode.test.mjs`:

```javascript
import { decodeRow } from "../decode.mjs";

// A minimal Artifacts row. 2**32 == 4294967296, so `n * 2**32` encodes the integer n.
const row = (o = {}) => ({
  ID: 1, type: 4, rank: 6, rarity: 5, lvl: 16, mid: 4, mfl: 0, mlvlid: 30 * 2 ** 32,
  aset: 4, accset: 0, ASCLEVEL: 0, cID: 0, ASCID: 0, ASCFL: 0, ASCLVLID: 0,
  s1id: 0, s1fl: 0, s1lvl: 0, s1lvlid: 0, s1gv: 0, s1mlvlid: 0,
  s2id: 0, s2fl: 0, s2lvl: 0, s2lvlid: 0, s2gv: 0, s2mlvlid: 0,
  s3id: 0, s3fl: 0, s3lvl: 0, s3lvlid: 0, s3gv: 0, s3mlvlid: 0,
  s4id: 0, s4fl: 0, s4lvl: 0, s4lvlid: 0, s4gv: 0, s4mlvlid: 0,
  ...o,
});

test("decodeRow reads a SPD ascension stat", () => {
  const item = decodeRow(row({ ASCID: 4, ASCFL: 0, ASCLVLID: 12 * 2 ** 32, ASCLEVEL: 6 }));
  expect(item.ascStat).toEqual({ statId: 4, isFlat: false, value: 12 });
});

// ASCID is a DB stat id and needs the same remap as substats: DB 7 (C.RATE) -> our 5.
test("decodeRow remaps the ascension stat id into our id space", () => {
  const item = decodeRow(row({ ASCID: 7, ASCFL: 0, ASCLVLID: 0.15 * 2 ** 32 }));
  expect(item.ascStat.statId).toBe(5);
  expect(item.ascStat.value).toBe(15);
});

// The live DB holds ASCID 0 on un-ascended rows and -1 on some others. Neither is a stat.
test("decodeRow yields no ascension stat when ASCID is absent or -1", () => {
  expect(decodeRow(row({ ASCID: 0 })).ascStat).toBe(null);
  expect(decodeRow(row({ ASCID: -1, ASCLEVEL: -1 })).ascStat).toBe(null);
});

// ASCGV is 0 in every row of every snapshot checked, so the decoder must not invent a glyph field.
test("decodeRow's ascension stat carries no glyph field", () => {
  const item = decodeRow(row({ ASCID: 4, ASCLVLID: 12 * 2 ** 32 }));
  expect("glyph" in item.ascStat).toBe(false);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/decode.test.mjs`
Expected: FAIL — `item.ascStat` is `undefined`, not an object or `null`.

- [ ] **Step 3: Add the `ASC` descriptor**

In `oracle/lib/decode.mjs`, immediately after the `SUB` export:

```javascript
// The artifact ascension bonus stat, encoded exactly like a substat. There is deliberately no glyph
// column here: ASCGV is 0 in all 8474 rows of the 2026-08-12 snapshot, as is the main-stat glyph
// mgv, so glyphs only ever apply to substats. probe.mjs names its columns explicitly and never sees
// this.
export const ASC = { id: "ASCID", fl: "ASCFL", base: "ASCLVLID" };
```

- [ ] **Step 4: Decode it**

In `oracle/analytics/decode.mjs`, extend the import to include `ASC`:

```javascript
import { N, DBSTAT_TO_OURSTAT, decodeValue, SUB, ASC, readArtifactRows } from "../lib/decode.mjs";
```

Inside `decodeRow`, after the substat loop and before `const slot = N(row.type);`:

```javascript
  // Ascended artifacts carry one bonus stat. ASCID is 0 on un-ascended rows and -1 on a handful of
  // others, so the guard is `> 0` rather than truthiness.
  const ascDbId = N(row[ASC.id]);
  const ascFlat = N(row[ASC.fl]) !== 0;
  const ascStat = ascDbId > 0
    ? {
        statId: DBSTAT_TO_OURSTAT[ascDbId] ?? ascDbId,
        isFlat: ascFlat,
        value: decodeValue(ascDbId, ascFlat, row[ASC.base]),
      }
    : null;
```

Add `ascStat` to the returned object, on the line with `mainStat, substats`:

```javascript
    mainStat, substats, ascStat,
```

Extend `COLS` to select the new columns:

```javascript
const COLS = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset",
  "ASCLEVEL", "cID", ASC.id, ASC.fl, ASC.base,
  ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv, s.myth])].join(",");
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/decode.test.mjs`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 6: Verify against a real snapshot**

Run:

```bash
node --experimental-sqlite -e '
import("./oracle/analytics/decode.mjs").then(({ readArtifacts }) => {
  const { items } = readArtifacts("oracle/resources/2026-08-12-RSLHelper.db");
  const spd = items.filter((i) => i.ascStat?.statId === 4);
  console.log("SPD ascensions:", spd.length);
  const h = {};
  for (const i of spd) h[i.ascStat.value] = (h[i.ascStat.value] ?? 0) + 1;
  console.log(h);
});'
```

Expected: `SPD ascensions: 203`, with 164 of them at value 12.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/lib/decode.mjs oracle/analytics/decode.mjs oracle/analytics/__tests__/decode.test.mjs
git commit -m "feat(analytics): decode the artifact ascension bonus stat

203 artifacts carry a SPD ascension, 164 of them at +12 — worth as much
as a strong substat, and invisible to every consumer until now. ASCGV
and mgv are 0 in all 8474 rows, so it carries no glyph.

Co-Authored-By: Claude"
```

---

### Task 2: Extract champion reading into `champs.mjs`

`speed.mjs` needs `readChampRows`, `selectChamps`, `parseArgs` and `isRealChamp`, all of which currently live inside `champion-gear.mjs`. An analytics tool importing from another tool's CLI module is the wrong dependency direction, and the name matching with its "did you mean" suggestion is worth sharing rather than duplicating.

**Files:**
- Create: `oracle/analytics/champs.mjs`
- Modify: `oracle/analytics/champion-gear.mjs`
- Test: `oracle/analytics/__tests__/champs.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `readChampRows(dbPath) -> Array<Row>` where `Row` has `ID, Name, Role, Rarity, Rang, Lvl, Fraction, SPD, EmpLvl` as Numbers; `isRealChamp(row) -> boolean`; `parseArgs(argv) -> { selector: string|null, dbArg: string|undefined }`; `selectChamps(rows, selector) -> Array<Row>`. All four remain re-exported from `champion-gear.mjs`.

- [ ] **Step 1: Write the failing test**

Create `oracle/analytics/__tests__/champs.test.mjs`:

```javascript
// oracle/analytics/__tests__/champs.test.mjs
import { test, expect } from "vitest";
import { isRealChamp, parseArgs, selectChamps } from "../champs.mjs";
import * as gear from "../champion-gear.mjs";

const champ = (o = {}) => ({ ID: 110, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60,
  Fraction: 2, SPD: 242, EmpLvl: 0, ...o });

test("isRealChamp rejects placeholder rows with an empty or missing Name", () => {
  expect(isRealChamp(champ())).toBe(true);
  expect(isRealChamp(champ({ Name: "" }))).toBe(false);
  expect(isRealChamp(champ({ Name: "   " }))).toBe(false);
  expect(isRealChamp(champ({ Name: null }))).toBe(false);
});

test("parseArgs separates a snapshot path from a champion selector", () => {
  expect(parseArgs(["Elhain"])).toEqual({ selector: "Elhain", dbArg: undefined });
  expect(parseArgs(["a.db"])).toEqual({ selector: null, dbArg: "a.db" });
  expect(parseArgs(["Elhain", "x/y.db"])).toEqual({ selector: "Elhain", dbArg: "x/y.db" });
});

// An empty arg is no arg: an empty selector matches every champion by substring, which would turn a
// single-champion run into a run over the whole roster.
test("parseArgs drops empty arguments", () => {
  expect(parseArgs([""])).toEqual({ selector: null, dbArg: undefined });
});

test("selectChamps matches an all-digit selector as an exact ID", () => {
  const rows = [champ({ ID: 110 }), champ({ ID: 1101, Name: "Other" })];
  expect(selectChamps(rows, "110").map((r) => r.ID)).toEqual([110]);
});

test("selectChamps matches any other selector as a case-insensitive name substring", () => {
  const rows = [champ({ Name: "Elhain" }), champ({ Name: "Kael" })];
  expect(selectChamps(rows, "ELHA").map((r) => r.Name)).toEqual(["Elhain"]);
  expect(selectChamps(rows, null)).toHaveLength(2);
});

// champion-gear.mjs is the historical home of these; keeping the re-export means its own tests and
// any other caller keep working after the move.
test("champion-gear.mjs still re-exports the extracted helpers", () => {
  expect(gear.isRealChamp).toBe(isRealChamp);
  expect(gear.parseArgs).toBe(parseArgs);
  expect(gear.selectChamps).toBe(selectChamps);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run oracle/analytics/__tests__/champs.test.mjs`
Expected: FAIL — `Cannot find module '../champs.mjs'`.

- [ ] **Step 3: Create `champs.mjs`**

Create `oracle/analytics/champs.mjs`. Move the four functions verbatim out of `champion-gear.mjs`, keeping their comments, and add the three columns `speed.mjs` needs:

```javascript
// Reading and selecting rows from the snapshot's Champs table. Shared by champion-gear.mjs and
// speed.mjs so the champion-selection UX (exact ID vs name substring, "did you mean") is written
// once.
import { DatabaseSync } from "node:sqlite";

// Empty-Name rows are placeholders (they hold no gear, and they are the one place Role disagrees
// across copies of a name), so they never reach the matcher. `typeof` first because Name has no NOT
// NULL constraint, and `null.trim()` throws.
export const isRealChamp = (r) => typeof r.Name === "string" && r.Name.trim() !== "";

// An arg ending .db or containing a separator is the snapshot; the first other arg is the selector.
//
// An EMPTY arg is no arg. `speed.mjs ""` reaches here as [""], and an empty selector matches every
// champion by substring. Dropped here rather than in selectChamps because callers gate their mode on
// the parse result, not on the matcher.
export function parseArgs(argv) {
  const args = argv.filter((a) => a !== "");
  const dbArg = args.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  return { selector: args.find((a) => a !== dbArg) ?? null, dbArg };
}

// All digits -> the exact Champs.ID (IDs are opaque, so a substring match on one means nothing);
// any other text -> a case-insensitive Name substring; no selector -> everyone. Falsy rather than
// `=== null` so an empty or absent selector can't reach `.toLowerCase()`.
export function selectChamps(rows, selector) {
  if (!selector) return rows;
  if (/^\d+$/.test(selector)) return rows.filter((r) => Number(r.ID) === Number(selector));
  const nf = selector.toLowerCase();
  return rows.filter((r) => r.Name.toLowerCase().includes(nf));
}

// readOnly makes SELECT-only structural rather than conventional, and — the reason it's here — it
// refuses to CREATE the file: without it a typo'd snapshot path leaves a stray 0-byte .db behind
// before failing on the missing table. Fraction/SPD/EmpLvl are for speed.mjs; champion-gear.mjs
// ignores them.
export function readChampRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const st = db.prepare(
      "SELECT ID, Name, Role, Rarity, Rang, Lvl, Fraction, SPD, EmpLvl FROM Champs");
    st.setReadBigInts(true);
    const rows = st.all().map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    return rows.filter(isRealChamp);
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Re-export from `champion-gear.mjs`**

In `oracle/analytics/champion-gear.mjs`, delete the four moved definitions (`parseArgs`, `selectChamps`, `isRealChamp`, `readChampRows`) along with their comments, and add near the other imports:

```javascript
import { isRealChamp, parseArgs, readChampRows, selectChamps } from "./champs.mjs";

// Historical home of these four — re-exported so existing callers and tests keep working.
export { isRealChamp, parseArgs, readChampRows, selectChamps };
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/champs.test.mjs oracle/analytics/__tests__/champion-gear.test.mjs`
Expected: PASS for both files. The champion-gear suite must be green **unchanged** — that is the point of the re-export.

- [ ] **Step 6: Verify the CLI still runs**

Run: `node --experimental-sqlite oracle/analytics/champion-gear.mjs Elhain`
Expected: the usual per-slot KEEP/BORDERLINE/SELL readout, unchanged.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/champs.mjs oracle/analytics/champion-gear.mjs oracle/analytics/__tests__/champs.test.mjs
git commit -m "refactor(analytics): extract champion reading into champs.mjs

speed.mjs needs the same Champs reader and champion-selection UX, and
importing it from another tool's CLI module is the wrong dependency
direction. Re-exported from champion-gear.mjs so nothing breaks. Adds
Fraction/SPD/EmpLvl to the column list.

Co-Authored-By: Claude"
```

---

### Task 3: The speed set table and `setEffect`

**Files:**
- Create: `oracle/analytics/speed-sets.mjs`
- Test: `oracle/analytics/__tests__/speed-sets.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `CLASSIC_SPEED_SETS` (`Record<setId, {name, pieces, pct}>`), `TIERED_SPEED_SETS` (`Record<setId, {name, tiers: Array<[threshold, pct]>}>`), `SPEED_SET_IDS: number[]`, `firstThreshold(setId) -> number`, `usefulCounts(setId, maxSlots) -> number[]`, `speedTerms(counts: Map<number, number>) -> number[]`, `setEffect(base: number, counts: Map<number, number>) -> number`.

- [ ] **Step 1: Write the failing tests**

Create `oracle/analytics/__tests__/speed-sets.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-sets.test.mjs
import { test, expect } from "vitest";
import { speedTerms, setEffect, firstThreshold, usefulCounts, SPEED_SET_IDS } from "../speed-sets.mjs";

const counts = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));

// Classic sets STACK: 4 pieces of a 2-piece set is two completions.
test("classic sets stack by floor(count / pieces)", () => {
  expect(speedTerms(counts({ 4: 2 }))).toEqual([12]);
  expect(speedTerms(counts({ 4: 3 }))).toEqual([12]);
  expect(speedTerms(counts({ 4: 4 }))).toEqual([12, 12]);
  expect(speedTerms(counts({ 4: 6 }))).toEqual([12, 12, 12]);
  expect(speedTerms(counts({ 4: 1 }))).toEqual([]);
});

test("Instinct is the one 4-piece classic speed set", () => {
  expect(speedTerms(counts({ 50: 3 }))).toEqual([]);
  expect(speedTerms(counts({ 50: 4 }))).toEqual([12]);
  expect(speedTerms(counts({ 50: 8 }))).toEqual([12, 12]);
});

// Nine-slot sets do NOT stack: each threshold crossed unlocks an ADDITIONAL bonus.
test("tiered sets accumulate their thresholds instead of stacking", () => {
  expect(speedTerms(counts({ 58: 2 }))).toEqual([]);
  expect(speedTerms(counts({ 58: 3 }))).toEqual([10]);
  expect(speedTerms(counts({ 58: 4 }))).toEqual([10]);
  expect(speedTerms(counts({ 58: 5 }))).toEqual([10, 10]);
  expect(speedTerms(counts({ 58: 8 }))).toEqual([10, 10, 12]);
  expect(speedTerms(counts({ 58: 9 }))).toEqual([10, 10, 12]);
});

// Swift Parry's thresholds are 2/4/8, not the 3/5/8 every other tiered set uses.
test("Swift Parry uses 2/4/8 thresholds, unlike its neighbours", () => {
  expect(speedTerms(counts({ 35: 2 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 3 }))).toEqual([8]);
  expect(speedTerms(counts({ 35: 4 }))).toEqual([8, 10]);
  expect(speedTerms(counts({ 35: 8 }))).toEqual([8, 10, 10]);
});

test("Merciless and Stonecleaver use 3/7, Slayer uses 3/8", () => {
  expect(speedTerms(counts({ 59: 6 }))).toEqual([5]);
  expect(speedTerms(counts({ 59: 7 }))).toEqual([5, 5]);
  expect(speedTerms(counts({ 63: 7 }))).toEqual([5, 5]);
  expect(speedTerms(counts({ 60: 7 }))).toEqual([5]);
  expect(speedTerms(counts({ 60: 8 }))).toEqual([5, 5]);
});

test("sets outside the table grant nothing, including accessory-only sets", () => {
  expect(speedTerms(counts({ 48: 6, 46: 4, 1003: 3 }))).toEqual([]);
});

// The game floors EACH bonus against base separately. Summing the percentages first and flooring
// once gives a different answer: base 105 at 12%+12% is 12+12=24, not floor(105*0.24)=25.
test("setEffect floors each completion separately, not the summed percentage", () => {
  expect(setEffect(105, counts({ 4: 4 }))).toBe(24);
  expect(Math.floor(105 * 0.24)).toBe(25);
});

test("setEffect sums across different sets", () => {
  // Speed x2 (12%) + Perception x2 (5%) on base 100 -> 12 + 5.
  expect(setEffect(100, counts({ 4: 2, 38: 2 }))).toBe(17);
});

test("setEffect is 0 for an empty build", () => {
  expect(setEffect(110, new Map())).toBe(0);
});

test("firstThreshold reports the minimum pieces before any bonus", () => {
  expect(firstThreshold(4)).toBe(2);
  expect(firstThreshold(50)).toBe(4);
  expect(firstThreshold(35)).toBe(2);
  expect(firstThreshold(58)).toBe(3);
});

// Only counts that change the bonus are worth a solver plan. For a 2-piece stacking set that is
// 2/4/6; for a tiered set it is exactly its thresholds.
test("usefulCounts lists only the counts that change the bonus", () => {
  expect(usefulCounts(4, 9)).toEqual([2, 4, 6, 8]);
  expect(usefulCounts(4, 5)).toEqual([2, 4]);
  expect(usefulCounts(58, 9)).toEqual([3, 5, 8]);
  expect(usefulCounts(58, 6)).toEqual([3, 5]);
  expect(usefulCounts(58, 2)).toEqual([]);
});

test("SPEED_SET_IDS covers exactly the 18 sets in the two tables", () => {
  expect(SPEED_SET_IDS).toHaveLength(18);
  expect(SPEED_SET_IDS).toContain(4);
  expect(SPEED_SET_IDS).toContain(35);
  expect(SPEED_SET_IDS).not.toContain(48);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
Expected: FAIL — `Cannot find module '../speed-sets.mjs'`.

- [ ] **Step 3: Write `speed-sets.mjs`**

Create `oracle/analytics/speed-sets.mjs`:

```javascript
// Which artifact sets grant SPEED, and how much. Two different mechanics live here:
//
//   CLASSIC sets STACK. A set contributes floor(count / pieces) completions, each worth `pct`.
//     Six pieces of Speed is three completions, +36%.
//   TIERED (nine-slot) sets DO NOT stack. Crossing each successive threshold unlocks an ADDITIONAL
//     bonus, and they accumulate. Nine pieces of Supersonic is 10+10+12 = 32%, not four completions.
//
// Accessories count toward the piece total of any set that can roll on them (35, 36, 47, 48, 58-66);
// the classic sets above are artifact-only, so they cap at 6 pieces.
//
// Every set absent from both tables grants 0% speed, including all accessory-only sets (1000-1004).
// Values are game data, dictated rather than derived: relic speed is per-champion, invisible to the
// DB, and the same magnitude as these bonuses, so fitting them from the vault cannot separate the
// two. See the design doc's evidence appendix.

export const CLASSIC_SPEED_SETS = {
  4:  { name: "Speed",        pieces: 2, pct: 12 },
  34: { name: "Divine Speed", pieces: 2, pct: 12 },
  53: { name: "Impulse",      pieces: 2, pct: 12 },
  57: { name: "Righteous",    pieces: 2, pct: 10 },
  38: { name: "Perception",   pieces: 2, pct: 5 },
  50: { name: "Instinct",     pieces: 4, pct: 12 },
};

// Ascending [threshold, pct] pairs. Most tiered sets share 3/5/8; Swift Parry does not.
const T = (a, b, c) => [[3, a], [5, b], [8, c]];

export const TIERED_SPEED_SETS = {
  58: { name: "Supersonic",   tiers: T(10, 10, 12) },
  62: { name: "Pinpoint",     tiers: T(10, 10, 12) },
  36: { name: "Deflection",   tiers: T(10, 10, 12) },
  65: { name: "Chronophage",  tiers: T(10, 10, 12) },
  64: { name: "Rebirth",      tiers: T(10, 10, 12) },
  66: { name: "Mercurial",    tiers: T(8, 12, 12) },
  47: { name: "Protection",   tiers: T(12, 12, 8) },
  35: { name: "Swift Parry",  tiers: [[2, 8], [4, 10], [8, 10]] },
  61: { name: "Feral",        tiers: T(5, 5, 5) },
  59: { name: "Merciless",    tiers: [[3, 5], [7, 5]] },
  63: { name: "Stonecleaver", tiers: [[3, 5], [7, 5]] },
  60: { name: "Slayer",       tiers: [[3, 5], [8, 5]] },
};

export const SPEED_SET_IDS = [
  ...Object.keys(CLASSIC_SPEED_SETS), ...Object.keys(TIERED_SPEED_SETS),
].map(Number);

export const speedSetName = (setId) =>
  CLASSIC_SPEED_SETS[setId]?.name ?? TIERED_SPEED_SETS[setId]?.name ?? null;

// Pieces needed before a set grants anything at all. Used by the solver to reject plans a pool
// cannot supply, and to bound how many sets can be active at once.
export function firstThreshold(setId) {
  const c = CLASSIC_SPEED_SETS[setId];
  if (c) return c.pieces;
  const t = TIERED_SPEED_SETS[setId];
  return t ? t.tiers[0][0] : Infinity;
}

// The only piece counts worth planning around: any count between two of these gives exactly the
// bonus of the lower one, so the solver would be enumerating identical builds. Bounded by maxSlots,
// which is however many slots of this set the pool can actually supply.
export function usefulCounts(setId, maxSlots) {
  const out = [];
  const c = CLASSIC_SPEED_SETS[setId];
  if (c) {
    for (let n = c.pieces; n <= maxSlots; n += c.pieces) out.push(n);
    return out;
  }
  const t = TIERED_SPEED_SETS[setId];
  if (!t) return out;
  for (const [threshold] of t.tiers) if (threshold <= maxSlots) out.push(threshold);
  return out;
}

// Every percentage a build earns, as a flat list — one entry per completed classic set and per
// unlocked tier. A list rather than a sum because the game floors EACH against base separately.
// `counts` maps setId -> how many of the nine equipped items carry that set.
export function speedTerms(counts) {
  const terms = [];
  for (const [setId, count] of counts) {
    const c = CLASSIC_SPEED_SETS[setId];
    if (c) {
      for (let n = Math.floor(count / c.pieces); n > 0; n--) terms.push(c.pct);
      continue;
    }
    const t = TIERED_SPEED_SETS[setId];
    if (!t) continue;
    for (const [threshold, pct] of t.tiers) if (count >= threshold) terms.push(pct);
  }
  return terms;
}

// Speed granted by set bonuses. Floor per completion — summing the percentages first and flooring
// once is off by a point or two, and the snapshot says per-completion is the rule.
export function setEffect(base, counts) {
  return speedTerms(counts).reduce((sum, pct) => sum + Math.floor(base * pct / 100), 0);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-sets.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed-sets.mjs oracle/analytics/__tests__/speed-sets.test.mjs
git commit -m "feat(analytics): speed set bonus table and setEffect

Two mechanics: classic artifact sets stack by floor(count/pieces),
nine-slot sets accumulate tier thresholds instead. Rounding is floor per
completion, which the snapshot picks over flooring the summed percentage.

Co-Authored-By: Claude"
```

---

### Task 4: The speed model — `itemSpeed`, glyph clamping, `buildSpeed`, `measureConstant`

**Files:**
- Create: `oracle/analytics/speed-model.mjs`
- Test: `oracle/analytics/__tests__/speed-model.test.mjs`

**Interfaces:**
- Consumes: `setEffect` from `speed-sets.mjs` (Task 3); items carrying `ascStat` (Task 1).
- Produces: `SPD = 4`; `itemSpeed(item, glyphFloor = 0) -> number`; `glyphCeilings(items) -> Map<string, number>`; `clampFloor(item, glyphFloor, ceilings) -> number`; `speedOfWith(glyphFloor, ceilings) -> (item) => number`; `setCounts(items) -> Map<number, number>`; `buildSpeed(base, constant, items, speedOf) -> number`; `measureConstant(observedSpd, base, currentGear, speedOf) -> number`.

- [ ] **Step 1: Write the failing tests**

Create `oracle/analytics/__tests__/speed-model.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-model.test.mjs
import { test, expect } from "vitest";
import { itemSpeed, glyphCeilings, clampFloor, speedOfWith, setCounts, buildSpeed, measureConstant }
  from "../speed-model.mjs";

const sub = (statId, value, glyph = 0) => ({ statId, isFlat: false, rolls: 0, value, glyph });
const item = (o = {}) => ({
  id: 1, slot: 4, set: 4, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 4, isFlat: false, value: 30 }, substats: [], ascStat: null,
  ascLevel: 0, equippedChampId: 0, ...o,
});

test("itemSpeed reads a SPD main stat", () => {
  expect(itemSpeed(item())).toBe(30);
  expect(itemSpeed(item({ mainStat: { statId: 1, isFlat: false, value: 60 } }))).toBe(0);
});

test("itemSpeed sums SPD substats and ignores the rest", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 12), sub(5, 20), sub(4, 7)] });
  expect(itemSpeed(it)).toBe(19);
});

// The glyph is NOT already folded into substat.value: predicting champion totals with it added is
// exact for 99/243 champions against 41/243 without.
test("itemSpeed adds the substat glyph on top of the substat value", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 5)] });
  expect(itemSpeed(it)).toBe(17);
});

test("itemSpeed adds a SPD ascension stat, and ignores a non-SPD one", () => {
  const base = { mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 10)] };
  expect(itemSpeed(item({ ...base, ascStat: { statId: 4, isFlat: false, value: 12 } }))).toBe(22);
  expect(itemSpeed(item({ ...base, ascStat: { statId: 3, isFlat: false, value: 20 } }))).toBe(10);
  expect(itemSpeed(item({ ...base, ascStat: null }))).toBe(10);
});

// A glyph can only lift a stat the item already carries, so the floor never conjures a SPD substat.
test("glyphFloor lifts existing SPD substat glyphs and nothing else", () => {
  const withSpd = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 3)] });
  expect(itemSpeed(withSpd, 8)).toBe(20);
  const noSpd = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(5, 20, 3)] });
  expect(itemSpeed(noSpd, 8)).toBe(0);
});

test("glyphFloor never lowers a glyph that is already higher", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 12, 11)] });
  expect(itemSpeed(it, 8)).toBe(23);
});

test("glyphFloor does not touch the ascension stat, which carries no glyph", () => {
  const it = item({ mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [],
    ascStat: { statId: 4, isFlat: false, value: 12 } });
  expect(itemSpeed(it, 8)).toBe(12);
});

test("glyphCeilings records the highest SPD glyph seen per rarity and rank", () => {
  const ceil = glyphCeilings([
    item({ rarity: 5, rank: 6, substats: [sub(4, 10, 12)] }),
    item({ rarity: 5, rank: 6, substats: [sub(4, 10, 7)] }),
    item({ rarity: 4, rank: 5, substats: [sub(4, 10, 4)] }),
    item({ rarity: 4, rank: 5, substats: [sub(1, 10, 9)] }),
  ]);
  expect(ceil.get("5|6")).toBe(12);
  expect(ceil.get("4|5")).toBe(4);
});

// Without the clamp, --glyph 20 invents speed no item of that tier can carry.
test("clampFloor caps the requested floor at the item's rarity x rank ceiling", () => {
  const ceil = new Map([["5|6", 12], ["4|5", 4]]);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 20, ceil)).toBe(12);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 8, ceil)).toBe(8);
  expect(clampFloor(item({ rarity: 4, rank: 5 }), 8, ceil)).toBe(4);
});

// An unseen bucket carries no evidence either way, so it is left alone rather than silently zeroed.
test("clampFloor leaves an unseen rarity x rank bucket unclamped, and 0 stays 0", () => {
  expect(clampFloor(item({ rarity: 2, rank: 1 }), 8, new Map())).toBe(8);
  expect(clampFloor(item({ rarity: 5, rank: 6 }), 0, new Map([["5|6", 12]]))).toBe(0);
});

test("setCounts tallies sets across a build and ignores setless items", () => {
  const counts = setCounts([item({ set: 4 }), item({ set: 4 }), item({ set: 38 }), item({ set: 0 })]);
  expect(counts.get(4)).toBe(2);
  expect(counts.get(38)).toBe(1);
  expect(counts.has(0)).toBe(false);
});

test("buildSpeed is base + set effect + item speed + constant", () => {
  const items = [
    item({ set: 4, mainStat: { statId: 4, isFlat: false, value: 30 } }),
    item({ set: 4, mainStat: { statId: 2, isFlat: false, value: 60 }, substats: [sub(4, 10)] }),
  ];
  // base 100, Speed x2 -> floor(100 * 0.12) = 12, items 30 + 10 = 40, constant 7.
  expect(buildSpeed(100, 7, items, (it) => itemSpeed(it))).toBe(159);
});

// The constant is whatever the model cannot account for: faction guardians, champion ascension,
// relic. Measured once from current gear, and gear-independent thereafter.
test("measureConstant returns the unexplained remainder of the observed speed", () => {
  const items = [item({ set: 0, mainStat: { statId: 4, isFlat: false, value: 30 } })];
  // base 100 + no set + 30 = 130; observed 140 leaves 10 unexplained.
  expect(measureConstant(140, 100, items, (it) => itemSpeed(it))).toBe(10);
  expect(measureConstant(130, 100, items, (it) => itemSpeed(it))).toBe(0);
});

test("measureConstant handles an ungeared champion", () => {
  expect(measureConstant(113, 110, [], (it) => itemSpeed(it))).toBe(3);
});

test("speedOfWith produces a per-item valuation that applies the clamped floor", () => {
  const ceil = new Map([["5|6", 6]]);
  const speedOf = speedOfWith(10, ceil);
  const it = item({ rarity: 5, rank: 6, mainStat: { statId: 2, isFlat: false, value: 60 },
    substats: [sub(4, 12, 2)] });
  expect(speedOf(it)).toBe(18);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-model.test.mjs`
Expected: FAIL — `Cannot find module '../speed-model.mjs'`.

- [ ] **Step 3: Write `speed-model.mjs`**

Create `oracle/analytics/speed-model.mjs`:

```javascript
// The speed model:
//
//   speed = base                                 champion base speed, from the corpus
//         + Σ setEffect(base, completed sets)    floor(base * pct) per completion / unlocked tier
//         + Σ itemSpeed(item)                    over the nine equipped items
//         + constant                             flat sources the DB doesn't expose
//
// `constant` is measured once per champion and sweeps up faction guardians, champion ascension and
// relic. It is kept OUT of base deliberately: set bonuses multiply base but not the constant, so
// folding them together applies the percentage to the relic too. On a champion with 62 points of
// unexplained speed and 36% of set bonus that is a 22-speed error, and it biases the solver toward
// set bonuses over flat speed — exactly the trade-off it exists to weigh.
import { setEffect } from "./speed-sets.mjs";

export const SPD = 4;   // STAT_NAMES id for SPD

// Speed this item contributes. `glyphFloor` raises every SPD SUBSTAT glyph to at least that value.
// Glyphs only ever apply to substats — ASCGV and mgv are 0 in all 8474 rows of the 2026-08-12
// snapshot — and a glyph can only lift a stat the item already has, so the floor never conjures
// speed onto an item with no SPD substat.
export function itemSpeed(item, glyphFloor = 0) {
  let total = 0;
  if (item.mainStat.statId === SPD) total += item.mainStat.value;
  for (const s of item.substats) {
    if (s.statId !== SPD) continue;
    total += s.value + Math.max(s.glyph, glyphFloor);
  }
  if (item.ascStat?.statId === SPD) total += item.ascStat.value;
  return total;
}

// Highest SPD substat glyph the vault has actually been seen to carry, per rarity x rank. Derived
// from the data rather than hardcoded so it tracks whatever the game currently allows.
export function glyphCeilings(items) {
  const ceilings = new Map();
  for (const item of items) {
    for (const s of item.substats) {
      if (s.statId !== SPD || s.glyph <= 0) continue;
      const key = `${item.rarity}|${item.rank}`;
      if (s.glyph > (ceilings.get(key) ?? 0)) ceilings.set(key, s.glyph);
    }
  }
  return ceilings;
}

// The floor actually applicable to one item: never above what its rarity x rank has been seen to
// carry, because `--glyph 20` would otherwise invent speed that cannot exist. A bucket with no
// observations carries no evidence, so it is left unclamped rather than silently zeroed.
export function clampFloor(item, glyphFloor, ceilings) {
  if (glyphFloor <= 0) return 0;
  const ceiling = ceilings.get(`${item.rarity}|${item.rank}`);
  return ceiling === undefined ? glyphFloor : Math.min(glyphFloor, ceiling);
}

// One valuation function for a whole run, so the solver never has to carry the ceilings around.
export const speedOfWith = (glyphFloor, ceilings) =>
  (item) => itemSpeed(item, clampFloor(item, glyphFloor, ceilings));

// setId -> how many of these items carry it. Setless items (set 0) belong to no set and are skipped.
export function setCounts(items) {
  const counts = new Map();
  for (const item of items) {
    if (!item.set) continue;
    counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
  }
  return counts;
}

export function buildSpeed(base, constant, items, speedOf) {
  const flat = items.reduce((sum, item) => sum + speedOf(item), 0);
  return base + setEffect(base, setCounts(items)) + flat + constant;
}

// Everything the model cannot account for, measured against the champion's CURRENT gear. It is flat
// and gear-independent, so it carries unchanged into any candidate build. For an ungeared champion
// this is simply observed - base.
export function measureConstant(observedSpd, base, currentGear, speedOf) {
  return observedSpd - buildSpeed(base, 0, currentGear, speedOf);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-model.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed-model.mjs oracle/analytics/__tests__/speed-model.test.mjs
git commit -m "feat(analytics): the champion speed model

itemSpeed over main/substat/ascension, glyph floors clamped to what each
rarity x rank has been seen to carry, and a measured constant for the
flat sources the DB does not expose. The constant stays out of base
because set bonuses multiply base but not it.

Co-Authored-By: Claude"
```

---

### Task 5: The candidate index

**Files:**
- Create: `oracle/analytics/speed-solve.mjs`
- Test: `oracle/analytics/__tests__/speed-solve.test.mjs`

**Interfaces:**
- Consumes: `speedOfWith` from `speed-model.mjs` (Task 4).
- Produces: `SLOTS: number[]`; `buildIndex(items, faction, speedOf) -> Map<slot, Map<setId, {item, speed}>>`.

- [ ] **Step 1: Write the failing tests**

Create `oracle/analytics/__tests__/speed-solve.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-solve.test.mjs
import { test, expect } from "vitest";
import { buildIndex, SLOTS } from "../speed-solve.mjs";
import { itemSpeed } from "../speed-model.mjs";

const speedOf = (it) => itemSpeed(it);
const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 5, level: 16, faction: 0,
  isAccessory: false, mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [], ascStat: null, ascLevel: 0, equippedChampId: 0, ...o,
});
const spd = (n) => [{ statId: 4, isFlat: false, rolls: 0, value: n, glyph: 0 }];

test("SLOTS covers all nine equipment slots", () => {
  expect(SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("buildIndex keeps only the fastest item of each set in each slot", () => {
  const index = buildIndex([
    item({ id: 1, slot: 1, set: 4, substats: spd(10) }),
    item({ id: 2, slot: 1, set: 4, substats: spd(18) }),
    item({ id: 3, slot: 1, set: 38, substats: spd(14) }),
  ], 0, speedOf);
  expect(index.get(1).get(4).item.id).toBe(2);
  expect(index.get(1).get(4).speed).toBe(18);
  expect(index.get(1).get(38).item.id).toBe(3);
});

// The faction lock is a hard game rule: 1401 equipped accessories in the 2026-08-12 snapshot, zero
// of them on a champion of another faction.
test("buildIndex drops accessories of the wrong faction and keeps artifacts regardless", () => {
  const index = buildIndex([
    item({ id: 1, slot: 7, isAccessory: true, faction: 2, substats: spd(10) }),
    item({ id: 2, slot: 7, isAccessory: true, faction: 5, substats: spd(20) }),
    item({ id: 3, slot: 1, isAccessory: false, faction: 5, substats: spd(9) }),
  ], 2, speedOf);
  expect(index.get(7).get(4).item.id).toBe(1);
  expect(index.get(1).get(4).item.id).toBe(3);
});

test("buildIndex omits a slot entirely when nothing is eligible for it", () => {
  const index = buildIndex([
    item({ id: 1, slot: 8, isAccessory: true, faction: 9, substats: spd(10) }),
  ], 2, speedOf);
  expect(index.has(8)).toBe(false);
});

// A tie must not depend on row order, or the same run prints different builds.
test("buildIndex breaks ties on the lower item id so output is stable", () => {
  const forward = buildIndex([
    item({ id: 7, slot: 1, substats: spd(12) }), item({ id: 3, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  const reverse = buildIndex([
    item({ id: 3, slot: 1, substats: spd(12) }), item({ id: 7, slot: 1, substats: spd(12) }),
  ], 0, speedOf);
  expect(forward.get(1).get(4).item.id).toBe(3);
  expect(reverse.get(1).get(4).item.id).toBe(3);
});

test("buildIndex indexes setless items under set 0", () => {
  const index = buildIndex([item({ id: 1, slot: 1, set: 0, substats: spd(11) })], 0, speedOf);
  expect(index.get(1).get(0).speed).toBe(11);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-solve.test.mjs`
Expected: FAIL — `Cannot find module '../speed-solve.mjs'`.

- [ ] **Step 3: Write the index half of `speed-solve.mjs`**

Create `oracle/analytics/speed-solve.mjs`:

```javascript
// Exact maximum-speed gear solver. See the design doc for why this is plan enumeration plus a small
// assignment DP rather than one DP over all set counts.
import { setEffect } from "./speed-sets.mjs";
import { buildSpeed, setCounts } from "./speed-model.mjs";
import { SPEED_SET_IDS, firstThreshold, usefulCounts } from "./speed-sets.mjs";

export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// slot -> setId -> the fastest item of that set in that slot. For a fixed slot->set assignment
// nothing else about a slot matters, so this IS the search space: 8474 items collapse to about 1011
// entries. Accessory slots (7-9) are filtered to the champion's faction, a hard game constraint.
// Ties break on the lower item id so a rerun prints the same build.
export function buildIndex(items, faction, speedOf) {
  const index = new Map();
  for (const item of items) {
    if (item.isAccessory && item.faction !== faction) continue;
    let bySet = index.get(item.slot);
    if (!bySet) index.set(item.slot, (bySet = new Map()));
    const speed = speedOf(item);
    const current = bySet.get(item.set);
    if (!current || speed > current.speed
      || (speed === current.speed && item.id < current.item.id)) {
      bySet.set(item.set, { item, speed });
    }
  }
  return index;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-solve.test.mjs`
Expected: PASS, all six cases.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed-solve.mjs oracle/analytics/__tests__/speed-solve.test.mjs
git commit -m "feat(analytics): candidate index for the speed solver

Collapses 8474 items to ~1011 (slot, set) entries — for a fixed slot to
set assignment nothing else about a slot matters. Accessory slots are
filtered to the champion's faction; ties break on item id so reruns are
stable.

Co-Authored-By: Claude"
```

---

### Task 6: Plan enumeration and the assignment DP

**Files:**
- Modify: `oracle/analytics/speed-solve.mjs`
- Test: `oracle/analytics/__tests__/speed-solve.test.mjs`
- Test: `oracle/analytics/__tests__/speed-solve.prop.test.mjs`

**Interfaces:**
- Consumes: `buildIndex` (Task 5), `setEffect`/`firstThreshold`/`usefulCounts`/`SPEED_SET_IDS` (Task 3), `buildSpeed`/`setCounts` (Task 4).
- Produces: `slotsSupplying(index, setId) -> number`; `viableSets(index) -> number[]`; `enumeratePlans(index, sets) -> Array<Array<{setId, count}>>`; `assign(index, plan) -> item[] | null`; `solve(index, base, constant, speedOf) -> { speed, items, plan } | null`.

- [ ] **Step 1: Write the failing unit tests**

Append to `oracle/analytics/__tests__/speed-solve.test.mjs`:

```javascript
import { slotsSupplying, viableSets, enumeratePlans, assign, solve } from "../speed-solve.mjs";
import { speedOfWith } from "../speed-model.mjs";

const pool = (specs) => specs.map((s, i) => item({ id: i + 1, ...s }));
const plain = speedOfWith(0, new Map());

test("slotsSupplying counts distinct slots that can supply a set", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 2, set: 4, substats: spd(10) },
    { slot: 2, set: 4, substats: spd(12) }, { slot: 3, set: 38, substats: spd(10) },
  ]), 0, plain);
  expect(slotsSupplying(index, 4)).toBe(2);
  expect(slotsSupplying(index, 38)).toBe(1);
  expect(slotsSupplying(index, 66)).toBe(0);
});

// A set that cannot reach its first threshold can never contribute, so it must not enter the plan
// space — that is what keeps enumeration small.
test("viableSets keeps only speed sets whose first threshold the pool can reach", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 2, set: 4, substats: spd(10) },
    { slot: 3, set: 38, substats: spd(10) },
    { slot: 4, set: 48, substats: spd(10) }, { slot: 5, set: 48, substats: spd(10) },
  ]), 0, plain);
  expect(viableSets(index).sort((a, b) => a - b)).toEqual([4]);
});

test("enumeratePlans always includes the empty plan", () => {
  const index = buildIndex(pool([{ slot: 1, set: 0, substats: spd(10) }]), 0, plain);
  expect(enumeratePlans(index, [])).toEqual([[]]);
});

test("enumeratePlans lists each viable count for a single set", () => {
  const index = buildIndex(pool(
    [1, 2, 3, 4].map((slot) => ({ slot, set: 4, substats: spd(10) }))), 0, plain);
  expect(enumeratePlans(index, [4])).toEqual([[], [{ setId: 4, count: 2 }], [{ setId: 4, count: 4 }]]);
});

// Nine slots and a minimum threshold of two pieces cap the number of simultaneously active sets at
// four. That bound is what makes enumeration tractable at all.
test("enumeratePlans never exceeds nine slots or four active sets", () => {
  const specs = [];
  for (const set of [4, 34, 53, 57, 38]) {
    for (let slot = 1; slot <= 6; slot++) specs.push({ slot, set, substats: spd(10) });
  }
  const index = buildIndex(pool(specs), 0, plain);
  for (const plan of enumeratePlans(index, [4, 34, 53, 57, 38])) {
    expect(plan.length).toBeLessThanOrEqual(4);
    expect(plan.reduce((s, p) => s + p.count, 0)).toBeLessThanOrEqual(9);
  }
});

test("assign fills every available slot and honours the plan's counts", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 1, set: 0, substats: spd(30) },
    { slot: 2, set: 4, substats: spd(10) }, { slot: 2, set: 0, substats: spd(30) },
    { slot: 3, set: 0, substats: spd(30) },
  ]), 0, plain);
  const picks = assign(index, [{ setId: 4, count: 2 }]);
  expect(picks).toHaveLength(3);
  expect(picks.filter((p) => p.set === 4)).toHaveLength(2);
});

test("assign returns null when the plan needs more slots than exist", () => {
  const index = buildIndex(pool([{ slot: 1, set: 4, substats: spd(10) }]), 0, plain);
  expect(assign(index, [{ setId: 4, count: 2 }])).toBe(null);
});

// The set bonus has to beat the flat speed given up to earn it, and the solver has to notice.
test("solve commits slots to a set only when the bonus beats the flat speed forgone", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(10) }, { slot: 1, set: 0, substats: spd(11) },
    { slot: 2, set: 4, substats: spd(10) }, { slot: 2, set: 0, substats: spd(11) },
  ]), 0, plain);
  // Speed x2 on base 100 is +12 for 2 speed forgone -> take the set.
  expect(solve(index, 100, 0, plain).speed).toBe(100 + 12 + 20);
  // On base 10 the same set is worth +1, which does not pay for 2 speed -> skip it.
  expect(solve(index, 10, 0, plain).speed).toBe(10 + 22);
});

test("solve carries the constant through untouched", () => {
  const index = buildIndex(pool([{ slot: 1, set: 0, substats: spd(10) }]), 0, plain);
  expect(solve(index, 100, 17, plain).speed).toBe(127);
});

test("solve returns null for an empty index", () => {
  expect(solve(new Map(), 100, 0, plain)).toBe(null);
});

// A free slot's item belongs to some set and can complete one by accident. Scoring the ACTUAL items
// rather than the plan means the reported number is never an under-count.
test("solve scores the items it picked, not the plan it picked them under", () => {
  const index = buildIndex(pool([
    { slot: 1, set: 4, substats: spd(30) }, { slot: 2, set: 4, substats: spd(30) },
  ]), 0, plain);
  const best = solve(index, 100, 0, plain);
  expect(best.speed).toBe(100 + 12 + 60);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-solve.test.mjs`
Expected: FAIL — `slotsSupplying is not a function` and the same for the other four new exports.

- [ ] **Step 3: Implement enumeration, assignment and solve**

Append to `oracle/analytics/speed-solve.mjs`:

```javascript
// How many distinct slots could contribute a piece of this set. A set needs at least its first
// threshold's worth of slots before it can grant anything.
export function slotsSupplying(index, setId) {
  let n = 0;
  for (const bySet of index.values()) if (bySet.has(setId)) n++;
  return n;
}

// The speed sets this pool could actually complete. Everything else is dead weight in the plan
// space, and pruning it here is what keeps enumeration small.
export function viableSets(index) {
  return SPEED_SET_IDS.filter((setId) => slotsSupplying(index, setId) >= firstThreshold(setId));
}

// Every set allocation worth trying: pick up to four viable sets and give each a count that changes
// its bonus. Four is not a tuning knob — nine slots at a two-piece minimum threshold cannot support
// a fifth active set. Counts come from usefulCounts, so a count between two thresholds (which grants
// exactly the lower threshold's bonus) is never enumerated twice.
export function enumeratePlans(index, sets) {
  const plans = [[]];
  const extend = (from, current, used) => {
    if (current.length === 4) return;
    for (let i = from; i < sets.length; i++) {
      const setId = sets[i];
      const room = Math.min(slotsSupplying(index, setId), SLOTS.length - used);
      for (const count of usefulCounts(setId, room)) {
        const next = [...current, { setId, count }];
        plans.push(next);
        extend(i + 1, next, used + count);
      }
    }
  };
  extend(0, [], 0);
  return plans;
}

// Best item in a slot regardless of set — what an unassigned slot takes. Ties break on item id.
function freeBest(bySet) {
  let best = null;
  for (const entry of bySet.values()) {
    if (!best || entry.speed > best.speed
      || (entry.speed === best.speed && entry.item.id < best.item.id)) best = entry;
  }
  return best;
}

// Assign each slot to one of the plan's sets or leave it free, maximising summed item speed subject
// to the plan's counts. State is how many of each plan entry have been placed, which is small enough
// (nine slots, at most four entries) that this is exact rather than heuristic. Returns null when the
// plan cannot be satisfied. Every slot is always filled: item speed is never negative, so an empty
// slot can never win.
export function assign(index, plan) {
  const slots = SLOTS.filter((slot) => index.has(slot));
  const need = plan.map((p) => p.count);
  if (need.reduce((sum, n) => sum + n, 0) > slots.length) return null;

  let states = new Map([[need.map(() => 0).join(","), { speed: 0, picks: [] }]]);
  for (const slot of slots) {
    const bySet = index.get(slot);
    const free = freeBest(bySet);
    const next = new Map();
    const offer = (key, speed, picks) => {
      const current = next.get(key);
      if (!current || speed > current.speed) next.set(key, { speed, picks });
    };
    for (const [key, state] of states) {
      const placed = key.split(",").map(Number);
      for (let i = 0; i < plan.length; i++) {
        if (placed[i] >= need[i]) continue;
        const entry = bySet.get(plan[i].setId);
        if (!entry) continue;
        const advanced = placed.map((v, j) => (j === i ? v + 1 : v)).join(",");
        offer(advanced, state.speed + entry.speed, [...state.picks, entry.item]);
      }
      if (free) offer(key, state.speed + free.speed, [...state.picks, free.item]);
    }
    states = next;
    if (states.size === 0) return null;
  }
  return states.get(need.join(","))?.picks ?? null;
}

// The provable maximum, not a heuristic. Every plan is enumerated and each resulting build is scored
// on the items it actually contains — a free slot's item belongs to some set and may complete one by
// accident, so scoring the plan instead would under-report.
//
// The branch-and-bound is safe despite that: an optimal build's own naming plan has a bound at least
// equal to its score, so it can only be pruned by an incumbent that already equals it.
export function solve(index, base, constant, speedOf) {
  const slots = SLOTS.filter((slot) => index.has(slot));
  if (slots.length === 0) return null;
  const maxFlat = slots.reduce((sum, slot) => sum + freeBest(index.get(slot)).speed, 0);

  let best = null;
  for (const plan of enumeratePlans(index, viableSets(index))) {
    if (best) {
      const counts = new Map(plan.map((p) => [p.setId, p.count]));
      if (base + setEffect(base, counts) + maxFlat + constant <= best.speed) continue;
    }
    const picks = assign(index, plan);
    if (!picks) continue;
    const speed = buildSpeed(base, constant, picks, speedOf);
    if (!best || speed > best.speed) best = { speed, items: picks, plan, counts: setCounts(picks) };
  }
  return best;
}
```

- [ ] **Step 4: Run the unit tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-solve.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Write the brute-force equivalence property test**

This is the actual proof the solver is exact. Create `oracle/analytics/__tests__/speed-solve.prop.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-solve.prop.test.mjs
// The solver claims a PROVABLE maximum. On instances small enough to enumerate exhaustively, that
// claim is checkable directly — so check it.
import { test, expect } from "vitest";
import fc from "fast-check";
import { buildIndex, solve, SLOTS } from "../speed-solve.mjs";
import { speedOfWith, buildSpeed } from "../speed-model.mjs";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const plain = speedOfWith(0, new Map());

const mkItem = (id, slot, set, speed) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [{ statId: 4, isFlat: false, rolls: 0, value: speed, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
});

// Exhaustive search over every combination of one item per slot.
function bruteForce(items, base, constant) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  let best = null;
  const walk = (i, chosen) => {
    if (i === slots.length) {
      const speed = buildSpeed(base, constant, chosen, plain);
      if (best === null || speed > best) best = speed;
      return;
    }
    for (const it of bySlot.get(slots[i])) walk(i + 1, [...chosen, it]);
  };
  walk(0, []);
  return best;
}

// Sets chosen to span both mechanics: 4 and 38 are classic 2-piece stackers with different values,
// 35 is tiered with the odd 2/4/8 thresholds, 0 is setless.
const SETS = [0, 4, 38, 35];

const instance = fc.array(
  fc.record({
    slot: fc.constantFrom(...SLOTS.slice(0, 4)),
    set: fc.constantFrom(...SETS),
    speed: fc.integer({ min: 0, max: 40 }),
  }),
  { minLength: 1, maxLength: 10 },
);

test("solve returns the same maximum as exhaustive search", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), fc.integer({ min: -20, max: 60 }),
      (specs, base, constant) => {
        const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
        const index = buildIndex(items, 0, plain);
        const solved = solve(index, base, constant, plain);
        expect(solved.speed).toBe(bruteForce(items, base, constant));
      }),
    { numRuns: NUM_RUNS },
  );
});

// Two invariants that must hold on any instance, not just small ones.
test("solve is never worse than taking the fastest item in each slot", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), (specs, base) => {
      const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
      const index = buildIndex(items, 0, plain);
      const greedy = [...index.values()].map((bySet) =>
        [...bySet.values()].reduce((b, e) => (e.speed > b.speed ? e : b)).item);
      expect(solve(index, base, 0, plain).speed)
        .toBeGreaterThanOrEqual(buildSpeed(base, 0, greedy, plain));
    }),
    { numRuns: NUM_RUNS },
  );
});
```

- [ ] **Step 6: Run the property tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-solve.prop.test.mjs`
Expected: PASS. If the equivalence test fails, fast-check prints a minimal counterexample — that is a real solver bug, not a flaky test, and must be fixed rather than retried.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed-solve.mjs oracle/analytics/__tests__/speed-solve.test.mjs oracle/analytics/__tests__/speed-solve.prop.test.mjs
git commit -m "feat(analytics): exact maximum-speed solver

One DP over all 18 speed sets would need a ~1e18 state product. Piece
thresholds cap simultaneously active sets at four, so plan enumeration
plus a small per-plan assignment DP returns the provable maximum
instead. Builds are scored on the items actually picked, since a free
slot can complete a set by accident.

Proven against exhaustive search by a fast-check property test.

Co-Authored-By: Claude"
```

---

### Task 7: Champion base-speed corpus loading

**Files:**
- Create: `oracle/analytics/speed-corpus.mjs`
- Test: `oracle/analytics/__tests__/speed-corpus.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseCorpus(raw) -> Map<string, number>` (keys lowercased); `loadCorpus(path) -> Map<string, number>`; `lookupBase(corpus, name) -> number | null`.

- [ ] **Step 1: Write the failing tests**

Create `oracle/analytics/__tests__/speed-corpus.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-corpus.test.mjs
import { test, expect } from "vitest";
import { parseCorpus, lookupBase } from "../speed-corpus.mjs";

test("parseCorpus accepts a flat name -> speed object", () => {
  const c = parseCorpus({ "Arbiter": 110, "Kantra the Cyclone": 109 });
  expect(c.get("arbiter")).toBe(110);
  expect(c.get("kantra the cyclone")).toBe(109);
});

test("parseCorpus accepts an array of stat records", () => {
  const c = parseCorpus([
    { name: "Arbiter", stats: { spd: 110, hp: 21135 } },
    { name: "Elhain", stats: { spd: 107 } },
  ]);
  expect(c.get("arbiter")).toBe(110);
  expect(c.get("elhain")).toBe(107);
});

test("parseCorpus skips records with no speed", () => {
  const c = parseCorpus([{ name: "Nameless", stats: {} }, { name: "Ok", stats: { spd: 100 } }]);
  expect(c.has("nameless")).toBe(false);
  expect(c.get("ok")).toBe(100);
});

test("parseCorpus rejects a shape it does not recognise", () => {
  expect(() => parseCorpus(42)).toThrow(/corpus/i);
  expect(() => parseCorpus(null)).toThrow(/corpus/i);
});

// Lookup is case-insensitive because the DB and the corpus disagree on casing for some names.
test("lookupBase is case-insensitive and returns null on a miss", () => {
  const c = parseCorpus({ "Arbiter": 110 });
  expect(lookupBase(c, "ARBITER")).toBe(110);
  expect(lookupBase(c, "Nobody")).toBe(null);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-corpus.test.mjs`
Expected: FAIL — `Cannot find module '../speed-corpus.mjs'`.

- [ ] **Step 3: Write `speed-corpus.mjs`**

Create `oracle/analytics/speed-corpus.mjs`:

```javascript
// Champion base speed, looked up by name.
//
// The corpus is an EXTERNAL local dataset. Its path comes from --corpus or $RSLH_SPEED_CORPUS, and
// nothing is vendored into this repo. Three shapes are accepted so it can point straight at whatever
// you already have:
//
//   { "Arbiter": 110, ... }                                  a flat name -> speed map
//   [ { name: "Arbiter", stats: { spd: 110 } }, ... ]         an array of stat records
//   a directory containing */stats.json, each in either shape above
import { readFileSync, readdirSync, statSync } from "node:fs";

export function parseCorpus(raw) {
  const corpus = new Map();
  if (Array.isArray(raw)) {
    for (const record of raw) {
      const spd = record?.stats?.spd ?? record?.spd;
      if (typeof record?.name !== "string" || typeof spd !== "number") continue;
      corpus.set(record.name.toLowerCase(), spd);
    }
    return corpus;
  }
  if (raw && typeof raw === "object") {
    for (const [name, spd] of Object.entries(raw)) {
      if (typeof spd !== "number") continue;
      corpus.set(name.toLowerCase(), spd);
    }
    return corpus;
  }
  throw new Error("speed corpus: expected an object or an array of stat records");
}

export function loadCorpus(path) {
  if (statSync(path).isDirectory()) {
    const corpus = new Map();
    for (const entry of readdirSync(path)) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(`${path}/${entry}/stats.json`, "utf8"));
      } catch {
        continue;    // not every subdirectory has to hold a stats file
      }
      for (const [name, spd] of parseCorpus(raw)) corpus.set(name, spd);
    }
    if (corpus.size === 0) throw new Error(`speed corpus: no */stats.json found under ${path}`);
    return corpus;
  }
  return parseCorpus(JSON.parse(readFileSync(path, "utf8")));
}

export const lookupBase = (corpus, name) => corpus.get(String(name).toLowerCase()) ?? null;
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-corpus.test.mjs`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed-corpus.mjs oracle/analytics/__tests__/speed-corpus.test.mjs
git commit -m "feat(analytics): champion base-speed corpus loader

Accepts a flat map, an array of stat records, or a directory of
*/stats.json. The corpus is external and never vendored here; its path
comes from --corpus or \$RSLH_SPEED_CORPUS.

Co-Authored-By: Claude"
```

---

### Task 8: The `speed.mjs` CLI, report and `verify` subcommand

**Files:**
- Create: `oracle/analytics/speed.mjs`
- Modify: `oracle/analytics/README.md`
- Test: `oracle/analytics/__tests__/speed-cli.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `parseSpeedArgs(argv) -> { selector, dbArg, glyph, base, constant, top, corpus, verify }`; `formatBuild(result, champ, base, constant, glyphFloor) -> string`; `main()` behind the import guard.

- [ ] **Step 1: Write the failing tests**

Create `oracle/analytics/__tests__/speed-cli.test.mjs`:

```javascript
// oracle/analytics/__tests__/speed-cli.test.mjs
import { test, expect } from "vitest";
import { parseSpeedArgs } from "../speed.mjs";

test("parseSpeedArgs keeps the champion selector and snapshot conventions", () => {
  const a = parseSpeedArgs(["Kantra", "oracle/resources/x.db"]);
  expect(a.selector).toBe("Kantra");
  expect(a.dbArg).toBe("oracle/resources/x.db");
});

test("parseSpeedArgs reads the numeric options", () => {
  const a = parseSpeedArgs(["Kantra", "--glyph", "8", "--base", "109", "--constant", "10", "--top", "3"]);
  expect(a).toMatchObject({ selector: "Kantra", glyph: 8, base: 109, constant: 10, top: 3 });
});

test("parseSpeedArgs defaults glyph to 0, top to 1, and leaves overrides null", () => {
  const a = parseSpeedArgs(["Kantra"]);
  expect(a).toMatchObject({ glyph: 0, top: 1, base: null, constant: null });
});

// Option values must never be mistaken for the champion selector.
test("parseSpeedArgs does not treat an option value as the selector", () => {
  expect(parseSpeedArgs(["--glyph", "8", "Kantra"]).selector).toBe("Kantra");
  expect(parseSpeedArgs(["--base", "109"]).selector).toBe(null);
});

test("parseSpeedArgs recognises the verify subcommand", () => {
  expect(parseSpeedArgs(["verify"]).verify).toBe(true);
  expect(parseSpeedArgs(["Kantra"]).verify).toBe(false);
});

test("parseSpeedArgs rejects a non-numeric option value", () => {
  expect(() => parseSpeedArgs(["Kantra", "--glyph", "lots"])).toThrow(/--glyph/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run oracle/analytics/__tests__/speed-cli.test.mjs`
Expected: FAIL — `Cannot find module '../speed.mjs'`.

- [ ] **Step 3: Write `speed.mjs`**

Create `oracle/analytics/speed.mjs`:

```javascript
// Maximum-speed gear solver for one champion, over the whole vault.
//
//   node --experimental-sqlite oracle/analytics/speed.mjs <name|ID> [snapshot.db] [opts]
//     --glyph N      also solve with every SPD substat glyph raised to at least N
//     --base N       override the corpus base speed
//     --constant N   override the measured constant
//     --top N        print the N best builds rather than only the winner
//     --corpus PATH  champion base-speed corpus (or $RSLH_SPEED_CORPUS)
//
//   node --experimental-sqlite oracle/analytics/speed.mjs verify [snapshot.db] [--corpus PATH]
//     model health check: the distribution of the unexplained constant across geared champions.
//
// Advisory only; nothing is written to any database.
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
import { readArtifacts } from "./decode.mjs";
import { readChampRows, selectChamps } from "./champs.mjs";
import { glyphCeilings, clampFloor, speedOfWith, measureConstant, itemSpeed }
  from "./speed-model.mjs";
import { buildIndex, solve } from "./speed-solve.mjs";
import { setEffect, speedSetName } from "./speed-sets.mjs";
import { loadCorpus, lookupBase } from "./speed-corpus.mjs";

// --- CLI: pure helpers ------------------------------------------------------

const NUMERIC = new Set(["--glyph", "--base", "--constant", "--top"]);

// Same selector/snapshot conventions as champion-gear.mjs, plus options. Option VALUES are consumed
// as they are read, so `--glyph 8 Kantra` still finds Kantra rather than reading 8 as the selector.
export function parseSpeedArgs(argv) {
  const out = { selector: null, dbArg: undefined, glyph: 0, base: null, constant: null, top: 1,
    corpus: process.env.RSLH_SPEED_CORPUS ?? null, verify: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "") continue;
    if (NUMERIC.has(arg)) {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      out[arg.slice(2)] = value;
      continue;
    }
    if (arg === "--corpus") { out.corpus = argv[++i]; continue; }
    if (arg === "verify") { out.verify = true; continue; }
    positional.push(arg);
  }
  out.dbArg = positional.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  out.selector = positional.find((a) => a !== out.dbArg) ?? null;
  return out;
}

const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setLabel = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

// "Speed x4 (+24%) · Perception x2 (+5%)" — only sets that actually paid out.
export function describeSets(counts, base) {
  const parts = [];
  for (const [setId, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (!speedSetName(setId)) continue;
    const gain = setEffect(base, new Map([[setId, count]]));
    if (gain > 0) parts.push(`${setLabel(setId)} x${count} (+${gain})`);
  }
  return parts.length ? parts.join(" · ") : "no speed sets";
}

export function formatBuild(result, base, constant, glyphFloor, ceilings) {
  const lines = [];
  const flat = result.items.reduce((sum, it) => sum + itemSpeed(it, clampFloor(it, glyphFloor, ceilings)), 0);
  const bonus = result.speed - base - flat - constant;
  lines.push(`  ${result.speed} SPD   ${describeSets(result.counts, base)}`);
  for (const it of [...result.items].sort((a, b) => a.slot - b.slot)) {
    const s = itemSpeed(it, clampFloor(it, glyphFloor, ceilings));
    lines.push(`    ${slotName(it.slot).padEnd(7)} ${setLabel(it.set).padEnd(14)}`
      + ` +${String(it.level).padStart(2)}   spd ${String(s).padStart(3)}   #${it.id}`);
  }
  lines.push(`    base ${base} + sets ${bonus} + items ${flat} + constant ${constant} = ${result.speed}`);
  return lines.join("\n");
}

// --- CLI: I/O and formatting ------------------------------------------------
// Below this line nothing is unit-tested: DB reads, layout and printing.

function resolveDb(arg) {
  if (arg) return arg;
  const dir = fileURLToPath(new URL("../resources", import.meta.url));
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

function requireCorpus(path) {
  if (!path) {
    console.error("no champion base-speed corpus: pass --corpus PATH or set $RSLH_SPEED_CORPUS");
    process.exit(1);
  }
  return loadCorpus(path);
}

function gearOf(items, champId) {
  return items.filter((it) => it.equippedChampId === champId);
}

// Model health check: how much speed the model fails to explain, across every geared champion.
// A game patch that changed a set value would show up here as the distribution shifting.
function runVerify(items, rows, corpus) {
  const ceilings = glyphCeilings(items);
  const speedOf = speedOfWith(0, ceilings);
  const buckets = new Map();
  let covered = 0, missing = 0;
  for (const champ of rows) {
    const gear = gearOf(items, champ.ID);
    if (!gear.length) continue;
    const base = lookupBase(corpus, champ.Name);
    if (base === null) { missing++; continue; }
    covered++;
    const c = measureConstant(champ.SPD, base, gear, speedOf);
    buckets.set(c, (buckets.get(c) ?? 0) + 1);
  }
  const sorted = [...buckets].sort((a, b) => a[0] - b[0]);
  const zero = buckets.get(0) ?? 0;
  console.log(`# Speed model verify — ${covered} geared champions in the corpus`
    + ` (${missing} not in it)`);
  console.log(`  constant == 0 for ${zero} (${(100 * zero / covered).toFixed(0)}%)`);
  console.log(`  constant distribution: ${sorted.map(([k, n]) => `${k}:${n}`).join(" ")}`);
}

function main() {
  const args = parseSpeedArgs(process.argv.slice(2));
  const dbPath = resolveDb(args.dbArg);
  const { items } = readArtifacts(dbPath);
  const rows = readChampRows(dbPath);
  const corpus = requireCorpus(args.corpus);

  if (args.verify) { runVerify(items, rows, corpus); return; }

  if (args.selector === null) {
    console.error("name a champion: speed.mjs <name|ID> [snapshot.db]");
    process.exit(1);
  }
  const matched = selectChamps(rows, args.selector);
  if (!matched.length) {
    console.error(`no champion matches "${args.selector}".`);
    const near = rows.filter((r) =>
      r.Name.toLowerCase().startsWith(String(args.selector).slice(0, 3).toLowerCase()));
    if (near.length) {
      console.error(`did you mean: ${[...new Set(near.map((r) => r.Name))].slice(0, 8).join(", ")}?`);
    }
    process.exit(1);
  }

  const ceilings = glyphCeilings(items);
  console.log(`# Speed — snapshot ${dbPath.split(/[\\/]/).pop()}`);

  for (const champ of matched) {
    const base = args.base ?? lookupBase(corpus, champ.Name);
    if (base === null) {
      console.error(`\n${champ.Name} #${champ.ID}: not in the corpus — pass --base N`);
      continue;
    }
    const gear = gearOf(items, champ.ID);
    const plainSpeed = speedOfWith(0, ceilings);
    const constant = args.constant ?? measureConstant(champ.SPD, base, gear, plainSpeed);

    console.log(`\n${champ.Name} #${champ.ID}`
      + `  base ${base}${args.base === null ? " (corpus)" : " (--base)"}`
      + ` · constant ${constant >= 0 ? "+" : ""}${constant}`
      + `${args.constant === null ? " (observed)" : " (--constant)"}`
      + ` · current ${champ.SPD}`);

    const index = buildIndex(items, champ.Fraction, plainSpeed);
    const best = solve(index, base, constant, plainSpeed);
    if (!best) { console.log("  no eligible items for any slot."); continue; }
    console.log(`  BEST  (+${best.speed - champ.SPD} over current)`);
    console.log(formatBuild(best, base, constant, 0, ceilings));

    if (args.glyph > 0) {
      const glyphSpeed = speedOfWith(args.glyph, ceilings);
      const glyphIndex = buildIndex(items, champ.Fraction, glyphSpeed);
      const lifted = solve(glyphIndex, base, constant, glyphSpeed);
      const clamped = items.filter((it) =>
        it.substats.some((s) => s.statId === 4 && s.glyph < args.glyph)
        && clampFloor(it, args.glyph, ceilings) < args.glyph).length;
      console.log(`\n  at glyph >= ${args.glyph}  (+${lifted.speed - best.speed} over BEST)`
        + `${clamped ? `   [${clamped} items clamped to their rarity ceiling]` : ""}`);
      console.log(formatBuild(lifted, base, constant, args.glyph, ceilings));
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run oracle/analytics/__tests__/speed-cli.test.mjs`
Expected: PASS, all six cases.

- [ ] **Step 5: Verify against a real snapshot**

Run, pointing `--corpus` at your champion base-stat dataset:

```bash
node --experimental-sqlite oracle/analytics/speed.mjs verify --corpus "$RSLH_SPEED_CORPUS"
node --experimental-sqlite oracle/analytics/speed.mjs Kantra --corpus "$RSLH_SPEED_CORPUS" --glyph 8
```

Expected: `verify` reports a constant distribution concentrated near 0 with a positive tail on heavily-geared champions. The named run prints a build whose total is **at least** the champion's current speed — their current gear is in the pool, so a lower number is a bug, not a result.

- [ ] **Step 6: Document it in the analytics README**

In `oracle/analytics/README.md`, add to the numbered "Run" list after the `champion-gear.mjs` entry:

```markdown
4. Fastest possible build for one champion:
   `node --experimental-sqlite oracle/analytics/speed.mjs <name|ID> [snapshot.db] --corpus PATH`

   Searches the whole vault for the item assignment that maximizes that champion's speed, and
   proves it is the maximum rather than a heuristic. `--glyph N` adds a second solve with every
   SPD substat glyph raised to at least N, clamped to what each rarity x rank has been seen to
   carry. `--base N` is required for champions absent from the corpus.

   The corpus of champion base speeds is an external local dataset — pass `--corpus PATH` or set
   `$RSLH_SPEED_CORPUS`. `speed.mjs verify` reports how much speed the model cannot explain across
   every geared champion, which is the check that would catch a game patch changing set values.

   Design: `docs/plans/2026-08-14-champion-speed-solver-design.md`.
```

- [ ] **Step 7: Commit**

```bash
npm run build && npm test && npm run lint
git add oracle/analytics/speed.mjs oracle/analytics/__tests__/speed-cli.test.mjs oracle/analytics/README.md
git commit -m "feat(analytics): speed.mjs, the champion speed solver CLI

Solves one champion against the whole vault and prints the arithmetic so
the result is auditable. --glyph N re-solves with every SPD substat glyph
lifted, clamped to what each rarity x rank has been seen to carry. The
verify subcommand reports the unexplained constant across all geared
champions as a model health check.

Co-Authored-By: Claude"
```

---

## Self-review notes

**Spec coverage.** Every section of the design doc maps to a task: the ascension decode and glyph facts to Task 1 and Task 4; `champs.mjs` to Task 2; the set table and floor-per-completion rounding to Task 3; `itemSpeed`, glyph clamping, `base`/`constant` separation to Task 4; the index with its faction filter to Task 5; plan enumeration, assignment DP, accidental-completion rescoring and branch-and-bound to Task 6; corpus loading with its no-vendoring rule to Task 7; CLI, output, `verify`, edge cases and README to Task 8. The spec's deferred list (stat floors, relic and aura, summary mode, pool narrowing) is deliberately unimplemented.

**Deliberate ordering.** Tasks 1, 2, 3 and 7 have no dependencies on each other and can be done in any order. Task 4 needs 1 and 3; Task 5 needs 4; Task 6 needs 3, 4 and 5; Task 8 needs all.

**The one test that matters most** is the brute-force equivalence property in Task 6. Everything else checks that a piece behaves as designed; that one checks the central claim — that the answer is the maximum and not merely a good build. If it fails, fix the solver rather than the test.
