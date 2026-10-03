// oracle/analytics/__tests__/snapshots.test.mjs
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { isSnapshotArg, newestSnapshot, snapshotDate } from "../snapshots.mjs";
import { parseSpeedArgs } from "../speed.mjs";

let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });
const folder = (...names) => {
  dir = mkdtempSync(join(tmpdir(), "snapshots-"));
  for (const n of names) writeFileSync(join(dir, n), "");
  return dir;
};

test("the newest date wins, whichever kind it is", () => {
  const d = folder("2026-06-05-RSLHelper.db", "2026-09-27-Gestal.json.gz", "2026-09-28-RSLHelper.db");
  expect(newestSnapshot(d)).toBe(join(d, "2026-09-28-RSLHelper.db"));
});

// Gestal's wearer data is current, while RSL Helper's cID can name a previous wearer.
test("on a same-date tie the Gestal capture wins", () => {
  const d = folder("2026-09-28-RSLHelper.db", "2026-09-28-Gestal.json.gz");
  expect(newestSnapshot(d)).toBe(join(d, "2026-09-28-Gestal.json.gz"));
});

// Kept baselines are named outside the default patterns precisely so a routine capture never
// shadows them — and so they are never picked up by accident either.
test("baselines and other files are never the default", () => {
  const d = folder("2026-06-05-RSLHelper.db", "2026-09-28-pre-driver.json.gz", "2026-09-28-pre-driver.db",
    "notes.txt", "README.md");
  expect(newestSnapshot(d)).toBe(join(d, "2026-06-05-RSLHelper.db"));
});

test("an empty folder has no newest snapshot", () => {
  expect(newestSnapshot(folder())).toBeNull();
});

// The plain .sort() the tools used before this module compared by code unit; locale order would pick
// the other file here ("R" sorts before "a" by code unit, after it in most locales).
test("same-date, same-kind ties break by code unit, as the tools always did", () => {
  const d = folder("2026-09-28-RSLHelper.db", "2026-09-28-alt-RSLHelper.db");
  expect(newestSnapshot(d)).toBe(join(d, "2026-09-28-alt-RSLHelper.db"));
});

test("a dated snapshot outranks an undated one", () => {
  const d = folder("zz-RSLHelper.db", "2026-06-05-RSLHelper.db");
  expect(newestSnapshot(d)).toBe(join(d, "2026-06-05-RSLHelper.db"));
});

test("isSnapshotArg knows both extensions and any path", () => {
  expect(isSnapshotArg("a.db")).toBe(true);
  expect(isSnapshotArg("a.json.gz")).toBe(true);
  expect(isSnapshotArg("dir/a")).toBe(true);
  expect(isSnapshotArg("dir\\a")).toBe(true);
  expect(isSnapshotArg("Elhain")).toBe(false);
  expect(isSnapshotArg("5")).toBe(false);
});

test("snapshotDate reads the date prefix of either kind", () => {
  expect(snapshotDate("x/2026-09-28-Gestal.json.gz")).toBe("2026-09-28");
  expect(snapshotDate("x/2026-06-05-RSLHelper.db")).toBe("2026-06-05");
});

test("speed.mjs takes a Gestal snapshot as its snapshot argument", () => {
  expect(parseSpeedArgs(["Kael", "2026-09-28-Gestal.json.gz"])).toMatchObject({
    selector: "Kael", dbArg: "2026-09-28-Gestal.json.gz" });
});
