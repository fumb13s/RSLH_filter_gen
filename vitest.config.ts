import { defineConfig } from "vitest/config";

const isFuzz = !!process.env.FC_NUM_RUNS;

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    testTimeout: Number(process.env.VITEST_TIMEOUT) || (isFuzz ? 120_000 : 5_000),
    pool: isFuzz ? "forks" : "threads",
    poolOptions: isFuzz ? { forks: { singleFork: true } } : {},
  },
});
