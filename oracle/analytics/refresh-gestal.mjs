// MANUAL snapshot capture from Gestal Desktop — refresh.sh's counterpart for a Mac, where RSL Helper
// does not run. Freezes Gestal's account documents into one dated file, then STOPS; run the analysis
// yourself:
//   node oracle/analytics/refresh-gestal.mjs [--account KEY] [--out PATH]
//                                   # -> oracle/resources/<snapshot-date>-Gestal.json.gz
//   node oracle/analytics/analyze.mjs
//
//   --account KEY  a folder under accounts/ (default: the account Gestal is showing, from active.json)
//   --out PATH     write here instead, e.g. a named baseline such as <date>-pre-driver.json.gz
//
// Source: $GESTAL_DATA_ROOT, else ~/Library/Application Support/Gestal. Gestal refreshes those documents
// only while it is attached to a running Raid, so start Raid with Gestal attached and give it a minute
// first. Nothing is written to Gestal's folder. Design: docs/plans/2026-09-28-gestal-snapshot-design.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { DOCUMENTS, FORMAT, FORMAT_VERSION, checkDocument, checkSnapshot, gestalChampRows,
  gestalItems } from "./gestal.mjs";
import { RESOURCES } from "./snapshots.mjs";

// A last read older than this means Gestal is not reading the game right now.
export const STALE_MINUTES = 15;
const APP_VERSION_FILE = "/Applications/Gestal Desktop.app/Contents/MacOS/sq.version";

// --- pure helpers -----------------------------------------------------------

export function parseRefreshArgs(argv) {
  const out = { account: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--account" || a === "--out") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else {
      throw new Error(`unexpected argument "${a}" — usage: refresh-gestal.mjs [--account KEY] [--out PATH]`);
    }
  }
  return out;
}

export function dataRoot(env = process.env, home = homedir()) {
  return env.GESTAL_DATA_ROOT || join(home, "Library", "Application Support", "Gestal");
}

// YYYY-MM-DD in local time — the day the account data is from, as refresh.sh's `date -r` gives it.
export function localDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// When the account data was last known to be current. A document's own extractedAt is when it last
// CHANGED — Gestal rewrites a document only when its content changes — so the last successful
// extraction is the better clock. When there is none (never, or the last attempt failed) the gear
// dump's extractedAt is the best available.
export function dataAsOf(snapshot) {
  const last = snapshot.documents["last-extraction"]?.payload;
  if (last?.succeeded && last.attemptedAt) return { at: last.attemptedAt, source: "last extraction" };
  return { at: snapshot.documents.artifacts.payload.extractedAt, source: "gear dump" };
}

// Warnings for a snapshot that may not reflect the game right now.
export function freshnessWarnings(snapshot, now = new Date()) {
  const warnings = [];
  const last = snapshot.documents["last-extraction"]?.payload;
  if (last && !last.succeeded) {
    warnings.push(`Gestal's last read of the game failed${last.errorMessage ? `: ${last.errorMessage}` : ""}`);
  }
  const { at } = dataAsOf(snapshot);
  const minutes = Math.round((now - new Date(at)) / 60000);
  if (minutes > STALE_MINUTES) {
    warnings.push(`the data is ${formatAge(minutes)} old — Gestal is not reading the game right now;`
      + " start Raid with Gestal attached, give it a minute, and re-run");
  }
  return warnings;
}

export function formatAge(minutes) {
  if (minutes < 90) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} days`;
}

// --- I/O --------------------------------------------------------------------

// Which account folder to read: the explicit one, else the one Gestal is showing. The guest slot and
// folders Gestal never filled fail with the list of folders that do hold a gear dump.
export function resolveAccount(root, account) {
  if (!existsSync(root)) {
    throw new Error(`Gestal data folder not found: ${root} — is Gestal Desktop installed?`
      + " Set GESTAL_DATA_ROOT to point elsewhere.");
  }
  const accounts = join(root, "accounts");
  const withGear = existsSync(accounts)
    ? readdirSync(accounts).filter((k) => existsSync(join(accounts, k, DOCUMENTS.artifacts.path)))
    : [];
  const listing = withGear.length ? `accounts with a gear dump: ${withGear.join(", ")}` : "no account has a gear dump yet";
  let key = account;
  if (!key) {
    const active = join(root, "active.json");
    if (!existsSync(active)) throw new Error(`no active.json in ${root}; pass --account KEY (${listing})`);
    key = JSON.parse(readFileSync(active, "utf8"))?.payload?.activeAccountKey;
    if (!key || key === "local") {
      throw new Error(`Gestal is on its guest slot, which holds no account data — attach it to Raid,`
        + ` or pass --account KEY (${listing})`);
    }
  }
  if (!withGear.includes(key)) throw new Error(`account "${key}" has no gear dump (${listing})`);
  return join(accounts, key);
}

// A document that fails to parse is read once more — a write racing the read — before giving up.
function readDocument(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      if (attempt >= 2 || e.code === "ENOENT") throw e;
    }
  }
}

function gestalVersion() {
  try {
    return readFileSync(APP_VERSION_FILE, "utf8").match(/<version>([^<]+)<\/version>/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// Build the snapshot object from an account folder. Every document the adapter reads is version-checked,
// and the adapter is run over the result, so a file the readers cannot decode is never produced.
export function captureSnapshot(accountDir, { now = new Date(), version = gestalVersion() } = {}) {
  const documents = {};
  for (const [name, spec] of Object.entries(DOCUMENTS)) {
    const path = join(accountDir, spec.path);
    if (!existsSync(path)) {
      if (spec.required) throw new Error(`${path} is missing`);
      continue;
    }
    documents[name] = checkDocument(name, readDocument(path));
  }
  const snapshot = checkSnapshot({ format: FORMAT, formatVersion: FORMAT_VERSION,
    capturedAt: now.toISOString(), gestalVersion: version, documents });
  const items = gestalItems(snapshot);
  const champs = gestalChampRows(snapshot, items);
  return { snapshot, items: items.length, champions: champs.length };
}

// Temp file + rename, so an interrupted write never leaves a truncated snapshot under a real name.
export function writeSnapshot(path, snapshot) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, gzipSync(JSON.stringify(snapshot), { level: 9 }));
  renameSync(tmp, path);
}

function main() {
  let args;
  try {
    args = parseRefreshArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  let captured;
  try {
    captured = captureSnapshot(resolveAccount(dataRoot(), args.account));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { snapshot, items, champions } = captured;
  const asOf = dataAsOf(snapshot);
  const date = localDate(asOf.at);
  const dest = args.out ?? join(RESOURCES, `${date}-Gestal.json.gz`);
  writeSnapshot(dest, snapshot);

  const shown = relative(process.cwd(), dest);
  const when = new Date(asOf.at);
  console.log(`snapshot saved: ${shown.startsWith("..") ? dest : shown}  (${items} pieces, ${champions} champions)`);
  console.log(`  account data as of ${when.toLocaleString()} (${asOf.source}),`
    + ` ${formatAge(Math.round((Date.now() - when) / 60000))} ago`);
  for (const w of freshnessWarnings(snapshot)) console.warn(`  warning: ${w}`);
  const missing = Object.keys(DOCUMENTS).filter((n) => !snapshot.documents[n]);
  if (missing.length) console.log(`  not in Gestal's folder, so not captured: ${missing.join(", ")}`);
  if (!args.out) console.log(`next:  node oracle/analytics/analyze.mjs   # regenerates out/${date}-report.{md,json}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
