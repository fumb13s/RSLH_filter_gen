# Gear Vault Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `oracle/analytics/` tool suite that decodes the `RSLHelper.db` gear snapshot and produces a supply-and-demand-aware keep/delete/focus triage report.

**Architecture:** Plain Node ESM scripts in a flat `oracle/analytics/` dir. Shared DB-decode primitives live in `oracle/lib/decode.mjs` (extracted from `probe.mjs`, which is refactored to import them — no duplication) and turn DB rows into canonical items in *our* stat-id space; `sets.mjs`/`weights.mjs` hold the co-authored data; `score → supply → triage` are pure functions over decoded items; `census.mjs` + `analyze.mjs` aggregate and emit `out/report.{json,md}`. The full design is in `oracle/analytics/DESIGN.md`.

**Tech Stack:** Node ≥ 22 (`node:sqlite` `DatabaseSync`; `BigInt` coercion), **vitest** for tests (folded into the root `npm test` via a broadened `include`), imports `@rslh/core` for `SLOT_STATS` + mappings.

**Conventions for this plan:**
- Analytics modules are flat in `oracle/analytics/` (no nested `lib/`). The one genuinely shared dependency — the DB-decode primitives — lives one level up in `oracle/lib/decode.mjs`, imported by **both** `oracle/analytics/` and `oracle/probe/` (DRY: one decoder, never two copies).
- Modules import core via the package name: `import { SLOT_STATS } from "@rslh/core"` (resolves through the workspace symlink in root `node_modules` → `packages/core/dist`). Core must be built first: `npx tsc -b packages/core` — the pre-commit `npm run build && npm test` already does this.
- Tests are **vitest** (`.test.mjs`), folded into `npm test` by broadening the root `vitest.config.ts` `include` (Task 0). Run all: `npm test`; iterate on one file: `npx vitest run <path>`.
- `node:sqlite` loads on Node 22.14+ without `--experimental-sqlite` (one cosmetic `ExperimentalWarning` on stderr); the flag stays only on the `analyze.mjs` *run* command for older-Node portability.
- Stat ids in canonical items are **our** ids (`STAT_NAMES`: 4=SPD, 5=C.RATE, 6=C.DMG, 7=RES, 8=ACC), so all `@rslh/core` mappings apply directly.
- Commit after each task with `Co-Authored-By: Claude` (no email).

---

## File Structure

| File | Responsibility |
|---|---|
| `oracle/analytics/.gitignore` | ignore `out/` and `findings/` (derived from personal DB) |
| `oracle/lib/decode.mjs` | **shared** DB-decode primitives (`decodeValue`, stat map, `SUB` cols) — imported by probe + analytics |
| `oracle/probe/probe.mjs` (**modify**) | drop inline decode primitives; import them from `lib/decode.mjs` |
| `oracle/analytics/decode.mjs` | imports `lib/decode.mjs`; adds canonical-item `decodeRow` + `readArtifacts(dbPath)` |
| `oracle/analytics/sets.mjs` | the §3.2 set annotation table + `getSet(id)` (fallback) + `expandRoles()` |
| `oracle/analytics/weights.mjs` | desirability matrix, glyph thresholds, supply floors, cut lines |
| `oracle/analytics/score.mjs` | `quality(item)` (best-matching-role) + `investment(item)` |
| `oracle/analytics/supply.mjs` | bucket keys, floors, `bucketCounts`, `setlessDominated` |
| `oracle/analytics/census.mjs` | descriptive distributions + reconciliation |
| `oracle/analytics/triage.mjs` | per-slot percentiles + keep/delete/focus classification |
| `oracle/analytics/analyze.mjs` | orchestrate; write `out/report.{json,md}` |
| `oracle/analytics/__tests__/*.test.mjs` | vitest suites (folded into `npm test`) |
| `oracle/analytics/README.md` | how to run + that outputs are gitignored |
| `vitest.config.ts` (root, **modify**) | broaden `include` to pick up `oracle/analytics/**/*.test.mjs` |

---

## Task 0: Scaffold

**Files:**
- Create: `oracle/analytics/.gitignore`
- Create: `oracle/analytics/README.md`
- Modify: `vitest.config.ts` (root)

- [ ] **Step 1: Create `.gitignore`**

```
# Derived from the personal RSLHelper.db — never commit.
out/
findings/
```

- [ ] **Step 2: Create `README.md`**

```markdown
# Gear Vault Analytics

Decodes `../resources/RSLHelper.db` and produces a keep/delete/focus triage report.
Design + rationale: `DESIGN.md`. Advisory only — never deletes anything.

## Run
1. Build core: `npx tsc -b packages/core`
2. `node --experimental-sqlite oracle/analytics/analyze.mjs [path-to.db]`
   (defaults to `../resources/RSLHelper.db`; writes `out/report.json` + `out/report.md`)

## Test
Folded into the repo suite — `npm test` (or just analytics: `npx vitest run oracle/analytics`).

`out/` and `findings/` are gitignored (derive from personal account data).
```

- [ ] **Step 3: Broaden the vitest include**

In `vitest.config.ts`, change the `include` line so analytics `.test.mjs` files are picked up:

```ts
    include: ["packages/*/src/**/*.test.ts", "oracle/analytics/**/*.test.mjs"],
```

Verify it doesn't break the existing suite (core must be built first):

Run: `npx tsc -b packages/core && npm test`
Expected: existing 242 tests still pass; no analytics tests yet (none written) so the new glob matches nothing.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/.gitignore oracle/analytics/README.md vitest.config.ts
git commit -m "chore(analytics): scaffold dir, gitignore, vitest include"
```

---

## Task 1: Shared decode (extract from probe) + analytics decoder

The DB-decode math currently lives inline in `oracle/probe/probe.mjs`, which has no exports.
Extract the shared primitives into one module both tools import — never two copies of code that
must decode the same DB identically.

**Files:**
- Create: `oracle/lib/decode.mjs` (shared primitives)
- Modify: `oracle/probe/probe.mjs` (import them; drop the inline copies)
- Create: `oracle/analytics/decode.mjs` (imports shared; adds the canonical item + reader)
- Test: `oracle/analytics/__tests__/decode.test.mjs`

- [ ] **Step 1: Create `oracle/lib/decode.mjs`** (lifted verbatim from `probe.mjs`)

```js
// Shared DB-decode primitives for RSLHelper.db gear. Imported by oracle/probe (differential
// probe vs Sellfile Creator) and oracle/analytics (gear triage) so the two never drift.
export const POW32 = 2 ** 32;
export const N = (v) => (v == null ? 0 : Number(v)); // node:sqlite returns BigInt
// DB stat enum (1HP 2ATK 3DEF 4SPD 5RES 6ACC 7CRATE 8CDMG) -> our STAT_NAMES id.
export const DBSTAT_TO_OURSTAT = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 5, 8: 6 };
export const PCT_ALWAYS = new Set([7, 8]);        // DB CR, CDMG -> always *100
export const PCT_WHEN_PCT = new Set([1, 2, 3]);   // DB HP/ATK/DEF -> *100 only when not flat

// value = lvlid/2**32, *100 for percentages. Same encoding for substat values AND glyphs.
export function decodeValue(dbStatId, isFlat, rawBase) {
  const raw = N(rawBase);
  if (raw === 0) return 0;
  const v = raw / POW32;
  const pct = PCT_ALWAYS.has(dbStatId) || (!isFlat && PCT_WHEN_PCT.has(dbStatId));
  if (pct) return Math.round(v * 100 * 100) / 100;
  if (dbStatId >= 1 && dbStatId <= 6) return Math.round(v);
  return Math.round(v * 1000) / 1000;
}

// s1..s4 substat column names. `gv` (glyph value) is used by analytics; probe's SELECT lists
// [id, fl, lvl, base] explicitly, so the extra field is invisible to it.
export const SUB = [1, 2, 3, 4].map((i) => ({
  id: `s${i}id`, fl: `s${i}fl`, lvl: `s${i}lvl`, base: `s${i}lvlid`, gv: `s${i}gv`,
}));
```

- [ ] **Step 2: Refactor `oracle/probe/probe.mjs` to import the primitives**

Delete probe's inline `N`, `POW32`, `DBSTAT_TO_OURSTAT`, `PCT_ALWAYS`, `PCT_WHEN_PCT`,
`decodeValue`, and `SUB` definitions. Keep the SFC-specific bits (`UwA`, `variantOf`, `mkStat`,
the `ours`/`sfc` builders, worker boot, diff). The top of the file becomes:

```js
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { evaluateFilter, generateFilter, defaultRule, emptySubstat }
  from "../../packages/core/dist/index.js";
import { N, DBSTAT_TO_OURSTAT, decodeValue, SUB } from "../lib/decode.mjs";

const here = (p) => new URL(p, import.meta.url);

// accset -> faction (UwA): identity except 13->4 (Barbarians dup)
const UwA = { 0: 0, 13: 4 };
// SFC variant enum (probe-specific): (dbStatId << 8) | isFlat
const variantOf = (dbStatId, isFlat) => (dbStatId << 8) | (isFlat ? 1 : 0);
```

Everything below is unchanged — it already calls `N`, `DBSTAT_TO_OURSTAT`, `decodeValue`, and
`SUB`, now sourced from the import.

- [ ] **Step 3: Verify probe still decodes (behavior-preserving)**

Probe runs headless in Node (boots the SFC worker from the git-ignored `gen/`; it is **not** the
RSL Helper harness).

Run: `node oracle/probe/probe.mjs`
Expected: prints `decoded 24 artifacts` and the same ~19–23/24 agreement as before — identical
output, since it's the same functions relocated. (If `gen/` is absent, run `node --check
oracle/probe/probe.mjs` to at least confirm it parses and the import resolves.)

- [ ] **Step 4: Create `oracle/analytics/decode.mjs`** (imports shared; adds the canonical item)

```js
import { DatabaseSync } from "node:sqlite";
import { N, DBSTAT_TO_OURSTAT, decodeValue, SUB } from "../lib/decode.mjs";

// Re-export so tests/consumers can grab the primitive from this one module.
export { decodeValue, N } from "../lib/decode.mjs";

export function isCorrupt(row) {
  const id = N(row.ID), rarity = N(row.rarity), rank = N(row.rank);
  return id <= 0 || rarity < 1 || rarity > 6 || rank < 1 || rank > 6;
}

export function decodeRow(row) {
  const dbMain = N(row.mid), mainFlat = N(row.mfl) !== 0;
  const mainStat = {
    statId: DBSTAT_TO_OURSTAT[dbMain] ?? dbMain,
    isFlat: mainFlat,
    value: decodeValue(dbMain, mainFlat, row.mlvlid),
  };
  const substats = [];
  for (const s of SUB) {
    const dbId = N(row[s.id]);
    if (dbId <= 0) continue;
    const isFlat = N(row[s.fl]) !== 0;
    substats.push({
      statId: DBSTAT_TO_OURSTAT[dbId] ?? dbId,
      isFlat,
      rolls: N(row[s.lvl]) || 1,
      value: decodeValue(dbId, isFlat, row[s.base]),
      glyph: decodeValue(dbId, isFlat, row[s.gv]),
    });
  }
  const slot = N(row.type);
  return {
    id: N(row.ID), slot, set: N(row.aset), rank: N(row.rank),
    rarity: N(row.rarity) - 1,                 // 0-5 index (dbRarity-1)
    level: N(row.lvl), faction: N(row.accset),
    isAccessory: slot >= 7 && slot <= 9,
    mainStat, substats,
    ascLevel: N(row.ASCLEVEL), equippedChampId: N(row.cID),
  };
}

const COLS = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset",
  "ASCLEVEL", "cID", ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv])].join(",");

export function readArtifacts(dbPath) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`SELECT ${COLS} FROM Artifacts ORDER BY ID`).all();
  db.close();
  const items = [], corrupt = [];
  for (const row of rows) {
    if (isCorrupt(row)) { corrupt.push(N(row.ID)); continue; }
    items.push(decodeRow(row));
  }
  return { items, corrupt, total: rows.length };
}
```

- [ ] **Step 5: Write the test** (`decodeValue` is re-exported from `../decode.mjs`)

```js
// oracle/analytics/__tests__/decode.test.mjs
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodeValue, readArtifacts } from "../decode.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

test("decodeValue: percent stat x100 (ATK% 2576980377 -> 60)", () => {
  expect(decodeValue(2, false, 2576980377)).toBe(60);
});
test("decodeValue: flat/non-pct stat is integer (SPD 25769803776 -> 6)", () => {
  expect(decodeValue(4, true, 25769803776)).toBe(6);
});
test("decodeValue: zero stays zero", () => {
  expect(decodeValue(1, true, 0)).toBe(0);
});

test("decode matches known-gear manifest (24 items)", () => {
  const manifest = JSON.parse(readFileSync(here("../../known-gear.manifest.json"), "utf8"));
  const { items } = readArtifacts(here("../../known-gear.db"));
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const exp of manifest.items) {
    const got = byId.get(exp.id);
    expect(got, `item ${exp.id} decoded`).toBeTruthy();
    expect(got.slot, `#${exp.id} slot`).toBe(exp.ourSlotId);
    expect(got.set, `#${exp.id} set`).toBe(exp.setId);
    expect(got.rank, `#${exp.id} rank`).toBe(exp.rank);
    expect(got.rarity, `#${exp.id} rarity`).toBe(exp.ourRarityIndex);
    expect(got.level, `#${exp.id} level`).toBe(exp.level);
    expect(got.faction, `#${exp.id} faction`).toBe(exp.faction ?? 0);
    expect(got.mainStat.statId, `#${exp.id} main id`).toBe(exp.mainStat.ourStatId);
    expect(got.mainStat.isFlat, `#${exp.id} main flat`).toBe(exp.mainStat.isFlat);
    expect(got.mainStat.value, `#${exp.id} main value`).toBe(exp.mainStat.value);
    expect(got.substats.length, `#${exp.id} sub count`).toBe(exp.substats.length);
    exp.substats.forEach((es, i) => {
      expect(got.substats[i].statId, `#${exp.id} sub${i} id`).toBe(es.ourStatId);
      expect(got.substats[i].isFlat, `#${exp.id} sub${i} flat`).toBe(es.isFlat);
      expect(got.substats[i].value, `#${exp.id} sub${i} value`).toBe(es.value);
      expect(got.substats[i].rolls, `#${exp.id} sub${i} rolls`).toBe(es.rolls);
    });
  }
});
```

- [ ] **Step 6: Run — expect FAIL, iterate to PASS**

Run: `npx vitest run oracle/analytics/__tests__/decode.test.mjs`
Expected final: vitest reports **4 passed**. A specific `#id` assertion pinpoints any decode mismatch. (One `node:sqlite` `ExperimentalWarning` on stderr is expected.)

- [ ] **Step 7: Commit**

```bash
git add oracle/lib/decode.mjs oracle/probe/probe.mjs oracle/analytics/decode.mjs oracle/analytics/__tests__/decode.test.mjs
git commit -m "feat(analytics): shared gear decode (extracted from probe) + analytics decoder"
```

---

## Task 2: `sets.mjs` (the co-authored data)

**Files:**
- Create: `oracle/analytics/sets.mjs`
- Test: `oracle/analytics/__tests__/sets.test.mjs`

- [ ] **Step 1: Write `sets.mjs`** (transcribe DESIGN.md §3.2 exactly; `D` = the three DPS scalings, `All` = all four roles)

```js
// Roles: "ATK-DPS" | "DEF-DPS" | "HP-DPS" | "Support". Shorthand: "D" -> 3 DPS, "All" -> 4.
const A = "ATK-DPS", DF = "DEF-DPS", H = "HP-DPS", S = "Support";
export const ALL_ROLES = [A, DF, H, S];
const D = [A, DF, H];

export function expandRoles(roles) {
  const out = new Set();
  for (const r of roles) {
    if (r === "All") ALL_ROLES.forEach((x) => out.add(x));
    else if (r === "D") D.forEach((x) => out.add(x));
    else out.add(r);
  }
  return [...out];
}

// id -> { name, roles (shorthand), scarcity, demand }
export const SETS = {
  1: { name: "Life", roles: [H, S], scarcity: 3, demand: 1 },
  2: { name: "Offense", roles: [A], scarcity: 3, demand: 1 },
  3: { name: "Defense", roles: [DF, S], scarcity: 3, demand: 1 },
  4: { name: "Speed", roles: ["All"], scarcity: 3, demand: 3 },
  5: { name: "Crit Rate", roles: ["D"], scarcity: 3, demand: 1 },
  6: { name: "Crit Damage", roles: ["D"], scarcity: 3, demand: 1 },
  7: { name: "Accuracy", roles: [S], scarcity: 3, demand: 1 },
  8: { name: "Resistance", roles: [S], scarcity: 3, demand: 1 },
  9: { name: "Lifesteal", roles: ["D"], scarcity: 3, demand: 1 },
  10: { name: "Fury", roles: [A], scarcity: 3, demand: 1 },
  11: { name: "Daze", roles: [S], scarcity: 3, demand: 1 },
  12: { name: "Cursed", roles: [S], scarcity: 3, demand: 1 },
  13: { name: "Frost", roles: [S], scarcity: 3, demand: 1 },
  14: { name: "Frenzy", roles: [S], scarcity: 3, demand: 1 },
  15: { name: "Regeneration", roles: [S], scarcity: 3, demand: 2 },
  16: { name: "Immunity", roles: [S], scarcity: 3, demand: 1 },
  17: { name: "Shield", roles: [S], scarcity: 3, demand: 2 },
  18: { name: "Relentless", roles: ["All"], scarcity: 5, demand: 3 },
  19: { name: "Savage", roles: ["D"], scarcity: 3, demand: 3 },
  20: { name: "Destroy", roles: ["D"], scarcity: 3, demand: 1 },
  21: { name: "Stun", roles: [S], scarcity: 3, demand: 2 },
  22: { name: "Toxic", roles: ["D", S], scarcity: 3, demand: 1 },
  23: { name: "Provoke", roles: [S], scarcity: 3, demand: 2 },
  24: { name: "Retaliation", roles: [S], scarcity: 3, demand: 1 },
  25: { name: "Avenging", roles: ["D"], scarcity: 3, demand: 1 },
  26: { name: "Stalwart", roles: [S], scarcity: 3, demand: 1 },
  27: { name: "Reflex", roles: [S], scarcity: 3, demand: 2 },
  28: { name: "Curing", roles: [S], scarcity: 3, demand: 1 },
  29: { name: "Cruel", roles: ["D"], scarcity: 5, demand: 3 },
  30: { name: "Immortal", roles: [S], scarcity: 5, demand: 1 },
  31: { name: "Divine Offense", roles: [A], scarcity: 3, demand: 1 },
  32: { name: "Divine Crit Rate", roles: ["D"], scarcity: 3, demand: 1 },
  33: { name: "Divine Life", roles: [H, S], scarcity: 3, demand: 1 },
  34: { name: "Divine Speed", roles: ["All"], scarcity: 5, demand: 3 },
  35: { name: "Swift Parry", roles: ["All"], scarcity: 5, demand: 3 },
  36: { name: "Deflection", roles: [S], scarcity: 5, demand: 3 },
  37: { name: "Resilience", roles: [S], scarcity: 3, demand: 1 },
  38: { name: "Perception", roles: [S], scarcity: 3, demand: 2 },
  40: { name: "Untouchable", roles: [S], scarcity: 3, demand: 1 },
  41: { name: "Fatal", roles: [A], scarcity: 3, demand: 1 },
  44: { name: "Guardian", roles: [S], scarcity: 3, demand: 1 },
  45: { name: "Fortitude", roles: [S], scarcity: 3, demand: 1 },
  46: { name: "Lethal", roles: ["D"], scarcity: 4, demand: 4 },
  47: { name: "Protection", roles: [S], scarcity: 4, demand: 4 },
  48: { name: "Stone Skin", roles: ["All"], scarcity: 4, demand: 4 },
  49: { name: "Killstroke", roles: ["D"], scarcity: 4, demand: 1 },
  50: { name: "Instinct", roles: ["D"], scarcity: 4, demand: 1 },
  51: { name: "Bolster", roles: [S], scarcity: 4, demand: 2 },
  52: { name: "Defiant", roles: [S], scarcity: 4, demand: 1 },
  53: { name: "Impulse", roles: ["All"], scarcity: 5, demand: 4 },
  54: { name: "Zeal", roles: ["D"], scarcity: 5, demand: 3 },
  57: { name: "Righteous", roles: [S], scarcity: 4, demand: 2 },
  58: { name: "Supersonic", roles: [S], scarcity: 4, demand: 3 },
  59: { name: "Merciless", roles: ["All"], scarcity: 4, demand: 3 },
  60: { name: "Slayer", roles: ["D"], scarcity: 4, demand: 1 },
  61: { name: "Feral", roles: ["All"], scarcity: 4, demand: 3 },
  62: { name: "Pinpoint", roles: ["All"], scarcity: 5, demand: 3 },
  63: { name: "Stonecleaver", roles: [A], scarcity: 3, demand: 1 },
  64: { name: "Rebirth", roles: [S], scarcity: 3, demand: 1 },
  65: { name: "Chronophage", roles: ["All"], scarcity: 4, demand: 3 },
  66: { name: "Mercurial", roles: ["All"], scarcity: 5, demand: 5 },
  1000: { name: "Refresh", roles: ["All"], scarcity: 5, demand: 2 },
  1001: { name: "Cleansing", roles: ["All"], scarcity: 3, demand: 1 },
  1002: { name: "Bloodshield", roles: ["All"], scarcity: 3, demand: 1 },
  1003: { name: "Reaction", roles: ["All"], scarcity: 5, demand: 3 },
  1004: { name: "Revenge", roles: ["D", S], scarcity: 4, demand: 3 },
  0: { name: "(setless)", roles: [], scarcity: 3, demand: 1 },
};

const FALLBACK = { name: "(unannotated)", roles: ["All"], scarcity: 3, demand: 3, unannotated: true };

export function getSet(id) {
  return SETS[id] ?? { ...FALLBACK, name: `(unannotated #${id})` };
}
```

- [ ] **Step 2: Write the test**

```js
// oracle/analytics/__tests__/sets.test.mjs
import { test, expect } from "vitest";
import { getSet, expandRoles, SETS } from "../sets.mjs";

test("expandRoles: All -> 4 roles, D -> 3", () => {
  expect(expandRoles(["All"]).length).toBe(4);
  expect(expandRoles(["D"]).sort()).toEqual(["ATK-DPS", "DEF-DPS", "HP-DPS"]);
  expect(expandRoles(["DEF-DPS", "Support"]).sort()).toEqual(["DEF-DPS", "Support"]);
});
test("known values transcribed (Mercurial 5/5, Setless 3/1, Killstroke 4/1)", () => {
  expect([getSet(66).scarcity, getSet(66).demand]).toEqual([5, 5]);
  expect([getSet(0).scarcity, getSet(0).demand]).toEqual([3, 1]);
  expect([getSet(49).scarcity, getSet(49).demand]).toEqual([4, 1]);
});
test("unknown set falls back to All/3/3 + unannotated", () => {
  const f = getSet(99999);
  expect(f.unannotated).toBe(true);
  expect([f.scarcity, f.demand]).toEqual([3, 3]);
});
test("every annotated set has valid scarcity/demand 1-5 and >=1 role (except setless)", () => {
  for (const [id, s] of Object.entries(SETS)) {
    expect(s.scarcity >= 1 && s.scarcity <= 5, `set ${id} scarcity`).toBeTruthy();
    expect(s.demand >= 1 && s.demand <= 5, `set ${id} demand`).toBeTruthy();
    if (Number(id) !== 0) expect(s.roles.length >= 1, `set ${id} roles`).toBeTruthy();
  }
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run oracle/analytics/__tests__/sets.test.mjs`
Expected: **4 passed**.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/sets.mjs oracle/analytics/__tests__/sets.test.mjs
git commit -m "feat(analytics): set annotation table (roles/scarcity/demand)"
```

---

## Task 3: `weights.mjs` (tunable parameters)

**Files:**
- Create: `oracle/analytics/weights.mjs`
- Test: `oracle/analytics/__tests__/weights.test.mjs`

- [ ] **Step 1: Write `weights.mjs`** (DESIGN.md §6)

```js
// Role -> stat desirability (0-1). SPD universal 1.0. Hard rule: every % stat > every flat stat.
// flat = flat HP/ATK/DEF; SPD/ACC/RES have no % form.
export const WEIGHTS = {
  "ATK-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.8, defPct: 0.2, hpPct: 0.2, res: 0.15, acc: 0.5, flat: 0.1 },
  "DEF-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.8, hpPct: 0.2, res: 0.2, acc: 0.5, flat: 0.1 },
  "HP-DPS": { spd: 1.0, cr: 0.9, cd: 0.9, atkPct: 0.2, defPct: 0.2, hpPct: 0.8, res: 0.2, acc: 0.5, flat: 0.1 },
  "Support": { spd: 1.0, cr: 0.25, cd: 0.25, atkPct: 0.25, defPct: 0.6, hpPct: 0.8, res: 0.7, acc: 0.7, flat: 0.15 },
};

// Investment: "highly glyphed" decoded-glyph thresholds (DESIGN.md §3.4).
export const GLYPH_THRESHOLDS = { spd: 4, pct: 5, accRes: 8 };
export const ASCENDED_LEVEL = 6;

// Supply floors (DESIGN.md §3.5/§6), counting unequipped only.
export const SUPPLY = { accessoryFloor: 4, armorBase: 4 }; // accessory flat 4; armor armorBase*demand

// Triage cut lines (per-slot percentile) + keep-premium gates (DESIGN.md §3.6/§3.7).
export const CUTS = { deletePct: 25, focusPct: 85, lowPremium: 2, focusPremium: 4 };
```

- [ ] **Step 2: Write the test (encodes the hard rule)**

```js
// oracle/analytics/__tests__/weights.test.mjs
import { test, expect } from "vitest";
import { WEIGHTS } from "../weights.mjs";

test("SPD is 1.0 in every role", () => {
  for (const w of Object.values(WEIGHTS)) expect(w.spd).toBe(1.0);
});
test("every % stat outranks every flat stat, per role", () => {
  for (const [role, w] of Object.entries(WEIGHTS)) {
    const pcts = [w.cr, w.cd, w.atkPct, w.defPct, w.hpPct];
    expect(Math.min(...pcts) > w.flat, `${role}: min %(${Math.min(...pcts)}) > flat(${w.flat})`).toBeTruthy();
  }
});
test("Support: RES > DEF%", () => {
  expect(WEIGHTS.Support.res > WEIGHTS.Support.defPct).toBeTruthy();
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run oracle/analytics/__tests__/weights.test.mjs`
Expected: **3 passed**.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/weights.mjs oracle/analytics/__tests__/weights.test.mjs
git commit -m "feat(analytics): desirability weights + thresholds + cut lines"
```

---

## Task 4: `score.mjs` (quality + investment)

**Files:**
- Create: `oracle/analytics/score.mjs`
- Test: `oracle/analytics/__tests__/score.test.mjs`

- [ ] **Step 1: Write `score.mjs`**

```js
import { SLOT_STATS } from "@rslh/core";
import { WEIGHTS, GLYPH_THRESHOLDS, ASCENDED_LEVEL } from "./weights.mjs";
import { getSet, expandRoles, ALL_ROLES } from "./sets.mjs";

// desirability of a (role, statId, isFlat) using our stat ids.
export function desir(role, statId, isFlat) {
  const w = WEIGHTS[role];
  switch (statId) {
    case 4: return w.spd;
    case 5: return w.cr;
    case 6: return w.cd;
    case 7: return w.res;
    case 8: return w.acc;
    case 1: return isFlat ? w.flat : w.hpPct;
    case 2: return isFlat ? w.flat : w.atkPct;
    case 3: return isFlat ? w.flat : w.defPct;
    default: return 0;
  }
}

// Ceiling = mean of the top-4 achievable substat desirabilities for this slot+role.
// Realizes "flat penalized only where a % was rollable": the baseline is slot-relative.
function slotCeil(slot, role) {
  const cfg = SLOT_STATS[slot];
  if (!cfg) return 1;
  const vals = cfg.substats.map(([id, flat]) => desir(role, id, flat)).sort((a, b) => b - a);
  const top = vals.slice(0, 4);
  return top.reduce((s, v) => s + v, 0) / Math.max(1, top.length) || 1;
}

// Roll-weighted mean desirability of the item's actual substats.
function rollWeightedMean(item, role) {
  let num = 0, den = 0;
  for (const s of item.substats) { num += desir(role, s.statId, s.isFlat) * s.rolls; den += s.rolls; }
  return den ? num / den : 0;
}

export function rolesForSet(setId) {
  const roles = expandRoles(getSet(setId).roles);
  return roles.length ? roles : ALL_ROLES; // setless / unknown -> judged at best of all roles
}

// quality(item) -> { role, score } where score in [0,100], best-matching role.
export function quality(item) {
  let best = { role: ALL_ROLES[0], score: -1 };
  for (const role of rolesForSet(item.set)) {
    const score = Math.max(0, Math.min(100,
      Math.round((100 * rollWeightedMean(item, role)) / slotCeil(item.slot, role))));
    if (score > best.score) best = { role, score };
  }
  return best;
}

function isPct(statId, isFlat) {
  return statId === 5 || statId === 6 || ((statId === 1 || statId === 2 || statId === 3) && !isFlat);
}

// investment(item) -> { ascended, glyphed } (DESIGN.md §3.4)
export function investment(item) {
  const ascended = item.ascLevel === ASCENDED_LEVEL;
  const glyphed = item.substats.some((s) => {
    const g = s.glyph || 0;
    if (s.statId === 4) return g >= GLYPH_THRESHOLDS.spd;
    if (s.statId === 7 || s.statId === 8) return g >= GLYPH_THRESHOLDS.accRes;
    if (isPct(s.statId, s.isFlat)) return g >= GLYPH_THRESHOLDS.pct;
    return false;
  });
  return { ascended, glyphed };
}
```

- [ ] **Step 2: Write the test**

```js
// oracle/analytics/__tests__/score.test.mjs
import { test, expect } from "vitest";
import { quality, investment, desir } from "../score.mjs";

const sub = (statId, isFlat, rolls = 2, value = 10) => ({ statId, isFlat, rolls, value, glyph: 0 });
// helper item; set picks the role pool
const item = (slot, set, substats, over = {}) => ({
  id: 1, slot, set, rank: 6, rarity: 4, level: 16, faction: 0,
  isAccessory: slot >= 7, mainStat: { statId: 4, isFlat: true, value: 0 },
  substats, ascLevel: -1, equippedChampId: 0, ...over,
});
// SPD, C.RATE, C.DMG, ATK% — ideal DPS line
const dpsSubs = [sub(4, true), sub(5, false), sub(6, false), sub(2, false)];

test("desir: every % stat beats flat for ATK-DPS", () => {
  expect(desir("ATK-DPS", 2, false) > desir("ATK-DPS", 2, true)).toBeTruthy(); // ATK% > flat ATK
  expect(desir("ATK-DPS", 3, false) > desir("ATK-DPS", 1, true)).toBeTruthy(); // DEF% > flat HP
});
test("DPS subs score high on a DPS set, low on a Support-only set", () => {
  const onCrit = quality(item(4, 6, dpsSubs));   // set 6 Crit Damage -> DPS roles
  const onImmortal = quality(item(4, 30, dpsSubs)); // set 30 Immortal -> Support only
  expect(onCrit.score, `crit-set DPS line high: ${onCrit.score}`).toBeGreaterThan(70);
  expect(onImmortal.score, `support-set lower: ${onImmortal.score}`).toBeLessThan(onCrit.score - 20);
  expect(onCrit.role).toBe("ATK-DPS");
});
test("flat subs: amulet not crushed the way a chest is (slot-relative)", () => {
  const flat = [sub(1, true), sub(2, true), sub(3, true), sub(8, false)]; // flat HP/ATK/DEF + ACC
  const amulet = quality(item(8, 30, flat)).score; // amulet: flat is largely forced
  const chest = quality(item(2, 30, flat)).score;  // chest: %-variants were available
  expect(amulet, `amulet(${amulet}) > chest(${chest}) for same flat line`).toBeGreaterThan(chest);
});
test("investment: ascended at level 6, glyphed at SPD>=4", () => {
  expect(investment(item(4, 6, dpsSubs, { ascLevel: 6 })).ascended).toBe(true);
  expect(investment(item(4, 6, dpsSubs, { ascLevel: 2 })).ascended).toBe(false);
  const glyphed = [{ ...sub(4, true), glyph: 4 }, sub(5, false), sub(6, false), sub(2, false)];
  expect(investment(item(4, 6, glyphed)).glyphed).toBe(true);
  expect(investment(item(4, 6, dpsSubs)).glyphed).toBe(false);
});
```

- [ ] **Step 3: Run — expect FAIL first, then iterate to PASS**

Run: `npx vitest run oracle/analytics/__tests__/score.test.mjs`
Expected final: **4 passed**. If the amulet/chest assertion is flaky, confirm `SLOT_STATS[8]` (amulet) has no HP%/ATK%/DEF% sub variants while `SLOT_STATS[2]` (chest) does — that's what makes the ceilings differ.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/score.mjs oracle/analytics/__tests__/score.test.mjs
git commit -m "feat(analytics): quality score (best-matching role) + investment flags"
```

---

## Task 5: `supply.mjs` (buckets, floors, dominated-setless)

**Files:**
- Create: `oracle/analytics/supply.mjs`
- Test: `oracle/analytics/__tests__/supply.test.mjs`

- [ ] **Step 1: Write `supply.mjs`**

```js
import { getSet } from "./sets.mjs";
import { SUPPLY } from "./weights.mjs";

// Accessories bucket by faction x slot x set; armor by slot x set.
export function bucketKey(item) {
  return item.isAccessory
    ? `acc|${item.faction}|${item.slot}|${item.set}`
    : `arm|${item.slot}|${item.set}`;
}

// Floor: accessories flat 4 (setless = 0, no floor); armor 4 x demand.
export function floorFor(item) {
  if (item.isAccessory) return item.set === 0 ? 0 : SUPPLY.accessoryFloor;
  return SUPPLY.armorBase * getSet(item.set).demand;
}

// Counts of UNEQUIPPED items per bucket (worn excluded — the floor protects spares).
export function bucketCounts(items) {
  const counts = new Map();
  for (const it of items) {
    if (it.equippedChampId > 0) continue;
    const k = bucketKey(it);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

export function atOrBelowFloor(item, counts) {
  return (counts.get(bucketKey(item)) || 0) <= floorFor(item);
}

// A setless accessory is dominated when a set-bearing accessory in the same
// faction x slot has quality >= it. scoreOf(item) -> number.
export function setlessDominated(items, scoreOf) {
  const bestSet = new Map(); // `${faction}|${slot}` -> max set-accessory quality
  for (const it of items) {
    if (!it.isAccessory || it.set === 0) continue;
    const k = `${it.faction}|${it.slot}`;
    bestSet.set(k, Math.max(bestSet.get(k) ?? -1, scoreOf(it)));
  }
  const dominated = new Set();
  for (const it of items) {
    if (!it.isAccessory || it.set !== 0) continue;
    const k = `${it.faction}|${it.slot}`;
    if ((bestSet.get(k) ?? -1) >= scoreOf(it)) dominated.add(it.id);
  }
  return dominated;
}
```

- [ ] **Step 2: Write the test**

```js
// oracle/analytics/__tests__/supply.test.mjs
import { test, expect } from "vitest";
import { bucketKey, floorFor, bucketCounts, atOrBelowFloor, setlessDominated } from "../supply.mjs";

const acc = (id, faction, slot, set, eq = 0) => ({ id, faction, slot, set, isAccessory: true, equippedChampId: eq });
const arm = (id, slot, set, eq = 0) => ({ id, slot, set, faction: 0, isAccessory: false, equippedChampId: eq });

test("floors: accessory flat 4, setless 0, armor 4xdemand", () => {
  expect(floorFor(acc(1, 5, 7, 66))).toBe(4);  // Mercurial accessory
  expect(floorFor(acc(2, 5, 7, 0))).toBe(0);   // setless
  expect(floorFor(arm(3, 1, 66))).toBe(20);    // Mercurial armor demand 5 -> 20
  expect(floorFor(arm(4, 1, 49))).toBe(4);     // Killstroke demand 1 -> 4
});
test("bucketCounts excludes worn", () => {
  const items = [arm(1, 1, 48), arm(2, 1, 48, 999), arm(3, 1, 48)];
  const c = bucketCounts(items);
  expect(c.get(bucketKey(arm(1, 1, 48)))).toBe(2); // only the 2 unequipped
});
test("atOrBelowFloor protects thin buckets", () => {
  const items = [arm(1, 1, 49), arm(2, 1, 49)]; // demand1 armor, floor 4, only 2 -> protected
  const c = bucketCounts(items);
  expect(atOrBelowFloor(arm(1, 1, 49), c)).toBe(true);
});
test("setlessDominated: setless flagged when a set accessory matches/beats it", () => {
  const items = [acc(1, 5, 7, 0), acc(2, 5, 7, 60)]; // #1 setless, #2 set 60, same faction5/slot7
  const score = (it) => (it.set === 0 ? 30 : 50); // set piece better
  const dom = setlessDominated(items, score);
  expect(dom.has(1)).toBeTruthy();
  expect(dom.has(2)).toBeFalsy();
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run oracle/analytics/__tests__/supply.test.mjs`
Expected: **4 passed**.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/supply.mjs oracle/analytics/__tests__/supply.test.mjs
git commit -m "feat(analytics): supply buckets, demand-scaled floors, setless-dominated"
```

---

## Task 6: `census.mjs` (descriptive distributions)

**Files:**
- Create: `oracle/analytics/census.mjs`
- Test: `oracle/analytics/__tests__/census.test.mjs`

- [ ] **Step 1: Write `census.mjs`**

```js
import { ASCENDED_LEVEL } from "./weights.mjs";

const tally = (items, key) => {
  const m = new Map();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

export function census(items) {
  return {
    total: items.length,
    bySlot: tally(items, (it) => it.slot),
    bySet: tally(items, (it) => it.set),
    byRarity: tally(items, (it) => it.rarity),
    byLevel: tally(items, (it) => it.level),
    equipped: items.filter((it) => it.equippedChampId > 0).length,
    ascended: items.filter((it) => it.ascLevel === ASCENDED_LEVEL).length,
    glyphed: items.filter((it) => it.substats.some((s) => (s.glyph || 0) > 0)).length,
    accessories: items.filter((it) => it.isAccessory).length,
    setless: items.filter((it) => it.isAccessory && it.set === 0).length,
  };
}
```

- [ ] **Step 2: Write the test (reconciliation)**

```js
// oracle/analytics/__tests__/census.test.mjs
import { test, expect } from "vitest";
import { census } from "../census.mjs";

const it = (over) => ({ slot: 1, set: 1, rarity: 4, level: 16, faction: 0, isAccessory: false,
  substats: [], ascLevel: -1, equippedChampId: 0, ...over });

test("bySlot counts reconcile to total", () => {
  const items = [it({ slot: 1 }), it({ slot: 1 }), it({ slot: 4 })];
  const c = census(items);
  expect(c.total).toBe(3);
  expect([...c.bySlot.values()].reduce((a, b) => a + b, 0)).toBe(c.total);
});
test("setless counts only setless accessories", () => {
  const items = [it({ slot: 8, isAccessory: true, set: 0 }), it({ slot: 8, isAccessory: true, set: 66 }), it({ slot: 1, set: 0 })];
  expect(census(items).setless).toBe(1);
});
```

- [ ] **Step 3: Run — expect PASS**

Run: `npx vitest run oracle/analytics/__tests__/census.test.mjs`
Expected: **2 passed**.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/census.mjs oracle/analytics/__tests__/census.test.mjs
git commit -m "feat(analytics): census distributions + reconciliation"
```

---

## Task 7: `triage.mjs` (classification)

**Files:**
- Create: `oracle/analytics/triage.mjs`
- Test: `oracle/analytics/__tests__/triage.test.mjs`

- [ ] **Step 1: Write `triage.mjs`**

```js
import { quality, investment } from "./score.mjs";
import { bucketCounts, atOrBelowFloor, setlessDominated } from "./supply.mjs";
import { getSet } from "./sets.mjs";
import { CUTS } from "./weights.mjs";

// Demand-led keep-premium: scarcity boosts only when demand >= 3 (DESIGN.md §3.6).
export function keepPremium(setId) {
  const { demand, scarcity } = getSet(setId);
  return demand + (demand >= 3 ? scarcity - 2 : 0);
}

function slotSortedScores(scored) {
  const bySlot = new Map();
  for (const s of scored) {
    if (!bySlot.has(s.item.slot)) bySlot.set(s.item.slot, []);
    bySlot.get(s.item.slot).push(s.q.score);
  }
  for (const arr of bySlot.values()) arr.sort((a, b) => a - b);
  return bySlot;
}

// fraction (%) of slot-mates with score <= value
function percentileOf(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= value) lo = mid + 1; else hi = mid; }
  return sorted.length ? (lo / sorted.length) * 100 : 0;
}

// triage(items) -> array of { item, q, inv, percentile, premium, belowFloor, verdict, reason }
export function triage(items) {
  const scored = items.map((item) => ({ item, q: quality(item), inv: investment(item) }));
  const scoreById = new Map(scored.map((s) => [s.item.id, s.q.score]));
  const counts = bucketCounts(items);
  const dominated = setlessDominated(items, (it) => scoreById.get(it.id) ?? 0);
  const sorted = slotSortedScores(scored);

  for (const s of scored) {
    const p = percentileOf(sorted.get(s.item.slot), s.q.score);
    const premium = keepPremium(s.item.set);
    const belowFloor = atOrBelowFloor(s.item, counts);
    let verdict = "keep", reason = "no rule — default keep";
    if (dominated.has(s.item.id)) {
      verdict = "delete";
      reason = "setless: matched/beaten by a set accessory in this faction+slot";
    } else if (p < CUTS.deletePct && !belowFloor && premium <= CUTS.lowPremium) {
      verdict = "delete";
      reason = `bottom ${CUTS.deletePct}% of slot (p${Math.round(p)}), oversupplied, low keep-premium (${premium})`;
    } else if (p >= CUTS.focusPct && premium >= CUTS.focusPremium) {
      verdict = "focus";
      reason = `top of slot (p${Math.round(p)}), demand/scarcity premium ${premium}`;
    }
    Object.assign(s, { percentile: p, premium, belowFloor, verdict, reason });
  }
  return scored;
}
```

- [ ] **Step 2: Write the test**

```js
// oracle/analytics/__tests__/triage.test.mjs
import { test, expect } from "vitest";
import { triage, keepPremium } from "../triage.mjs";

const sub = (statId, isFlat, rolls = 2) => ({ statId, isFlat, rolls, value: 10, glyph: 0 });
const mk = (id, slot, set, substats, over = {}) => ({ id, slot, set, rank: 6, rarity: 4, level: 16,
  faction: 0, isAccessory: slot >= 7, mainStat: { statId: 4, isFlat: true, value: 0 },
  substats, ascLevel: -1, equippedChampId: 0, ...over });
const dps = [sub(4, true), sub(5, false), sub(6, false), sub(2, false)]; // good
const junk = [sub(1, true), sub(2, true), sub(3, true), sub(1, true)];   // flat junk

test("keepPremium is demand-led (scarcity only counts when demand>=3)", () => {
  expect(keepPremium(49)).toBe(1);  // Killstroke 4/1 -> demand only
  expect(keepPremium(66)).toBe(6);  // Mercurial 5/5 -> 5 + (5-2)
  expect(keepPremium(0)).toBe(1);   // setless 3/1
});
test("low-quality oversupplied low-demand armor is a delete candidate", () => {
  // 12 junk Killstroke (demand1, floor 4) boots so the bucket is above floor and percentiles populate
  const items = [];
  for (let i = 0; i < 12; i++) items.push(mk(100 + i, 4, 49, junk));
  items.push(mk(1, 4, 49, dps)); // one good piece to lift the top of the slot
  const res = triage(items);
  const aJunk = res.find((r) => r.item.id === 100);
  expect(aJunk.verdict, aJunk.reason).toBe("delete");
});
test("high-demand high-quality piece is focus", () => {
  const items = [mk(1, 4, 66, dps)]; // Mercurial, premium 6, single piece -> top of slot
  const res = triage(items);
  expect(res[0].verdict, res[0].reason).toBe("focus");
});
test("setless accessory dominated by a set accessory is delete", () => {
  const items = [mk(1, 7, 0, junk, { isAccessory: true, faction: 5 }),
                 mk(2, 7, 60, dps, { isAccessory: true, faction: 5 })];
  const res = triage(items);
  expect(res.find((r) => r.item.id === 1).verdict).toBe("delete");
});
```

- [ ] **Step 3: Run — expect FAIL first, iterate to PASS**

Run: `npx vitest run oracle/analytics/__tests__/triage.test.mjs`
Expected final: **4 passed**. Note: the "delete candidate" test deliberately stacks 12 junk pieces so the bucket clears the floor of 4 and the junk lands in the bottom percentile.

- [ ] **Step 4: Commit**

```bash
git add oracle/analytics/triage.mjs oracle/analytics/__tests__/triage.test.mjs
git commit -m "feat(analytics): keep/delete/focus triage with reasons"
```

---

## Task 8: `analyze.mjs` (orchestration + report)

**Files:**
- Create: `oracle/analytics/analyze.mjs`

- [ ] **Step 1: Write `analyze.mjs`**

```js
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { census } from "./census.mjs";
import { triage } from "./triage.mjs";
import { getSet } from "./sets.mjs";
import { ARTIFACT_SLOT_NAMES, statDisplayName, lookupName, ARTIFACT_SET_NAMES, FACTION_NAMES } from "@rslh/core";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const dbPath = process.argv[2] || here("../resources/RSLHelper.db");

const { items, corrupt, total } = readArtifacts(dbPath);
const cen = census(items);
const scored = triage(items);

const subLine = (it) => it.substats.map((s) => `${statDisplayName(s.statId, s.isFlat)} ${s.value}`).join(", ");
const label = (s) => {
  const it = s.item;
  const set = it.set === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, it.set);
  const fac = it.isAccessory ? ` ${lookupName(FACTION_NAMES, it.faction)}` : "";
  const badge = [s.inv.ascended ? "💎" : "", s.inv.glyphed ? "🔹" : ""].join("");
  return `#${it.id} ${lookupName(ARTIFACT_SLOT_NAMES, it.slot)} ${set}${fac} lvl${it.level} q${s.q.score}/${s.q.role} ${badge}\n      ${subLine(it)} — ${s.reason}`;
};

const dele = scored.filter((s) => s.verdict === "delete").sort((a, b) => a.q.score - b.q.score);
const focus = scored.filter((s) => s.verdict === "focus").sort((a, b) => b.q.score - a.q.score);

const slotName = (id) => lookupName(ARTIFACT_SLOT_NAMES, id);
const md = [
  `# Gear Vault Analytics — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `**${total} rows** (${corrupt.length} corrupt skipped) · equipped ${cen.equipped} · fully-ascended ${cen.ascended} · glyphed ${cen.glyphed} · accessories ${cen.accessories} (setless ${cen.setless})`,
  ``,
  `## Verdicts`,
  `- delete candidates: **${dele.length}**`,
  `- focus: **${focus.length}**`,
  `- keep: ${scored.length - dele.length - focus.length}`,
  ``,
  `## By slot`,
  [...cen.bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([s, n]) => `- ${slotName(s)}: ${n}`).join("\n"),
  ``,
  `## Top focus (50)`,
  focus.slice(0, 50).map((s) => `- ${label(s)}`).join("\n"),
  ``,
  `## Delete candidates (first 100 of ${dele.length})`,
  dele.slice(0, 100).map((s) => `- ${label(s)}`).join("\n"),
  ``,
].join("\n");

const outDir = here("./out");
mkdirSync(outDir, { recursive: true });
const json = {
  generatedFor: dbPath, total, corrupt, census: {
    ...cen, bySlot: Object.fromEntries(cen.bySlot), bySet: Object.fromEntries(cen.bySet),
    byRarity: Object.fromEntries(cen.byRarity), byLevel: Object.fromEntries(cen.byLevel),
  },
  verdicts: scored.map((s) => ({
    id: s.item.id, slot: s.item.slot, set: s.item.set, faction: s.item.faction,
    score: s.q.score, role: s.q.role, percentile: Math.round(s.percentile),
    premium: s.premium, belowFloor: s.belowFloor, ascended: s.inv.ascended,
    glyphed: s.inv.glyphed, verdict: s.verdict, reason: s.reason,
  })),
};
writeFileSync(here("./out/report.json"), JSON.stringify(json, null, 2));
writeFileSync(here("./out/report.md"), md);
console.log(`decoded ${items.length} (skipped ${corrupt.length}); delete ${dele.length}, focus ${focus.length}. Wrote out/report.{json,md}`);
```

- [ ] **Step 2: Smoke-test on the small known DB (24 items)**

Run: `node --experimental-sqlite oracle/analytics/analyze.mjs oracle/known-gear.db`
Expected: prints `decoded 24 ...`; `oracle/analytics/out/report.md` exists and is readable.

- [ ] **Step 3: Run on the real snapshot**

Run: `node --experimental-sqlite oracle/analytics/analyze.mjs`
Expected: `decoded ~8053 (skipped ~2-4); delete N, focus M.` Open `out/report.md` and eyeball: setless accessories should dominate the delete list; Mercurial/high-demand pieces should not be deleted.

- [ ] **Step 4: Commit (code only — `out/` is gitignored)**

```bash
git add oracle/analytics/analyze.mjs
git commit -m "feat(analytics): orchestrator + json/markdown report"
```

---

## Task 9: Calibration pass (collaborative)

Not a code task — a review gate. After Task 8 runs on the real DB:

- [ ] Eyeball `out/report.md` against intuition. Sanity checks: setless accessories lead the delete list; no Mercurial/Impulse/Lethal pieces in delete; focus list is genuinely your best gear per slot.
- [ ] Tune `weights.mjs` `CUTS` (delete/focus percentiles, premium gates) and the desirability matrix against what looks wrong. Re-run; iterate.
- [ ] Once it reads right, co-author `findings/YYYY-MM-DD.md` (gitignored) — the interactive writeup: headline cull levers (setless count + reclaimable space), focus highlights, recommendations.

---

## Self-Review

**Spec coverage** (DESIGN.md → task):
- §2 data/decode → Task 1: primitives extracted to shared `oracle/lib/decode.mjs` (probe refactored onto it, no duplication); analytics `decodeRow` adds the corrupt-row filter + glyph/ascLevel/cID. ✓
- §3.1 roles, §3.2 set table → Tasks 2–3. ✓
- §3.3 quality (best-matching role, slot-relative ceiling) → Task 4. ✓
- §3.4 investment flag (ascended/glyphed; equipped = context only) → Task 4 (`investment`) + shown in report, never excludes. ✓
- §3.5 supply (accessory faction×slot×set, armor slot×set, worn-excluded counts, setless-dominated) → Task 5. ✓
- §3.6 demand-led keep-premium → Task 7 (`keepPremium`). ✓
- §3.7 triage (focus/delete/keep + reasons + badges) → Task 7 + Task 8 labels. ✓
- §4 census → Task 6. ✓
- §5 deliverables (tool suite + report; out/ gitignored) → Tasks 0, 8. The `findings/` writeup is Task 9. ✓
- §6 parameters → Task 3 (`weights.mjs`). ✓
- §7 testing (decode vs manifest; scoring synergy + flat-amulet; census reconciliation) → Tasks 1,4,6 + per-module tests. ✓

**Placeholder scan:** none — every code step has complete code; the only "TBD-like" item (§6 armor floor) was resolved to `4 × demand`.

**Type consistency:** canonical item shape (`{id, slot, set, rank, rarity, level, faction, isAccessory, mainStat:{statId,isFlat,value}, substats:[{statId,isFlat,rolls,value,glyph}], ascLevel, equippedChampId}`) is produced by `decodeRow` (Task 1) and consumed unchanged by score/supply/census/triage (Tasks 4–7). `quality()` returns `{role, score}`; `investment()` returns `{ascended, glyphed}`; `triage()` items carry `{item, q, inv, percentile, premium, belowFloor, verdict, reason}` — used consistently in `analyze.mjs`. Stat ids are our-space throughout (decode maps DB→ours once). ✓
