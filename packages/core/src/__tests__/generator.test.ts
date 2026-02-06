import { describe, it, expect } from "vitest";
import { generateConfig } from "../generator.js";

describe("generateConfig", () => {
  it("produces a valid config with version 1", () => {
    const result = generateConfig({
      name: "test-filter",
      rules: [{ pattern: "*.log", action: "exclude" }],
    });

    expect(result).toEqual({
      version: 1,
      name: "test-filter",
      rules: [{ pattern: "*.log", action: "exclude" }],
    });
  });

  it("accepts an empty rules array", () => {
    const result = generateConfig({ name: "empty", rules: [] });
    expect(result.rules).toEqual([]);
  });

  it("throws on invalid input", () => {
    expect(() =>
      generateConfig({ name: "", rules: [] })
    ).toThrow();
  });
});
