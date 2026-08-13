// oracle/battlelogs/lib/capture.mjs
// One capture pass: copy every source file we do not already hold, then decode and index it.
// RSL Helper keeps only the newest 20 logs, so the copy always precedes the decode — a decode bug
// must never cost a file that is about to be evicted. Bytes are the source of truth; the index is
// derived and rebuildable. Imported by watch.mjs, which supplies the timer around this pass.
import { readdirSync, existsSync, mkdirSync, copyFileSync, appendFileSync, readFileSync } from "node:fs";
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
    // Not redundant with the check above, which normally fires first: if the appendFileSync below
    // throws (ENOSPC, read-only mount), `indexed` never gets the file and it comes back next pass
    // with its attempts already spent. This is what stops it copy-decode-failing forever.
    if ((state.attempts.get(file) ?? 0) >= MAX_DECODE_ATTEMPTS) continue;

    // 1. bytes first, always. Re-copy while undecoded: the source may have been mid-write.
    const copied = !state.held.has(file);
    try {
      copyFileSync(join(sourceDir, file), join(archiveDir, file));
      state.held.add(file);
    } catch (err) {
      // listSource sorts oldest-first, which is exactly RSL Helper's eviction order, so the file
      // most likely to vanish mid-pass is the one we reach first — and letting that escape would
      // abandon every file behind it, worst at startup when the backlog is longest.
      if (err.code !== "ENOENT") throw err;   // a real fs fault is not ours to swallow
      if (!state.held.has(file)) continue;    // evicted before we ever held it: nothing to save
      // else: we hold a copy from an earlier pass, and the decode is still worth doing.
    }

    // 2. decode and index second
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
      if (attempt >= MAX_DECODE_ATTEMPTS) {
        // `error?.message ?? error` because a throw is not guaranteed to be an Error: a bare
        // `error.message` raises a second TypeError inside this catch on a null throw, and records
        // the literal "undefined" on a string one. Same reasoning as the untyped catch itself.
        const row = { file, account, capturedAt: now(), decodeFailed: true, error: String(error?.message ?? error) };
        appendFileSync(indexPath, `${JSON.stringify(row)}\n`);
        state.indexed.add(file);
      }
      results.push({ file, copied, error });
    }
  }
  return results;
}
