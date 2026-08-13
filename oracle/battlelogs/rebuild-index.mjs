// oracle/battlelogs/rebuild-index.mjs
// Regenerate archive/index.jsonl from the archived bytes. The index is derived: summarize() is a
// pure function of a decoded battle, so replaying it over archive/<account>/ reconstructs every row.
// This is what makes "the bytes are the source of truth, the index is rebuildable" — asserted in
// lib/capture.mjs, lib/codec.mjs, lib/summarize.mjs and the design doc — a claim you can cash.
// Terminal entry point: nothing imports it but its test.
//
//   node oracle/battlelogs/rebuild-index.mjs [--archive DIR]
//     --archive   archive root holding <account>/ and index.jsonl. Default: ./archive.
//
// Use it after the row shape changes, after fixing a summarizer bug that retired a batch of files,
// or to compact an index left untidy by a torn tail or by a decodeFailed row that a later success
// superseded. Stop the watcher first: it appends to index.jsonl, and the rename below would drop
// anything it wrote during the rebuild.
//
// The write goes to a temp file and is renamed, so a crash mid-rebuild leaves the existing index
// intact. A file that will not decode gets a decodeFailed row rather than aborting the run — the
// point of the script is to end with an index that describes every byte we hold, and a rebuild that
// dies on the first bad file is useless exactly when it is needed.
import { existsSync, readdirSync, renameSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listSource, replayRow } from "./lib/capture.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function parseArgs(argv) {
  const o = { archive: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Same call as watch.mjs: an unknown argument is a typo, and reading it as "no flag given" would
    // rebuild the DEFAULT archive instead of the one that was asked for. This command replaces a file.
    if (a === "--archive") o.archive = argv[++i];
    else throw new Error(`unknown argument ${JSON.stringify(a)}`);
  }
  return o;
}

// Every subdirectory of the archive root is an account — watch.mjs writes archive/<account>/, and
// once the index is gone the directory name is the only place the account id still exists.
export function listAccounts(archiveRoot) {
  return readdirSync(archiveRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function rebuildIndex(archiveRoot) {
  // An empty archive is a legitimate rebuild; a missing one is a mistyped --archive, and writing an
  // empty index over it would report success in a way that reads exactly like "nothing captured yet".
  if (!existsSync(archiveRoot)) throw new Error(`archive root not found: ${archiveRoot}`);

  const indexPath = join(archiveRoot, "index.jsonl");
  const rows = [];
  const perAccount = [];
  for (const account of listAccounts(archiveRoot)) {
    const archiveDir = join(archiveRoot, account);
    const files = listSource(archiveDir);   // same LOG_RE filter and sort the source side uses
    let failed = 0;
    for (const file of files) {
      // capturedAt is not in the bytes. copyFileSync stamps the destination at copy time, so the
      // archived file's mtime is when we captured it — the honest reconstruction, and the only one.
      const capturedAt = statSync(join(archiveDir, file)).mtime.toISOString();
      const row = replayRow(archiveDir, { file, account, capturedAt });
      if (row.decodeFailed) failed++;
      rows.push(row);
    }
    perAccount.push({ account, files: files.length, failed });
  }

  const tmpPath = `${indexPath}.tmp`;
  writeFileSync(tmpPath, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
  renameSync(tmpPath, indexPath);
  return { indexPath, rows, perAccount };
}

export function main(argv) {
  const archiveRoot = resolve(parseArgs(argv).archive ?? here("./archive"));
  const { indexPath, rows, perAccount } = rebuildIndex(archiveRoot);
  const failed = rows.filter((r) => r.decodeFailed).length;
  for (const a of perAccount) console.log(`${a.account}  ${a.files} file(s), ${a.failed} undecodable`);
  console.log(`rebuilt ${indexPath} — ${rows.length} row(s), ${failed} decodeFailed`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === here("./rebuild-index.mjs")) {
  main(process.argv.slice(2));
}
