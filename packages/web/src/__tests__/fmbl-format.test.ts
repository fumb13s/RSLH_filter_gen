import { describe, it, expect } from "vitest";
import { ARTIFACT_SET_NAMES } from "@rslh/core";
import { FMBL_FORMAT } from "../fmbl-format.js";
import { loadVersioned, wrap } from "../versioned.js";
import {
  defaultQuickState,
  quickStateToGroups,
  rareAccessoriesToGroups,
  oreRerollToGroups,
} from "../quick-generator.js";
import type { SettingGroup } from "../generator.js";

const GROUP: SettingGroup = { sets: [1, 2], slots: [4], mainStats: [], goodStats: [[4, true]], rolls: 6 };

/** wrap -> JSON -> loadVersioned, the way main.ts saves and loads a .fmbl file. */
function roundTrip(groups: SettingGroup[]) {
  return loadVersioned(FMBL_FORMAT, JSON.parse(JSON.stringify(wrap(FMBL_FORMAT, groups))));
}

describe("fmbl format: version 1", () => {
  it("is the current version", () => {
    expect(wrap(FMBL_FORMAT, []).version).toBe(1);
  });

  it("drops the legacy isAnd field a v1 file may carry", () => {
    const result = loadVersioned(FMBL_FORMAT, {
      version: 1,
      groups: [{ ...GROUP, isAnd: false }],
    });

    expect(result).toEqual({ kind: "ok", value: [GROUP] });
  });

  it("defaults a missing mainStats to an empty array", () => {
    const result = loadVersioned(FMBL_FORMAT, {
      version: 1,
      groups: [{ sets: [1], slots: [], goodStats: [], rolls: 6 }],
    });

    expect(result).toEqual({ kind: "ok", value: [{ sets: [1], slots: [], mainStats: [], goodStats: [], rolls: 6 }] });
  });

  it("accepts the out-of-UI-range values generated groups carry", () => {
    const generated: SettingGroup = {
      keep: false,
      sets: [1],
      slots: [],
      mainStats: [],
      goodStats: [],
      rolls: 0,
      rank: 0,
      rarity: 0,
      walkbackDelay: 1,
    };
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [generated] })).toEqual({
      kind: "ok",
      value: [generated],
    });
  });
});

describe("fmbl format: refusal", () => {
  it("refuses a newer version", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 2, groups: [] })).toEqual({
      kind: "newer",
      found: 2,
      supported: 1,
    });
  });

  it("refuses a document without a groups key", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 1 })).toEqual({
      kind: "invalid",
      issue: 'missing "groups"',
    });
  });

  it("refuses a document without an envelope", () => {
    expect(loadVersioned(FMBL_FORMAT, { groups: [] })).toEqual({
      kind: "invalid",
      issue: 'missing "version"',
    });
  });

  it("refuses an unknown set id", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, sets: [99999] }] }).kind).toBe("invalid");
  });

  it("refuses an unknown slot id", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, slots: [99] }] }).kind).toBe("invalid");
  });

  it("refuses an unknown stat id in mainStats or goodStats", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, mainStats: [[99, true]] }] }).kind)
      .toBe("invalid");
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, goodStats: [[99, true]] }] }).kind)
      .toBe("invalid");
  });

  it("refuses an unknown faction id but accepts faction 0", () => {
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, faction: 9999 }] }).kind).toBe("invalid");
    expect(loadVersioned(FMBL_FORMAT, { version: 1, groups: [{ ...GROUP, faction: 0 }] })).toEqual({
      kind: "ok",
      value: [{ ...GROUP, faction: 0 }],
    });
  });
});

describe("fmbl format: round trip", () => {
  it("returns the groups the quick generator produces deep-equal", () => {
    const state = defaultQuickState();
    state.blocks[0].selectedProfiles = [0];
    state.rareAccessories = { selections: { 47: [1, 2] } };
    state.oreReroll = { assignments: { 4: 1 } };

    const groups = [
      ...rareAccessoriesToGroups(state.rareAccessories),
      ...quickStateToGroups(state),
      ...oreRerollToGroups(state.oreReroll),
    ];
    expect(groups.length).toBeGreaterThan(0);

    expect(roundTrip(groups)).toEqual({ kind: "ok", value: groups });
  });

  it("returns the strict-mode catch-all group deep-equal", () => {
    const catchAll: SettingGroup = {
      keep: false,
      sets: Object.keys(ARTIFACT_SET_NAMES).map(Number),
      slots: [],
      mainStats: [],
      goodStats: [],
      rolls: 0,
      rank: 0,
      rarity: 0,
    };

    expect(roundTrip([catchAll])).toEqual({ kind: "ok", value: [catchAll] });
  });

  it("returns a manual group that sets every field deep-equal", () => {
    const full: SettingGroup = {
      name: "Speed boots",
      keep: true,
      sets: [1, 2],
      slots: [4],
      mainStats: [[4, true]],
      goodStats: [[4, true], [5, false]],
      rolls: 6,
      rank: 6,
      rarity: 16,
      faction: 1,
      walkbackDelay: 1,
    };

    expect(roundTrip([full])).toEqual({ kind: "ok", value: [full] });
  });

  it("returns an empty groups array deep-equal", () => {
    expect(roundTrip([])).toEqual({ kind: "ok", value: [] });
  });
});
