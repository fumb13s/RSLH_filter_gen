// oracle/battlelogs/__tests__/capture.test.mjs
import { test, expect } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOnce, newCaptureState, readIndex, listSource, MAX_DECODE_ATTEMPTS } from "../lib/capture.mjs";
import { BattleLogError } from "../lib/codec.mjs";
import { makeLine, makeBattleBytes } from "./fixtures.mjs";

const NOW = () => "2026-08-12T23:24:12.000Z";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "battlelog-cap-"));
  const sourceDir = join(root, "src");
  const archiveDir = join(root, "archive", "um1");
  mkdirSync(sourceDir, { recursive: true });
  const indexPath = join(root, "archive", "index.jsonl");
  const opts = { sourceDir, archiveDir, indexPath, account: "um1", now: NOW };
  return {
    ...opts, root,
    drop(name, bytes) { writeFileSync(join(sourceDir, name), bytes); },
    run(state) { return captureOnce({ ...opts, state: state ?? newCaptureState(archiveDir, indexPath) }); },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

const BATTLE = () => makeBattleBytes([makeLine(), makeLine({ turn: 9, finished: true })]);

test("copies a new file byte-identically and indexes it", () => {
  const t = setup();
  try {
    t.drop("20260812_232412_live.jsonl.z", BATTLE());
    const res = t.run();
    expect(res).toHaveLength(1);
    expect(res[0].copied).toBe(true);
    expect(res[0].row.turns).toBe(9);

    const dest = join(t.archiveDir, "20260812_232412_live.jsonl.z");
    expect(readFileSync(dest)).toEqual(readFileSync(join(t.sourceDir, "20260812_232412_live.jsonl.z")));
    expect(readIndex(t.indexPath)).toHaveLength(1);
  } finally { t.cleanup(); }
});

test("a second pass with fresh state re-copies nothing and re-indexes nothing", () => {
  const t = setup();
  try {
    t.drop("20260812_232412_live.jsonl.z", BATTLE());
    t.run();
    const res = t.run();                       // fresh state = simulates a restart
    expect(res).toHaveLength(0);
    expect(readIndex(t.indexPath)).toHaveLength(1);
  } finally { t.cleanup(); }
});

test("ignores files that are not battle logs", () => {
  const t = setup();
  try {
    t.drop("notes.txt", Buffer.from("hello"));
    t.drop("20260812_232412_live.jsonl.z", BATTLE());
    expect(listSource(t.sourceDir)).toEqual(["20260812_232412_live.jsonl.z"]);
    expect(t.run()).toHaveLength(1);
  } finally { t.cleanup(); }
});

test("a corrupt file is still archived, and is given MAX_DECODE_ATTEMPTS before a failed row lands", () => {
  const t = setup();
  try {
    const good = BATTLE();
    t.drop("20260812_232412_live.jsonl.z", good.subarray(0, Math.floor(good.length / 2)));
    const state = newCaptureState(t.archiveDir, t.indexPath);

    for (let i = 1; i < MAX_DECODE_ATTEMPTS; i++) {
      const res = captureOnce({ ...t, state });
      expect(res[0].error.code).toBe("INFLATE_FAILED");
      expect(readIndex(t.indexPath)).toHaveLength(0);   // no row until attempts are exhausted
    }
    const final = captureOnce({ ...t, state });
    expect(final[0].error.code).toBe("INFLATE_FAILED");

    // bytes preserved regardless of decode outcome — this is the whole point of copy-before-decode
    expect(existsSync(join(t.archiveDir, "20260812_232412_live.jsonl.z"))).toBe(true);
    const rows = readIndex(t.indexPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].decodeFailed).toBe(true);
    expect(rows[0].file).toBe("20260812_232412_live.jsonl.z");

    expect(captureOnce({ ...t, state })).toHaveLength(0);   // gives up, stops retrying
  } finally { t.cleanup(); }
});

// The codec validates line 0 only, and summarize walks `last.teams` / `t.heroes` unguarded. So a
// battle whose FINAL line is valid JSON but carries no `teams` decodes cleanly and then throws a
// raw TypeError out of summarize. captureOnce's catch is untyped on purpose: the watcher's job is
// to archive the bytes and mark the file, never to die on one. Containment lives here, not in
// guards inside codec.mjs or summarize.mjs.
test("a battle that crashes the summarizer is contained like any other decode failure", () => {
  const t = setup();
  try {
    const name = "20260812_232412_live.jsonl.z";
    t.drop(name, makeBattleBytes([makeLine(), { ...makeLine({ finished: true }), teams: undefined }]));
    const state = newCaptureState(t.archiveDir, t.indexPath);

    for (let i = 1; i < MAX_DECODE_ATTEMPTS; i++) {
      const res = captureOnce({ ...t, state });
      expect(res[0].error).toBeInstanceOf(TypeError);       // escaped the codec untyped...
      expect(res[0].error).not.toBeInstanceOf(BattleLogError); // ...so a typed catch would have rethrown it
      expect(readIndex(t.indexPath)).toHaveLength(0);
    }
    const final = captureOnce({ ...t, state });
    expect(final[0].error).toBeInstanceOf(TypeError);

    expect(existsSync(join(t.archiveDir, name))).toBe(true);
    const rows = readIndex(t.indexPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].decodeFailed).toBe(true);
    expect(rows[0].file).toBe(name);
    expect(rows[0].error).toBeTypeOf("string");   // a triageable message, not "[object Object]"
    expect(rows[0].error.length).toBeGreaterThan(0);
  } finally { t.cleanup(); }
});

test("a file that was mid-write on one pass decodes on a later pass", () => {
  const t = setup();
  try {
    const good = BATTLE();
    const name = "20260812_232412_live.jsonl.z";
    t.drop(name, good.subarray(0, Math.floor(good.length / 2)));
    const state = newCaptureState(t.archiveDir, t.indexPath);
    expect(captureOnce({ ...t, state })[0].error).toBeTruthy();

    t.drop(name, good);                         // RSL Helper finished writing
    const res = captureOnce({ ...t, state });
    expect(res[0].error).toBeUndefined();
    expect(res[0].row.turns).toBe(9);
    expect(readIndex(t.indexPath)).toHaveLength(1);
  } finally { t.cleanup(); }
});

test("captures several files in one pass, in filename order", () => {
  const t = setup();
  try {
    t.drop("20260812_232447_live.jsonl.z", BATTLE());
    t.drop("20260812_232412_live.jsonl.z", BATTLE());
    expect(t.run().map((r) => r.file)).toEqual([
      "20260812_232412_live.jsonl.z", "20260812_232447_live.jsonl.z",
    ]);
  } finally { t.cleanup(); }
});
