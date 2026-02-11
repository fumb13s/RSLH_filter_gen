// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import type { HsfFilter, HsfRule } from "@rslh/core";
import { defaultRule } from "@rslh/core";
import { renderEditableRules } from "../editor.js";
import type { RuleEditorCallbacks } from "../editor.js";

// Minimal DOM setup — vitest uses JSDOM by default
function setupDOM(): void {
  document.body.innerHTML = '<div id="rules-container"></div>';
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

      // Find first substat stat dropdown
      const statSelects = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLSelectElement>;
      expect(statSelects.length).toBe(4);

      // Change first substat to ATK% (ID:2, IsFlat:false = "2:0")
      statSelects[0].value = "2:0";
      statSelects[0].dispatchEvent(new Event("change"));

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

      const statSelects = document.querySelectorAll(".edit-sub-stat") as NodeListOf<HTMLSelectElement>;
      statSelects[0].value = "-1";
      statSelects[0].dispatchEvent(new Event("change"));

      expect(rule.Substats[0].ID).toBe(-1);
      expect(rule.Substats[0].Value).toBe(0);
    });

    it("condition and value inputs are disabled when stat is None", () => {
      const rule = defaultRule(); // substats are all empty (ID:-1)
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      const condSelects = document.querySelectorAll(".edit-sub-cond") as NodeListOf<HTMLSelectElement>;
      const valueInputs = document.querySelectorAll('.edit-substat-row input[type="number"]') as NodeListOf<HTMLInputElement>;

      expect(condSelects[0].disabled).toBe(true);
      expect(valueInputs[0].disabled).toBe(true);
    });

    it("passthrough fields on substat survive edits", () => {
      const rule = defaultRule();
      const sub = rule.Substats[0] as Record<string, unknown>;
      sub["ExtraField"] = 42;
      sub["ID"] = 5;
      sub["IsFlat"] = false;
      sub["Value"] = 10;
      sub["Condition"] = ">=";

      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      // Change condition
      const condSelects = document.querySelectorAll(".edit-sub-cond") as NodeListOf<HTMLSelectElement>;
      condSelects[0].value = ">";
      condSelects[0].dispatchEvent(new Event("change"));

      // The spread in the handler preserves extra fields
      expect((rule.Substats[0] as Record<string, unknown>)["ExtraField"]).toBe(42);
      expect(rule.Substats[0].Condition).toBe(">");
    });
  });

  describe("rank dropdown", () => {
    it("pre-selects current rank value", () => {
      const rule = defaultRule({ Rank: 5 });
      const filter = makeFilter([rule]);
      renderEditableRules(filter, noopCallbacks());

      // Find the Rank select (label text "Rank")
      const fields = document.querySelectorAll(".edit-field");
      let rankSelect: HTMLSelectElement | null = null;
      for (const field of fields) {
        const label = field.querySelector("label");
        if (label?.textContent === "Rank") {
          rankSelect = field.querySelector("select");
          break;
        }
      }
      expect(rankSelect).not.toBeNull();
      expect(rankSelect!.value).toBe("5");
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
});
