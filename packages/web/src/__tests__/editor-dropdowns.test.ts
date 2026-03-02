// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HsfFilter, HsfRule } from "@rslh/core";
import { defaultRule } from "@rslh/core";
import { renderEditableRules, clearEditor } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";

function setupDOM(): void {
  document.body.innerHTML =
    '<div id="rules-pagination" hidden></div>' +
    '<div id="rules-container"></div>' +
    '<div id="rules-pagination-bottom" hidden></div>';
}

function makeFilter(rules: HsfRule[]): HsfFilter {
  return { Rules: rules };
}

function noopCallbacks(
  overrides?: Partial<RuleEditorCallbacks>,
): RuleEditorCallbacks {
  return {
    onRuleChange: overrides?.onRuleChange ?? (() => {}),
    onRuleDelete: overrides?.onRuleDelete ?? (() => {}),
    onRuleMove: overrides?.onRuleMove ?? (() => {}),
    onRuleAdd: overrides?.onRuleAdd ?? (() => {}),
  };
}

/** Click a trigger button, find an option by value in the open panel, click it. */
function selectDropdownValue(trigger: HTMLElement, value: string): void {
  trigger.click();
  const panel = document.querySelector(".shared-dropdown-panel.open");
  expect(panel, "panel should be open after clicking trigger").not.toBeNull();
  const item = Array.from(
    panel!.querySelectorAll(".shared-dropdown-item"),
  ).find(
    (el) => (el as HTMLElement).dataset.value === value,
  ) as HTMLElement | undefined;
  expect(
    item,
    `option with value="${value}" should exist`,
  ).not.toBeUndefined();
  item!.click();
}

describe("shared dropdown integration", () => {
  beforeEach(() => {
    setupDOM();
  });

  afterEach(() => {
    clearEditor();
  });

  it("rank trigger shows correct label and updates rule on selection", () => {
    const rule = defaultRule({ Rank: 0 });
    const filter = makeFilter([rule]);
    const changes: number[] = [];
    renderEditableRules(
      filter,
      noopCallbacks({
        onRuleChange(index) {
          changes.push(index);
        },
      }),
    );

    const trigger = document.querySelector(
      "[data-field='rank']",
    ) as HTMLElement;
    expect(trigger.textContent).toBe("Any");

    selectDropdownValue(trigger, "6");
    expect(trigger.textContent).toBe("6-star");
    expect(trigger.dataset.value).toBe("6");
    expect(rule.Rank).toBe(6);
    expect(changes).toEqual([0]);
  });

  it("rarity trigger updates rule", () => {
    const rule = defaultRule({ Rarity: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector(
      "[data-field='rarity']",
    ) as HTMLElement;
    selectDropdownValue(trigger, "9");
    expect(rule.Rarity).toBe(9);
    expect(trigger.textContent).toBe("Epic");
  });

  it("main-stat trigger encodes/decodes correctly", () => {
    const rule = defaultRule();
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector(
      "[data-field='main-stat']",
    ) as HTMLElement;
    expect(trigger.dataset.value).toBe("-1"); // default = Any

    selectDropdownValue(trigger, "5:0");
    expect(rule.MainStatID).toBe(5);
    expect(rule.MainStatF).toBe(1); // flatFlag=0 -> MainStatF=1 (percent)
    expect(trigger.textContent).toBe("C.RATE");
  });

  it("level trigger updates rule", () => {
    const rule = defaultRule({ LVLForCheck: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector(
      "[data-field='level']",
    ) as HTMLElement;
    selectDropdownValue(trigger, "12");
    expect(rule.LVLForCheck).toBe(12);
  });

  it("faction trigger updates rule", () => {
    const rule = defaultRule({ Faction: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector(
      "[data-field='faction']",
    ) as HTMLElement;
    selectDropdownValue(trigger, "3");
    expect(rule.Faction).toBe(3);
    expect(trigger.textContent).toBe("Sacred Order");
  });

  it("substat-stat trigger selects stat and enables condition/value", () => {
    const rule = defaultRule(); // all substats empty (ID:-1)
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const statTriggers = document.querySelectorAll(
      ".edit-sub-stat",
    ) as NodeListOf<HTMLElement>;
    const row = statTriggers[0].closest(".edit-substat-row")!;
    const condSelect = row.querySelector(
      ".edit-sub-cond",
    ) as HTMLSelectElement;
    const valueInput = row.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;

    // Initially disabled
    expect(condSelect.disabled).toBe(true);
    expect(valueInput.disabled).toBe(true);

    // Select HP% (1:0)
    selectDropdownValue(statTriggers[0], "1:0");

    expect(rule.Substats[0].ID).toBe(1);
    expect(rule.Substats[0].IsFlat).toBe(false);
    expect(condSelect.disabled).toBe(false);
    expect(valueInput.disabled).toBe(false);
  });

  it("substat-stat trigger reset to None disables condition/value", () => {
    const rule = defaultRule();
    rule.Substats[0] = {
      ID: 5,
      Value: 15,
      IsFlat: false,
      NotAvailable: false,
      Condition: ">",
    };
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const statTriggers = document.querySelectorAll(
      ".edit-sub-stat",
    ) as NodeListOf<HTMLElement>;

    selectDropdownValue(statTriggers[0], "-1");

    expect(rule.Substats[0].ID).toBe(-1);
    expect(rule.Substats[0].Value).toBe(0);

    const row = statTriggers[0].closest(".edit-substat-row")!;
    expect(
      (row.querySelector(".edit-sub-cond") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (row.querySelector('input[type="number"]') as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("Escape closes panel without changing value", () => {
    const rule = defaultRule({ Rank: 5 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const trigger = document.querySelector(
      "[data-field='rank']",
    ) as HTMLElement;
    trigger.click();
    expect(
      document.querySelector(".shared-dropdown-panel.open"),
    ).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(document.querySelector(".shared-dropdown-panel.open")).toBeNull();
    expect(rule.Rank).toBe(5); // unchanged
  });

  it("switching triggers closes previous panel and opens new one", () => {
    const rule = defaultRule({ Rank: 0, Rarity: 0 });
    const filter = makeFilter([rule]);
    renderEditableRules(filter, noopCallbacks());

    const rankTrigger = document.querySelector(
      "[data-field='rank']",
    ) as HTMLElement;
    const rarityTrigger = document.querySelector(
      "[data-field='rarity']",
    ) as HTMLElement;

    // Open rank dropdown
    rankTrigger.click();
    expect(
      document.querySelector(
        ".shared-dropdown-panel.open[data-field-type='rank']",
      ),
    ).not.toBeNull();

    // Click rarity trigger -- rank panel should close, rarity panel should open
    rarityTrigger.click();
    expect(
      document.querySelector(
        ".shared-dropdown-panel.open[data-field-type='rank']",
      ),
    ).toBeNull();
    expect(
      document.querySelector(
        ".shared-dropdown-panel.open[data-field-type='rarity']",
      ),
    ).not.toBeNull();
  });

  it("dropdown on second card updates correct rule", () => {
    const rule0 = defaultRule({ Rank: 0 });
    const rule1 = defaultRule({ Rank: 5 });
    const filter = makeFilter([rule0, rule1]);
    const changes: number[] = [];
    renderEditableRules(
      filter,
      noopCallbacks({
        onRuleChange(index) {
          changes.push(index);
        },
      }),
    );

    // Find the rank trigger on the second card (rule-index="1")
    const cards = document.querySelectorAll("[data-rule-index]");
    const card1 = cards[1];
    const trigger = card1.querySelector(
      "[data-field='rank']",
    ) as HTMLElement;
    expect(trigger.dataset.value).toBe("5");

    selectDropdownValue(trigger, "6");
    expect(rule1.Rank).toBe(6);
    expect(rule0.Rank).toBe(0); // first rule unchanged
    expect(changes).toEqual([1]); // callback fired with index 1
  });

  it("clearEditor destroys dropdown panels", () => {
    const filter = makeFilter([defaultRule()]);
    renderEditableRules(filter, noopCallbacks());

    expect(
      document.querySelectorAll(".shared-dropdown-panel").length,
    ).toBe(6);
    clearEditor();
    expect(
      document.querySelectorAll(".shared-dropdown-panel").length,
    ).toBe(0);
  });
});
