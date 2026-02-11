/**
 * fast-check reporter that logs failures clearly and auto-saves
 * counterexamples to a regression JSON file for replay.
 */
import fs from "node:fs";
import path from "node:path";
import type { RunDetails } from "fast-check";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegressionEntry {
  seed: number;
  path: string;
  counterexample: unknown;
}

/** Map of test name → list of saved regression entries. */
export type RegressionStore = Record<string, RegressionEntry[]>;

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/** Load a regression JSON file. Returns `{}` if not found or invalid. */
export function loadRegressions(filePath: string): RegressionStore {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/** Extract saved counterexamples for a specific test, formatted for fast-check's `examples` option. */
export function regressionExamples<T>(store: RegressionStore, testName: string): T[] {
  return (store[testName] ?? []).map((e) => e.counterexample) as T[];
}

// ---------------------------------------------------------------------------
// Reporter factory
// ---------------------------------------------------------------------------

/**
 * Create a fast-check reporter that:
 * 1. Logs seed + path + counterexample on failure
 * 2. Appends the entry to a regression JSON file
 * 3. Re-throws so the test still fails
 */
export function createReporter(filePath: string, testName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function reporter(runDetails: RunDetails<any>): void {
    if (!runDetails.failed) return;

    const entry: RegressionEntry = {
      seed: runDetails.seed,
      path: runDetails.counterexamplePath ?? "",
      counterexample: runDetails.counterexample,
    };

    // Log reproduction info
    console.error([
      "",
      "=".repeat(70),
      `PROPERTY FAILURE: ${testName}`,
      `  Seed: ${entry.seed}`,
      `  Path: ${entry.path}`,
      `  Shrinks: ${runDetails.numShrinks}`,
      `  Counterexample:`,
      `  ${JSON.stringify(entry.counterexample, null, 2).split("\n").join("\n  ")}`,
      "",
      `  Saved to: ${filePath}`,
      `  Reproduce: add { seed: ${entry.seed}, path: "${entry.path}" } to test options`,
      "=".repeat(70),
      "",
    ].join("\n"));

    // Append to regression file (dedup by seed+path)
    let store: RegressionStore = {};
    try {
      store = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch { /* empty or missing file */ }

    if (!store[testName]) store[testName] = [];
    const isDuplicate = store[testName].some(
      (e) => e.seed === entry.seed && e.path === entry.path,
    );
    if (!isDuplicate) {
      store[testName].push(entry);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n");
    }

    // Re-throw to fail the test
    throw new Error(
      `Property failed after ${runDetails.numRuns} run(s) and ${runDetails.numShrinks} shrink(s)\n` +
      `Seed: ${entry.seed} | Path: ${entry.path}\n` +
      `Counterexample: ${JSON.stringify(entry.counterexample)}\n` +
      (runDetails.errorInstance ? `\n${String(runDetails.errorInstance)}` : ""),
    );
  };
}

/**
 * Build fast-check options for a property test: wires up the reporter
 * and loads regression examples from the store.
 */
export function propConfig(
  filePath: string,
  testName: string,
  store: RegressionStore,
  numRuns = Number(process.env.FC_NUM_RUNS) || 200,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { numRuns: number; reporter: ReturnType<typeof createReporter>; examples: any[] } {
  return {
    numRuns,
    reporter: createReporter(filePath, testName),
    examples: regressionExamples(store, testName),
  };
}
