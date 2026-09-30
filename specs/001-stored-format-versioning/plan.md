# Implementation Plan: Versioned Stored Formats

**Branch**: `001-stored-format-versioning` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-stored-format-versioning/spec.md`

## Summary

The web app persists four formats of its own: Quick Generator files (`.fqbl`), share links (`#q=…`), Generator files (`.fmbl`) and settings in `localStorage`. Only `.fqbl` has a migration chain, and it lives in `main.ts`, where no test reaches it. Share links and settings carry no version. A planned follow-up renumbers five `FACTION_NAMES` ids, so every stored format must say which numbering it was written with, and old data must be migrated *before* it is checked against the new table.

Technical approach, decided during the design review (see [research.md](./research.md)):

- One shared loader (`packages/web/src/versioned.ts`) owns a `{ version, <dataKey> }` envelope. Each format declares a zod schema for every version, an `up` step between consecutive versions, and one id-table refinement on the current version only.
- The quick state has one chain (v1–v4) used by `.fqbl` files and share links, built in two variants: a strict, size-limited, sanitising link variant with exact parity to today's `share.ts` validator, and a tolerant file variant.
- `.fmbl` (v1) and settings (v1) get their own formats.
- Newer-version data is refused per format. Files show a reload message. Links show a reload message and keep the hash. Settings fall back to defaults, are never overwritten, and the settings modal locks.
- Three UI paths that can write values the new schemas reject are fixed: tier rolls input, set drop handlers, and the settings number inputs.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM (`"type": "module"`), npm workspaces
**Primary Dependencies**: zod 3 (`^3.24.0`, locked 3.25.76; newly a direct dependency of `packages/web`), vite 6, `@rslh/core` id tables
**Storage**: `.fqbl`/`.fmbl` JSON files (download/upload); URL hash (deflate-raw + base64url JSON); browser `localStorage` key `rslh-settings`
**Testing**: vitest (Node environment by default; `// @vitest-environment jsdom` per file for DOM tests), fast-check property tests with regression replay
**Target Platform**: Modern browsers; static site on GitHub Pages
**Project Type**: Web application inside a TypeScript monorepo (`packages/web`, depends on `packages/core`)
**Performance Goals**: N/A. Documents are small (share links are capped at 16 KB decompressed).
**Constraints**:
- The link variant must accept exactly the links today's `share.ts` validator accepts.
- New modules must not touch the DOM, so tests can import them.
- The repo is public: nothing committed may reference private repositories, local paths or personal handles.
- `packages/web` is not type-checked by build, test or lint (see Constitution Check).

**Scale/Scope**: 4 stored formats, 3 version chains, 3 new modules, 5 edited modules, 5 new and 3 extended test files

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

No project constitution exists (`.hivemind/specify/memory/constitution.md` is absent). The gates below come from the repository's `CLAUDE.md` and tooling:

| Gate | Source | Status |
|---|---|---|
| `npm run build && npm test && npm run lint` pass before every commit (no git hooks) | CLAUDE.md "Build & Test" | PASS (planned as the final acceptance criterion) |
| Tests live in `packages/*/src/__tests__/` | CLAUDE.md "Architecture" | PASS: all new tests go to `packages/web/src/__tests__/` |
| ESLint flat config with `tseslint.configs.recommended`, so `no-explicit-any` and `no-unused-vars` are errors | `eslint.config.js` | PASS: the design avoids `any` in steps and leaves no unused declarations (see research R13) |
| Public repo: no references to private repositories, local paths or handles in committed text | Repository policy | PASS: artifacts reviewed |
| Changes land via feature branch and PR; `main` is protected (required check `build`, 1 review) | Repository settings | PASS: the coordinator drives the PR |
| Type checking | CLAUDE.md claims `npm run build` covers it | NOTE: true for core and cli only. `packages/web` builds with `vite build`, which does not type-check, and `npx tsc -p packages/web/tsconfig.json --noEmit` already reports errors on `main`. This plan adds an explicit tsc criterion for the touched source files and runtime round-trip tests (research R13). |

Post-design re-check: PASS. The design adds no new package or project, and no gate is violated.

## Project Structure

### Documentation (this feature)

```text
specs/001-stored-format-versioning/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: formats, versions, fields, validation rules
├── quickstart.md        # Phase 1: how to verify, and the test plan
├── contracts/
│   ├── versioned-loader.md    # loader API, algorithm, messages
│   ├── stored-documents.md    # document shapes per format and version
│   └── module-interfaces.md   # exports and UI behaviour per touched module
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit.tasks), not created here
```

### Source Code (repository root)

```text
packages/web/
├── package.json                    # + "zod": "^3.24.0"
└── src/
    ├── versioned.ts                # NEW: shared loader (no DOM)
    ├── quick-state-format.ts       # NEW: quick-state versions v1–v4, file and link variants
    ├── fmbl-format.ts              # NEW: .fmbl versions (v1)
    ├── quick-generator.ts          # EDIT: Stored* types, strip/restore retyped, change-9 helpers + handlers
    ├── share.ts                    # EDIT: hand-written validators replaced by the loader; NewerVersionError
    ├── settings.ts                 # EDIT: SETTINGS_FORMAT, versioned get/save, settingsFromNewerVersion
    ├── settings-modal.ts           # EDIT: newer-version lock; numberInput rounding
    ├── main.ts                     # EDIT: .fqbl/.fmbl save+load via the loader; share-link error surfacing
    └── __tests__/
        ├── versioned.test.ts           # NEW
        ├── quick-state-format.test.ts  # NEW
        ├── fmbl-format.test.ts         # NEW
        ├── settings-modal.test.ts      # NEW (jsdom)
        ├── quick-generator-dom.test.ts # NEW (jsdom): rolls-input and drop handlers
        ├── share.test.ts               # EXTEND (existing tests unchanged)
        ├── settings.test.ts            # EXTEND (existing tests unchanged)
        └── quick-generator.test.ts     # EXTEND (existing tests unchanged)
```

**Structure Decision**: All changes stay inside `packages/web`. `packages/core`'s id tables (`ARTIFACT_SET_NAMES`, `ACCESSORY_SET_IDS`, `FACTION_NAMES`, `ARTIFACT_SLOT_NAMES`, `STAT_NAMES`) are read, never changed. The new modules sit flat in `src/`, matching the package's existing layout.

## Implementation Outline

Note on type checking: nothing type-checks `packages/web` today. Its build is `vite build`, which strips types without checking them; vitest only transpiles; eslint uses the non-type-aware `recommended` set.

Run `npx tsc -p packages/web/tsconfig.json --noEmit` after `npm run build`, because the web project resolves `@rslh/core` through `packages/core/dist`. On `main` that command reports errors in:
- `quick-generator.ts:116`, fixed by change 3;
- `share.ts`: `Uint8Array` vs `BufferSource` in `compress`/`decompress`;
- `render.ts:135`;
- several test files.

The last three are out of scope; do not fix them here. The source files this issue adds or edits must be clean under that command, apart from those existing `share.ts` errors. Test files are out of scope. Declared types only catch a missing or mistyped required field, not a forgotten optional one, so round-trip tests cover the rest.

### 1. Add zod to the web package

- File: `packages/web/package.json` (and `package-lock.json` via `npm install`)
- Add `"zod": "^3.24.0"` to `dependencies`, the same range `packages/core` uses (the lockfile resolves 3.25.76). Use the zod 3 API: `import { z } from "zod"`.

### 2. Shared loader

- File: `packages/web/src/versioned.ts` (new; no DOM access)
- Full API, algorithm, issue strings, message wording and the bump-rule comment: [contracts/versioned-loader.md](./contracts/versioned-loader.md).
- A step receives `unknown` and casts it to the previous schema's `z.output<…>`. Do not type steps with `any`.
- Declaring each format with its type (e.g. `QUICK_STATE_FILE_FORMAT: VersionedFormat<StoredQuickGenState>`) is itself the schema-vs-type check. Do not add a separate unused `_check` const or type, because `no-unused-vars` flags it.
- Also export `loadFileText(format, fileLabel, text)`, shared by `.fqbl` and `.fmbl`. It parses the text, loads it, and returns either the value or the complete tab-bar message. This keeps the decision out of `main.ts`, which runs DOM code on import and cannot be unit-tested.

### 3. A type for the stored quick state

- File: `packages/web/src/quick-generator.ts`
- Export `SetTier` and add `StoredSetTier`, `StoredQuickBlock` and `StoredQuickGenState` (tiers without `color`). See [data-model.md](./data-model.md).
- Retype `stripBlockColors(state: QuickGenState): StoredQuickGenState` and `restoreBlockColors(state: StoredQuickGenState): QuickGenState`. Restore assigns each tier `defaultColors[i] ?? "#e5e7eb"`. The existing strip-then-restore tests keep passing unchanged.

### 4. Quick-state versions

- File: `packages/web/src/quick-state-format.ts` (new)
- Versions v1–v4, structural checks, the current-version id refinement, the `idRecord` key-schema helper and the file and link variants are specified in [data-model.md](./data-model.md). Document shapes are in [contracts/stored-documents.md](./contracts/stored-documents.md).
- Exports `QUICK_STATE_FILE_FORMAT` and `QUICK_STATE_LINK_FORMAT` (both `VersionedFormat<StoredQuickGenState>`).
- The link variant must accept exactly the links `share.ts`'s current hand-written validator accepts. That validator is the spec for the port.

### 5. Share links on the loader

- File: `packages/web/src/share.ts`
- Remove the hand-written validators (`validateTier`, `validateBlock`, `validateRareAccessories`, `validateOreReroll`, `validateCustomProfile`, `validateQuickGenState`) and everything else that only they used. That includes the helpers, the link-limit constants that moved to the link variant, `MAX_TIERS`, `MAX_ORE_COLUMN` and `MAX_CUSTOM_PROFILE_STATS`, the `VALID_*` and `MAX_PROFILE_INDEX` lookups, and the imports that fed them. Leftovers fail `no-unused-vars`.
- Keep `fail()`, which the gates and `decompress` also use. Keep the transport gates (`MAX_ENCODED_LENGTH`, `MAX_BINARY_SIZE`, `MAX_DECOMPRESSED_SIZE`, the base64url alphabet check) and the compression helpers.
- `encodeState` writes `{"version":4,"state":{…}}`. `decodeState` runs the gates, then `JSON.parse`, then `loadVersioned(QUICK_STATE_LINK_FORMAT, data)`:
  - `ok` → `restoreBlockColors(value)`;
  - `newer` → throw `NewerVersionError`;
  - anything else → throw `Invalid shared state`.
- Invalid JSON (a `SyntaxError` today) and base64 that `atob` refuses (a `DOMException` today, e.g. `"A"`) are wrapped into `Invalid shared state`.
- Add `sharedLinkErrorMessage(err)`.
- Add `resolveSharedLink(hash)`, which returns `null`, `{ state }` or `{ error, cause }` and never rejects, so the startup decision can be unit-tested outside `main.ts`.
- Details: [contracts/module-interfaces.md](./contracts/module-interfaces.md).

### 6. `.fmbl` versions

- File: `packages/web/src/fmbl-format.ts` (new)
- One version so far (`past` is empty). Fields, the `mainStats` default, the absence of numeric ranges, the id refinement and the dropped legacy `isAnd` are specified in [data-model.md](./data-model.md).
- Exports `FMBL_FORMAT: VersionedFormat<SettingGroup[]>`.

### 7. Settings on the loader

- Files: `packages/web/src/settings.ts`, `packages/web/src/settings-modal.ts`
- `SETTINGS_FORMAT: VersionedFormat<UserSettings>` (`dataKey: "settings"`, `unversioned: 1`, `past: []`). Storage becomes `{"version":1,"settings":{…}}`.
- Per-field fallback. Array fallbacks are factories that return fresh copies. Every storage read (in `getSettings`, `saveSettings` and `settingsFromNewerVersion`) sits inside a try.
- Migration happens in memory. `saveSettings` never writes over newer settings.
- `settingsFromNewerVersion()`. The modal shows a note and locks its controls, Reset included.
- Details: [data-model.md](./data-model.md) and [contracts/module-interfaces.md](./contracts/module-interfaces.md).

### 8. Wire the loaders into `main.ts`

- File: `packages/web/src/main.ts`
- Remove `migrateFqbl`, `FQBL_CURRENT_VERSION`, `FqblFileV1` and the `FmblFile` / `FqblFile` interfaces. Drop `QuickBlock` from the type import on line 9, since its only use was `FqblFileV1`.
- `.fqbl` save uses `JSON.stringify(wrap(QUICK_STATE_FILE_FORMAT, stripBlockColors(tab.quickState)), null, 2)`.
- `.fqbl` load calls `loadFileText(QUICK_STATE_FILE_FORMAT, ".fqbl", text)`. On `ok` it uses `restoreBlockColors(value)`. On `error` it shows the returned message in the tab-bar error, e.g. `Failed to load .fqbl: not a valid .fqbl file (not JSON)`.
- `.fmbl` works the same way with `FMBL_FORMAT` and `".fmbl"`.
- Replace `loadSharedState` (lines 1138–1147) with `resolveSharedLink(location.hash)`. When it returns `{ error, cause }`, the startup block (lines 1149–1160) keeps the `console.warn` (logging `cause`) and still opens the default tab. After `addTab(settings.defaultTabType)`, which hides the error bar, it shows `error` in the tab-bar error. The `#q=` hash is kept.

### 9. Stop the UI writing values the schemas reject

- File: `packages/web/src/quick-generator.ts`
  - Tier rolls `input`/`blur`/`wheel` handlers (lines 698–720): each keeps its current guard and adds rounding through `normalizeRolls(value: number): number`, which rounds with `Math.round` and clamps to 1…9:
    - `input`: keep `if (!raw || raw < 1 || raw > 9) return;`, then store `normalizeRolls(raw)`;
    - `blur`: store `normalizeRolls(Number(rollsInput.value) || tier.rolls)`;
    - `wheel`: store `normalizeRolls(Number(rollsInput.value) + (e.deltaY < 0 ? 1 : -1))`.
  - Callers never pass `NaN`: a number input's value is a valid number or `""`, and `Number("")` is 0.
  - Tier-column (lines 781–790) and ore-reroll-column (lines 1052–1061) drop handlers ignore the drop unless `parseDroppedSetId(text: string | undefined): number | null` returns an id. It returns `Number(text)` when that is a key of `ARTIFACT_SET_NAMES`, else `null`. The ore pool's drop handler (lines 1098–1106) only deletes and needs no change.
  - Export both helpers.
- File: `packages/web/src/settings-modal.ts`: `numberInput` (lines 181–185) rounds before clamping.
- No repair on load. Files that already hold such values are refused with the exact reason, and such a settings field falls back to its default.

## Testing

The full per-file test plan is in [quickstart.md](./quickstart.md#test-plan).

- New: `versioned.test.ts`, `quick-state-format.test.ts`, `fmbl-format.test.ts`, `settings-modal.test.ts` (jsdom), and `quick-generator-dom.test.ts` (jsdom, drives the real rolls-input and drop handlers).
- Extended: `share.test.ts`, `settings.test.ts`, `quick-generator.test.ts`. Their existing tests stay unchanged.

## Acceptance Criteria

- [ ] `packages/web` depends on `zod` directly (`^3.24.0`)
- [ ] `packages/web/src/versioned.ts` exists, has no DOM access, and carries the bump-rule comment
- [ ] `.fqbl`, share links, `.fmbl` and settings all load through `loadVersioned` with a zod schema per version; `migrateFqbl` and the hand-written validators in `share.ts` are gone
- [ ] Only the current version's schema checks ids against today's tables
- [ ] Share links are written as `{ version: 4, state }`, and links without a version still open (as v4)
- [ ] `"__proto__"` keys inside `assignments`, `oreReroll.assignments` and `rareAccessories.selections` are rejected in links, as today
- [ ] Every existing test in `share.test.ts`, `settings.test.ts` and `quick-generator.test.ts` passes unchanged
- [ ] Data from a newer version produces: the "newer version … reload" message for `.fqbl` and `.fmbl`; `NewerVersionError` and its message for links; for settings, defaults, no writes, and the modal note with disabled controls
- [ ] A shared link that fails to open shows a message in the tab bar after the default tab opens, and the `#q=` hash is kept
- [ ] `.fmbl` files whose groups carry `isAnd`, or lack `mainStats`, load
- [ ] A decimal typed into a tier's rolls input or a settings field is stored rounded, and dropping text that isn't a known set id onto a tier or ore-reroll column changes nothing
- [ ] Each upgrade step has its own test with a fixture in that version's shape
- [ ] `loadFileText` and `resolveSharedLink` are unit-tested, and `main.ts` only displays what they return
- [ ] After `npm run build`, `npx tsc -p packages/web/tsconfig.json --noEmit` reports no errors in `versioned.ts`, `quick-state-format.ts`, `fmbl-format.ts`, `quick-generator.ts`, `settings.ts`, `settings-modal.ts` or `main.ts`, and no errors in `share.ts` beyond the two existing `Uint8Array`/`BufferSource` errors in `compress`/`decompress`. Errors in `render.ts` and in test files are out of scope.
- [ ] `npm run build && npm test && npm run lint` pass

## Complexity Tracking

No constitution violations to justify.
