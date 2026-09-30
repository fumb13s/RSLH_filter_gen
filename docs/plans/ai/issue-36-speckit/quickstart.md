# Quickstart: Verifying Versioned Stored Formats

## Setup

```bash
npm install          # pulls zod into packages/web
npm run build        # core must build first: web resolves @rslh/core via packages/core/dist
```

## Automated checks

```bash
npm test
npm run lint
npx tsc -p packages/web/tsconfig.json --noEmit
```

The tsc command must report no errors in `versioned.ts`, `quick-state-format.ts`, `fmbl-format.ts`, `quick-generator.ts`, `settings.ts`, `settings-modal.ts` or `main.ts`. In `share.ts`, only the two errors that already exist in `compress`/`decompress` (`Uint8Array` vs `BufferSource`) are allowed. Errors in `render.ts` and in test files already exist on `main` and are out of scope.

To run one suite: `npx vitest run packages/web/src/__tests__/versioned.test.ts`.

## Manual checks (`npm run dev`)

1. **Old `.fqbl`.** Save a hand-written v1 file, `{ "version": 1, "state": { "tiers": [4 tiers with "color"], "assignments": {...}, "selectedProfiles": [0] } }`, and load it with **Load .fqbl**. It opens as one block and colours come from the defaults.
2. **Newer `.fqbl`.** Change `"version"` to `5` and load it. Expect `Failed to load .fqbl: this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.`
3. **Newer link.** Build a payload `{"version":5,"state":{…}}` with the test helper in `share.test.ts`, and open `/#q=<payload>`. Expect the default tab, the newer-link message, and the hash still in the address bar.
4. **Damaged link.** Open `/#q=A`. Expect the default tab and `This shared link couldn't be opened. It may be incomplete or damaged.`
5. **Newer settings.** In devtools, set `localStorage["rslh-settings"] = '{"version":2,"settings":{}}'` and reload. The app uses defaults. The settings modal shows the note, and its inputs, selects and Reset are disabled. After interacting, the stored value is unchanged.
6. **Rounding and drops.** Type `6.5` into a tier's rolls input and blur: it becomes 7. Drag text from another page onto a tier column: nothing changes.

## Test plan

### `packages/web/src/__tests__/versioned.test.ts` (new)

Use a toy format with two past versions and a current one.

- A current-version envelope → `ok`.
- A v1 envelope → every step runs. A step whose output fails the next schema → `invalid`.
- A version above the current one → `newer` with `found` / `supported`, even when the envelope has extra keys and `strictEnvelope` is set.
- For a format without `unversioned`: a missing `version` → `invalid` with `missing "version"`, and a non-object → `not an object`. With `unversioned` set, a version-less object is bare data at that version instead.
- A non-integer, zero or negative `version` → `invalid` with `version must be a positive integer`.
- A missing data key → `missing "<dataKey>"`. With `strictEnvelope`, an extra key → `unexpected key "<key>"`; without it, the key is ignored.
- A zod failure at the root is reported with the path `(root)`.
- An id valid only in the old numbering passes the old version's schema and is mapped by the step. The same id reaching the current version unmapped is rejected.
- `loadFailureMessage` wording for both failure kinds.
- `loadFileText(format, ".fqbl", text)`:
  - text that isn't JSON → `{ kind: "error", message: "Failed to load .fqbl: not a valid .fqbl file (not JSON)" }`;
  - a newer envelope → `Failed to load .fqbl: this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.`;
  - an invalid envelope → `Failed to load .fqbl: not a valid .fqbl file (<issue>)`;
  - a valid envelope → `{ kind: "ok", value }`.

### `packages/web/src/__tests__/quick-state-format.test.ts` (new)

One fixture per version, in its historical shape:

- v1 flat block with coloured tiers → `{ blocks: [block] }`, colours dropped.
- v2 blocks with coloured tiers → colours dropped.
- v3 with `rareAccessories` and `oreReroll` → unchanged.
- v4 with `customProfiles`, `selectedCustom` and `strict: true` → unchanged.

Other cases:

- **Round trip.** A maximal app-shaped v4 state goes through `wrap` → JSON → `loadVersioned` and comes back deep-equal, in both variants. It includes block `name`, `sellRolls`, `selectedCustom`, `customProfiles`, `rareAccessories`, `oreReroll` and `strict: true`, and its strings avoid `<>&"'`.
- **File variant.** Extra keys at top, block and tier level are dropped. 11 blocks are accepted. A tier named `Tank's` is kept as written.
- **Link variant.** The same extra keys are rejected. 11 blocks are rejected. `<>&"'` are stripped. A label made only of stripped characters is rejected.
- **Both variants.** An unknown set id, accessory set id or faction id is rejected at the current version. A `"__proto__"` key inside a record is rejected; build that input with `JSON.parse`, since object literals can't carry an own `__proto__`.

### `packages/web/src/__tests__/share.test.ts` (existing tests unchanged; add)

- `encodeState` output decompresses to `{ version: 4, state }`. `share.ts` does not export `fromBase64Url` or `decompress`, so the test needs its own inverse of its `compressToBase64Url` helper.
- A bare (pre-versioning) state decodes.
- `{ version: 5, state }` rejects with `NewerVersionError`.
- `{ version: 1, state: <flat v1 block> }` decodes into the blocks shape, which shows the link is migrated before it is validated.
- `{ version: 4, state, extra: 1 }` rejects with `Invalid shared state`.
- `"__proto__"` inside a block's `assignments`, inside `oreReroll.assignments` and inside `rareAccessories.selections` each rejects with `Invalid shared state`. Build these with `encodeRawString`, since `JSON.stringify` won't emit an own `__proto__` key.
- Invalid JSON and the input `"A"` each reject with `Invalid shared state`.
- `sharedLinkErrorMessage` gives the right text for both cases.
- `resolveSharedLink`:
  - a hash without `#q=` → `null`;
  - a valid link → `{ state }`;
  - a newer link → `{ error: <newer text> }`;
  - `#q=A` → `{ error: <generic text> }`;
  - it never rejects.

### `packages/web/src/__tests__/fmbl-format.test.ts` (new)

- A v1 file whose group carries `isAnd` loads, with `isAnd` dropped.
- A group without `mainStats` loads with `mainStats: []`.
- `{ version: 2, groups: [] }` → `newer`. A missing `groups` or `version` → `invalid`.
- An unknown set, slot, stat or faction id → `invalid`. `faction: 0` is accepted.
- **Round trip.** These groups go through `wrap` → JSON → `loadVersioned` and come back deep-equal:
  - the groups from `quickStateToGroups`, `rareAccessoriesToGroups` and `oreRerollToGroups` for a quick state that uses all three blocks;
  - a literal copy of the strict-mode catch-all group from `main.ts`: `{ keep: false, sets: <all set ids>, slots: [], mainStats: [], goodStats: [], rolls: 0, rank: 0, rarity: 0 }`;
  - one manual Generator group that sets every `SettingGroup` field: `name`, `keep: true`, non-empty `slots`, `mainStats` and `goodStats`, and `rank`, `rarity`, `faction`, `walkbackDelay`. No generated group carries `name` or non-empty `mainStats`, so without this group a schema that forgot an optional field would still pass.

### `packages/web/src/__tests__/settings.test.ts` (existing tests unchanged; add)

- Flat stored settings without `version` load as v1, and storage stays byte-identical after `getSettings()`: nothing is written on load.
- `saveSettings` writes `{ version: 1, settings: {…} }`.
- With `{ version: 2, settings: {…} }` stored, `getSettings()` equals `DEFAULT_SETTINGS` and `settingsFromNewerVersion()` is true. Storage is byte-identical after `saveSettings(...)`.
- `{ version: "x", settings: {…} }` → defaults, and the next `saveSettings` replaces it.
- One bad field (e.g. `rank5RollAdjustment: 99`) falls back alone while the others are kept.
- Mutating `getSettings().quickTierRolls` leaves `DEFAULT_SETTINGS` unchanged.
- Settings with every field set to a non-default value come back unchanged through `saveSettings` → `getSettings()`, which catches a field the schema forgot.

### `packages/web/src/__tests__/settings-modal.test.ts` (new; `// @vitest-environment jsdom`, as in `editor.test.ts`)

- Create `#settings-overlay`, `#settings-close` and `#settings-body` before calling `initSettingsModal()`, which looks them up with `!` and attaches listeners immediately.
- With newer settings stored, opening the modal shows the note and disables every control, Reset included. With current settings there is no note and the controls are enabled.
- `numberInput` rounding: `numberInput` is module-private, so go through the DOM. Type `6.5` into the first `.settings-input-number`, dispatch `change`, and expect `7` both in the input and in storage.

### `packages/web/src/__tests__/quick-generator-dom.test.ts` (new; `// @vitest-environment jsdom`)

Set `document.body.innerHTML = '<div id="quick-tiers"></div>'` and call `renderQuickGenerator(defaultQuickState(), onChange)` with a spy for `onChange`. Then:

- **Rolls input** (the first `.quick-tier-rolls-input`):
  - set the value to `6.5` and dispatch `input` → the block's tier 0 `rolls` is 7;
  - dispatch `blur` → `rolls` is 7 and the input shows `7`;
  - with the input showing `6.5`, dispatch `new WheelEvent("wheel", { deltaY: -1 })` → the stored `rolls` is an integer from 1 to 9.
- **Drops**, on a tier column (`.quick-tier-columns:not(.ore-columns) .quick-tier-column`) and on an ore-reroll column (`.ore-columns .quick-tier-column:not(.quick-tier-sell)`):
  - build a `drop` event with a stub `dataTransfer`, e.g. `Object.defineProperty(event, "dataTransfer", { value: { getData: () => "abc" } })`;
  - dropping `"abc"` → assignments unchanged and `onChange` not called;
  - dropping the id of a set not already in that column → the assignment is set and `onChange` is called.

### `packages/web/src/__tests__/quick-generator.test.ts` (existing tests unchanged; add)

- `parseDroppedSetId`: a set id → that id. `"NaN"`, `"abc"`, `""`, `undefined` and an unknown id → `null`.
- `normalizeRolls`: `6.5` → 7; `12` → 9; `-3` → 1; `0` → 1.
