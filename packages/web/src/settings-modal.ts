/**
 * Settings modal — renders the settings form and auto-saves on change.
 */
import { getSettings, saveSettings } from "./settings.js";
import type { TabType } from "./settings.js";

export interface SettingsModal {
  open: () => void;
  close: () => void;
}

export function initSettingsModal(onOpen?: () => void): SettingsModal {
  const overlay = document.getElementById("settings-overlay")!;
  const closeBtn = document.getElementById("settings-close")!;
  const body = document.getElementById("settings-body")!;

  function open(): void {
    onOpen?.();
    renderForm();
    overlay.classList.add("open");
  }

  function close(): void {
    overlay.classList.remove("open");
  }

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) close();
  });

  function renderForm(): void {
    const settings = getSettings();
    body.innerHTML = "";

    // --- General ---
    const generalFs = fieldset("General");

    const tabSelect = document.createElement("select");
    tabSelect.className = "settings-select";
    const tabOptions: { value: TabType; label: string }[] = [
      { value: "quick", label: "Quick Generator" },
      { value: "generator", label: "Generator" },
      { value: "viewer", label: "Viewer" },
    ];
    for (const opt of tabOptions) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (settings.defaultTabType === opt.value) o.selected = true;
      tabSelect.appendChild(o);
    }
    tabSelect.addEventListener("change", () => {
      settings.defaultTabType = tabSelect.value as TabType;
      saveSettings(settings);
    });

    generalFs.appendChild(row("Default tab type", tabSelect));
    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent = "Takes effect on next page load.";
    generalFs.appendChild(hint);

    body.appendChild(generalFs);

    // --- Quick Generator ---
    const quickFs = fieldset("Quick Generator");

    const tierNames = ["Must-Keep", "Good", "Situational", "Off-Set"];
    for (let i = 0; i < 4; i++) {
      quickFs.appendChild(
        row(
          `${tierNames[i]} rolls`,
          numberInput(settings.quickTierRolls[i], 1, 9, (v) => {
            settings.quickTierRolls[i] = v;
            saveSettings(settings);
          }),
        ),
      );
    }

    quickFs.appendChild(
      row(
        "Rank-5 roll adjustment",
        numberInput(settings.rank5RollAdjustment, 0, 5, (v) => {
          settings.rank5RollAdjustment = v;
          saveSettings(settings);
        }),
      ),
    );

    const oreLabels = ["Column 1 rolls", "Column 2 rolls", "Column 3 rolls"];
    for (let i = 0; i < 3; i++) {
      quickFs.appendChild(
        row(
          oreLabels[i],
          numberInput(settings.oreRerollColumns[i], 1, 9, (v) => {
            settings.oreRerollColumns[i] = v;
            saveSettings(settings);
          }),
        ),
      );
    }

    body.appendChild(quickFs);

    // --- Manual Generator ---
    const manualFs = fieldset("Manual Generator");

    manualFs.appendChild(
      row(
        "Default rolls",
        numberInput(settings.generatorDefaultRolls, 4, 9, (v) => {
          settings.generatorDefaultRolls = v;
          saveSettings(settings);
        }),
      ),
    );

    body.appendChild(manualFs);

    // --- Footer ---
    const storageHint = document.createElement("div");
    storageHint.className = "settings-hint";
    storageHint.textContent = "Settings are saved in your browser's local storage.";
    body.appendChild(storageHint);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "settings-reset-btn";
    resetBtn.textContent = "Reset to Defaults";
    resetBtn.addEventListener("click", () => {
      localStorage.removeItem("rslh-settings");
      renderForm();
    });
    body.appendChild(resetBtn);
  }

  return { open, close };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldset(legend: string): HTMLFieldSetElement {
  const fs = document.createElement("fieldset");
  fs.className = "settings-fieldset";
  const leg = document.createElement("legend");
  leg.textContent = legend;
  fs.appendChild(leg);
  return fs;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = "settings-row";
  const lbl = document.createElement("span");
  lbl.className = "settings-label";
  lbl.textContent = label;
  div.appendChild(lbl);
  div.appendChild(control);
  return div;
}

function numberInput(
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input-number";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("change", () => {
    const v = Math.max(min, Math.min(max, Number(input.value) || value));
    input.value = String(v);
    onChange(v);
  });
  return input;
}
