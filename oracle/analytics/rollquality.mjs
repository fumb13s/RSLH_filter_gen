// Roll-quality metric + rating correlation.
//
// Standalone:  node oracle/analytics/rollquality.mjs [snapshot.db]   # newest resources/ snapshot if omitted
// Also imported by analyze.mjs for the report's per-item good-roll column + correlation section.
//
// "Good substats" = the filter generator's presets, per the item's best-matching role.
// Roll-events per substat = initial placement + upgrades = rolls + 1 (the generator's
// convention; the DB stores upgrades 0-based). We then correlate the q-score against the
// good-roll COUNT and FRACTION to see how the rating tracks rolls-in-good-substats.

import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { quality } from "./score.mjs";

// --- Good-substat definition (slot-aware) ----------------------------------
// [statId, isFlat] in OUR stat ids (1 HP, 2 ATK, 3 DEF, 4 SPD, 5 C.RATE, 6 C.DMG, 7 RES, 8 ACC).
//
// Artifacts (slots 1-6): the filter generator's SUBSTAT_PRESETS per role (packages/web/src/generator.ts;
// duplicated here since the web package isn't cleanly importable — keep in sync).
const ARTIFACT_GOOD = {
  "ATK-DPS": [[2, false], [4, true], [5, false], [6, false]],           // ATK Nuker: ATK%, SPD, C.RATE, C.DMG
  "DEF-DPS": [[3, false], [4, true], [5, false], [6, false]],           // DEF Nuker: DEF%, SPD, C.RATE, C.DMG
  "HP-DPS":  [[1, false], [4, true], [5, false], [6, false]],           // HP Nuker:  HP%,  SPD, C.RATE, C.DMG
  "Support": [[1, false], [3, false], [4, true], [7, true], [8, true]], // Support:   HP%, DEF%, SPD, RES, ACC
};

// Accessories (7 Ring, 8 Amulet, 9 Banner) roll from restricted, distinct pools (core SLOT_STATS),
// so they get their own good-substat lists rather than the artifact presets:
//   Ring   rolls HP/ATK/DEF (flat + %) only          -> the role's % only
//   Amulet rolls flat HP/ATK/DEF, C.DMG, ACC, RES     -> DPS: C.DMG + ACC; Support: ACC/RES/flat HP/DEF
//   Banner rolls HP/ATK/DEF (flat + %), SPD           -> the role's % + SPD
// The amulet lists are a deliberate per-role choice (a DPS amulet's value is its C.DMG main + ACC; a
// Support amulet wants ACC/RES/flat bulk). NB the metric does not model the MAIN stat — q's main
// component covers that; a roll metric is substats-only by construction.
const ACCESSORY_GOOD = {
  7: { // Ring
    "ATK-DPS": [[2, false]],                          // ATK%
    "DEF-DPS": [[3, false]],                          // DEF%
    "HP-DPS":  [[1, false]],                          // HP%
    "Support": [[1, false], [3, false]],              // HP%, DEF%
  },
  8: { // Amulet
    "ATK-DPS": [[6, false], [8, true]],               // C.DMG, ACC
    "DEF-DPS": [[6, false], [8, true]],
    "HP-DPS":  [[6, false], [8, true]],
    "Support": [[8, true], [7, true], [1, true], [3, true]], // ACC, RES, flat HP, flat DEF
  },
  9: { // Banner
    "ATK-DPS": [[2, false], [4, true]],               // ATK%, SPD
    "DEF-DPS": [[3, false], [4, true]],               // DEF%, SPD
    "HP-DPS":  [[1, false], [4, true]],               // HP%, SPD
    "Support": [[1, false], [3, false], [4, true]],   // HP%, DEF%, SPD
  },
};

// Good-substat list for a slot+role: accessories (7-9) use their own pools, artifacts use the presets.
export function goodSubsFor(slot, role) {
  return (slot >= 7 ? ACCESSORY_GOOD[slot]?.[role] : ARTIFACT_GOOD[role]) ?? [];
}

export function isGoodSub(slot, role, statId, isFlat) {
  return goodSubsFor(slot, role).some(([s, f]) => s === statId && f === isFlat);
}

// Roll-events in good substats vs total. A present substat = 1 (initial) + its upgrades;
// the DB stores upgrades 0-based, so events = rolls + 1.
export function rollStats(item, role) {
  let good = 0, total = 0;
  for (const s of item.substats) {
    const events = (s.rolls ?? 0) + 1;
    total += events;
    if (isGoodSub(item.slot, role, s.statId, s.isFlat)) good += events;
  }
  return { good, total, frac: total ? good / total : 0 };
}

// --- Correlation -----------------------------------------------------------
export function pearson(xs, ys) {
  const n = xs.length;
  if (n === 0) return NaN;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const cov = n * sxy - sx * sy;
  const dx = Math.sqrt(n * sxx - sx * sx);
  const dy = Math.sqrt(n * syy - sy * sy);
  return dx === 0 || dy === 0 ? NaN : cov / (dx * dy);
}

// Fractional (average) ranks, 1-based; ties share the mean of their positions.
export function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs, ys) {
  return pearson(ranks(xs), ranks(ys));
}

// --- Aggregation (pure) ----------------------------------------------------
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// rows = [{score, role, isAccessory, level, good, total, frac}]. Per-segment correlations of
// the q-score against good-roll count and fraction.
export function segmentStats(rows, pred) {
  const seg = rows.filter(pred);
  const q = seg.map((r) => r.score), g = seg.map((r) => r.good), fr = seg.map((r) => r.frac);
  return { n: seg.length, rCount: pearson(q, g), rhoCount: spearman(q, g), rFrac: pearson(q, fr), rhoFrac: spearman(q, fr) };
}

// q distribution bucketed by good-roll count (empty buckets skipped).
export function bucketStats(rows) {
  const max = rows.reduce((m, r) => Math.max(m, r.good), 0);
  const out = [];
  for (let g = 0; g <= max; g++) {
    const seg = rows.filter((r) => r.good === g);
    if (!seg.length) continue;
    const qs = seg.map((r) => r.score);
    out.push({ good: g, n: seg.length, meanQ: mean(qs), medianQ: median(qs) });
  }
  return out;
}

// --- Markdown section (shared by the runner and analyze.mjs) ---------------
const fmtR = (r) => (Number.isNaN(r) ? "  n/a" : (r >= 0 ? " " : "") + r.toFixed(3));
const SEGMENTS = [
  ["overall", () => true],
  ["artifacts", (r) => !r.isAccessory],
  ["accessories", (r) => r.isAccessory],
  ["level 16", (r) => r.level === 16],
  ["ATK-DPS", (r) => r.role === "ATK-DPS"],
  ["DEF-DPS", (r) => r.role === "DEF-DPS"],
  ["HP-DPS", (r) => r.role === "HP-DPS"],
  ["Support", (r) => r.role === "Support"],
];

// rows = [{score, role, isAccessory, level, good, total, frac}] (total>0). Returns markdown lines
// (a correlation table over SEGMENTS + a q-by-good-roll-count bucket table). No leading heading.
export function rollQualityMarkdown(rows) {
  const L = [];
  L.push(`q-score vs good-roll COUNT and FRACTION (good/total). r = Pearson, ρ = Spearman.`, ``);
  L.push(`| segment | n | r(q,count) | ρ(q,count) | r(q,frac) | ρ(q,frac) |`, `|---|--:|--:|--:|--:|--:|`);
  for (const [label, f] of SEGMENTS) {
    const s = segmentStats(rows, f);
    L.push(`| ${label} | ${s.n} | ${fmtR(s.rCount)} | ${fmtR(s.rhoCount)} | ${fmtR(s.rFrac)} | ${fmtR(s.rhoFrac)} |`);
  }
  L.push(``, `**q by good-roll count:**`, ``);
  L.push(`| good rolls | items | mean q | median q |`, `|--:|--:|--:|--:|`);
  for (const b of bucketStats(rows)) L.push(`| ${b.good} | ${b.n} | ${b.meanQ.toFixed(1)} | ${b.medianQ.toFixed(1)} |`);
  return L;
}

// Build correlation rows straight from decoded items (each judged at its best-matching role).
export function rollQualityRows(items) {
  return items.map((it) => {
    const q = quality(it);
    return { score: q.score, role: q.role, isAccessory: it.isAccessory, level: it.level, ...rollStats(it, q.role) };
  });
}

// --- Runner ----------------------------------------------------------------
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

function resolveDb() {
  if (process.argv[2]) return process.argv[2];
  const dir = here("../resources");
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no resources/*-RSLHelper.db snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}
function snapshotDate(p) {
  const m = (p.split(/[\\/]/).pop() || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : statSync(p).mtime.toISOString().slice(0, 10);
}

function main() {
  const dbPath = resolveDb();
  const date = snapshotDate(dbPath);
  const { items, total, corrupt } = readArtifacts(dbPath);
  const rows = rollQualityRows(items);
  const scored = rows.filter((r) => r.total > 0); // need >=1 substat to have a fraction

  const L = [`# Roll-quality vs rating — ${date}`, ``];
  L.push(`${scored.length} items (of ${total} rows; ${corrupt.length} corrupt, ${rows.length - scored.length} subless skipped).`);
  L.push(`Good substats are slot-aware (artifacts = generator presets; accessories use their own restricted pools); roll-events = initial + upgrades (rolls+1).`, ``);
  L.push(...rollQualityMarkdown(scored));
  console.log(L.join("\n"));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
