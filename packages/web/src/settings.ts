/**
 * User settings — centralized defaults for the web UI.
 *
 * Persisted in localStorage as `{ version, settings }`. Settings stored before versioning existed
 * are flat, and count as version 1. Each field falls back to its own default when it is missing or
 * out of range, so a single bad field never costs the others. Migration happens in memory: nothing
 * is written until the player changes a setting.
 */
import { z } from "zod";
import { loadVersioned, wrap } from "./versioned.js";
import type { VersionedFormat } from "./versioned.js";

export type TabType = "viewer" | "generator" | "quick";

export interface UserSettings {
  defaultTabType: TabType;
  maxTabs: number;
  maxTabLabelWidthPercent: number;
  generatorDefaultRolls: number;
  quickTierRolls: [number, number, number, number];
  rank5RollAdjustment: number;
  oreRerollColumns: [number, number, number];
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultTabType: "quick",
  maxTabs: 9,
  maxTabLabelWidthPercent: 100,
  generatorDefaultRolls: 6,
  quickTierRolls: [5, 7, 8, 9],
  rank5RollAdjustment: 2,
  oreRerollColumns: [3, 4, 5],
};

const STORAGE_KEY = "rslh-settings";

/** Fresh copies every time, so editing what a caller got never alters the defaults. */
export function defaultSettings(): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    quickTierRolls: [...DEFAULT_SETTINGS.quickTierRolls],
    oreRerollColumns: [...DEFAULT_SETTINGS.oreRerollColumns],
  };
}

const rollsInRange = (min: number, max: number) => z.number().int().min(min).max(max);

// Array fallbacks are factories, so each caller gets its own copy and can never edit the defaults.
const tierRollsFallback = (): [number, number, number, number] => [...DEFAULT_SETTINGS.quickTierRolls];
const oreColumnsFallback = (): [number, number, number] => [...DEFAULT_SETTINGS.oreRerollColumns];

/**
 * Version 1. Each field carries `.default()` for when it is missing and `.catch()` for when it
 * fails its check, so one bad field falls back on its own and the others are kept.
 */
const settingsV1: z.ZodType<UserSettings, z.ZodTypeDef, unknown> = z.object({
  defaultTabType: z
    .enum(["viewer", "generator", "quick"])
    .default(DEFAULT_SETTINGS.defaultTabType)
    .catch(DEFAULT_SETTINGS.defaultTabType),
  maxTabs: z.number().int().positive().default(DEFAULT_SETTINGS.maxTabs).catch(DEFAULT_SETTINGS.maxTabs),
  maxTabLabelWidthPercent: z
    .number()
    .positive()
    .default(DEFAULT_SETTINGS.maxTabLabelWidthPercent)
    .catch(DEFAULT_SETTINGS.maxTabLabelWidthPercent),
  generatorDefaultRolls: rollsInRange(4, 9)
    .default(DEFAULT_SETTINGS.generatorDefaultRolls)
    .catch(DEFAULT_SETTINGS.generatorDefaultRolls),
  quickTierRolls: z
    .tuple([rollsInRange(1, 9), rollsInRange(1, 9), rollsInRange(1, 9), rollsInRange(1, 9)])
    .default(tierRollsFallback)
    .catch(tierRollsFallback),
  rank5RollAdjustment: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(DEFAULT_SETTINGS.rank5RollAdjustment)
    .catch(DEFAULT_SETTINGS.rank5RollAdjustment),
  oreRerollColumns: z
    .tuple([rollsInRange(1, 9), rollsInRange(1, 9), rollsInRange(1, 9)])
    .default(oreColumnsFallback)
    .catch(oreColumnsFallback),
});

export const SETTINGS_FORMAT: VersionedFormat<UserSettings> = {
  past: [],
  current: settingsV1,
  dataKey: "settings",
  unversioned: 1,
};

/** Reads and parses storage. Returns undefined when storage is missing, unavailable or unparsable. */
function readStored(): unknown {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Reads storage once and reports both the settings to use and whether what is stored came from a
 * newer version of the app. Callers that need both ask for both here: `loadVersioned` owns the rule
 * for which of those a stored document is, so nothing outside it decides "newer" a second time.
 */
export function loadSettings(): { settings: UserSettings; newer: boolean } {
  const stored = readStored();
  if (stored === undefined || typeof stored !== "object" || stored === null) {
    return { settings: defaultSettings(), newer: false };
  }

  const result = loadVersioned(SETTINGS_FORMAT, stored);
  if (result.kind === "ok") return { settings: result.value, newer: false };
  return { settings: defaultSettings(), newer: result.kind === "newer" };
}

export function getSettings(): UserSettings {
  return loadSettings().settings;
}

export function saveSettings(settings: UserSettings): void {
  // Never overwrite settings a newer version of the app wrote.
  if (loadSettings().newer) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrap(SETTINGS_FORMAT, settings)));
  } catch {
    // Storage unavailable (private browsing, or a test environment without localStorage).
  }
}
