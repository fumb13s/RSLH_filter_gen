import { z } from "zod";

/**
 * Zod schemas matching the .hsf (RSLH artifact filter) JSON format.
 * All schemas use `.passthrough()` so unknown fields survive round-trips.
 */

export const HsfSubstatSchema = z
  .object({
    ID: z.number().int(),
    Value: z.number(),
    IsFlat: z.boolean(),
    NotAvailable: z.boolean(),
    Condition: z.string(),
  })
  .passthrough();

export type HsfSubstat = z.infer<typeof HsfSubstatSchema>;

export const HsfRuleSchema = z
  .object({
    Keep: z.boolean(),
    IsRuleTypeAND: z.boolean(),
    Use: z.boolean(),
    ArtifactSet: z.array(z.number().int()).optional(),
    ArtifactType: z.array(z.number().int()),
    Rank: z.number().int(),
    Rarity: z.number().int(),
    MainStatID: z.number().int(),
    MainStatF: z.number(),
    LVLForCheck: z.number().int(),
    Faction: z.number().int(),
    Substats: z.array(HsfSubstatSchema).length(4),
  })
  .passthrough();

export type HsfRule = z.infer<typeof HsfRuleSchema>;

export const HsfFilterSchema = z
  .object({
    Rules: z.array(HsfRuleSchema),
  })
  .passthrough();

export type HsfFilter = z.infer<typeof HsfFilterSchema>;

/** Create an empty (unused) substat entry. */
export function emptySubstat(): HsfSubstat {
  return {
    ID: -1,
    Value: 0,
    IsFlat: true,
    NotAvailable: false,
    Condition: "",
  };
}

/** Create a default rule with sensible defaults, optionally overriding fields. */
export function defaultRule(overrides?: Partial<HsfRule>): HsfRule {
  return {
    Keep: true,
    IsRuleTypeAND: false,
    Use: true,
    ArtifactType: [1, 2, 3, 4, 5, 6],
    Rank: 6,
    Rarity: 16,
    MainStatID: -1,
    MainStatF: 1,
    LVLForCheck: 0,
    Faction: 0,
    Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()],
    ...overrides,
  };
}
