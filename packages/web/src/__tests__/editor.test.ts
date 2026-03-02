// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HsfFilter, HsfRule } from "@rslh/core";
import { defaultRule } from "@rslh/core";
import { renderEditableRules, clearEditor } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";

// Minimal DOM setup — vitest uses JSDOM by default
function setupDOM(): void {
  document.body.innerHTML =
    '<div id="rules-pagination" hidden></div>' +
    '<div id="rules-container"></div>' +
    '<div id="rules-pagination-bottom" hidden></div>';
}

function makeFilter(rules: HsfRule[]): HsfFilter {
  return { Rules: rules };
}

function noopCallbacks(overrides?: Partial<RuleEditorCallbacks>): RuleEditorCallbacks {
  return {
    onRuleChange: overrides?.onRuleChange ?? (() => {}),
    onRuleDelete: overrides?.onRuleDelete ?? (() => {}),
    onRuleMove: overrides?.onRuleMove ?? (() => {}),
    onRuleAdd: overrides?.onRuleAdd ?? (() => {}),
  };
}

describe("editor", () => {
  beforeEach(setupDOM);
  afterEach(() => {
    clearEditor();
  });

  describe("renderEditableRules", () => {
    it("renders one card per rule", () => {
      const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
      renderEditableRules(filter, noopCallbacks());

      const container = document.getElementById("rules-container")!;
      const cards = container.querySelectorAll(".edit-card");
      expect(cards.length).toBe(3);
    });

    it("shows rule indices", () => {
      const filter = makeFilter([defaultRule(), defaultRule()]);
      renderEditableRules(filter, noopCallbacks());

      const indices = document.querySelectorAll(".rule-index");
      expect(indices[0].textContent).toBe("#1");
      expect(indices[1].textContent).toBe("#2");
    });

    it("shows Keep/Sell badge", () => {
      const filter = makeFilter([
        defaultRule({ Keep: true }),
        defaultRule({ Keep: false }),
      ]);
      renderEditableRules(filter, noopCallbacks());

      const badges = document.querySelectorAll(".edit-badge-toggle");
      // First rule: Keep badge, Active badge
      expect(badges[0].textContent).toBe("Keep");
      expect(badges[2].textContent).toBe("Sell");
    });
  });

  describe("Keep/Sell toggle", () => {
    it("toggles Keep to Sell and fires onRuleChange", () => {
      const rule = defaultRule({ Keep: true });
      const filter = makeFilter([rule]);
      const changes: [number, HsfRule][] = [];

      renderEditableRules(filter, noopCallbacks({
        onRuleChange(index, r) { changes.push([index, r]); },
      }));

      const keepBtn = document.querySelector(".edit-badge-toggle") as HTMLButtonElement;
      expect(keepBtn.textContent).toBe("Keep");

      keepBtn.click();

      expect(keepBtn.textContent).toBe("Sell");
      expect(rule.Keep).toBe(false);
      expect(changes.length).toBe(1);
      expect(changes[0][0]).toBe(0);
    });
  });

  describe("Active/Inactive toggle", () => {
    it("toggles Active to Inactive", () => {
      const rule = defaultRule({ Use: true });
      const filter = makeFilter([rule]);
      const changes: number[] = [];

      renderEditableRules(filter, noopCallbacks({
        onRuleChange(index) { changes.push(index); },
      }));

      // Second badge-toggle is the Active/Inactive button
      const badges = document.querySelectorAll(".edit-badge-toggle");
      const useBtn = badges[1] as HTMLButtonElement;
      expect(useBtn.textContent).toBe("Active");

      useBtn.click();

      expect(useBtn.textContent).toBe("Inactive");
      expect(rule.Use).toBe(false);
      expect(changes.length).toBe(1);
    });
  });

  describe("onRuleDelete", () => {
    it("fires with correct index", () => {
      const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
      const deleted: number[] = [];

      renderEditableRules(filter, noopCallbacks({
        onRuleDelete(index) { deleted.push(index); },
      }));

      // Click delete on the second card
      const delBtns = document.querySelectorAll(".edit-delete-btn");
      (delBtns[1] as HTMLButtonElement).click();

      expect(deleted).toEqual([1]);
    });
  });

  describe("onRuleMove", () => {
    it("fires move up with correct from/to", () => {
      const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
      const moves: [number, number][] = [];

      renderEditableRules(filter, noopCallbacks({
        onRuleMove(from, to) { moves.push([from, to]); },
      }));

      // Move up on second card
      const upBtns = document.querySelectorAll(".edit-move-btn");
      // Each card has 2 move buttons (up, down); card 1's up is at index 2
      (upBtns[2] as HTMLButtonElement).click();

      expect(moves).toEqual([[1, 0]]);
    });

    it("disables up on first card and down on last card", () => {
      const filter = makeFilter([defaultRule(), defaultRule()]);
      renderEditableRules(filter, noopCallbacks());

      const moveBtns = document.querySelectorAll(".edit-move-btn") as NodeListOf<HTMLButtonElement>;
      // Card 0: up (disabled), down (enabled)
      expect(moveBtns[0].disabled).toBe(true);
      expect(moveBtns[1].disabled).toBe(false);
      // Card 1: up (enabled), down (disabled)
      expect(moveBtns[2].disabled).toBe(false);
      expect(moveBtns[3].disabled).toBe(true);
    });
  });

  describe("passthrough preservation", () => {
    it("preserves unknown fields when toggling Keep", () => {
      const rule = defaultRule({ Keep: true });
      // Add an unknown passthrough field
      (rule as Record<string, unknown>)["CustomField"] = "preserved";

      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      // Toggle Keep
      const keepBtn = document.querySelector(".edit-badge-toggle") as HTMLButtonElement;
      keepBtn.click();

      expect(rule.Keep).toBe(false);
      expect((rule as Record<string, unknown>)["CustomField"]).toBe("preserved");
    });
  });

  describe("cancel restore", () => {
    it("structuredClone snapshot restores original state", () => {
      const original = defaultRule({ Keep: true, Rank: 6 });
      const filter = makeFilter([original]);

      // Simulate: save snapshot, edit, cancel
      const snapshot = structuredClone(filter);

      original.Keep = false;
      original.Rank = 5;

      // Restore from snapshot
      filter.Rules = snapshot.Rules;

      expect(filter.Rules[0].Keep).toBe(true);
      expect(filter.Rules[0].Rank).toBe(6);
    });
  });

  describe("substat editing", () => {
    it("changing stat dropdown updates rule substat", () => {
      const rule = defaultRule();
      const filter = makeFilter([rule]);
      const changes: number[] = [];

      renderEditableRules(filter, noopCallbacks({
        onRuleChange(index) { changes.push(index); },
      }));

      const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLButtonElement>;
      expect(statTriggers.length).toBe(4);

      // Click trigger to open dropdown
      statTriggers[0].click();

      // Find the "ATK%" option (value "2:0") in the dropdown panel and click it
      const items = document.querySelectorAll(".shared-dropdown-panel.open .shared-dropdown-item");
      const atkPctItem = Array.from(items).find(
        (el) => (el as HTMLElement).dataset.value === "2:0",
      ) as HTMLElement;
      expect(atkPctItem).not.toBeUndefined();
      atkPctItem.click();

      expect(rule.Substats[0].ID).toBe(2);
      expect(rule.Substats[0].IsFlat).toBe(false);
      expect(changes.length).toBe(1);
    });

    it("selecting None resets substat to empty", () => {
      const rule = defaultRule();
      // Set a substat first
      rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" };

      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const statTriggers = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLButtonElement>;

      // Click trigger to open dropdown
      statTriggers[0].click();

      // Click the "None" option (value "-1")
      const items = document.querySelectorAll(".shared-dropdown-panel.open .shared-dropdown-item");
      const noneItem = Array.from(items).find(
        (el) => (el as HTMLElement).dataset.value === "-1",
      ) as HTMLElement;
      noneItem.click();

      expect(rule.Substats[0].ID).toBe(-1);
      expect(rule.Substats[0].Value).toBe(0);
    });

    it("condition trigger button shows current condition", () => {
      const rule = defaultRule();
      rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">" };
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const condTrigger = document.querySelector(
        '.edit-substat-row [data-field="substat-condition"]',
      ) as HTMLButtonElement;
      expect(condTrigger).not.toBeNull();
      expect(condTrigger.textContent).toBe(">");
      expect(condTrigger.dataset.value).toBe(">");
    });

    it("condition trigger is disabled when stat is None", () => {
      const rule = defaultRule(); // default substats have ID:-1
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const condTrigger = document.querySelector(
        '.edit-substat-row [data-field="substat-condition"]',
      ) as HTMLButtonElement;
      expect(condTrigger.disabled).toBe(true);
    });

    it("condition and value inputs are disabled when stat is None", () => {
      const rule = defaultRule(); // substats are all empty (ID:-1)
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const condTriggers = document.querySelectorAll(".edit-sub-cond") as NodeListOf<HTMLButtonElement>;
      const valueInputs = document.querySelectorAll('.edit-substat-row input[type="number"]') as NodeListOf<HTMLInputElement>;

      expect(condTriggers[0].disabled).toBe(true);
      expect(valueInputs[0].disabled).toBe(true);
    });

    it("selecting a condition via shared dropdown updates the rule", () => {
      const rule = defaultRule();
      rule.Substats[0] = { ID: 5, Value: 10, IsFlat: false, NotAvailable: false, Condition: ">=" };
      let changedRule: HsfRule | null = null;
      const filter = makeFilter([rule]);
      renderEditableRules(filter, {
        onRuleChange(_i, r) { changedRule = r; },
        onRuleDelete() {},
        onRuleMove() {},
        onRuleAdd() {},
      });

      const condTrigger = document.querySelector(
        '.edit-substat-row [data-field="substat-condition"]',
      ) as HTMLButtonElement;
      condTrigger.click();

      // Select ">" from the shared dropdown panel
      const items = document.querySelectorAll('.shared-dropdown-panel.open .shared-dropdown-item');
      const gtItem = Array.from(items).find((el) => el.textContent === ">");
      (gtItem as HTMLElement).click();

      expect(changedRule!.Substats[0].Condition).toBe(">");
      expect(condTrigger.textContent).toBe(">");
      expect(condTrigger.dataset.value).toBe(">");
    });

    it("passthrough fields on substat survive condition change", () => {
      const rule = defaultRule();
      const sub = rule.Substats[0] as Record<string, unknown>;
      sub["ExtraField"] = 42;
      sub["ID"] = 5;
      sub["IsFlat"] = false;
      sub["Value"] = 10;
      sub["Condition"] = ">=";

      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      // Change condition via shared dropdown
      const condTrigger = document.querySelector(
        '.edit-substat-row [data-field="substat-condition"]',
      ) as HTMLButtonElement;
      condTrigger.click();
      const items = document.querySelectorAll('.shared-dropdown-panel.open .shared-dropdown-item');
      const gtItem = Array.from(items).find((el) => el.textContent === ">") as HTMLElement;
      gtItem.click();

      // The spread in the handler preserves extra fields
      expect((rule.Substats[0] as Record<string, unknown>)["ExtraField"]).toBe(42);
      expect(rule.Substats[0].Condition).toBe(">");
    });

    it("passthrough fields on substat survive stat change", () => {
      const rule = defaultRule();
      const sub = rule.Substats[0] as Record<string, unknown>;
      sub["ExtraField"] = 42;
      sub["ID"] = 5;
      sub["IsFlat"] = false;
      sub["Value"] = 10;
      sub["Condition"] = ">=";

      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      // Change stat via shared dropdown (ATK% = 2:0)
      const statTrigger = document.querySelector(".edit-sub-stat") as HTMLButtonElement;
      statTrigger.click();
      const items = document.querySelectorAll('.shared-dropdown-panel.open .shared-dropdown-item');
      const atkPctItem = Array.from(items).find(
        (el) => (el as HTMLElement).dataset.value === "2:0",
      ) as HTMLElement;
      atkPctItem.click();

      // The spread in the handler preserves extra fields
      expect((rule.Substats[0] as Record<string, unknown>)["ExtraField"]).toBe(42);
      expect(rule.Substats[0].ID).toBe(2);
    });
  });

  describe("rank dropdown", () => {
    it("pre-selects current rank value", () => {
      const rule = defaultRule({ Rank: 5 });
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const trigger = document.querySelector("[data-field='rank']") as HTMLElement;
      expect(trigger).not.toBeNull();
      expect(trigger.dataset.value).toBe("5");
      expect(trigger.textContent).toBe("5-star");
    });
  });

  describe("drag and drop", () => {
    it("cards are draggable and have drag handles", () => {
      const filter = makeFilter([defaultRule(), defaultRule()]);
      renderEditableRules(filter, noopCallbacks());

      const cards = document.querySelectorAll(".edit-card") as NodeListOf<HTMLElement>;
      expect(cards[0].draggable).toBe(true);
      expect(cards[1].draggable).toBe(true);

      const handles = document.querySelectorAll(".edit-drag-handle");
      expect(handles.length).toBe(2);
    });

    it("cards store their rule index in dataset", () => {
      const filter = makeFilter([defaultRule(), defaultRule(), defaultRule()]);
      renderEditableRules(filter, noopCallbacks());

      const cards = document.querySelectorAll(".edit-card") as NodeListOf<HTMLElement>;
      expect(cards[0].dataset.ruleIndex).toBe("0");
      expect(cards[1].dataset.ruleIndex).toBe("1");
      expect(cards[2].dataset.ruleIndex).toBe("2");
    });
  });

  describe("data attributes for delegation", () => {
    it("Keep button has data-action='keep-toggle'", () => {
      const filter = makeFilter([defaultRule()]);
      renderEditableRules(filter, noopCallbacks());
      const btn = document.querySelector("[data-action='keep-toggle']");
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe("Keep");
    });

    it("delete button has data-action='delete'", () => {
      const filter = makeFilter([defaultRule()]);
      renderEditableRules(filter, noopCallbacks());
      const btn = document.querySelector("[data-action='delete']");
      expect(btn).not.toBeNull();
    });

    it("substat rows have data-sub-index", () => {
      const filter = makeFilter([defaultRule()]);
      renderEditableRules(filter, noopCallbacks());
      const rows = document.querySelectorAll(".edit-substat-row");
      expect(rows.length).toBe(4);
      expect((rows[0] as HTMLElement).dataset.subIndex).toBe("0");
      expect((rows[3] as HTMLElement).dataset.subIndex).toBe("3");
    });

    it("field triggers have data-field", () => {
      const filter = makeFilter([defaultRule()]);
      renderEditableRules(filter, noopCallbacks());
      const rankField = document.querySelector("[data-field='rank']");
      expect(rankField).not.toBeNull();
      expect(rankField!.tagName).toBe("BUTTON");
      expect((rankField as HTMLElement).dataset.action).toBe("open-dropdown");
    });
  });
});
