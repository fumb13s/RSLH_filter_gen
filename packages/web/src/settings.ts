/**
 * User settings — centralized defaults for the web UI.
 * getSettings() returns defaults for now; later can merge with localStorage.
 */

export type TabType = "viewer" | "generator" | "quick";

export interface UserSettings {
  defaultTabType: TabType;
  maxTabs: number;
  maxTabLabelWidthPercent: number;
  generatorDefaultRolls: number;
  quickTierRolls: [number, number, number, number];
}

export const DEFAULT_SETTINGS: UserSettings = {
  defaultTabType: "quick",
  maxTabs: 9,
  maxTabLabelWidthPercent: 100,
  generatorDefaultRolls: 6,
  quickTierRolls: [4, 6, 7, 9],
};

export function getSettings(): UserSettings {
  return DEFAULT_SETTINGS;
}
