// Differential oracle probe (headless, no browser).
// Decode known-gear.db -> feed the SAME gear + SAME .hsf to BOTH Sellfile
// Creator's eval worker (Rust/WASM) and our evaluateFilter(), then diff verdicts.
// Lives in the gitignored _deobf/ because it depends on the third-party worker+wasm.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { evaluateFilter, generateFilter, defaultRule, emptySubstat }
  from "../../packages/core/dist/index.js";

const here = (p) => new URL(p, import.meta.url);
const N = (v) => (v == null ? 0 : Number(v)); // node:sqlite hands back BigInt

// ---- decode tables (from SFC's OwA decoder; confirmed against our RE) ----
const POW32 = 2 ** 32;
const DBSTAT_TO_OURSTAT = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 5, 8: 6 };
const PCT_ALWAYS = new Set([7, 8]);          // DB CR, CDMG -> always *100
const PCT_WHEN_PCT = new Set([1, 2, 3]);     // DB HP/ATK/DEF -> *100 only when not flat
// accset -> faction (UwA): identity except 13->4 (Barbarians dup)
const UwA = { 0: 0, 13: 4 };

function decodeValue(dbStatId, isFlat, rawBase) {
  const raw = N(rawBase);
  if (raw === 0) return 0;
  let v = raw / POW32;
  const pct = PCT_ALWAYS.has(dbStatId) || (!isFlat && PCT_WHEN_PCT.has(dbStatId));
  if (pct) return Math.round(v * 100 * 100) / 100;          // *100 then 2dp
  if (dbStatId >= 1 && dbStatId <= 6) return Math.round(v);   // flat stats -> int
  return Math.round(v * 1000) / 1000;
}
const variantOf = (dbStatId, isFlat) => (dbStatId << 8) | (isFlat ? 1 : 0);

const SUB = [1, 2, 3, 4].map((i) => ({
  id: `s${i}id`, fl: `s${i}fl`, lvl: `s${i}lvl`, base: `s${i}lvlid`,
}));

// ---- read + decode the gear ----
const db = new DatabaseSync(here("../known-gear.db").pathname);
const rows = db.prepare(
  `SELECT ID,type,rank,rarity,lvl,mid,mfl,mlvlid,${SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base]).join(",")},aset,accset
   FROM Artifacts ORDER BY ID`,
).all();

const mkStat = (source, dbId, isFlat, value) => ({
  source, statId: dbId, isFlat, variant: variantOf(dbId, isFlat),
  baseValue: value, glyphValue: 0, mythValue: 0, totalValue: value,
});

const items = rows.map((row) => {
  const id = N(row.ID), slot = N(row.type), set = N(row.aset), rank = N(row.rank),
    rarity = N(row.rarity), level = N(row.lvl), accset = N(row.accset);
  const mainDb = N(row.mid), mainFlat = N(row.mfl) !== 0, mainVal = decodeValue(mainDb, mainFlat, row.mlvlid);
  const phys = SUB.map((s) => {
    const dbId = N(row[s.id]);
    if (dbId <= 0) return null;
    const isFlat = N(row[s.fl]) !== 0;
    return { dbId, isFlat, rolls: N(row[s.lvl]) || 1, value: decodeValue(dbId, isFlat, row[s.base]) };
  }).filter(Boolean);

  // our Item shape (stat ids mapped DB->ours; rarity as 0-5 index)
  const ours = {
    set, slot, rank, rarity: rarity - 1, mainStat: DBSTAT_TO_OURSTAT[mainDb] ?? mainDb, level, faction: accset,
    substats: phys.map((p) => ({ statId: DBSTAT_TO_OURSTAT[p.dbId] ?? p.dbId, isFlat: p.isFlat, rolls: p.rolls, value: p.value })),
  };

  // SFC artifact shape (full OwA output, incl. gearInspectorItem that mt() serializes)
  const Q = mkStat("main", mainDb, mainFlat, mainVal);
  const subs = phys.map((p, i) => ({ ...mkStat("substat", p.dbId, p.isFlat, p.value), rolls: p.rolls, position: i }));
  const subValues = {};
  for (const s of subs) {
    const v = s.baseValue + s.mythValue;
    if (s.variant === -1 || Math.abs(v) <= 0) continue;
    subValues[s.variant] = (subValues[s.variant] || 0) + v;
  }
  const faction = UwA[accset] ?? accset;
  const previewExtras = { id, source: "artifacts", rerollCount: 0, equippedChampion: null, mainStat: Q, substats: subs, ascension: null, exactLevel: level, lastUseLocalTimestamp: null, isLocked: false };
  const gii = { slot, set, rank, rarity, level, faction, main: Q.variant, subValues, previewExtras };
  const sfc = { id, slot, set, rank, rarity, level, exactLevel: level, faction, mainStat: Q, substats: subs, ascension: null, gearInspectorItem: gii, rerollCount: 0, equippedChampion: null, source: "artifacts", lastUseLocalTimestamp: null, isLocked: false };

  return { id, slot, ours, sfc };
});
console.log(`decoded ${items.length} artifacts`);

// ---- boot SFC eval worker (plain Node, self-shim) ----
const outbox = [];
globalThis.self = {
  name: "", location: { href: "file:///sfc/worker-eval.js" }, onmessage: null,
  postMessage: (m) => outbox.push(m), addEventListener() {}, removeEventListener() {}, close() {},
};
(0, eval)(readFileSync(here("./gen/worker-eval.full.js"), "utf8"));
const wasm = new WebAssembly.Module(readFileSync(here("./gen/wasm-0-1620221.wasm")));
await self.onmessage({ data: { kind: "init-wasm", wasmModule: wasm } });

let GEN = 0;
async function runSfc(rules, artifacts) {
  const id = ++GEN;
  const payload = {
    hsf: { Rules: rules }, recipes: [], metasets: [], substatTargets: [],
    safeguards: { enabled: false, rules: [], detection: null },
    artifacts, generation: id, emitProgressEvents: false,
  };
  const done = new Promise((res) => {
    const t = setInterval(() => {
      const m = outbox.find((x) => x && x.kind === "pipeline:done" && x.id === id);
      if (m) { clearInterval(t); res(m.payload); }
    }, 4);
    setTimeout(() => { clearInterval(t); res(null); }, 4000);
  });
  await self.onmessage({ data: { id, kind: "pipeline", payload } });
  const p = await done;
  if (!p) {
    console.log("  OUTBOX after pipeline:", JSON.stringify(
      outbox.map((m) => ({ kind: m?.kind, id: m?.id, err: m?.payload?.message ?? m?.payload?.error ?? m?.error })),
    ));
    throw new Error("SFC pipeline timeout");
  }
  const byId = new Map((p.matches || []).map((m) => [m.itemId, m]));
  return (id) => {
    const fm = byId.get(id)?.firstNonExcludedMatch;
    if (!fm) return "keep";                 // no rule matched -> keep ("none")
    if (fm.keep === false) return "sell";
    return "keep";                          // keep:true (or safeguards) -> keep
  };
}

// ---- test filters: one dimension each ----
const r = (o) => defaultRule({ Substats: [emptySubstat(), emptySubstat(), emptySubstat(), emptySubstat()], ...o });
const sub = (o) => ({ ...emptySubstat(), ...o });
const FILTERS = [
  { name: "slot: sell Boots(4)", rules: [r({ ArtifactType: [4], Keep: false })] },
  { name: "rank: sell Rank>=6", rules: [r({ Rank: 6, Keep: false })] },
  { name: "rarity: sell Legendary+(16)", rules: [r({ Rarity: 16, Keep: false })] },
  { name: "main: keep SPD(4) else sell", rules: [r({ MainStatID: 4, Keep: true }), r({ Keep: false })] },
  { name: "sub: keep SPD>=10 else sell", rules: [r({ Substats: [sub({ ID: 4, IsFlat: false, Value: 10 }), emptySubstat(), emptySubstat(), emptySubstat()], Keep: true }), r({ Keep: false })] },
];

let firstShapeLogged = false;
for (const f of FILTERS) {
  const filter = generateFilter(f.rules);
  const verdictSfc = await runSfc(filter.Rules, items.map((it) => it.sfc));
  if (!firstShapeLogged) {
    const sample = outbox.find((x) => x && x.kind === "pipeline:done");
    console.log("  (sample match obj:", JSON.stringify((sample?.payload?.matches || [])[0]) ?? "none", ")");
    firstShapeLogged = true;
  }
  let agree = 0; const diffs = [];
  for (const it of items) {
    const ours = evaluateFilter(filter, it.ours);
    const sfc = verdictSfc(it.id);
    if (ours === sfc) agree++;
    else diffs.push(`#${it.id}(slot${it.slot}) ours=${ours} sfc=${sfc}`);
  }
  const tag = diffs.length === 0 ? "✅" : "⚠️ ";
  console.log(`${tag} ${f.name}: ${agree}/${items.length} agree` + (diffs.length ? `\n     ${diffs.join("\n     ")}` : ""));
}
