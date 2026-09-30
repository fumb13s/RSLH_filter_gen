import { describe, it, expect } from "vitest";
import { QUICK_STATE_FILE_FORMAT, QUICK_STATE_LINK_FORMAT } from "../quick-state-format.js";
import { loadVersioned, wrap } from "../versioned.js";
import type { StoredQuickGenState } from "../quick-generator.js";
import type { VersionedFormat } from "../versioned.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Four tiers in the v3+ shape (no colours). */
const TIERS = [
  { name: "Must-Keep", rolls: 5 },
  { name: "Good", rolls: 7 },
  { name: "Situational", rolls: 8 },
  { name: "Off-Set", rolls: 9 },
];

/** Four tiers in the v1/v2 shape (with colours). */
const COLOURED_TIERS = [
  { name: "Must-Keep", rolls: 5, color: "#22c55e" },
  { name: "Good", rolls: 7, color: "#3b82f6" },
  { name: "Situational", rolls: 8, color: "#f59e0b" },
  { name: "Off-Set", rolls: 9, color: "#ef4444" },
];

const BOTH: [string, VersionedFormat<StoredQuickGenState>][] = [
  ["file", QUICK_STATE_FILE_FORMAT],
  ["link", QUICK_STATE_LINK_FORMAT],
];

/** A v4 state that uses every field. Strings avoid the characters the link variant strips. */
function maximalState(): StoredQuickGenState {
  return {
    blocks: [
      {
        name: "Main block",
        tiers: [
          { name: "Must-Keep", rolls: 5 },
          { name: "Good", rolls: 7 },
          { name: "Situational", rolls: 8 },
          { name: "Off-Set", rolls: -1, sellRolls: 9 },
        ],
        assignments: { 1: 3, 4: 1 },
        selectedProfiles: [0, 1],
        selectedCustom: [0],
      },
    ],
    rareAccessories: { selections: { 47: [1, 2] } },
    oreReroll: { assignments: { 1: 0, 4: 2 } },
    customProfiles: [{ label: "Speed", stats: [[4, true], [1, false]] }],
    strict: true,
  };
}

// ---------------------------------------------------------------------------
// One fixture per historical version
// ---------------------------------------------------------------------------

describe.each(BOTH)("quick state v1-v4 fixtures (%s variant)", (_name, format) => {
  it("wraps a v1 flat block into blocks and drops tier colours", () => {
    const result = loadVersioned(format, {
      version: 1,
      state: {
        tiers: COLOURED_TIERS,
        assignments: { 1: 3 },
        selectedProfiles: [0],
      },
    });

    expect(result).toEqual({
      kind: "ok",
      value: {
        blocks: [{ tiers: TIERS, assignments: { 1: 3 }, selectedProfiles: [0] }],
      },
    });
  });

  it("drops tier colours from a v2 blocks document", () => {
    const result = loadVersioned(format, {
      version: 2,
      state: {
        blocks: [{ tiers: COLOURED_TIERS, assignments: {}, selectedProfiles: [] }],
      },
    });

    expect(result).toEqual({
      kind: "ok",
      value: { blocks: [{ tiers: TIERS, assignments: {}, selectedProfiles: [] }] },
    });
  });

  it("loads a v3 document with rareAccessories and oreReroll unchanged", () => {
    const state = {
      blocks: [{ tiers: TIERS, assignments: { 4: 1 }, selectedProfiles: [2] }],
      rareAccessories: { selections: { 47: [1] } },
      oreReroll: { assignments: { 18: 2 } },
    };

    expect(loadVersioned(format, { version: 3, state })).toEqual({ kind: "ok", value: state });
  });

  it("loads a v4 document with customProfiles, selectedCustom and strict unchanged", () => {
    const state = maximalState();
    expect(loadVersioned(format, { version: 4, state })).toEqual({ kind: "ok", value: state });
  });

  it("keeps a v2 block name through the upgrade chain", () => {
    const result = loadVersioned(format, {
      version: 2,
      state: { blocks: [{ name: "Legacy", tiers: COLOURED_TIERS, assignments: {}, selectedProfiles: [] }] },
    });

    expect(result).toEqual({
      kind: "ok",
      value: { blocks: [{ name: "Legacy", tiers: TIERS, assignments: {}, selectedProfiles: [] }] },
    });
  });
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe.each(BOTH)("quick state round trip (%s variant)", (_name, format) => {
  it("returns a maximal state deep-equal through wrap -> JSON -> loadVersioned", () => {
    const state = maximalState();
    const text = JSON.stringify(wrap(format, state));

    expect(loadVersioned(format, JSON.parse(text))).toEqual({ kind: "ok", value: state });
  });

  it("writes the current version into the envelope", () => {
    expect(wrap(format, maximalState()).version).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Structural checks shared by both variants
// ---------------------------------------------------------------------------

describe.each(BOTH)("quick state structure (%s variant)", (_name, format) => {
  const withBlock = (block: unknown) => ({ version: 4, state: { blocks: [block] } });
  const base = { tiers: TIERS, assignments: {}, selectedProfiles: [] };

  it("requires exactly 4 tiers", () => {
    expect(loadVersioned(format, withBlock({ ...base, tiers: TIERS.slice(0, 3) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: [...TIERS, TIERS[0]] })).kind).toBe("invalid");
  });

  it("requires at least one block", () => {
    expect(loadVersioned(format, { version: 4, state: { blocks: [] } }).kind).toBe("invalid");
  });

  it("bounds tier rolls to -1..9", () => {
    const tiers = (rolls: number) => [{ name: "T", rolls }, TIERS[1], TIERS[2], TIERS[3]];
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(-2) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(10) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(6.5) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(-1) })).kind).toBe("ok");
  });

  it("bounds sellRolls to 1..9", () => {
    const tiers = (sellRolls: number) => [TIERS[0], TIERS[1], TIERS[2], { name: "S", rolls: -1, sellRolls }];
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(0) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(10) })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, tiers: tiers(9) })).kind).toBe("ok");
  });

  it("bounds assignment values to 0..3", () => {
    expect(loadVersioned(format, withBlock({ ...base, assignments: { 1: 4 } })).kind).toBe("invalid");
    expect(loadVersioned(format, withBlock({ ...base, assignments: { 1: -1 } })).kind).toBe("invalid");
  });

  it("bounds ore reroll columns to 0..2", () => {
    const state = (col: number) => ({
      version: 4,
      state: { blocks: [base], oreReroll: { assignments: { 1: col } } },
    });
    expect(loadVersioned(format, state(3)).kind).toBe("invalid");
    expect(loadVersioned(format, state(2)).kind).toBe("ok");
  });

  it("rejects duplicate selectedProfiles", () => {
    expect(loadVersioned(format, withBlock({ ...base, selectedProfiles: [0, 0] })).kind).toBe("invalid");
  });

  it("rejects a selectedProfiles index beyond the preset table", () => {
    expect(loadVersioned(format, withBlock({ ...base, selectedProfiles: [99] })).kind).toBe("invalid");
  });

  it("rejects a selectedCustom index with no matching custom profile", () => {
    expect(loadVersioned(format, withBlock({ ...base, selectedCustom: [0] })).kind).toBe("invalid");
  });

  it("rejects an empty custom profile label", () => {
    const state = {
      version: 4,
      state: { blocks: [base], customProfiles: [{ label: "", stats: [[4, true]] }] },
    };
    expect(loadVersioned(format, state).kind).toBe("invalid");
  });

  it("accepts a whitespace-only custom profile label, as today", () => {
    const state = {
      version: 4,
      state: { blocks: [base], customProfiles: [{ label: "   ", stats: [[4, true]] }] },
    };
    expect(loadVersioned(format, state).kind).toBe("ok");
  });

  it("rejects custom profile stats that are empty or duplicated", () => {
    const withStats = (stats: unknown) => ({
      version: 4,
      state: { blocks: [base], customProfiles: [{ label: "P", stats }] },
    });
    expect(loadVersioned(format, withStats([])).kind).toBe("invalid");
    expect(loadVersioned(format, withStats([[4, true], [4, true]])).kind).toBe("invalid");
  });

  it("rejects a custom profile stat pair that is not a good substat", () => {
    const state = {
      version: 4,
      state: { blocks: [base], customProfiles: [{ label: "P", stats: [[4, false]] }] },
    };
    expect(loadVersioned(format, state).kind).toBe("invalid");
  });

  it("rejects null for an optional field, as today", () => {
    expect(loadVersioned(format, withBlock({ ...base, name: null })).kind).toBe("invalid");
    expect(loadVersioned(format, { version: 4, state: { blocks: [base], strict: null } }).kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// Id refinement — current version only, both variants
// ---------------------------------------------------------------------------

describe.each(BOTH)("quick state id refinement (%s variant)", (_name, format) => {
  const base = { tiers: TIERS, assignments: {}, selectedProfiles: [] };

  it("rejects an unknown set id in assignments", () => {
    expect(loadVersioned(format, { version: 4, state: { blocks: [{ ...base, assignments: { 99999: 0 } }] } }).kind)
      .toBe("invalid");
  });

  it("rejects an unknown set id in oreReroll assignments", () => {
    const state = { version: 4, state: { blocks: [base], oreReroll: { assignments: { 99999: 0 } } } };
    expect(loadVersioned(format, state).kind).toBe("invalid");
  });

  it("rejects an unknown accessory set id in rareAccessories", () => {
    const state = { version: 4, state: { blocks: [base], rareAccessories: { selections: { 1: [1] } } } };
    expect(loadVersioned(format, state).kind).toBe("invalid");
  });

  it("rejects an unknown faction id in rareAccessories", () => {
    const state = { version: 4, state: { blocks: [base], rareAccessories: { selections: { 47: [9999] } } } };
    expect(loadVersioned(format, state).kind).toBe("invalid");
  });

  it("rejects a __proto__ key inside a record", () => {
    // Object literals cannot carry an own __proto__ key, so build the input with JSON.parse.
    const assignments = JSON.parse('{"__proto__": 0, "1": 0}');
    expect(loadVersioned(format, { version: 4, state: { blocks: [{ ...base, assignments }] } }).kind)
      .toBe("invalid");

    const oreAssignments = JSON.parse('{"__proto__": 0, "1": 0}');
    expect(loadVersioned(format, {
      version: 4,
      state: { blocks: [base], oreReroll: { assignments: oreAssignments } },
    }).kind).toBe("invalid");

    const selections = JSON.parse('{"__proto__": [1], "47": [1]}');
    expect(loadVersioned(format, {
      version: 4,
      state: { blocks: [base], rareAccessories: { selections } },
    }).kind).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// File variant: tolerant, unlimited, verbatim strings
// ---------------------------------------------------------------------------

describe("quick state file variant", () => {
  const base = { tiers: TIERS, assignments: {}, selectedProfiles: [] };

  it("drops extra keys at the top, block and tier level", () => {
    const result = loadVersioned(QUICK_STATE_FILE_FORMAT, {
      version: 4,
      state: {
        blocks: [{ ...base, tiers: TIERS.map((t) => ({ ...t, bogusTier: 1 })), bogusBlock: 1 }],
        bogusTop: 1,
      },
    });

    expect(result).toEqual({ kind: "ok", value: { blocks: [base] } });
  });

  it("accepts 11 blocks", () => {
    const blocks = Array.from({ length: 11 }, () => ({ ...base }));
    const result = loadVersioned(QUICK_STATE_FILE_FORMAT, { version: 4, state: { blocks } });
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.value.blocks).toHaveLength(11);
  });

  it("keeps a tier name with an apostrophe as written", () => {
    const tiers = [{ name: "Tank's", rolls: 5 }, TIERS[1], TIERS[2], TIERS[3]];
    const result = loadVersioned(QUICK_STATE_FILE_FORMAT, {
      version: 4,
      state: { blocks: [{ ...base, tiers }] },
    });
    expect(result.kind === "ok" && result.value.blocks[0].tiers[0].name).toBe("Tank's");
  });

  it("keeps a block name longer than the link limit", () => {
    const name = "n".repeat(200);
    const result = loadVersioned(QUICK_STATE_FILE_FORMAT, {
      version: 4,
      state: { blocks: [{ ...base, name }] },
    });
    expect(result.kind === "ok" && result.value.blocks[0].name).toBe(name);
  });

  it("refuses a document without an envelope", () => {
    expect(loadVersioned(QUICK_STATE_FILE_FORMAT, { blocks: [base] })).toEqual({
      kind: "invalid",
      issue: 'missing "version"',
    });
  });
});

// ---------------------------------------------------------------------------
// Link variant: strict, size-limited, sanitising
// ---------------------------------------------------------------------------

describe("quick state link variant", () => {
  const base = { tiers: TIERS, assignments: {}, selectedProfiles: [] };

  it("rejects extra keys at the top, block and tier level", () => {
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, {
      version: 4,
      state: { blocks: [base], bogusTop: 1 },
    }).kind).toBe("invalid");

    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, {
      version: 4,
      state: { blocks: [{ ...base, bogusBlock: 1 }] },
    }).kind).toBe("invalid");

    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, {
      version: 4,
      state: { blocks: [{ ...base, tiers: TIERS.map((t) => ({ ...t, bogusTier: 1 })) }] },
    }).kind).toBe("invalid");
  });

  it("rejects 11 blocks", () => {
    const blocks = Array.from({ length: 11 }, () => ({ ...base }));
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, { version: 4, state: { blocks } }).kind).toBe("invalid");
  });

  it("accepts 10 blocks", () => {
    const blocks = Array.from({ length: 10 }, () => ({ ...base }));
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, { version: 4, state: { blocks } }).kind).toBe("ok");
  });

  it("strips HTML-significant characters from strings", () => {
    const tiers = [{ name: "<b>Tank's</b> & \"more\"", rolls: 5 }, TIERS[1], TIERS[2], TIERS[3]];
    const result = loadVersioned(QUICK_STATE_LINK_FORMAT, {
      version: 4,
      state: { blocks: [{ ...base, name: "<script>", tiers }] },
    });

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.value.blocks[0].tiers[0].name).toBe("bTanks/b  more");
    expect(result.kind === "ok" && result.value.blocks[0].name).toBe("script");
  });

  it("rejects a custom profile label made only of stripped characters", () => {
    const state = {
      version: 4,
      state: { blocks: [base], customProfiles: [{ label: "<<>>", stats: [[4, true]] }] },
    };
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, state).kind).toBe("invalid");
  });

  it("rejects a block name longer than 100 characters", () => {
    const state = { version: 4, state: { blocks: [{ ...base, name: "n".repeat(101) }] } };
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, state).kind).toBe("invalid");
  });

  it("rejects a tier name longer than 50 characters", () => {
    const tiers = [{ name: "n".repeat(51), rolls: 5 }, TIERS[1], TIERS[2], TIERS[3]];
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, { version: 4, state: { blocks: [{ ...base, tiers }] } }).kind)
      .toBe("invalid");
  });

  it("rejects more than 4 custom profiles", () => {
    const customProfiles = Array.from({ length: 5 }, (_, i) => ({ label: `P${i}`, stats: [[4, true]] }));
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, { version: 4, state: { blocks: [base], customProfiles } }).kind)
      .toBe("invalid");
  });

  it("rejects more than 16 faction selections for one accessory set", () => {
    const selections = { 47: Array.from({ length: 17 }, () => 1) };
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, {
      version: 4,
      state: { blocks: [base], rareAccessories: { selections } },
    }).kind).toBe("invalid");
  });

  it("loads a bare (pre-versioning) state as version 4", () => {
    const state = maximalState();
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, state)).toEqual({ kind: "ok", value: state });
  });

  it("rejects an envelope with an extra key", () => {
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, { version: 4, state: { blocks: [base] }, extra: 1 })).toEqual({
      kind: "invalid",
      issue: 'unexpected key "extra"',
    });
  });

  it("rejects a __proto__ key at the top level of a bare state", () => {
    const state = JSON.parse('{"__proto__": {"polluted": true}, "blocks": []}');
    state.blocks = [base];
    expect(loadVersioned(QUICK_STATE_LINK_FORMAT, state).kind).toBe("invalid");
  });
});
