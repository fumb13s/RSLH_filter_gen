# Contract: Module Interfaces and UI Behaviour

## `packages/web/src/quick-state-format.ts` (new)

| Export | Type | Notes |
|---|---|---|
| `QUICK_STATE_FILE_FORMAT` | `VersionedFormat<StoredQuickGenState>` | `dataKey: "state"`, no `unversioned` |
| `QUICK_STATE_LINK_FORMAT` | `VersionedFormat<StoredQuickGenState>` | `dataKey: "state"`, `unversioned: 4`, `strictEnvelope: true` |

Both are built by the module-internal factory `quickStateFormat(variant: "file" | "link")`.

## `packages/web/src/fmbl-format.ts` (new)

| Export | Type | Notes |
|---|---|---|
| `FMBL_FORMAT` | `VersionedFormat<SettingGroup[]>` | `dataKey: "groups"`, no `unversioned`, `past: []` |

## `packages/web/src/share.ts` (edited)

| Export | Signature | Behaviour |
|---|---|---|
| `encodeState` | `(state: QuickGenState) => Promise<string>` | compresses `JSON.stringify(wrap(QUICK_STATE_LINK_FORMAT, stripBlockColors(state)))` |
| `decodeState` | `(encoded: string) => Promise<QuickGenState>` | transport gates → `JSON.parse` → `loadVersioned(QUICK_STATE_LINK_FORMAT, data)`; `ok` → `restoreBlockColors(value)`; `newer` → throws `NewerVersionError`; anything else → throws `Error("Invalid shared state")` |
| `NewerVersionError` | `class extends Error { found: number; supported: number }` | new |
| `sharedLinkErrorMessage` | `(err: unknown) => string` | `NewerVersionError` → `This link was made with a newer version of the app. Reload the page to open it.`; anything else → `This shared link couldn't be opened. It may be incomplete or damaged.` |
| `resolveSharedLink` | `(hash: string) => Promise<{ state: QuickGenState } \| { error: string; cause: unknown } \| null>` | `null` when `hash` doesn't start with `#q=`; `{ state }` when `decodeState(hash.slice(3))` resolves; `{ error: sharedLinkErrorMessage(err), cause: err }` when it rejects. Never rejects. |

Removed: the hand-written validators and everything that only they used (see plan, change 5). Kept: `fail()`, the transport gates and the compression helpers.

## `packages/web/src/settings.ts` (edited)

| Export | Signature | Behaviour |
|---|---|---|
| `SETTINGS_FORMAT` | `VersionedFormat<UserSettings>` | `dataKey: "settings"`, `unversioned: 1`, `past: []` |
| `DEFAULT_SETTINGS` | `UserSettings` | unchanged values; never handed out by reference |
| `getSettings` | `() => UserSettings` | Returns defaults (fresh copies) when storage is missing, unparsable, not an object, unavailable or throws. Otherwise calls `loadVersioned`: `ok` → value; `newer` or `invalid` → defaults. Never returns `version`. Never writes. |
| `saveSettings` | `(s: UserSettings) => void` | writes `wrap(SETTINGS_FORMAT, s)` unless the stored settings are from a newer version, in which case it writes nothing |
| `settingsFromNewerVersion` | `() => boolean` | true when storage holds an envelope whose version is above the current one |

Every storage read is inside a try.

## `packages/web/src/settings-modal.ts` (edited)

- When `settingsFromNewerVersion()` is true:
  - the top of the form shows `Your settings were saved by a newer version of the app. Reload the page to see or change them.`;
  - every input and select is disabled, and so is the "Reset to Defaults" button.
- `numberInput` rounds before clamping (e.g. typing `6.5` into a 1–9 field stores 7).

## `packages/web/src/quick-generator.ts` (edited)

| Export | Signature / type | Notes |
|---|---|---|
| `SetTier` | interface (now exported) | unchanged shape |
| `StoredSetTier`, `StoredQuickBlock`, `StoredQuickGenState` | types | tiers without `color` |
| `stripBlockColors` | `(state: QuickGenState) => StoredQuickGenState` | retyped |
| `restoreBlockColors` | `(state: StoredQuickGenState) => QuickGenState` | assigns `defaultColors[i] ?? "#e5e7eb"` |
| `parseDroppedSetId` | `(text: string \| undefined) => number \| null` | returns `Number(text)` when it is a key of `ARTIFACT_SET_NAMES`, else `null` |
| `normalizeRolls` | `(value: number) => number` | `Math.round(value)` clamped to 1…9; callers never pass `NaN` |

Handler rules (lines 698–720):
- `input` keeps `if (!raw || raw < 1 || raw > 9) return;` and then stores `normalizeRolls(raw)`.
- `blur` stores `normalizeRolls(Number(rollsInput.value) || tier.rolls)`.
- `wheel` stores `normalizeRolls(Number(rollsInput.value) + (e.deltaY < 0 ? 1 : -1))`.

The drop handlers for tier columns (lines 781–790) and ore-reroll columns (lines 1052–1061) return early when `parseDroppedSetId` gives `null`.

## `packages/web/src/main.ts` (edited)

| Action | Behaviour |
|---|---|
| Save `.fqbl` | `JSON.stringify(wrap(QUICK_STATE_FILE_FORMAT, stripBlockColors(tab.quickState)), null, 2)` |
| Load `.fqbl` | `loadFileText(QUICK_STATE_FILE_FORMAT, ".fqbl", text)`. `ok` → `restoreBlockColors(value)`. `error` → show `message` in the tab-bar error. |
| Save / load `.fmbl` | same, with `FMBL_FORMAT` and `".fmbl"` |
| Open a share link | `resolveSharedLink(location.hash)` replaces `loadSharedState`. `{ state }` → as today. `{ error, cause }` → `console.warn` with `cause`; the default tab opens as today; after `addTab(settings.defaultTabType)`, which hides the error bar, the tab-bar error shows `error`. The `#q=` hash is kept. |

Removed: `migrateFqbl`, `FQBL_CURRENT_VERSION`, `FqblFileV1`, `loadSharedState`, the `FmblFile` / `FqblFile` interfaces, and `QuickBlock` from the type import on line 9.

## User-facing messages

| Situation | Where | Text |
|---|---|---|
| `.fqbl`/`.fmbl` from a newer version | tab-bar error | `Failed to load .fqbl: this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.` |
| Invalid `.fqbl`/`.fmbl` | tab-bar error | `Failed to load .fqbl: not a valid .fqbl file (<path>: <problem>)` |
| Share link from a newer version | tab-bar error, after the default tab opens | `This link was made with a newer version of the app. Reload the page to open it.` |
| Any other share-link failure | tab-bar error, after the default tab opens | `This shared link couldn't be opened. It may be incomplete or damaged.` |
| Settings from a newer version | top of the settings modal | `Your settings were saved by a newer version of the app. Reload the page to see or change them.` |
