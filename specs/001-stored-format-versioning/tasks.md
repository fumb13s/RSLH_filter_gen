---
description: 'Task list for Versioned Stored Formats'
---

# Tasks: Versioned Stored Formats

**Input**: Design documents from `/specs/001-stored-format-versioning/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Requested. FR-016 requires an automated test for every upgrade step, and the plan specifies a full test plan (quickstart.md, "Test plan"). Within each story, write the tests first and confirm they fail before implementing.

**Organization**: Tasks are grouped by user story (spec.md). The loader and the stored quick-state types are foundational, because every story depends on them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: The user story the task belongs to (US1–US5)
- All paths are relative to the repository root. Source is in `packages/web/src/` and tests in `packages/web/src/__tests__/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies

- [ ] T001 Add `"zod": "^3.24.0"` to `dependencies` in `packages/web/package.json`, the same range `packages/core` uses, and run `npm install` to update `package-lock.json` (the lock resolves 3.25.76). Use the zod 3 API (`import { z } from "zod"`) everywhere in this feature.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared loader and the stored quick-state types. Every user story depends on them.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 [P] Write the core loader tests in `packages/web/src/__tests__/versioned.test.ts`, using a toy format with two past versions and a current one:
  - a current-version envelope → `ok`;
  - a v1 envelope → every upgrade step runs in order;
  - a version above the current one → `newer` with `found` / `supported`, even when the envelope has extra keys and `strictEnvelope` is set;
  - for a format without `unversioned`: a missing `version` → `invalid` with `missing "version"`, and a non-object → `not an object`;
  - with `unversioned` set, a version-less object is bare data at that version;
  - a non-integer, zero or negative `version` → `version must be a positive integer`;
  - a missing data key → `missing "<dataKey>"`;
  - with `strictEnvelope`, an extra key → `unexpected key "<key>"`; without it, the key is ignored;
  - a zod failure at the root is reported with the path `(root)`;
  - `loadFailureMessage(".fqbl", …)` wording for `newer` (`this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.`) and for `invalid` (`not a valid .fqbl file (<issue>)`);
  - `loadFileText(format, ".fqbl", text)`:
    - text that isn't JSON → `{ kind: "error", message: "Failed to load .fqbl: not a valid .fqbl file (not JSON)" }`;
    - a newer envelope → `Failed to load .fqbl: ` followed by the newer text;
    - an invalid envelope → `Failed to load .fqbl: not a valid .fqbl file (<issue>)`;
    - a valid envelope → `{ kind: "ok", value }`.
  - Spec: `specs/001-stored-format-versioning/contracts/versioned-loader.md`.
- [ ] T003 Implement `packages/web/src/versioned.ts` exactly per `specs/001-stored-format-versioning/contracts/versioned-loader.md` (depends on T001):
  - exports `PastVersion`, `VersionedFormat<T>` (`past`, `current: z.ZodType<T, z.ZodTypeDef, unknown>`, `dataKey`, `unversioned?`, `strictEnvelope?`), `LoadFailure`, `LoadResult<T>`, `currentVersion`, `wrap`, `loadVersioned`, `loadFailureMessage` and `loadFileText`;
  - `loadVersioned` and `loadFileText` never throw; `loadVersioned` follows the five-step algorithm with its fixed issue strings;
  - the bump-rule comment goes verbatim at the top of the module;
  - no DOM access;
  - upgrade steps take `unknown` and cast to the previous schema's `z.output<…>`; never `any` (`no-explicit-any` is on).
- [ ] T004 [P] Add the stored quick-state types in `packages/web/src/quick-generator.ts`:
  - export the existing `SetTier` interface;
  - add `export type StoredSetTier = Omit<SetTier, "color">`, `StoredQuickBlock = Omit<QuickBlock, "tiers"> & { tiers: StoredSetTier[] }` and `StoredQuickGenState = Omit<QuickGenState, "blocks"> & { blocks: StoredQuickBlock[] }`;
  - retype `stripBlockColors(state: QuickGenState): StoredQuickGenState` and `restoreBlockColors(state: StoredQuickGenState): QuickGenState`, with restore assigning each tier `defaultColors[i] ?? "#e5e7eb"`.
  - This clears the existing tsc error at `quick-generator.ts:116`. The existing strip/restore tests in `packages/web/src/__tests__/quick-generator.test.ts` must keep passing unchanged.

**Checkpoint**: The loader tests (T002) pass, and user story work can begin.

---

## Phase 3: User Story 1 - Saved work keeps opening with the same meaning (Priority: P1) 🎯 MVP

**Goal**: Every format is versioned and loads through the shared loader. Every historical version of `.fqbl`, `.fmbl`, share links and settings loads with its meaning intact, and whatever the app writes loads back identical.

**Independent Test**: Load one fixture per historical version of each format, plus pre-versioning links and settings, and round-trip a document that uses every field. Everything loads with 100% of its content.

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [ ] T005 [P] [US1] Write `packages/web/src/__tests__/quick-state-format.test.ts` with one fixture per version in its historical shape (see `specs/001-stored-format-versioning/contracts/stored-documents.md`):
  - v1 flat block with coloured tiers → `{ blocks: [block] }`, colours dropped;
  - v2 blocks with coloured tiers → colours dropped;
  - v3 with `rareAccessories` and `oreReroll` → unchanged;
  - v4 with `customProfiles`, `selectedCustom` and `strict: true` → unchanged;
  - round trip: a maximal app-shaped v4 state goes through `wrap` → JSON → `loadVersioned` and comes back deep-equal, in both `QUICK_STATE_FILE_FORMAT` and `QUICK_STATE_LINK_FORMAT`. The state includes block `name`, `sellRolls`, `selectedCustom`, `customProfiles`, `rareAccessories`, `oreReroll` and `strict: true`, and its strings avoid `<>&"'`.
- [ ] T006 [P] [US1] Write `packages/web/src/__tests__/fmbl-format.test.ts`:
  - a v1 file whose group carries `isAnd` loads, with `isAnd` dropped;
  - a group without `mainStats` loads with `mainStats: []`;
  - round trip through `wrap` → JSON → `loadVersioned`, deep-equal, for:
    - the groups from `quickStateToGroups`, `rareAccessoriesToGroups` and `oreRerollToGroups` for a quick state that uses all three blocks;
    - a literal copy of the strict-mode catch-all group from `main.ts`, `{ keep: false, sets: <all set ids>, slots: [], mainStats: [], goodStats: [], rolls: 0, rank: 0, rarity: 0 }`;
    - one manual Generator group that sets every `SettingGroup` field: `name`, `keep: true`, non-empty `slots`, `mainStats` and `goodStats`, and `rank`, `rarity`, `faction`, `walkbackDelay`.
- [ ] T007 [P] [US1] Extend `packages/web/src/__tests__/settings.test.ts`, leaving the existing tests unchanged:
  - flat stored settings without `version` load as v1, and storage stays byte-identical after `getSettings()` (nothing is written on load);
  - `saveSettings` writes `{ version: 1, settings: {…} }`;
  - one bad field (e.g. `rank5RollAdjustment: 99`) falls back alone while the others are kept;
  - mutating `getSettings().quickTierRolls` leaves `DEFAULT_SETTINGS` unchanged;
  - settings with every field set to a non-default value come back unchanged through `saveSettings` → `getSettings()`.
- [ ] T008 [P] [US1] Extend `packages/web/src/__tests__/share.test.ts`, leaving the existing tests unchanged:
  - `encodeState` output decompresses to `{ version: 4, state }`. `share.ts` does not export `fromBase64Url` or `decompress`, so add a test-local inverse of the file's `compressToBase64Url` helper;
  - a bare (pre-versioning) state decodes;
  - `{ version: 1, state: <flat v1 block> }` decodes into the blocks shape, which shows the link is migrated before it is validated.

### Implementation for User Story 1

- [ ] T009 [US1] Implement `packages/web/src/quick-state-format.ts` per `specs/001-stored-format-versioning/data-model.md`, section "Quick state" (depends on T003 and T004).
  - Factory: `quickStateFormat(variant: "file" | "link")`.
  - Past versions and their upgrade steps: v1 (wrap as `{ blocks: [block] }`), v2 (drop tier `color`), v3 (identity).
  - Current version: v4, with the id refinement as one `superRefine` (set, accessory-set, faction, `SUBSTAT_PRESETS`, `selectedCustom` and `GOOD_SUBSTATS` checks).
  - Structural checks: exactly 4 tiers; `rolls` −1…9; `sellRolls` 1…9; `assignments` 0…3; ore columns 0…2; at least 1 block; unique indices; stats 1…11 unique pairs.
  - `idRecord` checks keys in the record's key schema (`Number.isInteger(Number(k))`) and rebuilds records with `Number(key)` keys. zod 3 silently drops `"__proto__"` from a record's output, so never check keys after parsing.
  - Link variant:
    - every object `.strict()`;
    - limits moved from `share.ts`: `MAX_BLOCKS` 10, `MAX_NAME_LENGTH` 100, `MAX_TIER_NAME_LENGTH` 50, `MAX_CUSTOM_LABEL_LENGTH` 50, `MAX_CUSTOM_PROFILES` 4, `MAX_SELECTIONS_PER_SET` 16;
    - strings are length-checked, then `<>&"'` are stripped.
  - File variant: unknown keys are dropped, there are no limits, and strings are kept as written.
  - Labels use `text(variant, 50).refine((s) => s.length > 0)`, with no trim. Optional fields use `.optional()` only.
  - Exports: `QUICK_STATE_FILE_FORMAT` and `QUICK_STATE_LINK_FORMAT`, both typed `VersionedFormat<StoredQuickGenState>`. The link format sets `unversioned: 4` and `strictEnvelope: true`. The link variant must accept exactly the links today's `share.ts` validator accepts.
- [ ] T010 [P] [US1] Implement `packages/web/src/fmbl-format.ts` per `specs/001-stored-format-versioning/data-model.md`, section "Generator groups" (depends on T003).
  - A v1 current schema for `groups`, with types only and no numeric ranges.
  - `mainStats` defaults to `[]`, and unknown keys are dropped.
  - Id refinement: `sets` in `ARTIFACT_SET_NAMES`, `slots` in `ARTIFACT_SLOT_NAMES`, stat ids in `STAT_NAMES`, `faction` 0 or in `FACTION_NAMES`.
  - Export `FMBL_FORMAT: VersionedFormat<SettingGroup[]>` (`dataKey: "groups"`, `past: []`).
- [ ] T011 [P] [US1] Rework `packages/web/src/settings.ts` per `specs/001-stored-format-versioning/data-model.md`, section "Settings" (depends on T003).
  - Define and export `SETTINGS_FORMAT: VersionedFormat<UserSettings>` (`dataKey: "settings"`, `unversioned: 1`, `past: []`).
  - The v1 schema falls back per field to the defaults, within the ranges in the data model. Array fallbacks are factories that return fresh copies, e.g. `.default(() => [...DEFAULT_SETTINGS.quickTierRolls]).catch(() => [...DEFAULT_SETTINGS.quickTierRolls])`.
  - `getSettings()` returns fresh default copies when storage is missing, unparsable, not an object, unavailable or throws. Otherwise it calls `loadVersioned`: `ok` → the value; `newer` or `invalid` → fresh defaults. It never returns `version` and never writes.
  - `saveSettings(s)` writes `JSON.stringify(wrap(SETTINGS_FORMAT, s))`.
  - Keep every storage read inside a try: `localStorage` is undefined in vitest's Node environment.
- [ ] T012 [US1] Move share links onto the loader in `packages/web/src/share.ts` (depends on T009).
  - `encodeState` compresses `JSON.stringify(wrap(QUICK_STATE_LINK_FORMAT, stripBlockColors(state)))`.
  - `decodeState` runs the transport gates as today, then `JSON.parse`, then `loadVersioned(QUICK_STATE_LINK_FORMAT, data)`. `ok` → `restoreBlockColors(value)`; any failure → throw `new Error("Invalid shared state")`.
  - Remove the hand-written validators (`validateTier`, `validateBlock`, `validateRareAccessories`, `validateOreReroll`, `validateCustomProfile`, `validateQuickGenState`) and everything else that only they used: the helpers, the link-limit constants, `MAX_TIERS`, `MAX_ORE_COLUMN`, `MAX_CUSTOM_PROFILE_STATS`, the `VALID_*` and `MAX_PROFILE_INDEX` lookups, and the imports that fed them.
  - Keep `fail()`, the transport gates (`MAX_ENCODED_LENGTH`, `MAX_BINARY_SIZE`, `MAX_DECOMPRESSED_SIZE`, the base64url check) and the compression helpers.
- [ ] T013 [US1] Wire the file formats into `packages/web/src/main.ts` (depends on T009 and T010).
  - Remove `migrateFqbl`, `FQBL_CURRENT_VERSION`, `FqblFileV1` and the `FmblFile` / `FqblFile` interfaces, and drop `QuickBlock` from the type import on line 9.
  - `.fqbl` save: `JSON.stringify(wrap(QUICK_STATE_FILE_FORMAT, stripBlockColors(tab.quickState)), null, 2)`.
  - `.fqbl` load: `const result = loadFileText(QUICK_STATE_FILE_FORMAT, ".fqbl", text)`. `ok` → `tab.quickState = restoreBlockColors(result.value)`; `error` → show `result.message` in the tab-bar error.
  - `.fmbl` save and load work the same way, with `FMBL_FORMAT` and `".fmbl"`.
  - `main.ts` makes no decisions of its own here; it only displays what `loadFileText` returns.

**Checkpoint**: Every format is versioned, and old data of every version loads. T005–T008 pass.

---

## Phase 4: User Story 2 - Data from a newer app version is refused clearly (Priority: P2)

**Goal**: Newer-version files, links and settings are never loaded, whether partly or fully. Files and links show a clear "newer version, reload" message, links keep their hash, and newer settings are never overwritten; the settings dialog explains why.

**Independent Test**: Present each format with a version above the current one. The message appears (for settings, in the settings dialog), nothing loads, and stored settings are byte-identical afterwards.

### Tests for User Story 2 ⚠️ (write first, confirm they fail)

- [ ] T014 [P] [US2] Extend `packages/web/src/__tests__/share.test.ts`:
  - `{ version: 5, state }` rejects with `NewerVersionError`;
  - `sharedLinkErrorMessage` returns `This link was made with a newer version of the app. Reload the page to open it.` for a `NewerVersionError` and `This shared link couldn't be opened. It may be incomplete or damaged.` for anything else;
  - `resolveSharedLink`:
    - a hash without `#q=` → `null`;
    - a valid link → `{ state }`;
    - a newer link → `{ error: <newer text> }`;
    - `#q=A` → `{ error: <generic text> }`;
    - it never rejects.
- [ ] T015 [P] [US2] Extend `packages/web/src/__tests__/settings.test.ts`:
  - with `{ version: 2, settings: {…} }` stored, `getSettings()` equals `DEFAULT_SETTINGS`, `settingsFromNewerVersion()` is true, and storage is byte-identical after `saveSettings(...)`;
  - `{ version: "x", settings: {…} }` → defaults, and the next `saveSettings` replaces it.
- [ ] T016 [P] [US2] Write `packages/web/src/__tests__/settings-modal.test.ts` with `// @vitest-environment jsdom` (as in `editor.test.ts`).
  - Create `#settings-overlay`, `#settings-close` and `#settings-body` before calling `initSettingsModal()`, which looks them up with `!` and attaches listeners immediately.
  - With newer settings stored, opening the modal shows the note and disables every input, select and the Reset button.
  - With current settings there is no note and the controls are enabled.
- [ ] T017 [P] [US2] Extend `packages/web/src/__tests__/fmbl-format.test.ts`: `{ version: 2, groups: [] }` → `newer`.

### Implementation for User Story 2

- [ ] T018 [US2] In `packages/web/src/share.ts` (see `specs/001-stored-format-versioning/contracts/module-interfaces.md`):
  - add `export class NewerVersionError extends Error` carrying `found` and `supported`, and have `decodeState` throw it on a `newer` result;
  - add `sharedLinkErrorMessage(err: unknown): string` with the two texts from T014;
  - add `resolveSharedLink(hash: string): Promise<{ state: QuickGenState } | { error: string; cause: unknown } | null>`:
    - `null` when `hash` doesn't start with `#q=`;
    - `{ state }` when `decodeState(hash.slice(3))` resolves;
    - `{ error: sharedLinkErrorMessage(err), cause: err }` when it rejects;
    - it never rejects.
- [ ] T019 [US2] In `packages/web/src/main.ts`, replace `loadSharedState` (lines 1138–1147) with `resolveSharedLink(location.hash)` (depends on T018). In the startup block (lines 1149–1160):
  - `{ state }` → as today;
  - `{ error, cause }` → `console.warn` with `cause`, and open the default tab as today. After `addTab(settings.defaultTabType)`, set `tabBarError.textContent = error` and `tabBarError.hidden = false`. `addTab` hides the error bar, so this must come after it.
  - Leave the `#q=` hash in place on failure.
- [ ] T020 [P] [US2] In `packages/web/src/settings.ts`:
  - export `settingsFromNewerVersion(): boolean`, true when storage holds an envelope whose version is above the current one;
  - make `saveSettings` write nothing while the stored settings are newer;
  - a `version` that is not a positive integer counts as corrupt, not newer, so the next save replaces it;
  - keep every storage read inside a try.
- [ ] T021 [US2] In `packages/web/src/settings-modal.ts`, when `settingsFromNewerVersion()` is true (depends on T020):
  - show `Your settings were saved by a newer version of the app. Reload the page to see or change them.` at the top of the form;
  - disable every input and select, and the "Reset to Defaults" button.

**Checkpoint**: Newer-version data is refused clearly in all four formats. T014–T017 pass.

---

## Phase 5: User Story 3 - Broken data is refused with a reason (Priority: P2)

**Goal**: Invalid files are refused with the first problem named, and damaged links show a message. Links keep exact acceptance parity; files tolerate unknown fields.

**Independent Test**: Open invalid files and damaged links. Each shows a specific message and nothing loads, and the existing share tests still pass unchanged.

### Tests for User Story 3 ⚠️ (write first, confirm they fail)

- [ ] T022 [P] [US3] Extend `packages/web/src/__tests__/quick-state-format.test.ts`:
  - file variant: extra keys at top, block and tier level are dropped; 11 blocks are accepted; a tier named `Tank's` is kept as written;
  - link variant: the same extra keys are rejected; 11 blocks are rejected; `<>&"'` are stripped; a label made only of stripped characters is rejected;
  - both variants: an unknown set id, accessory set id or faction id is rejected at the current version, and so is a `"__proto__"` key inside a record. Build that input with `JSON.parse`, since object literals can't carry an own `__proto__`.
- [ ] T023 [P] [US3] Extend `packages/web/src/__tests__/share.test.ts`. Each of these rejects with `Invalid shared state`:
  - `{ version: 4, state, extra: 1 }`;
  - `"__proto__"` inside a block's `assignments`, inside `oreReroll.assignments`, and inside `rareAccessories.selections`, each built with `encodeRawString`;
  - invalid JSON;
  - the input `"A"`.
- [ ] T024 [P] [US3] Extend `packages/web/src/__tests__/fmbl-format.test.ts`: a missing `groups` or `version` → `invalid`; an unknown set, slot, stat or faction id → `invalid`; `faction: 0` is accepted.

### Implementation for User Story 3

- [ ] T025 [US3] In `packages/web/src/share.ts`, make every failure other than a newer version throw `Error("Invalid shared state")` (depends on T018). Today `JSON.parse` failures throw a `SyntaxError`, and base64 that `atob` refuses (e.g. `"A"`, which passes the alphabet gate) throws a `DOMException`; wrap both.

**Checkpoint**: Broken data is refused with a reason. T022–T024 pass, and every pre-existing `share.test.ts` test passes unchanged.

---

## Phase 6: User Story 4 - The app no longer writes data it would refuse (Priority: P3)

**Goal**: Roll inputs and numeric settings store whole numbers, and set columns ignore dropped text that isn't a known set.

**Independent Test**: Typing `6.5` stores 7. Dropping foreign text changes nothing. Both are checked through the real handlers.

### Tests for User Story 4 ⚠️ (write first, confirm they fail)

- [ ] T026 [P] [US4] Extend `packages/web/src/__tests__/quick-generator.test.ts`:
  - `parseDroppedSetId`: a set id → that id; `"NaN"`, `"abc"`, `""`, `undefined` and an unknown id → `null`;
  - `normalizeRolls`: `6.5` → 7; `12` → 9; `-3` → 1; `0` → 1.
- [ ] T027 [P] [US4] Write `packages/web/src/__tests__/quick-generator-dom.test.ts` with `// @vitest-environment jsdom`. Set `document.body.innerHTML = '<div id="quick-tiers"></div>'` and call `renderQuickGenerator(defaultQuickState(), onChange)` with a spy for `onChange`. Then:
  - **Rolls input** (the first `.quick-tier-rolls-input`):
    - set the value to `6.5` and dispatch `input` → the block's tier 0 `rolls` is 7;
    - dispatch `blur` → `rolls` is 7 and the input shows `7`;
    - with the input showing `6.5`, dispatch `new WheelEvent("wheel", { deltaY: -1 })` → the stored `rolls` is an integer from 1 to 9.
  - **Drops**, on a tier column (`.quick-tier-columns:not(.ore-columns) .quick-tier-column`) and on an ore-reroll column (`.ore-columns .quick-tier-column:not(.quick-tier-sell)`):
    - build a `drop` event with a stub `dataTransfer`, e.g. `Object.defineProperty(event, "dataTransfer", { value: { getData: () => "abc" } })`;
    - dropping `"abc"` → assignments unchanged and `onChange` not called;
    - dropping the id of a set not already in that column → the assignment is set and `onChange` is called.
- [ ] T028 [P] [US4] Extend `packages/web/src/__tests__/settings-modal.test.ts`, which T016 creates: type `6.5` into the first `.settings-input-number`, dispatch `change`, and expect `7` in the input and in stored `quickTierRolls[0]`. `numberInput` is module-private, so the test must go through the DOM.

### Implementation for User Story 4

- [ ] T029 [US4] In `packages/web/src/quick-generator.ts`, add and export two helpers:
  - `parseDroppedSetId(text: string | undefined): number | null` returns `Number(text)` when that is a key of `ARTIFACT_SET_NAMES`, and `null` otherwise;
  - `normalizeRolls(value: number): number` returns `Math.round(value)` clamped to 1…9.

  Each tier rolls handler (lines 698–720) keeps its current guard and adds the rounding:
  - `input`: keep `if (!raw || raw < 1 || raw > 9) return;`, then store `normalizeRolls(raw)`;
  - `blur`: store `normalizeRolls(Number(rollsInput.value) || tier.rolls)` and show it in the input;
  - `wheel`: store `normalizeRolls(Number(rollsInput.value) + (e.deltaY < 0 ? 1 : -1))` and show it in the input.

  The tier-column (lines 781–790) and ore-reroll-column (lines 1052–1061) drop handlers return early when `parseDroppedSetId` gives `null`. Leave the ore pool's drop handler (lines 1098–1106) unchanged.
- [ ] T030 [P] [US4] In `packages/web/src/settings-modal.ts`, make `numberInput` (lines 181–185) round before clamping: `Math.max(min, Math.min(max, Math.round(Number(input.value)) || value))`.

**Checkpoint**: The UI can no longer write values the schemas reject. T026–T028 pass.

---

## Phase 7: User Story 5 - Maintainers can change a stored format safely (Priority: P3)

**Goal**: Show that the upgrade chain protects future format changes. Old ids are upgraded before they meet the current tables, and a faulty upgrade step fails the load. The loader itself (T003) and the bump rule are foundational.

**Independent Test**: A toy format with a renumbered id: the old version accepts it, the upgrade step maps it, and the current version rejects it unmapped. No loader change is needed.

### Tests for User Story 5 ⚠️

- [ ] T031 [US5] Extend `packages/web/src/__tests__/versioned.test.ts`:
  - a toy format whose ids are renumbered between two versions: an id valid only in the old numbering passes the old version's schema and is mapped by the upgrade step, and the same id reaching the current version unmapped is rejected. The loader needs no change for this;
  - an upgrade step whose output fails the next version's schema → `invalid`.

**Checkpoint**: All user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Type safety, coverage cross-check and the pre-commit gate

- [ ] T032 Run `npm run build`, then `npx tsc -p packages/web/tsconfig.json --noEmit`.
  - Fix every error it reports in `packages/web/src/versioned.ts`, `quick-state-format.ts`, `fmbl-format.ts`, `quick-generator.ts`, `settings.ts`, `settings-modal.ts` and `main.ts`.
  - In `packages/web/src/share.ts`, only the two existing `Uint8Array`/`BufferSource` errors in `compress`/`decompress` may remain.
  - Do not fix the existing errors in `packages/web/src/render.ts` or in test files; they are out of scope.
- [ ] T033 Cross-check `specs/001-stored-format-versioning/quickstart.md`, section "Test plan", against the test files in `packages/web/src/__tests__/`. Every listed case must exist, and each upgrade step must have its own test with a fixture in that version's shape.
- [ ] T034 Run `npm run build && npm test && npm run lint` from the repository root. Every existing test in `packages/web/src/__tests__/share.test.ts`, `settings.test.ts` and `quick-generator.test.ts` must pass unchanged, and lint must report no unused declarations or imports (e.g. `QuickBlock` in `main.ts`, the removed `share.ts` constants).

---

## Discovered — Out of Scope

- **`packages/web` is never type-checked, and `CLAUDE.md` says it is.**
  - `packages/web/package.json` builds with `vite build`, which strips types without checking them. vitest only transpiles, and eslint uses the non-type-aware set. `CLAUDE.md` ("Build & Test": "Type check: covered by `npm run build`") is true only for core and cli.
  - `npx tsc -p packages/web/tsconfig.json --noEmit` already reports errors on `main` in `share.ts:68` and `:93`, `render.ts:135` and several test files.
  - Out of scope: this feature only requires its own source files to be clean (T032).
  - Recommendation: a human files a separate issue to add a web type-check step to the build or CI, fix the existing errors, and correct `CLAUDE.md`.
- **The settings modal rejects a typed 0.**
  - `packages/web/src/settings-modal.ts:182` computes `Number(input.value) || value`. Typing `0` into the rank-5 roll adjustment field, whose minimum is 0, therefore reverts to the value the form was rendered with, so 0 can't be entered there.
  - T030 keeps that `|| value` fallback and only adds rounding.
  - Out of scope: this feature only requires rounding (FR-015); zero handling is a separate UX fix.
  - Recommendation: a human files a separate small issue.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: T003 depends on T001. T002 and T004 can start immediately. Phase 2 blocks all user stories.
- **US1 (Phase 3)**: Depends on Foundational.
- **US2 (Phase 4)**: Depends on US1. It edits `share.ts`, `main.ts` and `settings.ts`, which US1 reworked, and extends US1's test files.
- **US3 (Phase 5)**: Depends on US1 and on T018 (the `share.ts` error types).
- **US4 (Phase 6)**: Depends on Foundational (T004 edits the same `quick-generator.ts`) and on T016, which creates `settings-modal.test.ts`. Otherwise it is independent of US1–US3.
- **US5 (Phase 7)**: Depends on Foundational only (it extends T002's test file).
- **Polish (Phase 8)**: Depends on all stories.

### Within Each User Story

- Write the tests first and confirm they fail.
- Formats (T009–T011) come before their consumers (T012, T013).
- `share.ts` changes are sequential: T012 → T018 → T025. So are `main.ts` changes (T013 → T019), `settings.ts` changes (T011 → T020), `settings-modal.ts` changes (T021 → T030) and `quick-generator.ts` changes (T004 → T029).

### Parallel Opportunities

- Phase 2: T002 and T004. T003 runs once T001 is done.
- US1 tests: T005, T006, T007 and T008 together. US1 implementation: T010 and T011 alongside T009.
- US2 tests: T014–T017 together. T020 alongside T018.
- US3 tests: T022–T024 together.
- US4 tests: T026, T027 and T028 together. T030 alongside T029.
- US5 (T031) can run alongside any phase after Phase 2.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
Task: "Write packages/web/src/__tests__/quick-state-format.test.ts (per-version fixtures + round trip)"
Task: "Write packages/web/src/__tests__/fmbl-format.test.ts (isAnd, mainStats default, round trip)"
Task: "Extend packages/web/src/__tests__/settings.test.ts (v1, nothing written on load, envelope, per-field fallback)"
Task: "Extend packages/web/src/__tests__/share.test.ts (envelope, bare state, v1 link)"

# Then the formats, together:
Task: "Implement packages/web/src/quick-state-format.ts"
Task: "Implement packages/web/src/fmbl-format.ts"
Task: "Rework packages/web/src/settings.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001).
2. Phase 2: Foundational (T002–T004).
3. Phase 3: US1 (T005–T013). Every format is versioned and old data loads.
4. **Stop and validate**: T005–T008 pass, and `npm run build && npm test && npm run lint` is green.

### Incremental Delivery

1. Setup + Foundational: the loader is ready.
2. US1: formats versioned, old data loads (MVP).
3. US2: newer-version data refused clearly.
4. US3: broken data refused with a reason; link parity proven.
5. US4: the UI stops writing rejected values.
6. US5: guarantees for maintainers tested.
7. Polish: tsc, coverage cross-check, and the full gate before the PR.

---

## Notes

- `[P]` tasks touch different files and have no dependencies on incomplete tasks.
- The spec for every task lives in `specs/001-stored-format-versioning/`: plan.md, data-model.md, contracts/ and quickstart.md.
- Commit after each task or logical group, and run `npm run build && npm test && npm run lint` before every commit.
