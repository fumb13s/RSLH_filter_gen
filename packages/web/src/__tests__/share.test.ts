import { describe, it, expect } from "vitest";
import { test as fcTest } from "@fast-check/vitest";
import fc from "fast-check";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeState,
  decodeState,
  NewerVersionError,
  sharedLinkErrorMessage,
  resolveSharedLink,
} from "../share.js";
import {
  defaultQuickState,
  stripBlockColors,
  restoreBlockColors,
  defaultBlock,
} from "../quick-generator.js";
import type { QuickGenState, QuickBlock, RareAccessoryBlock, OreRerollBlock, CustomProfile } from "../quick-generator.js";
import { ARTIFACT_SET_NAMES, ACCESSORY_SET_IDS, FACTION_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS } from "../generator.js";
import { loadRegressions, propConfig } from "./helpers/fc-reporter.js";

// ---------------------------------------------------------------------------
// fast-check config
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(__dirname, "regressions", "share.json");
const store = loadRegressions(REG_FILE);
const cfg = (name: string) => propConfig(REG_FILE, name, store);

// ---------------------------------------------------------------------------
// Arbitraries for shareable QuickGenState
// ---------------------------------------------------------------------------

const SET_IDS = Object.keys(ARTIFACT_SET_NAMES).map(Number);
const FACTION_IDS = Object.keys(FACTION_NAMES).map(Number);

/** Tier with rolls in the full valid range (-1 sell … 9). */
const arbTierName = fc.stringMatching(/^[A-Za-z0-9 -]{1,20}$/);
const arbBlockName = fc.stringMatching(/^[A-Za-z0-9 -]{1,30}$/);

const arbShareTier = fc.record({
  name: arbTierName,
  rolls: fc.integer({ min: -1, max: 9 }),
  color: fc.constant("#22c55e"),
  sellRolls: fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined }),
});

/** Block with exactly 4 tiers (what decodeState validation requires). */
const arbShareBlock: fc.Arbitrary<QuickBlock> = fc.record({
  name: fc.option(arbBlockName, { nil: undefined }),
  tiers: fc.tuple(arbShareTier, arbShareTier, arbShareTier, arbShareTier),
  assignments: fc.dictionary(
    fc.constantFrom(...SET_IDS.map(String)),
    fc.nat({ max: 3 }),
  ).map((d) => {
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(d)) result[Number(k)] = v;
    return result;
  }),
  selectedProfiles: fc.uniqueArray(
    fc.nat({ max: SUBSTAT_PRESETS.length - 1 }),
    { minLength: 0, maxLength: SUBSTAT_PRESETS.length },
  ),
});

const arbShareRareAccessories: fc.Arbitrary<RareAccessoryBlock> = fc
  .dictionary(
    fc.constantFrom(...ACCESSORY_SET_IDS.map(String)),
    fc.uniqueArray(fc.constantFrom(...FACTION_IDS), { minLength: 1, maxLength: 4 }),
  )
  .map((d) => {
    const selections: Record<number, number[]> = {};
    for (const [k, v] of Object.entries(d)) selections[Number(k)] = v;
    return { selections };
  });

const arbShareOreReroll: fc.Arbitrary<OreRerollBlock> = fc
  .dictionary(
    fc.constantFrom(...SET_IDS.map(String)),
    fc.constantFrom(0, 1, 2),
  )
  .map((d) => {
    const assignments: Record<number, number> = {};
    for (const [k, v] of Object.entries(d)) assignments[Number(k)] = v;
    return { assignments };
  });

/** Valid substat pairs for custom profiles. */
const SUBSTAT_PAIRS: [number, boolean][] = [
  [1, true], [1, false], [2, true], [2, false], [3, true], [3, false],
  [4, true], [5, false], [6, false], [7, true], [8, true],
];

const arbCustomProfile: fc.Arbitrary<CustomProfile> = fc.record({
  label: fc.stringMatching(/^[A-Za-z0-9 -]{1,20}$/),
  stats: fc.uniqueArray(
    fc.constantFrom(...SUBSTAT_PAIRS),
    { minLength: 1, maxLength: SUBSTAT_PAIRS.length, comparator: (a, b) => a[0] === b[0] && a[1] === b[1] },
  ),
});

const arbShareState: fc.Arbitrary<QuickGenState> = fc.record({
  blocks: fc.array(arbShareBlock, { minLength: 1, maxLength: 3 }),
  rareAccessories: fc.option(arbShareRareAccessories, { nil: undefined }),
  oreReroll: fc.option(arbShareOreReroll, { nil: undefined }),
  customProfiles: fc.option(
    fc.array(arbCustomProfile, { minLength: 1, maxLength: 4 }),
    { nil: undefined },
  ),
}).chain((state) => {
  // selectedCustom must reference valid indices into customProfiles
  const maxIdx = (state.customProfiles?.length ?? 0) - 1;
  if (maxIdx < 0) return fc.constant(state);

  return fc.constant(state).map((s) => ({
    ...s,
    blocks: s.blocks.map((b) => ({
      ...b,
      selectedCustom: undefined, // will be filled below
    })),
  })).chain((s) =>
    fc.tuple(
      ...s.blocks.map(() =>
        fc.option(
          fc.uniqueArray(fc.nat({ max: maxIdx }), { minLength: 0, maxLength: maxIdx + 1 }),
          { nil: undefined },
        ),
      ),
    ).map((customs) => ({
      ...s,
      blocks: s.blocks.map((b, i) => ({
        ...b,
        selectedCustom: customs[i],
      })),
    })),
  );
});

// ---------------------------------------------------------------------------
// Helper: compress arbitrary data into base64url (bypasses validation)
// ---------------------------------------------------------------------------

async function encodeRawString(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json);
  return compressToBase64Url(bytes);
}

async function encodeRaw(data: unknown): Promise<string> {
  return encodeRawString(JSON.stringify(data));
}

async function compressToBase64Url(bytes: Uint8Array): Promise<string> {

  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  let bin = "";
  for (const b of result) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe("share: round-trip", () => {
  it("encodes and decodes default quick state", async () => {
    const state = defaultQuickState();
    const encoded = await encodeState(state);
    const decoded = await decodeState(encoded);

    // After round-trip the state should match strip → restore
    const expected = restoreBlockColors(stripBlockColors(state));
    expect(decoded).toEqual(expected);
  });

  it("handles empty block (no assignments, no profiles)", async () => {
    const state: QuickGenState = {
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
    };
    const decoded = await decodeState(await encodeState(state));
    expect(decoded.blocks[0].assignments).toEqual({});
    expect(decoded.blocks[0].selectedProfiles).toEqual([]);
  });

  it("handles multi-block state", async () => {
    const block = defaultBlock();
    // strip colors for clean comparison
    const stripped = stripBlockColors({ blocks: [block] }).blocks[0];
    const state: QuickGenState = {
      blocks: [
        { ...stripped, name: "Block A" },
        { ...stripped, name: "Block B" },
        { ...stripped, name: "Block C" },
      ],
    };
    const decoded = await decodeState(await encodeState(state));
    expect(decoded.blocks).toHaveLength(3);
    expect(decoded.blocks[0].name).toBe("Block A");
    expect(decoded.blocks[1].name).toBe("Block B");
    expect(decoded.blocks[2].name).toBe("Block C");
  });

  it("preserves rare accessories and ore reroll", async () => {
    const state = defaultQuickState();
    state.rareAccessories = { selections: { 47: [1, 2, 3] } };
    state.oreReroll = { assignments: { 4: 1, 18: 2 } };

    const decoded = await decodeState(await encodeState(state));
    expect(decoded.rareAccessories?.selections[47]).toEqual([1, 2, 3]);
    expect(decoded.oreReroll?.assignments[4]).toBe(1);
    expect(decoded.oreReroll?.assignments[18]).toBe(2);
  });

  // Regression: Swift Parry (35), Deflection (36) and Mercurial (66) roll accessories in real
  // gear data but were absent from ACCESSORY_SET_IDS, so decode rejected any share link
  // selecting them.
  it("preserves rare accessories for the later accessory-capable sets", async () => {
    const state = defaultQuickState();
    state.rareAccessories = { selections: { 35: [4], 36: [5], 66: [5, 10] } };

    const decoded = await decodeState(await encodeState(state));
    expect(decoded.rareAccessories?.selections[35]).toEqual([4]);
    expect(decoded.rareAccessories?.selections[36]).toEqual([5]);
    expect(decoded.rareAccessories?.selections[66]).toEqual([5, 10]);
  });

  it("preserves sellRolls on tiers", async () => {
    const state: QuickGenState = {
      blocks: [{
        tiers: [
          { name: "T1", rolls: -1, sellRolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
    };
    const decoded = await decodeState(await encodeState(state));
    expect(decoded.blocks[0].tiers[0].sellRolls).toBe(5);
    expect(decoded.blocks[0].tiers[1].sellRolls).toBeUndefined();
  });

  it("round-trips custom profiles", async () => {
    const state: QuickGenState = {
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
        selectedCustom: [0, 1],
      }],
      customProfiles: [
        { label: "My Build", stats: [[1, false], [5, false], [6, false]] },
        { label: "Tank", stats: [[1, false], [3, false], [4, true]] },
      ],
    };
    const decoded = await decodeState(await encodeState(state));
    expect(decoded.customProfiles).toHaveLength(2);
    expect(decoded.customProfiles![0].label).toBe("My Build");
    expect(decoded.customProfiles![0].stats).toEqual([[1, false], [5, false], [6, false]]);
    expect(decoded.customProfiles![1].label).toBe("Tank");
    expect(decoded.blocks[0].selectedCustom).toEqual([0, 1]);
  });

  it("round-trips state without custom profiles", async () => {
    const state = defaultQuickState();
    const decoded = await decodeState(await encodeState(state));
    expect(decoded.customProfiles).toBeUndefined();
    expect(decoded.blocks[0].selectedCustom).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rejection tests
// ---------------------------------------------------------------------------

describe("share: rejection", () => {
  it("rejects input exceeding max length", async () => {
    const long = "A".repeat(4097);
    await expect(decodeState(long)).rejects.toThrow("Invalid shared state");
  });

  it("rejects invalid base64url characters", async () => {
    await expect(decodeState("abc!@#$%")).rejects.toThrow("Invalid shared state");
  });

  it("rejects corrupt compressed data", async () => {
    // Valid base64url but not valid deflate-raw data
    const garbage = btoa("this is not compressed data").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeState(garbage)).rejects.toThrow();
  });

  it("rejects valid JSON with wrong shape", async () => {
    const encoded = await encodeRaw({ foo: "bar" });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects prototype pollution attempt", async () => {
    // JSON.stringify won't preserve __proto__ as own key, so use raw JSON string
    const json = '{"__proto__":{"polluted":true},"blocks":[{"tiers":[{"name":"T1","rolls":5},{"name":"T2","rolls":7},{"name":"T3","rolls":8},{"name":"T4","rolls":9}],"assignments":{},"selectedProfiles":[]}]}';
    const encoded = await encodeRawString(json);
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects assignment keys that are not valid set IDs", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: { 99999: 0 },
        selectedProfiles: [],
      }],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects profile indices out of range", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [99],
      }],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects oversized blocks array (>10)", async () => {
    const block = {
      tiers: [
        { name: "T1", rolls: 5 },
        { name: "T2", rolls: 7 },
        { name: "T3", rolls: 8 },
        { name: "T4", rolls: 9 },
      ],
      assignments: {},
      selectedProfiles: [],
    };
    const encoded = await encodeRaw({
      blocks: Array.from({ length: 11 }, () => ({ ...block })),
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("sanitizes HTML in string fields", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        name: '<script>alert("xss")</script>',
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
    });
    const decoded = await decodeState(encoded);
    expect(decoded.blocks[0].name).not.toContain("<");
    expect(decoded.blocks[0].name).not.toContain(">");
  });

  it("rejects tier rolls outside valid range", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 99 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects empty blocks array", async () => {
    const encoded = await encodeRaw({ blocks: [] });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects duplicate profile indices", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [0, 0],
      }],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects ore reroll with invalid column index", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      oreReroll: { assignments: { 4: 5 } },
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects rare accessories with invalid faction ID", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      rareAccessories: { selections: { 47: [999] } },
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects rare accessories with invalid set ID", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      rareAccessories: { selections: { 1: [1] } },
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects custom profile with invalid stat pair", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      customProfiles: [
        { label: "Bad", stats: [[99, false]] },
      ],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects too many custom profiles (> 4)", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      customProfiles: Array.from({ length: 5 }, (_, i) => ({
        label: `Profile ${i}`,
        stats: [[1, false]],
      })),
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects selectedCustom index out of bounds", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
        selectedCustom: [0],
      }],
      // No customProfiles defined → index 0 is out of bounds
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects custom profile label too long", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      customProfiles: [
        { label: "A".repeat(51), stats: [[1, false]] },
      ],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects custom profile label containing HTML", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      customProfiles: [
        { label: '<img onerror="alert(1)">', stats: [[1, false]] },
      ],
    });
    // Should decode but with HTML stripped (sanitized), not rejected
    const decoded = await decodeState(encoded);
    expect(decoded.customProfiles![0].label).not.toContain("<");
  });

  it("rejects custom profile with duplicate stats", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
      }],
      customProfiles: [
        { label: "Dupe", stats: [[1, false], [1, false]] },
      ],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects unexpected keys on blocks", async () => {
    const encoded = await encodeRaw({
      blocks: [{
        tiers: [
          { name: "T1", rolls: 5 },
          { name: "T2", rolls: 7 },
          { name: "T3", rolls: 8 },
          { name: "T4", rolls: 9 },
        ],
        assignments: {},
        selectedProfiles: [],
        malicious: true,
      }],
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });
});

// ---------------------------------------------------------------------------
// Versioned envelope
// ---------------------------------------------------------------------------

/** Inverse of compressToBase64Url — share.ts exports neither fromBase64Url nor decompress. */
async function decodeRaw(encoded: string): Promise<unknown> {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const b64 = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(joined));
}

const V1_FLAT_BLOCK = {
  tiers: [
    { name: "T1", rolls: 5, color: "#22c55e" },
    { name: "T2", rolls: 7, color: "#3b82f6" },
    { name: "T3", rolls: 8, color: "#f59e0b" },
    { name: "T4", rolls: 9, color: "#ef4444" },
  ],
  assignments: { 1: 3 },
  selectedProfiles: [0],
};

describe("share: versioned envelope", () => {
  it("encodes state inside a version 4 envelope", async () => {
    const state = defaultQuickState();
    const payload = await decodeRaw(await encodeState(state));

    expect(payload).toEqual({ version: 4, state: stripBlockColors(state) });
  });

  it("decodes a bare, pre-versioning state", async () => {
    const encoded = await encodeRaw(stripBlockColors(defaultQuickState()));
    const decoded = await decodeState(encoded);

    expect(decoded).toEqual(restoreBlockColors(stripBlockColors(defaultQuickState())));
  });

  it("migrates a version 1 link before validating it", async () => {
    const encoded = await encodeRaw({ version: 1, state: V1_FLAT_BLOCK });
    const decoded = await decodeState(encoded);

    expect(decoded.blocks).toHaveLength(1);
    expect(decoded.blocks[0].assignments).toEqual({ 1: 3 });
    expect(decoded.blocks[0].selectedProfiles).toEqual([0]);
    // Colours come back from the defaults, not from the stored v1 values
    expect(decoded.blocks[0].tiers[0].color).toBe("#22c55e");
  });

  it("round-trips a state written as an envelope", async () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0, 1];
    const decoded = await decodeState(await encodeState(state));

    expect(decoded).toEqual(restoreBlockColors(stripBlockColors(state)));
  });
});

// ---------------------------------------------------------------------------
// Newer versions and the startup decision
// ---------------------------------------------------------------------------

const NEWER_TEXT = "This link was made with a newer version of the app. Reload the page to open it.";
const GENERIC_TEXT = "This shared link couldn't be opened. It may be incomplete or damaged.";

describe("share: envelope rejection", () => {
  it("rejects an envelope with an extra key", async () => {
    const encoded = await encodeRaw({
      version: 4,
      state: stripBlockColors(defaultQuickState()),
      extra: 1,
    });
    await expect(decodeState(encoded)).rejects.toThrow("Invalid shared state");
  });

  it("rejects a __proto__ key inside a block's assignments", async () => {
    const json =
      '{"version":4,"state":{"blocks":[{"tiers":[{"name":"T1","rolls":5},{"name":"T2","rolls":7},' +
      '{"name":"T3","rolls":8},{"name":"T4","rolls":9}],"assignments":{"__proto__":0},' +
      '"selectedProfiles":[]}]}}';
    await expect(decodeState(await encodeRawString(json))).rejects.toThrow("Invalid shared state");
  });

  it("rejects a __proto__ key inside oreReroll assignments", async () => {
    const json =
      '{"version":4,"state":{"blocks":[{"tiers":[{"name":"T1","rolls":5},{"name":"T2","rolls":7},' +
      '{"name":"T3","rolls":8},{"name":"T4","rolls":9}],"assignments":{},"selectedProfiles":[]}],' +
      '"oreReroll":{"assignments":{"__proto__":0}}}}';
    await expect(decodeState(await encodeRawString(json))).rejects.toThrow("Invalid shared state");
  });

  it("rejects a __proto__ key inside rareAccessories selections", async () => {
    const json =
      '{"version":4,"state":{"blocks":[{"tiers":[{"name":"T1","rolls":5},{"name":"T2","rolls":7},' +
      '{"name":"T3","rolls":8},{"name":"T4","rolls":9}],"assignments":{},"selectedProfiles":[]}],' +
      '"rareAccessories":{"selections":{"__proto__":[1]}}}}';
    await expect(decodeState(await encodeRawString(json))).rejects.toThrow("Invalid shared state");
  });

  it("rejects a payload that is not JSON", async () => {
    await expect(decodeState(await encodeRawString("not json{{{"))).rejects.toThrow("Invalid shared state");
  });

  it("rejects base64 that atob refuses", async () => {
    // "A" passes the alphabet gate but is not a decodable base64 string.
    await expect(decodeState("A")).rejects.toThrow("Invalid shared state");
  });
});

describe("share: newer version", () => {
  it("rejects a link from a newer version with NewerVersionError", async () => {
    const encoded = await encodeRaw({ version: 5, state: stripBlockColors(defaultQuickState()) });

    await expect(decodeState(encoded)).rejects.toThrow(NewerVersionError);
  });

  it("carries the found and supported versions on the error", async () => {
    const encoded = await encodeRaw({ version: 7, state: stripBlockColors(defaultQuickState()) });

    await expect(decodeState(encoded)).rejects.toMatchObject({ found: 7, supported: 4 });
  });
});

describe("sharedLinkErrorMessage", () => {
  it("advises a reload for a newer version", () => {
    expect(sharedLinkErrorMessage(new NewerVersionError(5, 4))).toBe(NEWER_TEXT);
  });

  it("reports a damaged link for anything else", () => {
    expect(sharedLinkErrorMessage(new Error("Invalid shared state"))).toBe(GENERIC_TEXT);
    expect(sharedLinkErrorMessage("nope")).toBe(GENERIC_TEXT);
    expect(sharedLinkErrorMessage(undefined)).toBe(GENERIC_TEXT);
  });
});

describe("resolveSharedLink", () => {
  it("returns null for a hash that is not a share link", async () => {
    expect(await resolveSharedLink("")).toBeNull();
    expect(await resolveSharedLink("#other")).toBeNull();
    expect(await resolveSharedLink("#q")).toBeNull();
  });

  it("returns the state for a valid link", async () => {
    const state = defaultQuickState();
    const result = await resolveSharedLink(`#q=${await encodeState(state)}`);

    expect(result).toEqual({ state: restoreBlockColors(stripBlockColors(state)) });
  });

  it("returns the newer-version message for a newer link", async () => {
    const encoded = await encodeRaw({ version: 5, state: stripBlockColors(defaultQuickState()) });
    const result = await resolveSharedLink(`#q=${encoded}`);

    expect(result).toMatchObject({ error: NEWER_TEXT });
  });

  it("returns the generic message for a damaged link", async () => {
    expect(await resolveSharedLink("#q=A")).toMatchObject({ error: GENERIC_TEXT });
  });

  it("carries the cause alongside the message", async () => {
    const result = await resolveSharedLink("#q=A");

    expect(result).not.toBeNull();
    expect(result && "cause" in result && result.cause).toBeDefined();
  });

  it("never rejects", async () => {
    for (const hash of ["#q=A", "#q=", "#q=!!!!", `#q=${"A".repeat(5000)}`, "#q=abc"]) {
      await expect(resolveSharedLink(hash)).resolves.toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Property-based round-trip test
// ---------------------------------------------------------------------------

describe("share.prop — round-trip", () => {
  fcTest.prop(
    [arbShareState],
    cfg("encode → decode preserves state"),
  )("encode → decode preserves state", async (state) => {
    const encoded = await encodeState(state);
    const decoded = await decodeState(encoded);
    const expected = restoreBlockColors(stripBlockColors(state));
    expect(decoded).toEqual(expected);
  });

  fcTest.prop(
    [arbShareState],
    cfg("encoded output is valid base64url"),
  )("encoded output is valid base64url", async (state) => {
    const encoded = await encodeState(state);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  fcTest.prop(
    [arbShareState],
    cfg("encoded output fits in URL"),
  )("encoded output fits in URL", async (state) => {
    const encoded = await encodeState(state);
    // #q= prefix + encoded should stay well under browser URL limits
    expect(encoded.length).toBeLessThan(4096);
  });
});
