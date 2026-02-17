import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.e2e.ts"],
    testTimeout: 600_000, // 10 minutes
  },
});
