// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderQuickGenerator, defaultQuickState } from "../quick-generator.js";
import type { QuickGenState } from "../quick-generator.js";

let state: QuickGenState;
let onChange: ReturnType<typeof vi.fn>;

function render(): void {
  document.body.innerHTML = '<div id="quick-tiers"></div>';
  state = defaultQuickState();
  onChange = vi.fn();
  renderQuickGenerator(state, onChange);
}

/** A drop event carrying `text`, or carrying nothing when `text` is undefined. */
function dropEvent(text: string | undefined): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { getData: () => text ?? "" } });
  return event;
}

beforeEach(render);

describe("tier rolls input", () => {
  function rollsInput(): HTMLInputElement {
    return document.querySelector(".quick-tier-rolls-input") as HTMLInputElement;
  }

  it("rounds a typed decimal on input", () => {
    const input = rollsInput();
    input.value = "6.5";
    input.dispatchEvent(new Event("input"));

    expect(state.blocks[0].tiers[0].rolls).toBe(7);
  });

  it("rounds a typed decimal on blur and shows the rounded value", () => {
    const input = rollsInput();
    input.value = "6.5";
    input.dispatchEvent(new Event("blur"));

    expect(state.blocks[0].tiers[0].rolls).toBe(7);
    expect(input.value).toBe("7");
  });

  it("stores a whole number in range after a wheel step from a decimal", () => {
    const input = rollsInput();
    input.value = "6.5";
    input.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, cancelable: true }));

    const rolls = state.blocks[0].tiers[0].rolls;
    expect(Number.isInteger(rolls)).toBe(true);
    expect(rolls).toBeGreaterThanOrEqual(1);
    expect(rolls).toBeLessThanOrEqual(9);
    expect(input.value).toBe(String(rolls));
  });

  it("clamps an out-of-range value on blur", () => {
    const input = rollsInput();
    input.value = "99";
    input.dispatchEvent(new Event("blur"));

    expect(state.blocks[0].tiers[0].rolls).toBe(9);
  });
});

describe("tier column drops", () => {
  function tierColumn(): HTMLElement {
    return document.querySelector(
      ".quick-tier-columns:not(.ore-columns) .quick-tier-column",
    ) as HTMLElement;
  }

  it("ignores text that is not a known set id", () => {
    const before = { ...state.blocks[0].assignments };
    tierColumn().dispatchEvent(dropEvent("abc"));

    expect(state.blocks[0].assignments).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores a dropped id that is not a known set", () => {
    const before = { ...state.blocks[0].assignments };
    tierColumn().dispatchEvent(dropEvent("99999"));

    expect(state.blocks[0].assignments).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("assigns a known set that is not already in that column", () => {
    const column = tierColumn();
    const tier = Number(column.dataset.tier);
    const id = Number(
      Object.keys(state.blocks[0].assignments).find((k) => state.blocks[0].assignments[Number(k)] !== tier),
    );

    column.dispatchEvent(dropEvent(String(id)));

    expect(state.blocks[0].assignments[id]).toBe(tier);
    expect(onChange).toHaveBeenCalled();
  });
});

describe("ore reroll column drops", () => {
  function oreColumn(): HTMLElement {
    return document.querySelector(
      ".ore-columns .quick-tier-column:not(.quick-tier-sell)",
    ) as HTMLElement;
  }

  it("ignores text that is not a known set id", () => {
    const column = oreColumn();
    expect(column).not.toBeNull();

    const before = { ...state.oreReroll!.assignments };
    column.dispatchEvent(dropEvent("abc"));

    expect(state.oreReroll!.assignments).toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("assigns a known set to the column", () => {
    const column = oreColumn();
    const col = Number(column.dataset.oreCol);

    column.dispatchEvent(dropEvent("1"));

    expect(state.oreReroll!.assignments[1]).toBe(col);
    expect(onChange).toHaveBeenCalled();
  });
});
