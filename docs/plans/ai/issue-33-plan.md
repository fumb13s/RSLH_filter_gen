# Exclude `.hivemind/` From ESLint Implementation Plan

**Goal:** Stop `npm run lint` from failing on hivemind worker scratch files by adding one entry to the global `ignores` array in `eslint.config.js`, and pin that entry with a test so a later config edit cannot silently drop it.

**Architecture:** Three coordinated changes to root-level configuration. (1) `eslint.config.js` gains `"**/.hivemind/**"` in its global `ignores` array — the `**/` prefix is load-bearing, not cosmetic, because `.worktrees/` is gitignored but not eslint-ignored. (2) A new root-level `__tests__/eslint-ignores.test.mjs` asserts the behaviour through eslint's own public `ESLint#isPathIgnored` API rather than by shelling out to a lint run — no fixture files touch disk, because `isPathIgnored` resolves paths against `cwd` and never stats them. (3) `vitest.config.ts`'s `include` allowlist is extended to reach the repo root, without which the new test is silently never collected. No new dependency: `eslint` is already a root devDependency.

**Tech Stack:** ESLint 9.39.2 (flat config), vitest 3.2.4, vite 7.3.1, Node 22, npm workspaces, TypeScript project references.

---

## File Structure

| Action | Path | Responsibility |
| --- | --- | --- |
| Modify | `eslint.config.js` | Add `"**/.hivemind/**"` to global `ignores`; extend the comment above the array |
| Create | `__tests__/eslint-ignores.test.mjs` | Pin the ignore entry and the `**/` prefix against future config edits |
| Modify | `vitest.config.ts` | Extend `include` so the new root-level test is collected |
| Create (temporary, never committed) | `.hivemind/scratch/probe.mjs` | End-to-end proof that a real scratch file no longer fails lint |

`__tests__/` is a new root-level directory. `mkdir` is not needed — the `Write` tool creates parent directories.

---

## Context An Executing Engineer Needs

Read this section before starting. Every claim below was verified against the installed dependency tree during exploration; the file:line references are load-bearing and you should not need to re-derive them.

**Why `.gitignore` buys eslint nothing.** Flat config's default ignores are only `["**/node_modules/", ".git/"]` (`node_modules/eslint/lib/config/default-config.js:68`). ESLint reads no `.gitignore` and does not skip dot-directories. So `.gitignore:15`'s `.hivemind` entry has no effect on `eslint .`.

**Why a scratch probe fails.** Node globals are granted only to `oracle/**/*.mjs` (`eslint.config.js:25-26`). Every tracked `.mjs` in the repo today lives under `oracle/`. A `.hivemind/scratch/probe.mjs` using `console` and `process` therefore fails `no-undef` twice.

**Why the new test file must avoid Node globals.** Same reason. `__tests__/eslint-ignores.test.mjs` is a `.mjs` outside `oracle/`, so it is linted with `no-undef` active and no globals. A stray `console.log` left in it during development is a lint error. `no-undef` is off for `.ts` files only (`node_modules/@typescript-eslint/eslint-plugin/dist/configs/eslint-recommended-raw.js:36`, scoped to `files: ['**/*.ts','**/*.tsx','**/*.mts','**/*.cts']`), which is why no other test file in the repo has this constraint.

**Why every test path ends in `.mjs`.** `isPathIgnored` returns `true` both for a genuinely ignored path *and* for a path that no config matches at all. In `@eslint/config-array/dist/cjs/index.cjs:1252-1291` a config with no `files` key is collected but does **not** set `matchFound`; only a non-universal `files` match does. When `matchFound` is false the lookup returns `CONFIG_WITH_STATUS_UNCONFIGURED` (`:1376-1382`) → `undefined` → `isPathIgnored` is `true`. A `.md` or `.txt` path would therefore report "ignored" whatever the `ignores` array says, and would keep passing after the entry was deleted. `.mjs` is globbed by `default-config.js:21`; the `.ts` negative control by `eslint-recommended-raw.js:13`.

**Why the `**/` prefix works at all.** ESLint matches ignore patterns with `dot: true` (`@eslint/config-array/dist/cjs/index.cjs:243-247`, `MINIMATCH_OPTIONS`). Without it a leading `**` would refuse to match the dot-prefixed `.worktrees` segment and the prefixed form would be no better than the anchored one.

**Why synthetic paths are fine.** `calculateConfigForFile` resolves against the `cwd` option and never stats the path (`node_modules/eslint/lib/eslint/eslint.js:1297`, then `:1338-1342` for `isPathIgnored`). Config lookup runs from `cwd`, not from the file — lookup-from-file is behind the opt-in `v10_config_lookup_from_file` flag (`node_modules/eslint/lib/shared/flags.js:31-34`). So `.worktrees/issue-1/` need not exist, and all three assertions are answered by the root `eslint.config.js`.

**`import.meta.dirname` is safe here — this was de-risked during planning.** The issue justifies it with "Node 22 (what CI runs) has it", which is true but not the operative reason. Under vitest the real `import.meta` is never used: the SSR transform rewrites `import.meta` to `__vite_ssr_import_meta__` (`node_modules/vite/dist/node/chunks/config.js:15505-15507`), and the runner supplies that object itself — `vite-node/dist/client.mjs:282-287` builds `{ url, env, filename, dirname }` and binds it at `:365`, and vite 7's module-runner does the same in `createDefaultImportMeta` (`node_modules/vite/dist/node/module-runner.js:967-981`). So `import.meta.dirname` resolves under vitest independent of the local Node version. It is not used anywhere else in the repo; existing `.mjs` use `fileURLToPath(new URL(..., import.meta.url))`, which needs the `URL` global and is unavailable outside `oracle/`.

**`import { ESLint } from "eslint"` resolves.** `ESLint` is a named export of the CJS `node_modules/eslint/lib/api.js:44-50`, statically analyzable by cjs-module-lexer, and vitest externalizes `node_modules` by default.

**A new root `__tests__/` does not affect the build.** Root `tsconfig.json` is `"files": []` plus three project references, so `npm run build` cannot see it.

---

## Known Limitations — Do Not Chase These

- **`npm run lint` from the *root* checkout is a separate, pre-existing problem.** `.worktrees/` is gitignored but not eslint-ignored, *and* the Node-globals grant at `eslint.config.js:25` is the anchored `"oracle/**/*.mjs"`, which does not match `.worktrees/<issue>/oracle/**/*.mjs`. Those ~60 files would be linted with `no-undef` on and no globals. You are working **inside the worktree**, and every `npm run lint` in this plan means "run from the worktree root". Do not attempt to validate from the root checkout, and do not widen the `files` pattern — that is out of scope for this issue.
- **`CLAUDE.md:37` and `CONTRIBUTING.md:57` both become staler.** Both claim "Tests live in `packages/*/src/__tests__/`", already inaccurate (27 test files live under `oracle/analytics/__tests__/` and `oracle/battlelogs/__tests__/`) and this change adds a third location. Both are explicitly out of scope. Do not edit either — do not fix one and miss the other.
- **`vitest.config.ts` gains no literal `.hivemind` string**, so hivemind's `scripts/setup-deploy.sh` will keep emitting a `WARN` about it on every redeploy. That is cosmetic: vitest's `include` is an allowlist that never reaches `.hivemind/`, so nothing under it can be collected as a test. Adding a behaviour-free `exclude` to silence the warning is deliberately out of scope.
- **`.claude/` is in the same position as `.hivemind/`** — gitignored, not eslint-ignored. It holds only `.md` files plus one `.sh`, none of them an eslint-linted extension, so nothing is linted there today. Observation only; do not extend the pattern to cover it.

---

## Conventions To Follow

- **Edit files with the `Write`/`Edit` tools, never by shelling out.** No `cat >>`, no `echo >>`, no `sed -i`, no heredocs. This applies to the throwaway probe too.
- **One command per Bash call.** No `&&` chaining, no `;`, no pipes, no `$(...)`.
- **Prefer the `Read`/`Glob`/`Grep` tools over shell equivalents** for inspection steps. Where a step below names a shell command for inspection, a tool call achieving the same thing is equally acceptable — the expected *result* is what matters, not the mechanism.
- Test style, unanimous across all 27 existing `.mjs` test files: `import { test, expect } from "vitest";`, flat `test()` calls with **no `describe` blocks anywhere**, 2-space indent, double quotes, semicolons, a first-line `// path/to/file.mjs` self-identifying comment followed by a `//` rationale paragraph saying why the file exists.
- Commit message: conventional-commits with scope (matches `chore(lint): lint oracle/ instead of exempting it wholesale`, `6792c91`). Co-author trailer is exactly `Co-Authored-By: Claude` — no email, no model version.

**On commit granularity and TDD:** this plan observes the RED state (Task 2) but does **not** commit it, then makes a single commit after GREEN (Task 3) containing all three files. The TDD cycle is fully honoured — the test is written first and its failure observed and recorded before any config change — but `CLAUDE.md` requires `npm run build && npm test && npm run lint` to pass before **every** commit, and a committed RED state would violate that and leave a broken commit in history. Record the RED output in your phase result so the review phase can see the failure was observed.

---

## Chunk A — Wire Up And Fail (RED)

### Task 1: Extend the vitest include allowlist to reach the repo root

Without this the new test file is silently never collected: `include` is an allowlist and none of its three current patterns reaches the repo root. Precedent for extending it rather than relocating the test: commit `210051f` added `oracle/analytics/**/*.test.mjs` the same way when that test tree appeared.

**Files:**

- Modify: `vitest.config.ts`

**Steps:**

- [ ] 1. Read `vitest.config.ts` and confirm it currently reads exactly:
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      include: ["packages/*/src/**/*.test.ts", "oracle/analytics/**/*.test.mjs", "oracle/battlelogs/**/*.test.mjs"],
      testTimeout: Number(process.env.VITEST_TIMEOUT) || (process.env.FC_NUM_RUNS ? 120_000 : 10_000),
    },
  });
  ```
  If it differs, stop and report — the plan was written against this exact content.

- [ ] 2. Replace the single-line `include` array on line 5 with the multi-line form, adding `"__tests__/**/*.test.mjs"` in second position. The whole file becomes:
  ```ts
  import { defineConfig } from "vitest/config";

  export default defineConfig({
    test: {
      include: [
        "packages/*/src/**/*.test.ts",
        "__tests__/**/*.test.mjs",
        "oracle/analytics/**/*.test.mjs",
        "oracle/battlelogs/**/*.test.mjs",
      ],
      testTimeout: Number(process.env.VITEST_TIMEOUT) || (process.env.FC_NUM_RUNS ? 120_000 : 10_000),
    },
  });
  ```
  The multi-line form is used because appending to the single-line array would produce a 137-character line, well past the ~100-character wrap the repo's config files use. The issue states reformatting is optional; this is the prescribed choice.

- [ ] 3. Verify the existing suite still collects and passes unchanged: `npm test`
     Expected: all test files pass. The new `include` entry currently matches nothing, which is not an error — vitest only fails on "no test files found" when *no* pattern matches anything.

### Task 2: Write the failing test (RED)

**Files:**

- Create: `__tests__/eslint-ignores.test.mjs`

**Steps:**

- [ ] 1. Confirm the negative control's target exists, so a `false` result later means "linted" and not "missing file". Read `packages/core/src/index.ts` (or `Glob` for it).
     Expected: the file exists. (`isPathIgnored` never stats the path, so a missing file would still answer `false` — but a non-existent negative control would mislead a future reader.)

- [ ] 2. Create `__tests__/eslint-ignores.test.mjs` with the `Write` tool, with exactly this content:
  ```js
  // __tests__/eslint-ignores.test.mjs
  //
  // Worker scratch files live under .hivemind/scratch/ and are never committed, so nothing in a diff
  // shows when the ignore entry that exempts them is dropped — the failure surfaces as a worker's own
  // lint failing on a file the reviewer cannot see. This pins it instead.
  import { test, expect } from "vitest";
  import path from "node:path";
  import { ESLint } from "eslint";

  // No Node globals are declared for .mjs outside oracle/ (eslint.config.js:25), so this file must
  // avoid process/console/__dirname/URL — all no-undef here. import.meta.dirname is syntax, not a
  // global, and Node 22 (what CI runs) has it.
  const ROOT = path.resolve(import.meta.dirname, "..");
  const eslint = new ESLint({ cwd: ROOT });

  // Every path below ends in .mjs on purpose. isPathIgnored also answers true for a path no config
  // matches at all, so a .md or .txt path would report "ignored" whatever the ignores array says and
  // would keep passing after the entry was deleted.
  test("a worker's scratch probe is ignored", async () => {
    expect(await eslint.isPathIgnored(".hivemind/scratch/probe.mjs")).toBe(true);
  });

  // The assertion that pins the **/ prefix: `.hivemind/**` passes the test above and fails this one.
  // The root checkout lints an active worker's whole worktree, scratch included.
  test("a scratch probe inside a worktree is ignored too", async () => {
    expect(await eslint.isPathIgnored(".worktrees/issue-1/.hivemind/scratch/probe.mjs")).toBe(true);
  });

  // The negative control. Without it an over-broad pattern — or a cwd wrong enough that nothing
  // resolves — would leave both assertions above passing while eslint checked nothing.
  test("real source is still linted", async () => {
    expect(await eslint.isPathIgnored("packages/core/src/index.ts")).toBe(false);
  });
  ```
  Reproduce this verbatim. Do not add `console.log` or any other Node global while working on it — see the constraint in Context above.

- [ ] 3. **VERIFY RED.** Run only the new file: `npx vitest run __tests__/eslint-ignores.test.mjs`
     Expected: `Test Files  1 failed (1)` and `Tests  2 failed | 1 passed (3)`.
     - `a worker's scratch probe is ignored` — FAILS with `expected false to be true`
     - `a scratch probe inside a worktree is ignored too` — FAILS with `expected false to be true`
     - `real source is still linted` — PASSES

     This is the discrimination check for the ignore entry itself: both failures are caused by `"**/.hivemind/**"` being absent, not by a typo. **Record this output in your phase result.**

     If instead you see `No test files found`, Task 1 did not take effect — fix the `include` pattern before continuing. If you see 3 failures, the negative control is broken (likely a wrong `cwd`); do not proceed to Chunk B until it passes.

---

## Chunk B — Make It Pass (GREEN)

### Task 3: Add the ignore entry and commit

**Files:**

- Modify: `eslint.config.js`
- Create: `__tests__/eslint-ignores.test.mjs` (from Task 2, committed here)
- Modify: `vitest.config.ts` (from Task 1, committed here)

**Steps:**

- [ ] 1. Read `eslint.config.js` and confirm lines 8-21 currently read:
  ```js
    {
      // Everything under oracle/ is linted EXCEPT these: third-party inputs (Sellfile Creator and its
      // de-obfuscated form), the extracted SFC workers and wasm, and the two gitignored derived dirs
      // that hold throwaway probe scripts. Ignore by directory, not by `oracle/**`, so new tooling
      // there is linted by default rather than silently exempt.
      ignores: [
        "**/dist/**",
        "**/node_modules/**",
        "oracle/resources/**",
        "oracle/probe/gen/**",
        "oracle/analytics/out/**",
        "oracle/analytics/findings/**",
      ],
    },
  ```
  If it differs, stop and report.

- [ ] 2. Replace that block with the following. This does two things at once by design: adds `"**/.hivemind/**"` as the third entry (with the two repo-wide entries, above the four `oracle/`-scoped ones), and appends a **separate** comment paragraph for it. Do not fold the new sentence into the existing one — the existing paragraph states a principle about third-party and derived code, and `.hivemind/` is exempt for a different reason.
  ```js
    {
      // Everything under oracle/ is linted EXCEPT these: third-party inputs (Sellfile Creator and its
      // de-obfuscated form), the extracted SFC workers and wasm, and the two gitignored derived dirs
      // that hold throwaway probe scripts. Ignore by directory, not by `oracle/**`, so new tooling
      // there is linted by default rather than silently exempt.
      //
      // `.hivemind/` is exempt for a different reason: it is throwaway worker scratch that is never
      // committed, so a probe script left under `.hivemind/scratch/` must not fail `eslint .`. The
      // `**/` prefix is load-bearing: `.worktrees/` is gitignored but NOT eslint-ignored, so linting
      // from the root checkout while a worker is active walks `.worktrees/<issue>/.hivemind/scratch/`
      // too, and an anchored `.hivemind/**` would miss it.
      ignores: [
        "**/dist/**",
        "**/node_modules/**",
        "**/.hivemind/**",
        "oracle/resources/**",
        "oracle/probe/gen/**",
        "oracle/analytics/out/**",
        "oracle/analytics/findings/**",
      ],
    },
  ```
  Leave lines 1-7 and 22-35 of the file untouched.

- [ ] 3. **VERIFY GREEN.** Run the new file: `npx vitest run __tests__/eslint-ignores.test.mjs`
     Expected: `Test Files  1 passed (1)` and `Tests  3 passed (3)`.

- [ ] 4. Confirm the new test file is itself lint-clean — it is a `.mjs` outside `oracle/`, so this is the check that catches a stray Node global: `npx eslint __tests__/eslint-ignores.test.mjs`
     Expected: no output, exit 0.

- [ ] 5. Run the repo's full pre-commit gate, part 1: `npm run build`
     Expected: core → cli → web all build, exit 0.

- [ ] 6. Gate part 2: `npm test`
     Expected: all test files pass, and `__tests__/eslint-ignores.test.mjs` appears in the list of collected files with 3 passing tests. If it is absent from the output, change 3 did not take effect.

- [ ] 7. Gate part 3: `npm run lint`
     Expected: no output, exit 0.

- [ ] 8. Confirm exactly three paths changed and no dependency was touched: `git status --porcelain`
     Expected exactly:
  ```
   M eslint.config.js
   M vitest.config.ts
  ?? __tests__/
  ```
  `package.json` and `package-lock.json` must **not** appear. If they do, an `npm install` ran somewhere — revert them; this change adds no dependency.

- [ ] 9. Stage the three files: `git add eslint.config.js vitest.config.ts __tests__/eslint-ignores.test.mjs`

- [ ] 10. Confirm the staged diff is exactly what you intend, with no stray debugging: `git diff --cached`
      Expected: the `ignores` entry plus its comment paragraph, the `include` reformat plus its new entry, and the new test file. Nothing else.

- [ ] 11. Commit (single command, no chaining):
  ```
  git commit -m "chore(lint): ignore .hivemind/ so worker scratch does not fail lint

  eslint reads no .gitignore and does not skip dot-directories — flat config's
  default ignores are only node_modules and .git — so a probe script a hivemind
  worker leaves under .hivemind/scratch/ gets linted, and fails no-undef on
  console and process because Node globals are declared only for oracle/**/*.mjs.

  The **/ prefix is load-bearing: .worktrees/ is gitignored but not
  eslint-ignored, so linting from the root checkout while a worker is active
  walks .worktrees/<issue>/.hivemind/scratch/ too.

  Pinned by __tests__/eslint-ignores.test.mjs, which asserts through eslint's own
  isPathIgnored API rather than a lint run. The failure this prevents is invisible
  in a diff, so a human noticing the entry's removal is not a control worth
  relying on. vitest.config.ts's include is an allowlist that reached no
  root-level path, so it needed the new pattern or the test would never run.

  Co-Authored-By: Claude"
  ```

---

## Chunk C — Prove The Test Discriminates

Chunk A already proved the entry is load-bearing (both assertions failed without it). This chunk proves the **`**/` prefix** is load-bearing too, and demonstrates the fix end-to-end against a real scratch file.

This is the **only** place in the plan where `eslint.config.js` is temporarily mutated. Task 6 restores it and verifies the restore. Do not commit anything in this chunk.

### Task 4: Create a real scratch probe and confirm lint passes

**Files:**

- Create (temporary, never committed): `.hivemind/scratch/probe.mjs`

**Steps:**

- [ ] 1. Confirm `.hivemind/scratch/` exists (`Glob` for `.hivemind/scratch/**`, or `ls .hivemind/scratch`). It is created for you and is normally empty. If it is missing, run `mkdir -p .hivemind/scratch`.

- [ ] 2. Create `.hivemind/scratch/probe.mjs` with the `Write` tool:
  ```js
  // Throwaway probe for issue #33. Uses two Node globals that are not declared for .mjs outside
  // oracle/, so without the "**/.hivemind/**" ignore entry this file fails no-undef twice.
  console.log(process.version);
  ```

- [ ] 3. Confirm lint passes with a real scratch file present: `npm run lint`
     Expected: no output, exit 0.

     **This check does not discriminate the `**/` prefix.** You are inside the worktree, where `.hivemind/` sits at the top level, so an anchored `.hivemind/**` would pass this too. Only Task 5 tests the prefix.

- [ ] 4. Confirm the probe is invisible to git: `git status --porcelain`
     Expected: empty output. `.hivemind` is gitignored (`.gitignore:15`), so the probe never reaches the commit. Do not `git add -f` it, and do not add it to `.gitignore` — it is already covered.

### Task 5: Verify the `**/` prefix is load-bearing

**Files:**

- Modify (temporarily): `eslint.config.js`

**Steps:**

- [ ] 1. In `eslint.config.js`, temporarily weaken the new entry from `"**/.hivemind/**"` to `".hivemind/**"`. Change that one string only; leave the comment and every other entry alone.

- [ ] 2. Run the pinning test: `npx vitest run __tests__/eslint-ignores.test.mjs`
     Expected: `Tests  1 failed | 2 passed (3)`.
     - `a worker's scratch probe is ignored` — still PASSES (the anchored pattern matches a top-level `.hivemind/`)
     - `a scratch probe inside a worktree is ignored too` — FAILS with `expected false to be true`
     - `real source is still linted` — PASSES

     Exactly one failure, and it must be the worktree one. If both of the first two fail, or neither does, the entry was edited wrongly — restore via Task 6 and re-check before drawing conclusions.

- [ ] 3. Now temporarily delete the `.hivemind` ignore line entirely — after step 1 it reads `".hivemind/**",` — leaving the six original entries and keeping the comment paragraph in place.

- [ ] 4. Confirm the real scratch probe from Task 4 now fails lint: `npm run lint`
     Expected: exit 1, with two `no-undef` errors reported against `.hivemind/scratch/probe.mjs` — one for `console`, one for `process`. This is the exact failure the issue exists to prevent, reproduced against a real file.

### Task 6: Restore and confirm the tree is clean

**Files:**

- Modify: `eslint.config.js` (restore to the committed state)

**Steps:**

- [ ] 1. Restore `eslint.config.js` to its committed state. Preferred: `git checkout -- eslint.config.js` — safe, because the correct content was committed in Task 3, so there is nothing to lose.
     If `git checkout` is not available in your allowlist, restore by hand with `Edit` instead: re-insert `"**/.hivemind/**",` as the third entry of the `ignores` array, immediately after `"**/node_modules/**",` and before `"oracle/resources/**",`. That single line is the only difference from the committed state.

- [ ] 2. Confirm the working tree matches the commit exactly, with no leftover temporary edit: `git status --porcelain`
     Expected: empty output. If `eslint.config.js` still shows as modified, step 1 did not fully restore it — repeat before continuing.

- [ ] 3. Confirm the restored config still contains the entry: `Grep` for `hivemind` in `eslint.config.js`.
     Expected: the `"**/.hivemind/**",` line plus the comment lines that mention `.hivemind/`.

- [ ] 4. Re-run the pinning test against the restored config: `npx vitest run __tests__/eslint-ignores.test.mjs`
     Expected: `Tests  3 passed (3)`.

---

## Chunk D — Final Verification

### Task 7: Run the full gate and audit every acceptance criterion

**Files:** none modified.

**Steps:**

- [ ] 1. Gate part 1: `npm run build`
     Expected: exit 0.

- [ ] 2. Gate part 2: `npm test`
     Expected: all pass, `__tests__/eslint-ignores.test.mjs` listed with 3 passing tests.

- [ ] 3. Gate part 3: `npm run lint`
     Expected: no output, exit 0. Note the `.hivemind/scratch/probe.mjs` from Task 4 is still present and still ignored — leave it; it goes away with the worktree and needs no cleanup.

- [ ] 4. Confirm the commit contains exactly three files and no dependency manifest: `git show --stat HEAD`
     Expected: `eslint.config.js`, `vitest.config.ts`, `__tests__/eslint-ignores.test.mjs`, and no others. In particular `package.json` and `package-lock.json` must be absent.

- [ ] 5. Confirm nothing is left uncommitted: `git status --porcelain`
     Expected: empty output.

- [ ] 6. Walk the acceptance criteria one by one and confirm each:
  - [ ] `eslint.config.js`'s global `ignores` array contains `"**/.hivemind/**"`, and the comment above the array explains both that entry and why it is not anchored.
  - [ ] `__tests__/eslint-ignores.test.mjs` exists and asserts three things: `.hivemind/scratch/probe.mjs` is ignored, `.worktrees/issue-1/.hivemind/scratch/probe.mjs` is ignored, `packages/core/src/index.ts` is not.
  - [ ] That test file references no Node globals (`process`, `console`, `__dirname`, `URL`) and derives its root path from `import.meta.dirname`. Confirm by eye and by the clean `npx eslint __tests__/eslint-ignores.test.mjs` from Task 3 step 4.
  - [ ] `vitest.config.ts`'s `include` array contains `"__tests__/**/*.test.mjs"`, and `npm test` output shows the new file collected.
  - [ ] `npm run build`, `npm test` and `npm run lint` all pass.
  - [ ] No new dependency: `package.json` gains no entry and `package-lock.json` is unchanged.

- [ ] 7. Report in your phase result: the RED output recorded in Task 2 step 3, the two discrimination outcomes from Task 5, and confirmation that `git status --porcelain` was empty after Task 6.
