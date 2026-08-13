// oracle/battlelogs/lib/codec.mjs
// Decode RSL Helper battle logs: zlib-compressed JSONL, one file per battle. Pure decode — no
// archive or capture policy lives here, so the index can be rebuilt by replaying over the archive.
// Imported by lib/summarize.mjs (which folds the decoded lines into an index row) and lib/capture.mjs,
// and transitively by watch.mjs, so the archive and the index never disagree on how a log is read.
// Format reference: docs/plans/2026-08-12-battle-log-capture-design.md
//
// Error contract: every DECODE failure is a BattleLogError whose .code is one of INFLATE_FAILED,
// PARSE_FAILED, EMPTY, SHAPE. readBattle additionally lets fs errors from readFileSync propagate
// UNTYPED — notably ENOENT, which is the steady state for a watcher racing the writer, not an
// exotic case. Gate on `err instanceof BattleLogError`, NOT on `.code`: a raw fs error carries its
// own .code vocabulary ("ENOENT", "EACCES", "EBUSY") that merely shares the field name.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export class BattleLogError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "BattleLogError";
    this.code = code;          // INFLATE_FAILED | PARSE_FAILED | EMPTY | SHAPE
    if (cause) this.cause = cause;
  }
}

// Raw zlib bytes -> UTF-8 JSONL text. A file caught mid-write lands here.
export function inflateBattle(buf) {
  try {
    return inflateSync(buf).toString("utf8");
  } catch (err) {
    throw new BattleLogError("INFLATE_FAILED", `zlib inflate failed: ${err.message}`, err);
  }
}

// JSONL text -> array of state-push objects. Blank lines (including the trailing newline RSL
// Helper writes) are skipped rather than treated as errors.
export function parseBattle(text) {
  const lines = [];
  const raw = text.split("\n");
  for (let i = 0; i < raw.length; i++) {
    // .trim() is load-bearing beyond blank-line skipping: RSL Helper is a Windows app, so this is
    // what strips the CR of a CRLF pair and a leading UTF-8 BOM. Do not "simplify" to .filter(Boolean).
    const s = raw[i].trim();
    if (!s) continue;
    try {
      lines.push(JSON.parse(s));
    } catch (err) {
      throw new BattleLogError("PARSE_FAILED", `line ${i + 1}: ${err.message}`, err);
    }
  }
  if (lines.length === 0) throw new BattleLogError("EMPTY", "no JSON lines in battle log");

  const first = lines[0];
  // `first === null` is not redundant with the typeof guard: typeof null === "object", so a bare
  // `null` line would otherwise reach the property access and escape as an untyped TypeError.
  if (first === null || typeof first !== "object" || first.type !== "battleLiveState") {
    throw new BattleLogError("SHAPE", `first line type ${JSON.stringify(first?.type)}, want "battleLiveState"`);
  }
  if (!Array.isArray(first.teams)) {
    throw new BattleLogError("SHAPE", "first line has no teams array");
  }
  return lines;
}

export const readBattle = (path) => parseBattle(inflateBattle(readFileSync(path)));
