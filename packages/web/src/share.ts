/**
 * Shareable URL encoding/decoding for Quick Generator state.
 *
 * Encodes QuickGenState as: deflate-raw compressed JSON → base64url string.
 * The encoded string is placed in the URL hash fragment: #q=<encoded>
 *
 * The payload is a versioned document (`{ version, state }`). Links written before versioning
 * existed carry the bare state and count as version 4; see `quick-state-format.ts`. Structural
 * validation, size limits and string sanitising all live in the link variant of that format.
 */
import { loadVersioned, wrap } from "./versioned.js";
import { QUICK_STATE_LINK_FORMAT } from "./quick-state-format.js";
import { stripBlockColors, restoreBlockColors } from "./quick-generator.js";
import type { QuickGenState } from "./quick-generator.js";

// ---------------------------------------------------------------------------
// Transport gates
// ---------------------------------------------------------------------------

const MAX_ENCODED_LENGTH = 4096;
const MAX_BINARY_SIZE = 8192;
const MAX_DECOMPRESSED_SIZE = 16384;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function fail(): never {
  throw new Error("Invalid shared state");
}

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
// Public API
// ---------------------------------------------------------------------------

export async function encodeState(state: QuickGenState): Promise<string> {
  const document = wrap(QUICK_STATE_LINK_FORMAT, stripBlockColors(state));
  const bytes = new TextEncoder().encode(JSON.stringify(document));
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

  // Migrate, then validate against the current version
  const result = loadVersioned(QUICK_STATE_LINK_FORMAT, data);
  if (result.kind !== "ok") fail();

  // Restore deterministic colors
  return restoreBlockColors(result.value);
}
