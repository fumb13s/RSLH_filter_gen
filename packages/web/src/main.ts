import { parseFilter } from "@rslh/core";
import { initUpload } from "./upload.js";
import { renderSummary, renderRules, renderTestPanel, renderError, clearError } from "./render.js";
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
      renderTestPanel(filter);
      renderRules(filter);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        renderError(`Invalid JSON: ${err.message}`);
      } else if (isZodError(err)) {
        renderError(formatZodError(err));
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

// ---------------------------------------------------------------------------
// Zod error formatting
// ---------------------------------------------------------------------------

interface ZodIssue {
  path: (string | number)[];
  message: string;
}

function isZodError(err: unknown): err is Error & { issues: ZodIssue[] } {
  return err instanceof Error && err.name === "ZodError" && Array.isArray((err as { issues?: unknown }).issues);
}

// ---------------------------------------------------------------------------
// Back-to-top button
// ---------------------------------------------------------------------------

const backToTop = document.getElementById("back-to-top")!;
window.addEventListener("scroll", () => {
  backToTop.classList.toggle("visible", window.scrollY >= window.innerHeight);
});
backToTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------------------------------------------------------------------------
// Zod error formatting
// ---------------------------------------------------------------------------

function formatZodError(err: Error & { issues: ZodIssue[] }): string {
  const count = err.issues.length;
  const heading = `Invalid .hsf schema \u2014 ${count} issue${count === 1 ? "" : "s"} found:`;

  const lines = err.issues.map((issue) => {
    const path = issue.path
      .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : (i > 0 ? "." : "") + seg))
      .join("");
    return `\u2022 ${path || "(root)"} \u2014 ${issue.message}`;
  });

  return heading + "\n" + lines.join("\n");
}
