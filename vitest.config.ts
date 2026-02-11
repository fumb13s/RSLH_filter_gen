import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    testTimeout: Number(process.env.VITEST_TIMEOUT) || (process.env.FC_NUM_RUNS ? 120_000 : 5_000),
  },
});
