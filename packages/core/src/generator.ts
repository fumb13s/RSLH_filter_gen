import { ConfigParams, ConfigParamsSchema, GeneratedConfig } from "./types.js";

/**
 * Generate a JSON config object from the given parameters.
 * Validates input with zod before producing output.
 */
export function generateConfig(params: ConfigParams): GeneratedConfig {
  const validated = ConfigParamsSchema.parse(params);

  return {
    version: 1,
    name: validated.name,
    rules: validated.rules,
  };
}
