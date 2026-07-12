// Diff two snapshot reports (out/<date>-report.json). With no args, compares the two newest.
//   node oracle/analytics/compare.mjs [olderReport.json] [newerReport.json]
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SLOT_NAMES, ARTIFACT_SET_NAMES, FACTION_NAMES, lookupName } from "@rslh/core";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

function pickReports() {
  if (process.argv[2] && process.argv[3]) return [process.argv[2], process.argv[3]];
  const dir = here("./out");
  const files = readdirSync(dir).filter((f) => /-report\.json$/.test(f)).sort();
  if (files.length < 2) { console.error("need two out/*-report.json files; run analyze on two snapshots"); process.exit(1); }
  return [`${dir}/${files[files.length - 2]}`, `${dir}/${files[files.length - 1]}`];
}

const [oldPath, newPath] = pickReports();
const A = JSON.parse(readFileSync(oldPath, "utf8")); // older (lexically-earlier date)
const B = JSON.parse(readFileSync(newPath, "utf8")); // newer

const slotName = (id) => lookupName(ARTIFACT_SLOT_NAMES, id);
const setName = (id) => (id === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, id));
const facName = (id) => lookupName(FACTION_NAMES, id);
const label = (v) => `#${v.id} ${slotName(v.slot)} ${setName(v.set)}${v.faction ? "/" + facName(v.faction) : ""}`;
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const delta = (lbl, a, b) => `  ${lbl.padEnd(13)} ${String(a).padStart(5)} → ${String(b).padStart(5)}  (${sign(b - a)})`;
const topGroups = (arr, keyFn, n = 12) => {
  const m = new Map();
  for (const v of arr) { const k = keyFn(v); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n);
};

const aMap = new Map(A.verdicts.map((v) => [v.id, v]));
const bMap = new Map(B.verdicts.map((v) => [v.id, v]));
const acquired = B.verdicts.filter((v) => !aMap.has(v.id));
const removed = A.verdicts.filter((v) => !bMap.has(v.id));
const both = B.verdicts.filter((v) => aMap.has(v.id));

const k2d = [], d2k = [], leveled = [], scoreUp = [], scoreDn = [];
for (const v of both) {
  const a = aMap.get(v.id);
  if (a.verdict !== v.verdict) (v.verdict === "delete" ? k2d : d2k).push(v);
  if (v.level > a.level) leveled.push({ v, from: a.level, to: v.level });
  if (v.score > a.score) scoreUp.push({ v, from: a.score, to: v.score });
  if (v.score < a.score) scoreDn.push({ v, from: a.score, to: v.score });
}
// Focus/upgrade membership changes across the FULL lists (catches sold + newly-acquired picks).
function listDiff(flag) {
  const inA = new Set(A.verdicts.filter((v) => v[flag]).map((v) => v.id));
  const inB = new Set(B.verdicts.filter((v) => v[flag]).map((v) => v.id));
  return {
    entered: B.verdicts.filter((v) => v[flag] && !inA.has(v.id)),
    left: A.verdicts.filter((v) => v[flag] && !inB.has(v.id)),
  };
}
const fDiff = listDiff("focus"), uDiff = listDiff("upgrade");

const L = [];
const P = (...x) => L.push(...x);
P(`# Snapshot comparison: ${A.snapshotDate} → ${B.snapshotDate}`, ``);

P(`## Roster`);
P(`  decoded       ${A.total - A.corrupt.length} → ${B.total - B.corrupt.length}  (${sign((B.total - B.corrupt.length) - (A.total - A.corrupt.length))})   [rows ${A.total}/${A.corrupt.length} corrupt → ${B.total}/${B.corrupt.length} corrupt]`);
P(`  acquired      ${acquired.length} new   ·   removed/sold ${removed.length}   ·   net ${sign(acquired.length - removed.length)}`, ``);

P(`## Census`);
P(delta("equipped", A.census.equipped, B.census.equipped));
P(delta("ascended", A.census.ascended, B.census.ascended));
P(delta("glyphed", A.census.glyphed, B.census.glyphed));
P(delta("accessories", A.census.accessories, B.census.accessories));
P(delta("setless", A.census.setless, B.census.setless), ``);

P(`## Recommendations`);
P(delta("delete", A.summary.delete, B.summary.delete) + `   [acc ${A.summary.deleteAccessories}→${B.summary.deleteAccessories}, artifacts ${A.summary.deleteArtifacts ?? A.summary.deleteArmor}→${B.summary.deleteArtifacts ?? B.summary.deleteArmor}]`);
P(delta("· junk", A.summary.junk, B.summary.junk) + `   · slot-balance ${A.summary.slotBalance}→${B.summary.slotBalance}`);
P(delta("focus", A.summary.focus, B.summary.focus));
P(delta("upgrade", A.summary.upgrades, B.summary.upgrades), ``);

P(`## What you acquired (${acquired.length}) — by slot × set`);
for (const [k, n] of topGroups(acquired, (v) => `${slotName(v.slot)} · ${setName(v.set)}`)) P(`  ${k}: ${n}`);
P(``, `## What left / was sold (${removed.length}) — by slot × set`);
for (const [k, n] of topGroups(removed, (v) => `${slotName(v.slot)} · ${setName(v.set)}`)) P(`  ${k}: ${n}`);
P(``);

P(`## Churn`);
P(`  keep → delete: ${k2d.length}   ·   delete → keep: ${d2k.length}   (items in both)`);
P(`  focus:  +${fDiff.entered.length} entered / -${fDiff.left.length} left      upgrade:  +${uDiff.entered.length} entered / -${uDiff.left.length} left`);
P(`  leveled up: ${leveled.length}   ·   quality changed: ${scoreUp.length} up / ${scoreDn.length} down`, ``);

const tag = (v) => (!aMap.has(v.id) ? " [new]" : !bMap.has(v.id) ? " [sold]" : "");
if (fDiff.entered.length || fDiff.left.length) {
  P(`### Focus list changes`);
  for (const v of fDiff.entered) P(`  + ${label(v)} q${v.score} (${v.role})${tag(v)}`);
  for (const v of fDiff.left) P(`  - ${label(v)} q${v.score} (${v.role})${tag(v)}`);
  P(``);
}
if (uDiff.entered.length || uDiff.left.length) {
  P(`### Upgrade list changes`);
  for (const v of uDiff.entered) P(`  + ${label(v)} lvl${v.level} q${v.score}→${v.potential} (${v.role})${tag(v)}`);
  for (const v of uDiff.left) P(`  - ${label(v)} lvl${v.level} q${v.score} (${v.role})${tag(v)}`);
  P(``);
}
if (leveled.length) {
  P(`### Leveled up (top 12 by quality gain)`);
  for (const { v, from, to } of leveled.sort((x, y) => (y.v.score - aMap.get(y.v.id).score) - (x.v.score - aMap.get(x.v.id).score)).slice(0, 12)) {
    P(`  ${label(v)}  +${from}→+${to}  q${aMap.get(v.id).score}→${v.score}`);
  }
  P(``);
}
const swings = [...scoreUp.map((s) => ({ ...s, d: s.to - s.from })), ...scoreDn.map((s) => ({ ...s, d: s.to - s.from }))]
  .sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 10);
if (swings.length) {
  P(`### Biggest quality swings (top 10)`);
  for (const { v, from, to } of swings) P(`  ${label(v)}  q${from}→${to} (${sign(to - from)})`);
}

console.log(L.join("\n"));
