// oracle/battlelogs/__tests__/watch.test.mjs
// Only the pure helpers are tested. The timer loop is not: it is setTimeout around captureOnce,
// which capture.test.mjs covers directly, and the CLI is exercised end-to-end via --once.
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, resolveSource, formatCapture, tupleKey } from "../watch.mjs";
import { MAX_DECODE_ATTEMPTS } from "../lib/capture.mjs";
import { summarize } from "../lib/summarize.mjs";
import { makeLine } from "./fixtures.mjs";

test("parseArgs reads flags and applies defaults", () => {
  const o = parseArgs(["--source", "/s", "--archive", "/a", "--interval", "7"]);
  expect(o.source).toBe("/s");
  expect(o.archive).toBe("/a");
  expect(o.intervalMs).toBe(7000);
  expect(o.once).toBe(false);
});

test("parseArgs defaults the interval to 3s and --once to false", () => {
  const o = parseArgs([]);
  expect(o.intervalMs).toBe(3000);
  expect(o.once).toBe(false);
});

test("parseArgs accepts --once", () => {
  expect(parseArgs(["--once"]).once).toBe(true);
});

test("parseArgs rejects a non-numeric interval", () => {
  expect(() => parseArgs(["--interval", "soon"])).toThrowError(/--interval/);
});

// A typo must not be read as "no flag given", which would silently watch the auto-detected
// directory instead of the one that was asked for.
test("parseArgs rejects an unknown argument", () => {
  expect(() => parseArgs(["--sauce", "/s"])).toThrowError(/--sauce/);
});

// Every resolveSource case below pins the source explicitly or through the environment. None may
// reach the glob branch: on this machine that is the LIVE RSL Helper directory, and tests never
// touch it.
function withEnv(value, fn) {
  const had = Object.hasOwn(process.env, "RSLHELPER_BATTLELOGS");
  const prev = process.env.RSLHELPER_BATTLELOGS;
  if (value === null) delete process.env.RSLHELPER_BATTLELOGS;
  else process.env.RSLHELPER_BATTLELOGS = value;
  try {
    fn();
  } finally {
    if (had) process.env.RSLHELPER_BATTLELOGS = prev;
    else delete process.env.RSLHELPER_BATTLELOGS;
  }
}

test("resolveSource prefers an explicit dir and names the account after it", () => {
  const root = mkdtempSync(join(tmpdir(), "battlelog-src-"));
  try {
    const wanted = join(root, "um-wanted");
    const other = join(root, "um-env");
    mkdirSync(wanted);
    mkdirSync(other);
    withEnv(other, () => {
      expect(resolveSource(wanted)).toEqual({ sourceDir: wanted, account: "um-wanted" });
      // a trailing slash is what tab-completion produces; it must not become the account id
      expect(resolveSource(`${wanted}/`).account).toBe("um-wanted");
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolveSource falls back to RSLHELPER_BATTLELOGS", () => {
  const root = mkdtempSync(join(tmpdir(), "battlelog-src-"));
  try {
    const dir = join(root, "um-env");
    mkdirSync(dir);
    withEnv(dir, () => {
      expect(resolveSource(null)).toEqual({ sourceDir: dir, account: "um-env" });
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The path is a drvfs mount that can simply not be there. Failing with the two ways to fix it
// beats an ENOENT from somewhere inside the capture pass.
test("resolveSource fails loudly, naming both ways to point it at the logs", () => {
  const root = mkdtempSync(join(tmpdir(), "battlelog-src-"));
  try {
    withEnv(null, () => {
      expect(() => resolveSource(join(root, "not-there"))).toThrowError(/RSLHELPER_BATTLELOGS/);
      expect(() => resolveSource(join(root, "not-there"))).toThrowError(/--source/);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Built by the real summarize from the shared fixtures, not hand-written. A hand-written row is
// free to be shaped however formatCapture happens to read it — `heroes: [1, 2, 3, 4]` satisfies
// `.length` while summarize emits objects — and then nothing in the branch runs a real row through
// the formatter, which is the last joint in the pipeline.
const FILE = "20260812_232412_live.jsonl.z";
const ROW = summarize(
  [makeLine(), makeLine({ turn: 9, finished: true })],
  { file: FILE, account: "um1", capturedAt: "2026-08-12T23:24:12.000Z" },
);

test("formatCapture reports content ids and team sizes", () => {
  const line = formatCapture({ file: ROW.file, row: ROW }, new Set([tupleKey(ROW)]));
  expect(line).toMatch(/^\d{2}:\d{2}:\d{2}\s/);
  expect(line).toContain("20260812_232412_live.jsonl.z");
  expect(line).toContain("kind=2 region=301 stage=3019003");
  expect(line).toContain("9 turns");
  expect(line).toContain("2v2");
  expect(line).not.toContain("NEW");
});

// "captured", not "copied": a result can be a file we already held and only decoded this pass. The
// design doc's example line says "copied", so this pins the deliberate choice against a future edit
// that syncs the code back to the doc.
test("a captured battle is reported as captured, not copied", () => {
  const line = formatCapture({ file: ROW.file, row: ROW }, new Set([tupleKey(ROW)]));
  expect(line).toContain("captured");
  expect(line).not.toContain("copied");
});

test("an unseen content tuple is marked NEW — this is how Arena gets identified", () => {
  const line = formatCapture({ file: ROW.file, row: ROW }, new Set());
  expect(line).toContain("NEW");
});

test("a decode failure formats as a warning naming the file", () => {
  const line = formatCapture({ file: FILE, error: new Error("zlib inflate failed: bad") }, new Set());
  expect(line).toContain("DECODE FAILED");
  expect(line).toContain("20260812_232412_live.jsonl.z");
  expect(line).toContain("zlib inflate failed: bad");
});

// Attempt 1 is "probably transient, will retry" and the last attempt is "this file is now retired
// and only a restart or a rebuild gets it back". Printed identically, the two are indistinguishable.
test("a decode failure carries the attempt it was on", () => {
  const line = formatCapture({ file: FILE, error: new Error("bad"), attempt: 2 }, new Set());
  expect(line).toContain(`(attempt 2/${MAX_DECODE_ATTEMPTS})`);
});

// reconcileArchive has no attempt counter — the suffix must not render as "attempt undefined/3".
test("a reconciled decode failure prints no attempt number", () => {
  const line = formatCapture({ file: FILE, reconciled: true, error: "bad" }, new Set());
  expect(line).toContain("DECODE FAILED");
  expect(line).not.toContain("attempt");
});

// A battle lost between the readdir and the copy is the failure this tool exists to prevent. There
// is no row and no bytes, so this line is the only trace it ever existed.
test("an eviction we lost the race to is reported, not silently dropped", () => {
  const line = formatCapture({ file: FILE, copied: false, missed: true }, new Set());
  expect(line).toContain("MISSED");
  expect(line).toContain(FILE);
  expect(line).toContain("evicted");
});

// A startup reconcile is not a capture: the bytes were already held, sometimes from a previous run
// days ago, and reading "captured" for them would misdate the battle.
test("a reconciled row reads as indexed rather than captured", () => {
  const line = formatCapture({ file: ROW.file, reconciled: true, row: ROW }, new Set([tupleKey(ROW)]));
  expect(line).toContain("indexed");
  expect(line).not.toContain("captured");
  expect(line).toContain("kind=2 region=301 stage=3019003");
});

// captureOnce forwards whatever was thrown, and not every throw is an Error — capture.test.mjs
// pins null/"kaboom"/42 as reachable. Branching on `result.error` being truthy would send a thrown
// null down the row branch and raise a TypeError in main's log loop, which sits OUTSIDE the
// try/catch around the pass: the watcher would exit, and a dead watcher looks exactly like a quiet
// night. Branch on `row` instead, and stringify the way capture.mjs records it.
test.each([[null, "null"], ["kaboom", "kaboom"], [42, "42"]])(
  "a thrown %p formats as a failure rather than crashing the log loop", (thrown, expected) => {
    const line = formatCapture({ file: ROW.file, error: thrown }, new Set());
    expect(line).toContain("DECODE FAILED");
    expect(line).toContain(ROW.file);
    expect(line).toContain(expected);
  });
