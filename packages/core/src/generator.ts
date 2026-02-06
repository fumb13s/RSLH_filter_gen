import { HsfFilter, HsfFilterSchema, HsfRule } from "./types.js";

/**
 * Validate an array of rules and wrap them in an HsfFilter.
 * Throws a ZodError if any rule is invalid.
 */
export function generateFilter(rules: HsfRule[]): HsfFilter {
  const filter: HsfFilter = { Rules: rules };
  return HsfFilterSchema.parse(filter);
}

/**
 * Serialize an HsfFilter to compact JSON (no whitespace),
 * matching the format produced by the game client.
 */
export function serializeFilter(filter: HsfFilter): string {
  return JSON.stringify(filter);
}

/**
 * Parse a JSON string (possibly with a UTF-8 BOM) into an HsfFilter.
 * Throws a ZodError if the JSON doesn't match the schema.
 */
export function parseFilter(json: string): HsfFilter {
  // Strip UTF-8 BOM if present
  const cleaned = json.charCodeAt(0) === 0xfeff ? json.slice(1) : json;
  const data: unknown = JSON.parse(cleaned);
  return HsfFilterSchema.parse(data);
}
