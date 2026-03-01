// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SharedDropdown } from "../shared-dropdown.js";
import type { DropdownOption } from "../shared-dropdown.js";

const OPTIONS: DropdownOption[] = [
  { value: "0", label: "Any" },
  { value: "5", label: "5-star" },
  { value: "6", label: "6-star" },
];

describe("SharedDropdown", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="container"><button id="trigger">Pick</button></div>';
  });

  it("creates a panel element appended to body", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    expect(document.querySelector(".shared-dropdown-panel")).not.toBeNull();
    dd.destroy();
  });

  it("is hidden by default", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.classList.contains("open")).toBe(false);
    dd.destroy();
  });

  it("opens below trigger and shows options", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5", onSelect);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.classList.contains("open")).toBe(true);
    expect(panel.querySelectorAll(".shared-dropdown-item").length).toBe(3);
    dd.destroy();
  });

  it("has correct ARIA attributes", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    const panel = document.querySelector(".shared-dropdown-panel") as HTMLElement;
    expect(panel.getAttribute("role")).toBe("listbox");

    const trigger = document.getElementById("trigger")!;
    dd.open(trigger, "5", vi.fn());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const items = panel.querySelectorAll(".shared-dropdown-item");
    for (const item of items) {
      expect(item.getAttribute("role")).toBe("option");
    }

    dd.close();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    dd.destroy();
  });

  it("highlights the current value", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "5", vi.fn());
    const active = document.querySelector(".shared-dropdown-item.active");
    expect(active!.textContent).toBe("5-star");
    dd.destroy();
  });

  it("fires onSelect callback when item clicked", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", onSelect);
    (document.querySelectorAll(".shared-dropdown-item")[2] as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("6");
    dd.destroy();
  });

  it("closes on Escape", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("navigates with arrow keys", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    const items = document.querySelectorAll(".shared-dropdown-item");
    expect(items[0].classList.contains("active")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(items[1].classList.contains("active")).toBe(true);
    dd.destroy();
  });

  it("selects on Enter", () => {
    const onSelect = vi.fn();
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", onSelect);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith("5");
    dd.destroy();
  });

  it("click outside closes panel", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    document.body.click();
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("closes on scroll", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.open(document.getElementById("trigger")!, "0", vi.fn());
    expect(document.querySelector(".shared-dropdown-panel.open")).not.toBeNull();
    window.dispatchEvent(new Event("scroll"));
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    dd.destroy();
  });

  it("destroys and removes panel from DOM", () => {
    const dd = new SharedDropdown("test-rank", OPTIONS);
    dd.destroy();
    expect(document.querySelector(".shared-dropdown-panel")).toBeNull();
  });
});
