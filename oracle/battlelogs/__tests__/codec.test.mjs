// oracle/battlelogs/__tests__/codec.test.mjs
import { test, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { inflateBattle, parseBattle, readBattle, BattleLogError } from "../lib/codec.mjs";
import { makeLine, makeBattleText, makeBattleBytes } from "./fixtures.mjs";

const withTempDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "battlelog-"));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("readBattle round-trips a two-line synthetic battle", () => {
  withTempDir((dir) => {
    const path = join(dir, "20260812_232412_live.jsonl.z");
    writeFileSync(path, makeBattleBytes([makeLine(), makeLine({ turn: 2, finished: true })]));
    const lines = readBattle(path);
    expect(lines).toHaveLength(2);
    expect(lines[0].proc).toBe(123456789);
    expect(lines[1].finished).toBe(true);
  });
});

test("parseBattle skips the trailing newline without emitting an empty line", () => {
  const lines = parseBattle(makeBattleText([makeLine()]));
  expect(lines).toHaveLength(1);
});

test("truncated zlib raises BattleLogError INFLATE_FAILED, not a raw zlib throw", () => {
  const full = makeBattleBytes([makeLine()]);
  const cut = full.subarray(0, Math.floor(full.length / 2));
  try {
    inflateBattle(cut);
    throw new Error("expected inflateBattle to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(BattleLogError);
    expect(err.code).toBe("INFLATE_FAILED");
  }
});

test("malformed JSON on a line raises PARSE_FAILED naming the line number", () => {
  const text = `${JSON.stringify(makeLine())}\n{not json}\n`;
  try {
    parseBattle(text);
    throw new Error("expected parseBattle to throw");
  } catch (err) {
    expect(err.code).toBe("PARSE_FAILED");
    expect(err.message).toContain("line 2");
  }
});

test("empty payload raises EMPTY", () => {
  expect(() => parseBattle("\n\n")).toThrowError(/no JSON lines/);
});

test("a non-battleLiveState first line raises SHAPE", () => {
  const text = makeBattleText([makeLine({ type: "somethingElse" })]);
  try {
    parseBattle(text);
    throw new Error("expected parseBattle to throw");
  } catch (err) {
    expect(err.code).toBe("SHAPE");
  }
});

test("inflateBattle accepts real zlib framing", () => {
  expect(inflateBattle(deflateSync(Buffer.from('{"a":1}', "utf8")))).toBe('{"a":1}');
});

// typeof null === "object", so a bare `null` line is the one scalar that reaches the property
// access instead of falling through to SHAPE the way 5, "str" and [] do.
test("a null line raises SHAPE, not a raw TypeError", () => {
  let err;
  try { parseBattle("null\n"); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(BattleLogError);
  expect(err.code).toBe("SHAPE");
});

// The teams guard is what stands between a headerless log and summarize.mjs, which iterates
// first.teams unguarded. JSON.stringify drops an undefined value, so this is a log whose first
// line genuinely has no teams key rather than one holding an explicit null.
test("a first line with no teams array raises SHAPE", () => {
  const text = makeBattleText([makeLine({ teams: undefined })]);
  let err;
  try { parseBattle(text); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(BattleLogError);
  expect(err.code).toBe("SHAPE");
  // Both SHAPE guards would satisfy the assertions above; the message is what pins the teams one.
  expect(err.message).toContain("teams");
});

// Pins the documented pass-through: fs errors are NOT typed, so consumers racing the writer must
// gate on `instanceof BattleLogError` rather than on `.code` (ENOENT is a different vocabulary
// that merely shares the field name). Task 3's watcher branches on exactly this.
test("readBattle propagates fs errors untyped", () => {
  let err;
  try { readBattle(join(tmpdir(), "definitely-absent-battlelog-x9f2.jsonl.z")); } catch (e) { err = e; }
  expect(err).toBeDefined();
  expect(err).not.toBeInstanceOf(BattleLogError);
  expect(err.code).toBe("ENOENT");
});
