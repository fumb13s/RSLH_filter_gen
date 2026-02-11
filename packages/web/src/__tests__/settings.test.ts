import { describe, it, expect, beforeEach } from "vitest";
import { getSettings, saveSettings, DEFAULT_SETTINGS } from "../settings.js";

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
