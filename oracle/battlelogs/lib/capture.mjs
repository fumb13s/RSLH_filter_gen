// oracle/battlelogs/lib/capture.mjs
// Archive-and-index policy: which bytes we hold, which rows we owe, and one pass of each direction.
// captureOnce copies every source file we do not already hold, then decodes and indexes it;
// reconcileArchive reads the archive back for bytes we hold with no row. RSL Helper keeps only the
// newest 20 logs, so the copy always precedes the decode — a decode bug must never cost a file that
// is about to be evicted. Bytes are the source of truth; the index is derived and rebuildable
// (rebuild-index.mjs replays it). Imported by watch.mjs, which supplies the timer around the pass.
import {
  readdirSync, existsSync, mkdirSync, copyFileSync, appendFileSync, readFileSync, statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readBattle } from "./codec.mjs";
import { summarize } from "./summarize.mjs";

export const LOG_RE = /^\d{8}_\d{6}_live\.jsonl\.z$/;
export const MAX_DECODE_ATTEMPTS = 3;

export const listSource = (dir) => readdirSync(dir).filter((f) => LOG_RE.test(f)).sort();

// Unparseable lines are SKIPPED, not thrown on. newCaptureState reads this at startup, so throwing
// would mean the watcher cannot start at all and the repair is hand-editing a file full of personal
// data — total impact for a torn tail that append-only writes can only ever leave on the last line.
// A skipped row means its file counts as uncaptured, so it is decoded again from the archived bytes,
// which is the correct repair: the index is derived, the bytes are the source of truth.
export function readIndex(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return rows;
}

// The one place the failed-row shape is written. `error?.message ?? error` because a throw is not
// guaranteed to be an Error: a bare `error.message` raises a second TypeError on a null throw, and
// records the literal "undefined" on a string one.
export const decodeFailedRow = (file, account, capturedAt, error) =>
  ({ file, account, capturedAt, decodeFailed: true, error: String(error?.message ?? error) });

// Archived bytes -> the row they deserve, success or failure, never a throw. captureOnce keeps its
// own try/catch because it needs the raw error and the attempt count; this is for the two callers
// that only want a row out of bytes they already hold — the startup reconcile and rebuild-index.mjs.
export function replayRow(archiveDir, { file, account, capturedAt }) {
  try {
    return summarize(readBattle(join(archiveDir, file)), { file, account, capturedAt });
  } catch (error) {
    return decodeFailedRow(file, account, capturedAt, error);
  }
}

// Rebuilt from disk on every start, so a restart never re-copies and never double-indexes.
// `attempts` is intentionally in-memory only: restarting the watcher is the escape hatch for a
// file that happened to be mid-write when capture stopped.
//
// Two sets, not one. A `decodeFailed` row means "we hold these bytes and could not read them", which
// is NOT the same as done: a restart must get another go, or a file retired by a summarizer bug is
// retired forever (the first Arena session is exactly that case). `failed` therefore gates only the
// second failed-row append, never the work. `account` is required because index.jsonl lives at the
// archive ROOT and is shared by every account, while archiveDir is per-account — without the filter,
// a second account's identically-named file reads as already captured and is never copied.
export function newCaptureState(archiveDir, indexPath, account) {
  const rows = readIndex(indexPath).filter((r) => r.account === account);
  const indexed = new Set(rows.filter((r) => !r.decodeFailed).map((r) => r.file));
  const failed = new Set(rows.filter((r) => r.decodeFailed).map((r) => r.file));
  const held = existsSync(archiveDir)
    ? new Set(readdirSync(archiveDir).filter((f) => LOG_RE.test(f)))
    : new Set();
  return { indexed, failed, held, attempts: new Map() };
}

export function captureOnce({ sourceDir, archiveDir, indexPath, account, state, now }) {
  mkdirSync(archiveDir, { recursive: true });
  mkdirSync(dirname(indexPath), { recursive: true });

  const results = [];
  for (const file of listSource(sourceDir)) {
    if (state.indexed.has(file)) continue;

    // 1. bytes first, always — above every other gate. Re-copy while undecoded: the source may have
    // been mid-write, and re-copying is the only thing that repairs a partial. A file whose decode
    // attempts are spent still gets copied every pass; only the inflate below stops.
    const copied = !state.held.has(file);
    try {
      copyFileSync(join(sourceDir, file), join(archiveDir, file));
      state.held.add(file);
    } catch (err) {
      // listSource sorts oldest-first, which is exactly RSL Helper's eviction order, so the file
      // most likely to vanish mid-pass is the one we reach first — and letting that escape would
      // abandon every file behind it, worst at startup when the backlog is longest.
      if (err.code !== "ENOENT") throw err;   // a real fs fault is not ours to swallow
      // Evicted before we ever held it: nothing to save, and nothing to write — which leaves the
      // reported result as the only trace the battle existed. Losing one silently is the single
      // output a capture tool must not produce.
      if (!state.held.has(file)) { results.push({ file, copied: false, missed: true }); continue; }
      // else: we hold a copy from an earlier pass, and the decode is still worth doing.
    }

    // 2. decode and index second. Stop inflating a file that has spent its budget — a genuinely
    // corrupt file must not be re-inflated every 3 seconds for the rest of the session. This is not
    // redundant with `indexed`: if the appendFileSync below throws (ENOSPC, read-only mount),
    // `indexed` never gets the file and it comes back next pass with its attempts already spent.
    // That is what stops it decode-failing forever.
    if ((state.attempts.get(file) ?? 0) >= MAX_DECODE_ATTEMPTS) continue;

    const attempt = (state.attempts.get(file) ?? 0) + 1;
    state.attempts.set(file, attempt);
    try {
      const row = summarize(readBattle(join(archiveDir, file)), { file, account, capturedAt: now() });
      appendFileSync(indexPath, `${JSON.stringify(row)}\n`);
      state.indexed.add(file);
      results.push({ file, copied, row });
    } catch (error) {
      // Untyped on purpose. BattleLogError is the documented decode failure, but a raw TypeError
      // lands here too: summarize walks the FINAL line, which the codec's line-0-only validation
      // never saw. A pass that throws is a pass that stops capturing the files behind this one.
      if (attempt >= MAX_DECODE_ATTEMPTS && !state.failed.has(file)) {
        appendFileSync(indexPath, `${JSON.stringify(decodeFailedRow(file, account, now(), error))}\n`);
        // `failed`, NOT `indexed`: a restart must get another go at the decode, or a file retired by
        // a summarizer bug is retired forever. The set exists only to stop a SECOND failed row.
        state.failed.add(file);
      }
      results.push({ file, copied, error, attempt });
    }
  }
  return results;
}

// The one pass that reads the archive back. captureOnce iterates the SOURCE and nothing else, so
// bytes we hold with no index row — a watcher killed between the copy and the append, a torn index
// tail — stop being reachable the moment RSL Helper evicts the source, and the archived battle is
// then unfindable without inflating everything. Runs once per watcher start: one readdir plus an
// inflate per unindexed file, and normally zero files.
//
// Files still present in the source are LEFT ALONE. captureOnce reaches them on the very next pass
// with a fresh copy and the full retry budget, which beats replaying bytes that may still be
// mid-write — and it keeps a mid-write partial from being retired here before it can heal.
export function reconcileArchive({ sourceDir, archiveDir, indexPath, account, state }) {
  mkdirSync(dirname(indexPath), { recursive: true });
  const inSource = new Set(listSource(sourceDir));

  const results = [];
  for (const file of [...state.held].sort()) {
    if (state.indexed.has(file) || state.failed.has(file) || inSource.has(file)) continue;
    // The row we never wrote has no capturedAt to recover. copyFileSync stamps the destination at
    // copy time, so the archived file's mtime is when we captured it — the only honest reconstruction.
    const capturedAt = statSync(join(archiveDir, file)).mtime.toISOString();
    const row = replayRow(archiveDir, { file, account, capturedAt });
    appendFileSync(indexPath, `${JSON.stringify(row)}\n`);
    if (row.decodeFailed) {
      state.failed.add(file);
      results.push({ file, copied: false, reconciled: true, error: row.error });
    } else {
      state.indexed.add(file);
      results.push({ file, copied: false, reconciled: true, row });
    }
  }
  return results;
}
