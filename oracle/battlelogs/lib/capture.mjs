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
      // Untyped on purpose. BattleLogError is the documented decode failure, but a raw TypeError
      // lands here too: summarize walks the FINAL line, which the codec's line-0-only validation
      // never saw. A pass that throws is a pass that stops capturing the files behind this one.
      // The copy above is deliberately outside this try: a source that vanished mid-pass (ENOENT,
      // RSL Helper evicting its 21st log while we walk the list) is not a decode failure and no
      // retry fixes it, so it propagates and watch.mjs is the one that has to survive it.
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
