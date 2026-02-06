import { z } from "zod";

/**
 * Placeholder config schema — will be replaced when the
 * target program's config format is known.
 */
export const ConfigParamsSchema = z.object({
  name: z.string().min(1),
  rules: z.array(
    z.object({
      pattern: z.string(),
      action: z.enum(["include", "exclude"]),
    })
  ),
});

export type ConfigParams = z.infer<typeof ConfigParamsSchema>;

export interface GeneratedConfig {
  version: number;
  name: string;
  rules: ConfigParams["rules"];
}
