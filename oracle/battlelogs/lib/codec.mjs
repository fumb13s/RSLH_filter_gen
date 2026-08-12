// oracle/battlelogs/lib/codec.mjs
// Decode RSL Helper battle logs: zlib-compressed JSONL, one file per battle. Pure decode — no
// archive or capture policy lives here, so the index can be rebuilt by replaying over the archive.
// Format reference: docs/plans/2026-08-12-battle-log-capture-design.md
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
  if (first.type !== "battleLiveState") {
    throw new BattleLogError("SHAPE", `first line type ${JSON.stringify(first.type)}, want "battleLiveState"`);
  }
  if (!Array.isArray(first.teams)) {
    throw new BattleLogError("SHAPE", "first line has no teams array");
  }
  return lines;
}

export const readBattle = (path) => parseBattle(inflateBattle(readFileSync(path)));
