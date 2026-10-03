# Champion Power Model Implementation Plan

**Goal:** Add the reverse-engineered Raid champion Power formula, its measured per-champion weight tables, role-keyed fallbacks with per-parameter precedence, and a least-squares calibrator that fits a champion's weights from logged power readings.

**Architecture:** Two new pure ESM modules under `oracle/analytics/`, mirroring the existing speed-solver split. `power-model.mjs` holds the formula (`lin`, `power`, `constantFrom`), the committed weight tables (`BUILT_IN`, `ROLE_DEFAULTS`, `ALL_DEFAULTS`) and the per-parameter resolver `weightsFor`. `power-fit.mjs` holds `fitWeights`, a least squares on `y = √power` that removes each copy's constant by within-copy centering, then runs an **unpivoted** Householder QR over five design columns in a fixed order so that which of two mutually dependent stats is reported undetermined never depends on rounding. Neither module does I/O, and neither imports anything outside `power-model.mjs` — the stat model that produces `totals`, the gear solver and the CLI are separate issues.

**Tech Stack:** Plain Node ESM (`.mjs`, no TypeScript, no build step — `oracle/` sits outside the TS project references), vitest for tests, eslint flat config. No new dependencies.

---

## Scope Check

Single subsystem: everything lands in `oracle/analytics/`. Two pure modules plus their tests, no modifications to existing files. No split needed.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `oracle/analytics/power-model.mjs` | **Create** | The formula, the measured weight tables, and per-parameter weight resolution |
| `oracle/analytics/power-fit.mjs` | **Create** | Least-squares calibration of one champion's weights from logged readings |
| `oracle/analytics/__tests__/power-model.test.mjs` | **Create** | Tests for the formula and `weightsFor` precedence |
| `oracle/analytics/__tests__/power-fit.test.mjs` | **Create** | Tests for `fitWeights` on synthetic readings generated from the formula |
| `docs/plans/ai/issue-43-plan.md` | **Create** | This plan |

**Deliberately unchanged, and why:**

- `oracle/analytics/README.md` — documents **CLI entry points and how to read their output** only. `speed-model.mjs`, `speed-sets.mjs` and `speed-solve.mjs` are pure model modules with no README entry; these two are the same kind. Do not add one.
- `oracle/analytics/DESIGN.md` — the triage/scoring design record. Unrelated.
- `eslint.config.js` — already declares Node globals for `oracle/**/*.mjs` (lines 29–34). New files there need no config change.
- `vitest.config.ts` — already collects `oracle/analytics/**/*.test.mjs` (line 8).
- `.gitignore` — no new data files. Every test fixture is synthetic; no measured reading reaches the repo.

---

## Conventions to follow (read before writing any code)

Copied from the exploration so you do not need to open the reference files:

- **2-space indent, double-quoted strings, semicolons.** `export function` for multi-line exports, `export const … = (…) =>` for one-liners. ~100-column lines.
- **Imports carry the explicit `.mjs` extension**: `import { lin } from "./power-model.mjs";`
- **Header comment carries the model AND the evidence**, with dates and measured numbers. `oracle/analytics/speed-model.mjs:1-12` is the house template.
- **Error messages prefix the subsystem and name the offending value**: `` `power-fit: reading 3 has power 0 — …` ``, like `` `unknown Gestal stat id ${gestalId} (${what}) — the adapter needs updating` ``.
- **Test files** start with a comment giving their own path, then `import { test, expect } from "vitest";`. Flat `test(...)` calls, **no `describe`**. Section banners as `// --- Name ---…` comments. Small literal fixture factories at the top of the file with an overrides spread. **Zero mocks.**
- **`toBeCloseTo` is ABSOLUTE, not relative.** This issue requires recovery to within a *relative* 1e-6, and `k ≈ 0.0015`, so `toBeCloseTo(k, 6)` would pass trivially. Use `expect(Math.abs(got / want - 1)).toBeLessThan(1e-6)` for every weight assertion.
- **One command per Bash call.** Do not chain with `&&` or `;`. Every `git add` and `git commit` below is a separate step on purpose.

---

# Chunk 1 — `power-model.mjs`

### Task 1: `lin` — the linear part of the formula

**Files:**

- Create: `oracle/analytics/power-model.mjs`
- Test: `oracle/analytics/__tests__/power-model.test.mjs`

**Steps:**

- [ ] 1. Create the test file with its fixture factory and the hand-computed total case.

  ```javascript
  // oracle/analytics/__tests__/power-model.test.mjs
  import { test, expect } from "vitest";
  import { lin } from "../power-model.mjs";

  // The game's Total Stats, every source included. C.RATE and C.DMG are percentage POINTS.
  const totals = (o = {}) => ({
    HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o,
  });

  const W = { b: 0.01, r: 0.2, a: 0.03, s: 0.02, k: 0.001 };

  // Hand-computed, term by term, so a sign or a factor going wrong names itself:
  //   b * (30000/15 + 2000 + 1500) = 0.01 * 5500      = 55
  //   r * 100                      = 0.2  * 100       = 20
  //   a * 50                       = 0.03 * 50        =  1.5
  //   s * 200                      = 0.02 * 200       =  4
  //   k * 60 * (100 + 150)         = 0.001 * 60 * 250 = 15
  test("lin sums the five weighted terms of the formula", () => {
    expect(lin(totals(), W)).toBeCloseTo(95.5, 10);
  });
  ```

- [ ] 2. Run the test to verify failure: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: the suite fails to collect — `Failed to load url ../power-model.mjs` / `Cannot find module`.

- [ ] 3. Create `oracle/analytics/power-model.mjs` with only `lin`. Leave the file's header comment for Task 6.

  ```javascript
  // The linear part — everything the formula explains from stat totals. `totals` is a plain object
  // keyed HP, ATK, DEF, SPD, "C.RATE", "C.DMG", RES, ACC, the same keys the stat model will export as
  // STATS; nothing here imports it, so a hand-built object serves as well as a measured one.
  export function lin(totals, w) {
    return w.b * (totals.HP / 15 + totals.ATK + totals.DEF)
      + w.r * totals.RES
      + w.a * totals.ACC
      + w.s * totals.SPD
      + w.k * totals["C.RATE"] * (100 + totals["C.DMG"]);
  }
  ```

- [ ] 4. Run the test to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `1 passed`.

- [ ] 5. Add the test that pins the `/15`, so the shared weight `b` cannot drift into three separate ones.

  ```javascript
  // HP, ATK and DEF share ONE weight: fifteen points of HP buy exactly what one point of ATK does.
  // Measured to within 1% on four champions.
  test("lin divides HP by 15 before sharing b with ATK and DEF", () => {
    const onlyB = { b: 0.01, r: 0, a: 0, s: 0, k: 0 };
    const bare = { SPD: 0, "C.RATE": 0, "C.DMG": 0, RES: 0, ACC: 0 };
    expect(lin({ ...bare, HP: 1500, ATK: 0, DEF: 0 }, onlyB)).toBeCloseTo(1, 10);
    expect(lin({ ...bare, HP: 0, ATK: 100, DEF: 0 }, onlyB)).toBeCloseTo(1, 10);
    expect(lin({ ...bare, HP: 0, ATK: 0, DEF: 100 }, onlyB)).toBeCloseTo(1, 10);
  });
  ```

- [ ] 6. Run the test to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `2 passed`. (This one passes on the Task 1 implementation — its job is to lock the `/15` against a later edit, not to drive new code.)

- [ ] 7. Add the test that pins the crit product's `100 +`.

  ```javascript
  // Crit enters as the PRODUCT k * C.RATE * (100 + C.DMG), not as two independent terms: on four
  // champions the k from a pure C.RATE step and the k from a pure C.DMG step agree to about 1%.
  // The `100 +` is why C.RATE pays even at C.DMG 0 — and why no crit rate means no crit term at all.
  test("lin's crit term is k x C.RATE x (100 + C.DMG)", () => {
    const onlyK = { b: 0, r: 0, a: 0, s: 0, k: 0.001 };
    const crit = (cr, cd) =>
      ({ HP: 0, ATK: 0, DEF: 0, SPD: 0, "C.RATE": cr, "C.DMG": cd, RES: 0, ACC: 0 });
    expect(lin(crit(60, 0), onlyK)).toBeCloseTo(6, 10);      // 0.001 * 60 * 100
    expect(lin(crit(60, 150), onlyK)).toBeCloseTo(15, 10);   // 0.001 * 60 * 250
    expect(lin(crit(0, 150), onlyK)).toBe(0);
  });
  ```

- [ ] 8. Run the test to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `3 passed`.

- [ ] 9. Stage the two files: `git add oracle/analytics/power-model.mjs oracle/analytics/__tests__/power-model.test.mjs`

- [ ] 10. Commit: `git commit -m "feat(analytics): power-model lin(), the linear part of the power formula" -m "Co-Authored-By: Claude"`

---

### Task 2: `power` and `constantFrom`

**Files:**

- Modify: `oracle/analytics/power-model.mjs`
- Test: `oracle/analytics/__tests__/power-model.test.mjs`

**Steps:**

- [ ] 1. Add the `power` test. Append to the test file; extend the import on line 2 to `import { constantFrom, lin, power } from "../power-model.mjs";`

  ```javascript
  // --- power and the copy constant ---------------------------------------------------------------

  // Power is the SQUARE of the linear part plus the copy's constant. lin(totals(), W) is 95.5, so a
  // constant of 4.5 makes the whole bracket 100 and the power exactly 10000.
  test("power squares the linear part plus the copy constant", () => {
    expect(power(totals(), W, 4.5)).toBeCloseTo(10000, 6);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: 1 failing — `power is not a function`.

- [ ] 3. Add `power` to `oracle/analytics/power-model.mjs`, below `lin`.

  ```javascript
  // Power is the SQUARE of the linear part plus the copy's constant. Fitting in power rather than
  // sqrt(power) is the mistake this shape exists to avoid: removing two gear pieces is additive in
  // sqrt(power) to within 0.15%, and 4% off in power.
  export const power = (totals, w, c) => (lin(totals, w) + c) ** 2;
  ```

- [ ] 4. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `4 passed`.

- [ ] 5. Add the `constantFrom` round-trip test. Note the **relative** comparison: `toBeCloseTo(123456, 6)` would demand an absolute 5e-7 on a number near 1e5, which float arithmetic cannot deliver.

  ```javascript
  // The round trip the calibrator relies on: a constant measured off one reading reproduces that
  // reading's power. Compared RELATIVELY — an absolute tolerance on a five-digit power is a tolerance
  // on the fourteenth significant digit.
  test("constantFrom recovers the c that reproduces an observed power", () => {
    const observed = 123456;
    const c = constantFrom(totals(), W, observed);
    expect(Math.abs(power(totals(), W, c) / observed - 1)).toBeLessThan(1e-12);
  });
  ```

- [ ] 6. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: 1 failing — `constantFrom is not a function`.

- [ ] 7. Add `constantFrom` to `oracle/analytics/power-model.mjs`, below `power`.

  ```javascript
  // The copy constant from a SINGLE reading: whatever the stats do not explain. Left signed and never
  // clamped at 0 — a disagreement between the weights and the reading has to stay visible rather than
  // be absorbed into a floor. (measureConstant in speed-model.mjs is the same idea for speed.)
  export const constantFrom = (totals, w, observedPower) => Math.sqrt(observedPower) - lin(totals, w);
  ```

- [ ] 8. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `5 passed`.

- [ ] 9. Stage: `git add oracle/analytics/power-model.mjs oracle/analytics/__tests__/power-model.test.mjs`

- [ ] 10. Commit: `git commit -m "feat(analytics): power() and constantFrom() for the power model" -m "Co-Authored-By: Claude"`

---

### Task 3: the three weight tables

The 23 numbers below are the measurement output and are invisible to any behavioural test. **Transcribe them from this plan character by character and re-read them once against the issue body before committing.**

**Files:**

- Modify: `oracle/analytics/power-model.mjs`
- Test: `oracle/analytics/__tests__/power-model.test.mjs`

**Steps:**

- [ ] 1. Add the table-invariant test. Extend the import on line 2 to `import { ALL_DEFAULTS, BUILT_IN, constantFrom, lin, power, ROLE_DEFAULTS } from "../power-model.mjs";`

  ```javascript
  // --- the weight tables -------------------------------------------------------------------------

  const PARAMS = ["b", "r", "a", "s", "k"];

  // The invariant weightsFor leans on: between them these two tables supply all five parameters, so
  // the fallback chain always terminates in five positive weights however little is known about a
  // champion. Lose this and weightsFor starts returning undefined weights, which lin turns into NaN.
  test("ROLE_DEFAULTS and ALL_DEFAULTS together cover all five parameters for every role", () => {
    expect(Object.keys(ROLE_DEFAULTS).sort()).toEqual(["0", "1", "2", "3"]);
    for (const roleId of Object.keys(ROLE_DEFAULTS)) {
      for (const name of PARAMS) {
        const v = ROLE_DEFAULTS[roleId][name] ?? ALL_DEFAULTS[name];
        expect(Number.isFinite(v) && v > 0).toBe(true);
      }
    }
  });

  // Every weight measured so far is positive, and the solvers that will consume them need
  // non-negative weights. A zero or a negative in a committed table would be a transcription slip.
  test("every weight in every table is a finite positive number", () => {
    const tables = [...Object.values(BUILT_IN), ...Object.values(ROLE_DEFAULTS), ALL_DEFAULTS];
    for (const table of tables) {
      for (const name of PARAMS) {
        if (table[name] === undefined) continue;   // partial rows are legitimate; see Helicath
        expect(Number.isFinite(table[name]) && table[name] > 0).toBe(true);
      }
    }
  });

  // A BUILT_IN row whose roleId the defaults do not know could never be filled in, and weightsFor
  // would throw for a champion we have actually measured.
  test("every BUILT_IN roleId is a key of ROLE_DEFAULTS", () => {
    for (const [id, row] of Object.entries(BUILT_IN)) {
      expect(ROLE_DEFAULTS[row.roleId], `baseTypeId ${id}`).toBeDefined();
    }
  });

  // Helicath's b, r and a were never measured. The built-in precedence test below depends on their
  // being ABSENT rather than guessed, so pin that rather than let a later edit quietly fill them.
  test("Helicath's BUILT_IN row is partial: s and k only", () => {
    expect(BUILT_IN[7200].s).toBeGreaterThan(0);
    expect(BUILT_IN[7200].k).toBeGreaterThan(0);
    expect(BUILT_IN[7200].b).toBeUndefined();
    expect(BUILT_IN[7200].r).toBeUndefined();
    expect(BUILT_IN[7200].a).toBeUndefined();
  });

  // The one role pattern the measurements showed: b and r split Defense (roleId 1) from the other
  // three, which is the whole reason ROLE_DEFAULTS is keyed by role at all.
  test("the Defense role defaults carry a higher b and a lower r than every other role", () => {
    for (const roleId of [0, 2, 3]) {
      expect(ROLE_DEFAULTS[1].b).toBeGreaterThan(ROLE_DEFAULTS[roleId].b);
      expect(ROLE_DEFAULTS[1].r).toBeLessThan(ROLE_DEFAULTS[roleId].r);
    }
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: 5 failing — `Cannot read properties of undefined` / `ROLE_DEFAULTS is undefined`.

- [ ] 3. Add `BUILT_IN` to `oracle/analytics/power-model.mjs`, below `constantFrom`.

  ```javascript
  // --- the measured weights ----------------------------------------------------------------------

  // Keyed by BASE champion id (Gestal `baseTypeId`), which every copy of a champion shares — the
  // weights are a property of the champion, while the constant `c` is a property of the copy.
  // `name` and `roleId` are carried for readability and for the roleId invariant in the tests;
  // weightsFor reads neither. Thor's `k` was measured on an unleveled spare copy.
  export const BUILT_IN = {
    7090:  { name: "Ultimate Deathknight", roleId: 1, b: 0.01936, r: 0.1870, a: 0.03483, s: 0.0038, k: 0.001245 },
    4570:  { name: "Madame Serris",        roleId: 3, b: 0.01187, r: 0.2644, a: 0.0552,  s: 0.0235, k: 0.00171 },
    9170:  { name: "Thor Faehammer",       roleId: 0, b: 0.01237, r: 0.2852, a: 0.0378,  s: 0.0205, k: 0.00125 },
    10410: { name: "Pelops the Victor",    roleId: 2, b: 0.01238, r: 0.2819, a: 0.02688, s: 0.0056, k: 0.00192 },
    // Partial ON PURPOSE: only SPD and crit steps were logged for this copy, so b, r and a are
    // ABSENT rather than guessed. weightsFor fills them from the defaults, per parameter, and still
    // reports the source as "built-in".
    7200:  { name: "Helicath",             roleId: 1, s: 0.0079, k: 0.00155 },
  };
  ```

- [ ] 4. Add `ROLE_DEFAULTS` and `ALL_DEFAULTS` directly below `BUILT_IN`.

  ```javascript
  // Fallbacks for a champion with no measured row, keyed by Gestal roleId (0 Attack, 1 Defense,
  // 2 HP, 3 Support). `b` and `r` are the two parameters that split by role — Defense sits apart
  // from the other three — and `s` carries the role-or-SPD-level ambiguity in the open questions.
  export const ROLE_DEFAULTS = {
    0: { b: 0.0122, r: 0.277, s: 0.022 },   // Attack
    1: { b: 0.0194, r: 0.187, s: 0.0059 },  // Defense
    2: { b: 0.0122, r: 0.277, s: 0.0056 },  // HP
    3: { b: 0.0122, r: 0.277, s: 0.022 },   // Support
  };

  // `a` and `k` showed NO role pattern, so there is nothing to key them on: these are the means over
  // the measured champions. Between them these two tables cover all five parameters, which is what
  // lets weightsFor always return five positive weights.
  export const ALL_DEFAULTS = { a: 0.0387, k: 0.00154 };
  ```

- [ ] 5. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `10 passed`.

- [ ] 6. Re-read the five `BUILT_IN` rows, the four `ROLE_DEFAULTS` rows and `ALL_DEFAULTS` against the issue body digit by digit. No test can catch a transcription slip here.

- [ ] 7. Stage: `git add oracle/analytics/power-model.mjs oracle/analytics/__tests__/power-model.test.mjs`

- [ ] 8. Commit: `git commit -m "feat(analytics): measured power weights, role defaults and all-champion means" -m "Co-Authored-By: Claude"`

---

### Task 4: `weightsFor` — per-parameter precedence

**Files:**

- Modify: `oracle/analytics/power-model.mjs`
- Test: `oracle/analytics/__tests__/power-model.test.mjs`

**Steps:**

- [ ] 1. Add the first precedence test. Extend the import on line 2 to also take `weightsFor`.

  ```javascript
  // --- weightsFor precedence ---------------------------------------------------------------------

  const FITTED = { b: 0.02, r: 0.3, a: 0.05, s: 0.01, k: 0.002 };

  test("weightsFor prefers a full fitted table over everything else", () => {
    const got = weightsFor({ baseTypeId: 7090, roleId: 1 }, { 7090: FITTED });
    expect(got.weights).toEqual(FITTED);
    expect(got.source).toBe("fitted");
    expect(got.fromDefaults).toEqual([]);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: 1 failing — `weightsFor is not a function`.

- [ ] 3. Add `PARAMS`, `measured` and `weightsFor` to `oracle/analytics/power-model.mjs`, below `ALL_DEFAULTS`.

  ```javascript
  // --- resolving one champion's weights ----------------------------------------------------------

  // The five parameters in a fixed order, so `fromDefaults` reads the same way on every call.
  const PARAMS = ["b", "r", "a", "s", "k"];

  // A weight counts only when it is a finite number above zero. A least-squares fit returns null for
  // a parameter it could not determine, and can return a zero or a negative one for a stat it barely
  // saw; neither is plausible — every weight measured so far is positive — and a negative one would
  // break the solvers, which need non-negative weights. Applying the same test to BUILT_IN is what
  // makes a partial row like Helicath's fall through per parameter instead of yielding `undefined`.
  const measured = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

  // Each of the five parameters is resolved SEPARATELY down the chain, so a champion with one fitted
  // weight and a partial built-in row gets the best available value for each rather than one table
  // wholesale. `source` is the highest-priority table that supplied ANY parameter; `fromDefaults`
  // lists the parameters that fell all the way through to a default table.
  export function weightsFor({ baseTypeId, roleId }, fitted = {}) {
    // Indexed RAW, never through Number(): the roleId comes off champion data with no NOT NULL
    // guarantee, and Number(null) is 0, which would quietly grade a role-less champion as Attack.
    const role = ROLE_DEFAULTS[roleId];
    // Unconditional, even when a fitted or built-in row would supply all five. A roleId the defaults
    // do not know is bad champion data, and answering anyway hides it until the first champion that
    // actually needs the fallback arrives.
    if (!role) {
      throw new Error(`power-model: unknown roleId ${roleId}`
        + ` — ROLE_DEFAULTS knows ${Object.keys(ROLE_DEFAULTS).join(", ")}`);
    }
    // Highest priority first. The last two both report as "role default": ALL_DEFAULTS is the role
    // table's own fallback for the two parameters that showed no role pattern, not a tier a caller
    // would ever distinguish.
    const tiers = [
      { source: "fitted", table: fitted?.[baseTypeId], isDefault: false },
      { source: "built-in", table: BUILT_IN[baseTypeId], isDefault: false },
      { source: "role default", table: role, isDefault: true },
      { source: "role default", table: ALL_DEFAULTS, isDefault: true },
    ];
    const weights = {};
    const fromDefaults = [];
    // The last tier is the floor: ROLE_DEFAULTS + ALL_DEFAULTS cover all five parameters, so every
    // parameter resolves and this index can only move toward a higher-priority tier.
    let best = tiers.length - 1;
    for (const name of PARAMS) {
      for (let i = 0; i < tiers.length; i++) {
        if (!measured(tiers[i].table?.[name])) continue;
        weights[name] = tiers[i].table[name];
        if (tiers[i].isDefault) fromDefaults.push(name);
        if (i < best) best = i;
        break;
      }
    }
    return { weights, source: tiers[best].source, fromDefaults };
  }
  ```

- [ ] 4. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `11 passed`.

- [ ] 5. Add the partial-built-in test. `fromDefaults` is in `PARAMS` order, so Helicath's is exactly `["b", "r", "a"]`.

  ```javascript
  // Helicath's row supplies s and k only, so b and r come off the role table and a off the
  // all-champion means — and the source is still "built-in", because a built-in row DID answer.
  test("weightsFor fills a partial built-in row from the role and all-champion defaults", () => {
    const got = weightsFor({ baseTypeId: 7200, roleId: 1 });
    expect(got.source).toBe("built-in");
    expect(got.fromDefaults).toEqual(["b", "r", "a"]);
    expect(got.weights.s).toBe(BUILT_IN[7200].s);
    expect(got.weights.k).toBe(BUILT_IN[7200].k);
    expect(got.weights.b).toBe(ROLE_DEFAULTS[1].b);
    expect(got.weights.r).toBe(ROLE_DEFAULTS[1].r);
    expect(got.weights.a).toBe(ALL_DEFAULTS.a);
  });
  ```

- [ ] 6. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `12 passed`.

- [ ] 7. Add the unknown-champion test.

  ```javascript
  // A champion in no table at all: every parameter is a default, and the two with no role pattern
  // come from ALL_DEFAULTS.
  test("weightsFor falls back to the role defaults for a champion in no table", () => {
    const got = weightsFor({ baseTypeId: 999999, roleId: 0 });
    expect(got.source).toBe("role default");
    expect(got.fromDefaults).toEqual(["b", "r", "a", "s", "k"]);
    expect(got.weights).toEqual({ ...ROLE_DEFAULTS[0], ...ALL_DEFAULTS });
  });
  ```

- [ ] 8. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `13 passed`.

- [ ] 9. Add the two per-parameter-fallback tests.

  ```javascript
  // A fit determines some parameters and not others, and returns null for the rest. The null falls
  // through on its own while the four real values stand — which is the point of resolving per
  // parameter rather than picking one table.
  test("weightsFor falls back per parameter for a null in an otherwise fitted row", () => {
    const got = weightsFor({ baseTypeId: 7200, roleId: 1 }, { 7200: { ...FITTED, s: null } });
    expect(got.source).toBe("fitted");
    expect(got.weights.b).toBe(FITTED.b);
    expect(got.weights.s).toBe(BUILT_IN[7200].s);
    expect(got.fromDefaults).toEqual([]);
  });

  // A weakly measured stat can come back zero or negative from least squares, and a broken fit can
  // come back NaN. None of those is a measurement, so each falls through exactly as the null does.
  test("weightsFor skips a fitted value that is not a finite positive number", () => {
    for (const bad of [NaN, 0, -0.01, Infinity, undefined]) {
      const got = weightsFor({ baseTypeId: 7200, roleId: 1 }, { 7200: { ...FITTED, s: bad } });
      expect(got.weights.s, `fitted s = ${bad}`).toBe(BUILT_IN[7200].s);
    }
  });
  ```

- [ ] 10. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `15 passed`.

- [ ] 11. Stage: `git add oracle/analytics/power-model.mjs oracle/analytics/__tests__/power-model.test.mjs`

- [ ] 12. Commit: `git commit -m "feat(analytics): weightsFor() resolves power weights per parameter" -m "Co-Authored-By: Claude"`

---

### Task 5: `weightsFor` throws unconditionally on an unknown `roleId`

**Files:**

- Test: `oracle/analytics/__tests__/power-model.test.mjs`

This behaviour is already implemented in Task 4 (the throw is the first statement in the function), so this test will pass immediately. It is here because the throw being **unconditional** is an acceptance criterion in its own right, and nothing in Task 4's tests would catch a later "optimisation" that skipped the role lookup when a fitted row was complete.

**Steps:**

- [ ] 1. Add the throw test.

  ```javascript
  // Unconditional on purpose. The tempting shortcut — skip the role lookup when a fitted row already
  // supplies all five — would make the bad roleId surface only for the FIRST champion that needs a
  // default, long after the data that produced it.
  test("weightsFor throws on an unknown roleId even when a full fitted table is supplied", () => {
    const bad = (roleId) => () => weightsFor({ baseTypeId: 7090, roleId }, { 7090: FITTED });
    expect(bad(4)).toThrow(/power-model/);
    expect(bad(4)).toThrow(/roleId 4/);
    expect(bad(undefined)).toThrow(/roleId/);
    expect(bad(null)).toThrow(/roleId/);
    expect(bad("Attack")).toThrow(/roleId/);
  });
  ```

- [ ] 2. Run: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `16 passed`. If any case does **not** throw, fix `weightsFor` — do not relax the test.

- [ ] 3. Stage: `git add oracle/analytics/__tests__/power-model.test.mjs`

- [ ] 4. Commit: `git commit -m "test(analytics): pin weightsFor's unconditional unknown-roleId throw" -m "Co-Authored-By: Claude"`

---

### Task 6: `power-model.mjs` header comment

Documentation only — no TDD cycle, but the verification steps still apply. This satisfies the acceptance criterion "states the formula, summarizes the evidence from the Description, and lists the open questions from Notes".

**Files:**

- Modify: `oracle/analytics/power-model.mjs`

**Steps:**

- [ ] 1. Insert this block as the very first lines of `oracle/analytics/power-model.mjs`, above `lin`.

  ```javascript
  // Raid's champion Power, reverse-engineered on 2026-10-03 from about 50 in-game readings across
  // five champions, each paired with exact totals from the Gestal stat model. The game publishes no
  // formula, and the community's per-stat "weights" are wrong in both scale and shape.
  //
  //   sqrt(power) = b*(HP/15 + ATK + DEF) + r*RES + a*ACC + s*SPD + k*C.RATE*(100 + C.DMG) + c
  //
  // Stats are the game's Total Stats with every source included (base, gear, sets, masteries,
  // guardians, empowerment, blessing, relic, Great Hall, Classic Arena). C.RATE and C.DMG are in
  // percentage POINTS, not fractions.
  //
  // The evidence:
  //
  //   - Power is a SQUARE, not a weighted sum. Single-stat changes are predicted from the measured
  //     weights to within about 0.1% — a control removal to 0.07%, an SPD-range check to 0.03%.
  //     Removing two gear pieces is additive in sqrt(power) to within 0.15%, where in power it is 4%
  //     off. Across VERY different builds of one copy, 0.6-1.5% in power stays unexplained.
  //   - HP/15, ATK and DEF share ONE weight `b`, to within 1% on four champions.
  //   - Crit enters as the product k*C.RATE*(100 + C.DMG): on four champions the `k` from a pure
  //     C.RATE step and the `k` from a pure C.DMG step agree to about 1%.
  //   - The weights vary BY CHAMPION, which is why BUILT_IN is keyed per champion and ROLE_DEFAULTS
  //     is only a fallback. `b` and `r` split Defense from the other three roles; `a` and `k` vary
  //     per champion with no role pattern; `s` is about 0.006 for the Defense and HP champions
  //     measured and about 0.022 for the Attack and Support ones.
  //   - `c` is per COPY and never changes with gear — it holds non-stat investment. Choosing a
  //     blessing added about 4.65 sqrt(power) beyond the blessing's own stats. Set effects showed no
  //     hidden power at all.
  //
  // Open questions, recorded here and NOT resolved in this module:
  //
  //   - whether SPD's weight follows ROLE or SPD LEVEL; the measurements so far fit both, with a
  //     cut-off around 215.
  //   - the unexplained 0.6-1.5% residual in power between very different builds of the same copy,
  //     against about 0.1% for single-stat changes from one build.
  //   - what besides blessings makes up `c`.
  //   - the per-champion spread of `a` (2x) and `k` (1.5x).
  //
  // Pure arithmetic on stat totals, and it imports nothing: the stat model that produces `totals`,
  // the gear solver and the CLI that logs readings are all separate. The readings themselves are
  // personal account data and stay local — only these derived weights, which are game mechanics,
  // are committed.
  ```

- [ ] 2. Confirm the header mentions all four open questions: `grep -c "^//" oracle/analytics/power-model.mjs`

  Expected: a count of 40 or more comment lines.

- [ ] 3. Confirm the formula line is present verbatim: `grep -n "sqrt(power) = b\*" oracle/analytics/power-model.mjs`

  Expected: one match, inside the header block.

- [ ] 4. Run the module's tests to confirm the insert broke nothing: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs`

  Expected: `16 passed`.

- [ ] 5. Lint the new file: `npx eslint oracle/analytics/power-model.mjs`

  Expected: no output.

- [ ] 6. Stage: `git add oracle/analytics/power-model.mjs`

- [ ] 7. Commit: `git commit -m "docs(analytics): record the power formula, its evidence and its open questions" -m "Co-Authored-By: Claude"`

---

# Chunk 2 — `power-fit.mjs`

All of Chunk 2's tests share one fixture block. Task 7 creates it; later tasks only append tests.

### Task 7: `fitWeights` input checks

**Files:**

- Create: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/power-fit.test.mjs` with the shared fixture block. Read the comments — the shape of `STEPS` and `OVER_22` is load-bearing for every later task.

  ```javascript
  // oracle/analytics/__tests__/power-fit.test.mjs
  import { test, expect } from "vitest";
  import { fitWeights } from "../power-fit.mjs";
  import { power, weightsFor } from "../power-model.mjs";

  // A baseTypeId in no BUILT_IN table, so every prior in these tests is a role default and the test
  // never has to know which champion it is standing in for.
  const BASE = 999001;
  const ROLE = 0;

  const totals = (o = {}) => ({
    HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o,
  });

  // Unique per (copy, step) so a test can line residuals up with the readings that produced them.
  const stamp = (heroId, i) => new Date(Date.UTC(2026, 9, 3, 0, heroId % 60, i)).toISOString();

  // Generated FROM the formula, so a fit that recovers w and c is recovering what produced the
  // numbers rather than agreeing with itself. `name` is carried because the record has it; nothing
  // in fitWeights reads it.
  const reading = (heroId, stats, w, c, i) => ({
    t: stamp(heroId, i), heroId, baseTypeId: BASE, name: "Synthetic", roleId: ROLE,
    totals: stats, power: power(stats, w, c),
  });

  // A baseline plus one single-stat step per design column. The steps move DISJOINT readings, and the
  // baseline is in no step's support, which is what leaves the five centered columns independent.
  // X_B and X_K each get two steps, one from each stat that feeds them.
  const STEPS = [
    {},                    // baseline
    { HP: 36000 },         // X_B
    { ATK: 2600 },         // X_B, from the other side of the shared weight
    { RES: 160 },
    { ACC: 90 },
    { SPD: 240 },
    { "C.RATE": 85 },      // X_K
    { "C.DMG": 220 },      // X_K, from the other factor of the crit product
  ];

  // `over` shifts a whole copy's baseline. Both copies sitting at DIFFERENT stat levels is what makes
  // a global mean (instead of a per-copy one) produce visibly wrong weights: at identical levels the
  // copy difference is orthogonal to every design column and a global mean recovers them by luck.
  const OVER_22 = {
    HP: 42000, ATK: 2000, DEF: 1500, SPD: 230, "C.RATE": 70, "C.DMG": 180, RES: 130, ACC: 70,
  };

  const copy = (heroId, w, c, over = {}, steps = STEPS) =>
    steps.map((step, i) => reading(heroId, totals({ ...over, ...step }), w, c, i));

  const W = { b: 0.0131, r: 0.2641, a: 0.0412, s: 0.0193, k: 0.00168 };
  const C11 = 37.5;
  const C22 = 51.25;

  // Relative, not absolute: these weights span 0.0017 to 0.26, so one absolute tolerance cannot
  // mean the same thing for all five.
  const close = (got, want) => Math.abs(got / want - 1);

  // --- input checks ------------------------------------------------------------------------------

  test("fitWeights refuses an empty reading list", () => {
    expect(() => fitWeights([])).toThrow(/power-fit/);
    expect(() => fitWeights([])).toThrow(/no readings/);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: the suite fails to collect — `Cannot find module '../power-fit.mjs'`.

- [ ] 3. Create `oracle/analytics/power-fit.mjs` with the module constants and the empty-list check only. Leave the header comment for Task 16.

  ```javascript
  import { lin, power, weightsFor } from "./power-model.mjs";

  // The design columns, in the FIXED order the factorization walks them. The order is part of the
  // contract: the QR does not pivot, so which of two mutually dependent stats is kept and which is
  // reported undetermined follows THIS LIST rather than whichever happened to end up with the larger
  // norm. ACC sits after RES, so a champion whose ACC only ever moves with RES loses `a`, not `r`.
  const COLUMNS = [
    { param: "b", of: (t) => t.HP / 15 + t.ATK + t.DEF },
    { param: "r", of: (t) => t.RES },
    { param: "a", of: (t) => t.ACC },
    { param: "s", of: (t) => t.SPD },
    { param: "k", of: (t) => t["C.RATE"] * (100 + t["C.DMG"]) },
  ];

  // Every key lin() reads. Checked up front so a typo in a logged reading fails here, naming the
  // stat, rather than becoming a NaN that propagates into every number the fit returns.
  const TOTAL_KEYS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"];

  export function fitWeights(readings) {
    if (!Array.isArray(readings) || readings.length === 0) {
      throw new Error("power-fit: no readings");
    }
  }
  ```

- [ ] 4. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `1 passed`.

- [ ] 5. Add the bad-`power` test. Several bad shapes in one test because they are one rule, matching `speed-corpus.test.mjs:77-84`.

  ```javascript
  // A reading whose power is not a positive finite number cannot be square-rooted into the response
  // variable, and a NaN there would quietly turn every fitted weight into NaN.
  test("fitWeights refuses a reading whose power is not a positive finite number", () => {
    const bad = (p) => () => fitWeights([{ ...reading(11, totals(), W, C11, 0), power: p }]);
    expect(bad(0)).toThrow(/power 0/);
    expect(bad(0)).toThrow(/power-fit/);
    expect(bad(-1)).toThrow(/power -1/);
    expect(bad(NaN)).toThrow(/power NaN/);
    expect(bad(undefined)).toThrow(/power-fit/);
  });
  ```

- [ ] 6. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — no throw at all (`fitWeights` returns `undefined`).

- [ ] 7. Add the per-reading validation loop inside `fitWeights`, directly below the empty-list check.

  ```javascript
    readings.forEach((r, i) => {
      if (!Number.isFinite(r?.power) || r.power <= 0) {
        throw new Error(`power-fit: reading ${i} has power ${r?.power}`
          + " — expected a positive finite number");
      }
      for (const key of TOTAL_KEYS) {
        if (!Number.isFinite(r.totals?.[key])) {
          throw new Error(`power-fit: reading ${i} has a non-finite ${key} (${r.totals?.[key]})`);
        }
      }
    });
  ```

- [ ] 8. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `2 passed`.

- [ ] 9. Add the bad-totals test.

  ```javascript
  // The stat is named because a reading has eight of them, and "a total is not finite" sends the
  // reader through all eight by hand.
  test("fitWeights refuses a reading with a non-finite total, naming the stat", () => {
    const r = reading(11, totals(), W, C11, 0);
    const broken = { ...r, totals: { ...r.totals, "C.RATE": NaN } };
    expect(() => fitWeights([broken])).toThrow(/C\.RATE/);
    expect(() => fitWeights([broken])).toThrow(/power-fit/);
  });
  ```

- [ ] 10. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `3 passed`.

- [ ] 11. Add the mixed-champion test.

  ```javascript
  // Weights are per champion. Fitting two together would average them into something that describes
  // neither, and nothing downstream could tell that had happened — so it is refused, loudly, with
  // both ids named so the caller can see what it has to group by.
  test("fitWeights refuses readings from two champions, naming the ids found", () => {
    const mixed = [
      ...copy(11, W, C11),
      ...copy(22, W, C22, OVER_22).map((r) => ({ ...r, baseTypeId: 7090 })),
    ];
    expect(() => fitWeights(mixed)).toThrow(/power-fit/);
    expect(() => fitWeights(mixed)).toThrow(/999001/);
    expect(() => fitWeights(mixed)).toThrow(/7090/);
    expect(() => fitWeights(mixed)).toThrow(/baseTypeId/);
  });
  ```

- [ ] 12. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — no throw.

- [ ] 13. Add the one-champion check below the validation loop in `fitWeights`.

  ```javascript
    const ids = [...new Set(readings.map((r) => r.baseTypeId))];
    if (ids.length > 1) {
      throw new Error(`power-fit: readings mix ${ids.length} champions (baseTypeId ${ids.join(", ")})`
        + " — weights are per champion, so fitting them together would silently average two sets;"
        + " group by baseTypeId and call once per champion");
    }
  ```

- [ ] 14. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `4 passed`.

- [ ] 15. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 16. Commit: `git commit -m "feat(analytics): power-fit input checks, one champion per call" -m "Co-Authored-By: Claude"`

---

### Task 8: the fit itself — one copy, exact recovery

The largest green step in the plan. It brings in the within-copy centering, the Householder helpers, the unpivoted factorization and the back-substitution. Each step below is a single paste.

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the one-copy recovery test.

  ```javascript
  // --- the fit -----------------------------------------------------------------------------------

  // Eight readings of one copy, generated from the formula: a baseline plus one step per design
  // column. An exact solution exists, so least squares has to land on it.
  test("fitWeights recovers known weights and one copy's constant from eight readings", () => {
    const fit = fitWeights(copy(11, W, C11));
    expect(fit.undetermined).toEqual([]);
    for (const name of ["b", "r", "a", "s", "k"]) {
      expect(close(fit.params[name], W[name]), name).toBeLessThan(1e-6);
    }
    expect(fit.constants.size).toBe(1);
    expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — `Cannot read properties of undefined (reading 'undetermined')`.

- [ ] 3. Add the numeric helpers and the two tolerances to `oracle/analytics/power-fit.mjs`, below `TOTAL_KEYS`.

  ```javascript
  // A centered column counts as VARYING when it keeps this fraction of its own uncentered norm...
  const VARY_TOL = 1e-9;
  // ...and as INDEPENDENT of the columns before it when the norm it has left after their reflections
  // clears this. Both are dimensionless: the varying test is a ratio, and the factorization runs on
  // columns scaled to unit length.
  const RANK_TOL = 1e-9;

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const mean = (xs) => sum(xs) / xs.length;
  const norm2 = (xs) => Math.sqrt(sum(xs.map((x) => x * x)));
  ```

- [ ] 4. Add the three Householder helpers, below the numeric helpers.

  ```javascript
  // --- Householder QR ----------------------------------------------------------------------------
  // Hand-rolled because the repo has no linear algebra and this needs none beyond one reflector at a
  // time. NOT solved through the normal equations: the stat columns span about 1 to 1e5, and forming
  // X'X squares that conditioning.

  const tailNorm = (col, p) => {
    let t = 0;
    for (let i = p; i < col.length; i++) t += col[i] * col[i];
    return Math.sqrt(t);
  };

  // A reflector that zeroes rows p+1.. of `col`. Rows above p are untouched, so applying the kept
  // columns' reflectors in order builds R one column at a time.
  function reflector(col, p) {
    const tail = tailNorm(col, p);
    // -sign(col[p]) keeps v[p] away from zero; the other sign subtracts two nearly equal numbers.
    const alpha = (col[p] >= 0 ? -1 : 1) * tail;
    const v = new Array(col.length).fill(0);
    for (let i = p; i < col.length; i++) v[i] = col[i];
    v[p] -= alpha;
    let vtv = 0;
    for (let i = p; i < v.length; i++) vtv += v[i] * v[i];
    return { p, v, vtv };
  }

  function reflect(h, vec) {
    if (h.vtv === 0) return;   // unreachable: a kept column's tail clears RANK_TOL, so v[p] != 0
    let dot = 0;
    for (let i = h.p; i < h.v.length; i++) dot += h.v[i] * vec[i];
    const f = (2 * dot) / h.vtv;
    for (let i = h.p; i < h.v.length; i++) vec[i] -= f * h.v[i];
  }
  ```

- [ ] 5. Add `factorize` and `solve`, below the reflector helpers.

  ```javascript
  // Unpivoted QR over `cols` (each already unit 2-norm), left to right. `kept` holds the positions
  // that survived; `R[kept[q]]` is that column after every earlier reflection, so its entry at row q
  // is the diagonal.
  function factorize(cols) {
    const R = cols.map((c) => c.slice());
    const reflectors = [];
    const kept = [];
    for (let j = 0; j < cols.length; j++) {
      for (const h of reflectors) reflect(h, R[j]);
      const p = kept.length;
      const h = reflector(R[j], p);
      reflect(h, R[j]);
      reflectors.push(h);
      kept.push(j);
    }
    return { R, reflectors, kept };
  }

  // Q' applied to the right-hand side, then back-substitution over the kept columns.
  function solve({ R, reflectors, kept }, rhs) {
    const b = rhs.slice();
    for (const h of reflectors) reflect(h, b);
    const out = new Array(kept.length).fill(0);
    for (let i = kept.length - 1; i >= 0; i--) {
      let acc = b[i];
      for (let j = i + 1; j < kept.length; j++) acc -= R[kept[j]][i] * out[j];
      out[i] = acc / R[kept[i]][i];
    }
    return out;
  }
  ```

- [ ] 6. Add the body of the fit to `fitWeights`, below the one-champion check. The `copies` map is keyed by `heroId` and iterated in insertion order, so a rerun returns the same numbers.

  ```javascript
    const n = readings.length;
    const y = readings.map((r) => Math.sqrt(r.power));
    const x = COLUMNS.map((col) => readings.map((r) => col.of(r.totals)));

    // Step 1: the copy constants, removed EXACTLY. Centering y and every column within each copy
    // leaves a system the constants cannot appear in, so no constant is ever dropped or flagged —
    // they come back at step 6 from the fitted weights.
    const copies = new Map();
    readings.forEach((r, i) => {
      if (!copies.has(r.heroId)) copies.set(r.heroId, []);
      copies.get(r.heroId).push(i);
    });
    const cy = y.slice();
    const cx = x.map((col) => col.slice());
    for (const rows of copies.values()) {
      const my = mean(rows.map((i) => y[i]));
      for (const i of rows) cy[i] = y[i] - my;
      for (let j = 0; j < COLUMNS.length; j++) {
        const m = mean(rows.map((i) => x[j][i]));
        for (const i of rows) cx[j][i] = x[j][i] - m;
      }
    }

    const scale = cx.map((col) => norm2(col));
    const varying = [...COLUMNS.keys()];

    // Step 4: the factorization, over the varying columns scaled to unit 2-norm.
    const fac = factorize(varying.map((j) => cx[j].map((v) => v / scale[j])));
    const gamma = solve(fac, cy);

    const params = { b: null, r: null, a: null, s: null, k: null };
    fac.kept.forEach((q, i) => {
      const j = varying[q];
      params[COLUMNS[j].param] = gamma[i] / scale[j];
    });
    const undetermined = [];

    // Step 6: each copy's constant is the mean, over its readings, of sqrt(power) - lin(totals, w).
    const constants = new Map();
    for (const [heroId, rows] of copies) {
      constants.set(heroId, mean(rows.map((i) => y[i] - lin(readings[i].totals, params))));
    }

    return { params, constants, undetermined };
  ```

- [ ] 7. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `5 passed`.

- [ ] 8. Lint the new module: `npx eslint oracle/analytics/power-fit.mjs`

  Expected: no output. If `power` is reported unused, leave the import — Task 10 uses it.

- [ ] 9. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 10. Commit: `git commit -m "feat(analytics): least-squares power fit over an unpivoted Householder QR" -m "Co-Authored-By: Claude"`

---

### Task 9: two copies with different constants and different stat levels

This is the test the issue specifies. It fails against a global mean and passes only against the within-copy centering.

**Files:**

- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the two-copy test.

  ```javascript
  // The constants are per COPY, and the two copies here sit at different stat levels as well as
  // different constants — so the copy difference is NOT orthogonal to the design columns and a single
  // global mean biases every weight. Sixteen readings against seven unknowns, with an exact solution.
  test("fitWeights recovers both copies' constants when the copies sit at different stat levels", () => {
    const fit = fitWeights([...copy(11, W, C11), ...copy(22, W, C22, OVER_22)]);
    expect(fit.undetermined).toEqual([]);
    for (const name of ["b", "r", "a", "s", "k"]) {
      expect(close(fit.params[name], W[name]), name).toBeLessThan(1e-6);
    }
    expect(fit.constants.size).toBe(2);
    expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
    expect(close(fit.constants.get(22), C22)).toBeLessThan(1e-6);
  });
  ```

- [ ] 2. Run: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `6 passed`. If the two-copy case fails, the centering is being done over all readings instead of within each copy — fix step 1 of `fitWeights`, not the test.

- [ ] 3. Stage: `git add oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 4. Commit: `git commit -m "test(analytics): pin that power-fit centers within each copy, not globally" -m "Co-Authored-By: Claude"`

---

### Task 10: `residuals` — one per reading, in input order

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the residual test.

  ```javascript
  // --- residuals ---------------------------------------------------------------------------------

  // In input order, so a caller can line a residual up with the reading that produced it without
  // matching on anything. `predicted` is power() rebuilt from the returned weights and that
  // reading's own copy constant — not a number the fit carried along separately.
  test("residuals come back one per reading, in input order, rebuilt from the returned values", () => {
    const readings = [...copy(11, W, C11), ...copy(22, W, C22, OVER_22)];
    const fit = fitWeights(readings);
    expect(fit.residuals).toHaveLength(readings.length);
    expect(fit.residuals.map((res) => res.t)).toEqual(readings.map((r) => r.t));
    expect(fit.residuals.map((res) => res.heroId)).toEqual(readings.map((r) => r.heroId));
    fit.residuals.forEach((res, i) => {
      expect(res.power).toBe(readings[i].power);
      const want = power(readings[i].totals, fit.params, fit.constants.get(res.heroId));
      expect(close(res.predicted, want)).toBeLessThan(1e-12);
      expect(close(res.predicted, readings[i].power)).toBeLessThan(1e-9);
    });
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — `expected undefined to have a length of 16`.

- [ ] 3. In `fitWeights`, add the residual build between the `constants` loop and the `return`.

  ```javascript
    // In input order, so a caller can line a residual up with the reading it came from.
    const residuals = readings.map((r) => ({
      heroId: r.heroId, t: r.t, power: r.power,
      predicted: power(r.totals, params, constants.get(r.heroId)),
    }));
  ```

- [ ] 4. Change the `return` to include it.

  ```javascript
    return { params, constants, undetermined, residuals };
  ```

- [ ] 5. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `7 passed`.

- [ ] 6. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 7. Commit: `git commit -m "feat(analytics): power-fit residuals, one per reading in input order" -m "Co-Authored-By: Claude"`

---

### Task 11: `errorPct` and its sign

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the sign test.

  ```javascript
  // The sign convention, pinned by the one case where it is visible. One reading's power is raised
  // 5%; sixteen readings against seven unknowns cannot chase a single observation, so the fit lands
  // BELOW it — predicted < observed, and errorPct = (predicted - power) / power is negative. A
  // flipped subtraction passes every exact-fit test and fails only here.
  test("errorPct goes negative for a reading whose power was raised above the fit", () => {
    const readings = [...copy(11, W, C11), ...copy(22, W, C22, OVER_22)];
    const bumped = readings.map((r, i) => (i === 0 ? { ...r, power: r.power * 1.05 } : r));
    const fit = fitWeights(bumped);
    expect(fit.residuals[0].errorPct).toBeLessThan(0);
  });

  // And it is ~0 everywhere when the readings came out of the formula unaltered.
  test("errorPct is about zero across an exactly solvable fit", () => {
    const fit = fitWeights([...copy(11, W, C11), ...copy(22, W, C22, OVER_22)]);
    for (const res of fit.residuals) expect(Math.abs(res.errorPct)).toBeLessThan(1e-6);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 2 failing — `expected undefined to be less than 0`.

- [ ] 3. Add `errorPct` to the residual object in `fitWeights`.

  ```javascript
    const residuals = readings.map((r) => {
      const predicted = power(r.totals, params, constants.get(r.heroId));
      return { heroId: r.heroId, t: r.t, power: r.power, predicted,
        errorPct: ((predicted - r.power) / r.power) * 100 };
    });
  ```

- [ ] 4. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `9 passed`.

- [ ] 5. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 6. Commit: `git commit -m "feat(analytics): power-fit errorPct, signed predicted minus observed" -m "Co-Authored-By: Claude"`

---

### Task 12: a column that does not vary is undetermined, and sits at its prior

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the non-varying-column test. The generating `s` is the **prior's** `s`, so once `s` is substituted the fit is exact again and the other four parameters and both constants stay recoverable.

  ```javascript
  // --- undetermined parameters -------------------------------------------------------------------

  const PRIOR = weightsFor({ baseTypeId: BASE, roleId: ROLE }).weights;
  const NO_SPD_STEPS = STEPS.filter((step) => !("SPD" in step));

  // SPD is constant within each copy (at a different value per copy), so after the within-copy
  // centering its column is exactly zero and its effect is indistinguishable from that copy's
  // constant. Fitting `s` to that would be fitting noise, so it comes back null — and the weights the
  // solvers will actually use put it at its prior, which is what the constants are measured against.
  test("a stat that is constant within every copy leaves its parameter undetermined", () => {
    const w = { ...W, s: PRIOR.s };
    const fit = fitWeights([
      ...copy(11, w, C11, { SPD: 200 }, NO_SPD_STEPS),
      ...copy(22, w, C22, { ...OVER_22, SPD: 260 }, NO_SPD_STEPS),
    ]);
    expect(fit.params.s).toBeNull();
    expect(fit.undetermined).toEqual(["s"]);
    for (const name of ["b", "r", "a", "k"]) {
      expect(close(fit.params[name], w[name]), name).toBeLessThan(1e-6);
    }
    expect(fit.constants.size).toBe(2);
    expect(close(fit.constants.get(11), C11)).toBeLessThan(1e-6);
    expect(close(fit.constants.get(22), C22)).toBeLessThan(1e-6);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing. The SPD column scales to unit norm by dividing by ~0, so `params.s` comes back a number (or `NaN`/`Infinity`) rather than `null`.

- [ ] 3. In `fitWeights`, replace `const varying = [...COLUMNS.keys()];` with the step-2 test.

  ```javascript
    // Step 2: which columns still carry information. A stat that is constant WITHIN every copy — even
    // at a different value per copy — centers to zero, and the copy constants absorb it exactly. Its
    // parameter is UNDETERMINED rather than fitted to rounding noise. Compared against the column's
    // own uncentered norm, so the test means the same thing for SPD (~200) and X_K (~15000).
    const varying = [...COLUMNS.keys()].filter((j) => scale[j] > VARY_TOL * norm2(x[j]));
  ```

- [ ] 4. Replace the `undetermined` and `constants` block in `fitWeights` with the prior-aware version. `keptCols` are column indices, not positions in `varying`.

  ```javascript
    const keptCols = fac.kept.map((q) => varying[q]);
    const undeterminedCols = [...COLUMNS.keys()].filter((j) => !keptCols.includes(j));
    const undetermined = undeterminedCols.map((j) => COLUMNS[j].param);

    // Step 5 (priors): an undetermined parameter is not unknown to the SOLVERS — they will take
    // exactly what weightsFor falls back to. roleId is static champion data, and every reading here
    // is one champion, so the first reading settles it; an unknown roleId throws out of weightsFor.
    const prior = weightsFor({ baseTypeId: ids[0], roleId: readings[0].roleId }).weights;
    const effective = { ...params };
    for (const name of undetermined) effective[name] = prior[name];

    // Step 6: each copy's constant is the mean, over its readings, of sqrt(power) - lin(totals, w),
    // with w the weights the model is actually evaluated with — undetermined ones at their prior.
    // Always one finite value per copy: the centering never dropped a constant, so every copy has one.
    const constants = new Map();
    for (const [heroId, rows] of copies) {
      constants.set(heroId, mean(rows.map((i) => y[i] - lin(readings[i].totals, effective))));
    }
  ```

- [ ] 5. Change the residual build to use `effective` instead of `params`.

  ```javascript
    const residuals = readings.map((r) => {
      const predicted = power(r.totals, effective, constants.get(r.heroId));
      return { heroId: r.heroId, t: r.t, power: r.power, predicted,
        errorPct: ((predicted - r.power) / r.power) * 100 };
    });
  ```

- [ ] 6. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `10 passed`. Note what caught the missing `effective`: a `null` weight multiplies as **0** in JavaScript, not `NaN`, so dropping the prior silently moves `prior.s * SPD` into each copy's constant — the constant assertions are what fail, not a `NaN` check.

- [ ] 7. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 8. Commit: `git commit -m "feat(analytics): report a non-varying stat's weight as undetermined, at its prior" -m "Co-Authored-By: Claude"`

---

### Task 13: the `predicted`-rebuild identity holds with priors substituted

**Files:**

- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

Task 10 pinned the rebuild identity only where nothing was undetermined, so it could not tell `params` from `effective`. This version uses Task 12's reading set, where `s` is `null`.

**Steps:**

- [ ] 1. Add the test.

  ```javascript
  // The same identity as above, on a fit that HAS an undetermined parameter: `predicted` is power()
  // with the undetermined weights at their prior. Rebuilt from `params`, `undetermined` and
  // `constants` alone, which is all a caller gets.
  test("predicted is power() rebuilt from the returned values, undetermined ones at their prior", () => {
    const w = { ...W, s: PRIOR.s };
    const readings = [
      ...copy(11, w, C11, { SPD: 200 }, NO_SPD_STEPS),
      ...copy(22, w, C22, { ...OVER_22, SPD: 260 }, NO_SPD_STEPS),
    ];
    const fit = fitWeights(readings);
    expect(fit.undetermined).toEqual(["s"]);
    const rebuilt = { ...fit.params };
    for (const name of fit.undetermined) rebuilt[name] = PRIOR[name];
    fit.residuals.forEach((res, i) => {
      const want = power(readings[i].totals, rebuilt, fit.constants.get(res.heroId));
      expect(close(res.predicted, want), res.t).toBeLessThan(1e-12);
    });
  });
  ```

- [ ] 2. Run: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `11 passed`.

- [ ] 3. Stage: `git add oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 4. Commit: `git commit -m "test(analytics): pin predicted against a rebuild with priors substituted" -m "Co-Authored-By: Claude"`

---

### Task 14: the too-few-readings throw

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the test. Three readings of one copy in which three stats vary: `3 < 1 + 3`.

  ```javascript
  // Three readings of one copy, with HP, RES and SPD all moving: one copy constant plus three varying
  // columns is four unknowns against three equations. The counts are all three named, because which
  // one to change is the caller's decision — log more readings, or hold a stat still.
  test("fitWeights refuses a fit with fewer readings than unknowns, naming the three counts", () => {
    const few = [
      reading(11, totals(), W, C11, 0),
      reading(11, totals({ HP: 36000 }), W, C11, 1),
      reading(11, totals({ RES: 160, SPD: 240 }), W, C11, 2),
    ];
    expect(() => fitWeights(few)).toThrow(/power-fit/);
    expect(() => fitWeights(few)).toThrow(/readings=3/);
    expect(() => fitWeights(few)).toThrow(/copies=1/);
    expect(() => fitWeights(few)).toThrow(/varying stat columns=3/);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — no throw; the fit returns arbitrary numbers.

- [ ] 3. In `fitWeights`, add step 3 between the `varying` line and the `factorize` call.

  ```javascript
    // Step 3: enough equations. Below this the system is under-determined before the factorization
    // even looks at it, and the answer would be arbitrary rather than wrong by a little. Named as
    // key=value because all three counts matter and prose that stays grammatical at every count does
    // not exist ("1 copy constants").
    if (n < copies.size + varying.length) {
      throw new Error(`power-fit: too few readings: readings=${n}, copies=${copies.size},`
        + ` varying stat columns=${varying.length} — a fit needs readings >= copies + columns`);
    }
  ```

- [ ] 4. Run to verify pass: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `12 passed`.

- [ ] 5. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 6. Commit: `git commit -m "feat(analytics): refuse a power fit with fewer readings than unknowns" -m "Co-Authored-By: Claude"`

---

### Task 15: a dependent column is skipped, and the fixed order decides which

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the fixture for linked RES/ACC readings and the skip test.

  ```javascript
  // --- dependent columns -------------------------------------------------------------------------

  // The same step list with no ACC step: ACC is derived from RES, so the RES step moves both columns.
  const LINKED_STEPS = [
    {}, { HP: 36000 }, { ATK: 2600 }, { RES: 160 }, { SPD: 240 }, { "C.RATE": 85 }, { "C.DMG": 220 },
  ];

  // RES and ACC locked in a fixed 2:1 ratio, so the centered ACC column is exactly half the centered
  // RES column — a champion geared so that accuracy only ever arrives alongside resistance.
  const linkedCopy = (heroId, w, c, over = {}) =>
    LINKED_STEPS.map((step, i) => {
      const stats = totals({ ...over, ...step });
      return reading(heroId, { ...stats, ACC: stats.RES / 2 }, w, c, i);
    });

  // ACC sits AFTER RES in the fixed column order and the factorization does not pivot, so RES is kept
  // and ACC is dropped — every time, on every machine. With pivoting, which of the two survived would
  // follow whichever rounding produced the larger norm.
  test("a column that only moves with an earlier one is dropped, and the fixed order picks which", () => {
    const w = { ...W, a: PRIOR.a };
    const fit = fitWeights([...linkedCopy(11, w, C11), ...linkedCopy(22, w, C22, OVER_22)]);
    expect(fit.params.a).toBeNull();
    expect(fit.undetermined).toEqual(["a"]);
    expect(fit.params.r).not.toBeNull();
  });

  // Nothing non-finite ever leaves the fit: the skip is what keeps back-substitution off a ~0 pivot.
  test("every number a rank-deficient power fit returns is finite", () => {
    const w = { ...W, a: PRIOR.a };
    const fit = fitWeights([...linkedCopy(11, w, C11), ...linkedCopy(22, w, C22, OVER_22)]);
    for (const [name, v] of Object.entries(fit.params)) {
      if (v !== null) expect(Number.isFinite(v), name).toBe(true);
    }
    for (const [heroId, c] of fit.constants) expect(Number.isFinite(c), `copy ${heroId}`).toBe(true);
    for (const res of fit.residuals) {
      expect(Number.isFinite(res.predicted), res.t).toBe(true);
      expect(Number.isFinite(res.errorPct), res.t).toBe(true);
    }
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 2 failing. `params.a` comes back a huge number or `NaN` — the dependent column's pivot is ~1e-16 and back-substitution divides by it.

- [ ] 3. In `factorize`, add the rank test so a dependent column is skipped.

  ```javascript
  function factorize(cols) {
    const R = cols.map((c) => c.slice());
    const reflectors = [];
    const kept = [];
    for (let j = 0; j < cols.length; j++) {
      for (const h of reflectors) reflect(h, R[j]);
      const p = kept.length;
      // Step 4: this column's diagonal entry of R — the norm it has left after the KEPT columns'
      // reflections. Below RANK_TOL it is a linear combination of them, so it is skipped outright:
      // no reflector, no R column, and its parameter comes back undetermined. Keeping it would put
      // back-substitution on a pivot of about zero.
      if (tailNorm(R[j], p) < RANK_TOL) continue;
      const h = reflector(R[j], p);
      reflect(h, R[j]);
      reflectors.push(h);
      kept.push(j);
    }
    return { R, reflectors, kept };
  }
  ```

- [ ] 4. Run: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `14 passed`.

- [ ] 5. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 6. Commit: `git commit -m "feat(analytics): skip a dependent column in the fixed order, never by pivoting" -m "Co-Authored-By: Claude"`

---

### Task 16: the priors are subtracted from the right-hand side

Without this, a kept column absorbs the dropped column's effect **and** the solver substitutes the prior for the dropped one — counting the same effect twice.

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`
- Test: `oracle/analytics/__tests__/power-fit.test.mjs`

**Steps:**

- [ ] 1. Add the test. The readings were generated with `a` at its prior, so `r` must come back as `W.r` and not `W.r + a/2`.

  ```javascript
  // The dropped column's share has to come OUT of the right-hand side before the kept columns are
  // solved. Left in, RES absorbs it — ACC is exactly RES/2 here, so `r` would come back as
  // r + a/2, about 8% high — and the solver would then ALSO add the prior `a` back for the dropped
  // column, counting one effect twice.
  test("an undetermined parameter's prior is removed from the fit before the kept columns solve", () => {
    const w = { ...W, a: PRIOR.a };
    const fit = fitWeights([...linkedCopy(11, w, C11), ...linkedCopy(22, w, C22, OVER_22)]);
    expect(close(fit.params.r, w.r)).toBeLessThan(1e-6);
    for (const name of ["b", "s", "k"]) {
      expect(close(fit.params[name], w[name]), name).toBeLessThan(1e-6);
    }
    for (const res of fit.residuals) expect(Math.abs(res.errorPct)).toBeLessThan(1e-6);
  });
  ```

- [ ] 2. Run to verify failure: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: 1 failing — `fit.params.r` is high by about `PRIOR.a / 2`, so the relative difference is roughly 0.078 rather than under 1e-6.

- [ ] 3. In `fitWeights`, move the `prior` lookup and the undetermined bookkeeping **above** the `solve` call, and subtract the priors from the right-hand side. Replace the block that runs from `const fac = factorize(...)` down to `const undetermined = ...` with this; the `prior` / `effective` / `constants` lines added in Task 12 stay where they are, minus the `prior` line that now lives here.

  ```javascript
    // Step 4: which of the varying columns are independent, in the fixed order and without pivoting.
    const fac = factorize(varying.map((j) => cx[j].map((v) => v / scale[j])));
    const keptCols = fac.kept.map((q) => varying[q]);
    const undeterminedCols = [...COLUMNS.keys()].filter((j) => !keptCols.includes(j));
    const undetermined = undeterminedCols.map((j) => COLUMNS[j].param);

    // Step 5: the priors. The weights the SOLVERS will use for an undetermined parameter are exactly
    // what weightsFor falls back to, so that share of the signal comes out of the right-hand side
    // before the kept columns are solved. Left in, a kept column absorbs a dropped column's effect
    // and the prior adds it back a second time. roleId is static champion data and every reading here
    // is one champion, so the first reading settles it; an unknown roleId throws out of weightsFor.
    const prior = weightsFor({ baseTypeId: ids[0], roleId: readings[0].roleId }).weights;
    const rhs = cy.slice();
    for (const j of undeterminedCols) {
      const w = prior[COLUMNS[j].param];
      for (let i = 0; i < n; i++) rhs[i] -= w * cx[j][i];
    }
    const gamma = solve(fac, rhs);

    const params = { b: null, r: null, a: null, s: null, k: null };
    fac.kept.forEach((q, i) => {
      const j = varying[q];
      params[COLUMNS[j].param] = gamma[i] / scale[j];
    });
  ```

- [ ] 4. Delete the now-duplicated `const prior = weightsFor(...)` line that Task 12 added below this block. There must be exactly one.

- [ ] 5. Confirm there is only one: `grep -c "const prior = weightsFor" oracle/analytics/power-fit.mjs`

  Expected: `1`.

- [ ] 6. Run: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `15 passed`.

- [ ] 7. Confirm the whole module is still in the six documented steps: `grep -n "// Step" oracle/analytics/power-fit.mjs`

  Expected: six matches, in ascending order 1 through 6.

- [ ] 8. Stage: `git add oracle/analytics/power-fit.mjs oracle/analytics/__tests__/power-fit.test.mjs`

- [ ] 9. Commit: `git commit -m "fix(analytics): remove an undetermined parameter's prior before solving" -m "Co-Authored-By: Claude"`

---

### Task 17: `power-fit.mjs` header comment

Documentation only.

**Files:**

- Modify: `oracle/analytics/power-fit.mjs`

**Steps:**

- [ ] 1. Insert this block as the very first lines of `oracle/analytics/power-fit.mjs`, above the `import`.

  ```javascript
  // Calibrating one champion's power weights from logged readings: least squares on y = sqrt(power),
  // with a separate constant per COPY. The formula and the fallback tables are in power-model.mjs.
  //
  // A reading record, shared with the CLI that logs them:
  //
  //   { t, heroId, baseTypeId, name, roleId,
  //     totals: { HP, ATK, DEF, SPD, "C.RATE", "C.DMG", RES, ACC }, power }
  //
  // `t` is an ISO-8601 timestamp. ONE CHAMPION PER CALL: the weights are per champion, so a mixed
  // input is refused rather than averaged. Callers group by baseTypeId.
  //
  // Six steps, in this order:
  //
  //   1. Copy constants first — center y and every stat column WITHIN each copy. This removes the
  //      constants exactly, so none is ever dropped or flagged, and they come back at step 6.
  //   2. Varying columns — a column whose centered norm is under 1e-9 of its uncentered norm is
  //      constant within every copy, the constants absorb it, and its parameter is UNDETERMINED.
  //   3. Too few readings — below copies + varying columns the system has fewer equations than
  //      unknowns, and the answer would be arbitrary rather than wrong by a little. It throws.
  //   4. Dependent columns — unpivoted Householder QR over the varying columns scaled to unit norm,
  //      in the fixed order below. A column whose remaining norm after the kept columns' reflections
  //      is under 1e-9 depends on them: undetermined, and skipped. No pivoting, so the outcome never
  //      depends on rounding.
  //   5. Priors — an undetermined parameter's weightsFor fallback comes OUT of the right-hand side
  //      before the kept columns solve, so the fitted weights stay consistent with the values the
  //      solvers will substitute.
  //   6. Constants — each copy's c is the mean of sqrt(power) - lin(totals, w) over its readings,
  //      with w the weights the model is actually evaluated with.
  //
  // Undetermined parameters come back null and are listed in `undetermined`; no non-finite value is
  // ever returned, and `constants` always holds one finite value per copy. The normal equations are
  // deliberately NOT used: the stat columns span about 1 to 1e5, and forming X'X squares that.
  //
  // The readings are personal account data and stay local. Nothing here reads a file.
  ```

- [ ] 2. Confirm the reading record is documented: `grep -n "baseTypeId, name, roleId" oracle/analytics/power-fit.mjs`

  Expected: one match, inside the header block.

- [ ] 3. Run the module's tests: `npx vitest run oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `15 passed`.

- [ ] 4. Lint: `npx eslint oracle/analytics/power-fit.mjs`

  Expected: no output.

- [ ] 5. Stage: `git add oracle/analytics/power-fit.mjs`

- [ ] 6. Commit: `git commit -m "docs(analytics): record power-fit's reading record and six-step algorithm" -m "Co-Authored-By: Claude"`

---

# Chunk 3 — the full gate

### Task 18: run the repo's pre-commit gate

No git hooks exist in this repo; this is run by hand before the branch is considered done. All three commands are required by the issue's acceptance criteria.

**Files:** none (verification only).

**Steps:**

- [ ] 1. Run both new test files together: `npx vitest run oracle/analytics/__tests__/power-model.test.mjs oracle/analytics/__tests__/power-fit.test.mjs`

  Expected: `2 passed` files, `31 passed` tests (16 + 15).

- [ ] 2. Build: `npm run build`

  Expected: exits 0. `oracle/` is outside the TypeScript project references so nothing here is compiled; this confirms the two new files did not disturb the packages.

- [ ] 3. Full suite: `npm test`

  Expected: exits 0, no failures. The pre-existing suite is ~310 tests; it should now be ~341.

- [ ] 4. Lint: `npm run lint`

  Expected: no output, exits 0.

- [ ] 5. If lint reported anything, fix it in place, re-run `npm run lint`, then stage and commit the fix as its own commit: `git add oracle/analytics` then `git commit -m "style(analytics): satisfy eslint on the power model modules" -m "Co-Authored-By: Claude"`

- [ ] 6. Confirm the working tree is clean: `git status --short`

  Expected: no output. Anything listed is an unintended file — `.hivemind/` is gitignored, so scratch files do not appear here.

- [ ] 7. Review the branch's diff once end to end: `git diff main --stat`

  Expected: exactly four files — `oracle/analytics/power-model.mjs`, `oracle/analytics/power-fit.mjs`, and the two test files — plus `docs/plans/ai/issue-43-plan.md` and `docs/plans/ai/issue-43-exploration.md`.

---

## Acceptance Criteria Coverage

| Criterion | Covered by |
|---|---|
| `power-model.mjs` exports `lin`, `power`, `constantFrom`, `BUILT_IN`, `ROLE_DEFAULTS`, `ALL_DEFAULTS`, `weightsFor` | Tasks 1–4 |
| …with exactly the issue's values | Task 3 steps 3–4 (transcription), step 6 (hand re-read), plus the invariant tests |
| …per-parameter precedence, finite positive fitted values only | Task 4 steps 5–10 |
| …unconditional throw on an unknown `roleId` | Task 4 step 3 (implementation), Task 5 (pinned) |
| `power-model.mjs` header: formula, evidence, open questions | Task 6 |
| `power-fit.mjs` exports `fitWeights` with the reading record, return shape and input checks | Tasks 7–11 |
| copy constants removed first, never flagged | Task 8 step 6 (step 1), Task 9 (pinned against a global mean) |
| varying-column check | Task 12 step 3 |
| too-few-readings check | Task 14 |
| unpivoted QR in the fixed column order | Task 8 steps 4–5, Task 15 |
| priors for undetermined parameters | Task 12 step 4, Task 16 |
| one finite constant per copy, never a non-finite value | Task 12 step 4, Task 15 second test |
| Every test in the issue's Change 3 passes | Tasks 1–16 |
| `npm run build`, `npm test`, `npm run lint` pass | Task 18 |

## Concerns

1. **`toBeCloseTo` is absolute.** Every weight and constant assertion in this plan uses the `close()` helper (`|got/want − 1|`) instead. Do not swap one back to `toBeCloseTo` — with `k ≈ 0.0017`, `toBeCloseTo(k, 6)` passes for a value that is 50% wrong.
2. **Task 16 edits code Task 12 added.** Task 12 places the `prior` lookup below the `solve` call; Task 16 moves it above and deletes the duplicate. Step 5 of Task 16 (`grep -c`) is there to catch a missed deletion, which would otherwise shadow nothing but leave a confusing second lookup.
3. **The 23 table numbers have no behavioural test.** Task 3's invariants catch a sign error, a zero, a missing role and a filled-in Helicath row, but not a transposed digit. Step 6 of Task 3 is a manual re-read; reviewers should diff the tables against the issue body directly.
4. **`null` multiplies as 0 in JavaScript, not `NaN`.** A missed prior substitution in step 6 therefore shifts each copy's constant rather than poisoning it — which is why Task 12's test asserts the constants and not just finiteness. Noted at Task 12 step 6 so the behaviour is not mistaken for a passing test.
5. **Task 5 and Task 9 pass on already-written code.** Both are flagged in place. They exist because their acceptance criteria ("unconditional", "per copy") are invisible to the tests that drove the implementation, and a later simplification would silently break them.
