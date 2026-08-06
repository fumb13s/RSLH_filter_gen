// Per-champion gear triage: rate each piece a champion is WEARING as KEEP / BORDERLINE / SELL.
//
// The vault report (analyze.mjs) can't answer this — its two delete passes (junkTrim, slotBalance)
// skip equipped items by construction, so worn gear always comes back "keep" on supply floors
// rather than merit. Here the call is driven by REPLACEABILITY: how many unequipped spares could
// actually take this piece's place and would finish better. Advisory only; nothing is ever deleted.
//
//   node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
//     name|ID     all digits -> exact Champs.ID; otherwise a case-insensitive Name substring.
//                 Omit for summary mode: one line per geared champion, most sellable first.
//     snapshot.db an arg ending in .db or containing a path separator (default: newest snapshot).

import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, FACTION_NAMES, lookupName } from "@rslh/core";
import { readArtifacts } from "./decode.mjs";
import { keepPremium, triage } from "./triage.mjs";
import { quality, qualityAtRole } from "./score.mjs";
import { rollStats } from "./rollquality.mjs";
import { ALL_ROLES } from "./sets.mjs";
import { CUTS } from "./weights.mjs";

// Champs.Role is the game's champion type and maps 1:1 onto the analytics archetypes. Verified
// against the 2026-07-12 snapshot: Role=1 champs are uniformly DEF-scaling, Role=2 top the HP
// medians, Role=3 bottom the crit medians. It's static champion data — bare level-1 copies already
// carry it, and 368 of 369 multi-copy names agree across copies (the one exception is a block of
// empty-Name placeholder rows, which hold no gear and are filtered out on read).
export const CHAMP_ROLE = { 0: "ATK-DPS", 1: "DEF-DPS", 2: "HP-DPS", 3: "Support" };
export const CHAMP_ROLE_LABEL = { 0: "Attack", 1: "Defense", 2: "HP", 3: "Support" };

// null for an unrecognised Role — suppresses the role-gap flag, leaves verdicts intact. Indexed
// raw, NOT via Number(): the column has no NOT NULL constraint, and Number(null) is 0, which would
// quietly grade a role-less champion as Attack instead of suppressing the flag.
export const champRole = (row) => CHAMP_ROLE[row?.Role] ?? null;

// The readable half of the same lookup, for the report header ("Attack (ATK-DPS)"). Indexed raw for
// the reason above: through Number() a null Role would read "Attack" while champRole beside it read
// unknown, and the header would contradict itself.
export const champLabel = (row) => CHAMP_ROLE_LABEL[row?.Role] ?? "?";

// p in [0,1], index-based (no interpolation) to match the analytics' existing percentile style.
export function quantile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) * p)];
}

// Could `candidate` (an unequipped spare) actually take `item`'s place on its champion?
//   same slot · same MAIN stat (a C.DMG glove isn't replaced by an HP glove; for Weapon/Helmet/
//   Shield the main is slot-fixed so this is a natural no-op) · same FACTION for accessories
//   (a hard game constraint) · on a set you'd actually build on.
export function inReplacementPool(candidate, item) {
  if (candidate.equippedChampId !== 0) return false;
  if (candidate.slot !== item.slot) return false;
  if (candidate.mainStat.statId !== item.mainStat.statId) return false;
  if (candidate.mainStat.isFlat !== item.mainStat.isFlat) return false;
  if (item.isAccessory && candidate.faction !== item.faction) return false;
  return keepPremium(candidate.set) >= CUTS.focusPremium;
}

// Index key matching inReplacementPool's slot/main/faction clauses. The equipped and demanded-set
// clauses are applied when the index is BUILT (they're properties of the candidate alone), so they
// deliberately don't appear here.
export function bucketKeyFor(item) {
  const m = item.mainStat;
  const base = `${item.slot}|${m.statId}|${m.isFlat ? 1 : 0}`;
  return item.isAccessory ? `${base}|${item.faction}` : base;
}

// Bucket the UNEQUIPPED demanded-set pool by bucketKeyFor, holding each bucket's ceilings in an
// ascending array so betterCount is a binary search instead of a scan. `ceilingOf(item) -> number`.
export function buildPoolIndex(items, ceilingOf) {
  const buckets = new Map();
  for (const it of items) {
    if (it.equippedChampId !== 0) continue;
    if (keepPremium(it.set) < CUTS.focusPremium) continue;
    const k = bucketKeyFor(it);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(ceilingOf(it));
  }
  for (const arr of buckets.values()) arr.sort((a, b) => a - b);
  return buckets;
}

// Upgrade paths for this slot: pool members whose ceiling is STRICTLY higher (ties are not upgrades).
export function betterCount(index, item, ceiling) {
  const arr = index.get(bucketKeyFor(item));
  if (!arr || !arr.length) return 0;
  let lo = 0, hi = arr.length;                       // first index with arr[i] > ceiling
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= ceiling) lo = mid + 1; else hi = mid;
  }
  return arr.length - lo;
}

// How miscast is this piece for the champion wearing it? gap = the item's best score across ALL
// FOUR archetypes (unrestricted by the set annotation — this is about the item's stats, not its
// set) minus its score at the champion's own role. Caller flags at CUTS.roleGapFlag.
export function roleGap(item, champRoleName) {
  if (!champRoleName) return null;
  const atChampRole = qualityAtRole(item, champRoleName);
  let best = { role: champRoleName, score: atChampRole };
  for (const role of ALL_ROLES) {
    const score = qualityAtRole(item, role);
    if (score > best.score) best = { role, score };
  }
  return { gap: best.score - atChampRole, bestRole: best.role, atChampRole };
}

// The triage verdict WINS OUTRIGHT. For equipped gear the only rule that can fire is
// setless-domination (junkTrim and slotBalance both skip equipped items), and it is load-bearing:
// 488 of 4192 equipped pieces are setless-dominated yet sit at a MEDIAN of 0 upgrade paths, because
// the replacement pool only counts demanded sets while setlessDominated compares against ANY
// set-bearing accessory. Without this override the metric inverts exactly those pieces.
//
// DEGENERATE CUTS MUST NOT CONDEMN. sellCut is a p75, so it is 0 whenever three quarters of the
// calibration population has no strictly-better spare — routine for a small or new vault, given how
// narrow inReplacementPool is — and a bare `better >= 0` then sells every piece with a single
// upgrade path. Requiring a POSITIVE sell cut drops those to BORDERLINE, which still carries the
// count. The KEEP branch needs no such guard: both cuts come off one ascending array at p50 and p75,
// so keepCut is never the higher of the two, and at sellCut 0 only a genuine zero count is kept —
// "nothing in the vault beats this" is real information worth keeping.
//
// `cuts.n === 0` is that failure's limit: no population at all, which through buildContext means
// every equipped piece was already condemned above. It can't support evidence of any kind, so it
// keeps outright with a reason that says so rather than quoting a count. Cuts handed in without an
// `n` are a caller stating them outright, and stay calibrated.
export function verdictFor({ triageVerdict, triageReason, better }, cuts) {
  if (triageVerdict === "delete") return { verdict: "SELL", reason: `triage: ${triageReason}` };
  if (cuts.n === 0) return { verdict: "KEEP", reason: "uncalibrated: nothing to compare against" };
  const reason = `${better} upgrade path${better === 1 ? "" : "s"}`;
  if (better <= cuts.keepCut) return { verdict: "KEEP", reason };
  if (cuts.sellCut > 0 && better >= cuts.sellCut) return { verdict: "SELL", reason };
  return { verdict: "BORDERLINE", reason };
}

// Cut points are quantiles of the vault's OWN equipped gear, so they self-calibrate as it grows.
// Global rather than per-slot on purpose: per-slot quantiles rate a weapon with 149 upgrade paths
// as KEEP (the weapon slot's own p50 is 181). Holding more spare weapons than spare gloves genuinely
// does make weapons more disposable. `n` is the population size — see verdictFor for what 0 means.
export function resolveCuts(betterCounts) {
  return {
    keepCut: quantile(betterCounts, CUTS.gearKeepQuantile),
    sellCut: quantile(betterCounts, CUTS.gearSellQuantile),
    n: betterCounts.length,
  };
}

// One pass over the vault: ceilings, the pool index, the triage lookup, and the resolved cuts.
// `scored` is the output of triage(items). Ceilings are quality-at-POTENTIAL — level-independent,
// substat TYPES only — because the pool is spares that would have to be leveled: the question is
// which of them would finish better, not which is further along today.
export function buildContext(items, scored) {
  const ceiling = new Map(items.map((it) => [it.id, quality(it, true).score]));
  const index = buildPoolIndex(items, (it) => ceiling.get(it.id));
  const byId = new Map(scored.map((s) => [s.item.id, s]));
  // Calibrate on equipped gear the triage hasn't already condemned.
  const counts = items
    .filter((it) => it.equippedChampId > 0 && byId.get(it.id)?.verdict === "keep")
    .map((it) => betterCount(index, it, ceiling.get(it.id)));
  return { ceiling, index, byId, cuts: resolveCuts(counts) };
}

export function rateItem(item, ctx, champRoleName) {
  const s = ctx.byId.get(item.id);
  const ceil = ctx.ceiling.get(item.id);
  // Both lookups have to be there, and each fails badly in its own way. A missing ceiling is
  // `undefined`, which loses every `arr[mid] <= ceiling` comparison in betterCount's binary search:
  // the piece comes back maximally replaceable and gets sold, silently. A missing triage row throws
  // a bare "Cannot read properties of undefined" naming neither item nor context, and buildContext
  // tolerates that same absence with `?.` while calibrating, so nothing upstream has complained
  // either. quality(item, true).score itself can't be non-finite: at potential it reads stat TYPES
  // only (never a decoded value), every weight is a finite constant, an unrecognised stat id or slot
  // scores 0, and the divisor is a max over the slot's own primaries with a `|| 1` guard. So these
  // only fire on an item buildContext never saw, and that is a caller error.
  const seen = "rateItem needs an item buildContext saw";
  if (!s) throw new Error(`champion-gear: no triage row for item ${item.id} — ${seen}`);
  if (!Number.isFinite(ceil)) throw new Error(`champion-gear: no ceiling for item ${item.id} — ${seen}`);
  const better = betterCount(ctx.index, item, ceil);
  const { verdict, reason } = verdictFor(
    { triageVerdict: s.verdict, triageReason: s.reason, better }, ctx.cuts);
  const rg = roleGap(item, champRoleName);
  return {
    item, better, ceiling: ceil, verdict, reason,
    q: s.q.score, role: s.q.role, percentile: Math.round(s.percentile),
    premium: keepPremium(item.set), rolls: rollStats(item, s.q.role),
    roleGap: rg && rg.gap >= CUTS.roleGapFlag ? rg : null,
  };
}

const VERDICT_ORDER = { SELL: 0, BORDERLINE: 1, KEEP: 2 };

export function analyzeChampionGear(champRow, items, ctx) {
  const role = champRole(champRow);
  const ratings = items
    .filter((it) => it.equippedChampId === Number(champRow.ID))
    .map((it) => rateItem(it, ctx, role))
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]
      || b.better - a.better || a.item.slot - b.item.slot);
  const tally = { SELL: 0, BORDERLINE: 0, KEEP: 0 };
  for (const r of ratings) tally[r.verdict]++;
  return { champ: champRow, role, ratings, tally };
}

// --- CLI: pure helpers ------------------------------------------------------
// Still unit-tested, and free of I/O and formatting — those start at the next banner.

// roleGap resolves its argmax by ALL_ROLES order, so at a tie its `bestRole` is an arbitrary pick
// among equals — and ties are routine rather than theoretical: both score components are
// Math.min(1, ...)-capped, so well-rolled gear saturates more than one role at 100. Naming one of
// them as though it were the answer sends the reader hunting for the wrong archetype, so the note
// names every role that reaches the maximum. (The wearer's own role is never among them: it ties
// only at gap 0, and rateItem reports anything below CUTS.roleGapFlag as no gap at all.)
export function roleGapNote(rating) {
  const rg = rating.roleGap;
  if (!rg) return "";
  const top = rg.atChampRole + rg.gap;
  const best = ALL_ROLES.filter((r) => qualityAtRole(rating.item, r) === top);
  return `  [role: better as ${best.join("/")}, +${rg.gap}]`;
}

// An arg ending .db or containing a separator is the snapshot; the first other arg is the selector.
//
// An EMPTY arg is no arg. `champion-gear.mjs ""` reaches here as [""], and an empty selector matches
// every champion by substring — but main() gates summary mode on `selector === null`, so it would
// print the full nine-slot readout for all 504 geared champions instead. Dropped here rather than
// in selectChamps for exactly that reason: the mode gate reads the parse result, not the matcher.
export function parseArgs(argv) {
  const args = argv.filter((a) => a !== "");
  const dbArg = args.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  return { selector: args.find((a) => a !== dbArg) ?? null, dbArg };
}

// All digits -> the exact Champs.ID (IDs are opaque, so a substring match on one means nothing);
// any other text -> a case-insensitive Name substring; no selector -> everyone. Falsy rather than
// `=== null` so an empty or absent selector can't reach `.toLowerCase()`; parseArgs already drops
// empties, so this is the exported function honouring its own contract, not the load-bearing guard.
export function selectChamps(rows, selector) {
  if (!selector) return rows;
  if (/^\d+$/.test(selector)) return rows.filter((r) => Number(r.ID) === Number(selector));
  const nf = selector.toLowerCase();
  return rows.filter((r) => r.Name.toLowerCase().includes(nf));
}

// Empty-Name rows are placeholders (they hold no gear, and they are the one place Role disagrees
// across copies of a name), so they never reach the matcher. Exported rather than inlined into
// readChampRows: it is the one pure rule in that function, and inside an untested I/O reader nothing
// would notice it going missing. `typeof` first because Name has no NOT NULL constraint, and
// `null.trim()` throws.
export const isRealChamp = (r) => typeof r.Name === "string" && r.Name.trim() !== "";

// --- CLI: I/O and formatting ------------------------------------------------
// Below this line nothing is unit-tested: DB reads, layout and printing.

export function readChampRows(dbPath) {
  // readOnly makes SELECT-only structural rather than conventional, and — the reason it's here — it
  // refuses to CREATE the file: without it a typo'd snapshot path leaves a stray 0-byte .db in the
  // snapshot directory before failing on the missing table, and this toolkit writes to no snapshot.
  // The read is wrapped so a corrupt file or a missing Champs table can't leak the handle.
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const st = db.prepare("SELECT ID, Name, Role, Rarity, Rang, Lvl FROM Champs");
    st.setReadBigInts(true);
    const rows = st.all().map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    return rows.filter(isRealChamp);
  } finally {
    db.close();
  }
}

// Champs.Rarity is 1-indexed (1=Common … 6=Mythical) — NOT the 0-indexed scheme the artifact rows
// use. (0 = a handful of untyped rows.)
const RARITY = { 0: "?", 1: "Common", 2: "Uncommon", 3: "Rare", 4: "Epic", 5: "Legendary", 6: "Mythical" };
const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setName = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

function resolveDb(arg) {
  if (arg) return arg;
  const dir = fileURLToPath(new URL("../resources", import.meta.url));
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

function printChampion(g) {
  const c = g.champ;
  console.log(`\n${c.Name} #${c.ID} — ${champLabel(c)} (${g.role ?? "?"})`
    + ` · ${RARITY[c.Rarity] ?? "?"} ${c.Rang}★ +${c.Lvl}`);
  for (const r of g.ratings) {
    const it = r.item;
    const fac = it.isAccessory ? `  [${lookupName(FACTION_NAMES, it.faction)}]` : "";
    console.log(` ${r.verdict.padEnd(10)} ${slotName(it.slot).padEnd(7)} ${setName(it.set).padEnd(13)}`
      + ` +${String(it.level).padStart(2)}  q${String(r.q).padStart(2)}  p${String(r.percentile).padStart(2)}`
      + `  ceil ${String(r.ceiling).padStart(3)}  ${r.rolls.good}/${r.rolls.total}`
      + `  prem ${r.premium}${fac}${roleGapNote(r)}`);
    console.log(`              ${r.reason}`);
  }
}

function main() {
  const { selector, dbArg } = parseArgs(process.argv.slice(2));
  const dbPath = resolveDb(dbArg);
  const rows = readChampRows(dbPath);
  const { items } = readArtifacts(dbPath);
  const scored = triage(items);
  // The same `items` array feeds both — rateItem refuses an item buildContext never saw.
  const ctx = buildContext(items, scored);

  const geared = new Set(items.filter((it) => it.equippedChampId > 0).map((it) => it.equippedChampId));
  const matched = selectChamps(rows, selector);
  const targets = matched.filter((r) => geared.has(Number(r.ID))).sort((a, b) => a.ID - b.ID);

  if (selector !== null && !matched.length) {
    console.error(`no champion matches "${selector}".`);
    const near = rows.filter((r) => r.Name.toLowerCase().startsWith(String(selector).slice(0, 3).toLowerCase()));
    if (near.length) console.error(`did you mean: ${[...new Set(near.map((r) => r.Name))].slice(0, 8).join(", ")}?`);
    process.exit(1);
  }
  if (!targets.length) {
    console.error(selector === null
      ? "no champion in this snapshot holds any gear."
      : `"${selector}" matched ${matched.length} cop${matched.length === 1 ? "y" : "ies"},`
        + " none of which hold any gear.");
    process.exit(1);
  }

  console.log(`# Champion gear — snapshot ${dbPath.split(/[\\/]/).pop()}`);
  console.log(`cuts: KEEP <=${ctx.cuts.keepCut} · SELL >=${ctx.cuts.sellCut}`
    + `   (p${Math.round(CUTS.gearKeepQuantile * 100)}/p${Math.round(CUTS.gearSellQuantile * 100)}`
    + ` of ${ctx.cuts.n} triage-keep equipped pieces)`);

  const groups = targets.map((c) => analyzeChampionGear(c, items, ctx));
  if (selector === null) {
    groups.sort((a, b) => b.tally.SELL - a.tally.SELL || b.ratings.length - a.ratings.length);
    console.log(`${groups.length} geared champions, most sellable first\n`);
    for (const g of groups) {
      console.log(`${g.champ.Name} #${g.champ.ID} (${champLabel(g.champ)})`
        + `  ${g.ratings.length} slots · ${g.tally.SELL} SELL · ${g.tally.BORDERLINE} BORDERLINE · ${g.tally.KEEP} KEEP`);
    }
  } else {
    for (const g of groups) printChampion(g);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
