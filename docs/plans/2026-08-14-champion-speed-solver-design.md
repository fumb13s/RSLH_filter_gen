# Champion speed solver — design

**Date:** 2026-08-14
**Status:** designed — not yet implemented

## Motivation

`champion-gear.mjs` rates the gear a champion is *already wearing*. It cannot answer the opposite
question: **what is the fastest this champion could be, given everything in the vault?**

Speed is the one stat worth asking that about in isolation. Turn order decides Arena, and a build
that is pure speed is a real build rather than a degenerate one — a speed lead exists to go first and
nothing else. So the first optimizer in this repo optimizes speed alone, with stat floors deferred to
a later pass.

Advisory only, like the rest of `oracle/analytics` — it never writes to the game DB.

## Scope

- One champion per run; maximize total speed over an assignment of items to all nine slots.
- Candidate pool is the **whole vault**, including gear currently worn by other champions. Narrowing
  the pool (unequipped only, etc.) is a later filter, not a design change.
- Items are valued **as they are today** — current level, current glyph — plus a second solve with
  every SPD substat glyph raised to a floor you pass.
- **Non-goals for v1:** stat floors or any constraint besides slot and faction; relic and aura
  modelling; recommending which items to level or glyph; anything that mutates a snapshot.

## CLI

```
node --experimental-sqlite oracle/analytics/speed.mjs <name|ID> [snapshot.db] [opts]
```

Argument conventions follow `champion-gear.mjs`:

| Argument shape | Meaning |
|---|---|
| all digits | exact `Champs.ID` |
| ends `.db`, or contains `/` or `\` | snapshot path |
| any other non-numeric | case-insensitive `Champs.Name` substring |
| absent | snapshot defaults to the newest `oracle/resources/*-RSLHelper.db` |

| Option | Meaning |
|---|---|
| `--glyph N` | additionally solve with every SPD substat glyph raised to at least N |
| `--base N` | override the corpus base speed |
| `--constant N` | override the measured constant, for what-if runs |
| `--top N` | print the N best builds rather than only the winner |
| `--corpus PATH` | champion base-speed corpus (see below) |

A name matching several copies solves each of them: `constant` is measured per copy and differs
between them.

## The speed model

```
speed = base
      + Σ setEffect(base, completed sets and tiers)
      + Σ itemSpeed(item)  over the nine equipped items
      + constant
```

### `itemSpeed`

```
itemSpeed(item, glyphFloor = 0) =
    main        mainStat.statId === 4 ? mainStat.value : 0
  + substats    Σ where statId === 4 of  value + max(glyph, glyphFloor)
  + ascension   ascStat?.statId === 4 ? ascStat.value : 0
```

Established against the 2026-08-12 snapshot:

- The main-stat speed roll occurs on **Boots only** (422 items, max 45).
- `substat.value` already carries the Mythical bonus roll, because `decodeRow` folds `sNmlvlid` into
  it. Do not add it again.
- **The substat glyph is additive, not already included.** Predicting champion totals with `sNgv`
  added is exact for 99/243 champions (mean error +6.2); omitting it drops to 41/243 (mean error
  +15.1).
- **Ascension stats carry no glyph.** `ASCGV` is 0 in all 8,474 rows, as is `mgv` (main-stat glyph).
  Glyphs only ever apply to substats.
- The ascension stat is worth having: 203 artifacts carry a SPD ascension, 164 of them at +12 —
  comparable to a strong substat, and invisible to the current decoder.

`glyphFloor` only lifts substats that **already are** speed; you cannot glyph a stat an item does not
have. This is why the glyph report re-solves rather than re-pricing the winning build — raising every
speed glyph changes which items win.

`glyphFloor` is clamped per item to the maximum SPD glyph observed in the vault for that item's
rarity × rank, and the report states how many items were clamped. Without the clamp, `--glyph 20`
invents speed that cannot exist.

### `setEffect`

Two mechanics. **Classic artifact sets stack**: a set contributes `floor(count / pieces)`
completions, each worth its listed percentage. **Nine-slot sets do not stack**: crossing successive
thresholds unlocks additional bonuses that accumulate.

Classic (artifact slots only):

| set | id | pieces | per completion |
|---|---|---|---|
| Speed | 4 | 2 | +12% |
| Divine Speed | 34 | 2 | +12% |
| Impulse | 53 | 2 | +12% |
| Righteous | 57 | 2 | +10% |
| Perception | 38 | 2 | +5% |
| Instinct | 50 | 4 | +12% |

Nine-slot tiered (artifacts and accessories both count toward the piece total):

| set | ids | thresholds | tier bonuses | max |
|---|---|---|---|---|
| Supersonic, Pinpoint, Deflection, Chronophage, Rebirth | 58, 62, 36, 65, 64 | 3 / 5 / 8 | +10 / +10 / +12 | 32% |
| Mercurial | 66 | 3 / 5 / 8 | +8 / +12 / +12 | 32% |
| Protection | 47 | 3 / 5 / 8 | +12 / +12 / +8 | 32% |
| Swift Parry | 35 | **2 / 4 / 8** | +8 / +10 / +10 | 28% |
| Feral | 61 | 3 / 5 / 8 | +5 / +5 / +5 | 15% |
| Merciless, Stonecleaver | 59, 63 | 3 / 7 | +5 / +5 | 10% |
| Slayer | 60 | 3 / 8 | +5 / +5 | 10% |

Accessory-only sets (1000–1004) and every set not listed grant **0%**.

Swift Parry's thresholds are 2/4/8, not the 3/5/8 its neighbours use. It gets its own test.

**Rounding is floor, applied per completion**: `Σ floor(base × p)`, one term per completed classic
set and per unlocked tier. Measured against 243 champions with an exactly known base, all floor
variants score 99/243 exact; rounding scores 96 with roughly twice the over-predictions.
Per-completion flooring has the fewest over-predictions of the floor variants (12 vs 13).

Independent corroboration from a blind fit over the vault, before the table was known: Feral at 9
pieces measured 16% against a table value of 15%, Protection 34% against 32%, Mercurial 27% against
32% — all inside relic noise.

### `base` and `constant`

**`base` comes from the champion base-stat corpus**, looked up by name. The corpus is an external
local dataset, not committed here; its path comes from `--corpus PATH` or `$RSLH_SPEED_CORPUS`.
Expected shape:

```json
{ "Kantra the Cyclone": 109, "Arbiter": 110 }
```

Coverage against the 2026-08-12 snapshot is 473 of 476 geared champion names. The missing 3 require
`--base`, and their absence is a hard error naming that flag rather than a silent guess.

That figure was 456 before `lookupBase` grew its punctuation fallback. The other 17 were never a
dataset gap: the game spells champions with apostrophes, commas, colons and hyphens, and a corpus
that has been through a slug or an OCR pass need not. Matching on the lowercased name alone hid
champions the corpus already held.

**`constant` is measured, once, per champion:**

```
constant = observed Champs.SPD − (base + Σ setEffect + Σ itemSpeed)   over CURRENT gear
```

It absorbs every flat speed source the model does not represent — faction guardians, champion
ascension, relic, and anything else — and it is gear-independent, so it carries unchanged into any
candidate build. For an ungeared champion it degenerates to `observed − base`.

Keeping `constant` separate from `base` is load-bearing rather than cosmetic: set bonuses multiply
`base` but not `constant`. Folding them together would apply the percentage to the relic as well. For
Arbiter — 62 points of unexplained speed against 36% of set bonus — that is a 22-speed error, and it
biases the solver systematically toward set bonuses over flat speed, which is exactly the trade-off
the tool exists to make.

The report prints `base`, `constant`, and their sources, so a corpus-derived answer is never mistaken
for a measured one.

## Architecture

New files under `oracle/analytics/`, shaped like the existing tools — pure exported functions above a
banner comment, I/O and formatting below it, `main()` behind the
`realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` guard so tests can import without
side effects.

| file | contents |
|---|---|
| `speed-model.mjs` | pure — `itemSpeed`, `setEffect`, total-speed formula, `constant` measurement |
| `speed-sets.mjs` | the set tables above, as data |
| `speed-solve.mjs` | pure — index build, plan enumeration, assignment DP, reconstruction |
| `speed.mjs` | CLI — args, DB read, corpus load, orchestration, report |
| `champs.mjs` | extracted from `champion-gear.mjs` (below) |

Data flow for one run:

```
resolveDb(arg)              -> snapshot path
readArtifacts(dbPath)       -> all items, now carrying ascStat      [oracle/analytics/decode.mjs]
readChampRows(dbPath)       -> Champs incl. Fraction, SPD, EmpLvl    [champs.mjs]
selectChamps(rows, sel)     -> target champion(s)
loadCorpus(path)            -> base speed by name
measureConstant(champ, currentGear, base)
buildIndex(items, champ.Fraction, glyphFloor)   -> best[slot][set]
solve(index, base, constant)                    -> optimal assignment
solve(index', base, constant)                   -> the glyph >= N variant
report
```

### Changes to existing code

**1. Decode the ascension stat.** Add an `ASC` column descriptor beside `SUB` in
`oracle/lib/decode.mjs`, and emit `item.ascStat = { statId, isFlat, value }` from
`oracle/analytics/decode.mjs`. Purely additive: `oracle/probe/probe.mjs` names its columns
explicitly, so it is untouched, and existing consumers ignore unknown fields. `ASCGV` is not read —
it is 0 in every row.

**2. Extract champion reading.** Move `readChampRows`, `isRealChamp`, `parseArgs` and `selectChamps`
out of `champion-gear.mjs` into `champs.mjs`, re-exported from their old home so nothing breaks. The
column list gains `Fraction`, `SPD`, `EmpLvl`. `speed.mjs` needs all four — the name matching with
its "did you mean" suggestion is worth sharing rather than duplicating — and one analytics tool
importing from another tool's CLI module is the wrong dependency direction.

### Known gap, deliberately not addressed here

`triage.mjs`, `score.mjs` and `quality` ignore ascension stats entirely. A +12 SPD ascension is worth
as much as a strong substat, so vault gear is currently being scored on incomplete data. That is a
real defect with its own blast radius and deserves its own pass; this design only stops the *new*
tool from repeating it.

## The solver

The objective factors: `speed = base × (1 + ΣsetPct) + Σ flat + constant`. The flat term is a sum of
independent per-slot choices. Only the set term couples slots, and only through how many pieces of
each set the final build holds.

**Index.** Bucket all items by slot; filter slots 7–9 to the champion's `Fraction`. The faction lock
is a hard game constraint, verified on the snapshot: 1,401 equipped accessories, `accset` equals the
wearer's `Fraction` in every case, zero exceptions. Then precompute

```
best[slot][set] -> the highest-itemSpeed item of that set in that slot
```

because for a fixed slot→set assignment nothing else about a slot matters. The index is
snapshot-invariant apart from the faction filter and `glyphFloor`, so it is built **once per process
and reused across champions** — 129 ms to read the artifacts, 27 ms to index, 1,011 entries. A
524-champion run that rebuilt it per champion would burn about 80 s instead. It is not persisted to
disk: that saves only ~156 ms per invocation and buys a cache-staleness correctness risk.

**Why not a single DP over set counts.** With 18 speed-granting sets the state product is ~10¹⁸.
The thresholds rescue it — the lowest is 2 pieces, so **at most four sets can be active at once**
(2+2+2+3 = 9). Hence:

1. **Enumerate set plans.** Pick 1–4 speed sets that actually have items in this champion's pool and
   assign each a count at or above its first threshold, summing to ≤ 9. Tens of thousands of plans,
   heavily pruned by what the pool can supply.
2. **Per plan, an assignment DP.** Walk the nine slots with state = how many of each active set has
   been placed. State space ~10³, so ~10⁴ transitions per plan.
3. **Score each assignment on its actual items, not on the plan.** A slot left free carries an item
   that belongs to *some* set and may accidentally complete another one. Re-deriving the bonus from
   the chosen items means the reported number is never an under-count, and because every plan is
   enumerated the true optimum is still reached.
4. **Branch and bound.** An upper bound per plan — best conceivable flat plus maximum bonus — skips
   plans that cannot beat the incumbent.

This returns the **provable maximum** rather than a heuristic, which is the point of the tool: "is
this really the fastest I can be?" is the question being asked.

The glyph-≥N report is the same machinery with a different `glyphFloor`, hence a second index.

## Output

The arithmetic must be auditable, so the breakdown is printed rather than just the total:

```
# Speed — Kantra the Cyclone #12059 (Barbarians)
  base 109 (corpus) · constant +10 (observed) · current 296

  BEST  341 SPD  (+45)   Speed x4 (+24%) · Perception x2 (+5%)
    Helmet  Speed      +16   spd 34   sub 22 + glyph 12       #9296
    Chest   Speed      +16   spd 29   sub 17 + glyph 12       #4471
    ...
    base 109 + sets 31 + items 191 + constant 10 = 341

  at glyph >= 8   358 SPD  (+62)    [7 items clamped to their rarity ceiling]
```

## Testing

Pure helpers are unit-tested; I/O and formatting below the banner are not, matching the rest of
`oracle/analytics`.

- **`itemSpeed`** — main, substat, glyph, ascension and Mythical-roll combinations, including the two
  facts established from data: ascension carries no glyph, and the substat glyph is additive rather
  than already present in the record.
- **`setEffect`** — classic stacking, tiered accumulation, floor-per-completion, and Swift Parry's
  2/4/8 thresholds as their own case.
- **`solve`** — hand-built small pools with a known optimum, plus a **brute-force equivalence
  property test** over random small instances (≤4 slots, ≤3 sets). That is the actual proof the DP is
  exact; this repo already runs fast-check under fuzz CI.
- **Invariants** — the solution is never worse than best-flat-per-slot, and never worse than the
  champion's current gear, which is in the pool by construction.
- **`verify` subcommand** — reports the distribution of `constant` across all geared champions. This
  is the model's health check and the thing that would catch a game patch changing set values.

## Edge cases

| case | behaviour |
|---|---|
| champion absent from the corpus | hard error naming `--base`; never a silent guess |
| champion has no gear | `constant = observed − base` |
| no accessory of the champion's faction in a slot | leave the slot empty and say so |
| two items tie on `itemSpeed` | break by item id, so output is stable across runs |
| corrupt DB rows | already dropped upstream by `isCorrupt` |
| name matches several copies | solve each; `constant` differs per copy |

## Deferred

- **Stat floors** (`--min-acc`, `--min-cr`, …). The intended next step, and the reason the model is
  built around a per-item stat contribution rather than a speed scalar.
- **Relic and aura.** Both are absent from the DB — `RelicFeedTypes` is empty and there is no aura
  table — so both would have to be supplied. Relic speed is currently absorbed into `constant`, which
  is correct as long as the relic does not change.
- **Summary mode** over all geared champions ("current vs achievable, biggest gains first"). Cheap,
  given the shared index.
- **Pool narrowing** — unequipped only, or excluding named champions' gear.

## Evidence appendix

Measurements against `oracle/resources/2026-08-12-RSLHelper.db` (8,474 items, 0 corrupt; 524 geared
champion rows across 476 names).

These validations derive `base` from an **ungeared duplicate copy** rather than from the corpus, so
that model error is not confounded with corpus staleness. They therefore test the *set table and
`itemSpeed`*, which is what needs testing: in production `base` comes from the corpus and `constant`
absorbs whatever difference remains, making the current-gear prediction exact by construction.

| finding | evidence |
|---|---|
| speed model is exact when nothing is unmodelled | 10 of 11 champions wearing no completed set predicted to the point |
| ascension stats matter | including them lifts set-free exactness 82% → 91%, and all-geared 25% → 33% |
| substat glyph is additive | 99/243 exact with it, 41/243 without |
| ascension has no glyph | `ASCGV` = 0 in all 8,474 rows; `mgv` likewise |
| accessories are faction-locked | 1,401 equipped accessories, 0 mismatches against the wearer's `Fraction` |
| speed rolls on 7 of 9 slots | rings and amulets carry no SPD at all, main or sub |
| set table reproduces observed speed | 41% of champions predicted exactly, 50% within ±1, with the residual concentrated on heavily-geared champions in discrete steps (+5, +6, +7, +10, +12, +17) consistent with relics |

The residual above is why `constant` exists and why deriving the set table from the vault was
abandoned: relic speed is per-champion, invisible to the DB, and the same size as the bonuses being
measured, so no amount of vault data separates them. A blind fit kept re-discovering it and
attributing it to whichever set happened to be unresolved (Cruel 6%, Righteous 9%, Pinpoint 9%,
Protection 11%). Only `Speed = +12% at 2 pieces` survived every variant of the fit, and it agrees
with the dictated table.

`Champs.Fraction` orders 13=Barbarians, 14=Sylvan Watchers, 15=Shadowkin, 16=Dwarves, 17=Argonites,
which disagrees with `FACTION_NAMES` in `packages/core/src/mappings.ts` (13=Dwarves, 14=Shadowkin,
15=Sylvan Watchers, 16=Argonites). This solver only ever compares `accset` against `Fraction` — both
from the same DB, verified 1:1 — so it is unaffected either way. Recorded here because it is evidence
bearing on a separately tracked open question about that mapping.
