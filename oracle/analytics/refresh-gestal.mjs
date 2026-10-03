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
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { DOCUMENTS, FORMAT, FORMAT_VERSION, checkDocument, checkSnapshot, gestalChampRows,
  gestalItems, isGestalPath, unlistedWearers } from "./gestal.mjs";
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
  // The extension is load-bearing twice over: the readers recognise a Gestal snapshot by it, and it is
  // what .gitignore denies repo-wide. A file named otherwise is unreadable to every tool AND committable.
  if (out.out !== null && !isGestalPath(out.out)) {
    throw new Error(`--out must end in .json.gz (got "${out.out}"): the tools recognise a Gestal snapshot`
      + " by that extension, and .gitignore keeps *.json.gz — personal account data — out of the repo");
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

const isTime = (s) => typeof s === "string" && Number.isFinite(Date.parse(s));

// When the account data was last known to be current. A document's own extractedAt is when it last
// CHANGED — Gestal rewrites a document only when its content changes — so the last successful
// extraction is the better clock. When there is none (never, or the last attempt failed), the newest
// of the gear and roster documents' extractedAt is the latest moment the data is known to hold; it can
// be days old if nothing changed since, which destination() guards against. No usable timestamp at
// all throws, rather than naming a file "NaN-NaN-NaN".
export function dataAsOf(snapshot) {
  const last = snapshot.documents["last-extraction"]?.payload;
  if (last?.succeeded && isTime(last.attemptedAt)) return { at: last.attemptedAt, source: "last extraction" };
  const newest = [snapshot.documents.artifacts, snapshot.documents.champions]
    .map((d) => d?.payload?.extractedAt).filter(isTime)
    .reduce((a, b) => (a === null || Date.parse(b) > Date.parse(a) ? b : a), null);
  if (newest === null) throw new Error("neither the gear nor the roster document carries a usable extractedAt — cannot date this capture");
  return { at: newest, source: "newest document" };
}

// Where the snapshot goes, and whether writing there is safe. A date from the last successful
// extraction is the account's state as of now, so writing over a capture of the same date is the normal
// re-capture. A date from the documents themselves (the last read failed) can be days old — when
// nothing changed since — and replacing a genuine capture of that day with this one would give newer
// data an old label, where the original can never be taken again. So an existing file is kept then,
// unless --out named the destination explicitly.
export function destination(snapshot, out = null, dir = RESOURCES, exists = existsSync) {
  const asOf = dataAsOf(snapshot);
  const date = localDate(asOf.at);
  const dest = out ?? join(dir, `${date}-Gestal.json.gz`);
  const refusal = out === null && asOf.source !== "last extraction" && exists(dest)
    ? `Gestal's last read of the game did not succeed, so this capture can only be dated by its`
      + ` documents (${date}) — and ${dest} already exists. Not overwriting it: capture again after a`
      + " successful read, or pass --out PATH to keep both."
    : null;
  return { dest, date, asOf, refusal };
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

// Strings that identify the account, to be scrubbed from the captured documents: the folder's key and
// — read here only for that, never stored — the Raid player id from metadata.json. The display name is
// deliberately not on the list: it is free text that can equal a champion's name or an ordinary word,
// and scrubbing it would corrupt real data. Anything shorter than 8 characters is skipped for the same
// reason.
function identifiers(accountDir) {
  const ids = [basename(accountDir)];
  try {
    const id = JSON.parse(readFileSync(join(accountDir, "metadata.json"), "utf8"))?.payload?.raidPlayerId;
    if (id != null) ids.push(String(id));
  } catch {
    // no readable metadata: the key alone
  }
  return ids.filter((s) => s.length >= 8);
}

// Replace every occurrence of an identifier inside string keys and values. Numbers are left alone: a
// stat or an id that happens to contain a player id's digits is data, not the id. The documents are
// kept verbatim otherwise; this exists for the one known way an identifier could slip in, a path in an
// error message (last-extraction.json's errorMessage).
export function scrub(value, ids, count = { n: 0 }) {
  if (typeof value === "string") {
    let s = value;
    for (const id of ids) {
      if (s.includes(id)) { s = s.split(id).join("<redacted>"); count.n++; }
    }
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, ids, count));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrub(k, ids, count), scrub(v, ids, count)]));
  }
  return value;
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
  const redacted = { n: 0 };
  const snapshot = checkSnapshot({ format: FORMAT, formatVersion: FORMAT_VERSION,
    capturedAt: now.toISOString(), gestalVersion: version,
    documents: scrub(documents, identifiers(accountDir), redacted) });
  dataAsOf(snapshot);   // throws now, before anything is written, if the capture cannot be dated
  const items = gestalItems(snapshot);
  const champs = gestalChampRows(snapshot, items);
  return { snapshot, items: items.length, champions: champs.filter((c) => c.Name).length,
    unlisted: unlistedWearers(snapshot, items).length, redacted: redacted.n };
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
  let captured, target;
  try {
    captured = captureSnapshot(resolveAccount(dataRoot(), args.account));
    target = destination(captured.snapshot, args.out);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { snapshot, items, champions, unlisted, redacted } = captured;
  const { dest, date, asOf, refusal } = target;
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  writeSnapshot(dest, snapshot);

  const shown = relative(process.cwd(), dest);
  const when = new Date(asOf.at);
  console.log(`snapshot saved: ${shown.startsWith("..") ? dest : shown}  (${items} pieces, ${champions} champions)`);
  console.log(`  account data as of ${when.toLocaleString()} (${asOf.source}),`
    + ` ${formatAge(Math.round((Date.now() - when) / 60000))} ago`);
  for (const w of freshnessWarnings(snapshot)) console.warn(`  warning: ${w}`);
  if (unlisted) {
    console.log(`  note: ${unlisted} champion(s) wear gear but are not in the roster document yet — Gestal`
      + " reads the two on separate polls; their gear reads as worn by an unnamed champion");
  }
  if (redacted) console.log(`  note: scrubbed ${redacted} occurrence(s) of the account key or player id`);
  const missing = Object.keys(DOCUMENTS).filter((n) => !snapshot.documents[n]);
  if (missing.length) console.log(`  not in Gestal's folder, so not captured: ${missing.join(", ")}`);
  if (!args.out) console.log(`next:  node oracle/analytics/analyze.mjs   # regenerates out/${date}-report.{md,json}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
