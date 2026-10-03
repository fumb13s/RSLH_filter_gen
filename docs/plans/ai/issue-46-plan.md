# power.mjs CLI Implementation Plan

**Goal:** Add `oracle/analytics/power.mjs` — a four-mode command-line tool (solve, log, fit, verify) for champion power — plus the `wearers.mjs` module it shares with `speed.mjs`, the README entry, and the design doc recording the measured evidence.

**Architecture:** `power.mjs` is shaped exactly like `speed.mjs`: pure, unit-tested helpers above a `// --- CLI: I/O and formatting ---` banner, I/O and printing below it, and `main()` behind the `realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` guard. It composes five already-merged modules and adds no model of its own: `champion-stats.mjs` (the Total Stats screen), `power-model.mjs` + `power-fit.mjs` (the formula, the weight tables, the least-squares fit), `power-solve.mjs` (the linearize-and-iterate gear solver and its McCormick certificate), and `set-bonuses.mjs` (the set table). It reads **Gestal snapshots only** — an RSL Helper DB carries neither per-copy base stats nor the per-source bonus breakdown. `otherWearers`/`describeWearers` move to a new `wearers.mjs` that both CLIs import, with `speed.mjs` re-exporting them so its own importers are untouched.

**Tech Stack:** Node ESM (`.mjs`, no build step, outside the TypeScript project references), `@rslh/core` for the id→name tables, vitest for tests, `node:child_process` `spawnSync` for end-to-end CLI tests, `node:sqlite` pulled in transitively by `champs.mjs` (which is why every run and every spawn carries `--experimental-sqlite` on Node 22).

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `oracle/analytics/wearers.mjs` | Who is wearing what, for a build report that proposes moving gear. Shared by `speed.mjs` and `power.mjs`. |
| Modify | `oracle/analytics/speed.mjs` | Drop the three moved definitions; import them for its own use and re-export them. |
| Create | `oracle/analytics/__tests__/wearers.test.mjs` | Pins that `wearers.mjs` exports both functions and that `speed.mjs` re-exports *the same* functions. |
| Create | `oracle/analytics/power.mjs` | The four-mode champion-power CLI. |
| Create | `oracle/analytics/__tests__/power-cli.test.mjs` | Unit tests for the pure helpers; end-to-end tests for all four modes. |
| Modify | `oracle/analytics/README.md` | New `## Run` entry 6, plus the two sentences that speak for every tool. |
| Create | `docs/plans/2026-10-03-champion-power-design.md` | The design and the measured evidence behind the power model. |
| Modify | `CHANGELOG.md` | One `[minor]` line under `## [Unreleased]` → `### Added`. |

**Not touched:** `oracle/analytics/__tests__/speed-cli.test.mjs` — the acceptance criterion is that it keeps passing *untouched* through the re-export. `oracle/README.md` needs no change. No new `.gitignore` rule: `oracle/analytics/.gitignore` already denies `out/`.

### Facts this plan depends on (verified during exploration — do not re-derive)

- `power-solve.mjs`'s `solvePower(...)` returns `{ builds, rounds, converged, upperBound, gap }`. Each build is `{ items, totals, lin }` — **there is no `counts` field**, so the sets line must come from `setCounts(build.items)`. `builds` is never empty (round 0 records the worn gear before the loop).
- `gap` and `upperBound` are in **√power (`lin`) units**, unclamped. Converting to power needs `c`: `(upperBound + c) ** 2 - (bestLin + c) ** 2`.
- A Gestal champion row (`gestalChampRows`) names things differently from the issue: **`roleId` is `row.Role`** and **`baseTypeId` is `row.BaseHeroID`**. `awaken` is *not* on the row — it is on the `gestalChampStats` record.
- `gestalChampStats` covers the roster document only. `gestalChampRows` appends placeholder rows (`Name: ""`, `Role: 0`, `BaseHeroID: null`) for wearers the roster has not listed yet. Filtering rows through `isRealChamp` removes exactly those, so every row that survives has a stats record — that is the invariant the code relies on.
- `weightsFor({ baseTypeId, roleId }, fitted)` indexes `fitted?.[baseTypeId]`. A JSON-parsed object has string keys and a number index coerces, so `power-weights.json` round-trips. `measured` is `> 0`, so `null`, `0` and negatives fall through per parameter, and the extra `name`/`fittedAt`/`readings` fields are ignored.
- `champion-stats.mjs:11-17` and `power-solve.mjs:104-106` have already adjudicated `setBonusTotals` vs `setBonusTerms` against `set-bonuses.mjs:129-131`. **Do not "fix" it.**
- `packages/core/dist` does not exist in a fresh worktree. `npm run build` must run before `npm test`, or unrelated `@rslh/core` imports fail.
- Known pre-existing failures, out of scope: `oracle/battlelogs/__tests__/capture.test.mjs` (macOS returns `ENOTSUP` where the test expects `EISDIR`), and a flaky 10 s timeout on `packages/web/src/__tests__/pipeline.prop.test.ts` under full-suite load.

### Totals: rounded or unrounded?

Two different totals are in play and the plan uses both deliberately:

- **`buildTotals(champStats, items)`** (from `power-solve.mjs`) — unrounded. This is what the objective is evaluated on, so it is what `constantFrom` is measured against and what a logged reading records. Using the rounded screen totals would make `(lin + c) ** 2` inconsistent with the solver's own `lin`.
- **`statBreakdown(champStats, items).totals`** — rounded per column, as the game's screen is. This is what gets *printed*, because the point of the CURRENT block is that the reader can compare it with the screen.

Both come from the same `champStats` and the same item list, so they cannot drift. The difference is at most 1 per stat, well inside the model's own ~0.1% accuracy.

---

## Chunk 1 — Extract `wearers.mjs`

### Task 1: Move `otherWearers`, `describeWearers` and `NAMED_WEARERS` into `wearers.mjs`

**Files:**

- Create: `oracle/analytics/wearers.mjs`
- Create: `oracle/analytics/__tests__/wearers.test.mjs`
- Modify: `oracle/analytics/speed.mjs`

**Steps:**

- [ ] 1. Confirm the baseline is green before moving anything: `npm run build`
     Expected: builds `packages/core`, `packages/cli`, `packages/web` with no errors. (Required once per worktree — `packages/core/dist` does not exist yet and several tests import `@rslh/core`.)
- [ ] 2. Confirm the tests that must survive the move are green now: `npx vitest run oracle/analytics/__tests__/speed-cli.test.mjs`
     Expected: all tests pass (the file has 8 `otherWearers`/`describeWearers` tests among them).
- [ ] 3. Write the failing test for the new module. Create `oracle/analytics/__tests__/wearers.test.mjs`:
  ```javascript
  // oracle/analytics/__tests__/wearers.test.mjs
  //
  // wearers.mjs holds what speed.mjs and power.mjs both need: who is wearing each piece a build
  // wants. The BEHAVIOUR is pinned by speed-cli.test.mjs, which imports these through speed.mjs and
  // is deliberately left untouched by the move. What this file pins is the move itself — that the
  // functions live here, and that speed.mjs's exports are the SAME functions rather than copies.
  // An identity check is the only assertion that can tell a re-export from a duplicate definition
  // left behind, which is the one way this refactor could pass every other test and still rot.
  import { expect, test } from "vitest";
  import { describeWearers, otherWearers } from "../wearers.mjs";
  import { describeWearers as fromSpeed, otherWearers as otherFromSpeed } from "../speed.mjs";

  test("wearers.mjs exports the two wearer helpers", () => {
    expect(typeof otherWearers).toBe("function");
    expect(typeof describeWearers).toBe("function");
  });

  test("speed.mjs re-exports the very same functions", () => {
    expect(otherFromSpeed).toBe(otherWearers);
    expect(fromSpeed).toBe(describeWearers);
  });
  ```
- [ ] 4. Run it to verify RED: `npx vitest run oracle/analytics/__tests__/wearers.test.mjs`
     Expected: both tests fail — the import of `../wearers.mjs` cannot be resolved (`Failed to resolve import` / `Cannot find module`).
- [ ] 5. Create `oracle/analytics/wearers.mjs` with the three definitions moved **verbatim** from `speed.mjs:78-128` (both functions, the `NAMED_WEARERS` constant, and every comment above them), under a new module header:
  ```javascript
  // Who is wearing what, for a build report that proposes moving gear.
  //
  // Shared by speed.mjs and power.mjs. Both solve over the WHOLE vault, worn gear included — gear
  // can be moved, so a build is not usually a set of spare pieces — and both therefore have to say
  // which pieces would have to come off someone else. Lifted out of speed.mjs unchanged when the
  // second caller arrived; speed.mjs re-exports them, so its own importers never saw the move.

  // itemId -> the name of the champion wearing it right now, for the pieces that would have to come
  // OFF someone. A free piece costs nothing to fit, and neither does one already on `champId`, so
  // neither is listed — including them would bury the ones that do cost something.
  //
  // Built once per champion over the whole vault rather than per build, because --top prints several
  // builds drawn from the same pool.
  export function otherWearers(items, champId, rows) {
    const names = new Map(rows.map((r) => [Number(r.ID), r.Name]));
    const out = new Map();
    for (const it of items) {
      const owner = it.equippedChampId;
      if (!owner || owner === champId) continue;
      // `owner` is Artifacts.cID, and it can name a row the roster read dropped — a placeholder
      // (empty-Name) row, or a champion since consumed. Naming it by id beats reporting the piece as
      // free, which is the one answer that is certainly wrong.
      //
      // It is not the same claim as a placeholder row WEARING something. Worn gear is recorded in the
      // Champs slot columns; cID is a back-pointer that is not cleared on unequip, so one pointing at a
      // placeholder row says nothing about what that row holds. A caller that needs the slot columns
      // reads them off every row — see readAllChampRows in champs.mjs.
      out.set(it.id, names.get(owner) ?? `#${owner}`);
    }
    return out;
  }

  // "8 of 9 — Kantra the Cyclone x3, Elhain x2, Kael", or "none".
  //
  // The solver's pool is the WHOLE vault, worn gear included — a deliberate choice, since gear can be
  // moved. The consequence is that solving several champions independently proposes the same physical
  // pieces to each, so the builds are mutually exclusive. Printed for every build, `none` included:
  // silence would be indistinguishable from a report that does not check.
  //
  // Busiest wearer first, then alphabetical, so a rerun on one snapshot prints the same line. Names
  // past the fourth become "+N more" — nine pieces off nine champions is a 200-character line, and
  // the tail of it is singletons already named against their own item a few lines above.
  const NAMED_WEARERS = 4;

  export function describeWearers(items, wearers) {
    const byChamp = new Map();
    for (const it of items) {
      const who = wearers.get(it.id);
      if (who === undefined) continue;
      byChamp.set(who, (byChamp.get(who) ?? 0) + 1);
    }
    if (byChamp.size === 0) return "none";
    const taken = [...byChamp.values()].reduce((sum, n) => sum + n, 0);
    const ranked = [...byChamp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const named = ranked.slice(0, NAMED_WEARERS).map(([who, n]) => (n > 1 ? `${who} x${n}` : who));
    const rest = ranked.length - named.length;
    return `${taken} of ${items.length} — ${[...named, ...(rest ? [`+${rest} more`] : [])].join(", ")}`;
  }
  ```
- [ ] 6. Delete `speed.mjs:78-128` — the `otherWearers` function, the `NAMED_WEARERS` comment block and constant, and the `describeWearers` function, together with the comments moved in step 5. The region runs from the comment line `// itemId -> the name of the champion wearing it right now, for the pieces that would have to come` down to the closing `}` of `describeWearers`, i.e. everything between the `setLabel`/`describeSets` block above and the `// The last line is a RECONCILIATION` comment below.
- [ ] 7. In `speed.mjs`, add the import for its own use. After the existing `import { loadCorpus, lookupBase } from "./speed-corpus.mjs";` line, insert:
  ```javascript
  import { describeWearers, otherWearers } from "./wearers.mjs";

  // Re-exported so speed-cli.test.mjs and any other importer keep reading these from here, while the
  // definitions live in one module both CLIs share. Same arrangement speed-model.mjs uses for
  // setCounts. The `export … from` form creates no local binding, so it does not collide with the
  // import above.
  export { otherWearers, describeWearers } from "./wearers.mjs";
  ```
- [ ] 8. Run the new test to verify GREEN: `npx vitest run oracle/analytics/__tests__/wearers.test.mjs`
     Expected: 2 passed.
- [ ] 9. Run the test that must have survived the move, unchanged: `npx vitest run oracle/analytics/__tests__/speed-cli.test.mjs`
     Expected: all tests pass, same count as in step 2.
- [ ] 10. Lint: `npm run lint`
     Expected: no errors. (If `otherWearers` or `describeWearers` is reported unused in `speed.mjs`, step 6 deleted too little or step 7's import is wrong — `describeWearers` is used by `formatBuild` and `otherWearers` by `main`.)
- [ ] 11. Commit: `git add oracle/analytics/wearers.mjs oracle/analytics/__tests__/wearers.test.mjs oracle/analytics/speed.mjs && git commit -m "#46 Move the wearer helpers into wearers.mjs, re-exported from speed.mjs"`

---

## Chunk 2 — `power.mjs` pure helpers

Every task in this chunk adds tests to `oracle/analytics/__tests__/power-cli.test.mjs` and the matching exports to `oracle/analytics/power.mjs`. The test file's import list grows task by task; each task names what it adds.

`power.mjs` has **no `main()` and no I/O until Chunk 3** — the module is import-only for now, which is what lets the helpers be driven out one at a time.

### Task 2: `parsePowerArgs` — the four modes, the selector/snapshot pair, and the defaults

**Files:**

- Create: `oracle/analytics/power.mjs`
- Create: `oracle/analytics/__tests__/power-cli.test.mjs`

**Steps:**

- [ ] 1. Create `oracle/analytics/__tests__/power-cli.test.mjs` with the header and the first tests:
  ```javascript
  // oracle/analytics/__tests__/power-cli.test.mjs
  //
  // power.mjs: the pure helpers directly, and all four modes end to end through a spawned node.
  //
  // Every fixture here is synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds
  // personal account data and never belongs in the repo. Nothing about argument parsing, copy
  // selection, layout or the fit needs real data.
  //
  // EVERY spawned run sets RSLH_POWER_DIR to a fresh temp directory. Without it the tool would read
  // and append to the developer's real oracle/analytics/out/ — a test that pollutes a personal
  // reading log, and one whose own assertions would depend on whatever is already in it.
  import { expect, test } from "vitest";
  import { parsePowerArgs } from "../power.mjs";

  // --- parsePowerArgs: modes and positionals ------------------------------------

  test("parsePowerArgs defaults to solve and reads the selector and snapshot in either order", () => {
    expect(parsePowerArgs(["Elhain", "x/y.json.gz"]))
      .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
    expect(parsePowerArgs(["x/y.json.gz", "Elhain"]))
      .toMatchObject({ mode: "solve", selector: "Elhain", dbArg: "x/y.json.gz" });
  });

  test("parsePowerArgs recognises the three subcommands as the first positional", () => {
    expect(parsePowerArgs(["log", "Elhain", "12345"]))
      .toMatchObject({ mode: "log", selector: "Elhain", logPower: 12345 });
    expect(parsePowerArgs(["fit", "Elhain"])).toMatchObject({ mode: "fit", selector: "Elhain" });
    expect(parsePowerArgs(["verify", "x/y.json.gz"]))
      .toMatchObject({ mode: "verify", selector: null, dbArg: "x/y.json.gz" });
  });

  // `top` defaults to 1 as in parseSpeedArgs; the other three have no default value that could be
  // mistaken for a supplied one, so they are null.
  test("parsePowerArgs defaults top to 1 and leaves the rest null", () => {
    expect(parsePowerArgs(["Elhain"])).toEqual({
      mode: "solve", selector: "Elhain", dbArg: undefined, power: null, top: 1, logPower: null,
    });
  });

  test("parsePowerArgs takes no selector and no snapshot at all", () => {
    expect(parsePowerArgs([])).toMatchObject({ mode: "solve", selector: null, dbArg: undefined });
    expect(parsePowerArgs(["verify"])).toMatchObject({ mode: "verify", dbArg: undefined });
  });

  // Same rule as parseSpeedArgs: an empty arg is no arg, because an empty selector matches the whole
  // roster by substring.
  test("parsePowerArgs drops empty positional arguments", () => {
    expect(parsePowerArgs([""])).toMatchObject({ selector: null, dbArg: undefined });
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: every test fails — `../power.mjs` cannot be resolved.
- [ ] 3. Create `oracle/analytics/power.mjs` with the header comment and the imports the parser needs:
  ```javascript
  // Champion POWER: the current and best power for one champion, over the whole vault.
  //
  //   node --experimental-sqlite oracle/analytics/power.mjs <name|ID> [snapshot.json.gz] [opts]
  //     --power N      this copy's in-game power right now, to measure its constant from
  //     --top N        print the N best builds rather than only the winner
  //
  //   node --experimental-sqlite oracle/analytics/power.mjs log <name|ID> <in-game power>
  //     record a power reading against Gestal's LIVE stats, for `fit` to calibrate from.
  //
  //   node --experimental-sqlite oracle/analytics/power.mjs fit <name|ID>
  //     fit one champion's weights from its logged readings.
  //
  //   node --experimental-sqlite oracle/analytics/power.mjs verify [snapshot.json.gz]
  //     check the set table against the game's own per-champion set bonuses.
  //
  // GESTAL SNAPSHOTS ONLY. The stat model needs each copy's base stats and its per-source bonus
  // breakdown, and an RSL Helper DB carries neither, so a .db path is refused rather than half-read.
  // `log` is the one exception to the snapshots-only convention and reads Gestal's live documents:
  // the log line it writes is itself the frozen record.
  //
  // --experimental-sqlite is needed on Node 22 even though nothing here opens a database: the
  // champion selector comes from champs.mjs, which imports node:sqlite for the other snapshot kind.
  //
  // TOTALS, ROUNDED AND NOT. Two sets of totals are in play on purpose. buildTotals is unrounded and
  // is what the objective, the constant and a logged reading use, because that is what power-solve
  // scores builds on. statBreakdown's totals round each column as the game's screen does, and are
  // what gets PRINTED, because the point of the CURRENT block is that it can be compared with the
  // screen. Both come off the same stat record and the same items, so they cannot drift.
  //
  // Advisory only for the game: nothing is written to a snapshot, to Gestal's folder or to the
  // game's own database. `log` and `fit` write to out/, which is personal account data and
  // gitignored.
  import { isSnapshotArg } from "./snapshots.mjs";

  // --- CLI: pure helpers ------------------------------------------------------

  // What each mode's usage line shows. Printed back on a missing argument, so the answer is the one
  // shape that would have worked rather than all four.
  export const USAGE = {
    solve: "power.mjs <name|ID> [snapshot.json.gz] [--power N] [--top N]",
    log: "power.mjs log <name|ID> <in-game power>",
    fit: "power.mjs fit <name|ID>",
    verify: "power.mjs verify [snapshot.json.gz]",
  };

  // The two modes that open a snapshot. The other two must refuse one outright rather than read the
  // path as a champion name — see parsePowerArgs.
  const READS_SNAPSHOT = new Set(["solve", "verify"]);

  // How many positionals each mode takes BESIDES the snapshot: solve and fit take a selector, log
  // takes a selector and a power, verify takes neither.
  const TAKES = { solve: 1, log: 2, fit: 1, verify: 0 };

  // Same selector/snapshot conventions as speed.mjs, plus a mode word. Option VALUES are consumed as
  // they are read, so `--top 3 Elhain` still finds Elhain rather than reading 3 as the selector.
  export function parsePowerArgs(argv) {
    const out = { mode: "solve", selector: null, dbArg: undefined, power: null, top: 1,
      logPower: null };
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "") continue;
      if (arg === "--power" || arg === "--top") {
        out[arg.slice(2)] = positiveInt(arg, argv[++i]);
        continue;
      }
      // Anything else beginning `--` is a typo, not a champion, and swallowing it as a positional is
      // the worst outcome on offer: `--tpo 3` loses the option-value race, prints one build, exits 0,
      // and says nothing about the two it dropped. A plausible wrong answer, not a crash.
      if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
      // A mode word is a mode only as the FIRST positional. `power.mjs Elhain fit` is someone naming
      // a champion and then a mode, which is not a usage line, and reading it as `fit` would answer a
      // different question than the one asked.
      if (positional.length === 0 && Object.hasOwn(USAGE, arg) && arg !== "solve") {
        out.mode = arg;
        continue;
      }
      positional.push(arg);
    }
    if (READS_SNAPSHOT.has(out.mode)) out.dbArg = positional.find(isSnapshotArg);
    const rest = positional.filter((a) => a !== out.dbArg);
    if (rest.length > TAKES[out.mode]) {
      throw new Error(`too many arguments for ${out.mode} — usage: ${USAGE[out.mode]}`);
    }
    out.selector = TAKES[out.mode] > 0 ? rest[0] ?? null : null;
    if (out.mode === "log" && rest.length > 1) out.logPower = positiveInt("the in-game power", rest[1]);
    return out;
  }
  ```
     Note `arg !== "solve"` in the mode check: `solve` is the default and has no usage line of its own to type, so the word is a champion selector like any other.
- [ ] 4. Add `positiveInt` directly below `parsePowerArgs`:
  ```javascript
  // In-game power, --power and --top are all WHOLE COUNTS: the game prints power as an integer, and
  // "the N best builds" has no fractional reading. Blank is checked before Number(), because
  // Number("") and Number(" ") are both 0 — an option whose value went missing would otherwise parse
  // as a legal 0, which is the one value that is certainly not meant. parseSpeedArgs makes the same
  // check for the same reason.
  function positiveInt(what, raw) {
    const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${what} needs a positive integer`);
    }
    return value;
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 5 passed.
- [ ] 6. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 parsePowerArgs: the four modes, the selector/snapshot pair and the defaults"`

### Task 3: `parsePowerArgs` — positive-integer validation

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`

**Steps:**

- [ ] 1. Append to the `parsePowerArgs` section of the test file:
  ```javascript
  // --- parsePowerArgs: the numeric arguments -------------------------------------

  test("parsePowerArgs reads --power and --top", () => {
    expect(parsePowerArgs(["Elhain", "--power", "412000", "--top", "3"]))
      .toMatchObject({ power: 412000, top: 3 });
  });

  // In-game power is a whole number on the screen, and --top counts builds. A fractional or negative
  // value is a typo, and 0 is the one value that is certainly not meant — `--top 0` would ask for no
  // builds at all.
  test("parsePowerArgs rejects a --power or --top that is not a positive integer", () => {
    for (const bad of ["0", "-1", "1.5", "lots", "1e3x"]) {
      expect(() => parsePowerArgs(["Elhain", "--top", bad]), `--top ${bad}`)
        .toThrow(/--top needs a positive integer/);
      expect(() => parsePowerArgs(["Elhain", "--power", bad]), `--power ${bad}`)
        .toThrow(/--power needs a positive integer/);
    }
  });

  // The log power is a positional rather than an option, and gets the same test: a reading logged
  // with a fractional power would be fitted against a number the game never showed.
  test("parsePowerArgs rejects a log power that is not a positive integer", () => {
    expect(() => parsePowerArgs(["log", "Elhain", "0"]))
      .toThrow(/the in-game power needs a positive integer/);
    expect(() => parsePowerArgs(["log", "Elhain", "-5"]))
      .toThrow(/the in-game power needs a positive integer/);
    expect(() => parsePowerArgs(["log", "Elhain", "12.5"]))
      .toThrow(/the in-game power needs a positive integer/);
  });

  // Number("") and Number(" ") are both 0, so an empty value would silently parse as a legal option
  // rather than as the typo it is. A missing value is Number(undefined) -> NaN.
  test("parsePowerArgs rejects an empty or missing option value", () => {
    expect(() => parsePowerArgs(["Elhain", "--top", ""])).toThrow(/--top/);
    expect(() => parsePowerArgs(["Elhain", "--power", "  "])).toThrow(/--power/);
    expect(() => parsePowerArgs(["Elhain", "--top"])).toThrow(/--top/);
  });

  // An option value must never be mistaken for the selector.
  test("parsePowerArgs does not treat an option value as the selector", () => {
    expect(parsePowerArgs(["--top", "3", "Elhain"]).selector).toBe("Elhain");
    expect(parsePowerArgs(["--power", "412000"]).selector).toBe(null);
  });
  ```
- [ ] 2. Run: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 10 passed. These are GREEN on introduction — Task 2 step 4 wrote `positiveInt` to satisfy the `logPower: 12345` assertion already in the file, so this task is a regression lock on the *rules* rather than a new behaviour. If any fails, fix `positiveInt`.
- [ ] 3. Commit: `git add oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Pin parsePowerArgs' positive-integer rules for --power, --top and the log power"`

### Task 4: `parsePowerArgs` — unknown options and extra positionals

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append to the test file:
  ```javascript
  // --- parsePowerArgs: arguments a mode does not take ----------------------------

  test("parsePowerArgs rejects an unknown option instead of taking it as a positional", () => {
    expect(() => parsePowerArgs(["Elhain", "--tpo", "3"])).toThrow(/unknown option --tpo/);
    expect(() => parsePowerArgs(["--powr", "1"])).toThrow(/unknown option/);
    expect(() => parsePowerArgs(["verify", "--top", "2", "--nope"])).toThrow(/unknown option --nope/);
  });

  // Each mode takes only the positionals its usage line shows. An extra one means the command was
  // understood differently than it was typed, and guessing which argument to drop is worse than
  // saying so.
  test("parsePowerArgs rejects an extra positional, naming the mode's usage line", () => {
    expect(() => parsePowerArgs(["fit", "Elhain", "Kael"]))
      .toThrow(/too many arguments for fit — usage: power\.mjs fit <name\|ID>/);
    expect(() => parsePowerArgs(["log", "Elhain", "100", "200"]))
      .toThrow(/too many arguments for log/);
    expect(() => parsePowerArgs(["Elhain", "Kael"])).toThrow(/too many arguments for solve/);
    expect(() => parsePowerArgs(["verify", "Elhain"])).toThrow(/too many arguments for verify/);
  });

  // fit reads no snapshot and log reads the LIVE folder, so a snapshot handed to either is a reader
  // who expects it to be used. Reading the live folder anyway (log), or nothing at all (fit), would
  // answer a different question — and `fit x/y.json.gz` would otherwise match the path against
  // reading NAMES and report "no logged readings match", which reads like an empty log rather than
  // like a mode that never opens a snapshot.
  test("parsePowerArgs rejects a snapshot given to a mode that reads none", () => {
    expect(() => parsePowerArgs(["fit", "x/y.json.gz"]))
      .toThrow(/fit reads no snapshot/);
    expect(() => parsePowerArgs(["log", "Elhain", "100", "x/y.json.gz"]))
      .toThrow(/log reads no snapshot/);
    expect(() => parsePowerArgs(["fit", "Elhain", "a.db"])).toThrow(/fit reads no snapshot/);
  });

  // `solve` is the default mode and has no usage line to type, so the word is an ordinary selector.
  test("parsePowerArgs treats a mode word after the first positional as a selector", () => {
    expect(parsePowerArgs(["solve"])).toMatchObject({ mode: "solve", selector: "solve" });
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: `parsePowerArgs rejects a snapshot given to a mode that reads none` fails — `fit x/y.json.gz` currently parses with `selector: "x/y.json.gz"` and throws nothing. The other three pass (Task 2's `TAKES` check and `unknown option` already cover them).
- [ ] 3. In `power.mjs`, add the snapshot refusal to `parsePowerArgs` immediately after the `if (READS_SNAPSHOT.has(out.mode)) out.dbArg = …` line and before `const rest = …`:
  ```javascript
    if (!READS_SNAPSHOT.has(out.mode)) {
      const snap = positional.find(isSnapshotArg);
      if (snap) {
        throw new Error(`${out.mode} reads no snapshot, so it cannot take "${snap}"`
          + ` — usage: ${USAGE[out.mode]}`);
      }
    }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 14 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 parsePowerArgs: refuse unknown options, extra positionals and a snapshot a mode cannot read"`

### Task 5: `mainCopies` — one copy per champion, the most invested

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `mainCopies` to the `power.mjs` import in the test file, then append the row fixtures and the first test:
  ```javascript
  // --- mainCopies -----------------------------------------------------------------
  //
  // Champion rows as gestalChampRows builds them, cut down to the columns mainCopies reads. Two
  // copies of one champion share a BaseHeroID; `awaken` is NOT a row column — Gestal carries it per
  // copy and the row shape mirrors RSL Helper's Champs table, which has none — so it arrives in the
  // separate stats map.
  const copyRow = (o = {}) => ({
    ID: 1, Name: "Elhain", Role: 0, Rarity: 5, Rang: 6, Lvl: 60, Fraction: 0, EmpLvl: 0,
    BaseHeroID: 1490, ...o,
  });
  const statsOf = (byId) => new Map(Object.entries(byId).map(([id, awaken]) => [Number(id), { awaken }]));
  const worn = (id, champId) => ({ id, equippedChampId: champId });
  const idsOf = (rows) => rows.map((r) => r.ID);

  // Rank first: a 6-star copy is the one being played however long the 5-star has been sitting at
  // level 60.
  test("mainCopies keeps the higher-ranked copy of a champion", () => {
    const rows = [copyRow({ ID: 1, Rang: 5 }), copyRow({ ID: 2, Rang: 6 })];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2]);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the new test fails — `mainCopies is not a function`.
- [ ] 3. In `power.mjs`, add the `champs.mjs` import beside the existing `snapshots.mjs` one:
  ```javascript
  import { selectChamps } from "./champs.mjs";
  ```
- [ ] 4. Add `mainCopies` and its comparator below `positiveInt`:
  ```javascript
  // How many of these items a copy is wearing. A measure of INVESTMENT in the copy, not of what it
  // could hold — the solver's pool is the whole vault either way.
  const equippedCount = (items, champId) =>
    items.filter((it) => it.equippedChampId === champId).length;

  // Investment order, most invested first: rank, level, empowerment, awakening, how many pieces it is
  // wearing, then the lower id so a rerun on one snapshot picks the same copy.
  //
  // spare-copies.mjs's compareCopies is the same idea in a different order — it weighs gear above
  // empowerment and carries a blessing marker Gestal has no column for — so the two are kept apart
  // rather than one being bent to serve both.
  function compareInvestment(a, b, awakenOf, items) {
    return (b.Rang - a.Rang)
      || (b.Lvl - a.Lvl)
      || (b.EmpLvl - a.EmpLvl)
      || (awakenOf(b) - awakenOf(a))
      || (equippedCount(items, b.ID) - equippedCount(items, a.ID))
      || (a.ID - b.ID);
  }

  // One copy per champion: the most invested one. Copies of a champion share a baseTypeId and
  // therefore one set of weights, but each has its own constant and its own gear, so solving all of
  // them would print the same answer several times over for the copies nobody plays.
  //
  // An ALL-DIGIT selector is an exact copy id and is never grouped: asking for #12059 by id is asking
  // for that copy, spare or not. Anything else is a name substring, which can match several champions
  // as well as several copies of one, so the grouping is by BaseHeroID.
  //
  // `rows` is expected to have been through isRealChamp. A placeholder row for a wearer the roster
  // has not listed yet has a null BaseHeroID and no stats record, and grouping those together would
  // put unrelated champions in one bucket.
  export function mainCopies(rows, statsById, items, selector) {
    const matched = selectChamps(rows, selector);
    if (/^\d+$/.test(String(selector ?? ""))) return matched;
    const awakenOf = (r) => statsById.get(r.ID)?.awaken ?? 0;
    const best = new Map();
    for (const row of matched) {
      const held = best.get(row.BaseHeroID);
      if (!held || compareInvestment(row, held, awakenOf, items) < 0) best.set(row.BaseHeroID, row);
    }
    return [...best.values()].sort((a, b) => a.ID - b.ID);
  }
  ```
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 15 passed.
- [ ] 6. Append the rest of the ranking tests, one per tiebreak, so a reordered comparator names which rule it broke:
  ```javascript
  test("mainCopies falls to level when the rank ties", () => {
    const rows = [copyRow({ ID: 1, Lvl: 60 }), copyRow({ ID: 2, Lvl: 50 })];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([1]);
  });

  test("mainCopies falls to empowerment when rank and level tie", () => {
    const rows = [copyRow({ ID: 1, EmpLvl: 0 }), copyRow({ ID: 2, EmpLvl: 3 })];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2]);
  });

  // Awakening comes off the stats map, not the row. A copy with no stats record reads as awaken 0
  // rather than crashing, which is what keeps the comparator total.
  test("mainCopies falls to awakening, which it reads from the stats map", () => {
    const rows = [copyRow({ ID: 1 }), copyRow({ ID: 2 })];
    expect(idsOf(mainCopies(rows, statsOf({ 1: 0, 2: 5 }), [], "Elhain"))).toEqual([2]);
    expect(idsOf(mainCopies(rows, statsOf({ 1: 5 }), [], "Elhain"))).toEqual([1]);
  });

  test("mainCopies falls to how many pieces the copy is wearing", () => {
    const rows = [copyRow({ ID: 1 }), copyRow({ ID: 2 })];
    const items = [worn(10, 2), worn(11, 2), worn(12, 1)];
    expect(idsOf(mainCopies(rows, statsOf({}), items, "Elhain"))).toEqual([2]);
  });

  // The last tiebreak, and the one that makes a rerun on one snapshot deterministic.
  test("mainCopies falls to the lower id when every other measure ties", () => {
    const rows = [copyRow({ ID: 7 }), copyRow({ ID: 3 })];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([3]);
  });

  // Two different champions are two groups, not two copies, however alike their names.
  test("mainCopies keeps one copy per BaseHeroID and returns them in id order", () => {
    const rows = [
      copyRow({ ID: 1, BaseHeroID: 1490, Rang: 5 }),
      copyRow({ ID: 2, BaseHeroID: 1490, Rang: 6 }),
      copyRow({ ID: 9, BaseHeroID: 1491, Name: "Dark Elhain" }),
      copyRow({ ID: 8, BaseHeroID: 1491, Name: "Dark Elhain", Rang: 4 }),
    ];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "Elhain"))).toEqual([2, 9]);
  });

  // An id is a request for THAT copy. Grouping it would answer with a different one, which is the
  // single worst thing an exact selector can do.
  test("mainCopies returns the exact copy for an all-digit selector, spare or not", () => {
    const rows = [copyRow({ ID: 1, Rang: 6 }), copyRow({ ID: 2, Rang: 2, Lvl: 1 })];
    expect(idsOf(mainCopies(rows, statsOf({}), [], "2"))).toEqual([2]);
    expect(idsOf(mainCopies(rows, statsOf({}), [], "99"))).toEqual([]);
  });

  test("mainCopies returns nothing when the selector matches nothing", () => {
    expect(mainCopies([copyRow()], statsOf({}), [], "Kael")).toEqual([]);
  });
  ```
- [ ] 7. Run: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 23 passed.
- [ ] 8. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 mainCopies: one copy per champion, ranked by investment"`

### Task 6: `formatBreakdown` and `formatTotals`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `formatBreakdown, formatTotals` to the `power.mjs` import in the test file, add `import { STATS } from "../champion-stats.mjs";`, and append:
  ```javascript
  // --- formatBreakdown ------------------------------------------------------------
  //
  // The grid is read back by SLICING fixed-width fields rather than by splitting on whitespace: a
  // blank cell is the thing being tested, and splitting would collapse it into its neighbours. The
  // widths are re-derived here rather than imported, so a change to the layout fails this test —
  // which is the point, the widths ARE the contract.
  const LABEL_W = 18, CELL_W = 8;
  const fields = (line) => {
    const body = line.slice(2);
    return [body.slice(0, LABEL_W).trim(),
      ...STATS.map((_, i) => body.slice(LABEL_W + i * CELL_W, LABEL_W + (i + 1) * CELL_W).trim())];
  };

  const vec = (o = {}) => ({ ...Object.fromEntries(STATS.map((s) => [s, 0])), ...o });

  test("formatBreakdown heads the grid with the eight stats in the screen's order", () => {
    const lines = formatBreakdown({ columns: [], totals: vec() }).split("\n");
    expect(fields(lines[0])).toEqual(["", ...STATS]);
  });

  // One row per source, in whatever order the breakdown gives them, then Total. A zero is left BLANK
  // rather than printed: most sources touch two or three stats, and a grid of 80 cells with seventy
  // zeroes in it hides the handful that matter.
  test("formatBreakdown prints one row per column, then Total, blanking the zeroes", () => {
    const breakdown = {
      columns: [["Basic", vec({ HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 15, "C.DMG": 50, RES: 30 })],
        ["Artifacts", vec({ "C.RATE": 12, "C.DMG": 30 })]],
      totals: vec({ HP: 15000, ATK: 1000, DEF: 900, SPD: 100, "C.RATE": 27, "C.DMG": 80, RES: 30 }),
    };
    const lines = formatBreakdown(breakdown).split("\n");
    expect(fields(lines[1]))
      .toEqual(["Basic", "15000", "1000", "900", "100", "15", "50", "30", ""]);
    expect(fields(lines[2])).toEqual(["Artifacts", "", "", "", "", "12", "30", "", ""]);
    expect(fields(lines[3]))
      .toEqual(["Total", "15000", "1000", "900", "100", "27", "80", "30", ""]);
    expect(lines).toHaveLength(4);
  });

  // Column vectors are unrounded on purpose (champion-stats.mjs rounds each column once and then
  // sums). Printing one unrounded would leave a column that does not add up to the Total beneath it.
  test("formatBreakdown rounds each cell, as the game's screen does", () => {
    const lines = formatBreakdown({
      columns: [["Classic Arena", vec({ HP: 3300.4, ATK: 220.6 })]], totals: vec({ HP: 3300 }),
    }).split("\n");
    expect(fields(lines[1])).toEqual(["Classic Arena", "3300", "221", "", "", "", "", "", ""]);
  });

  // Faction Guardians is the longest label the stat model produces, at 17 characters, so the label
  // column has to hold it without pushing the grid out of alignment.
  test("formatBreakdown keeps the grid aligned under the longest source label", () => {
    const lines = formatBreakdown({
      columns: [["Faction Guardians", vec({ HP: 2000 })]], totals: vec({ HP: 2000 }),
    }).split("\n");
    expect(fields(lines[1])[0]).toBe("Faction Guardians");
    expect(fields(lines[1])[1]).toBe("2000");
  });

  // --- formatTotals ---------------------------------------------------------------

  // One line rather than a grid: a build's totals are printed per build, and --top prints several.
  test("formatTotals names every stat with its rounded value on one line", () => {
    expect(formatTotals(vec({ HP: 42000.4, ATK: 2100, SPD: 240, "C.RATE": 100, "C.DMG": 220 })))
      .toBe("    totals: HP 42000  ATK 2100  DEF 0  SPD 240  C.RATE 100  C.DMG 220  RES 0  ACC 0");
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the five new tests fail — `formatBreakdown is not a function`.
- [ ] 3. In `power.mjs`, add `import { STATS } from "./champion-stats.mjs";` beside the other local imports, then add below `mainCopies`:
  ```javascript
  // --- the game's Total Stats screen ----------------------------------------------

  // Wide enough for "Faction Guardians", the longest label the stat model produces.
  const LABEL_WIDTH = 18;
  // Wide enough for a six-digit HP total and for the "C.RATE" heading, with a space between columns.
  const CELL_WIDTH = 8;

  // One cell. ROUNDED, because that is what the game shows and what statBreakdown's own totals are
  // summed from — a column printed unrounded would not add up to the Total row beneath it. A zero is
  // BLANK rather than printed: most sources touch two or three stats, and a grid of eighty cells with
  // seventy zeroes in it hides the handful that matter.
  const cell = (value) => {
    const n = Math.round(value);
    return (n === 0 ? "" : String(n)).padStart(CELL_WIDTH);
  };

  const gridRow = (label, vector) =>
    `  ${label.padEnd(LABEL_WIDTH)}${STATS.map((stat) => cell(vector[stat])).join("")}`;

  // The game's Total Stats screen: one row per source, one column per stat, then the totals. The
  // source rows come out in whatever order statBreakdown gives them, which is the screen's own order
  // (Basic, Artifacts, Affinity, Classic Arena, Masteries, Faction Guardians, Empowerment, Blessing,
  // Relic) — so the layout is the stat model's to change, not this printer's.
  export function formatBreakdown(breakdown) {
    const lines = [`  ${"".padEnd(LABEL_WIDTH)}${STATS.map((s) => s.padStart(CELL_WIDTH)).join("")}`];
    for (const [label, vector] of breakdown.columns) lines.push(gridRow(label, vector));
    lines.push(gridRow("Total", breakdown.totals));
    return lines.join("\n");
  }

  // One build's totals on a single line. A grid per build would be eleven lines each, and --top asks
  // for several builds at once; what a reader compares between them is the eight numbers.
  //
  // Every stat is named, zeroes included, unlike the grid above: on one line there is nothing for a
  // zero to hide among, and a missing stat would read as a stat the model does not carry.
  export function formatTotals(totals) {
    return `    totals: ${STATS.map((s) => `${s} ${Math.round(totals[s])}`).join("  ")}`;
  }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 28 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 formatBreakdown and formatTotals: the game's Total Stats layout"`

### Task 7: `formatGain` — the BEST headline, with and without the constant

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `formatGain` to the test file's `power.mjs` import and append:
  ```javascript
  // --- formatGain -----------------------------------------------------------------

  // With the constant the answer is in POWER, the number the game shows, and the gain is a difference
  // the reader can check against the screen.
  //   current (100 + 5)^2 = 11,025 · best (120 + 5)^2 = 15,625 · gain 4,600
  test("formatGain reports power and the gain over current when the constant is known", () => {
    expect(formatGain(100, 120, 5)).toBe("  BEST  15625 power  (+4600 over current)");
  });

  // Power is (lin + c)^2, so without `c` every absolute number is unavailable and only the RATIO can
  // be stated — computed at c = 0, where it is an OVER-estimate, because a positive c raises both
  // sides and shrinks the ratio. Marked `≈` and told to the reader outright rather than dressed up as
  // a power number.
  //   (120 / 100)^2 - 1 = 0.44
  test("formatGain falls back to a percentage when the constant is unknown", () => {
    expect(formatGain(100, 120, null))
      .toBe("  BEST  ≈ +44.0% (per-copy constant unknown: log a reading or pass --power)");
  });

  // A negative constant is legal — constantFrom is signed and never clamped, so a disagreement
  // between the weights and the reading stays visible rather than being absorbed into a floor.
  //   current (100 - 20)^2 = 6,400 · best (120 - 20)^2 = 10,000 · gain 3,600
  test("formatGain handles a negative constant without losing the sign", () => {
    expect(formatGain(100, 120, -20)).toBe("  BEST  10000 power  (+3600 over current)");
  });

  // Nothing over nothing has no ratio. It cannot arise from a real champion — base stats alone put
  // `lin` in the hundreds — so it is named rather than turned into a percentage, which at c = 0 would
  // read as "+0.0%" for a build that is in fact an infinite improvement.
  test("formatGain names a zero current rather than reporting a ratio for it", () => {
    expect(formatGain(0, 120, null)).toMatch(/gain unknown/);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the four new tests fail — `formatGain is not a function`.
- [ ] 3. In `power.mjs`, add below `formatTotals`:
  ```javascript
  // --- the BEST headline, the certificate and the runners-up ----------------------

  // Power from a build's `lin` and the copy's constant. The one place the square is taken, so the
  // relationship between the solver's objective and the number the game shows is written once.
  const powerOf = (buildLin, c) => (buildLin + c) ** 2;

  // The BEST headline. With `c` it is in power, the number on the game's screen; without it neither
  // the power nor the gain exists, and the only honest thing left is the ratio at c = 0 — an
  // over-estimate, since a positive c raises both sides and shrinks it.
  export function formatGain(currentLin, bestLin, c) {
    if (c !== null) {
      const best = powerOf(bestLin, c);
      return `  BEST  ${Math.round(best)} power`
        + `  (+${Math.round(best - powerOf(currentLin, c))} over current)`;
    }
    // Nothing over nothing has no ratio, and at c = 0 it would come out as "+0.0%" for a build that is
    // in fact an infinite improvement. Unreachable for a real champion — base stats alone put `lin`
    // in the hundreds — so it is named rather than computed.
    if (!(currentLin > 0)) {
      return "  BEST  gain unknown (the current build scores zero and the per-copy constant is"
        + " unknown: log a reading or pass --power)";
    }
    const pct = ((bestLin / currentLin) ** 2 - 1) * 100;
    return `  BEST  ≈ +${pct.toFixed(1)}%`
      + " (per-copy constant unknown: log a reading or pass --power)";
  }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 32 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 formatGain: the BEST headline in power, or a ratio when the constant is unknown"`

### Task 8: `formatCertificate` and `formatOffBest`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `formatCertificate, formatOffBest` to the test file's `power.mjs` import and append:
  ```javascript
  // --- formatCertificate ----------------------------------------------------------
  //
  // `gap` and `upperBound` come out of power-solve in sqrt(power) units — it maximizes `lin`, and its
  // McCormick bound bounds `lin`. With `c` they convert to power; without it they are reported in
  // their own units rather than silently mislabelled as power, which is the one way this line could
  // be read as a much smaller number than it is.

  const cert = (o = {}) => ({ gap: 5, upperBound: 125, rounds: 3, converged: true, ...o });

  //   best (120 + 5)^2 = 15,625 · bound (125 + 5)^2 = 16,900 · gap 1,275 · 1275/15625 = 8.16%
  test("formatCertificate converts the gap to power when the constant is known", () => {
    expect(formatCertificate(cert(), 120, 5))
      .toBe("    at most 1275 power (8.16%) below the true maximum   [3 rounds, converged]");
  });

  //   gap 5 in sqrt(power) against a best `lin` of 120 · 5/120 = 4.17%
  test("formatCertificate keeps the gap in sqrt(power) when the constant is unknown", () => {
    expect(formatCertificate(cert({ rounds: 1, converged: false }), 120, null))
      .toBe("    at most 5.00 √power (4.17%) below the true maximum   [1 round, no fixed point]");
  });

  // `converged` is a fixed point of the linearize-and-resolve map, NOT an optimum, and a cycle or a
  // maxRounds stop is neither. The wording has to keep those apart without either claiming
  // optimality.
  test("formatCertificate says plainly when there was no fixed point", () => {
    expect(formatCertificate(cert({ converged: false }), 120, 5)).toMatch(/no fixed point/);
    expect(formatCertificate(cert({ converged: true }), 120, 5)).toMatch(/converged/);
  });

  // power-solve leaves `gap` unclamped so a violated assumption stays visible, and float noise can
  // put it a hair below zero. Printing the sign is the whole point; absorbing it into an absolute
  // value would hide exactly the case the gap was left signed for.
  test("formatCertificate keeps a negative gap visible rather than absorbing it", () => {
    expect(formatCertificate(cert({ gap: -0.004 }), 120, null)).toMatch(/at most -0\.00 √power/);
  });

  // --- formatOffBest --------------------------------------------------------------

  // The runners-up, measured against BEST in the SAME unit as the certificate line, so the two
  // numbers on one report are comparable. The delta is negative by construction — these are worse
  // builds — and the sign is printed rather than a minus being pasted in front of an absolute value.
  //   (110 + 5)^2 = 13,225 against (120 + 5)^2 = 15,625 -> -2,400
  test("formatOffBest measures a runner-up against BEST in power when the constant is known", () => {
    expect(formatOffBest(2, { lin: 110 }, { lin: 120 }, 5)).toBe("  #2  (-2400 power off BEST)");
  });

  test("formatOffBest measures it in sqrt(power) when the constant is unknown", () => {
    expect(formatOffBest(3, { lin: 110 }, { lin: 120 }, null))
      .toBe("  #3  (-10.00 √power off BEST)");
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the six new tests fail — `formatCertificate is not a function`.
- [ ] 3. In `power.mjs`, add below `formatGain`:
  ```javascript
  // What the solver PROVED, as opposed to what it found. power-solve's `upperBound` is a genuine
  // upper bound on the objective over EVERY assignment of this vault, so the gap is a proven ceiling
  // on how much the answer could still be improved — "within X of the maximum", never "the maximum".
  //
  // `converged` means a FIXED POINT of the linearize-and-resolve map, which is the exact optimum of
  // the objective linearized at its own crit totals and is NOT the optimum of the true objective. The
  // wording must not drift into claiming otherwise; power-solve.mjs's header is explicit about it.
  // A wide gap is the signal that this champion's crit range is too broad for the linearization,
  // which is what the planned exact mode is for.
  export function formatCertificate({ gap, upperBound, rounds, converged }, bestLin, c) {
    const best = c === null ? bestLin : powerOf(bestLin, c);
    const amount = c === null ? gap : powerOf(upperBound, c) - best;
    // Two decimals in sqrt(power), where the numbers are single digits; whole numbers in power, which
    // the game shows as an integer.
    const shown = c === null ? amount.toFixed(2) : String(Math.round(amount));
    const pct = best > 0 ? `${((amount / best) * 100).toFixed(2)}%` : "n/a";
    return `    at most ${shown} ${c === null ? "√power" : "power"} (${pct}) below the true maximum`
      + `   [${rounds} round${rounds === 1 ? "" : "s"},`
      + ` ${converged ? "converged" : "no fixed point"}]`;
  }

  // One runner-up's distance from BEST, in the same unit as the certificate line above so the two
  // numbers on one report can be compared. Same shape as speed.mjs's printRanked.
  //
  // These are the best DISTINCT SETS OF ITEMS the iteration happened to see, which is not a proved
  // top-N — power-solve says so outright and this line does not imply otherwise.
  export function formatOffBest(index, build, best, c) {
    const delta = c === null ? build.lin - best.lin : powerOf(build.lin, c) - powerOf(best.lin, c);
    const shown = c === null ? delta.toFixed(2) : String(Math.round(delta));
    return `  #${index}  (${shown} ${c === null ? "√power" : "power"} off BEST)`;
  }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 38 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 formatCertificate and formatOffBest: the proven gap and the runners-up, in power or sqrt(power)"`

### Task 9: `formatSets` — the sets a build holds

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `formatSets` to the test file's `power.mjs` import and append:
  ```javascript
  // --- formatSets -----------------------------------------------------------------
  //
  // Set names come from @rslh/core's ARTIFACT_SET_NAMES, the same table speed.mjs and
  // champion-gear.mjs label items with, so one report does not call a set what another does not.
  // (set-bonuses.mjs carries its own `name` field; it is not the one printed.)

  test("formatSets names each set with its count, biggest first", () => {
    expect(formatSets(new Map([[59, 6], [54, 2]]))).toBe("Merciless x6 · Zeal x2");
  });

  test("formatSets breaks a tie on the set name, so a rerun prints the same line", () => {
    expect(formatSets(new Map([[54, 2], [59, 2]]))).toBe("Merciless x2 · Zeal x2");
    expect(formatSets(new Map([[59, 2], [54, 2]]))).toBe("Merciless x2 · Zeal x2");
  });

  // Set 12 is Cursed, one of the 28 ids that grant no stats at all. Naming it in a POWER report would
  // imply it moved the number; it cannot, because no stat column reflects it.
  test("formatSets leaves out the sets that grant no stats", () => {
    expect(formatSets(new Map([[12, 4], [59, 2]]))).toBe("Merciless x2");
    expect(formatSets(new Map([[12, 4]]))).toBe("no stat sets");
    expect(formatSets(new Map())).toBe("no stat sets");
  });

  // verify is the one caller that wants them all. A set that GAINED a stat in a game patch is
  // exactly what it is looking for, and that set is still in NO_STAT_SETS until the table is
  // updated — so hiding it would hide the cause of the mismatch being reported.
  test("formatSets names every set when asked for all of them", () => {
    expect(formatSets(new Map([[12, 4], [59, 2]]), true)).toBe("Cursed x4 · Merciless x2");
    expect(formatSets(new Map(), true)).toBe("no sets");
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the four new tests fail — `formatSets is not a function`.
- [ ] 3. In `power.mjs`, add the `@rslh/core` and `set-bonuses.mjs` imports (core goes above the local ones, as in `speed.mjs`):
  ```javascript
  import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
  ```
  ```javascript
  import { SET_BONUSES } from "./set-bonuses.mjs";
  ```
- [ ] 4. Add the labels and `formatSets` below `formatOffBest`:
  ```javascript
  // --- labels ---------------------------------------------------------------------

  const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
  const setLabel = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

  // "Merciless x6 · Zeal x2". Biggest count first, then by name, so a rerun prints the same line.
  //
  // `all` names every set the build holds. The default names only the sets that GRANT STATS, because
  // a set that grants none did not move a power number and listing it here would imply it had.
  // verify passes `all`: a set that gained a stat in a patch is the case it exists to catch, and that
  // set sits in NO_STAT_SETS until the table is updated.
  //
  // Set 0 never reaches here — setCounts skips it, since a setless piece belongs to no set.
  export function formatSets(counts, all = false) {
    const parts = [...counts]
      .filter(([setId]) => all || SET_BONUSES[setId])
      .sort((a, b) => b[1] - a[1] || setLabel(a[0]).localeCompare(setLabel(b[0])))
      .map(([setId, count]) => `${setLabel(setId)} x${count}`);
    if (parts.length) return parts.join(" · ");
    return all ? "no sets" : "no stat sets";
  }
  ```
     `slotName` is unused until Task 14 prints a build's slots; `npm run lint` is therefore deferred to that task, as noted in step 6.
- [ ] 5. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 42 passed.
- [ ] 6. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 formatSets: the sets a build holds, stat-granting only unless asked for all"`
     Note: this commit is lint-dirty on `no-unused-vars` for `slotName`, which Task 14 consumes. Carrying the unused label here rather than churning it in and out keeps the two label helpers in one place; `npm run lint` is run clean at Task 14 and again at the final gate.

### Task 10: `readingsFor` and `latestReading`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `latestReading, readingsFor` to the test file's `power.mjs` import and append:
  ```javascript
  // --- readingsFor / latestReading ------------------------------------------------
  //
  // A reading record, in power-fit.mjs's format. Only the four fields these two helpers read are
  // filled in; the fit's own tests cover `totals` and `power`.
  const rec = (o = {}) => ({ t: "2026-10-03T12:00:00.000Z", heroId: 11, baseTypeId: 999001,
    name: "Synthetic", roleId: 0, ...o });

  // fit reads NO snapshot, so its selector is matched against the readings themselves rather than
  // against a roster. Same two rules selectChamps uses: all digits is an exact copy id, anything else
  // is a case-insensitive name substring.
  test("readingsFor matches an all-digit selector against heroId", () => {
    const log = [rec({ heroId: 11 }), rec({ heroId: 22 })];
    expect(readingsFor(log, "22").map((r) => r.heroId)).toEqual([22]);
    expect(readingsFor(log, "99")).toEqual([]);
  });

  test("readingsFor matches anything else as a case-insensitive name substring", () => {
    const log = [rec({ name: "Thor Faehammer" }), rec({ name: "Madame Serris" })];
    expect(readingsFor(log, "faeham").map((r) => r.name)).toEqual(["Thor Faehammer"]);
    expect(readingsFor(log, "SERRIS").map((r) => r.name)).toEqual(["Madame Serris"]);
  });

  // An empty selector would match every reading by substring and fit two champions together, which
  // fitWeights refuses — but with a message about mixed baseTypeIds rather than about the missing
  // selector that caused it.
  test("readingsFor matches nothing without a selector", () => {
    expect(readingsFor([rec()], null)).toEqual([]);
    expect(readingsFor([rec()], "")).toEqual([]);
  });

  // The constant is a property of the COPY, so the reading it is measured from has to be that copy's.
  // The MOST RECENT one, because the copy's non-stat investment (a blessing, a relic) only grows.
  test("latestReading takes the newest reading for one copy", () => {
    const log = [
      rec({ heroId: 11, t: "2026-10-01T09:00:00.000Z" }),
      rec({ heroId: 22, t: "2026-10-09T09:00:00.000Z" }),
      rec({ heroId: 11, t: "2026-10-03T09:00:00.000Z" }),
    ];
    expect(latestReading(log, 11).t).toBe("2026-10-03T09:00:00.000Z");
    expect(latestReading(log, 22).t).toBe("2026-10-09T09:00:00.000Z");
  });

  // No reading for this copy is the state before the first log, not an error: solve falls back to
  // reporting a ratio.
  test("latestReading returns null when the copy has no reading", () => {
    expect(latestReading([rec({ heroId: 11 })], 99)).toBe(null);
    expect(latestReading([], 11)).toBe(null);
  });

  // The log is appended in time order, but it is a plain text file a user can edit or concatenate, so
  // the newest is taken by comparing timestamps rather than by reading the last line.
  test("latestReading compares timestamps rather than trusting the file order", () => {
    const log = [rec({ t: "2026-10-09T09:00:00.000Z" }), rec({ t: "2026-10-01T09:00:00.000Z" })];
    expect(latestReading(log, 11).t).toBe("2026-10-09T09:00:00.000Z");
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the six new tests fail — `readingsFor is not a function`.
- [ ] 3. In `power.mjs`, add below `formatSets`:
  ```javascript
  // --- the reading log ------------------------------------------------------------

  // Which logged readings a fit selector names. fit reads no snapshot, so there is no roster to match
  // against — the readings carry their own `heroId` and `name`, and the two rules are selectChamps':
  // all digits is an exact copy id, anything else is a case-insensitive substring of the name the
  // reading was logged under.
  //
  // No selector matches NOTHING, not everything. An empty substring would match every reading and
  // hand fitWeights two champions, which it refuses — but with a message about mixed baseTypeIds
  // rather than about the missing selector that caused it.
  export function readingsFor(readings, selector) {
    if (!selector) return [];
    if (/^\d+$/.test(selector)) {
      return readings.filter((r) => Number(r.heroId) === Number(selector));
    }
    const needle = selector.toLowerCase();
    return readings.filter((r) => String(r.name).toLowerCase().includes(needle));
  }

  // The most recent reading for ONE copy, or null. The constant is a property of the copy, and the
  // copy's non-stat investment only grows, so the newest reading is the one that still describes it.
  //
  // By TIMESTAMP rather than by file order: readings are appended in time order, but the log is a
  // plain text file a user can edit or concatenate two of. ISO-8601 strings in UTC compare
  // lexicographically in time order, which is why no Date is constructed here.
  export function latestReading(readings, heroId) {
    let best = null;
    for (const r of readings) {
      if (r.heroId !== heroId) continue;
      if (!best || String(r.t) > String(best.t)) best = r;
    }
    return best;
  }
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 48 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 readingsFor and latestReading: selecting logged readings without a roster"`

### Task 11: `powerDir`, `readingsPath` and `weightsPath`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `powerDir, readingsPath, weightsPath` to the test file's `power.mjs` import and append:
  ```javascript
  // --- powerDir -------------------------------------------------------------------

  // The default is MODULE-relative, the way analyze.mjs locates out/, rather than relative to the
  // working directory — so the reading log is the same file whichever directory the tool is run from.
  // oracle/analytics/.gitignore already denies out/: these are personal account data.
  test("powerDir defaults to the module's own out/ directory", () => {
    const saved = process.env.RSLH_POWER_DIR;
    try {
      delete process.env.RSLH_POWER_DIR;
      expect(powerDir().replace(/\\/g, "/")).toMatch(/oracle\/analytics\/out\/?$/);
    } finally {
      if (saved === undefined) delete process.env.RSLH_POWER_DIR;
      else process.env.RSLH_POWER_DIR = saved;
    }
  });

  // $RSLH_POWER_DIR is what lets a test run without touching a real reading log, and what lets the
  // account owner keep one somewhere else.
  test("powerDir honours $RSLH_POWER_DIR and the two file names hang off it", () => {
    const saved = process.env.RSLH_POWER_DIR;
    try {
      process.env.RSLH_POWER_DIR = "/tmp/elsewhere";
      expect(powerDir()).toBe("/tmp/elsewhere");
      expect(readingsPath()).toBe("/tmp/elsewhere/power-readings.jsonl");
      expect(weightsPath()).toBe("/tmp/elsewhere/power-weights.json");
    } finally {
      if (saved === undefined) delete process.env.RSLH_POWER_DIR;
      else process.env.RSLH_POWER_DIR = saved;
    }
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the two new tests fail — `powerDir is not a function`.
- [ ] 3. In `power.mjs`, add `import { join } from "node:path";` and `import { fileURLToPath } from "node:url";` at the top of the import block, then add below `latestReading`:
  ```javascript
  // --- where the local files live --------------------------------------------------

  // The readings and the fitted weights. $RSLH_POWER_DIR overrides the location, which is what lets a
  // test run without reading or appending to a real log. The default is MODULE-relative — the way
  // analyze.mjs locates out/ — rather than relative to the working directory, so the log is the same
  // file whichever directory the tool is run from. oracle/analytics/.gitignore already denies out/:
  // a reading log and a fitted table are personal account data.
  export function powerDir() {
    return process.env.RSLH_POWER_DIR || fileURLToPath(new URL("out/", import.meta.url));
  }

  // One reading record per line, in power-fit.mjs's format.
  export const readingsPath = () => join(powerDir(), "power-readings.jsonl");

  // baseTypeId -> { name, b, r, a, s, k, fittedAt, readings }. The whole object is the `fitted`
  // argument to weightsFor, which reads only the five weights and ignores the rest.
  export const weightsPath = () => join(powerDir(), "power-weights.json");
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 50 passed.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 powerDir: the module-relative out/ directory, overridable with \$RSLH_POWER_DIR"`

---

## Chunk 3 — Solve mode

### Task 12: End-to-end fixtures, the Gestal refusal, the missing selector and the no-match message

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add the end-to-end imports to the top of the test file, below the existing ones:
  ```javascript
  import { spawnSync } from "node:child_process";
  import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { afterEach } from "vitest";
  import { FORMAT, FORMAT_VERSION } from "../gestal.mjs";
  import { writeSnapshot } from "../refresh-gestal.mjs";
  ```
- [ ] 2. Append the shared end-to-end fixture block. Everything from here to the end of the file is the spawned-CLI half:
  ```javascript
  // === end to end ==================================================================
  //
  // The CLI over throwaway synthetic snapshots, read back from its stdout and stderr.

  const SCRIPT = fileURLToPath(new URL("../power.mjs", import.meta.url));
  // node:sqlite needs the flag on Node 22 and refuses it on builds that no longer know it. power.mjs
  // opens no database, but its champion selector comes from champs.mjs, which imports node:sqlite for
  // the other snapshot kind. --no-warnings keeps that module's ExperimentalWarning off stderr, which
  // the message assertions below read.
  const FLAGS = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-sqlite"] : [];

  const cleanups = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()(); });
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), "power-cli-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };

  // EVERY run gets a fresh RSLH_POWER_DIR, so no test ever reads or appends to the developer's real
  // oracle/analytics/out/. GESTAL_DATA_ROOT is always set too, and by default to a path that does not
  // exist: a test that reaches the live folder by mistake then fails loudly instead of reading a real
  // account. Only the `log` tests point it at a fixture.
  const run = (args, { powerDir = tmp(), dataRoot } = {}) => spawnSync(
    process.execPath, [...FLAGS, "--no-warnings", SCRIPT, ...args],
    { encoding: "utf8", env: { ...process.env,
      RSLH_POWER_DIR: powerDir,
      GESTAL_DATA_ROOT: dataRoot ?? join(powerDir, "no-gestal-folder-here") } });

  // --- Gestal fixtures ------------------------------------------------------------
  //
  // Synthetic and hand-built, as in gestal.test.mjs: a real Gestal folder holds personal account
  // data and never belongs in the repo.

  // Gestal's slot ids are 0-based and are NOT ours: 0 is the Weapon (our slot 5), 1 the Helmet
  // (our 1), 2 the Shield (our 6). Named here so the fixtures below read as gear rather than as
  // integers.
  const G_WEAPON = 0, G_HELMET = 1, G_SHIELD = 2;
  // Gestal stat ids, which are a third numbering again: 8 is C.RATE and 9 is C.DMG, both stored as
  // integers x100 of what the game displays.
  const G_CRATE = 8, G_CDMG = 9;
  // .hsf set ids, as ARTIFACT_SET_NAMES and SET_BONUSES key them. Both are `stack` sets completing
  // every 2 pieces: Critical Rate pays +12 C.RATE, Crit Damage +20 C.DMG.
  const CR_SET = 5, CD_SET = 6;

  // A Gestal artifact record: a Legendary 6★ +16 Weapon with a C.RATE 12 main and a C.DMG 30
  // substat, setless and unequipped.
  function piece(o = {}) {
    return {
      id: 1, slot: G_WEAPON, gearSetId: 0, factionId: null, rarityId: 5, rank: 6, level: 16,
      ascensionLevel: 0,
      mainStatId: G_CRATE, mainStatValue: 1200,
      substats: [{ statId: G_CDMG, value: 3000, glyphBonusValue: null, rolls: 2, isMythicalRoll: false }],
      ascensionStat: null, equippedOnHeroId: null, sellPrice: 0, isNew: false, isReworked: false,
      isAnomalous: false, ...o,
    };
  }

  // A Gestal champion record carrying the six stat fields gestalChampStats reads. The bonus shapes
  // are the ones a real capture shows (gestal-stats.test.mjs): HP/ATK/DEF flat or %, SPD flat, RES
  // and ACC flat, and both crits as FRACTIONS. Lore of Steel is off, which keeps the Masteries column
  // at zero and the set arithmetic below checkable by hand.
  function champion(o = {}) {
    return {
      heroId: 100, typeId: 1496, baseTypeId: 1490, grade: 6, level: 60, empowerLevel: 0,
      blessingId: null, factionId: 0, rarityId: 5, roleId: 0, name: "Elhain", awakenLevel: 0,
      baseStats: { hp: 15000, atk: 1000, def: 900, spd: 100, crate: 15, cdmg: 50, res: 30, acc: 0 },
      loreOfSteelMultiplier: 0,
      bonusesV2: { sets: [], mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
      ...o,
    };
  }

  const doc = (schemaVersion, payload) => ({ schemaVersion, payload });

  function snapshotOf({ artifacts = [], champions = [champion()] } = {}) {
    return {
      format: FORMAT, formatVersion: FORMAT_VERSION, capturedAt: "2026-10-03T12:05:00Z",
      gestalVersion: "0.8.15",
      documents: {
        artifacts: doc(2, { extractedAt: "2026-10-03T12:00:00Z", gameVersion: "11.75.0", artifacts }),
        champions: doc(2, { extractedAt: "2026-10-03T12:00:30Z", gameVersion: "11.75.0", champions }),
      },
    };
  }

  // A snapshot on disk, where the tool reads one. The .json.gz extension is load-bearing twice over:
  // the readers recognise a Gestal snapshot by it, and it is what .gitignore denies repo-wide.
  function snapshotFile(opts) {
    const path = join(tmp(), "2026-10-03-Gestal.json.gz");
    writeSnapshot(path, snapshotOf(opts));
    return path;
  }

  // Six pieces over three slots: three Critical Rate and three Crit Damage. TWO sets over THREE
  // slots is what gives the solver more than one plan to rank — each set can reach its useful count
  // of 2, so the plans are {}, {Critical Rate: 2} and {Crit Damage: 2} — which is what --top needs.
  // The three Critical Rate pieces are worn, so CURRENT is a real build and BEST has somewhere to go.
  const cdPiece = (id, slot) => piece({
    id, slot, gearSetId: CD_SET, mainStatId: G_CDMG, mainStatValue: 6000,
    substats: [{ statId: G_CRATE, value: 800, glyphBonusValue: null, rolls: 1, isMythicalRoll: false }],
  });
  const GEAR = [
    piece({ id: 1, slot: G_WEAPON, gearSetId: CR_SET, equippedOnHeroId: 100 }),
    piece({ id: 2, slot: G_HELMET, gearSetId: CR_SET, equippedOnHeroId: 100 }),
    piece({ id: 3, slot: G_SHIELD, gearSetId: CR_SET, equippedOnHeroId: 100 }),
    cdPiece(4, G_WEAPON), cdPiece(5, G_HELMET), cdPiece(6, G_SHIELD),
  ];

  // Two champions sharing a name substring and NOT a baseTypeId, so mainCopies keeps one of each and
  // a selector of "Elhain" is genuinely ambiguous.
  const TWO_CHAMPS = [champion(), champion({ heroId: 200, baseTypeId: 1491, name: "Dark Elhain" })];

  // --- solve: the arguments it refuses --------------------------------------------

  // The stat model needs each copy's base stats and its per-source bonus breakdown, and an RSL Helper
  // DB carries neither. Half-reading one would report a champion's power from base stats it had to
  // invent, which is a plausible wrong answer rather than a crash.
  test("solve refuses a non-Gestal snapshot, saying what it is missing", () => {
    const res = run(["Elhain", "x/y.db"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/power\.mjs needs a Gestal snapshot \(\.json\.gz\)/);
    expect(res.stderr).toMatch(/neither per-copy base stats nor the bonus breakdown/);
  });

  // The mode's OWN usage line, not all four: the answer to a missing argument is the one shape that
  // would have worked.
  test("solve without a selector exits 1 with solve's usage line", () => {
    const res = run([]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/usage: power\.mjs <name\|ID> \[snapshot\.json\.gz\]/);
    expect(res.stderr).not.toMatch(/power\.mjs fit/);
  });

  // A half-typed name costs one rerun rather than a scroll through a 500-champion roster. Same shape
  // as speed.mjs.
  test("solve names the near misses when the selector matches nothing", () => {
    const res = run(["Elhian", snapshotFile({ artifacts: GEAR })]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no champion matches "Elhian"/);
    expect(res.stderr).toMatch(/did you mean: Elhain\?/);
  });

  test("solve heads the report with the snapshot it read", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^# Power — snapshot 2026-10-03-Gestal\.json\.gz$/m);
  });
  ```
- [ ] 3. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the four new end-to-end tests fail. `power.mjs` has no `main()`, so a spawned run exits 0 having printed nothing: the first three see `status 0` where they expect 1, and the fourth sees empty stdout.
- [ ] 4. In `power.mjs`, extend the import block to everything the I/O half needs. The final import block is:
  ```javascript
  import { realpathSync } from "node:fs";
  import { join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
  import { STATS, statBreakdown } from "./champion-stats.mjs";
  import { isRealChamp, selectChamps, suggestNames } from "./champs.mjs";
  import { gestalChampRows, gestalChampStats, gestalItems, isGestalPath,
    readGestalSnapshot } from "./gestal.mjs";
  import { SET_BONUSES } from "./set-bonuses.mjs";
  import { isSnapshotArg, resolveSnapshot } from "./snapshots.mjs";
  ```
     (`statBreakdown` is unused until Task 13 and will be flagged by lint until then — see step 7.)
- [ ] 5. Append the I/O half to `power.mjs`, below every pure helper:
  ```javascript
  // --- CLI: I/O and formatting ------------------------------------------------
  // Below this line nothing is unit-tested: snapshot reads, the local files, layout and printing.

  // parsePowerArgs, resolveAccount and captureSnapshot all throw messages written for this audience,
  // so a mistyped flag or a Gestal folder that is not there gets the message and nothing else.
  // Everything past here keeps its stack trace, because anything else that throws is a bug.
  function die(e) {
    console.error(e.message);
    process.exit(1);
  }

  function usage(mode) {
    console.error(`usage: ${USAGE[mode]}`);
    process.exit(1);
  }

  // Gestal only. The stat model needs each copy's base stats and its per-source bonus breakdown, and
  // an RSL Helper DB carries neither — so there is nothing to build a champion's totals from, and
  // half-reading one would report a power computed from base stats it had to invent.
  function readGestalOrDie(dbArg) {
    const path = resolveSnapshot(dbArg);
    if (!isGestalPath(path)) {
      console.error("power.mjs needs a Gestal snapshot (.json.gz) — an RSL Helper DB has neither"
        + " per-copy base stats nor the bonus breakdown");
      process.exit(1);
    }
    return { path, snapshot: readGestalSnapshot(path) };
  }

  // Everything the snapshot-reading modes need, off ONE read. `items` is handed to gestalChampRows so
  // the wearer columns are built from the same item list the solver searches rather than from a second
  // decode of the same document.
  //
  // Rows go through isRealChamp, which drops the placeholder rows gestalChampRows appends for wearers
  // the roster has not listed yet. That is also what makes `statsById.get(row.ID)` total: every row
  // that survives came from the roster document, and so has a stat record.
  function accountState(snapshot) {
    const items = gestalItems(snapshot);
    return {
      items,
      rows: gestalChampRows(snapshot, items).filter(isRealChamp),
      statsById: gestalChampStats(snapshot),
    };
  }

  // Same shape as speed.mjs: the selector that found nothing, then the near misses, so a half-typed
  // name costs one rerun rather than a scroll through the roster.
  function noMatch(rows, selector) {
    console.error(`no champion matches "${selector}".`);
    const near = suggestNames(rows, selector);
    if (near.length) console.error(`did you mean: ${near.join(", ")}?`);
    process.exit(1);
  }

  function runSolve(args) {
    const { path, snapshot } = readGestalOrDie(args.dbArg);
    const { items, rows, statsById } = accountState(snapshot);
    const copies = mainCopies(rows, statsById, items, args.selector);
    if (!copies.length) return noMatch(rows, args.selector);
    console.log(`# Power — snapshot ${path.split(/[\\/]/).pop()}`);
  }

  function main() {
    let args;
    try {
      args = parsePowerArgs(process.argv.slice(2));
    } catch (e) {
      return die(e);
    }
    if (args.selector === null) return usage(args.mode);
    return runSolve(args);
  }

  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 54 passed.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Solve mode: the Gestal-only refusal, the missing selector and the no-match message"`
     Still lint-dirty on `slotName` and `statBreakdown`, both consumed by Tasks 13-14.

### Task 13: Solve mode — the CURRENT block, the constant, and the single-match rule for `--power`

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append the fixtures and tests for the constant and the weight source:
  ```javascript
  // --- solve: CURRENT, the weights and the constant --------------------------------

  // A reading log holding one record for copy #100, written where RSLH_POWER_DIR points. `totals` is
  // whatever was measured at the time, so it is deliberately NOT this snapshot's totals — the point of
  // a logged reading is that the constant it yields survives the gear change since.
  const READING = {
    t: "2026-10-02T09:00:00.000Z", heroId: 100, baseTypeId: 1490, name: "Elhain", roleId: 0,
    totals: { HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50 },
    power: 480000,
  };

  // A power directory holding whichever of the two files a test needs.
  function powerOut({ readings, weights } = {}) {
    const dir = tmp();
    if (readings) {
      writeFileSync(join(dir, "power-readings.jsonl"),
        readings.map((r) => `${JSON.stringify(r)}\n`).join(""));
    }
    if (weights) writeFileSync(join(dir, "power-weights.json"), JSON.stringify(weights, null, 2));
    return dir;
  }

  test("solve prints the stat breakdown in the game's Total Stats layout", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}CURRENT$/m);
    for (const label of ["Basic", "Artifacts", "Affinity", "Classic Arena", "Masteries",
      "Faction Guardians", "Empowerment", "Blessing", "Relic", "Total"]) {
      expect(res.stdout, label).toMatch(new RegExp(`^ {2}${label} `));
    }
  });

  // Elhain is in no BUILT_IN row, so every weight falls through to a role default — and the header has
  // to say so, because those are the parameters a `fit` would improve.
  test("solve names the weight source and the parameters that fell through to a default", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/weights role default/);
    expect(res.stdout).toMatch(/approximate: b, r, a, s, k/);
  });

  // A fitted row for this champion's baseTypeId outranks the built-in table and the role defaults,
  // per parameter, through weightsFor — so a calibrated champion must stop reading "approximate".
  test("solve prefers a fitted weights row and drops the approximate note", () => {
    const dir = powerOut({ weights: { 1490: { name: "Elhain", b: 0.0122, r: 0.277, a: 0.0387,
      s: 0.022, k: 0.00154, fittedAt: "2026-10-02T09:00:00.000Z", readings: 8 } } });
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/weights fitted/);
    expect(res.stdout).not.toMatch(/approximate:/);
  });

  // Without a constant there is no power to print at all: power is (lin + c)^2, so every absolute
  // number needs it.
  test("solve reports the constant as unknown when nothing supplies one", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/· {2}constant unknown$/m);
  });

  test("solve measures the constant from the copy's latest logged reading", () => {
    const dir = powerOut({ readings: [READING] });
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/constant -?[\d.]+ \(logged reading of 2026-10-02T09:00:00\.000Z\)/);
    expect(res.stdout).toMatch(/^ {4}\d+ power$/m);
  });

  // --power is this copy's power RIGHT NOW, read off the screen, so it beats a reading logged against
  // whatever gear the copy had on at the time.
  test("solve lets --power override a logged reading", () => {
    const dir = powerOut({ readings: [READING] });
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--power", "412000"],
      { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/constant -?[\d.]+ \(--power\)/);
    expect(res.stdout).not.toMatch(/logged reading/);
  });

  // One in-game power value belongs to ONE copy. Measuring a constant for several from it would make
  // every power printed afterwards wrong by that amount, with nothing saying so.
  test("solve refuses --power when the selector matches more than one champion", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR, champions: TWO_CHAMPS }),
      "--power", "412000"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--power is one champion's in-game reading/);
    expect(res.stderr).toMatch(/Elhain #100/);
    expect(res.stderr).toMatch(/Dark Elhain #200/);
  });

  // Without --power the same selector is fine: two champions means two reports.
  test("solve reports every main copy a selector matches", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR, champions: TWO_CHAMPS })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^Elhain #100 /m);
    expect(res.stdout).toMatch(/^Dark Elhain #200 /m);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all nine new tests fail — `runSolve` currently prints the header and stops, so stdout has no CURRENT block, no weight source and no constant, and `--power` is not checked.
- [ ] 3. In `power.mjs`, add the two model imports to the import block:
  ```javascript
  import { constantFrom, lin, weightsFor } from "./power-model.mjs";
  import { buildTotals } from "./power-solve.mjs";
  ```
     and add `existsSync, readFileSync` to the `node:fs` import so it reads `import { existsSync, readFileSync, realpathSync } from "node:fs";`.
- [ ] 4. Add the two local-file readers below `accountState`:
  ```javascript
  // The reading log, one record per line. A missing file is an empty log, which is the state before
  // the first `log`. A line that does not parse is a corrupted log, and skipping it silently would
  // make a fit quietly narrower than the reader believes — so it is named, by its real line number.
  function readReadings(path) {
    if (!existsSync(path)) return [];
    const out = [];
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;   // a trailing newline is normal
      try {
        out.push(JSON.parse(line));
      } catch {
        console.error(`${path}: line ${i + 1} is not JSON — the reading log is corrupted`);
        process.exit(1);
      }
    }
    return out;
  }

  // The fitted weights, or an empty table. A missing file is the state before the first `fit`; a file
  // that does not parse is NOT, and falling back to the built-in weights for it would print
  // "built-in" on a champion the reader has already calibrated, which reads like the fit never ran.
  function readWeights(path) {
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      console.error(`${path} is not readable JSON (${e.message}) — fix or remove it`);
      process.exit(1);
    }
  }

  // Listed with their ids, because an id is the selector that picks exactly one copy. `why` names
  // what the ambiguity would break, which differs between the two callers.
  function tooManyCopies(copies, why) {
    console.error(`${why}, but ${copies.length} champions matched:`);
    for (const row of copies) console.error(`  ${row.Name} #${row.ID}`);
    console.error("name one by its id to pick exactly one copy.");
    process.exit(1);
  }
  ```
- [ ] 5. Replace `runSolve` with the version that prints the per-copy header and CURRENT block:
  ```javascript
  // The copy's own constant, and where it came from. Both sources go through constantFrom on the
  // totals the power was observed WITH, which is what makes the result a property of the COPY rather
  // than of the gear it had on at the time — power-model measured `c` unchanged across every gear
  // change, so a reading logged weeks ago still describes it.
  function resolveConstant(args, weights, currentTotals, readings, heroId) {
    if (args.power !== null) {
      return { c: constantFrom(currentTotals, weights, args.power), source: "--power" };
    }
    const latest = latestReading(readings, heroId);
    if (latest) {
      return { c: constantFrom(latest.totals, weights, latest.power),
        source: `logged reading of ${latest.t}` };
    }
    return { c: null, source: "none" };
  }

  function printCopy(row, { items, rows, statsById, fitted, readings, args }) {
    const champStats = statsById.get(row.ID);
    const { weights, source, fromDefaults } = weightsFor(
      { baseTypeId: row.BaseHeroID, roleId: row.Role }, fitted);
    const current = items.filter((it) => it.equippedChampId === row.ID);
    // UNROUNDED, because this is what the objective, the constant and a logged reading are all
    // evaluated on. The rounded screen totals are printed just below, and are a different number by
    // at most 1 per stat.
    const currentTotals = buildTotals(champStats, current);
    const currentLin = lin(currentTotals, weights);
    const { c, source: cSource } = resolveConstant(args, weights, currentTotals, readings, row.ID);

    console.log(`\n${row.Name} #${row.ID}  ${row.Rang}★ +${row.Lvl}`
      + `  ·  weights ${source}`
      + `${fromDefaults.length ? ` (approximate: ${fromDefaults.join(", ")})` : ""}`
      + `  ·  constant ${c === null ? "unknown" : `${c.toFixed(2)} (${cSource})`}`);

    console.log("  CURRENT");
    console.log(formatBreakdown(statBreakdown(champStats, current)));
    if (c !== null) console.log(`    ${Math.round((currentLin + c) ** 2)} power`);
    void rows;
  }

  function runSolve(args) {
    const { path, snapshot } = readGestalOrDie(args.dbArg);
    const { items, rows, statsById } = accountState(snapshot);
    const copies = mainCopies(rows, statsById, items, args.selector);
    if (!copies.length) return noMatch(rows, args.selector);
    if (args.power !== null && copies.length !== 1) {
      return tooManyCopies(copies, "--power is one champion's in-game reading");
    }
    const fitted = readWeights(weightsPath());
    const readings = readReadings(readingsPath());
    console.log(`# Power — snapshot ${path.split(/[\\/]/).pop()}`);
    for (const row of copies) printCopy(row, { items, rows, statsById, fitted, readings, args });
  }
  ```
     The `void rows;` line is a placeholder for Task 14, which needs `rows` to build the wearer map; it keeps this intermediate state lint-clean and is deleted there.
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 63 passed.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Solve mode: the CURRENT block, the weight source and the per-copy constant"`

### Task 14: Solve mode — the BEST block and the certificate

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append:
  ```javascript
  // --- solve: BEST -----------------------------------------------------------------

  // One line per slot, named the way the game names them — the slot, the set, the level and the id —
  // plus `on <champion>` for a piece that would have to come off someone. The solver's pool is the
  // whole vault, worn gear included, so that last part is what decides whether the build is
  // actionable.
  test("solve prints BEST slot by slot, with its sets and totals", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}BEST /m);
    // Three slots, which are our 1 Helmet, 5 Weapon and 6 Shield — Gestal's 1, 0 and 2.
    expect(res.stdout).toMatch(/^ {4}Helmet {2}/m);
    expect(res.stdout).toMatch(/^ {4}Weapon {2}/m);
    expect(res.stdout).toMatch(/^ {4}Shield {2}/m);
    expect(res.stdout).toMatch(/^ {4}sets: (Critical Rate|Crit Damage) x3$/m);
    expect(res.stdout).toMatch(/^ {4}totals: HP \d+ {2}ATK \d+ {2}DEF \d+ {2}SPD \d+ {2}C\.RATE /m);
  });

  // Nothing in this fixture is on another champion except the three pieces already on Elhain, and a
  // piece already on the copy being solved for costs nothing to fit. The line is printed anyway,
  // `none` included: silence would be indistinguishable from a report that does not check.
  test("solve prints the borrowed-pieces line even when nothing is borrowed", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {4}on other champions: none$/m);
  });

  // A piece on someone else has to be named twice over: beside its own line, and once for the build.
  test("solve names the champion a borrowed piece would come off", () => {
    const champions = [champion(), champion({ heroId: 200, baseTypeId: 1491, name: "Kael" })];
    // Give Kael the three Crit Damage pieces, so whichever build BEST picks borrows from someone.
    const artifacts = GEAR.map((p) => (p.gearSetId === CD_SET ? { ...p, equippedOnHeroId: 200 } : p));
    const res = run(["Elhain", snapshotFile({ artifacts, champions })]);
    expect(res.status, res.stderr).toBe(0);
    // Either BEST keeps Elhain's own Critical Rate three (nothing borrowed) or it takes Kael's three.
    expect(res.stdout).toMatch(/on other champions: (none|3 of 3 — Kael x3)/);
  });

  // What the solver PROVED, as against what it found. A fixed point of the linearize-and-resolve map
  // is not an optimum, so the headline number is the proven CEILING on what is left on the table.
  test("solve closes each build with the certificate line", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout)
      .toMatch(/^ {4}at most -?[\d.]+ √power \([\d.]+%\) below the true maximum {3}\[\d+ rounds?, (converged|no fixed point)\]$/m);
  });

  // With a constant the whole report switches to power, the number the game shows — the certificate
  // line included, so it can be compared with the power printed above it.
  test("solve states the certificate in power once the constant is known", () => {
    const dir = powerOut({ readings: [READING] });
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {4}at most -?\d+ power \([\d.]+%\) below the true maximum/m);
    expect(res.stdout).toMatch(/^ {2}BEST {2}\d+ power {2}\(\+-?\d+ over current\)$/m);
  });

  // Without one, the gain is a ratio marked `≈` and said to be missing a constant, rather than a
  // power number computed from a constant that is not there.
  test("solve reports the gain as a marked percentage when the constant is unknown", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout)
      .toMatch(/^ {2}BEST {2}≈ \+[\d.]+% \(per-copy constant unknown: log a reading or pass --power\)$/m);
  });

  // A champion wearing nothing is a real state, and solvePower seeds the worn gear as round 0, so an
  // empty vault still produces one build rather than no report at all.
  test("solve still reports a champion with no gear and an empty vault", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: [] })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}CURRENT$/m);
    expect(res.stdout).toMatch(/^ {2}BEST /m);
    expect(res.stdout).toMatch(/below the true maximum/);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all seven new tests fail — `printCopy` stops after the CURRENT block, so there is no BEST and no certificate.
- [ ] 3. In `power.mjs`, add `solvePower` to the `power-solve.mjs` import so it reads:
  ```javascript
  import { buildTotals, solvePower } from "./power-solve.mjs";
  ```
     and add the two wearer helpers and `setCounts`:
  ```javascript
  import { SET_BONUSES, setCounts } from "./set-bonuses.mjs";
  ```
  ```javascript
  import { describeWearers, otherWearers } from "./wearers.mjs";
  ```
- [ ] 4. Add `printBuild` directly above `printCopy`:
  ```javascript
  // One build: its gear slot by slot, the sets it completes, the pieces it would have to take off
  // someone, and its totals.
  //
  // The sets line is computed from the ITEMS rather than read off the build, because solvePower
  // returns no counts — and computing it here is the honest version anyway: a free pick carries an
  // item that belongs to some set and can complete one by accident, which has to count.
  function printBuild(build, wearers) {
    for (const it of [...build.items].sort((a, b) => a.slot - b.slot)) {
      const on = wearers.get(it.id);
      console.log(`    ${slotName(it.slot).padEnd(7)} ${setLabel(it.set).padEnd(14)}`
        + ` +${String(it.level).padStart(2)}   #${it.id}${on ? `   on ${on}` : ""}`);
    }
    console.log(`    sets: ${formatSets(setCounts(build.items))}`);
    console.log(`    on other champions: ${describeWearers(build.items, wearers)}`);
    console.log(formatTotals(build.totals));
  }
  ```
- [ ] 5. In `printCopy`, delete the `void rows;` line and append the BEST block after the CURRENT block:
  ```javascript
    const result = solvePower({ items, faction: row.Fraction, champStats, current, weights,
      top: args.top });
    // builds[0] always exists: solvePower records the worn gear as round 0 before it iterates.
    const [best] = result.builds;
    // One wearer map per copy, shared by every build printed for it, because --top draws them all
    // from the same vault-wide pool.
    const wearers = otherWearers(items, row.ID, rows);
    console.log(`\n${formatGain(currentLin, best.lin, c)}`);
    printBuild(best, wearers);
    console.log(formatCertificate(result, best.lin, c));
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 70 passed.
- [ ] 7. Lint, now that every label and import is consumed: `npm run lint`
     Expected: no errors.
- [ ] 8. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Solve mode: the BEST build, its sets and wearers, and the certificate line"`

### Task 15: Solve mode — the `--top` blocks

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append:
  ```javascript
  // --- solve: --top ----------------------------------------------------------------

  // Two sets over three slots gives the solver more than one plan to rank: {}, {Critical Rate: 2} and
  // {Crit Damage: 2} all reach a different set of items. A runner-up that costs little power but
  // frees three pieces of a set is visible rather than discarded.
  //
  // These are the best DISTINCT SETS OF ITEMS the iteration saw, not a proved top-N — power-solve is
  // explicit about that and neither is this report.
  test("--top 2 adds a numbered runner-up block measured against BEST", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--top", "2"]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}#2 {2}\(-?[\d.]+ √power off BEST\)$/m);
    // The runner-up gets the same per-build detail as BEST, so it can be acted on directly.
    expect(res.stdout.match(/^ {4}sets: /gm)).toHaveLength(2);
  });

  // The runner-up's distance has to be in the SAME unit as the certificate line, or the two numbers
  // on one report cannot be compared.
  test("--top states the runner-up's distance in power once the constant is known", () => {
    const dir = powerOut({ readings: [READING] });
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR }), "--top", "2"], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}#2 {2}\(-?\d+ power off BEST\)$/m);
  });

  // The default is one build, so an ordinary run is not made longer by a feature it did not ask for.
  test("solve prints only BEST without --top", () => {
    const res = run(["Elhain", snapshotFile({ artifacts: GEAR })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).not.toMatch(/off BEST/);
    expect(res.stdout.match(/^ {4}sets: /gm)).toHaveLength(1);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: the first two fail — `printCopy` prints only `builds[0]`, so there is no `#2` block. The third passes already.
- [ ] 3. In `printCopy`, change `const [best] = result.builds;` to destructure the rest, and append the runner-up loop after the certificate line:
  ```javascript
    const [best, ...rest] = result.builds;
  ```
  ```javascript
    // The runners-up, each measured against BEST rather than against current: BEST is what a reader
    // compares them with when deciding whether one is worth its lower power.
    rest.forEach((build, i) => {
      console.log(`\n${formatOffBest(i + 2, build, best, c)}`);
      printBuild(build, wearers);
    });
  ```
- [ ] 4. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 73 passed.
     If `#2` does not appear, the fixture reached only one distinct build: confirm `GEAR` has three pieces of each of the two sets across three distinct Gestal slots (0, 1, 2), since a set needs two slots to reach its useful count of 2 and the plans are what produce distinct builds.
- [ ] 5. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Solve mode: --top prints the runners-up with their distance from BEST"`

---

## Chunk 4 — Verify, log and fit

### Task 16: Verify mode — the set table against the game's own set bonuses

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append:
  ```javascript
  // --- verify ----------------------------------------------------------------------
  //
  // The set table is GAME DATA and will drift on a patch. verify is the guard: it diffs the table
  // against the game's OWN per-champion set bonus, which Gestal captures as bonusesV2.sets.
  //
  // Two worn Critical Rate pieces are one 2-piece completion, +12 C.RATE. Gestal reports a relative
  // C.RATE under statKindId 7 as the FRACTION 0.12, which the adapter scales to the 12 points the
  // screen shows. Lore of Steel is off in the fixture, and the table is multiplier-free, so the two
  // numbers have to agree exactly.
  const WORN_PAIR = [
    piece({ id: 1, slot: G_WEAPON, gearSetId: CR_SET, equippedOnHeroId: 100 }),
    piece({ id: 2, slot: G_HELMET, gearSetId: CR_SET, equippedOnHeroId: 100 }),
  ];
  const critRateSets = (value) => ({
    bonusesV2: { sets: [{ statKindId: 7, isAbsolute: false, value }],
      mastery: [], blessing: [], relic: [], empower: [], factionGuardian: [] },
  });

  test("verify reports every geared champion matching and exits 0", () => {
    const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.12))] });
    const res = run(["verify", snap]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout)
      .toMatch(/^set table matches the game's set bonuses for 1 of 1 geared champions$/m);
  });

  // The whole point of the check: a disagreement is named, with the champion, the sets it is wearing
  // and both numbers, and the exit code makes it a failure rather than a note.
  test("verify names a mismatching champion and exits 1", () => {
    const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.2))] });
    const res = run(["verify", snap]);
    expect(res.status).toBe(1);
    expect(res.stdout)
      .toMatch(/^set table matches the game's set bonuses for 0 of 1 geared champions$/m);
    expect(res.stdout).toMatch(/Elhain #100 {2}Critical Rate x2/);
    expect(res.stdout).toMatch(/^ {4}C\.RATE: table 12 vs game 20$/m);
  });

  // A champion wearing nothing has no set bonus to check, and counting it as a match would inflate
  // the denominator with champions the check never looked at.
  test("verify counts only the champions wearing something", () => {
    const champions = [champion(critRateSets(0.12)),
      champion({ heroId: 200, baseTypeId: 1491, name: "Kael" })];
    const res = run(["verify", snapshotFile({ artifacts: WORN_PAIR, champions })]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/for 1 of 1 geared champions/);
  });

  test("verify refuses a non-Gestal snapshot, as solve does", () => {
    const res = run(["verify", "x/y.db"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/power\.mjs needs a Gestal snapshot/);
  });

  // verify takes no selector, so it must not be caught by the missing-selector check that solve, log
  // and fit share.
  test("verify runs without a selector", () => {
    const snap = snapshotFile({ artifacts: WORN_PAIR, champions: [champion(critRateSets(0.12))] });
    const res = run(["verify", snap]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).not.toMatch(/usage:/);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all five new tests fail. `main()` has no verify branch, so `verify <snap>` has `selector: null` and exits 1 with solve's usage line.
- [ ] 3. In `power.mjs`, add `diffSetBonuses` to the `set-bonuses.mjs` import so it reads:
  ```javascript
  import { SET_BONUSES, diffSetBonuses, setCounts } from "./set-bonuses.mjs";
  ```
- [ ] 4. Add `runVerify` below `runSolve`:
  ```javascript
  // The set table against the game's own per-champion set bonus. set-bonuses.mjs is transcribed from
  // Gestal's catalogue and is GAME DATA, so it will drift on a patch; this is the guard, and the
  // header comment there names it as such.
  //
  // Checked against bonusesV2.sets, which is what the champion screen shows. The table is
  // multiplier-free and so is that field — Lore of Steel shows under Masteries rather than inside the
  // set bonus — so no multiplier is applied on either side here.
  function runVerify(args) {
    const { path, snapshot } = readGestalOrDie(args.dbArg);
    const { items, rows, statsById } = accountState(snapshot);
    const mismatches = [];
    let geared = 0;
    for (const row of rows) {
      const worn = items.filter((it) => it.equippedChampId === row.ID);
      // A champion wearing nothing has no set bonus to check, and counting it as a match would
      // inflate the denominator with champions the check never looked at.
      if (!worn.length) continue;
      geared++;
      const counts = setCounts(worn);
      const diff = diffSetBonuses(counts, statsById.get(row.ID).observedSets);
      if (diff.length) mismatches.push({ row, counts, diff });
    }
    console.log(`# Power verify — snapshot ${path.split(/[\\/]/).pop()}`);
    console.log(`set table matches the game's set bonuses for ${geared - mismatches.length}`
      + ` of ${geared} geared champions`);
    for (const { row, counts, diff } of mismatches) {
      // ALL the sets, not only the stat-granting ones: a set that GAINED a stat in a patch is exactly
      // this case, and it sits in NO_STAT_SETS until the table is updated.
      console.log(`\n  ${row.Name} #${row.ID}  ${formatSets(counts, true)}`);
      for (const d of diff) console.log(`    ${d.key}: table ${d.table} vs game ${d.observed}`);
    }
    // A mismatch is a failure, not a note: this runs to find out whether the table can still be
    // trusted, and exiting 0 on a disagreement would let a patch pass unnoticed in a script.
    if (mismatches.length) process.exit(1);
  }
  ```
- [ ] 5. In `main()`, add the verify branch and narrow the selector check. `main()` becomes:
  ```javascript
  function main() {
    let args;
    try {
      args = parsePowerArgs(process.argv.slice(2));
    } catch (e) {
      return die(e);
    }
    // verify reads the whole roster and takes no selector, so it is dispatched before the check the
    // other three share.
    if (args.mode === "verify") return runVerify(args);
    if (args.selector === null) return usage(args.mode);
    return runSolve(args);
  }
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 78 passed.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Verify mode: the set table against the game's own per-champion set bonuses"`

### Task 17: Log mode — record a reading against Gestal's live stats

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Append:
  ```javascript
  // --- log -------------------------------------------------------------------------
  //
  // log reads Gestal's LIVE documents rather than a snapshot, deliberately: the log line it writes is
  // itself the frozen record, so freezing a snapshot first would only add a file nobody reads. The
  // fixture is a Gestal data folder laid out as the app writes one.

  function gestalRoot({ artifacts = [], champions = [champion()] } = {}) {
    const root = tmp();
    const acct = join(root, "accounts", "abc123");
    mkdirSync(join(acct, "diagnostics"), { recursive: true });
    const put = (rel, body) => writeFileSync(join(acct, rel), JSON.stringify(body));
    writeFileSync(join(root, "active.json"),
      JSON.stringify(doc(1, { activeAccountKey: "abc123" })));
    put("artifacts.json",
      doc(2, { extractedAt: "2026-10-03T12:00:00Z", gameVersion: "11.75.0", artifacts }));
    put("champions.json",
      doc(2, { extractedAt: "2026-10-03T12:00:30Z", gameVersion: "11.75.0", champions }));
    put("metadata.json", doc(2, { displayName: "Player One", raidPlayerId: "123456789" }));
    put("diagnostics/last-extraction.json", doc(1, { attemptedAt: "2026-10-03T12:04:00Z",
      succeeded: true, errorMessage: null, elapsedMilliseconds: 1000, gameVersion: "11.75.0" }));
    return root;
  }

  const readLog = (dir) => readFileSync(join(dir, "power-readings.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

  test("log appends one reading with the copy's totals and the power given", () => {
    const dir = tmp();
    const res = run(["log", "Elhain", "12345"],
      { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR }) });
    expect(res.status, res.stderr).toBe(0);
    const log = readLog(dir);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ heroId: 100, baseTypeId: 1490, name: "Elhain", roleId: 0,
      power: 12345 });
    expect(Object.keys(log[0].totals).sort())
      .toEqual(["ACC", "ATK", "C.DMG", "C.RATE", "DEF", "HP", "RES", "SPD"]);
    expect(log[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // The log is append-only: a second reading of the same copy is another equation for the fit, not a
  // replacement for the first.
  test("log appends rather than replacing", () => {
    const dir = tmp();
    const root = gestalRoot({ artifacts: GEAR });
    expect(run(["log", "Elhain", "12345"], { powerDir: dir, dataRoot: root }).status).toBe(0);
    expect(run(["log", "Elhain", "12999"], { powerDir: dir, dataRoot: root }).status).toBe(0);
    expect(readLog(dir).map((r) => r.power)).toEqual([12345, 12999]);
  });

  // So the reader can compare it with the screen the power was read off, which is the only check that
  // the reading and the stat model are describing the same copy.
  test("log prints the copy's stat breakdown in the game layout", () => {
    const res = run(["log", "Elhain", "12345"], { dataRoot: gestalRoot({ artifacts: GEAR }) });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/^ {2}Basic /m);
    expect(res.stdout).toMatch(/^ {2}Total /m);
  });

  // A reading landing on the wrong champion is the one failure that cannot be undone by rerunning:
  // it silently poisons that champion's fit. So an ambiguous selector writes NOTHING.
  test("log refuses an ambiguous selector and writes nothing", () => {
    const dir = tmp();
    const res = run(["log", "Elhain", "12345"],
      { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR, champions: TWO_CHAMPS }) });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/a logged reading belongs to one copy/);
    expect(res.stderr).toMatch(/Elhain #100/);
    expect(res.stderr).toMatch(/Dark Elhain #200/);
    expect(existsSync(join(dir, "power-readings.jsonl"))).toBe(false);
  });

  test("log without its power exits 1 with log's usage line and writes nothing", () => {
    const dir = tmp();
    const res = run(["log", "Elhain"],
      { powerDir: dir, dataRoot: gestalRoot({ artifacts: GEAR }) });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/usage: power\.mjs log <name\|ID> <in-game power>/);
    expect(existsSync(join(dir, "power-readings.jsonl"))).toBe(false);
  });

  test("log without a selector exits 1 with log's usage line", () => {
    const res = run(["log"], { dataRoot: gestalRoot() });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/usage: power\.mjs log <name\|ID> <in-game power>/);
  });

  // Gestal refreshes its documents only while attached to a running Raid, so data this old means the
  // stats may not be the ones on the screen. A WARNING, not a refusal: the reader is looking at the
  // screen and can tell.
  test("log warns that the live data is stale rather than refusing it", () => {
    const res = run(["log", "Elhain", "12345"], { dataRoot: gestalRoot({ artifacts: GEAR }) });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/warning: the data is .* old/);
  });

  // resolveAccount's own message, which names what to do about it.
  test("log exits 1 with Gestal's own message when there is no data folder", () => {
    const res = run(["log", "Elhain", "12345"], { dataRoot: join(tmp(), "nothing-here") });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Gestal data folder not found/);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all eight new tests fail. `main()` has no log branch, so `log Elhain 12345` falls through to `runSolve`, which resolves a snapshot out of `oracle/resources/` and fails or reports the wrong thing.
- [ ] 3. In `power.mjs`, add `appendFileSync, mkdirSync` to the `node:fs` import so it reads `import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";`, and add the capture import:
  ```javascript
  import { captureSnapshot, dataRoot, freshnessWarnings, resolveAccount } from "./refresh-gestal.mjs";
  ```
- [ ] 4. Add `runLog` below `runVerify`:
  ```javascript
  // Record one in-game power reading against the copy's stats as they are RIGHT NOW.
  //
  // THE LIVE FOLDER IS READ HERE DELIBERATELY, against the snapshots-only convention every other mode
  // follows: the log line this writes is itself the frozen record, so freezing a snapshot first would
  // add a file nobody reads and a chance for the two to disagree. Nothing is written to
  // oracle/resources/ — the capture is built in memory and dropped.
  function runLog(args) {
    let captured;
    try {
      captured = captureSnapshot(resolveAccount(dataRoot(), null));
    } catch (e) {
      return die(e);
    }
    // `captured.items` is a COUNT, not a list, so the state comes off the snapshot itself.
    const { snapshot } = captured;
    // A warning, not a refusal: Gestal refreshes its documents only while attached to a running Raid,
    // and the reader is looking at the screen and can tell whether it matches.
    for (const w of freshnessWarnings(snapshot)) console.warn(`  warning: ${w}`);

    const { items, rows, statsById } = accountState(snapshot);
    const copies = mainCopies(rows, statsById, items, args.selector);
    if (!copies.length) return noMatch(rows, args.selector);
    // A reading landing on the wrong champion cannot be undone by rerunning — it silently poisons
    // that champion's fit — so an ambiguous selector writes nothing at all.
    if (copies.length !== 1) {
      return tooManyCopies(copies, "a logged reading belongs to one copy");
    }
    const [row] = copies;
    const champStats = statsById.get(row.ID);
    const current = items.filter((it) => it.equippedChampId === row.ID);

    console.log(`${row.Name} #${row.ID}  ${row.Rang}★ +${row.Lvl}  ·  power ${args.logPower}`);
    // The game's layout, so the reader can compare it with the screen the power was read off. That
    // comparison is the only check that the reading and the stat model describe the same copy.
    console.log(formatBreakdown(statBreakdown(champStats, current)));

    const record = {
      t: new Date().toISOString(),
      heroId: row.ID,
      baseTypeId: row.BaseHeroID,
      name: row.Name,
      roleId: row.Role,
      // UNROUNDED, matching what power-solve scores builds on and what the constant is measured
      // against. The rounded screen totals are what was printed above; the difference is at most 1
      // per stat, and recording the rounded ones would make the fit and the solver disagree slightly
      // about what the same build is worth.
      totals: buildTotals(champStats, current),
      power: args.logPower,
    };
    mkdirSync(powerDir(), { recursive: true });
    appendFileSync(readingsPath(), `${JSON.stringify(record)}\n`);
    console.log(`\nlogged to ${readingsPath()}`);
  }
  ```
- [ ] 5. In `main()`, add the log branches. The body after the verify branch becomes:
  ```javascript
    if (args.selector === null) return usage(args.mode);
    if (args.mode === "log") {
      if (args.logPower === null) return usage("log");
      return runLog(args);
    }
    return runSolve(args);
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 86 passed.
- [ ] 7. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Log mode: record an in-game power reading against Gestal's live stats"`

### Task 18: Fit mode — calibrate a champion's weights from its logged readings

**Files:**

- Test: `oracle/analytics/__tests__/power-cli.test.mjs`
- Modify: `oracle/analytics/power.mjs`

**Steps:**

- [ ] 1. Add `import { power as powerOf } from "../power-model.mjs";` to the test file's imports and append:
  ```javascript
  // --- fit -------------------------------------------------------------------------
  //
  // The readings are generated FROM the formula, so a fit that recovers W is recovering what produced
  // the numbers rather than agreeing with itself. baseTypeId 999001 is in no BUILT_IN row, so every
  // prior is a role default. Same construction as power-fit.test.mjs.
  const FIT_BASE = 999001;
  const W = { b: 0.0131, r: 0.2641, a: 0.0412, s: 0.0193, k: 0.00168 };
  const C11 = 37.5;

  const fitTotals = (o = {}) => ({
    HP: 30000, ATK: 2000, DEF: 1500, SPD: 200, "C.RATE": 60, "C.DMG": 150, RES: 100, ACC: 50, ...o });

  // A baseline plus one single-stat step per design column, which is what leaves all five centered
  // columns independent. X_B and X_K each get two steps, one from each stat that feeds them.
  const FIT_STEPS = [{}, { HP: 36000 }, { ATK: 2600 }, { RES: 160 }, { ACC: 90 }, { SPD: 240 },
    { "C.RATE": 85 }, { "C.DMG": 220 }];

  const fitReadings = ({ name = "Synthetic", baseTypeId = FIT_BASE, heroId = 11 } = {}) =>
    FIT_STEPS.map((step, i) => {
      const totals = fitTotals(step);
      return { t: new Date(Date.UTC(2026, 9, 3, 0, 0, i)).toISOString(),
        heroId, baseTypeId, name, roleId: 0, totals, power: powerOf(totals, W, C11) };
    });

  // Relative, not absolute: these weights span 0.0017 to 0.26, so one absolute tolerance cannot mean
  // the same thing for all five.
  const close = (got, want) => Math.abs(got / want - 1);
  const readFitted = (dir) => JSON.parse(readFileSync(join(dir, "power-weights.json"), "utf8"));

  test("fit recovers the weights that generated the readings and writes them", () => {
    const dir = powerOut({ readings: fitReadings() });
    const res = run(["fit", "Synthetic"], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    const row = readFitted(dir)[FIT_BASE];
    for (const name of ["b", "r", "a", "s", "k"]) {
      expect(close(row[name], W[name]), `${name} = ${row[name]}`).toBeLessThan(0.01);
    }
    expect(row).toMatchObject({ name: "Synthetic", readings: 8 });
    expect(row.fittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // The file holds one row per champion. A fit of one champion must not drop the others, or
  // calibrating a second champion would quietly un-calibrate the first.
  test("fit keeps an existing entry for another champion", () => {
    const dir = powerOut({ readings: fitReadings(),
      weights: { 7090: { name: "Ultimate Deathknight", b: 0.01936, r: 0.187, a: 0.03483,
        s: 0.0038, k: 0.001245, fittedAt: "2026-10-01T09:00:00.000Z", readings: 12 } } });
    const res = run(["fit", "Synthetic"], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    const fitted = readFitted(dir);
    expect(Object.keys(fitted).sort()).toEqual(["7090", String(FIT_BASE)]);
    expect(fitted[7090].name).toBe("Ultimate Deathknight");
  });

  test("fit prints the per-copy constants and a residual table", () => {
    const dir = powerOut({ readings: fitReadings() });
    const res = run(["fit", "Synthetic"], { powerDir: dir });
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/per-copy constants:/);
    expect(res.stdout).toMatch(/#11 {2}37\.5/);
    expect(res.stdout).toMatch(/residuals:/);
    // Eight readings, generated from the formula, so every residual is ~0%.
    expect(res.stdout.match(/^ {4}#11 /gm)).toHaveLength(9);   // one constant line + eight residuals
  });

  // The weights are per champion. Fitting two together would average them into something that
  // describes neither, and nothing downstream could tell that had happened.
  test("fit refuses a selector matching two champions, naming both", () => {
    const dir = powerOut({ readings: [
      ...fitReadings({ name: "Synthetic A", baseTypeId: 999001, heroId: 11 }),
      ...fitReadings({ name: "Synthetic B", baseTypeId: 999002, heroId: 22 }),
    ] });
    const res = run(["fit", "Synthetic"], { powerDir: dir });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/matches 2 champions in the reading log/);
    expect(res.stderr).toMatch(/Synthetic A \(baseTypeId 999001\)/);
    expect(res.stderr).toMatch(/Synthetic B \(baseTypeId 999002\)/);
    expect(existsSync(join(dir, "power-weights.json"))).toBe(false);
  });

  // An empty log is the state before the first `log`, and the message has to point at the file so the
  // reader can tell "nothing logged yet" from "logged under another name".
  test("fit exits 1 when no reading matches, naming the log it looked in", () => {
    const dir = powerOut({ readings: fitReadings() });
    const res = run(["fit", "Nobody"], { powerDir: dir });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no logged readings match "Nobody"/);
    expect(res.stderr).toMatch(/power-readings\.jsonl/);
  });

  test("fit exits 1 when there is no reading log at all", () => {
    const res = run(["fit", "Elhain"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/no logged readings match "Elhain"/);
  });

  // fitWeights' own message. Below copies + varying columns the system has fewer equations than
  // unknowns, and the answer would be arbitrary rather than wrong by a little.
  test("fit passes fitWeights' refusal through when there are too few readings", () => {
    const dir = powerOut({ readings: fitReadings().slice(0, 3) });
    const res = run(["fit", "Synthetic"], { powerDir: dir });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/power-fit: too few readings/);
    expect(existsSync(join(dir, "power-weights.json"))).toBe(false);
  });

  test("fit without a selector exits 1 with fit's usage line", () => {
    const res = run(["fit"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/usage: power\.mjs fit <name\|ID>/);
  });
  ```
- [ ] 2. Run to verify RED: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: all eight new tests fail. `main()` has no fit branch, so `fit Synthetic` falls through to `runSolve` and tries to resolve a snapshot.
- [ ] 3. In `power.mjs`, add `writeFileSync` to the `node:fs` import (`import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";`) and add:
  ```javascript
  import { fitWeights } from "./power-fit.mjs";
  ```
- [ ] 4. Add the fit printer and the merge below `runLog`:
  ```javascript
  // The five parameters in the order power-model resolves them.
  const PARAMS = ["b", "r", "a", "s", "k"];

  function printFit(readings, fit) {
    const copies = new Set(readings.map((r) => r.heroId));
    console.log(`# Power fit — ${readings[0].name}`
      + `  ·  ${readings.length} readings over ${copies.size}`
      + ` cop${copies.size === 1 ? "y" : "ies"}`);
    for (const name of PARAMS) {
      const value = fit.params[name];
      // A null parameter is one the readings cannot determine. A zero or negative one is a stat the
      // fit barely saw — no weight measured so far is anything but positive, and a negative one would
      // break the solvers. Both are reported as IGNORED rather than as a result, because weightsFor's
      // own test is `> 0` and it will fall through to the built-in or role default for them: the value
      // the solver actually uses is NOT the one on this line.
      const note = value === null ? "   undetermined — weightsFor falls back for it"
        : value <= 0 ? "   ignored, not positive — weightsFor falls back for it"
        : "";
      console.log(`  ${name}  ${value === null ? "—" : value.toPrecision(4)}${note}`);
    }
    // Each copy's own constant, which is what the centering removed and step 6 of the fit put back.
    console.log("  per-copy constants:");
    for (const [heroId, c] of fit.constants) console.log(`    #${heroId}  ${c.toFixed(2)}`);
    // The fit's own error, per reading, so a single bad reading is visible rather than spread across
    // five weights.
    console.log("  residuals:");
    console.log(`    ${"copy".padEnd(10)}${"power".padStart(12)}${"predicted".padStart(12)}`
      + `${"error".padStart(9)}`);
    for (const r of fit.residuals) {
      console.log(`    ${`#${r.heroId}`.padEnd(10)}${String(r.power).padStart(12)}`
        + `${String(Math.round(r.predicted)).padStart(12)}`
        + `${`${r.errorPct.toFixed(2)}%`.padStart(9)}`);
    }
  }

  // MERGED, not overwritten: the file holds one row per champion, and a fit of one must not drop the
  // others — calibrating a second champion would otherwise quietly un-calibrate the first.
  //
  // `name`, `fittedAt` and `readings` are carried for a reader. weightsFor reads only the five
  // weights and ignores the rest, which is what lets the row be both a record and its own input.
  function mergeWeights(baseTypeId, readings, fit) {
    const path = weightsPath();
    const table = readWeights(path);
    table[baseTypeId] = {
      name: readings[0].name,
      ...fit.params,
      fittedAt: new Date().toISOString(),
      readings: readings.length,
    };
    mkdirSync(powerDir(), { recursive: true });
    writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`);
    console.log(`\nwrote ${path}`);
  }

  // Calibrate one champion's weights from its logged readings. Reads NO snapshot: the readings carry
  // the totals they were measured with, which is the whole point of logging them.
  function runFit(args) {
    const readings = readReadings(readingsPath());
    const matched = readingsFor(readings, args.selector);
    if (!matched.length) {
      console.error(`no logged readings match "${args.selector}" in ${readingsPath()}`);
      process.exit(1);
    }
    const ids = [...new Set(matched.map((r) => r.baseTypeId))];
    if (ids.length > 1) {
      console.error(`"${args.selector}" matches ${ids.length} champions in the reading log:`);
      for (const id of ids) {
        console.error(`  ${matched.find((r) => r.baseTypeId === id).name} (baseTypeId ${id})`);
      }
      console.error("weights are per champion, so name one of them.");
      process.exit(1);
    }
    // EVERY reading of this champion, across all its copies — not only the ones the selector matched.
    // The weights are shared by every copy and fitWeights removes each copy's own constant exactly, so
    // a second copy adds equations rather than noise.
    const all = readings.filter((r) => r.baseTypeId === ids[0]);
    let fit;
    try {
      fit = fitWeights(all);
    } catch (e) {
      return die(e);
    }
    printFit(all, fit);
    mergeWeights(ids[0], all, fit);
  }
  ```
- [ ] 5. In `main()`, add the fit branch immediately before the final `return runSolve(args);`:
  ```javascript
    if (args.mode === "fit") return runFit(args);
  ```
- [ ] 6. Run to verify GREEN: `npx vitest run oracle/analytics/__tests__/power-cli.test.mjs`
     Expected: 94 passed.
- [ ] 7. Confirm the re-export half still holds: `npx vitest run oracle/analytics/__tests__/speed-cli.test.mjs oracle/analytics/__tests__/wearers.test.mjs`
     Expected: all pass.
- [ ] 8. Lint: `npm run lint`
     Expected: no errors.
- [ ] 9. Commit: `git add oracle/analytics/power.mjs oracle/analytics/__tests__/power-cli.test.mjs && git commit -m "#46 Fit mode: calibrate one champion's weights from its logged readings"`
