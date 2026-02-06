import { generateConfig, ConfigParams } from "@rslh/core";
import "./style.css";

const form = document.getElementById("config-form") as HTMLFormElement;
const rulesContainer = document.getElementById("rules-container")!;
const addRuleBtn = document.getElementById("add-rule")!;
const outputSection = document.getElementById("output-section")!;
const outputPre = document.getElementById("output")!;
const downloadBtn = document.getElementById("download")!;

let lastJson = "";

function createRuleRow(): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "rule-row";
  row.innerHTML = `
    <input name="pattern" type="text" placeholder="*.log" required />
    <select name="action">
      <option value="include">include</option>
      <option value="exclude">exclude</option>
    </select>
    <button type="button" class="remove-rule">✕</button>
  `;
  row.querySelector(".remove-rule")!.addEventListener("click", () => row.remove());
  return row;
}

addRuleBtn.addEventListener("click", () => {
  rulesContainer.appendChild(createRuleRow());
});

// Start with one empty rule row
rulesContainer.appendChild(createRuleRow());

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const name = (document.getElementById("config-name") as HTMLInputElement).value;
  const rows = rulesContainer.querySelectorAll(".rule-row");
  const rules: ConfigParams["rules"] = Array.from(rows).map((row) => ({
    pattern: (row.querySelector('[name="pattern"]') as HTMLInputElement).value,
    action: (row.querySelector('[name="action"]') as HTMLSelectElement).value as
      | "include"
      | "exclude",
  }));

  const config = generateConfig({ name, rules });
  lastJson = JSON.stringify(config, null, 2);

  outputPre.textContent = lastJson;
  outputSection.hidden = false;
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([lastJson + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(url);
});
