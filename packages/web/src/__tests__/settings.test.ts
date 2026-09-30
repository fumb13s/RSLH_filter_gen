import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "../settings.js";

// Minimal localStorage stub for Node
const store: Record<string, string> = {};
const localStorageStub = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
};

// Inject stub before each test
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  Object.defineProperty(globalThis, "localStorage", { value: localStorageStub, writable: true });
});

describe("getSettings", () => {
  it("returns defaults when localStorage is empty", () => {
    const s = getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial stored values with defaults", () => {
    store["rslh-settings"] = JSON.stringify({ generatorDefaultRolls: 8 });
    const s = getSettings();
    expect(s.generatorDefaultRolls).toBe(8);
    // Other fields should come from defaults
    expect(s.defaultTabType).toBe(DEFAULT_SETTINGS.defaultTabType);
    expect(s.rank5RollAdjustment).toBe(DEFAULT_SETTINGS.rank5RollAdjustment);
    expect(s.oreRerollColumns).toEqual(DEFAULT_SETTINGS.oreRerollColumns);
  });

  it("falls back to defaults on corrupt localStorage", () => {
    store["rslh-settings"] = "not valid json{{{";
    const s = getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});

describe("saveSettings", () => {
  it("round-trips through getSettings", () => {
    const custom = { ...DEFAULT_SETTINGS, generatorDefaultRolls: 4, rank5RollAdjustment: 3 };
    saveSettings(custom);
    const loaded = getSettings();
    expect(loaded.generatorDefaultRolls).toBe(4);
    expect(loaded.rank5RollAdjustment).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

describe("settings versioning", () => {
  it("reads pre-versioning flat settings as version 1", () => {
    store["rslh-settings"] = JSON.stringify({ generatorDefaultRolls: 8 });
    expect(getSettings().generatorDefaultRolls).toBe(8);
  });

  it("writes nothing when loading", () => {
    const stored = JSON.stringify({ generatorDefaultRolls: 8 });
    store["rslh-settings"] = stored;
    getSettings();
    expect(store["rslh-settings"]).toBe(stored);
  });

  it("writes an envelope at version 1", () => {
    saveSettings(DEFAULT_SETTINGS);
    expect(JSON.parse(store["rslh-settings"])).toEqual({ version: 1, settings: DEFAULT_SETTINGS });
  });

  it("reads back an envelope it wrote", () => {
    store["rslh-settings"] = JSON.stringify({
      version: 1,
      settings: { ...DEFAULT_SETTINGS, maxTabs: 5 },
    });
    expect(getSettings().maxTabs).toBe(5);
  });

  it("falls back on one bad field alone and keeps the others", () => {
    store["rslh-settings"] = JSON.stringify({
      version: 1,
      settings: { ...DEFAULT_SETTINGS, rank5RollAdjustment: 99, maxTabs: 5, generatorDefaultRolls: 8 },
    });

    const s = getSettings();
    expect(s.rank5RollAdjustment).toBe(DEFAULT_SETTINGS.rank5RollAdjustment);
    expect(s.maxTabs).toBe(5);
    expect(s.generatorDefaultRolls).toBe(8);
  });

  it("falls back per field for a bad tier-rolls array", () => {
    store["rslh-settings"] = JSON.stringify({
      version: 1,
      settings: { quickTierRolls: [1, 2, 99], oreRerollColumns: "nope", maxTabs: 5 },
    });

    const s = getSettings();
    expect(s.quickTierRolls).toEqual(DEFAULT_SETTINGS.quickTierRolls);
    expect(s.oreRerollColumns).toEqual(DEFAULT_SETTINGS.oreRerollColumns);
    expect(s.maxTabs).toBe(5);
  });

  it("hands out independent copies of the array defaults", () => {
    const before = [...DEFAULT_SETTINGS.quickTierRolls];
    getSettings().quickTierRolls[0] = 1;
    expect(DEFAULT_SETTINGS.quickTierRolls).toEqual(before);
    expect(getSettings().quickTierRolls).toEqual(before);
  });

  it("returns defaults when storage is unavailable", () => {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, writable: true });
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults when the stored value is not an object", () => {
    store["rslh-settings"] = JSON.stringify("nope");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("uses defaults for settings from a newer version", () => {
    store["rslh-settings"] = JSON.stringify({ version: 2, settings: { maxTabs: 3 } });

    expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS, newer: true });
  });

  // One call, one read: the modal needs the settings and the newer flag together, and used to
  // parse storage once for each.
  it("reads storage once for both the settings and the newer flag", () => {
    store["rslh-settings"] = JSON.stringify({ version: 1, settings: { maxTabs: 5 } });
    let reads = 0;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        ...localStorageStub,
        getItem: (key: string) => {
          reads++;
          return localStorageStub.getItem(key);
        },
      },
      writable: true,
    });

    expect(loadSettings()).toEqual({ settings: { ...DEFAULT_SETTINGS, maxTabs: 5 }, newer: false });
    expect(reads).toBe(1);
  });

  it("never overwrites settings from a newer version", () => {
    const stored = JSON.stringify({ version: 2, settings: { maxTabs: 3 } });
    store["rslh-settings"] = stored;

    saveSettings({ ...DEFAULT_SETTINGS, maxTabs: 7 });

    expect(store["rslh-settings"]).toBe(stored);
  });

  it("treats a version marker that is not a positive integer as corrupt, not newer", () => {
    for (const version of ["x", 0, -1, 1.5, null]) {
      store["rslh-settings"] = JSON.stringify({ version, settings: { maxTabs: 3 } });

      expect(loadSettings()).toEqual({ settings: DEFAULT_SETTINGS, newer: false });
    }
  });

  it("lets the next save replace a corrupt version marker", () => {
    store["rslh-settings"] = JSON.stringify({ version: "x", settings: { maxTabs: 3 } });

    saveSettings({ ...DEFAULT_SETTINGS, maxTabs: 7 });

    expect(JSON.parse(store["rslh-settings"])).toEqual({
      version: 1,
      settings: { ...DEFAULT_SETTINGS, maxTabs: 7 },
    });
  });

  it("reports no newer version for current or missing settings", () => {
    expect(loadSettings().newer).toBe(false);

    saveSettings(DEFAULT_SETTINGS);
    expect(loadSettings().newer).toBe(false);

    store["rslh-settings"] = JSON.stringify({ generatorDefaultRolls: 8 });
    expect(loadSettings().newer).toBe(false);
  });

  it("round-trips every field set to a non-default value", () => {
    const custom = {
      defaultTabType: "viewer" as const,
      maxTabs: 4,
      maxTabLabelWidthPercent: 55,
      generatorDefaultRolls: 9,
      quickTierRolls: [1, 2, 3, 4] as [number, number, number, number],
      rank5RollAdjustment: 5,
      oreRerollColumns: [7, 8, 9] as [number, number, number],
    };

    saveSettings(custom);
    expect(getSettings()).toEqual(custom);
  });
});
