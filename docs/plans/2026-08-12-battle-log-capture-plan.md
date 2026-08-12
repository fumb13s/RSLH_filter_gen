# Battle-log capture and ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every RSL Helper battle log into an archive we control before RSL Helper evicts it, and decode it into typed objects with a thin searchable index.

**Architecture:** Four small ESM modules under `oracle/battlelogs/`. `lib/codec.mjs` inflates and parses (pure). `lib/summarize.mjs` turns a decoded battle into an index row (pure). `lib/capture.mjs` performs one capture pass — copy bytes, then decode and index. `watch.mjs` is the foreground CLI that resolves directories, loops on a timer, and logs. Purity of the first two is load-bearing: the index is a derived artifact that must be rebuildable by replaying `summarize` over the archive.

**Tech Stack:** Node ESM (`.mjs`), `node:zlib`, `node:fs`, vitest. Node 22.14 is what this repo runs; `fs.globSync` (used for source auto-detection) exists there and returns paths without a trailing slash, so `basename()` yields the account id directly.

**Spec:** `docs/plans/2026-08-12-battle-log-capture-design.md`

## Global Constraints

- **The archive is never committed.** This repo is public; logs carry `ownerId` and champion instance ids. `oracle/battlelogs/archive/.gitignore` uses the deny-all `oracle/resources/` pattern and must exist before any capture code runs.
- **Test fixtures are synthetic and hand-built.** Never commit a captured log, not even a truncated one.
- **`oracle/` is linted.** `eslint.config.js` covers `oracle/**/*.mjs` with Node globals, exempting only third-party and derived directories. New code under `oracle/battlelogs/` is linted by default, so `npm run lint` must pass — do not add an exemption for it.
- **`vitest.config.ts` must be extended** to include `oracle/battlelogs/**/*.test.mjs`, or every test written here silently never runs.
- Copy bytes **before** decoding, always. A decode bug must never cost a file about to be evicted.
- Style: match `oracle/lib/decode.mjs` — a comment header stating the module's purpose and who imports it, named exports, no default exports.
- Pre-commit gate: `npm run build && npm test && npm run lint`.
- Commit trailer: `Co-Authored-By: Claude` (no email).

---

### Task 1: Scaffolding and codec

Creates the package, wires it into vitest, and lands the gitignore **before** any code can write logs to disk.

**Files:**
- Create: `oracle/battlelogs/archive/.gitignore`
- Create: `oracle/battlelogs/lib/codec.mjs`
- Create: `oracle/battlelogs/__tests__/fixtures.mjs`
- Create: `oracle/battlelogs/__tests__/codec.test.mjs`
- Modify: `vitest.config.ts:5`

**Interfaces:**
- Consumes: nothing.
- Produces: `BattleLogError` (with `.code` of `INFLATE_FAILED` | `PARSE_FAILED` | `EMPTY` | `SHAPE`), `inflateBattle(buf) -> string`, `parseBattle(text) -> object[]`, `readBattle(path) -> object[]`. Test helpers `makeHero(id, over?)`, `makeLine(over?)`, `makeBattleBytes(lines) -> Buffer`.

- [ ] **Step 1: Create the archive gitignore first**

This lands before any code that could write logs, so there is no window in which a stray `git add -A` stages personal data.

Create `oracle/battlelogs/archive/.gitignore`:

```gitignore
# Local-only battle logs: personal account data. NOT committed.
*
!.gitignore
```

- [ ] **Step 2: Wire the new test directory into vitest**

Modify `vitest.config.ts` line 5. Without this the tests below are collected by nothing and always "pass".

```ts
    include: ["packages/*/src/**/*.test.ts", "oracle/analytics/**/*.test.mjs", "oracle/battlelogs/**/*.test.mjs"],
```

- [ ] **Step 3: Write the synthetic fixture builders**

Create `oracle/battlelogs/__tests__/fixtures.mjs`:

```js
// oracle/battlelogs/__tests__/fixtures.mjs
// Synthetic battle-log builders. NEVER use a captured log as a fixture — this repo is public and
// real logs carry ownerId and champion instance ids.
import { deflateSync } from "node:zlib";

export function makeHero(id, over = {}) {
  return {
    id, typeId: 1000 + id, inv: 90000 + id, slot: id + 1, lvl: 60,
    turns: 0, hp: 100, maxHp: 100, dmgTaken: 0, stamina: 0,
    active: false, dead: false, boss: false, skipNext: false,
    flags: [], buffs: [], debuffs: [], skills: [], ...over,
  };
}

export function makeLine(over = {}) {
  return {
    type: "battleLiveState", proc: 123456789, kindId: 2, regionTypeId: 301, stageId: 3019003,
    hasStats: false, pushKind: "turn", turnsApplied: 1, turn: 1, round: 1,
    isAuto: true, finished: false, extraTurn: false,
    playerTurns: 0, playerAutoTurns: 0, bossTurns: 0, activeHeroId: 0,
    events: [], eventsTruncated: false,
    teams: [
      { team: 1, isPlayer: true, ownerId: 111, heroes: [makeHero(0), makeHero(1)] },
      { team: 2, isPlayer: false, ownerId: 222, heroes: [makeHero(2), makeHero(3)] },
    ],
    ...over,
  };
}

// JSONL text with the trailing newline RSL Helper writes.
export const makeBattleText = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

// deflateSync emits zlib-wrapped output (magic 78 9c), matching what RSL Helper writes.
export const makeBattleBytes = (lines) => deflateSync(Buffer.from(makeBattleText(lines), "utf8"));
```

- [ ] **Step 4: Write the failing codec tests**

Create `oracle/battlelogs/__tests__/codec.test.mjs`:

```js
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
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run oracle/battlelogs`
Expected: FAIL — `Failed to resolve import "../lib/codec.mjs"`.

If instead it reports **no test files found**, Step 2 was not applied — fix `vitest.config.ts` before continuing.

- [ ] **Step 6: Implement the codec**

Create `oracle/battlelogs/lib/codec.mjs`:

```js
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
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run oracle/battlelogs`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts oracle/battlelogs/
git commit -m "$(cat <<'EOF'
feat(battlelogs): zlib JSONL codec for RSL Helper battle logs

Inflate + parse with typed BattleLogError, so a file caught mid-write is a
recoverable condition rather than a raw zlib throw. Archive gitignore lands
in the same commit, before any code can write logs to disk.

Co-Authored-By: Claude
EOF
)"
```

---

### Task 2: Summarize a battle into an index row

**Files:**
- Create: `oracle/battlelogs/lib/summarize.mjs`
- Create: `oracle/battlelogs/__tests__/summarize.test.mjs`

**Interfaces:**
- Consumes: decoded lines from `readBattle` (Task 1); `makeHero`, `makeLine` from `__tests__/fixtures.mjs`.
- Produces: `summarize(lines, {file, account, capturedAt}) -> row`, where `row` has the keys listed in the spec's *Index row* section. Consumed by `lib/capture.mjs` in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `oracle/battlelogs/__tests__/summarize.test.mjs`:

```js
// oracle/battlelogs/__tests__/summarize.test.mjs
import { test, expect } from "vitest";
import { summarize } from "../lib/summarize.mjs";
import { makeHero, makeLine } from "./fixtures.mjs";

const META = { file: "20260812_232412_live.jsonl.z", account: "um1", capturedAt: "2026-08-12T23:24:12.000Z" };

test("summarize pulls identity from the first line and counters from the last", () => {
  const row = summarize([
    makeLine({ turn: 1 }),
    makeLine({ turn: 9, round: 2, playerTurns: 7, bossTurns: 2, finished: true }),
  ], META);
  expect(row.proc).toBe(123456789);
  expect(row.kindId).toBe(2);
  expect(row.regionTypeId).toBe(301);
  expect(row.stageId).toBe(3019003);
  expect(row.lines).toBe(2);
  expect(row.turns).toBe(9);
  expect(row.rounds).toBe(2);
  expect(row.playerTurns).toBe(7);
  expect(row.bossTurns).toBe(2);
  expect(row.finished).toBe(true);
  expect(row.file).toBe(META.file);
  expect(row.account).toBe("um1");
  expect(row.capturedAt).toBe(META.capturedAt);
});

test("survivors counts non-dead heroes per side on the final line", () => {
  const last = makeLine({
    finished: true,
    teams: [
      { team: 1, isPlayer: true, ownerId: 111, heroes: [makeHero(0), makeHero(1, { dead: true })] },
      { team: 2, isPlayer: false, ownerId: 222, heroes: [makeHero(2, { dead: true }), makeHero(3, { dead: true })] },
    ],
  });
  const row = summarize([makeLine(), last], META);
  expect(row.survivors).toEqual({ player: 1, enemy: 0 });
});

test("no win field is emitted — a live enemy is not necessarily a loss", () => {
  const row = summarize([makeLine(), makeLine({ finished: true })], META);
  expect(row).not.toHaveProperty("win");
});

test("hero rows keep the join keys and drop volatile per-turn state", () => {
  const row = summarize([makeLine(), makeLine({ finished: true })], META);
  const h = row.teams[0].heroes[0];
  expect(h).toEqual({ id: 0, typeId: 1000, inv: 90000, slot: 1, lvl: 60, maxHp: 100, boss: false });
});

test("a turn counter that skips values is recorded as-is", () => {
  const row = summarize([makeLine({ turn: 6 }), makeLine({ turn: 8, finished: true })], META);
  expect(row.turns).toBe(8);
});

test("a single-line battle summarizes without special-casing", () => {
  const row = summarize([makeLine({ finished: true })], META);
  expect(row.lines).toBe(1);
  expect(row.survivors).toEqual({ player: 2, enemy: 2 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run oracle/battlelogs/__tests__/summarize.test.mjs`
Expected: FAIL — `Failed to resolve import "../lib/summarize.mjs"`.

- [ ] **Step 3: Implement summarize**

Create `oracle/battlelogs/lib/summarize.mjs`:

```js
// oracle/battlelogs/lib/summarize.mjs
// Decoded battle -> one index row. A pure function of its inputs: no I/O and no capture-time state
// beyond the meta the caller passes, so the whole index can be rebuilt by replaying this over the
// archive when the row shape changes.

// Keep the join keys (inv -> Champs.ID, typeId) and the identity fields; drop per-turn state, which
// belongs to the battle body rather than to an index.
const heroRow = (h) => ({
  id: h.id, typeId: h.typeId, inv: h.inv, slot: h.slot, lvl: h.lvl, maxHp: h.maxHp, boss: !!h.boss,
});

export function summarize(lines, { file, account, capturedAt }) {
  const first = lines[0];
  const last = lines[lines.length - 1];

  let player = 0;
  let enemy = 0;
  for (const t of last.teams) {
    const alive = t.heroes.filter((h) => !h.dead).length;
    if (t.isPlayer) player += alive;
    else enemy += alive;
  }

  return {
    file, account, capturedAt,
    proc: first.proc,
    kindId: first.kindId,
    regionTypeId: first.regionTypeId,
    stageId: first.stageId,
    isAuto: !!first.isAuto,
    lines: lines.length,
    turns: last.turn,
    rounds: last.round,
    playerTurns: last.playerTurns,
    bossTurns: last.bossTurns,
    finished: !!last.finished,
    teams: last.teams.map((t) => ({
      team: t.team, isPlayer: !!t.isPlayer, ownerId: t.ownerId, heroes: t.heroes.map(heroRow),
    })),
    // Facts, not a verdict. Boss content ends with the boss alive, so "enemy team wiped" would
    // score every such run a loss. A win rule is per-content-type and comes after identification.
    survivors: { player, enemy },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run oracle/battlelogs/__tests__/summarize.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add oracle/battlelogs/
git commit -m "$(cat <<'EOF'
feat(battlelogs): summarize a decoded battle into an index row

Pure function of the decoded lines, so the index is rebuildable by replay.
Records survivor counts rather than a win flag: boss content ends with the
boss alive, so an "enemy wiped" rule would score every such run a loss.

Co-Authored-By: Claude
EOF
)"
```

---

### Task 3: One capture pass

The unit that does the actual work, split from the timer loop so it is testable without waiting on wall-clock.

**Files:**
- Create: `oracle/battlelogs/lib/capture.mjs`
- Create: `oracle/battlelogs/__tests__/capture.test.mjs`

**Interfaces:**
- Consumes: `readBattle`, `BattleLogError` (Task 1); `summarize` (Task 2).
- Produces: `LOG_RE`, `MAX_DECODE_ATTEMPTS`, `listSource(dir) -> string[]`, `readIndex(path) -> row[]`, `newCaptureState(archiveDir, indexPath) -> state`, `captureOnce({sourceDir, archiveDir, indexPath, account, state, now}) -> result[]`. Each result is `{file, copied, row?, error?}`. Consumed by `watch.mjs` in Task 4.

**Note on a refinement to the spec:** the spec says a decode failure writes a `decodeFailed` row *and* re-attempts. Writing on every attempt would leave superseded rows in an append-only file. This implements the same policy with exactly one row per file: a row is appended when decode succeeds, **or** when the third attempt fails. A watcher killed mid-retry leaves the file archived with no row, and startup reconciliation retries it — the bytes are never at risk either way.

- [ ] **Step 1: Write the failing tests**

Create `oracle/battlelogs/__tests__/capture.test.mjs`:

```js
// oracle/battlelogs/__tests__/capture.test.mjs
import { test, expect } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureOnce, newCaptureState, readIndex, listSource, MAX_DECODE_ATTEMPTS } from "../lib/capture.mjs";
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run oracle/battlelogs/__tests__/capture.test.mjs`
Expected: FAIL — `Failed to resolve import "../lib/capture.mjs"`.

- [ ] **Step 3: Implement capture**

Create `oracle/battlelogs/lib/capture.mjs`:

```js
// oracle/battlelogs/lib/capture.mjs
// One capture pass: copy every source file we do not already hold, then decode and index it.
// RSL Helper keeps only the newest 20 logs, so the copy always precedes the decode — a decode bug
// must never cost a file that is about to be evicted. Bytes are the source of truth; the index is
// derived and rebuildable.
import { readdirSync, existsSync, mkdirSync, copyFileSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBattle } from "./codec.mjs";
import { summarize } from "./summarize.mjs";

export const LOG_RE = /^\d{8}_\d{6}_live\.jsonl\.z$/;
export const MAX_DECODE_ATTEMPTS = 3;

export const listSource = (dir) => readdirSync(dir).filter((f) => LOG_RE.test(f)).sort();

export function readIndex(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// Rebuilt from disk on every start, so a restart never re-copies and never double-indexes.
// `attempts` is intentionally in-memory only: restarting the watcher is the escape hatch for a
// file that happened to be mid-write when capture stopped.
export function newCaptureState(archiveDir, indexPath) {
  const indexed = new Set(readIndex(indexPath).map((r) => r.file));
  const held = existsSync(archiveDir)
    ? new Set(readdirSync(archiveDir).filter((f) => LOG_RE.test(f)))
    : new Set();
  return { indexed, held, attempts: new Map() };
}

export function captureOnce({ sourceDir, archiveDir, indexPath, account, state, now }) {
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(dirname(indexPath), { recursive: true });

  const results = [];
  for (const file of listSource(sourceDir)) {
    if (state.indexed.has(file)) continue;
    if ((state.attempts.get(file) ?? 0) >= MAX_DECODE_ATTEMPTS) continue;

    // 1. bytes first, always. Re-copy while undecoded: the source may have been mid-write.
    const copied = !state.held.has(file);
    copyFileSync(join(sourceDir, file), join(archiveDir, file));
    state.held.add(file);

    // 2. decode and index second
    const attempt = (state.attempts.get(file) ?? 0) + 1;
    state.attempts.set(file, attempt);
    try {
      const row = summarize(readBattle(join(archiveDir, file)), { file, account, capturedAt: now() });
      appendFileSync(indexPath, `${JSON.stringify(row)}\n`);
      state.indexed.add(file);
      results.push({ file, copied, row });
    } catch (error) {
      if (attempt >= MAX_DECODE_ATTEMPTS) {
        const row = { file, account, capturedAt: now(), decodeFailed: true, error: String(error.message) };
        appendFileSync(indexPath, `${JSON.stringify(row)}\n`);
        state.indexed.add(file);
      }
      results.push({ file, copied, error });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run oracle/battlelogs/__tests__/capture.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add oracle/battlelogs/
git commit -m "$(cat <<'EOF'
feat(battlelogs): capture pass that copies before decoding

Copies every unheld source file, then decodes and indexes it. A corrupt or
mid-write file is archived anyway and retried up to 3 times before a
decodeFailed row lands, so bytes are never lost to a decode failure.

Co-Authored-By: Claude
EOF
)"
```

---

### Task 4: Watcher CLI and README

**Files:**
- Create: `oracle/battlelogs/watch.mjs`
- Create: `oracle/battlelogs/README.md`
- Create: `oracle/battlelogs/__tests__/watch.test.mjs`

**Interfaces:**
- Consumes: `captureOnce`, `newCaptureState`, `readIndex` (Task 3).
- Produces: `parseArgs(argv) -> opts`, `resolveSource(explicit) -> {sourceDir, account}`, `formatCapture(result, seenTuples) -> string`, `main(argv)`. Terminal entry point; nothing consumes it.

- [ ] **Step 1: Write the failing tests**

Only the pure helpers are tested. The timer loop is not — it has no logic beyond `setTimeout` around `captureOnce`, which Task 3 covers.

Create `oracle/battlelogs/__tests__/watch.test.mjs`:

```js
// oracle/battlelogs/__tests__/watch.test.mjs
import { test, expect } from "vitest";
import { parseArgs, formatCapture, tupleKey } from "../watch.mjs";

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

const ROW = {
  file: "20260812_232412_live.jsonl.z", kindId: 2, regionTypeId: 301, stageId: 3019003,
  turns: 9, lines: 9,
  teams: [{ isPlayer: true, heroes: [1, 2, 3, 4] }, { isPlayer: false, heroes: [1, 2] }],
};

test("formatCapture reports content ids and team sizes", () => {
  const line = formatCapture({ file: ROW.file, row: ROW }, new Set([tupleKey(ROW)]));
  expect(line).toContain("20260812_232412_live.jsonl.z");
  expect(line).toContain("kind=2 region=301 stage=3019003");
  expect(line).toContain("9 turns");
  expect(line).toContain("4v2");
  expect(line).not.toContain("NEW");
});

test("an unseen content tuple is marked NEW — this is how Arena gets identified", () => {
  const line = formatCapture({ file: ROW.file, row: ROW }, new Set());
  expect(line).toContain("NEW");
});

test("a decode failure formats as a warning naming the file", () => {
  const line = formatCapture({ file: ROW.file, error: new Error("zlib inflate failed: bad") }, new Set());
  expect(line).toContain("DECODE FAILED");
  expect(line).toContain("20260812_232412_live.jsonl.z");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run oracle/battlelogs/__tests__/watch.test.mjs`
Expected: FAIL — `Failed to resolve import "../watch.mjs"`.

- [ ] **Step 3: Implement the watcher**

Create `oracle/battlelogs/watch.mjs`:

```js
// oracle/battlelogs/watch.mjs
// Foreground watcher: poll RSL Helper's battlelogs directory and copy every new battle into our
// archive before RSL Helper evicts it — it keeps only the newest 20 files, which during active play
// is 10-15 minutes of history.
//
//   node oracle/battlelogs/watch.mjs [--source DIR] [--archive DIR] [--interval SEC] [--once]
//
// Source defaults to $RSLHELPER_BATTLELOGS, else the single account directory under
// /mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/. Archive defaults to ./archive/<account>.
import { existsSync, globSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureOnce, newCaptureState, readIndex } from "./lib/capture.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function parseArgs(argv) {
  const o = { source: null, archive: null, intervalMs: 3000, once: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--once") o.once = true;
    else if (a === "--source") o.source = argv[++i];
    else if (a === "--archive") o.archive = argv[++i];
    else if (a === "--interval") {
      const sec = Number(argv[++i]);
      if (!Number.isFinite(sec) || sec <= 0) throw new Error(`--interval needs a positive number of seconds`);
      o.intervalMs = sec * 1000;
    } else throw new Error(`unknown argument ${JSON.stringify(a)}`);
  }
  return o;
}

// The account directory is the one RSL Helper names after the account id.
export function resolveSource(explicit) {
  const dir = explicit
    ?? process.env.RSLHELPER_BATTLELOGS
    ?? globSync("/mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/*/").sort()[0];
  if (!dir || !existsSync(dir)) {
    throw new Error(
      "battle-log directory not found. Set RSLHELPER_BATTLELOGS=/path/to/battlelogs/<account> "
      + "or pass --source. Looked under /mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/.",
    );
  }
  const clean = resolve(dir);
  return { sourceDir: clean, account: basename(clean) };
}

export const tupleKey = (row) => `${row.kindId}/${row.regionTypeId}/${row.stageId}`;

export function formatCapture(result, seenTuples) {
  const stamp = new Date().toTimeString().slice(0, 8);
  if (result.error) return `${stamp}  DECODE FAILED ${result.file}  ${result.error.message}`;
  const r = result.row;
  const sizes = r.teams.map((t) => t.heroes.length).join("v");
  const isNew = seenTuples.has(tupleKey(r)) ? "" : "  ** NEW CONTENT TUPLE **";
  return `${stamp}  copied ${r.file}  kind=${r.kindId} region=${r.regionTypeId} stage=${r.stageId}`
    + `  ${r.turns} turns  ${sizes}${isNew}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function main(argv) {
  const opts = parseArgs(argv);
  const { sourceDir, account } = resolveSource(opts.source);
  const archiveRoot = opts.archive ? resolve(opts.archive) : here("./archive");
  const archiveDir = join(archiveRoot, account);
  const indexPath = join(archiveRoot, "index.jsonl");

  const state = newCaptureState(archiveDir, indexPath);
  const seenTuples = new Set(readIndex(indexPath).filter((r) => !r.decodeFailed).map(tupleKey));

  console.log(`watching ${sourceDir}`);
  console.log(`archive  ${archiveDir}  (${state.indexed.size} already held)`);
  console.log(`polling every ${opts.intervalMs / 1000}s — Ctrl-C to stop\n`);

  for (;;) {
    let results = [];
    try {
      results = captureOnce({ sourceDir, archiveDir, indexPath, account, state, now: () => new Date().toISOString() });
    } catch (err) {
      console.error(`capture pass failed: ${err.message}`);   // keep polling; a full disk must not stop capture
    }
    for (const r of results) {
      console.log(formatCapture(r, seenTuples));
      if (r.row) seenTuples.add(tupleKey(r.row));
    }
    if (opts.once) return;
    await sleep(opts.intervalMs);
  }
}

if (process.argv[1] === here("./watch.mjs")) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run oracle/battlelogs/__tests__/watch.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify the CLI end-to-end against a temp directory**

This exercises `resolveSource`, `main`, and the real filesystem — the parts the unit tests deliberately skip. It must not touch the live RSL Helper directory.

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/src/um-test"
node -e "
const {deflateSync}=require('node:zlib');
const line=(o)=>JSON.stringify({type:'battleLiveState',proc:1,kindId:2,regionTypeId:301,stageId:3019003,
 hasStats:false,pushKind:'turn',turnsApplied:1,turn:1,round:1,isAuto:true,finished:false,extraTurn:false,
 playerTurns:0,playerAutoTurns:0,bossTurns:0,activeHeroId:0,events:[],eventsTruncated:false,
 teams:[{team:1,isPlayer:true,ownerId:1,heroes:[{id:0,typeId:1,inv:1,slot:1,lvl:60,maxHp:1,dead:false,boss:false}]},
        {team:2,isPlayer:false,ownerId:2,heroes:[{id:1,typeId:2,inv:2,slot:1,lvl:60,maxHp:1,dead:true,boss:false}]}],
 ...o});
require('node:fs').writeFileSync(process.argv[1],
  deflateSync(Buffer.from(line({})+'\n'+line({turn:5,finished:true})+'\n')));
" "$TMP/src/um-test/20260812_232412_live.jsonl.z"

node oracle/battlelogs/watch.mjs --source "$TMP/src/um-test" --archive "$TMP/archive" --once
cat "$TMP/archive/index.jsonl"
rm -rf "$TMP"
```

Expected: a `copied … kind=2 region=301 stage=3019003  5 turns  1v1  ** NEW CONTENT TUPLE **` line, and one index row with `"survivors":{"player":1,"enemy":0}`.

- [ ] **Step 6: Write the README**

Create `oracle/battlelogs/README.md`:

````markdown
# Battle logs

Captures RSL Helper's per-battle logs before it deletes them, and decodes them.

**RSL Helper keeps only the newest 20 files.** During active play that is 10–15 minutes of history,
so anything not copied promptly is gone. Start the watcher before you play.

## Run

```bash
node oracle/battlelogs/watch.mjs
```

Polls every 3s and copies each new battle into `archive/<account>/`, appending a summary row to
`archive/index.jsonl`. Ctrl-C to stop. Flags: `--source DIR`, `--archive DIR`, `--interval SEC`,
`--once`. Source is auto-detected under `/mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/`, or
set `RSLHELPER_BATTLELOGS`.

Each captured battle logs its content ids. A tuple not seen before is flagged
`** NEW CONTENT TUPLE **` — that is how a mode we have not captured yet, such as Arena, gets
identified.

## Read a captured battle

```js
import { readBattle } from "./lib/codec.mjs";
const lines = readBattle("archive/um.../20260812_232412_live.jsonl.z");   // one object per turn push
```

Format reference — envelope, teams, events: `docs/plans/2026-08-12-battle-log-capture-design.md`.

## Rebuild the index

The index is derived. `summarize()` is a pure function of a decoded battle, so replaying it over
`archive/<account>/` regenerates `index.jsonl` whenever the row shape changes.

## Privacy

`archive/` is gitignored and **never committed** — this repo is public and the logs carry `ownerId`
and champion instance ids. Test fixtures are synthetic (`__tests__/fixtures.mjs`); never use a
captured log as a fixture.

## Test

Folded into `npm test`, or just this package: `npx vitest run oracle/battlelogs`.
````

- [ ] **Step 7: Run the full pre-commit gate**

Run: `npm run build && npm test && npm run lint`
Expected: build OK; all tests pass, including 26 new ones under `oracle/battlelogs`; lint clean.

- [ ] **Step 8: Commit**

```bash
git add oracle/battlelogs/
git commit -m "$(cat <<'EOF'
feat(battlelogs): foreground watcher CLI and README

Polls the RSL Helper battlelogs directory every 3s and captures new battles
before eviction. Logs each capture with its kindId/regionTypeId/stageId and
flags tuples never seen before, so the first Arena session identifies itself.

Co-Authored-By: Claude
EOF
)"
```

---

## Self-review

**Spec coverage.** Watcher polling and copy → Task 3/4. Codec → Task 1. Index → Tasks 2/3. Console logging with content ids and NEW marking → Task 4. Copy-before-decode → Task 3, asserted by the corrupt-file test. 3-attempt retry bound → Task 3, asserted. `survivors` and no `win` field → Task 2, asserted. Gitignore with the deny-all pattern → Task 1 Step 1, deliberately first. Synthetic fixtures → Task 1 Step 3. Error handling for a missing source dir → Task 4 `resolveSource`; for archive write failure → Task 4 `main`'s try/catch around the pass; for duplicate `proc` → no code needed, both are indexed since keying is by `file`.

**Deviations from the spec, both deliberate and noted at their task:** one index row per file rather than a `decodeFailed` row that is later superseded (Task 3); `oracle/battlelogs/archive/.gitignore` omits the `!README.md` line from the `oracle/resources/` pattern, since the README lives at `oracle/battlelogs/README.md` and nothing is expected inside `archive/` but data.

**Type consistency.** `summarize(lines, meta)` is defined in Task 2 and called with exactly that shape in Task 3. `captureOnce` takes `{sourceDir, archiveDir, indexPath, account, state, now}` in Task 3 and is called with those keys in Task 4. `newCaptureState(archiveDir, indexPath)` matches both. `formatCapture(result, seenTuples)` consumes `{file, row?, error?}`, which is what `captureOnce` returns. `tupleKey` is exported from `watch.mjs` and used by its own test.

**Known gap, by design:** the timer loop in `main` has no test. It is `setTimeout` around `captureOnce`, which Task 3 covers directly, and Task 4 Step 5 exercises `main` once via `--once`.
