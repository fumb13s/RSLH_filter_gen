// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { initSettingsModal } from "../settings-modal.js";
import { DEFAULT_SETTINGS } from "../settings.js";

const NEWER_NOTE = "Your settings were saved by a newer version of the app. Reload the page to see or change them.";

/** initSettingsModal looks its elements up with `!` and attaches listeners immediately. */
function setupDOM(): void {
  document.body.innerHTML =
    '<div id="settings-overlay"><div id="settings-body"></div><button id="settings-close"></button></div>';
}

function openModal(): void {
  initSettingsModal().open();
}

function controls(): (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] {
  const body = document.getElementById("settings-body")!;
  return [...body.querySelectorAll("input, select, .settings-reset-btn")] as (
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLButtonElement
  )[];
}

beforeEach(() => {
  localStorage.clear();
  setupDOM();
});

describe("settings modal: settings from a newer version", () => {
  beforeEach(() => {
    localStorage.setItem("rslh-settings", JSON.stringify({ version: 2, settings: { maxTabs: 3 } }));
  });

  it("shows the note at the top of the form", () => {
    openModal();

    const body = document.getElementById("settings-body")!;
    expect(body.textContent).toContain(NEWER_NOTE);
    expect(body.firstElementChild?.textContent).toBe(NEWER_NOTE);
  });

  it("disables every input, select and the reset button", () => {
    openModal();

    const all = controls();
    expect(all.length).toBeGreaterThan(0);
    for (const control of all) expect(control.disabled).toBe(true);
  });

  it("leaves the stored settings untouched", () => {
    const stored = localStorage.getItem("rslh-settings");
    openModal();

    expect(localStorage.getItem("rslh-settings")).toBe(stored);
  });
});

describe("settings modal: current settings", () => {
  it("shows no note and leaves the controls enabled", () => {
    openModal();

    const body = document.getElementById("settings-body")!;
    expect(body.textContent).not.toContain(NEWER_NOTE);

    const all = controls();
    expect(all.length).toBeGreaterThan(0);
    for (const control of all) expect(control.disabled).toBe(false);
  });
});

describe("settings modal: number inputs", () => {
  it("rounds a typed decimal before storing it", () => {
    openModal();

    const input = document.querySelector(".settings-input-number") as HTMLInputElement;
    input.value = "6.5";
    input.dispatchEvent(new Event("change"));

    expect(input.value).toBe("7");

    const stored = JSON.parse(localStorage.getItem("rslh-settings")!);
    expect(stored.settings.quickTierRolls[0]).toBe(7);
  });

  it("still clamps a typed value to the field's range", () => {
    openModal();

    const input = document.querySelector(".settings-input-number") as HTMLInputElement;
    input.value = "99";
    input.dispatchEvent(new Event("change"));

    expect(input.value).toBe("9");
  });

  it("writes an envelope the loader reads back", () => {
    openModal();

    const input = document.querySelector(".settings-input-number") as HTMLInputElement;
    input.value = "3";
    input.dispatchEvent(new Event("change"));

    const stored = JSON.parse(localStorage.getItem("rslh-settings")!);
    expect(stored.version).toBe(1);
    expect(stored.settings.quickTierRolls).toEqual([3, ...DEFAULT_SETTINGS.quickTierRolls.slice(1)]);
  });
});
