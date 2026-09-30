# Research: Versioned Stored Formats

Technical Context has no open unknowns. Every decision below was made during the design review, and its facts were checked against the code and the git history. Each entry records the decision, the reason, and the alternatives that were rejected.

## R1. One generic loader, with the schema and error handling per format

- **Decision**: One loader (`versioned.ts`) runs the same pipeline for every format. It reads the envelope, checks the version, parses with the version's schema, runs the steps and re-parses. What differs per format is its schemas and its error handling. The loader returns a result union and never throws, and each format's wrapper maps that result to its own behaviour.
- **Rationale**: The four loaders share all of their logic except the schema and the failure handling: tab-bar message for files, message after the fallback tab for links, defaults for settings.
- **Alternatives considered**:
  - Separate hand-written chains per format: duplicates the pipeline.
  - A generic registry with per-format `onNewer`/`onInvalid` callbacks: pushes UI concerns into the format definitions.

## R2. A zod schema for every version, not only the current one

- **Decision**: Every version has a structural zod schema, and each `up` step is typed against the previous version's output. The loader parses the input with its own version's schema, then after every step re-parses with the next version's schema, ending with the current one.
- **Rationale**: Share-link input is untrusted, so validating it before any step touches it keeps steps simple and typed. Re-parsing catches a step that emits the wrong shape.
- **Alternatives considered**: A schema for the current version only, with steps on raw JSON. That means less code, but steps would receive unvalidated, possibly crafted data, and they would be untyped.

## R3. Id checks run on the current version only ("migrate first, validate second")

- **Decision**: Checks against today's id tables (`ARTIFACT_SET_NAMES`, `ACCESSORY_SET_IDS`, `FACTION_NAMES`, `SUBSTAT_PRESETS`, `GOOD_SUBSTATS`) and cross-field checks live in one `superRefine` on the current version. Past versions check structure only. When a version is added, the refinement moves to it, and the old version joins `past` unchanged.
- **Rationale**: The faction renumbering changes what ids mean. An old id has to pass its old schema, be mapped by the step, and only then meet today's table. Today `share.ts` would reject an old link before anything could migrate it.
- **Alternatives considered**: Freezing a copy of each id table per version. That is heavy, and forgetting to strip the live checks from an old schema would reject exactly the data the migration exists for.

## R4. Every format uses an envelope `{ version, <dataKey> }`, settings included

- **Decision**: `.fqbl` and links store `{ version, state }`, `.fmbl` stores `{ version, groups }`, and settings store `{ version, settings }`. The data keys keep the names existing files already use.
- **Rationale**: This is the owner's model: version and metadata at the top, the data nested. The loader can then own envelope handling for every format.
- **Alternatives considered**:
  - Flat settings `{ version, …fields }`. This would keep a tab that still runs pre-change code working: that code shallow-merges storage, and an envelope makes it see only defaults. Rejected: the window is narrow and one-time. It needs a tab left open across the release, settings saved by a newer tab, and a filter generated in the old tab before it reloads. Such a tab reads `rank5RollAdjustment` and `oreRerollColumns` at generation time, so it would use default thresholds until reloaded.
  - A common data key `data` for all formats. Renaming the existing file keys would itself be a format change.

## R5. Share links share the `.fqbl` version number and chain; the version sits inside the payload

- **Decision**: A link's compressed JSON is `{"version":4,"state":{…}}`, the same document as a `.fqbl` file, and both use one chain.
- **Rationale**: A migration written once then applies to saved files and links alike.
- **Alternatives considered**: The version in the hash key (e.g. `#q4=`). This would separate the version from the data it describes. An old app would ignore an unknown hash prefix entirely, while with the chosen design it reports a failed link.

## R6. An unversioned link is loaded as v4

- **Decision**: A link payload without a `version` key is bare quick-state data at version 4.
- **Evidence**: Links were introduced on 2026-02-12 (947d553), when `.fqbl` was at v3 (4ced912, 2026-02-08). v4 (180a6ba, 2026-02-14) only added optional fields (`customProfiles`, `selectedCustom`). `strict` came later (3deaad9, 2026-02-17) without a bump. Every unversioned link is therefore a valid v4 document.

## R7. The link variant is strict and has exact parity; the file variant is tolerant

- **Decision**: One factory builds two variants.
  - **Link**: every object `.strict()`, today's size limits, and `<>&"'` stripped after length checks. It accepts exactly the links today's validator accepts, and every existing `share.test.ts` test passes unchanged.
  - **File**: unknown keys dropped, no size limits, strings kept.
- **Rationale**: Links are untrusted input, and today's allowlist design is deliberate (`share.test.ts:608` tests unknown-key rejection). Files have to tolerate legacy keys: `.fmbl` groups saved on 2026-02-10 carry `isAnd` (added in 744eb8c, removed in 368bab2 without a bump). The UI also allows more than 10 blocks in a file; the share button refuses more than 10.
- **Alternatives considered**: Strip mode everywhere, which would change the existing link behaviour and tests. Strict mode everywhere, which would lock users out of files that hold legacy keys.

## R8. zod 3 specifics

- **Record keys must be checked in the record's key schema.** zod 3.25.76's `ZodRecord` passes every key to `ParseStatus.mergeObjectSync`, which silently skips `"__proto__"` (`v3/helpers/parseUtil.js:94`). A key check or transform that runs after parsing never sees it. The key schema refines `Number.isInteger(Number(k))`, so `"__proto__"` fails, and records are rebuilt with `Number(key)` keys as today.
- **`.strict()` objects walk keys with `for…in`,** so a top-level own `__proto__` from `JSON.parse` is reported as unrecognised. The existing top-level test keeps passing.
- **`.catch(value)` returns the same object on every failure,** and the modal mutates `quickTierRolls`/`oreRerollColumns` in place. Array fallbacks must be factories (`.catch(() => [...])`), and every defaults path must return fresh copies. `.default(value)` does not alias, because it re-parses through the inner array schema.
- **Optional fields use `.optional()` only,** because today `null` is rejected. Labels use `.refine((s) => s.length > 0)` with no trim, because today `"   "` is accepted.

## R9. Newer-version handling per format

- **Decision**:
  - **Files**: refused with "saved by a newer version of the app (vN; this page reads up to vM). Reload the page to update."
  - **Links**: `NewerVersionError`. After the default tab opens, the message is "This link was made with a newer version of the app. Reload the page to open it." The `#q=` hash is kept, so a reload that fetches the newer app can open the link.
  - **Settings**: defaults for the page load and no writes. The modal shows a note and disables its inputs, selects and Reset.
- **Rationale**: Never load half-understood data, and never lose newer data.
- **Alternatives considered for settings**:
  - Defaults, but overwrite on the first edit: loses the newer settings.
  - Read the known keys anyway: loads half-understood values that feed rule generation.

## R10. Settings lifecycle

- **Decision**:
  - Stored settings without `version` are v1.
  - Each field falls back to its default on its own, when missing or invalid.
  - A `version` that is not a positive integer counts as corrupt, not newer: defaults are used and the next save replaces it.
  - Migration happens in memory. Storage is written only when the user changes a setting, and always as the current version.
  - Every storage read is inside a try, because `localStorage` is undefined in vitest's Node environment and most suites reach `getSettings()` indirectly.
- **Rationale**: This is the owner's rule: loading migrates up to the current version, and the app only writes its current version. Opening the app never rewrites storage on its own.

## R11. UI paths that can write rejected values are fixed; nothing is repaired on load

- **Decision**:
  - The tier rolls input (`input`/`blur`/`wheel`) and the settings `numberInput` round before clamping.
  - The tier and ore-reroll drop handlers ignore dropped text that isn't a known set id.
  - Existing files that already hold such values are refused with the exact reason.
- **Evidence**:
  - `quick-generator.ts:698-708` stores a typed `6.5` unrounded.
  - The drop handlers at `:784-788` and `:1055-1059` store `Number(text)` unchecked, so foreign text writes a `"NaN"` key.
  - `settings-modal.ts:182` does not round either.
- **Alternatives considered**: Repair on load (round rolls, drop unknown keys). It is more code and softens the "refuse, don't guess" rule. The owner chose not to repair.

## R12. Bump rule

- **Decision**: Bump a format's version whenever what it stores changes shape or meaning, including a new optional field, and add the step. An identity step is fine.
- **Rationale**: With strict link schemas, an unbumped addition makes an older app call a newer link "damaged" instead of "newer, reload". History shows the bumps were inconsistent: `rareAccessories`, `oreReroll` and `strict` were added without one.

## R13. Type checking and lint constraints

- **Facts**:
  - `npm run build` runs `vite build` for web, which does not type-check. vitest transpiles only. eslint uses the non-type-aware `recommended` set.
  - On `main`, `npx tsc -p packages/web/tsconfig.json --noEmit` reports errors in `quick-generator.ts:116`, `share.ts:68/93`, `render.ts:135` and test files.
  - The command must run after `npm run build`, because `@rslh/core` resolves through `packages/core/dist`.
- **Decisions**:
  - Add a tsc acceptance criterion for the touched source files.
  - Change 3 fixes `quick-generator.ts:116`. The other existing errors are out of scope.
  - Round-trip tests pin the schema/type agreement at runtime, because a declared type does not catch a forgotten optional field.
  - Avoid `any` in steps (`no-explicit-any`) and unused `_check` declarations (`no-unused-vars`). Removing `FqblFileV1` leaves the `QuickBlock` import in `main.ts:9` unused, so drop it.

## R14. `.fmbl` schema scope

- **Decision**:
  - No numeric ranges on groups.
  - `mainStats` defaults to `[]`.
  - Id checks on sets, slots, stat ids and faction (0 = any).
- **Evidence**:
  - Groups from the Quick Generator's Generate button carry `rolls: 0`, `rank: 0` and `rarity: 0` (per-faction accessory groups and the strict catch-all, `main.ts:640`), and `walkbackDelay: 1` (ore reroll). They can be saved as `.fmbl` from the Generator tab.
  - `.fmbl` files saved between 55f16fd (2026-02-07 21:55) and e261424 (23:10) lack `mainStats`. Today they fail to render (`generator.ts:395`).
  - The Generator tab sets rolls through a range slider, so the manual UI writes only integers.

## R15. Quick-state version history

- **Evidence**:
  - v1 (before 9f05cdb): one flat block `{ tiers (with color), assignments, selectedProfiles }`.
  - v2 (9f05cdb, 2026-02-08): `{ blocks }`.
  - v3 (4ced912, 2026-02-08): tier colours stripped from saved files. `rareAccessories` and `oreReroll` were added during v3 (7b61c56, 4b36aba on 2026-02-09).
  - v4 (180a6ba): `customProfiles` and `selectedCustom`. `strict` was added during v4.
  - Default tier colours are unchanged since v2, so dropping saved colours in the v2→v3 step changes nothing visible.
  - `SUBSTAT_PRESETS` has held the same 4 entries since before the Quick Generator existed. Set ids and `ACCESSORY_SET_IDS` have only ever grown, so today's tables accept every id ever written.

## R16. Decisions live in importable modules; `main.ts` only displays them

- **Decision**:
  - `versioned.ts` exports `loadFileText(format, fileLabel, text)`, shared by both file formats. It parses, loads and returns either the value or the full tab-bar message.
  - `share.ts` exports `resolveSharedLink(hash)`, which returns `null`, `{ state }` or `{ error, cause }` and never rejects.
  - `main.ts` calls these helpers and displays the result. For links, the message goes into the tab-bar error after `addTab`.
- **Rationale**: `main.ts` runs DOM code at import time, so no test can import it. Without these seams, FR-009 and the file-load messages would be checked only by hand. The one rule left in `main.ts` is to set the message after `addTab`, because `addTab` hides the error bar. It is stated in T019 and covered by the manual checks in quickstart.md.
- **Alternatives considered**: Importing `main.ts` under jsdom with the full `index.html` DOM. That is heavy and brittle, because `main.ts` wires every toolbar and imports `README.md?raw`.
- **Handlers in `quick-generator.ts`**: these render into `#quick-tiers` only, so a jsdom test drives the real rolls-input and drop handlers directly (`quick-generator-dom.test.ts`) instead of testing only their helpers.
