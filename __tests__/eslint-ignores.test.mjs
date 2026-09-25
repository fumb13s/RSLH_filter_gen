// __tests__/eslint-ignores.test.mjs
//
// Worker scratch files live under .hivemind/scratch/ and are never committed, so nothing in a diff
// shows when the ignore entry that exempts them is dropped — the failure surfaces as a worker's own
// lint failing on a file the reviewer cannot see. This pins it instead.
import { test, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";

// No Node globals are declared for .mjs outside oracle/ (eslint.config.js:25), so this file must
// avoid process/console/__dirname/URL — all no-undef here. import.meta.dirname is syntax, not a
// global, and Node 22 (what CI runs) has it.
const ROOT = path.resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: ROOT });

// Every path below ends in .mjs on purpose. isPathIgnored also answers true for a path no config
// matches at all, so a .md or .txt path would report "ignored" whatever the ignores array says and
// would keep passing after the entry was deleted.
test("a worker's scratch probe is ignored", async () => {
  expect(await eslint.isPathIgnored(".hivemind/scratch/probe.mjs")).toBe(true);
});

// The assertion that pins the **/ prefix: `.hivemind/**` passes the test above and fails this one.
// The root checkout lints an active worker's whole worktree, scratch included.
test("a scratch probe inside a worktree is ignored too", async () => {
  expect(await eslint.isPathIgnored(".worktrees/issue-1/.hivemind/scratch/probe.mjs")).toBe(true);
});

// The negative control. Without it an over-broad pattern — or a cwd wrong enough that nothing
// resolves — would leave both assertions above passing while eslint checked nothing.
test("real source is still linted", async () => {
  expect(await eslint.isPathIgnored("packages/core/src/index.ts")).toBe(false);
});
