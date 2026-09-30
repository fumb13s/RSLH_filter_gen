# Data Model: Versioned Stored Formats

## Terminology

- **Upgrade step**: the `up` function of a past version. It turns data of that version into the next version's shape. Every artifact uses this name.
- **Migration**: running the upgrade steps in order, from a document's version up to the current one. "Migrate first, validate second" means the id checks run only after migration.

## Stored document (envelope)

Every stored document is `{ version: number, <dataKey>: data }`.

| Format | Where it lives | `dataKey` | Current version | Bare (un-enveloped) data counts as | Envelope strictness |
|---|---|---|---|---|---|
| Quick state, file (`.fqbl`) | downloaded file | `state` | 4 | not allowed | extra envelope keys ignored |
| Quick state, link (`#q=…`) | URL hash, deflate-raw + base64url | `state` | 4 | version 4 | extra envelope keys rejected (`strictEnvelope`) |
| Generator groups (`.fmbl`) | downloaded file | `groups` | 1 | not allowed | extra envelope keys ignored |
| Settings | `localStorage["rslh-settings"]` | `settings` | 1 | version 1 | extra envelope keys ignored |

Rules:
- `version` must be an integer ≥ 1.
- A version above the current one means the document came from a newer app, and it is never loaded.
- The app only ever writes the current version.

## VersionedFormat (loader definition)

| Field | Meaning |
|---|---|
| `past: readonly PastVersion[]` | versions 1 … current − 1, oldest first; each has a structural `schema` and an `up` step to the next version |
| `current: z.ZodType<T, z.ZodTypeDef, unknown>` | the current version's schema (number `past.length + 1`), carrying the id refinement; its output is the loaded value |
| `dataKey: string` | envelope key holding the data |
| `unversioned?: number` | version that bare stored data counts as; omitted when every stored document has an envelope |
| `strictEnvelope?: boolean` | reject envelope keys other than `version` and the data key |

`LoadResult<T>` is `{ kind: "ok", value: T }`, `{ kind: "newer", found, supported }` or `{ kind: "invalid", issue }`. The algorithm is specified in [contracts/versioned-loader.md](./contracts/versioned-loader.md).

## Quick state (`.fqbl` and share links)

### App types (`quick-generator.ts`)

The hand-written interfaces stay the app's types. New stored types are added:

```ts
export interface SetTier { name: string; rolls: number; color: string; sellRolls?: number } // now exported
export type StoredSetTier = Omit<SetTier, "color">;
export type StoredQuickBlock = Omit<QuickBlock, "tiers"> & { tiers: StoredSetTier[] };
export type StoredQuickGenState = Omit<QuickGenState, "blocks"> & { blocks: StoredQuickBlock[] };
```

Colour handling:
- `stripBlockColors(state: QuickGenState): StoredQuickGenState` removes tier colours before saving.
- `restoreBlockColors(state: StoredQuickGenState): QuickGenState` assigns each tier `defaultColors[i] ?? "#e5e7eb"` after loading.

### Versions

Each schema describes everything a document of that version could contain. Fields were added mid-version in the past.

| Version | Data (`state`) | `up` to the next version |
|---|---|---|
| 1 (past) | One flat block: `tiers` (4 × `{ name, rolls, sellRolls?, color? }`), `assignments`, `selectedProfiles` | `(block) => ({ blocks: [block] })` |
| 2 (past) | `{ blocks }`, blocks `{ name?, tiers, assignments, selectedProfiles }`; tiers may still carry `color` | Drop `color` from every tier |
| 3 (past) | `{ blocks, rareAccessories?, oreReroll? }`; tiers `{ name, rolls, sellRolls? }` | Identity (v4 only added optional fields) |
| 4 (current) | v3 plus `customProfiles?`, blocks' `selectedCustom?`, `strict?`; plus the id refinement | — |

Field shapes:
- `assignments`: record from set id to tier index.
- `rareAccessories`: `{ selections }`, a record from accessory set id to an array of faction ids.
- `oreReroll`: `{ assignments }`, a record from set id to ore column.
- `customProfiles`: array of `{ label, stats: [statId, isFlat][] }`.
- `selectedProfiles` and `selectedCustom`: arrays of indices.

### Structural checks (every version)

- Types are as above. `tiers` has exactly 4 entries. `rolls` is an integer −1…9. `sellRolls` is an integer 1…9.
- `assignments` values are 0…3. `oreReroll.assignments` values are 0…2. `blocks` has at least 1 entry.
- `selectedProfiles` and `selectedCustom` hold unique non-negative integers.
- A custom profile's `stats` are 1…11 unique `[statId, isFlat]` pairs. Its `label` is non-empty, checked with `.refine((s) => s.length > 0)` and no trim (today `"   "` is accepted).
- Optional fields use `.optional()` only, never `.nullish()` or `.nullable()` (today `null` is rejected).
- Record keys (`assignments`, `oreReroll.assignments`, `rareAccessories.selections`) are checked in the record's key schema, never after parsing. zod 3 drops a `"__proto__"` key from a record's output without an issue. Records are rebuilt with `Number(key)` keys:

```ts
function idRecord<V extends z.ZodTypeAny>(value: V) {
  return z
    .record(z.string().refine((k) => Number.isInteger(Number(k)), "key is not an integer"), value)
    .transform((rec) => {
      const out: Record<number, z.output<V>> = {};
      for (const [k, v] of Object.entries(rec)) out[Number(k)] = v;
      return out;
    });
}
```

### Id refinement (current version only)

This is one `superRefine` attached to v4. When v5 is added, it moves to v5, and v4 joins `past` as structure only. It checks:
- `assignments` and `oreReroll.assignments` keys are in `ARTIFACT_SET_NAMES`;
- `rareAccessories.selections` keys are in `ACCESSORY_SET_IDS`, and their values are in `FACTION_NAMES`;
- `selectedProfiles` entries are < `SUBSTAT_PRESETS.length`;
- `selectedCustom` entries are < `customProfiles.length` (0 when absent);
- custom profile stats are in `GOOD_SUBSTATS`.

### Variants: `quickStateFormat(variant: "file" | "link")`

| | Link variant (`QUICK_STATE_LINK_FORMAT`) | File variant (`QUICK_STATE_FILE_FORMAT`) |
|---|---|---|
| Unknown keys | rejected (every object `.strict()`) | dropped (zod default) |
| Size limits | `MAX_BLOCKS` 10, `MAX_NAME_LENGTH` 100 (block name), `MAX_TIER_NAME_LENGTH` 50, `MAX_CUSTOM_LABEL_LENGTH` 50, `MAX_CUSTOM_PROFILES` 4, `MAX_SELECTIONS_PER_SET` 16, all moved from `share.ts` | none |
| Strings | length-checked, then `<>&"'` stripped | kept as written |
| Envelope | `unversioned: 4`, `strictEnvelope: true` | no `unversioned` |
| Parity | accepts exactly the links today's `share.ts` validator accepts | — |

The tier count (4), the ore column bound (≤ 2) and the stats bound (1…11) are structural checks in both variants, not link limits.

Factory helper sketch:

```ts
type Variant = "file" | "link";

function objectOf<T extends z.ZodRawShape>(variant: Variant, shape: T) {
  return variant === "link" ? z.object(shape).strict() : z.object(shape);
}

function text(variant: Variant, maxLength: number) {
  return variant === "link"
    ? z.string().max(maxLength).transform((s) => s.replace(/[<>&"']/g, ""))
    : z.string();
}
```

## Generator groups (`.fmbl`)

### Version 1 (current, `past` empty)

`groups` is an array of `SettingGroup`-shaped objects:

| Field | Type | Notes |
|---|---|---|
| `name?` | string | |
| `keep?` | boolean | |
| `sets` | integer[] | id-checked |
| `slots` | integer[] | id-checked |
| `mainStats` | `[statId, isFlat][]` | defaults to `[]`: files saved 2026-02-07 21:55–23:10 lack it |
| `goodStats` | `[statId, isFlat][]` | |
| `rolls` | integer | no range |
| `rank?` | integer | no range |
| `rarity?` | integer | no range |
| `faction?` | integer | 0 = any |
| `walkbackDelay?` | integer | no range |

Rules:
- There are no numeric ranges. Generated groups carry values the manual UI never produces: `rolls: 0`, `rank: 0` and `rarity: 0` on per-faction accessory groups and on the strict catch-all, and `walkbackDelay: 1` on ore-reroll groups.
- Unknown keys are dropped. `.fmbl` files saved on 2026-02-10 can carry `isAnd` on ore-reroll groups.
- Id refinement:
  - `sets` in `ARTIFACT_SET_NAMES`;
  - `slots` in `ARTIFACT_SLOT_NAMES`;
  - stat ids in `mainStats` and `goodStats` in `STAT_NAMES`;
  - `faction` 0 or in `FACTION_NAMES`.
- Export: `FMBL_FORMAT: VersionedFormat<SettingGroup[]>`.

## Settings

### Version 1 (current, `past` empty)

The data is today's `UserSettings` fields. Each field falls back to its default on its own when it is missing or fails its check, so the schema always outputs a complete `UserSettings`:

| Field | Check | Default |
|---|---|---|
| `defaultTabType` | `"viewer" \| "generator" \| "quick"` | `"quick"` |
| `maxTabs` | positive integer | 9 |
| `maxTabLabelWidthPercent` | positive number | 100 |
| `generatorDefaultRolls` | integer 4…9 | 6 |
| `quickTierRolls` | four integers 1…9 | `[5, 7, 8, 9]` |
| `rank5RollAdjustment` | integer 0…5 | 2 |
| `oreRerollColumns` | three integers 1…9 | `[3, 4, 5]` |

- Array fallbacks are factories, e.g. `.default(() => [...DEFAULT_SETTINGS.quickTierRolls]).catch(() => [...DEFAULT_SETTINGS.quickTierRolls])`. Every path that returns defaults returns fresh copies.
- Export: `SETTINGS_FORMAT: VersionedFormat<UserSettings>` (`dataKey: "settings"`, `unversioned: 1`, `past: []`).

## State transitions

### Loading any document

```text
stored ──► envelope? ──no──► unversioned set? ──no──► invalid
              │yes                  │yes
              ▼                     ▼ (data = stored, version = unversioned)
        version integer ≥ 1? ──no──► invalid
              │yes
              ▼
        version > current? ──yes──► newer
              │no
              ▼
        data key present / no extra keys (strict)? ──no──► invalid
              │yes
              ▼
        parse with version's schema ─► up ─► parse next ─► … ─► parse current (+ id refinement)
              │ any failure ──► invalid (first issue "<path>: <message>", "(root)" if empty)
              ▼
             ok(value)
```

### Settings lifecycle

```text
page load ──► read storage (inside try)
   ├─ missing / unparsable / unavailable ──► defaults (fresh copies)
   ├─ ok ──► migrated value, in memory only; nothing written
   ├─ invalid (incl. bad version marker) ──► defaults; next save overwrites
   └─ newer ──► defaults; saveSettings writes nothing;
                modal shows the note and disables inputs, selects and Reset
user edits a setting ──► saveSettings ──► writes { version: 1, settings } (unless newer)
```
