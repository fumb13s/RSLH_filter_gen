import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Everything under oracle/ is linted EXCEPT these: third-party inputs (Sellfile Creator and its
    // de-obfuscated form), the extracted SFC workers and wasm, and the two gitignored derived dirs
    // that hold throwaway probe scripts. Ignore by directory, not by `oracle/**`, so new tooling
    // there is linted by default rather than silently exempt.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "oracle/resources/**",
      "oracle/probe/gen/**",
      "oracle/analytics/out/**",
      "oracle/analytics/findings/**",
    ],
  },
  {
    // oracle/ is plain Node ESM run via `node`, outside the TS project references, so it needs the
    // Node globals declared explicitly — without this every console/process/URL is a no-undef error.
    files: ["oracle/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // probe.mjs boots Sellfile Creator's browser worker inside Node by installing a
    // `globalThis.self` shim, then reading it back as a bare `self` the way worker code does.
    files: ["oracle/probe/probe.mjs"],
    languageOptions: { globals: { self: "writable" } },
  },
);
