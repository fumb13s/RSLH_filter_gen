import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  currentVersion,
  wrap,
  loadVersioned,
  loadFailureMessage,
  loadFileText,
} from "../versioned.js";
import type { VersionedFormat } from "../versioned.js";

// ---------------------------------------------------------------------------
// Toy format: two past versions and a current one
//
// v1 { n }            → v2 adds `label`
// v2 { n, label }     → v3 adds `tag`
// v3 { n, label, tag } (current)
// ---------------------------------------------------------------------------

interface Toy {
  n: number;
  label: string;
  tag: string;
}

const toyV1 = z.object({ n: z.number() });
const toyV2 = z.object({ n: z.number(), label: z.string() });
const toyV3 = z.object({ n: z.number(), label: z.string(), tag: z.string() });

const TOY: VersionedFormat<Toy> = {
  past: [
    { schema: toyV1, up: (d) => ({ ...(d as z.output<typeof toyV1>), label: "from-v1" }) },
    { schema: toyV2, up: (d) => ({ ...(d as z.output<typeof toyV2>), tag: "from-v2" }) },
  ],
  current: toyV3,
  dataKey: "payload",
};

/** Same chain, but bare data counts as version 1 and envelope keys are strict. */
const TOY_BARE: VersionedFormat<Toy> = { ...TOY, unversioned: 1, strictEnvelope: true };

const CURRENT = { n: 1, label: "L", tag: "T" };

describe("currentVersion / wrap", () => {
  it("reports past.length + 1 as the current version", () => {
    expect(currentVersion(TOY)).toBe(3);
  });

  it("wraps data in an envelope at the current version", () => {
    expect(wrap(TOY, CURRENT)).toEqual({ version: 3, payload: CURRENT });
  });
});

describe("loadVersioned: success", () => {
  it("accepts a current-version envelope", () => {
    expect(loadVersioned(TOY, { version: 3, payload: CURRENT })).toEqual({
      kind: "ok",
      value: CURRENT,
    });
  });

  it("runs every upgrade step in order for a v1 envelope", () => {
    expect(loadVersioned(TOY, { version: 1, payload: { n: 7 } })).toEqual({
      kind: "ok",
      value: { n: 7, label: "from-v1", tag: "from-v2" },
    });
  });

  it("runs the remaining steps for a v2 envelope", () => {
    expect(loadVersioned(TOY, { version: 2, payload: { n: 7, label: "mine" } })).toEqual({
      kind: "ok",
      value: { n: 7, label: "mine", tag: "from-v2" },
    });
  });

  it("treats a version-less object as bare data at the unversioned version", () => {
    expect(loadVersioned(TOY_BARE, { n: 7 })).toEqual({
      kind: "ok",
      value: { n: 7, label: "from-v1", tag: "from-v2" },
    });
  });

  it("ignores extra envelope keys without strictEnvelope", () => {
    expect(loadVersioned(TOY, { version: 3, payload: CURRENT, extra: 1 })).toEqual({
      kind: "ok",
      value: CURRENT,
    });
  });
});

describe("loadVersioned: newer version", () => {
  it("reports found and supported", () => {
    expect(loadVersioned(TOY, { version: 4, payload: CURRENT })).toEqual({
      kind: "newer",
      found: 4,
      supported: 3,
    });
  });

  it("reports newer even with extra keys and strictEnvelope set", () => {
    expect(loadVersioned(TOY_BARE, { version: 9, payload: CURRENT, extra: 1 })).toEqual({
      kind: "newer",
      found: 9,
      supported: 3,
    });
  });

  it("reports newer even when the data key is missing", () => {
    expect(loadVersioned(TOY, { version: 4 })).toEqual({
      kind: "newer",
      found: 4,
      supported: 3,
    });
  });
});

describe("loadVersioned: invalid", () => {
  it('reports missing "version" for a version-less object when unversioned is unset', () => {
    expect(loadVersioned(TOY, { payload: CURRENT })).toEqual({
      kind: "invalid",
      issue: 'missing "version"',
    });
  });

  it("reports not an object for a non-object when unversioned is unset", () => {
    expect(loadVersioned(TOY, "nope")).toEqual({ kind: "invalid", issue: "not an object" });
    expect(loadVersioned(TOY, null)).toEqual({ kind: "invalid", issue: "not an object" });
    expect(loadVersioned(TOY, [1, 2])).toEqual({ kind: "invalid", issue: "not an object" });
  });

  it("rejects a version that is not a positive integer", () => {
    const issue = "version must be a positive integer";
    expect(loadVersioned(TOY, { version: 1.5, payload: CURRENT })).toEqual({ kind: "invalid", issue });
    expect(loadVersioned(TOY, { version: 0, payload: CURRENT })).toEqual({ kind: "invalid", issue });
    expect(loadVersioned(TOY, { version: -1, payload: CURRENT })).toEqual({ kind: "invalid", issue });
    expect(loadVersioned(TOY, { version: "3", payload: CURRENT })).toEqual({ kind: "invalid", issue });
  });

  it("reports a missing data key", () => {
    expect(loadVersioned(TOY, { version: 3 })).toEqual({
      kind: "invalid",
      issue: 'missing "payload"',
    });
  });

  it("names the first unexpected envelope key with strictEnvelope", () => {
    expect(loadVersioned(TOY_BARE, { version: 3, payload: CURRENT, extra: 1 })).toEqual({
      kind: "invalid",
      issue: 'unexpected key "extra"',
    });
  });

  it("reports a zod failure at the root with the path (root)", () => {
    const result = loadVersioned(TOY, { version: 3, payload: "not an object" });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.issue.startsWith("(root): ")).toBe(true);
  });

  it("reports a zod failure inside the data with its field path", () => {
    const result = loadVersioned(TOY, { version: 3, payload: { n: "x", label: "L", tag: "T" } });
    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.issue.startsWith("n: ")).toBe(true);
  });

  it("never throws", () => {
    expect(() => loadVersioned(TOY, undefined)).not.toThrow();
    expect(() => loadVersioned(TOY, { version: 1, payload: { n: Symbol("x") } })).not.toThrow();
  });
});

describe("loadFailureMessage", () => {
  it("names both versions and advises a reload for a newer document", () => {
    expect(loadFailureMessage(".fqbl", { kind: "newer", found: 5, supported: 4 })).toBe(
      "this file was saved by a newer version of the app (v5; this page reads up to v4). Reload the page to update.",
    );
  });

  it("names the file label and the issue for an invalid document", () => {
    expect(loadFailureMessage(".fqbl", { kind: "invalid", issue: "n: Required" })).toBe(
      "not a valid .fqbl file (n: Required)",
    );
  });
});

describe("loadFileText", () => {
  it("reports not JSON for text that does not parse", () => {
    expect(loadFileText(TOY, ".fqbl", "not json{{{")).toEqual({
      kind: "error",
      message: "Failed to load .fqbl: not a valid .fqbl file (not JSON)",
    });
  });

  it("reports the newer-version message for a newer envelope", () => {
    expect(loadFileText(TOY, ".fqbl", JSON.stringify({ version: 5, payload: CURRENT }))).toEqual({
      kind: "error",
      message:
        "Failed to load .fqbl: this file was saved by a newer version of the app (v5; this page reads up to v3). Reload the page to update.",
    });
  });

  it("reports the issue for an invalid envelope", () => {
    expect(loadFileText(TOY, ".fqbl", JSON.stringify({ version: 3 }))).toEqual({
      kind: "error",
      message: 'Failed to load .fqbl: not a valid .fqbl file (missing "payload")',
    });
  });

  it("returns the value for a valid envelope", () => {
    expect(loadFileText(TOY, ".fqbl", JSON.stringify(wrap(TOY, CURRENT)))).toEqual({
      kind: "ok",
      value: CURRENT,
    });
  });

  it("never throws", () => {
    expect(() => loadFileText(TOY, ".fmbl", "")).not.toThrow();
  });
});
