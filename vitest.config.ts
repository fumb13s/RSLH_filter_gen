import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    testTimeout: Number(process.env.VITEST_TIMEOUT) || 5000,
  },
});
