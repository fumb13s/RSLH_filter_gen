import { describe, it, expect } from "vitest";
import { evaluateFilter, matchesRule } from "../evaluate.js";
import { defaultRule } from "../types.js";
import type { HsfFilter } from "../types.js";
import type { Item } from "../item.js";

/** Helper: create a minimal item with sensible defaults. */
function makeItem(overrides?: Partial<Item>): Item {
  return {
    set: 1,
    slot: 1,
    rank: 6,
    rarity: 4, // Legendary
    mainStat: 2,
    substats: [],
    level: 16,
    ...overrides,
  };
}

/** Helper: wrap rules into a filter. */
function makeFilter(rules: ReturnType<typeof defaultRule>[]): HsfFilter {
  return { Rules: rules };
}

// ---------------------------------------------------------------------------
// evaluateFilter — overall flow
// ---------------------------------------------------------------------------

describe("evaluateFilter", () => {
  it("returns keep when filter has no rules", () => {
    const result = evaluateFilter(makeFilter([]), makeItem());
    expect(result).toBe("keep");
  });

  it("skips inactive rules (Use: false)", () => {
    const filter = makeFilter([
      defaultRule({ Use: false, Keep: false }), // sell, but inactive
    ]);
    expect(evaluateFilter(filter, makeItem())).toBe("keep");
  });

  it("returns keep when matching rule has Keep: true", () => {
    const filter = makeFilter([
      defaultRule({ Keep: true, Rank: 0, Rarity: 0, MainStatID: -1 }),
    ]);
    expect(evaluateFilter(filter, makeItem())).toBe("keep");
  });

  it("returns sell when matching rule has Keep: false", () => {
    const filter = makeFilter([
      defaultRule({ Keep: false, Rank: 0, Rarity: 0, MainStatID: -1 }),
    ]);
    expect(evaluateFilter(filter, makeItem())).toBe("sell");
  });

  it("first matching rule wins (keep before sell)", () => {
    const filter = makeFilter([
      defaultRule({ Keep: true, Rank: 0, Rarity: 0, MainStatID: -1 }),
      defaultRule({ Keep: false, Rank: 0, Rarity: 0, MainStatID: -1 }),
    ]);
    expect(evaluateFilter(filter, makeItem())).toBe("keep");
  });

  it("first matching rule wins (sell before keep)", () => {
    const filter = makeFilter([
      defaultRule({ Keep: false, Rank: 0, Rarity: 0, MainStatID: -1 }),
      defaultRule({ Keep: true, Rank: 0, Rarity: 0, MainStatID: -1 }),
    ]);
    expect(evaluateFilter(filter, makeItem())).toBe("sell");
  });

  it("skips non-matching rules and uses later match", () => {
    const filter = makeFilter([
      defaultRule({ Keep: false, ArtifactSet: [999], Rank: 0, Rarity: 0, MainStatID: -1 }),
      defaultRule({ Keep: true, Rank: 0, Rarity: 0, MainStatID: -1 }),
    ]);
    expect(evaluateFilter(filter, makeItem({ set: 1 }))).toBe("keep");
  });
});

// ---------------------------------------------------------------------------
// matchesRule — individual field matching
// ---------------------------------------------------------------------------

describe("matchesRule — ArtifactSet", () => {
  it("matches when set is in the array", () => {
    const rule = defaultRule({ ArtifactSet: [1, 2, 3], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ set: 2 }))).toBe(true);
  });

  it("does not match when set is not in the array", () => {
    const rule = defaultRule({ ArtifactSet: [1, 2, 3], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ set: 99 }))).toBe(false);
  });

  it("matches any set when ArtifactSet is undefined", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    // defaultRule doesn't include ArtifactSet
    delete (rule as Record<string, unknown>).ArtifactSet;
    expect(matchesRule(rule, makeItem({ set: 42 }))).toBe(true);
  });

  it("matches any set when ArtifactSet is empty", () => {
    const rule = defaultRule({ ArtifactSet: [], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ set: 42 }))).toBe(true);
  });
});

describe("matchesRule — ArtifactType (slot)", () => {
  it("matches when slot is in the array", () => {
    const rule = defaultRule({ ArtifactType: [1, 5], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ slot: 5 }))).toBe(true);
  });

  it("does not match when slot is not in the array", () => {
    const rule = defaultRule({ ArtifactType: [1, 5], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ slot: 3 }))).toBe(false);
  });

  it("matches any slot when ArtifactType is undefined", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    delete (rule as Record<string, unknown>).ArtifactType;
    expect(matchesRule(rule, makeItem({ slot: 9 }))).toBe(true);
  });

  it("matches any slot when ArtifactType is empty", () => {
    const rule = defaultRule({ ArtifactType: [], Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ slot: 9 }))).toBe(true);
  });
});

describe("matchesRule — Rank", () => {
  it("matches when item rank meets threshold", () => {
    const rule = defaultRule({ Rank: 5, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rank: 6 }))).toBe(true);
    expect(matchesRule(rule, makeItem({ rank: 5 }))).toBe(true);
  });

  it("does not match when item rank is below threshold", () => {
    const rule = defaultRule({ Rank: 5, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rank: 4 }))).toBe(false);
  });

  it("Rank 0 matches any rank", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rank: 1 }))).toBe(true);
  });
});

describe("matchesRule — Rarity", () => {
  it("Rarity 0 matches any rarity", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 0 }))).toBe(true); // Common
    expect(matchesRule(rule, makeItem({ rarity: 5 }))).toBe(true); // Mythical
  });

  it("Legendary (16) matches Legendary items", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 16, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 4 }))).toBe(true); // Legendary index=4
  });

  it("Legendary (16) matches Mythical items (higher tier)", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 16, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 5 }))).toBe(true); // Mythical index=5
  });

  it("Legendary (16) does not match Epic items", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 16, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 3 }))).toBe(false); // Epic index=3
  });

  it("Epic (9) matches Epic and above", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 9, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 3 }))).toBe(true); // Epic
    expect(matchesRule(rule, makeItem({ rarity: 4 }))).toBe(true); // Legendary
    expect(matchesRule(rule, makeItem({ rarity: 2 }))).toBe(false); // Rare
  });

  it("unknown rarity ID never matches", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 99, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ rarity: 5 }))).toBe(false); // even Mythical
  });
});

describe("matchesRule — MainStatID", () => {
  it("matches when main stat matches", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: 4 });
    expect(matchesRule(rule, makeItem({ mainStat: 4 }))).toBe(true);
  });

  it("does not match when main stat differs", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: 4 });
    expect(matchesRule(rule, makeItem({ mainStat: 2 }))).toBe(false);
  });

  it("MainStatID -1 matches any main stat", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1 });
    expect(matchesRule(rule, makeItem({ mainStat: 8 }))).toBe(true);
  });
});

describe("matchesRule — Faction", () => {
  it("matches when faction matches", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, Faction: 3 });
    expect(matchesRule(rule, makeItem({ faction: 3 }))).toBe(true);
  });

  it("does not match when faction differs", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, Faction: 3 });
    expect(matchesRule(rule, makeItem({ faction: 7 }))).toBe(false);
  });

  it("items without faction never match non-zero Faction rule", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, Faction: 3 });
    expect(matchesRule(rule, makeItem())).toBe(false); // faction is undefined
  });

  it("Faction 0 matches any item regardless of faction", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0, MainStatID: -1, Faction: 0 });
    expect(matchesRule(rule, makeItem({ faction: 5 }))).toBe(true);
    expect(matchesRule(rule, makeItem())).toBe(true); // no faction
  });
});

// ---------------------------------------------------------------------------
// matchesRule — combined conditions (AND logic)
// ---------------------------------------------------------------------------

describe("matchesRule — combined conditions", () => {
  it("all conditions must pass for a match", () => {
    const rule = defaultRule({
      ArtifactSet: [1],
      ArtifactType: [5],
      Rank: 5,
      Rarity: 9, // Epic
      MainStatID: 2,
      Faction: 0,
    });
    // Item that matches all
    expect(matchesRule(rule, makeItem({
      set: 1, slot: 5, rank: 6, rarity: 4, mainStat: 2,
    }))).toBe(true);
  });

  it("fails if any single condition fails", () => {
    const rule = defaultRule({
      ArtifactSet: [1],
      ArtifactType: [5],
      Rank: 5,
      Rarity: 9,
      MainStatID: 2,
      Faction: 0,
    });
    // Wrong set
    expect(matchesRule(rule, makeItem({
      set: 99, slot: 5, rank: 6, rarity: 4, mainStat: 2,
    }))).toBe(false);
    // Wrong slot
    expect(matchesRule(rule, makeItem({
      set: 1, slot: 3, rank: 6, rarity: 4, mainStat: 2,
    }))).toBe(false);
    // Rank too low
    expect(matchesRule(rule, makeItem({
      set: 1, slot: 5, rank: 3, rarity: 4, mainStat: 2,
    }))).toBe(false);
  });
});
