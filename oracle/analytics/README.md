# Gear Vault Analytics

Decodes a `../resources/*-RSLHelper.db` snapshot and rates the gear in it — vault-wide
(`analyze.mjs`) or one champion's worn gear at a time (`champion-gear.mjs`).
Design + rationale: `DESIGN.md`. Advisory only: `analyze.mjs` writes its reports to `out/` and
`champion-gear.mjs` only prints. Neither writes to a snapshot or to the game's own database, and
nothing is ever deleted.

## Run

1. Build core: `npx tsc -b packages/core`
2. Vault-wide triage report:
   `node --experimental-sqlite oracle/analytics/analyze.mjs [path-to.db]`
   (defaults to the newest `../resources/*-RSLHelper.db`; writes `out/<date>-report.{json,md}`)
3. One champion's worn gear:
   `node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]`

   Rates each equipped piece KEEP / BORDERLINE / SELL. The vault report can't answer this — its
   delete passes skip equipped items, so worn gear always comes back "keep" on supply floors rather
   than merit. Verdicts here are driven by *replaceability*: how many unequipped spares could
   actually take the piece's place (same slot and main stat, same faction for accessories, on a
   demanded set) and would finish with a higher ceiling.

   Neither argument is positional: an arg ending in `.db` or holding a path separator is the
   snapshot, and the first one that isn't is the selector. An all-digits selector is an exact
   `Champs.ID`; anything else is a case-insensitive name substring — `Elhain` reports Elhain,
   Supreme Elhain and Dark Elhain, one section per geared copy of each. Omit the selector entirely
   for a per-champion summary, most sellable first.

### Reading a champion report

```
 KEEP       Gloves  Lifesteal     +16  q78  p86  ceil  82  5/8  prem 1
              6 upgrade paths
```

- `q` / `p` — quality as the piece stands (0–100), scored at its best role among those its set is
  built for, and where that lands against every other piece in the same slot.
- `ceil` — quality at *potential*: substat types only, level-independent. Replacements are compared
  on this, not on `q`, because a spare would have to be leveled from scratch — the question is
  which of them finishes better, not which is further along today.
- `5/8` — substat rolls that landed on a stat the role wants, over all of them (a line counts as
  one roll, each upgrade into it adds another).
- `prem` — the set's keep premium. The replacement pool only counts sets at or above
  `CUTS.focusPremium`, so an off-set spare is never treated as an upgrade path.
- `[Faction]` — accessories only; a replacement has to share it. `[role: better as …]` marks a
  piece scoring `CUTS.roleGapFlag` or more higher for another archetype than for its wearer's.

The second line is the evidence: an upgrade-path count, or the vault-triage rule that fired.

### Calibration

Cut points are quantiles of the vault's own triage-keep equipped gear (p50 keeps, p75 sells), so
they self-calibrate as it grows rather than encoding one account's idea of "a lot of spares". The
header line prints them with the population they came off.

A thin population must not condemn, so the SELL band is "at or above p75 **when p75 is positive**".
A small or new vault, where most worn gear has no strictly-better spare at all, produces a p75 of 0
— which would otherwise sell every piece with a single upgrade path. Those fall to BORDERLINE
instead, still carrying the count. Three thinner cases: at `n = 0` there is no population at all and
every piece keeps, reading `uncalibrated: nothing to compare against`; `n = 1` calibrates off a
single sample; and `keepCut = sellCut` collapses the BORDERLINE band. The last two are left as
benign — KEEP wins the tie, so they fail safe.

Above all of it, the vault-wide `triage()` verdict overrides outright. For equipped gear the only
rule that can fire is setless domination, and it is load-bearing: those pieces sit at a median of 0
upgrade paths, because the replacement pool counts only demanded sets while the triage rule compares
against any set-bearing accessory. Without the override the metric inverts exactly those pieces.

## Test
Folded into the repo suite — `npm test` (or just analytics: `npx vitest run oracle/analytics`).

`out/` and `findings/` are gitignored (derive from personal account data).
