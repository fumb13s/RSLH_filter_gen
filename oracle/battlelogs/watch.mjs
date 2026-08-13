// oracle/battlelogs/watch.mjs
// Foreground watcher: poll RSL Helper's battlelogs directory and copy every new battle into our
// archive before RSL Helper evicts it — it keeps only the newest 20 files, which during active play
// is 10-15 minutes of history. The pass itself is lib/capture.mjs; this file is the timer, the
// argument handling and the console around it. Terminal entry point: nothing imports it but its
// test.
//
//   node oracle/battlelogs/watch.mjs [--source DIR] [--archive DIR] [--interval SEC] [--once]
//     --source    battlelogs/<account> to watch. Default: $RSLHELPER_BATTLELOGS, else the single
//                 account directory under /mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/.
//     --archive   archive root. Default: ./archive, holding <account>/ and index.jsonl.
//     --interval  seconds between passes (default 3).
//     --once      run one pass and exit, instead of polling.
import { existsSync, globSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureOnce, newCaptureState, reconcileArchive, readIndex, MAX_DECODE_ATTEMPTS,
} from "./lib/capture.mjs";

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
      if (!Number.isFinite(sec) || sec <= 0) throw new Error("--interval needs a positive number of seconds");
      o.intervalMs = sec * 1000;
    } else throw new Error(`unknown argument ${JSON.stringify(a)}`);
  }
  return o;
}

// The account directory is the one RSL Helper names after the account id. globSync returns matches
// unordered, so the sort is what makes the pick deterministic when several accounts have played on
// this machine; a trailing slash in the pattern is what restricts it to directories.
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
  const clean = resolve(dir);   // also drops a trailing slash, so basename is the account id
  return { sourceDir: clean, account: basename(clean) };
}

export const tupleKey = (row) => `${row.kindId}/${row.regionTypeId}/${row.stageId}`;

export function formatCapture(result, seenTuples) {
  const stamp = new Date().toTimeString().slice(0, 8);
  // Nothing was archived and nothing was indexed, so this line is the only trace the battle existed.
  if (result.missed) return `${stamp}  MISSED ${result.file}  evicted before capture`;
  // Branch on `row`, not on `error` being truthy. captureOnce forwards whatever summarize threw and
  // that is not guaranteed to be an Error — a thrown null is falsy, would fall through to the row
  // branch, and would raise a TypeError in main's log loop, which sits outside the try/catch around
  // the pass. `error?.message ?? error` for the same reason capture.mjs uses it: .message off a
  // string is undefined, and off null it throws.
  if (!result.row) {
    // Attempt 1 is "probably transient, will retry"; the last one is "retired until a restart or a
    // rebuild". reconcileArchive has no counter, so the suffix is conditional rather than "undefined/3".
    const tries = result.attempt ? `  (attempt ${result.attempt}/${MAX_DECODE_ATTEMPTS})` : "";
    return `${stamp}  DECODE FAILED ${result.file}${tries}  ${String(result.error?.message ?? result.error)}`;
  }
  const r = result.row;
  const sizes = r.teams.map((t) => t.heroes.length).join("v");
  const isNew = seenTuples.has(tupleKey(r)) ? "" : "  ** NEW CONTENT TUPLE **";
  // "captured", not "copied": a result can be a file we already held and only decoded this pass
  // (result.copied is first-sight, not bytes-written). What is true of every result here is that we
  // now hold the bytes and have indexed them. A reconcile is neither — those bytes were archived on
  // some earlier run, possibly days ago, and only the row is new.
  const verb = result.reconciled ? "indexed" : "captured";
  return `${stamp}  ${verb} ${result.file}  kind=${r.kindId} region=${r.regionTypeId} stage=${r.stageId}`
    + `  ${r.turns} turns  ${sizes}${isNew}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every result reaches the console, and every row it carries joins the seen set — the startup
// reconcile and the poll loop report the same way so neither can quietly stop reporting.
function report(results, seenTuples) {
  for (const r of results) {
    console.log(formatCapture(r, seenTuples));
    if (r.row) seenTuples.add(tupleKey(r.row));
  }
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const { sourceDir, account } = resolveSource(opts.source);
  const archiveRoot = opts.archive ? resolve(opts.archive) : here("./archive");
  const archiveDir = join(archiveRoot, account);
  const indexPath = join(archiveRoot, "index.jsonl");

  const state = newCaptureState(archiveDir, indexPath, account);
  // Seeded BEFORE the reconcile, so a battle whose row we are only writing now is still measured
  // against the tuples that were on record before it — a reconciled Arena capture must still print
  // NEW CONTENT TUPLE.
  const seenTuples = new Set(readIndex(indexPath).filter((r) => !r.decodeFailed).map(tupleKey));

  console.log(`watching ${sourceDir}`);
  console.log(`archive  ${archiveDir}  (${state.held.size} held, ${state.indexed.size} indexed)`);
  console.log(`polling every ${opts.intervalMs / 1000}s — Ctrl-C to stop\n`);

  // captureOnce only ever looks at the source, so this is the one thing that notices bytes we hold
  // with no row. Wrapped for the same reason the pass is: a reconcile fault must not stop a watcher
  // from capturing the files RSL Helper is about to delete.
  try {
    report(reconcileArchive({ sourceDir, archiveDir, indexPath, account, state }), seenTuples);
  } catch (err) {
    console.error(`archive reconcile failed: ${String(err?.message ?? err)}`);
  }

  for (;;) {
    let results = [];
    try {
      results = captureOnce({ sourceDir, archiveDir, indexPath, account, state, now: () => new Date().toISOString() });
    } catch (err) {
      // Report and keep polling. Everything that lands here is recoverable by the next pass or by
      // the operator while the watcher runs: the source directory gone (a drvfs mount that dropped),
      // a full disk, a read-only archive. Exiting would stop capture on files RSL Helper is about
      // to delete, and a dead watcher is indistinguishable from a quiet night.
      console.error(`capture pass failed: ${String(err?.message ?? err)}`);
    }
    report(results, seenTuples);
    if (opts.once) return;
    await sleep(opts.intervalMs);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === here("./watch.mjs")) {
  main(process.argv.slice(2)).catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
}
