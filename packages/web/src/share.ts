/**
 * Shareable URL encoding/decoding for Quick Generator state.
 *
 * Encodes QuickGenState as: deflate-raw compressed JSON → base64url string.
 * The encoded string is placed in the URL hash fragment: #q=<encoded>
 */
import { ARTIFACT_SET_NAMES, ACCESSORY_SET_IDS, FACTION_NAMES } from "@rslh/core";
import { SUBSTAT_PRESETS, GOOD_SUBSTATS } from "./generator.js";
import { stripBlockColors, restoreBlockColors } from "./quick-generator.js";
import type { QuickGenState, QuickBlock, RareAccessoryBlock, OreRerollBlock, CustomProfile } from "./quick-generator.js";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_ENCODED_LENGTH = 4096;
const MAX_BINARY_SIZE = 8192;
const MAX_DECOMPRESSED_SIZE = 16384;
const MAX_BLOCKS = 10;
const MAX_TIERS = 4;
const MAX_ORE_COLUMN = 2;
const MAX_NAME_LENGTH = 100;
const MAX_TIER_NAME_LENGTH = 50;
const MAX_SELECTIONS_PER_SET = 16;
const MAX_CUSTOM_PROFILES = 4;
const MAX_CUSTOM_PROFILE_STATS = 11;
const MAX_CUSTOM_LABEL_LENGTH = 50;

// ---------------------------------------------------------------------------
// Domain lookups
// ---------------------------------------------------------------------------

const VALID_SET_IDS = new Set(Object.keys(ARTIFACT_SET_NAMES).map(Number));
const VALID_ACCESSORY_SET_IDS = new Set(ACCESSORY_SET_IDS);
const VALID_FACTION_IDS = new Set(Object.keys(FACTION_NAMES).map(Number));
const MAX_PROFILE_INDEX = SUBSTAT_PRESETS.length - 1;
const VALID_SUBSTAT_PAIRS = new Set(GOOD_SUBSTATS.map(([s, f]) => `${s}:${f}`));

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(pad);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Compression helpers (native CompressionStream API)
// ---------------------------------------------------------------------------

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // Suppress unhandled rejections on the writable side (errors surface on the reader)
  writer.write(data).catch(() => {});
  writer.close().catch(() => {});

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch {
    fail();
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function fail(): never {
  throw new Error("Invalid shared state");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (key === "__proto__" || !allowed.has(key)) fail();
  }
}

function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function sanitizeString(s: unknown, maxLen: number): string {
  if (typeof s !== "string") fail();
  if (s.length > maxLen) fail();
  return s.replace(/[<>&"']/g, "");
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function validateTier(t: unknown): { name: string; rolls: number; sellRolls?: number } {
  if (!isPlainObject(t)) fail();
  const allowed = new Set(["name", "rolls", "sellRolls"]);
  assertOnlyKeys(t, allowed);

  const name = sanitizeString(t.name, MAX_TIER_NAME_LENGTH);
  if (!isInteger(t.rolls) || t.rolls < -1 || t.rolls > 9) fail();
  const rolls = t.rolls;

  if (t.sellRolls !== undefined) {
    if (!isInteger(t.sellRolls) || t.sellRolls < 1 || t.sellRolls > 9) fail();
    return { name, rolls, sellRolls: t.sellRolls };
  }

  return { name, rolls };
}

function validateBlock(b: unknown, customProfileCount: number): QuickBlock {
  if (!isPlainObject(b)) fail();
  const allowed = new Set(["name", "tiers", "assignments", "selectedProfiles", "selectedCustom"]);
  assertOnlyKeys(b, allowed);

  const result: QuickBlock = {} as QuickBlock;

  // name (optional)
  if (b.name !== undefined) {
    result.name = sanitizeString(b.name, MAX_NAME_LENGTH);
  }

  // tiers — exactly 4
  if (!Array.isArray(b.tiers) || b.tiers.length !== MAX_TIERS) fail();
  result.tiers = b.tiers.map(validateTier) as QuickBlock["tiers"];

  // assignments — set ID → tier index
  if (!isPlainObject(b.assignments)) fail();
  const assignments: Record<number, number> = {};
  for (const [key, val] of Object.entries(b.assignments)) {
    if (key === "__proto__") fail();
    const id = Number(key);
    if (!VALID_SET_IDS.has(id)) fail();
    if (!isInteger(val) || val < 0 || val > 3) fail();
    assignments[id] = val;
  }
  result.assignments = assignments;

  // selectedProfiles — indices into SUBSTAT_PRESETS
  if (!Array.isArray(b.selectedProfiles)) fail();
  if (b.selectedProfiles.length > SUBSTAT_PRESETS.length) fail();
  const seen = new Set<number>();
  const profiles: number[] = [];
  for (const p of b.selectedProfiles) {
    if (!isInteger(p) || p < 0 || p > MAX_PROFILE_INDEX) fail();
    if (seen.has(p)) fail();
    seen.add(p);
    profiles.push(p);
  }
  result.selectedProfiles = profiles;

  // selectedCustom — indices into customProfiles (optional)
  if (b.selectedCustom !== undefined) {
    if (!Array.isArray(b.selectedCustom)) fail();
    if (b.selectedCustom.length > MAX_CUSTOM_PROFILES) fail();
    const seenCustom = new Set<number>();
    const customs: number[] = [];
    for (const c of b.selectedCustom) {
      if (!isInteger(c) || c < 0 || c >= customProfileCount) fail();
      if (seenCustom.has(c)) fail();
      seenCustom.add(c);
      customs.push(c);
    }
    result.selectedCustom = customs;
  }

  return result;
}

function validateRareAccessories(v: unknown): RareAccessoryBlock {
  if (!isPlainObject(v)) fail();
  assertOnlyKeys(v, new Set(["selections"]));

  if (!isPlainObject(v.selections)) fail();
  const selections: Record<number, number[]> = {};

  for (const [key, val] of Object.entries(v.selections)) {
    if (key === "__proto__") fail();
    const id = Number(key);
    if (!VALID_ACCESSORY_SET_IDS.has(id)) fail();
    if (!Array.isArray(val) || val.length > MAX_SELECTIONS_PER_SET) fail();
    const factions: number[] = [];
    for (const f of val) {
      if (!isInteger(f) || !VALID_FACTION_IDS.has(f)) fail();
      factions.push(f);
    }
    selections[id] = factions;
  }

  return { selections };
}

function validateOreReroll(v: unknown): OreRerollBlock {
  if (!isPlainObject(v)) fail();
  assertOnlyKeys(v, new Set(["assignments"]));

  if (!isPlainObject(v.assignments)) fail();
  const assignments: Record<number, number> = {};

  for (const [key, val] of Object.entries(v.assignments)) {
    if (key === "__proto__") fail();
    const id = Number(key);
    if (!VALID_SET_IDS.has(id)) fail();
    if (!isInteger(val) || val < 0 || val > MAX_ORE_COLUMN) fail();
    assignments[id] = val;
  }

  return { assignments };
}

function validateCustomProfile(v: unknown): CustomProfile {
  if (!isPlainObject(v)) fail();
  assertOnlyKeys(v, new Set(["label", "stats"]));

  const label = sanitizeString(v.label, MAX_CUSTOM_LABEL_LENGTH);
  if (label.length === 0) fail();

  if (!Array.isArray(v.stats)) fail();
  if (v.stats.length === 0 || v.stats.length > MAX_CUSTOM_PROFILE_STATS) fail();

  const seen = new Set<string>();
  const stats: [number, boolean][] = [];
  for (const entry of v.stats) {
    if (!Array.isArray(entry) || entry.length !== 2) fail();
    const [statId, isFlat] = entry;
    if (!isInteger(statId) || typeof isFlat !== "boolean") fail();
    const key = `${statId}:${isFlat}`;
    if (!VALID_SUBSTAT_PAIRS.has(key)) fail();
    if (seen.has(key)) fail();
    seen.add(key);
    stats.push([statId, isFlat]);
  }

  return { label, stats };
}

function validateQuickGenState(data: unknown): QuickGenState {
  if (!isPlainObject(data)) fail();
  assertOnlyKeys(data, new Set(["blocks", "rareAccessories", "oreReroll", "customProfiles", "strict"]));

  // Validate customProfiles first (blocks reference them)
  let customProfileCount = 0;
  const result: QuickGenState = {} as QuickGenState;

  if (data.customProfiles !== undefined) {
    if (!Array.isArray(data.customProfiles)) fail();
    if (data.customProfiles.length > MAX_CUSTOM_PROFILES) fail();
    result.customProfiles = data.customProfiles.map(validateCustomProfile);
    customProfileCount = result.customProfiles.length;
  }

  if (!Array.isArray(data.blocks)) fail();
  if (data.blocks.length < 1 || data.blocks.length > MAX_BLOCKS) fail();

  result.blocks = data.blocks.map((b: unknown) => validateBlock(b, customProfileCount));

  if (data.rareAccessories !== undefined) {
    result.rareAccessories = validateRareAccessories(data.rareAccessories);
  }

  if (data.oreReroll !== undefined) {
    result.oreReroll = validateOreReroll(data.oreReroll);
  }

  if (data.strict !== undefined) {
    if (typeof data.strict !== "boolean") fail();
    result.strict = data.strict;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function encodeState(state: QuickGenState): Promise<string> {
  const stripped = stripBlockColors(state);
  const json = JSON.stringify(stripped);
  const bytes = new TextEncoder().encode(json);
  const compressed = await compress(bytes);
  return toBase64Url(compressed);
}

export async function decodeState(encoded: string): Promise<QuickGenState> {
  // Length gate
  if (encoded.length > MAX_ENCODED_LENGTH) fail();

  // Alphabet gate
  if (!BASE64URL_RE.test(encoded)) fail();

  // Decode base64url → binary
  const binary = fromBase64Url(encoded);
  if (binary.length > MAX_BINARY_SIZE) fail();

  // Decompress
  const decompressed = await decompress(binary);
  if (decompressed.length > MAX_DECOMPRESSED_SIZE) fail();

  // Parse JSON
  const text = new TextDecoder().decode(decompressed);
  const data: unknown = JSON.parse(text);

  // Structural validation
  const validated = validateQuickGenState(data);

  // Restore deterministic colors
  return restoreBlockColors(validated);
}
