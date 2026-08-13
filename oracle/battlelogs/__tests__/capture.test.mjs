// oracle/battlelogs/__tests__/capture.test.mjs
import { test, expect, vi } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    expect(rows[0].error).toBe(final[0].error.message);   // the actual failure, not a placeholder
  } finally { t.cleanup(); }
});

// Loads a private copy of capture.mjs whose summarize throws `value`. vi.doMock is not hoisted, so
// the dynamic import is what picks it up; the static import at the top of this file is unaffected.
async function withThrowingSummarize(value, fn) {
  vi.resetModules();
  vi.doMock("../lib/summarize.mjs", () => ({ summarize: () => { throw value; } }));
  try {
    fn(await import("../lib/capture.mjs"));
  } finally {
    vi.doUnmock("../lib/summarize.mjs");
    vi.resetModules();
  }
}

// Not every throw is an Error, and this catch exists precisely because what lands in it is not
// predictable. `null` is the loud failure: reading .message off it raises a SECOND TypeError inside
// the catch, which escapes captureOnce and defeats the containment. A string is the quiet one:
// .message is undefined, so the row records the literal "undefined" and the failure is untriageable.
test.each([[null, "null"], ["kaboom", "kaboom"], [42, "42"]])(
  "a thrown %p is contained and recorded as %p", async (thrown, expected) => {
    await withThrowingSummarize(thrown, (cap) => {
      const t = setup();
      try {
        t.drop("20260812_232412_live.jsonl.z", BATTLE());
        const state = cap.newCaptureState(t.archiveDir, t.indexPath);
        for (let i = 1; i <= cap.MAX_DECODE_ATTEMPTS; i++) {
          expect(cap.captureOnce({ ...t, state })[0].error).toBe(thrown);
        }
        const rows = cap.readIndex(t.indexPath);
        expect(rows).toHaveLength(1);
        expect(rows[0].decodeFailed).toBe(true);
        expect(rows[0].error).toBe(expected);
      } finally { t.cleanup(); }
    });
  });

// listSource sorts ascending = oldest-first = RSL Helper's own eviction order, so the file most
// likely to vanish mid-pass is the one we reach FIRST, and everything behind it pays. A dangling
// symlink raises the exact errno at the exact call without having to race a real deletion.
test("a source that vanishes before the copy does not abort the pass", () => {
  const t = setup();
  try {
    const vanished = "20260812_232400_live.jsonl.z";        // sorts ahead of the good one
    symlinkSync(join(t.root, "gone", vanished), join(t.sourceDir, vanished));
    t.drop("20260812_232412_live.jsonl.z", BATTLE());

    const res = t.run();
    expect(res.map((r) => r.file)).toEqual(["20260812_232412_live.jsonl.z"]);
    expect(existsSync(join(t.archiveDir, vanished))).toBe(false);
    expect(readIndex(t.indexPath).map((r) => r.file)).toEqual(["20260812_232412_live.jsonl.z"]);
  } finally { t.cleanup(); }
});

// The backlog case: the watcher was down, we hold bytes we never got to index, and by the time it
// restarts RSL Helper has already evicted the source. The copy is unrepeatable but the decode is not.
test("a source that vanishes after we already hold it is decoded from the copy we have", () => {
  const t = setup();
  try {
    const name = "20260812_232412_live.jsonl.z";
    mkdirSync(t.archiveDir, { recursive: true });
    writeFileSync(join(t.archiveDir, name), BATTLE());      // held from an earlier run, never indexed
    symlinkSync(join(t.root, "gone", name), join(t.sourceDir, name));

    const res = captureOnce({ ...t, state: newCaptureState(t.archiveDir, t.indexPath) });
    expect(res[0].error).toBeUndefined();
    expect(res[0].copied).toBe(false);
    expect(res[0].row.turns).toBe(9);
    expect(readIndex(t.indexPath)).toHaveLength(1);
  } finally { t.cleanup(); }
});

// Tolerating ENOENT must stay narrow. A permissions or IO fault is not an eviction, and continuing
// past one would quietly build a gappy archive. (A directory is the portable way to make
// copyFileSync raise something that is not ENOENT.)
test("a copy failure that is not an eviction still propagates", () => {
  const t = setup();
  try {
    mkdirSync(join(t.sourceDir, "20260812_232412_live.jsonl.z"));
    let err;
    try { t.run(); } catch (e) { err = e; }
    expect(err?.code).toBe("EISDIR");
  } finally { t.cleanup(); }
});

// newCaptureState reads the index, so an unparseable line here means the watcher cannot start at
// all and the repair is hand-editing a file full of personal data. One torn row is worth less than
// startup: the file it belongs to simply counts as uncaptured and is decoded again from the archive.
test("a torn index line does not stop startup", () => {
  const t = setup();
  try {
    const done = "20260812_232400_live.jsonl.z";
    mkdirSync(dirname(t.indexPath), { recursive: true });
    // What a process killed mid-append leaves: a complete row, then a fragment with no newline.
    writeFileSync(t.indexPath, `${JSON.stringify({ file: done, account: "um1" })}\n{"file":"2026081`);

    const state = newCaptureState(t.archiveDir, t.indexPath);   // must not throw
    expect([...state.indexed]).toEqual([done]);

    t.drop("20260812_232412_live.jsonl.z", BATTLE());
    expect(captureOnce({ ...t, state })[0].row.turns).toBe(9);
    // The fragment has no trailing newline, so that append glued onto it — the torn tail eats one
    // further row before the file self-heals. Startup surviving is the point; the glue is a known
    // wart, recorded in the task report rather than papered over here.
    expect(readIndex(t.indexPath).map((r) => r.file)).toEqual([done]);
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
