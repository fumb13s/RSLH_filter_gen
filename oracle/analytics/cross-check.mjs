// Cross-check an RSL Helper snapshot against a Gestal one, record by record: does gestal.mjs decode
// every piece and champion exactly as decode.mjs / champs.mjs do? Run it whenever both sources exist —
// it is the evidence behind gestal.mjs's mappings, re-checkable against any new pair.
//
//   node --experimental-sqlite oracle/analytics/cross-check.mjs <snapshot.db> <snapshot.json.gz>
//
// The two snapshots are rarely from the same moment, so a difference is only a finding when nothing
// that happened in between explains it. Explained differences are counted by cause — leveled, reworked
// (Gestal flags it), glyphs and ascension changed, champion progressed, name spelled differently.
// Anything else is UNEXPLAINED, printed in full, and makes the exit code 1. Advisory and read-only.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "./decode.mjs";
import { readAllChampRows } from "./champs.mjs";
import { isGestalPath, readGestalSnapshot } from "./gestal.mjs";

const IDENTITY = ["slot", "set", "rank", "rarity"];
const sameStat = (a, b) => a.statId === b.statId && a.isFlat === b.isFlat;

// Compare two decodes of the same piece. Returns { cause } for an explained difference, { unexplained }
// for anything else, or null when they agree.
export function comparePiece(r, g, reworked) {
  const bad = IDENTITY.filter((k) => r[k] !== g[k]);
  if (r.isAccessory && r.faction !== g.faction) bad.push("faction");
  if (bad.length) return { unexplained: `identity differs: ${bad.map((k) => `${k} ${r[k]} vs ${g[k]}`).join(", ")}` };
  if (r.level !== g.level) return { cause: "leveled" };
  const subsDiffer = r.substats.length !== g.substats.length
    || r.substats.some((s) => {
      const t = g.substats.find((q) => sameStat(q, s));
      return !t || t.value !== s.value || t.rolls !== s.rolls;
    });
  const mainDiffers = !sameStat(r.mainStat, g.mainStat) || r.mainStat.value !== g.mainStat.value;
  if (mainDiffers || subsDiffer) {
    if (reworked) return { cause: "reworked" };
    return { unexplained: `stats differ: main ${JSON.stringify(r.mainStat)} vs ${JSON.stringify(g.mainStat)};`
      + ` subs ${JSON.stringify(r.substats)} vs ${JSON.stringify(g.substats)}` };
  }
  const glyphs = r.substats.some((s) => g.substats.find((q) => sameStat(q, s)).glyph !== s.glyph);
  const asc = r.ascLevel !== g.ascLevel
    || JSON.stringify(r.ascStat) !== JSON.stringify(g.ascStat);
  if (glyphs && asc) return { cause: "glyphs and ascension changed" };
  if (glyphs) return { cause: "glyphs changed" };
  if (asc) return { cause: "ascension changed" };
  return null;
}

// Same for a champion row. Role, rarity, faction and base type never change for one copy; stars,
// level, empower, type (it moves with ascension) and blessing do.
export function compareChamp(r, g) {
  const fixed = ["Role", "Rarity", "Fraction"];
  if (r.BaseHeroID != null) fixed.push("BaseHeroID");
  const bad = fixed.filter((k) => r[k] !== g[k]);
  if (bad.length) return { unexplained: `${bad.map((k) => `${k} ${r[k]} vs ${g[k]}`).join(", ")}` };
  const progressed = ["Rang", "Lvl", "EmpLvl", "HeroID", "BId"].some((k) => r[k] != null && r[k] !== g[k]);
  if (progressed) return { cause: "progressed" };
  if (r.Name !== g.Name) return { cause: "name spelled differently" };
  return null;
}

export function crossCheck(dbPath, gzPath) {
  const reworked = new Set(readGestalSnapshot(gzPath).documents.artifacts.payload.artifacts
    .filter((a) => a.isReworked).map((a) => a.id));
  const r = readArtifacts(dbPath).items, g = readArtifacts(gzPath).items;
  const rc = readAllChampRows(dbPath), gc = readAllChampRows(gzPath);
  const tally = (pairs, compare) => {
    const out = { common: 0, agree: 0, causes: new Map(), unexplained: [] };
    for (const [id, a, b] of pairs) {
      out.common++;
      const d = compare(a, b, id);
      if (!d) out.agree++;
      else if (d.cause) out.causes.set(d.cause, (out.causes.get(d.cause) ?? 0) + 1);
      else out.unexplained.push(`${id}: ${d.unexplained}`);
    }
    return out;
  };
  const gById = new Map(g.map((x) => [x.id, x]));
  const pieces = tally(r.filter((x) => gById.has(x.id)).map((x) => [x.id, x, gById.get(x.id)]),
    (a, b, id) => comparePiece(a, b, reworked.has(id)));
  const gcById = new Map(gc.map((x) => [x.ID, x]));
  const champs = tally(rc.filter((x) => gcById.has(x.ID)).map((x) => [x.ID, x, gcById.get(x.ID)]),
    (a, b) => compareChamp(a, b));
  return { pieces, champs, counts: { r: r.length, g: g.length, rc: rc.length, gc: gc.length } };
}

function report(label, t) {
  console.log(`${label}: ${t.common} in both — ${t.agree} identical`);
  for (const [cause, n] of [...t.causes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${cause}`);
  console.log(`  ${String(t.unexplained.length).padStart(6)}  UNEXPLAINED`);
  for (const line of t.unexplained.slice(0, 20)) console.log(`          ${line}`);
  if (t.unexplained.length > 20) console.log(`          … ${t.unexplained.length - 20} more`);
}

function main() {
  const [a, b, extra] = process.argv.slice(2);
  const pair = [a, b];
  const dbPath = pair.find((p) => p && !isGestalPath(p));
  const gzPath = pair.find((p) => isGestalPath(p));
  if (extra !== undefined || !dbPath || !gzPath) {
    console.error("usage: cross-check.mjs <snapshot.db> <snapshot.json.gz>");
    process.exit(1);
  }
  const res = crossCheck(dbPath, gzPath);
  const { counts } = res;
  console.log(`# Cross-check — ${dbPath.split(/[\\/]/).pop()} vs ${gzPath.split(/[\\/]/).pop()}`);
  console.log(`pieces ${counts.r} vs ${counts.g}; champions ${counts.rc} vs ${counts.gc}\n`);
  report("pieces", res.pieces);
  report("champions", res.champs);
  if (res.pieces.unexplained.length || res.champs.unexplained.length) process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
