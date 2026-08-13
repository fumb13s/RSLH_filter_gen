// oracle/battlelogs/__tests__/capture.test.mjs
import { test, expect, vi } from "vitest";
import {
  writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync, utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  captureOnce, newCaptureState, reconcileArchive, readIndex, listSource, replayRow, MAX_DECODE_ATTEMPTS,
} from "../lib/capture.mjs";
import { BattleLogError } from "../lib/codec.mjs";
import { makeLine, makeBattleBytes } from "./fixtures.mjs";

const NOW = () => "2026-08-12T23:24:12.000Z";

function setup(account = "um1") {
  const root = mkdtempSync(join(tmpdir(), "battlelog-cap-"));
  const sourceDir = join(root, "src");
  const archiveDir = join(root, "archive", account);
  mkdirSync(sourceDir, { recursive: true });
  const indexPath = join(root, "archive", "index.jsonl");
  const opts = { sourceDir, archiveDir, indexPath, account, now: NOW };
  return {
    ...opts, root,
    drop(name, bytes) { writeFileSync(join(sourceDir, name), bytes); },
    evict(name) { rmSync(join(sourceDir, name), { force: true }); },
    fresh() { return newCaptureState(archiveDir, indexPath, account); },
    run(state) { return captureOnce({ ...opts, state: state ?? newCaptureState(archiveDir, indexPath, account) }); },
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
    const state = t.fresh();

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
    const state = t.fresh();

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
        const state = cap.newCaptureState(t.archiveDir, t.indexPath, t.account);
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
    expect(res.map((r) => r.file)).toEqual([vanished, "20260812_232412_live.jsonl.z"]);
    expect(existsSync(join(t.archiveDir, vanished))).toBe(false);
    expect(readIndex(t.indexPath).map((r) => r.file)).toEqual(["20260812_232412_live.jsonl.z"]);
  } finally { t.cleanup(); }
});

// Losing a battle is what this tool exists to prevent, so losing one must never be silent. There is
// no row to write and no bytes to keep, which leaves the console line as the only trace that the
// file existed at all — and the window widens exactly where it hurts, at startup with a 20-file
// backlog being walked oldest-first through the files RSL Helper is about to delete.
test("a battle evicted before we ever held it is reported as a miss, not dropped silently", () => {
  const t = setup();
  try {
    const vanished = "20260812_232400_live.jsonl.z";
    symlinkSync(join(t.root, "gone", vanished), join(t.sourceDir, vanished));

    const res = t.run();
    expect(res).toEqual([{ file: vanished, copied: false, missed: true }]);
    expect(readIndex(t.indexPath)).toHaveLength(0);
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

    const res = captureOnce({ ...t, state: t.fresh() });
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

    const state = t.fresh();   // must not throw
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
    const state = t.fresh();
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

const NAME = "20260812_232412_live.jsonl.z";

// Exhausts the decode budget on a half-file, leaving one decodeFailed row and the partial archived.
function retire(t, state) {
  const good = BATTLE();
  t.drop(NAME, good.subarray(0, Math.floor(good.length / 2)));
  for (let i = 0; i < MAX_DECODE_ATTEMPTS; i++) captureOnce({ ...t, state });
  return good;
}

// A decodeFailed row is "we hold these bytes and could not read them", NOT "done with this file".
// Retiring it in `indexed` would skip it before the copy on every future run, so restarting — which
// the design doc and this module both call the escape hatch — would do nothing at all. The case that
// lands here is the anticipated one: a novel Arena shape crashes summarize, and after the fix the
// files must still be reachable.
test("a file retired by a decode failure is retried after a restart", () => {
  const t = setup();
  try {
    const state = t.fresh();
    const good = retire(t, state);
    expect(readIndex(t.indexPath)[0].decodeFailed).toBe(true);

    t.drop(NAME, good);                      // whatever was wrong is now fixed
    const res = captureOnce({ ...t, state: t.fresh() });   // fresh state = a restart
    expect(res[0].row.turns).toBe(9);

    // Append-only, so the good row does not erase the failed one — it supersedes it, and readers
    // take the last row for a file. rebuild-index.mjs is the compaction path.
    const rows = readIndex(t.indexPath);
    expect(rows.map((r) => !!r.decodeFailed)).toEqual([true, false]);
  } finally { t.cleanup(); }
});

// Bytes first, always — the copy sits ABOVE the attempts gate, so a retired file keeps healing while
// only the inflate stops. Re-inflating a corrupt file every 3s is the cost the budget exists to
// avoid; re-copying 6 KB is not, and re-copying is the only thing that can repair a partial.
test("a retired file still has its bytes re-copied; only the decode stops", () => {
  const t = setup();
  try {
    const state = t.fresh();
    const good = retire(t, state);

    t.drop(NAME, good);
    expect(captureOnce({ ...t, state })).toHaveLength(0);       // no decode, no result
    expect(readFileSync(join(t.archiveDir, NAME))).toEqual(good);   // but the bytes healed
  } finally { t.cleanup(); }
});

test("a restart that fails again does not append a second failed row", () => {
  const t = setup();
  try {
    retire(t, t.fresh());
    retire(t, t.fresh());
    expect(readIndex(t.indexPath)).toHaveLength(1);
  } finally { t.cleanup(); }
});

// index.jsonl lives at the archive ROOT and is shared by every account, while archiveDir is
// per-account. Keyed on the bare filename, um2's file would read as already captured because um1 has
// one of that name — skipped before the copy, so the battle is never held and is gone for good when
// the source evicts it. Filenames are YYYYMMDD_HHMMSS, so this needs two accounts to start a battle
// in the same second; the tool contemplates several accounts and the failure is silent and permanent.
test("two accounts sharing one index do not shadow each other's identically-named files", () => {
  const root = mkdtempSync(join(tmpdir(), "battlelog-multi-"));
  try {
    const indexPath = join(root, "archive", "index.jsonl");
    const pass = (account) => {
      const sourceDir = join(root, account, "src");
      const archiveDir = join(root, "archive", account);
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, NAME), BATTLE());
      const opts = { sourceDir, archiveDir, indexPath, account, now: NOW };
      return captureOnce({ ...opts, state: newCaptureState(archiveDir, indexPath, account) });
    };
    expect(pass("um1")[0].copied).toBe(true);
    expect(pass("um2")[0].copied).toBe(true);

    expect(existsSync(join(root, "archive", "um2", NAME))).toBe(true);
    expect(readIndex(indexPath).map((r) => r.account)).toEqual(["um1", "um2"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// captureOnce only ever iterates the SOURCE, so bytes held with no row — a watcher killed between
// the copy and the append, a torn index tail — are invisible to it the moment RSL Helper evicts the
// source. Which is the moment that matters: the archived battle is then permanently unfindable
// without inflating the whole archive, and nothing says so.
test("reconcile indexes bytes we hold with no row once the source has evicted them", () => {
  const t = setup();
  try {
    mkdirSync(t.archiveDir, { recursive: true });
    writeFileSync(join(t.archiveDir, NAME), BATTLE());   // copied, then killed before the append

    const state = t.fresh();
    const res = reconcileArchive({ ...t, state });
    expect(res).toHaveLength(1);
    expect(res[0].reconciled).toBe(true);
    expect(res[0].row.turns).toBe(9);
    expect(readIndex(t.indexPath).map((r) => r.file)).toEqual([NAME]);

    // and it converges: the next start finds nothing to do
    expect(reconcileArchive({ ...t, state: t.fresh() })).toHaveLength(0);
  } finally { t.cleanup(); }
});

// Replaying bytes that may still be mid-write is strictly worse than letting captureOnce re-copy
// them on the very next pass with the full retry budget, so the source is the tie-breaker.
test("reconcile leaves a held file alone while the source still has it", () => {
  const t = setup();
  try {
    mkdirSync(t.archiveDir, { recursive: true });
    writeFileSync(join(t.archiveDir, NAME), BATTLE());
    t.drop(NAME, BATTLE());

    expect(reconcileArchive({ ...t, state: t.fresh() })).toHaveLength(0);
    expect(readIndex(t.indexPath)).toHaveLength(0);
  } finally { t.cleanup(); }
});

test("reconcile records an undecodable held file instead of aborting the start", () => {
  const t = setup();
  try {
    const good = BATTLE();
    mkdirSync(t.archiveDir, { recursive: true });
    writeFileSync(join(t.archiveDir, "20260812_232400_live.jsonl.z"), good.subarray(0, 20));
    writeFileSync(join(t.archiveDir, NAME), good);

    const res = reconcileArchive({ ...t, state: t.fresh() });
    expect(res.map((r) => !!r.error)).toEqual([true, false]);
    const rows = readIndex(t.indexPath);
    expect(rows.map((r) => !!r.decodeFailed)).toEqual([true, false]);
    expect(reconcileArchive({ ...t, state: t.fresh() })).toHaveLength(0);   // both rows are now on record
  } finally { t.cleanup(); }
});

// The row we never wrote has no capturedAt to recover. copyFileSync stamps the destination at copy
// time, so the archived file's mtime is when we captured it.
test("a reconciled row dates itself from the archived file's mtime", () => {
  const t = setup();
  try {
    mkdirSync(t.archiveDir, { recursive: true });
    const path = join(t.archiveDir, NAME);
    writeFileSync(path, BATTLE());
    const when = new Date("2026-08-12T23:24:12.000Z");
    utimesSync(path, when, when);

    expect(reconcileArchive({ ...t, state: t.fresh() })[0].row.capturedAt).toBe("2026-08-12T23:24:12.000Z");
  } finally { t.cleanup(); }
});

test("replayRow returns a failed row rather than throwing", () => {
  const t = setup();
  try {
    mkdirSync(t.archiveDir, { recursive: true });
    writeFileSync(join(t.archiveDir, NAME), Buffer.from("not zlib"));
    const row = replayRow(t.archiveDir, { file: NAME, account: "um1", capturedAt: NOW() });
    expect(row).toMatchObject({ file: NAME, account: "um1", decodeFailed: true });
    expect(row.error).toMatch(/inflate/i);
  } finally { t.cleanup(); }
});
