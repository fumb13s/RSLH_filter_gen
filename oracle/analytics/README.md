# Gear Vault Analytics

Decodes a `../resources/*-RSLHelper.db` snapshot and rates the gear in it — vault-wide
(`analyze.mjs`) or one champion's worn gear at a time (`champion-gear.mjs`).
Design + rationale: `DESIGN.md`. Advisory only: `analyze.mjs` writes its reports to `out/`, and
`champion-gear.mjs` and `speed.mjs` only print. None of them writes to a snapshot or to the game's
own database, and nothing is ever deleted.

## Run

1. Build core: `npx tsc -b packages/core`
2. Vault-wide triage report:
   `node --experimental-sqlite oracle/analytics/analyze.mjs [path-to.db]`
   (defaults to the newest `../resources/*-RSLHelper.db`; writes `out/<date>-report.{json,md}`)
3. One champion's worn gear:
   `node --experimental-sqlite oracle/analytics/champion-gear.mjs [name|ID] [snapshot.db]`

   Rates each equipped piece KEEP / BORDERLINE / SELL. The vault report can't answer this — its
   delete passes skip equipped items, so worn gear always comes back "keep" on supply floors rather
   than merit. Verdicts here are driven by *replaceability*: how many unequipped spares are eligible
   to take the piece's place (same slot and main stat, same faction for accessories, on a demanded
   set) and would finish with a higher ceiling. "Eligible" is the whole test — see
   [what the upgrade-path count counts](#what-the-upgrade-path-count-counts).

   Neither argument is positional: an arg ending in `.db` or holding a path separator is the
   snapshot, and the first one that isn't is the selector. An all-digits selector is an exact
   `Champs.ID`; anything else is a case-insensitive name substring — `Elhain` reports Elhain,
   Supreme Elhain and Dark Elhain, one section per geared copy of each. Omit the selector entirely
   for a per-champion summary, most sellable first.
4. Fastest possible build for one champion:
   `node --experimental-sqlite oracle/analytics/speed.mjs <name|ID> [snapshot.db] --corpus PATH`

   Searches the whole vault for the item assignment that maximizes that champion's speed, and
   proves it is the maximum rather than a heuristic. `--glyph N` adds a second solve with every
   SPD substat glyph raised to at least N, clamped to what each rarity x rank has been seen to
   carry. `--base N` gives a champion's base speed directly — required for champions absent from
   the corpus, and enough on its own, since a run that supplies it looks nothing up. `--top N`
   prints the N best builds instead of only the winner, so a runner-up that costs one point of
   speed but frees six pieces of a set is visible rather than discarded.

   The vault it searches includes gear that is currently worn, since gear can be moved — so a build
   is not usually a set of spare pieces. Each item that would have to come off someone is marked
   `on <champion>`, and every build carries a line counting them. Solving several champions this way
   proposes the same physical pieces to each, and those builds cannot all be worn at once.

   The corpus of champion base speeds is an external local dataset — pass `--corpus PATH` or set
   `$RSLH_SPEED_CORPUS`. `speed.mjs verify` reports the distribution of unexplained flat speed across
   every geared champion — the size of the gap between the model and observed speed, which is
   dominated by per-copy sources the snapshot does not expose (relic, champion ascension). Read it as
   a health check on that gap. It is not a patch detector: the distribution is already wide and
   multi-modal, so a changed set value would move it less than the noise it already carries.

   Design: `docs/plans/2026-08-14-champion-speed-solver-design.md`.

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
- `5/8` — substat rolls that landed on a stat the *item's own* role wants, over all of them (a line
  counts as one roll, each upgrade into it adds another). That role is the one `q` was scored at —
  the best among those the item's set is built for — not the wearer's; `[role: better as …]` is
  where the two are compared.
- `prem` — the set's keep premium. The replacement pool only counts sets at or above
  `CUTS.focusPremium`, so an off-set spare is never treated as an upgrade path.
- `[Faction]` — accessories only; a replacement has to share it. `[role: better as …]` marks a
  piece scoring `CUTS.roleGapFlag` or more higher for another archetype than for its wearer's.

The second line is the evidence: an upgrade-path count, or the vault-triage rule that fired.

#### What the upgrade-path count counts

Every unequipped spare that matches the slot, the main stat and — for accessories — the faction,
sits on a set at or above `CUTS.focusPremium`, and out-ceilings this piece. Those are the only
filters. It does **not** exclude spares the vault report has itself condemned as delete, or spares
still sitting at +12 and needing to be finished before they could be worn. Of the 392 paths behind
Elhain's shield on the 2026-07-12 snapshot, 184 (47%) are on `analyze.mjs`'s own delete list and 126
are still at +12; vault-wide, a mean 11% of a piece's count is gear the vault report wants gone.

The cut points are quantiles of that same measure, so the bias is common to both sides of the
comparison and washes out of the verdict — excluding condemned spares and recalibrating moves only
107 of 4192 verdicts. Read the number as this piece's replaceability *relative to the rest of the
vault*, not as a literal count of replacements ready to equip.

### Calibration

Cut points are quantiles of the vault's own triage-keep equipped gear (p50 keeps, p75 sells), so
they self-calibrate as it grows rather than encoding one account's idea of "a lot of spares". The
header line prints them with the population they came off.

A thin population must not condemn, so the SELL band is "at or above p75 **when p75 is positive**".
A small or new vault, where most worn gear has no strictly-better spare at all, produces a p75 of 0
— which would otherwise sell every piece with a single upgrade path. Those fall to BORDERLINE
instead, still carrying the count. Three thinner cases: at `n = 0` there is no population at all, so
every piece *the triage hasn't already condemned* keeps, reading `uncalibrated: nothing to compare
against`; `n = 1` calibrates off a single sample; and `keepCut = sellCut` collapses the BORDERLINE
band. The last two are left as benign — KEEP wins the tie, so they fail safe.

That qualifier on `n = 0` is not decoration. The triage override is checked before the uncalibrated
branch, so a condemned piece still comes back SELL — and `n = 0` is only reachable through
`buildContext` when every equipped piece was already condemned. In the one case that can actually
occur, nothing keeps.

Above all of it, the vault-wide `triage()` verdict overrides outright. For equipped gear the only
rule that can fire is setless domination, and it is load-bearing: those pieces sit at a median of 0
upgrade paths, because the replacement pool counts only demanded sets while the triage rule compares
against any set-bearing accessory. Without the override the metric inverts exactly those pieces.

## Test
Folded into the repo suite — `npm test` (or just analytics: `npx vitest run oracle/analytics`).

`out/` and `findings/` are gitignored (derive from personal account data).
