// oracle/battlelogs/__tests__/rebuild-index.test.mjs
import { test, expect } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, listAccounts, rebuildIndex } from "../rebuild-index.mjs";
import { readIndex } from "../lib/capture.mjs";
import { makeLine, makeBattleBytes } from "./fixtures.mjs";

const BATTLE = () => makeBattleBytes([makeLine(), makeLine({ turn: 9, finished: true })]);

function setup() {
  const root = mkdtempSync(join(tmpdir(), "battlelog-rebuild-"));
  return {
    root,
    indexPath: join(root, "index.jsonl"),
    // Writes an archived file the way captureOnce would: archive/<account>/<name>.
    hold(account, name, bytes = BATTLE()) {
      const dir = join(root, account);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), bytes);
      return join(dir, name);
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test("parseArgs reads --archive and defaults it to null", () => {
  expect(parseArgs(["--archive", "/a"]).archive).toBe("/a");
  expect(parseArgs([]).archive).toBe(null);
});

// Same reasoning as watch.mjs: a typo must not be read as "no flag given", which would rebuild the
// default archive instead of the one that was asked for — and this command REPLACES an index.
test("parseArgs rejects an unknown argument", () => {
  expect(() => parseArgs(["--achive", "/a"])).toThrowError(/--achive/);
});

test("listAccounts returns the archive's subdirectories, sorted, ignoring files", () => {
  const t = setup();
  try {
    t.hold("um2", "20260812_232412_live.jsonl.z");
    t.hold("um1", "20260812_232412_live.jsonl.z");
    writeFileSync(t.indexPath, "");
    expect(listAccounts(t.root)).toEqual(["um1", "um2"]);
  } finally { t.cleanup(); }
});

test("rebuilds one row per archived file, taking the account from the directory name", () => {
  const t = setup();
  try {
    t.hold("um1", "20260812_232412_live.jsonl.z");
    t.hold("um1", "20260812_232447_live.jsonl.z");
    t.hold("um2", "20260812_232412_live.jsonl.z");

    const out = rebuildIndex(t.root);
    expect(out.rows).toHaveLength(3);

    const rows = readIndex(t.indexPath);
    expect(rows.map((r) => `${r.account}/${r.file}`)).toEqual([
      "um1/20260812_232412_live.jsonl.z",
      "um1/20260812_232447_live.jsonl.z",
      "um2/20260812_232412_live.jsonl.z",
    ]);
    expect(rows.every((r) => r.turns === 9)).toBe(true);
  } finally { t.cleanup(); }
});

// The reason the script exists: the index is derived, so a rebuild must be able to REPLACE a wrong
// one — a stale row shape, a row for a file that is no longer held, or the duplicate a decodeFailed
// row followed by a later success leaves behind.
test("replaces the existing index rather than appending to it", () => {
  const t = setup();
  try {
    const name = "20260812_232412_live.jsonl.z";
    t.hold("um1", name);
    writeFileSync(t.indexPath, [
      JSON.stringify({ file: name, account: "um1", decodeFailed: true, error: "old" }),
      JSON.stringify({ file: name, account: "um1", turns: 9 }),
      JSON.stringify({ file: "20250101_000000_live.jsonl.z", account: "um1", turns: 1 }),  // no bytes
    ].map((l) => `${l}\n`).join(""));

    rebuildIndex(t.root);
    const rows = readIndex(t.indexPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].file).toBe(name);
    expect(rows[0].decodeFailed).toBeUndefined();
  } finally { t.cleanup(); }
});

// A rebuild that aborts on the first bad file is useless exactly when it is needed — after a novel
// battle shape crashed the summarizer over a whole session's worth of captures.
test("a file that will not decode gets a decodeFailed row instead of aborting the rebuild", () => {
  const t = setup();
  try {
    const good = BATTLE();
    t.hold("um1", "20260812_232400_live.jsonl.z", good.subarray(0, Math.floor(good.length / 2)));
    t.hold("um1", "20260812_232412_live.jsonl.z", good);

    const out = rebuildIndex(t.root);
    const rows = readIndex(t.indexPath);
    expect(rows).toHaveLength(2);
    expect(rows[0].decodeFailed).toBe(true);
    expect(rows[0].error).toMatch(/inflate/i);
    expect(rows[1].turns).toBe(9);
    expect(out.perAccount).toEqual([{ account: "um1", files: 2, failed: 1 }]);
  } finally { t.cleanup(); }
});

// A crash mid-rebuild must not destroy the index it was repairing, so the write goes to a temp file
// and is renamed. The temp file must not survive a successful run either.
test("writes through a temp file and leaves none behind", () => {
  const t = setup();
  try {
    t.hold("um1", "20260812_232412_live.jsonl.z");
    rebuildIndex(t.root);
    expect(existsSync(`${t.indexPath}.tmp`)).toBe(false);
    expect(existsSync(t.indexPath)).toBe(true);
  } finally { t.cleanup(); }
});

// capturedAt is not recoverable from the bytes: copyFileSync stamps the destination at copy time,
// so the archived file's mtime is when we captured it, and that is the honest reconstruction.
test("capturedAt is reconstructed from the archived file's mtime", () => {
  const t = setup();
  try {
    const path = t.hold("um1", "20260812_232412_live.jsonl.z");
    const when = new Date("2026-08-12T23:24:12.000Z");
    utimesSync(path, when, when);

    rebuildIndex(t.root);
    expect(readIndex(t.indexPath)[0].capturedAt).toBe("2026-08-12T23:24:12.000Z");
  } finally { t.cleanup(); }
});

test("ignores files in an account directory that are not battle logs", () => {
  const t = setup();
  try {
    t.hold("um1", "20260812_232412_live.jsonl.z");
    t.hold("um1", "notes.txt", Buffer.from("hello"));
    expect(rebuildIndex(t.root).rows).toHaveLength(1);
  } finally { t.cleanup(); }
});

test("an empty archive rebuilds to an empty index rather than failing", () => {
  const t = setup();
  try {
    expect(rebuildIndex(t.root).rows).toHaveLength(0);
    expect(readIndex(t.indexPath)).toEqual([]);
  } finally { t.cleanup(); }
});

// Pointing it at the wrong directory would otherwise write an empty index over nothing and report
// success, which reads exactly like "the archive is empty".
test("a missing archive root fails loudly instead of writing an empty index", () => {
  const t = setup();
  try {
    expect(() => rebuildIndex(join(t.root, "not-there"))).toThrowError(/archive root/);
  } finally { t.cleanup(); }
});
