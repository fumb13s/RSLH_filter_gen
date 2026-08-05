# Per-champion gear analysis — design

**Date:** 2026-08-05
**Status:** approved, not yet implemented

## Motivation

The vault-wide report (`oracle/analytics/analyze.mjs`) answers "what should I sweep out of my
inventory". It cannot answer "should I keep the five pieces this champion is wearing", because its
two delete passes — `junkTrim` and `slotBalance` — skip equipped items by construction. Ask it about
worn gear and every piece comes back `keep`, protected by supply floors rather than by merit.

That question came up for real (Elhain #110) and had to be answered by hand across four throwaway
scripts. This design generalises it into `oracle/analytics/champion-gear.mjs`: given a champion, rate
each of their nine equipped pieces KEEP / BORDERLINE / SELL with the numbers that justify the call.

Advisory only, like the rest of `oracle/analytics` — it never writes to the game DB.

## Scope

- All nine equipped slots: artifacts (1–6) and accessories (Ring/Amulet/Banner, 7–9).
- Read-only against a dated snapshot in `oracle/resources/`.
- **Non-goals:** suggesting which unequipped spare to swap in; recommending champion builds;
  anything that mutates a snapshot or the live DB.

## CLI

```
node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]
```

Argument conventions follow `spare-copies.mjs`:

| Argument shape | Meaning |
|---|---|
| all digits | exact `Champs.ID` |
| ends `.db`, or contains `/` or `\` | snapshot path |
| any other non-numeric | case-insensitive `Champs.Name` substring |
| absent | snapshot defaults to the newest `oracle/resources/*-RSLHelper.db` |

No champion selector → summary mode: one line per geared champion, ranked by SELL count.

## Architecture

New file `oracle/analytics/champion-gear.mjs`, shaped like `spare-copies.mjs`: pure exported
functions plus a `main()` behind the `realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`
guard, so importing it from tests has no side effects.

```
resolveDb(arg)            -> snapshot path
readChampRows(dbPath)     -> Champs: ID, Name, Role, Rarity, Rang, Lvl
readArtifacts(dbPath)     -> all items (already carries equippedChampId)   [oracle/analytics/decode.mjs]
triage(items)             -> vault-wide verdicts                            [oracle/analytics/triage.mjs]
        |
buildContext(items, scored)
        |  ceiling: Map itemId -> quality(item, true).score
        |  demanded-set unequipped pool, bucketed (see Implementation note)
        |  keepCut / sellCut  (runtime quantiles, see Thresholds)
        |
for each matched champion:
    worn    = items.filter(it => it.equippedChampId === champ.ID)
    ratings = worn.map(it => rateItem(it, ctx, champRole(champ)))
    print, SELL first
```

Worn gear is resolved from the **artifact** side (`equippedChampId`), not from the nine `Champs`
gear columns, so the two cannot disagree and nothing is needed from `spare-copies.mjs`.

`resolveDb()` is duplicated a third time, matching `worst-artifacts.mjs` and `spare-copies.mjs`.
Hoisting it (and a shared `champs.mjs`) was considered and deliberately deferred — see Rejected
alternatives.

## Champion role

`Champs.Role` is the game's champion type, confirmed against the 2026-07-12 snapshot:

| Role | Type | Maps to | Evidence (Rang≥5, Lvl≥50) |
|---|---|---|---|
| 0 | Attack | `ATK-DPS` | n=178, median ATK 5176 (highest), CR 96 / CD 246 — Elhain, Kael, Warmaiden |
| 1 | Defense | `DEF-DPS` | n=97, median DEF 4515 (highest), ATK 2406 (lowest) — Sepulcher Sentinel, Skullcrusher |
| 2 | HP | `HP-DPS` | n=78, median HP 78805 (highest) — Vogoth, Miscreated Monster, Husk |
| 3 | Support | `Support` | n=149, median CR 38 / CD 134 (lowest) — Apothecary, Arbiter, Bad-el-Kazar |

The column is static champion data, not derived from a built champion: bare level-1 copies already
carry non-zero roles (Shaman=3, Prundar=1), and 368 of 369 multi-copy names agree across their
copies. The single disagreement is a block of empty-`Name` placeholder rows (IDs 204350–204400)
which hold no gear; filter rows with an empty `Name`.

```js
export const CHAMP_ROLE = { 0: "ATK-DPS", 1: "DEF-DPS", 2: "HP-DPS", 3: "Support" };
export const champRole = (row) => CHAMP_ROLE[Number(row.Role)] ?? null;
```

A `null` role (unrecognised value) suppresses the role-gap flag but leaves verdicts intact.

## Replaceability — the metric behind the verdict

For an equipped piece, the **replacement pool** is the set of unequipped spares that could actually
take its place on this champion:

- same slot;
- **same main stat** (`statId` and `isFlat`) — a C.DMG glove is not replaced by an HP glove. For
  Weapon / Helmet / Shield, whose main is fixed by the slot, this filter is a natural no-op;
- **same faction**, for accessories only — a hard game constraint, and what makes accessories scarce;
- on a **demanded set**: `keepPremium(x.set) >= CUTS.focusPremium`.

`better` = pool members whose ceiling strictly exceeds this piece's, where ceiling is
`quality(item, true).score` (the level-independent score if finished to 6★+16).

`better` is used as an **absolute count**, read as "how many concrete upgrade paths do I have for
this slot". The fraction `better / pool` was tried and rejected: it compresses (Elhain's kept gloves
26% vs sold helmet 33% — no separation) because pool size itself carries the scarcity signal.

### Implementation note

Calibrating the cut points needs `better` for *every* equipped piece (4192 of them), so a naive
scan of the unequipped pool per piece is ~21M predicate evaluations. Index instead: bucket the
demanded-set unequipped pool by `slot | mainStatId | mainIsFlat` — plus `faction` for accessories —
and hold each bucket's ceilings in an ascending sorted array. `better` is then a binary search for
the first ceiling strictly greater than this piece's, giving `bucket.length - index`. Build is
O(n log n) once; each query is O(log n).

Keep the membership rule exported as a plain predicate (`inReplacementPool(candidate, item)`) even
though the hot path goes through the index — the predicate is what the tests assert against, and it
keeps the bucket key honest. `bucketKeyFor(item)` must be derivable from that same rule.

## Verdict

```
if triage says delete        -> SELL          (reason = triage's own reason)
else if better <= keepCut    -> KEEP
else if better >= sellCut    -> SELL
else                         -> BORDERLINE
```

### The triage override

`triage()` runs over the whole vault and its verdict wins outright. For equipped gear the only rule
that can fire is setless-domination — *"a set accessory you already own in the same faction + slot
scores at least as high"* — because `junkTrim` and `slotBalance` both skip equipped items.

This is load-bearing, not belt-and-braces. 488 of 4192 equipped pieces are setless-dominated, and
their `better` count is **median 0** — the replaceability metric inverts precisely those pieces. The
cause is a genuine gap: the pool is restricted to demanded sets, but `setlessDominated` compares
against *any* set-bearing accessory, including low-demand ones. Elhain's setless ring and banner are
this case (`better` 4 and 3, i.e. "irreplaceable", while the vault report already condemned both).

### Thresholds

Cut points are **runtime quantiles of the vault's own equipped gear**, not fixed counts, so they
self-calibrate as the vault grows. The population is every triage-`keep` equipped piece (3704 in the
2026-07-12 snapshot); the tunable constants are the quantiles:

```js
// weights.mjs, added to CUTS
gearKeepQuantile: 0.50,   // better <= p50 of equipped gear -> KEEP
gearSellQuantile: 0.75,   // better >= p75 -> SELL
roleGapFlag: 10,          // best-role score minus champ-role score, in points
```

The resolved values are printed in the run header so a run explains itself:

```
cuts: KEEP <=10 · SELL >=75   (p50/p75 of 3704 triage-keep equipped pieces)
```

**Global, not per-slot.** Per-slot quantiles were tested and are decisively worse: because the
weapon slot has p50=181, they rate a weapon with 149 upgrade paths as KEEP, and simultaneously demote
the gloves to BORDERLINE — inverting both of the decisions the tool exists to support. The slot bias
in the global cut is correct behaviour: you genuinely hold more spare weapons than spare gloves, so
weapons genuinely are more disposable.

## Role mismatch

A flag, not a verdict input.

```
gap = max over ALL_ROLES of qualityAtRole(item, r)  -  qualityAtRole(item, champRole)
flag when gap >= CUTS.roleGapFlag
```

It catches a piece whose stat profile suits a different archetype than its wearer — support gear on a
nuker. Note the max is over **all four roles**, unrestricted by the set annotation, because this is a
statement about the item's stats, not its set.

Threshold 10 sits at the shoulder of the distribution: 48% of equipped pieces have gap 0, p75 is 9,
and gap≥10 fires on ~25% vault-wide. On Elhain it fires zero times (max gap 4) — correct, since
those pieces were replaceable rather than miscast. An earlier definition based on set annotations
(flag when the champion's role isn't in the set's allowed roles) was rejected: it fired on 4 of
Elhain's 9 slots, mostly false alarms from `quality()` picking DEF-DPS for Cruel gear on a ceiling
quirk when Cruel permits ATK-DPS anyway.

### Required change to `score.mjs`

`quality()` currently only exposes the max over set-allowed roles. Extract the per-role body:

```js
export function qualityAtRole(item, role, potential = false) {
  const mc = potential ? mainFit(item, role) : mainComponent(item, role);
  const sc = potential ? subTypeFit(item, role) : subComponent(item, role);
  return Math.round(100 * (BLEND.main * mc + BLEND.sub * sc) / (BLEND.main + BLEND.sub));
}
```

and have `quality()` call it inside its existing loop. Behaviour-preserving refactor; no other
consumer changes.

## Output

Per champion, worst-first (SELL, BORDERLINE, KEEP; ties by descending `better`):

```
Elhain #110 — Attack (ATK-DPS) · Rare 6★ +60 · snapshot 2026-07-12-RSLHelper.db
cuts: KEEP <=10 · SELL >=75   (p50/p75 of 3704 triage-keep equipped pieces)

 SELL       Shield  Cruel        +12  q56  p8   ceil 80  5/6  prem 6
              392 upgrade paths — unequipped DEF-main shields on demanded sets with a higher ceiling
 SELL       Weapon  Lifesteal    +12  q63  p22  ceil 92  6/6  prem 1
              149 upgrade paths
 SELL       Helmet  Cruel        +16  q77  p51  ceil 89  6/7  prem 6
              106 upgrade paths
 SELL       Ring    (setless)    +16  q69  p67  ceil 96  2/7  prem 1   [High Elves]
              triage: setless — dominated by a set accessory in the same faction + slot
 SELL       Banner  (setless)    +12  q48  p19  ceil 93  3/6  prem 1   [High Elves]
              triage: setless — dominated by a set accessory in the same faction + slot
 BORDERLINE Boots   Guardian     +16  q70  p57  ceil 74  3/7  prem 1
              47 upgrade paths
 KEEP       Gloves  Lifesteal    +16  q78  p86  ceil 82  5/8  prem 1
              6 upgrade paths
 KEEP       Chest   Slayer       +16  q73  p61  ceil 86  4/7  prem 1
              1 upgrade path
 KEEP       Amulet  Slayer       +16  q59  p55  ceil 100 2/7  prem 1   [High Elves]
              0 upgrade paths
```

Columns: `q` = current `quality()` score, `p` = per-slot percentile (taken from the piece's `triage()`
record, so it matches the vault report), `ceil` = ceiling at 6★+16, `n/m` = good rolls (`rollStats`),
`prem` = `keepPremium(set)`. A role-gap flag appends `[role: better as Support, +14]` to the line.
Accessories carry their faction in trailing brackets.

Summary mode prints one line per geared champion:
`Elhain #110 (Attack)  9 slots · 5 SELL · 1 BORDERLINE · 3 KEEP`

## Error handling

| Case | Behaviour |
|---|---|
| no snapshot in `resources/` | stderr message pointing at `refresh.sh`, exit 1 |
| selector matches nothing | stderr with the closest name matches listed, exit 1 |
| selector matches only ungeared copies | note that N copies matched but hold no gear, exit 1 |
| selector matches several geared copies | analyse each, in `Champs.ID` order |
| `Champs.Role` unrecognised | role shown as `?`, role-gap flag suppressed, verdicts unaffected |
| empty `Champs.Name` | row filtered out before matching |

Corrupt artifact rows are already dropped by `readArtifacts()`.

## Testing

`oracle/analytics/__tests__/champion-gear.test.mjs`, following `spare-copies.test.mjs`'s row-factory
style:

- `champRole` — all four values, plus unrecognised → `null`.
- `inReplacementPool` — honours same-slot, same-main, demanded-set; applies the faction filter for
  accessories and *not* for artifacts.
- `bucketKeyFor` — two items agree on the key iff `inReplacementPool` accepts them (guards the index
  against drifting from the predicate).
- `betterCount` — strict `>` on ceiling, ties excluded.
- `verdictFor` — KEEP/BORDERLINE/SELL at both boundaries (`<=keepCut`, `>=sellCut`), and the triage
  override beating a `better` count of 0.
- `roleGap` — flags a support-statted piece on an Attack champion, does not flag at gap < threshold.
- `quantile` — empty array, single element, interpolation-free indexing.

Plus, in `score.test.mjs`: `qualityAtRole` agrees with `quality()` when maximised over the set's
allowed roles (guards the refactor).

Regression anchor: Elhain #110 against the 2026-07-12 snapshot reproduces 8 of 9 verdicts matching
the owner's real decisions, with Boots at BORDERLINE. This is documented here rather than asserted in
a test, since `oracle/resources/` snapshots are gitignored personal data.

## Rejected alternatives

- **Grade gear at the champion's role** instead of `quality()`'s best-of-set-role. Rejected: it
  would diverge from every other consumer of `score.mjs`. The mismatch flag carries that information
  without forking the scoring.
- **Per-slot quantile cuts.** Rejected on evidence — inverts the weapon and the gloves.
- **`better / pool` as a fraction.** Rejected — compresses, no separation between keep and sell.
- **Extract a shared `champs.mjs`** (mirroring `lib/decode.mjs`) and refactor `spare-copies.mjs` and
  `worst-artifacts.mjs` onto it. Deferred: it rewrites two working scripts and their tests for no
  gain this task needs. `CHAMP_ROLE` and the `Champs` reader are exported from `champion-gear.mjs`
  so promoting them later is a move, not a rewrite.
- **A per-champion section inside `analyze.mjs`.** Rejected: that report is a 816 KB batch artifact;
  this is an interactive lookup and would add ~500 unwanted sections.
- **Suggesting a swap-in spare for each SELL.** Deferred as a separate feature.
