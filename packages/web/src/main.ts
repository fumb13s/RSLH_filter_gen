import { parseFilter } from "@rslh/core";
import { initUpload } from "./upload.js";
import { renderSummary, renderRules, renderError, clearError } from "./render.js";
import "./style.css";

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

const tabBar = document.querySelector(".tab-bar")!;
tabBar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab-btn");
  if (!btn) return;
  const tabName = btn.dataset.tab!;

  // Toggle active button
  tabBar.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  // Toggle active panel
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById(`tab-${tabName}`)!.classList.add("active");
});

// ---------------------------------------------------------------------------
// Viewer wiring
// ---------------------------------------------------------------------------

initUpload(
  (text, fileName) => {
    clearError();
    try {
      const filter = parseFilter(text);
      renderSummary(filter, fileName);
      renderRules(filter);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        renderError(`Invalid JSON: ${err.message}`);
      } else if (err instanceof Error && err.name === "ZodError") {
        renderError(`Invalid .hsf schema: ${err.message}`);
      } else {
        renderError(`Unexpected error: ${err}`);
      }
    }
  },
  (message) => {
    clearError();
    renderError(message);
  },
);
