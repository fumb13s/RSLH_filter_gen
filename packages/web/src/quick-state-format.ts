/**
 * Versions of the Quick Generator state, shared by `.fqbl` files and share links.
 *
 * Two variants of the same chain:
 * - link: every object strict, size-limited, HTML-significant characters stripped from strings.
 *   It must accept exactly the links the hand-written validator in `share.ts` used to accept.
 * - file: unknown keys dropped, no size limits, strings kept as written.
 *
 * See `versioned.ts` for the rule on when to bump a version.
 */
import { z } from "zod";
import { ARTIFACT_SET_NAMES, ACCESSORY_SET_IDS, FACTION_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS, GOOD_SUBSTATS } from "./generator.js";
import type { StoredQuickGenState } from "./quick-generator.js";
import type { VersionedFormat } from "./versioned.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Link-only limits, moved here from `share.ts`. */
const MAX_BLOCKS = 10;
const MAX_NAME_LENGTH = 100;
const MAX_TIER_NAME_LENGTH = 50;
const MAX_CUSTOM_LABEL_LENGTH = 50;
const MAX_CUSTOM_PROFILES = 4;
const MAX_SELECTIONS_PER_SET = 16;

/** Structural bounds — they hold in both variants. */
const TIER_COUNT = 4;
const MAX_TIER_INDEX = 3;
const MAX_ORE_COLUMN = 2;
const MAX_CUSTOM_PROFILE_STATS = 11;

// ---------------------------------------------------------------------------
// Id tables — read by the current version's refinement only
// ---------------------------------------------------------------------------

const VALID_SET_IDS = new Set(Object.keys(ARTIFACT_SET_NAMES).map(Number));
const VALID_ACCESSORY_SET_IDS = new Set<number>(ACCESSORY_SET_IDS);
const VALID_FACTION_IDS = new Set(Object.keys(FACTION_NAMES).map(Number));
const VALID_SUBSTAT_PAIRS = new Set(GOOD_SUBSTATS.map(([stat, isFlat]) => `${stat}:${isFlat}`));

// ---------------------------------------------------------------------------
// Variant helpers
// ---------------------------------------------------------------------------

type Variant = "file" | "link";

function objectOf<T extends z.ZodRawShape>(variant: Variant, shape: T): z.ZodObject<T, z.UnknownKeysParam> {
  return variant === "link" ? z.object(shape).strict() : z.object(shape);
}

type TextSchema = z.ZodType<string, z.ZodTypeDef, unknown>;

/** A stored string. The link variant length-checks it, then strips HTML-significant characters. */
function text(variant: Variant, maxLength: number): TextSchema {
  return variant === "link"
    ? z.string().max(maxLength).transform((s) => s.replace(/[<>&"']/g, ""))
    : z.string();
}

/**
 * A record keyed by an integer id, rebuilt with numeric keys.
 *
 * Keys are checked in the key schema, never after parsing: zod 3 drops a `"__proto__"` key from a
 * record's output without raising an issue, so a check on the output would not see it.
 */
function idRecord<V extends z.ZodTypeAny>(value: V): z.ZodType<Record<number, z.output<V>>, z.ZodTypeDef, unknown> {
  return z
    .record(z.string().refine((k) => Number.isInteger(Number(k)), "key is not an integer"), value)
    .transform((rec) => {
      const out: Record<number, z.output<V>> = {};
      for (const [k, v] of Object.entries(rec)) out[Number(k)] = v;
      return out;
    });
}

/** An array of unique, non-negative indices. The tables they index are checked at the current version. */
function indexArray(): z.ZodType<number[], z.ZodTypeDef, unknown> {
  return z
    .array(z.number().int().min(0))
    .refine((a) => new Set(a).size === a.length, "indices must be unique");
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

const rolls = () => z.number().int().min(-1).max(9);
const sellRolls = () => z.number().int().min(1).max(9);
const assignments = () => idRecord(z.number().int().min(0).max(MAX_TIER_INDEX));

/** Tier as versions 1 and 2 stored it — colours were written then. */
function colouredTier(variant: Variant) {
  return objectOf(variant, {
    name: text(variant, MAX_TIER_NAME_LENGTH),
    rolls: rolls(),
    sellRolls: sellRolls().optional(),
    color: z.string().optional(),
  });
}

/** Tier as versions 3 and 4 store it — colours come from the defaults on load. */
function tier(variant: Variant) {
  return objectOf(variant, {
    name: text(variant, MAX_TIER_NAME_LENGTH),
    rolls: rolls(),
    sellRolls: sellRolls().optional(),
  });
}

function blocksArray<T extends z.ZodTypeAny>(variant: Variant, block: T) {
  const array = z.array(block).min(1);
  return variant === "link" ? array.max(MAX_BLOCKS) : array;
}

function rareAccessories(variant: Variant) {
  const factions = z.array(z.number().int());
  return objectOf(variant, {
    selections: idRecord(variant === "link" ? factions.max(MAX_SELECTIONS_PER_SET) : factions),
  });
}

function oreReroll(variant: Variant) {
  return objectOf(variant, {
    assignments: idRecord(z.number().int().min(0).max(MAX_ORE_COLUMN)),
  });
}

function customProfiles(variant: Variant) {
  const profile = objectOf(variant, {
    // No trim: a whitespace-only label is accepted, as it is today.
    label: text(variant, MAX_CUSTOM_LABEL_LENGTH).refine((s) => s.length > 0, "label must not be empty"),
    stats: z
      .array(z.tuple([z.number().int(), z.boolean()]))
      .min(1)
      .max(MAX_CUSTOM_PROFILE_STATS)
      .refine(
        (pairs) => new Set(pairs.map(([stat, isFlat]) => `${stat}:${isFlat}`)).size === pairs.length,
        "stats must be unique",
      ),
  });
  const array = z.array(profile);
  return variant === "link" ? array.max(MAX_CUSTOM_PROFILES) : array;
}

// ---------------------------------------------------------------------------
// Per-version schemas
// ---------------------------------------------------------------------------

/** Version 1: one flat block at the top level. */
function stateV1(variant: Variant) {
  return objectOf(variant, {
    tiers: z.array(colouredTier(variant)).length(TIER_COUNT),
    assignments: assignments(),
    selectedProfiles: indexArray(),
  });
}

/** Version 2: a blocks array; tiers may still carry colours. */
function stateV2(variant: Variant) {
  return objectOf(variant, {
    blocks: blocksArray(
      variant,
      objectOf(variant, {
        name: text(variant, MAX_NAME_LENGTH).optional(),
        tiers: z.array(colouredTier(variant)).length(TIER_COUNT),
        assignments: assignments(),
        selectedProfiles: indexArray(),
      }),
    ),
  });
}

/** Version 3: colours gone; rare accessories and ore reroll arrived. */
function stateV3(variant: Variant) {
  return objectOf(variant, {
    blocks: blocksArray(
      variant,
      objectOf(variant, {
        name: text(variant, MAX_NAME_LENGTH).optional(),
        tiers: z.array(tier(variant)).length(TIER_COUNT),
        assignments: assignments(),
        selectedProfiles: indexArray(),
      }),
    ),
    rareAccessories: rareAccessories(variant).optional(),
    oreReroll: oreReroll(variant).optional(),
  });
}

/** Version 4 (current): custom profiles, per-block custom selections and strict mode. */
function stateV4(variant: Variant) {
  return objectOf(variant, {
    blocks: blocksArray(
      variant,
      objectOf(variant, {
        name: text(variant, MAX_NAME_LENGTH).optional(),
        tiers: z.array(tier(variant)).length(TIER_COUNT),
        assignments: assignments(),
        selectedProfiles: indexArray(),
        selectedCustom: indexArray().optional(),
      }),
    ),
    rareAccessories: rareAccessories(variant).optional(),
    oreReroll: oreReroll(variant).optional(),
    customProfiles: customProfiles(variant).optional(),
    strict: z.boolean().optional(),
  });
}

// ---------------------------------------------------------------------------
// Upgrade steps
// ---------------------------------------------------------------------------

type StateV2 = z.output<ReturnType<typeof stateV2>>;

/** v1 → v2: the flat block becomes the only entry of a blocks array. */
function wrapFlatBlock(data: unknown): unknown {
  return { blocks: [data] };
}

/** v2 → v3: tier colours stop being stored; they come from the defaults on load. */
function dropTierColours(data: unknown): unknown {
  const state = data as StateV2;
  return {
    ...state,
    blocks: state.blocks.map((block) => ({
      ...block,
      tiers: block.tiers.map((t) =>
        t.sellRolls !== undefined
          ? { name: t.name, rolls: t.rolls, sellRolls: t.sellRolls }
          : { name: t.name, rolls: t.rolls },
      ),
    })),
  };
}

/** v3 → v4: version 4 only added optional fields. */
function identity(data: unknown): unknown {
  return data;
}

// ---------------------------------------------------------------------------
// Id refinement — current version only
// ---------------------------------------------------------------------------

function unknownId(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function checkIds(state: StoredQuickGenState, ctx: z.RefinementCtx): void {
  const customCount = state.customProfiles?.length ?? 0;

  state.blocks.forEach((block, bi) => {
    for (const key of Object.keys(block.assignments)) {
      if (!VALID_SET_IDS.has(Number(key))) {
        unknownId(ctx, ["blocks", bi, "assignments", key], `unknown set id ${key}`);
      }
    }
    for (const index of block.selectedProfiles) {
      if (index >= SUBSTAT_PRESETS.length) {
        unknownId(ctx, ["blocks", bi, "selectedProfiles"], `unknown build profile ${index}`);
      }
    }
    for (const index of block.selectedCustom ?? []) {
      if (index >= customCount) {
        unknownId(ctx, ["blocks", bi, "selectedCustom"], `unknown custom profile ${index}`);
      }
    }
  });

  for (const key of Object.keys(state.oreReroll?.assignments ?? {})) {
    if (!VALID_SET_IDS.has(Number(key))) {
      unknownId(ctx, ["oreReroll", "assignments", key], `unknown set id ${key}`);
    }
  }

  for (const [key, factions] of Object.entries(state.rareAccessories?.selections ?? {})) {
    if (!VALID_ACCESSORY_SET_IDS.has(Number(key))) {
      unknownId(ctx, ["rareAccessories", "selections", key], `unknown accessory set id ${key}`);
    }
    for (const faction of factions) {
      if (!VALID_FACTION_IDS.has(faction)) {
        unknownId(ctx, ["rareAccessories", "selections", key], `unknown faction id ${faction}`);
      }
    }
  }

  (state.customProfiles ?? []).forEach((profile, pi) => {
    profile.stats.forEach(([stat, isFlat], si) => {
      if (!VALID_SUBSTAT_PAIRS.has(`${stat}:${isFlat}`)) {
        unknownId(ctx, ["customProfiles", pi, "stats", si], `unknown substat ${stat}:${isFlat}`);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

function quickStateFormat(variant: Variant): VersionedFormat<StoredQuickGenState> {
  return {
    past: [
      { schema: stateV1(variant), up: wrapFlatBlock },
      { schema: stateV2(variant), up: dropTierColours },
      { schema: stateV3(variant), up: identity },
    ],
    current: stateV4(variant).superRefine(checkIds),
    dataKey: "state",
    ...(variant === "link" ? { unversioned: 4, strictEnvelope: true } : {}),
  };
}

export const QUICK_STATE_FILE_FORMAT: VersionedFormat<StoredQuickGenState> = quickStateFormat("file");
export const QUICK_STATE_LINK_FORMAT: VersionedFormat<StoredQuickGenState> = quickStateFormat("link");
