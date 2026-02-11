/**
 * User settings — centralized defaults for the web UI.
 * Persisted in localStorage, shallow-merged with defaults for forward compatibility.
 */

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

export function getSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const stored = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
