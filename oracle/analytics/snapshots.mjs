// Where snapshots live and which one a tool reads by default — one place for the rule every CLI
// used to re-implement as "the newest *-RSLHelper.db". Two kinds sit side by side in resources/:
//   <date>-RSLHelper.db      refresh.sh's copy of RSL Helper's vault DB (Windows)
//   <date>-Gestal.json.gz    refresh-gestal.mjs's capture of Gestal Desktop's documents (macOS)
// decode.mjs and champs.mjs read either; this module only finds them.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isGestalPath } from "./gestal.mjs";

export const RESOURCES = fileURLToPath(new URL("../resources", import.meta.url));

// Default-discovery names. Kept baselines (restore.mjs's *-pre-driver, gear-moves.mjs's pairs) are
// named outside these patterns on purpose, so a routine capture never shadows one.
const KINDS = [
  { re: /-Gestal\.json\.gz$/, rank: 1 },   // on a same-date tie Gestal wins: its wearer data is current
  { re: /-RSLHelper\.db$/, rank: 0 },
];

// An argument that names a snapshot rather than a champion or a number: a known extension, or any
// path. Shared by every CLI that takes a snapshot alongside other positional arguments.
export function isSnapshotArg(a) {
  return typeof a === "string" && (a.endsWith(".db") || isGestalPath(a) || a.includes("/") || a.includes("\\"));
}

// The account-snapshot date a report is keyed on (NOT today's date): the YYYY-MM-DD filename prefix,
// falling back to the file's last-write day.
export function snapshotDate(p) {
  const m = (p.split(/[\\/]/).pop() || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : statSync(p).mtime.toISOString().slice(0, 10);
}

// Newest default-named snapshot in `dir` across both kinds, or null. Ordered by the date prefix, then
// by kind, then by name, so the choice never depends on directory listing order. Names compare by code
// unit, as the plain .sort() every tool used before did — localeCompare would reorder punctuation and
// case, and pick a different file between two of the same date and kind.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function newestSnapshot(dir = RESOURCES) {
  const ranked = readdirSync(dir)
    .map((f) => ({ f, kind: KINDS.find((k) => k.re.test(f)) }))
    .filter((x) => x.kind)
    .map(({ f, kind }) => ({ f, date: (f.match(/^(\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? "", rank: kind.rank }))
    .sort((a, b) => byCodeUnit(a.date, b.date) || a.rank - b.rank || byCodeUnit(a.f, b.f));
  return ranked.length ? join(dir, ranked[ranked.length - 1].f) : null;
}

// CLI helper: the explicit argument, else the newest snapshot, else a message naming both capture
// scripts and exit 1 — the behaviour each tool had inline.
export function resolveSnapshot(arg, dir = RESOURCES) {
  if (arg) return arg;
  const found = newestSnapshot(dir);
  if (found) return found;
  console.error(`no snapshot found in ${dir}; run oracle/analytics/refresh.sh (RSL Helper)`
    + " or oracle/analytics/refresh-gestal.mjs (Gestal)");
  process.exit(1);
}
