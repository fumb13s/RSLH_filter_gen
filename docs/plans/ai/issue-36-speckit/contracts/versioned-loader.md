# Contract: Versioned Loader (`packages/web/src/versioned.ts`)

The module has no DOM access, so tests can import it. Adjust the typing as needed, within the lint constraints stated below.

## API

```ts
import { z } from "zod";

/** A version older than the current one. */
export interface PastVersion {
  /** Parses the data of a document at this version. Checks structure only, no id tables. */
  schema: z.ZodTypeAny;
  /** Turns this version's parsed data into the next version's input. */
  up: (data: unknown) => unknown;
}

export interface VersionedFormat<T> {
  /** Versions 1 … current − 1, oldest first. */
  past: readonly PastVersion[];
  /** The current version, number past.length + 1. Its parse output is the loaded value, and it carries the id checks. */
  current: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Envelope key that holds the data: "state", "groups" or "settings". */
  dataKey: string;
  /** Version that bare (un-enveloped) stored data counts as. Omit when every stored document has an envelope. */
  unversioned?: number;
  /** Reject envelope keys other than `version` and the data key. */
  strictEnvelope?: boolean;
}

export type LoadFailure =
  | { kind: "newer"; found: number; supported: number }
  | { kind: "invalid"; issue: string };

export type LoadResult<T> = { kind: "ok"; value: T } | LoadFailure;

/** past.length + 1 */
export function currentVersion<T>(format: VersionedFormat<T>): number;
/** { version: currentVersion(format), [dataKey]: data } */
export function wrap<T>(format: VersionedFormat<T>, data: T): Record<string, unknown>;
/** Never throws. */
export function loadVersioned<T>(format: VersionedFormat<T>, stored: unknown): LoadResult<T>;
export function loadFailureMessage(fileLabel: string, failure: LoadFailure): string;
/** Parses a file's text and loads it. Never throws. Used for both `.fqbl` and `.fmbl`. */
export function loadFileText<T>(
  format: VersionedFormat<T>,
  fileLabel: string,
  text: string,
): { kind: "ok"; value: T } | { kind: "error"; message: string };
```

Typing rules:
- A step receives `unknown` and casts it to the previous schema's `z.output<…>`. That is sound, because a step only ever runs on output that schema has just parsed. Do not type steps with `any`: `@typescript-eslint/no-explicit-any` is on.
- Declaring each format with its type is the schema-vs-type check, e.g. `QUICK_STATE_FILE_FORMAT: VersionedFormat<StoredQuickGenState>`. Do not add an unused `_check` const or type: `no-unused-vars` flags it. The declared type catches a missing or mistyped required field, but not a forgotten optional one; round-trip tests cover those.

## `loadVersioned` algorithm (in this order)

1. **Envelope detection.** If `stored` is a plain object with an own `version` key, it is an envelope. Otherwise, if `unversioned` is set, `stored` itself is the data at that version. Otherwise the result is `invalid`: issue `not an object` when `stored` isn't a plain object, or `missing "version"` when it is.
2. **Version check.** An envelope's `version` must be an integer ≥ 1. Otherwise the result is `invalid` with issue `version must be a positive integer`.
3. **Newer check.** A version above `currentVersion(format)` returns `{ kind: "newer", found, supported }`. This check comes before step 4, so a newer envelope that adds keys still reports `newer`.
4. **Envelope keys.** The data key must be present; otherwise the result is `invalid` with issue `missing "<dataKey>"`, e.g. `missing "state"`. With `strictEnvelope`, any other key gives `invalid` with issue `unexpected key "<key>"`, naming the first such key.
5. **Parse and upgrade.** Parse the data with that version's schema: `past[version − 1].schema`, or `current` at the current version. Then for each later version, run the previous version's `up` and parse its output with the next schema, ending with `current`. Re-parsing after every step catches a step that emits the wrong shape.
   - Any failure returns `invalid`. The issue is the first zod issue as `"<path>: <message>"`, with the path joined by `.` and written `(root)` when empty. If a step threw instead, the issue is the thrown error's message.

## `loadFailureMessage(fileLabel, failure)`

| Failure | Returned text (example `fileLabel` = `.fqbl`, found 5, supported 4) |
|---|---|
| `newer` | `this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.` |
| `invalid` | `not a valid .fqbl file (<issue>)` |

## `loadFileText(format, fileLabel, text)`

This is the file loaders' shared entry point. `main.ts` runs DOM code on import and cannot be unit-tested, so this function makes the whole decision and `main.ts` only displays the result.

| Input | Result |
|---|---|
| `text` is not JSON | `{ kind: "error", message: "Failed to load .fqbl: not a valid .fqbl file (not JSON)" }`, i.e. `loadFailureMessage` with issue `not JSON` |
| `loadVersioned` returns a failure | `{ kind: "error", message: "Failed to load .fqbl: " + loadFailureMessage(".fqbl", failure) }` |
| `loadVersioned` returns `ok` | `{ kind: "ok", value }` |

## Bump rule (comment at the top of the module, verbatim)

> Bump a format's version whenever what it stores changes shape or meaning, including when a new optional field is added, and add the step (a step that returns its input unchanged is fine). Past versions' schemas check structure only. Checks against today's id tables (set ids, accessory set ids, faction ids, substat presets and pairs), and checks across fields, belong to the current version alone, so old data is migrated before it meets them.
