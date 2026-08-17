// Maximum-speed gear solver for one champion, over the whole vault.
//
//   node --experimental-sqlite oracle/analytics/speed.mjs <name|ID> [snapshot.db] [opts]
//     --glyph N      also solve with every SPD substat glyph raised to at least N
//     --base N       override the corpus base speed
//     --constant N   override the measured constant
//     --top N        print the N best builds rather than only the winner
//     --corpus PATH  champion base-speed corpus (or $RSLH_SPEED_CORPUS)
//
//   node --experimental-sqlite oracle/analytics/speed.mjs verify [snapshot.db] [--corpus PATH]
//     model health check: the distribution of the unexplained constant across geared champions.
//
// Advisory only; nothing is written to any database.
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, lookupName } from "@rslh/core";
import { readArtifacts } from "./decode.mjs";
import { readChampRows, selectChamps } from "./champs.mjs";
import { SPD, glyphCeilings, clampFloor, speedOfWith, measureConstant, itemSpeed, buildSpeed,
  setCounts } from "./speed-model.mjs";
import { SLOTS, buildIndex, solve, enumeratePlans, assign, viableSets } from "./speed-solve.mjs";
import { setEffect, speedSetName } from "./speed-sets.mjs";
import { loadCorpus, lookupBase } from "./speed-corpus.mjs";

// --- CLI: pure helpers ------------------------------------------------------

const NUMERIC = new Set(["--glyph", "--base", "--constant", "--top"]);

// Same selector/snapshot conventions as champion-gear.mjs, plus options. Option VALUES are consumed
// as they are read, so `--glyph 8 Kantra` still finds Kantra rather than reading 8 as the selector.
export function parseSpeedArgs(argv) {
  const out = { selector: null, dbArg: undefined, glyph: 0, base: null, constant: null, top: 1,
    corpus: process.env.RSLH_SPEED_CORPUS ?? null, verify: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "") continue;
    if (NUMERIC.has(arg)) {
      // Blank checked before Number(), because Number("") and Number(" ") are both 0 — an option
      // whose value went missing would otherwise parse as a legal 0 instead of failing.
      const raw = argv[++i];
      const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number`);
      out[arg.slice(2)] = value;
      continue;
    }
    if (arg === "--corpus") { out.corpus = argv[++i]; continue; }
    if (arg === "verify") { out.verify = true; continue; }
    // Anything else beginning `--` is a typo, not a champion, and swallowing it as a positional is
    // the worst outcome on offer: `--glpyh 8` loses the option-value race, runs an un-lifted solve,
    // exits 0, and says nothing about the lift it dropped. A plausible wrong answer, not a crash.
    if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    positional.push(arg);
  }
  out.dbArg = positional.find((a) => a.endsWith(".db") || a.includes("/") || a.includes("\\"));
  out.selector = positional.find((a) => a !== out.dbArg) ?? null;
  return out;
}

const slotName = (s) => lookupName(ARTIFACT_SLOT_NAMES, s);
const setLabel = (s) => (s === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, s) || `#${s}`);

// "Speed x4 (+24%) · Perception x2 (+5%)" — only sets that actually paid out.
export function describeSets(counts, base) {
  const parts = [];
  for (const [setId, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    if (!speedSetName(setId)) continue;
    const gain = setEffect(base, new Map([[setId, count]]));
    if (gain > 0) parts.push(`${setLabel(setId)} x${count} (+${gain})`);
  }
  return parts.length ? parts.join(" · ") : "no speed sets";
}

// itemId -> the name of the champion wearing it right now, for the pieces that would have to come
// OFF someone. A free piece costs nothing to fit, and neither does one already on `champId`, so
// neither is listed — including them would bury the ones that do cost something.
//
// Built once per champion over the whole vault rather than per build, because --top prints several
// builds drawn from the same pool.
export function otherWearers(items, champId, rows) {
  const names = new Map(rows.map((r) => [Number(r.ID), r.Name]));
  const out = new Map();
  for (const it of items) {
    const owner = it.equippedChampId;
    if (!owner || owner === champId) continue;
    // A placeholder Champs row is dropped by readChampRows but still owns gear. Naming the owner by
    // id beats reporting the piece as free, which is the one answer that is certainly wrong.
    out.set(it.id, names.get(owner) ?? `#${owner}`);
  }
  return out;
}

// "8 of 9 — Kantra the Cyclone x3, Elhain x2, Kael", or "none".
//
// The solver's pool is the WHOLE vault, worn gear included — a deliberate choice, since gear can be
// moved. The consequence is that solving several champions independently proposes the same physical
// pieces to each, so the builds are mutually exclusive. Printed for every build, `none` included:
// silence would be indistinguishable from a report that does not check.
//
// Busiest wearer first, then alphabetical, so a rerun on one snapshot prints the same line. Names
// past the fourth become "+N more" — nine pieces off nine champions is a 200-character line, and
// the tail of it is singletons already named against their own item a few lines above.
const NAMED_WEARERS = 4;

export function describeWearers(items, wearers) {
  const byChamp = new Map();
  for (const it of items) {
    const who = wearers.get(it.id);
    if (who === undefined) continue;
    byChamp.set(who, (byChamp.get(who) ?? 0) + 1);
  }
  if (byChamp.size === 0) return "none";
  const taken = [...byChamp.values()].reduce((sum, n) => sum + n, 0);
  const ranked = [...byChamp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const named = ranked.slice(0, NAMED_WEARERS).map(([who, n]) => (n > 1 ? `${who} x${n}` : who));
  const rest = ranked.length - named.length;
  return `${taken} of ${items.length} — ${[...named, ...(rest ? [`+${rest} more`] : [])].join(", ")}`;
}

// The last line is a RECONCILIATION, not a restatement. Every term is computed independently and the
// total is added up from them, so the line can disagree with what the solver returned — and says so
// when it does. Deriving `sets` as `speed - base - items - constant` instead would balance for every
// input by construction, including a wrong one, which is a tautology wearing the costume of a check.
//
// What it can catch is a printer/solver mismatch: a caller handing this a glyph floor or a ceiling
// table other than the one the build was solved under. What it cannot catch is a stale set
// percentage — `solve` and `describeSets` both go through `setEffect`, so they would agree on the
// same wrong number. That gap is `verify`'s job, not this line's.
export function formatBuild(result, base, constant, glyphFloor, ceilings, wearers) {
  const lines = [];
  const flat = result.items.reduce((sum, it) => sum + itemSpeed(it, clampFloor(it, glyphFloor, ceilings)), 0);
  const bonus = setEffect(base, result.counts);
  const total = base + bonus + flat + constant;
  lines.push(`  ${result.speed} SPD   ${describeSets(result.counts, base)}`);
  for (const it of [...result.items].sort((a, b) => a.slot - b.slot)) {
    const s = itemSpeed(it, clampFloor(it, glyphFloor, ceilings));
    const on = wearers.get(it.id);
    lines.push(`    ${slotName(it.slot).padEnd(7)} ${setLabel(it.set).padEnd(14)}`
      + ` +${String(it.level).padStart(2)}   spd ${String(s).padStart(3)}   #${it.id}`
      + (on ? `   on ${on}` : ""));
  }
  lines.push(`    on other champions: ${describeWearers(result.items, wearers)}`);
  lines.push(`    base ${base} + sets ${bonus} + items ${flat} + constant ${constant} = ${total}`
    + (total === result.speed ? "" : `   MISMATCH: the solver said ${result.speed}`));
  return lines.join("\n");
}

// The `n` fastest builds, for --top. Same enumeration and same scoring as solve(), with the
// branch-and-bound left out — the bound prunes exactly the plans that cannot beat the incumbent,
// which is what the runners-up are.
//
// Two plans naming different sets can land on the same nine items, so builds are deduplicated on the
// items they actually contain. The FIRST plan to reach a given set of items is the one kept, which
// is the least-committed description of it: a build that completes Speed only because the fastest
// free pieces happened to carry it stays reported as the plan that never named Speed.
//
// [0] is solve()'s answer — every plan solve skips is one that could not beat its incumbent, so the
// two agree on the maximum. They can disagree on the `plan` RECORDED for it: solve's bound is
// computed from the sets a plan NAMES, so it can skip a plan whose free picks complete an extra set
// by accident and then record whichever later plan names that set outright.
export function topBuilds(index, base, constant, speedOf, n) {
  // Same precondition as solve(): with no slot to fill there is no build. Without this the empty plan
  // "succeeds" with zero items and reports base + constant as if it were a gear result.
  if (!SLOTS.some((slot) => index.has(slot))) return [];
  const seen = new Map();
  for (const plan of enumeratePlans(index, viableSets(index))) {
    const picks = assign(index, plan);
    if (!picks) continue;
    const key = picks.map((it) => it.id).sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.set(key, { speed: buildSpeed(base, constant, picks, speedOf), items: picks, plan,
      counts: setCounts(picks) });
  }
  return [...seen.values()].sort((a, b) => b.speed - a.speed).slice(0, Math.max(1, n));
}

// Ranked best-first. One build is the overwhelmingly common case and gets solve()'s pruning; only
// --top pays for the full enumeration.
export function rankBuilds(index, base, constant, speedOf, top) {
  if (top > 1) return topBuilds(index, base, constant, speedOf, top);
  const best = solve(index, base, constant, speedOf);
  return best ? [best] : [];
}

// --- CLI: I/O and formatting ------------------------------------------------
// Below this line nothing is unit-tested: DB reads, layout and printing.

function resolveDb(arg) {
  if (arg) return arg;
  const dir = fileURLToPath(new URL("../resources", import.meta.url));
  const snaps = readdirSync(dir).filter((f) => /-RSLHelper\.db$/.test(f)).sort();
  if (!snaps.length) { console.error(`no snapshot found in ${dir}; run refresh.sh`); process.exit(1); }
  return `${dir}/${snaps[snaps.length - 1]}`;
}

// loadCorpus and parseSpeedArgs both throw messages written for this audience, so a mistyped flag or
// a --corpus pointed one directory too high gets the message and nothing else. Everything past here
// keeps its stack trace, because anything else that throws is a bug rather than a typo.
function die(e) {
  console.error(e.message);
  process.exit(1);
}

function loadCorpusOrDie(path) {
  try {
    return loadCorpus(path);
  } catch (e) {
    return die(e);
  }
}

// `escape` names the other way out, and is empty for verify — which reads the whole roster and so
// has no way out. Offering --base there would be advice that cannot work.
function requireCorpus(path, escape) {
  if (!path) {
    console.error("no champion base-speed corpus: pass --corpus PATH"
      + ` or set $RSLH_SPEED_CORPUS${escape}`);
    process.exit(1);
  }
  return loadCorpusOrDie(path);
}

// The corpus is only needed when a base has to be LOOKED UP. `--base N` supplies it outright, so
// someone who knows one champion's base speed and does not have the dataset can still run — which
// is exactly the case --base exists to serve, and the case the README points them at. A path given
// alongside --base is still loaded, so a typo in it fails loudly rather than sitting unused.
function resolveCorpus(args) {
  if (args.verify) return requireCorpus(args.corpus, "");
  if (args.base === null) {
    return requireCorpus(args.corpus, ", or --base N to give one champion's base speed directly");
  }
  return args.corpus ? loadCorpusOrDie(args.corpus) : new Map();
}

function gearOf(items, champId) {
  return items.filter((it) => it.equippedChampId === champId);
}

// Model health check: how much speed the model fails to explain, across every geared champion.
// The distribution is dominated by per-copy flat sources the snapshot does not expose (relic,
// champion ascension), so read it as the SIZE of that gap. It is not a patch detector: already wide
// and multi-modal, it would move less on a changed set value than on the noise it carries.
function runVerify(items, rows, corpus) {
  const ceilings = glyphCeilings(items);
  const speedOf = speedOfWith(0, ceilings);
  const buckets = new Map();
  let covered = 0, missing = 0;
  for (const champ of rows) {
    const gear = gearOf(items, champ.ID);
    if (!gear.length) continue;
    const base = lookupBase(corpus, champ.Name);
    if (base === null) { missing++; continue; }
    covered++;
    const c = measureConstant(champ.SPD, base, gear, speedOf);
    buckets.set(c, (buckets.get(c) ?? 0) + 1);
  }
  const sorted = [...buckets].sort((a, b) => a[0] - b[0]);
  const zero = buckets.get(0) ?? 0;
  console.log(`# Speed model verify — ${covered} geared champions in the corpus`
    + ` (${missing} not in it)`);
  // A corpus that matches nothing is a wrong --corpus, not a model result, and dividing by it would
  // report "NaN%" as if it were one.
  if (covered === 0) {
    console.log("  nothing to measure — no geared champion is in this corpus.");
    return;
  }
  console.log(`  constant == 0 for ${zero} (${(100 * zero / covered).toFixed(0)}%)`);
  console.log(`  constant distribution: ${sorted.map(([k, n]) => `${k}:${n}`).join(" ")}`);
}

// BEST is printed by the caller, which knows what its headline delta is measured against; the
// runners-up are all measured against BEST.
function printRanked(ranked, base, constant, glyphFloor, ceilings, wearers) {
  ranked.forEach((build, i) => {
    if (i > 0) console.log(`\n  #${i + 1}  (${build.speed - ranked[0].speed} off BEST)`);
    console.log(formatBuild(build, base, constant, glyphFloor, ceilings, wearers));
  });
}

function main() {
  let args;
  try {
    args = parseSpeedArgs(process.argv.slice(2));
  } catch (e) {
    return die(e);
  }
  const dbPath = resolveDb(args.dbArg);
  const { items } = readArtifacts(dbPath);
  const rows = readChampRows(dbPath);
  const corpus = resolveCorpus(args);

  if (args.verify) { runVerify(items, rows, corpus); return; }

  if (args.selector === null) {
    console.error("name a champion: speed.mjs <name|ID> [snapshot.db]");
    process.exit(1);
  }
  const matched = selectChamps(rows, args.selector);
  if (!matched.length) {
    console.error(`no champion matches "${args.selector}".`);
    const near = rows.filter((r) =>
      r.Name.toLowerCase().startsWith(String(args.selector).slice(0, 3).toLowerCase()));
    if (near.length) {
      console.error(`did you mean: ${[...new Set(near.map((r) => r.Name))].slice(0, 8).join(", ")}?`);
    }
    process.exit(1);
  }

  const ceilings = glyphCeilings(items);
  console.log(`# Speed — snapshot ${dbPath.split(/[\\/]/).pop()}`);

  for (const champ of matched) {
    const base = args.base ?? lookupBase(corpus, champ.Name);
    if (base === null) {
      console.error(`\n${champ.Name} #${champ.ID}: not in the corpus — pass --base N`);
      continue;
    }
    const gear = gearOf(items, champ.ID);
    const plainSpeed = speedOfWith(0, ceilings);
    const constant = args.constant ?? measureConstant(champ.SPD, base, gear, plainSpeed);

    console.log(`\n${champ.Name} #${champ.ID}`
      + `  base ${base}${args.base === null ? " (corpus)" : " (--base)"}`
      + ` · constant ${constant >= 0 ? "+" : ""}${constant}`
      + `${args.constant === null ? " (observed)" : " (--constant)"}`
      + ` · current ${champ.SPD}`);

    const index = buildIndex(items, champ.Fraction, plainSpeed);
    const ranked = rankBuilds(index, base, constant, plainSpeed, args.top);
    if (!ranked.length) { console.log("  no eligible items for any slot."); continue; }
    // Same pool for every build printed for this champion, plain and glyph-lifted alike.
    const wearers = otherWearers(items, champ.ID, rows);
    console.log(`  BEST  (+${ranked[0].speed - champ.SPD} over current)`);
    printRanked(ranked, base, constant, 0, ceilings, wearers);

    if (args.glyph > 0) {
      const glyphSpeed = speedOfWith(args.glyph, ceilings);
      const glyphIndex = buildIndex(items, champ.Fraction, glyphSpeed);
      // Same items and same faction as `index`, so the same slots are populated: a non-empty `ranked`
      // guarantees a non-empty `lifted`.
      const lifted = rankBuilds(glyphIndex, base, constant, glyphSpeed, args.top);
      const clamped = items.filter((it) =>
        it.substats.some((s) => s.statId === SPD && s.glyph < args.glyph)
        && clampFloor(it, args.glyph, ceilings) < args.glyph).length;
      console.log(`\n  at glyph >= ${args.glyph}  (+${lifted[0].speed - ranked[0].speed} over BEST)`
        + `${clamped ? `   [${clamped} vault items clamped to their rarity ceiling]` : ""}`);
      printRanked(lifted, base, constant, args.glyph, ceilings, wearers);
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
