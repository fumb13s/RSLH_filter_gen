/**
 * Shared loader for the app's own stored formats (.fqbl, share links, .fmbl, settings).
 *
 * Bump a format's version whenever what it stores changes shape or meaning, including when a new
 * optional field is added, and add the step (a step that returns its input unchanged is fine). Past
 * versions' schemas check structure only. Checks against today's id tables (set ids, accessory set
 * ids, faction ids, substat presets and pairs), and checks across fields, belong to the current
 * version alone, so old data is migrated before it meets them.
 *
 * No DOM access, so tests can import this module directly.
 */
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The first zod issue as `"<path>: <message>"`, with `(root)` for an empty path. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid";
  const path = issue.path.join(".");
  return `${path === "" ? "(root)" : path}: ${issue.message}`;
}

export function currentVersion<T>(format: VersionedFormat<T>): number {
  return format.past.length + 1;
}

export function wrap<T>(format: VersionedFormat<T>, data: T): Record<string, unknown> {
  return { version: currentVersion(format), [format.dataKey]: data };
}

/** Never throws. */
export function loadVersioned<T>(format: VersionedFormat<T>, stored: unknown): LoadResult<T> {
  const supported = currentVersion(format);

  let version: number;
  let data: unknown;

  // 1. Envelope detection
  if (isPlainObject(stored) && hasOwn(stored, "version")) {
    // 2. Version check
    const found = stored.version;
    if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
      return { kind: "invalid", issue: "version must be a positive integer" };
    }

    // 3. Newer check — before the key checks, so a newer envelope that adds keys still reports newer
    if (found > supported) return { kind: "newer", found, supported };

    // 4. Envelope keys
    if (!hasOwn(stored, format.dataKey)) {
      return { kind: "invalid", issue: `missing "${format.dataKey}"` };
    }
    if (format.strictEnvelope) {
      for (const key of Object.keys(stored)) {
        if (key !== "version" && key !== format.dataKey) {
          return { kind: "invalid", issue: `unexpected key "${key}"` };
        }
      }
    }

    version = found;
    data = stored[format.dataKey];
  } else if (format.unversioned !== undefined) {
    version = format.unversioned;
    data = stored;
  } else if (!isPlainObject(stored)) {
    return { kind: "invalid", issue: "not an object" };
  } else {
    return { kind: "invalid", issue: 'missing "version"' };
  }

  // 5. A version above the current one would skip the loop below and return the stored value
  // unparsed. The envelope path reports `newer` before it gets here, so this only catches a format
  // declaring `unversioned` above its own current version — a config mistake, not stored data. The
  // check is here so "never returns unchecked data" holds in this function rather than by
  // convention elsewhere.
  if (version > supported) return { kind: "invalid", issue: "unsupported format configuration" };

  // 6. Parse and upgrade, re-parsing after every step so a faulty step fails the load
  let value: unknown = data;
  for (let v = version; v <= supported; v++) {
    const schema = v === supported ? format.current : format.past[v - 1].schema;
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { kind: "invalid", issue: firstIssue(parsed.error) };
    value = parsed.data;

    if (v < supported) {
      try {
        value = format.past[v - 1].up(value);
      } catch (err) {
        return { kind: "invalid", issue: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  return { kind: "ok", value: value as T };
}

export function loadFailureMessage(fileLabel: string, failure: LoadFailure): string {
  if (failure.kind === "newer") {
    return `this file was saved by a newer version of the app (v${failure.found}; this page reads up to v${failure.supported}). Reload the page to update.`;
  }
  return `not a valid ${fileLabel} file (${failure.issue})`;
}

/** Parses a file's text and loads it. Never throws. Used for both `.fqbl` and `.fmbl`. */
export function loadFileText<T>(
  format: VersionedFormat<T>,
  fileLabel: string,
  text: string,
): { kind: "ok"; value: T } | { kind: "error"; message: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const message = loadFailureMessage(fileLabel, { kind: "invalid", issue: "not JSON" });
    return { kind: "error", message: `Failed to load ${fileLabel}: ${message}` };
  }

  const result = loadVersioned(format, data);
  if (result.kind === "ok") return result;
  return { kind: "error", message: `Failed to load ${fileLabel}: ${loadFailureMessage(fileLabel, result)}` };
}
