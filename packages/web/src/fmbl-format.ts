/**
 * Versions of the Generator rule groups, stored in `.fmbl` files.
 *
 * Only version 1 exists so far, so `past` is empty. See `versioned.ts` for the rule on when to
 * bump a version.
 *
 * There are no numeric ranges here. Generated groups carry values the manual UI never produces:
 * `rolls: 0`, `rank: 0` and `rarity: 0` on per-faction accessory groups and on the strict catch-all,
 * and `walkbackDelay: 1` on ore-reroll groups.
 */
import { z } from "zod";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, STAT_NAMES, FACTION_NAMES } from "@rslh/core";
import type { SettingGroup } from "./generator.js";
import type { VersionedFormat } from "./versioned.js";

const VALID_SET_IDS = new Set(Object.keys(ARTIFACT_SET_NAMES).map(Number));
const VALID_SLOT_IDS = new Set(Object.keys(ARTIFACT_SLOT_NAMES).map(Number));
const VALID_STAT_IDS = new Set(Object.keys(STAT_NAMES).map(Number));
const VALID_FACTION_IDS = new Set(Object.keys(FACTION_NAMES).map(Number));

const statPairs = () => z.array(z.tuple([z.number().int(), z.boolean()]));

/**
 * Version 1. Unknown keys are dropped, which is what lets a file saved on 2026-02-10 keep loading:
 * its ore-reroll groups carry an `isAnd` field the app no longer has.
 */
const groupsV1 = z.array(
  z.object({
    name: z.string().optional(),
    keep: z.boolean().optional(),
    sets: z.array(z.number().int()),
    slots: z.array(z.number().int()),
    // Files saved 2026-02-07 21:55–23:10 lack mainStats entirely.
    mainStats: statPairs().default(() => []),
    goodStats: statPairs(),
    rolls: z.number().int(),
    rank: z.number().int().optional(),
    rarity: z.number().int().optional(),
    faction: z.number().int().optional(),
    walkbackDelay: z.number().int().optional(),
  }),
);

function unknownId(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function checkIds(groups: SettingGroup[], ctx: z.RefinementCtx): void {
  groups.forEach((group, gi) => {
    group.sets.forEach((id, i) => {
      if (!VALID_SET_IDS.has(id)) unknownId(ctx, [gi, "sets", i], `unknown set id ${id}`);
    });
    group.slots.forEach((id, i) => {
      if (!VALID_SLOT_IDS.has(id)) unknownId(ctx, [gi, "slots", i], `unknown slot id ${id}`);
    });
    for (const field of ["mainStats", "goodStats"] as const) {
      group[field].forEach(([stat], i) => {
        if (!VALID_STAT_IDS.has(stat)) unknownId(ctx, [gi, field, i], `unknown stat id ${stat}`);
      });
    }
    // 0 means "any faction".
    if (group.faction !== undefined && group.faction !== 0 && !VALID_FACTION_IDS.has(group.faction)) {
      unknownId(ctx, [gi, "faction"], `unknown faction id ${group.faction}`);
    }
  });
}

export const FMBL_FORMAT: VersionedFormat<SettingGroup[]> = {
  past: [],
  current: groupsV1.superRefine(checkIds),
  dataKey: "groups",
};
