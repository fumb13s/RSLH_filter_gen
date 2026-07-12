# Gear Vault Analytics — Design

Status: design approved (co-authored 2026-06-06). Implementation pending.

## 1. Purpose

Analyze the account's RSL Helper artifact snapshot to answer two questions:

1. **What to focus on** — which pieces are worth ascending / rerolling / keeping.
2. **What to delete** — which pieces are safe to sell to relieve inventory pressure
   (especially accessories).

Two deliverables:

- **A rerunnable tool suite** over `RSLHelper.db` (decode → census → supply → score →
  triage), emitting machine-readable JSON + a human summary.
- **An interactive analysis writeup** of the *current* snapshot, co-authored from the tool
  output (findings + concrete recommendations). One per snapshot; dated.

Everything is **advisory** — the tools never delete anything. They produce ranked lists and
reasons; the human decides.

## 2. Data source

- `oracle/resources/RSLHelper.db` — the live account DB (gitignored; personal account data).
  ~8,057 rows in the `Artifacts` table.
- Read via `node:sqlite` (`--experimental-sqlite`, `DatabaseSync`; integer columns come back
  as **BigInt** → coerce with `Number()`).
- **Decode logic is already solved** in `oracle/probe/probe.mjs` and must be factored into a
  shared module (see §7). Reference:
  - value: `raw / 2**32`, then `×100` when the stat is a percentage (CR/CDMG always; HP/ATK/DEF
    only when not flat). SPD/RES/ACC never ×100.
  - `isFlat = (flag != 0)`; slot = `type` (identity 1–9); set = `aset`; faction = `accset`
    (accessories only); rarity 1–6 (our index = `rarity − 1`); rank 1–6; level = `lvl`.
  - DB stat enum → our stat id: `{1:1,2:2,3:3,4:4,5:7,6:8,7:5,8:6}`.
  - **Glyph values decode exactly like substat values** (same `/2**32`, ×100 for %). Columns
    `s1gv..s4gv`; `mgv` (main glyph) is effectively unused — ignore.
  - Ascension: `ASCLEVEL` (0–6; `−1` = not ascended). Fully ascended = `ASCLEVEL == 6`.
- **Filter ~2–4 corrupt sentinel rows up front**: negative `ID`, `rarity` out of 1–6, `rank`
  out of 1–6 (observed garbage: `rarity −596644544`, `rank 223`).

## 3. Model

### 3.1 Roles (champion archetypes)

Four roles, each with core (full-weight) and secondary (partial) wanted substats. **SPD is
universal** (top weight in every role).

| Role | Core subs | Secondary |
|---|---|---|
| **ATK-DPS** | SPD · C.Rate · C.Dmg · ATK% | ACC |
| **DEF-DPS** | SPD · C.Rate · C.Dmg · DEF% | ACC |
| **HP-DPS**  | SPD · C.Rate · C.Dmg · HP%  | ACC |
| **Support** | SPD · HP% · DEF% · RES · ACC | — |

"DPS" in the set table below = all three DPS scalings. "All" = all four roles.

### 3.2 Set annotations (the co-authored data)

Each set carries `roles[]`, `scarcity` (1–5, how hard to *obtain*), and `demand` (1–5, how
*wanted*). Scarcity and demand are **independent axes**. This table is the canonical record;
it becomes a data file the tools read (§7). IDs are game set ids (`aset`).

| id | Set | Roles | Scar | Dem |
|---:|---|---|:--:|:--:|
| 1 | Life | HP-DPS, Support | 3 | 1 |
| 2 | Offense | ATK-DPS | 3 | 1 |
| 3 | Defense | DEF-DPS, Support | 3 | 1 |
| 4 | Speed | All | 3 | 3 |
| 5 | Crit Rate | DPS | 3 | 1 |
| 6 | Crit Damage | DPS | 3 | 1 |
| 7 | Accuracy | Support | 3 | 1 |
| 8 | Resistance | Support | 3 | 1 |
| 9 | Lifesteal | DPS | 3 | 1 |
| 10 | Fury | ATK-DPS | 3 | 1 |
| 11 | Daze | Support | 3 | 1 |
| 12 | Cursed | Support | 3 | 1 |
| 13 | Frost | Support | 3 | 1 |
| 14 | Frenzy | Support | 3 | 1 |
| 15 | Regeneration | Support | 3 | 2 |
| 16 | Immunity | Support | 3 | 1 |
| 17 | Shield | Support | 3 | 2 |
| 18 | Relentless | All | 5 | 3 |
| 19 | Savage | DPS | 3 | 3 |
| 20 | Destroy | DPS | 3 | 1 |
| 21 | Stun | Support | 3 | 2 |
| 22 | Toxic | DPS, Support | 3 | 1 |
| 23 | Provoke | Support | 3 | 2 |
| 24 | Retaliation | Support | 3 | 1 |
| 25 | Avenging | DPS | 3 | 1 |
| 26 | Stalwart | Support | 3 | 1 |
| 27 | Reflex | Support | 3 | 2 |
| 28 | Curing | Support | 3 | 1 |
| 29 | Cruel | DPS | 5 | 3 |
| 30 | Immortal | Support | 5 | 1 |
| 31 | Divine Offense | ATK-DPS | 3 | 1 |
| 32 | Divine Crit Rate | DPS | 3 | 1 |
| 33 | Divine Life | HP-DPS, Support | 3 | 1 |
| 34 | Divine Speed | All | 5 | 3 |
| 35 | Swift Parry | All | 5 | 3 |
| 36 | Deflection | Support | 5 | 3 |
| 37 | Resilience | Support | 3 | 1 |
| 38 | Perception | Support | 3 | 2 |
| 40 | Untouchable | Support | 3 | 1 |
| 41 | Fatal | ATK-DPS | 3 | 1 |
| 44 | Guardian | Support | 3 | 1 |
| 45 | Fortitude | Support | 3 | 1 |
| 46 | Lethal | DPS | 4 | 4 |
| 47 | Protection | Support | 4 | 4 |
| 48 | Stone Skin | All | 4 | 4 |
| 49 | Killstroke | DPS | 4 | 1 |
| 50 | Instinct | DPS | 4 | 1 |
| 51 | Bolster | Support | 4 | 2 |
| 52 | Defiant | Support | 4 | 1 |
| 53 | Impulse | All | 5 | 4 |
| 54 | Zeal | DPS | 5 | 3 |
| 57 | Righteous | Support | 4 | 2 |
| 58 | Supersonic | Support | 4 | 3 |
| 59 | Merciless | All | 4 | 3 |
| 60 | Slayer | DPS | 4 | 1 |
| 61 | Feral | All | 4 | 3 |
| 62 | Pinpoint | All | 5 | 3 |
| 63 | Stonecleaver | ATK-DPS | 3 | 1 |
| 64 | Rebirth | Support | 3 | 1 |
| 65 | Chronophage | All | 4 | 3 |
| 66 | Mercurial | All | 5 | 5 |
| 1000 | Refresh | All | 5 | 2 |
| 1001 | Cleansing | All | 3 | 1 |
| 1002 | Bloodshield | All | 3 | 1 |
| 1003 | Reaction | All | 5 | 3 |
| 1004 | Revenge | DPS, Support | 4 | 3 |
| 0 | *(setless)* | — | 3 | 1 |

Notes:
- **Setless** (`aset 0`) = legacy Spider-dungeon accessories. Still farmable (scarcity 3) but
  **dominated** by any set accessory (demand 1). Special handling in §3.5.
- `Fortitude` (45) is annotated but currently absent from the vault — kept for future snapshots.
- Sets not in the table (future / unowned) fall back to `roles: All, scarcity 3, demand 3` and
  are flagged "unannotated" in output so they're easy to spot and triage by hand.
- The table is **living data** — expect to revisit roles/scarcity/demand as the meta shifts and
  as the tool surfaces surprises.

### 3.3 Quality score (intrinsic, per piece → 0–100)

> **⚠️ Superseded — see §10 (Addendum, 2026-06-07).** Implementation revealed this
> mean-normalized model saturated badly (82% of rings scored exactly 100) and never actually
> wired in the main stat. It was rebuilt as a value-based model. This section is kept verbatim
> as the original design record; the as-built scoring is §10.

`bestRole(piece) = argmax over the set's roles` — this is the **synergy mechanism**: a crit
substat is weighted by the role that fits the set best. On a DPS set crit uses DPS weights
(high); on a Support-only set crit uses Support weights (low). Setless and "All" sets evaluate
`bestRole` over all four roles.

Components:

1. **Substat quality** — `Σ_subs desirability[bestRole][stat, isFlat] × rollWeight(sub)`.
   - `desirability` is a tunable **role × stat** matrix (defaults in §6). Flat variants get low
     desirability, **but** the score is then **normalized against the best achievable substat
     profile for that slot** (from `SLOT_STATS`). So an amulet — whose subs are flat by design —
     is judged against other amulets, not against artifacts' %-subs. This is how "flat is only
     penalized where a % was possible" is realized.
   - `rollWeight(sub)` rewards upgrade rolls that landed in the sub (more invested rolls in a
     wanted stat = better).
2. **Roll efficiency** — fraction of the piece's total upgrade rolls that landed in
   `bestRole`-wanted subs (catches "good stats but the rolls went elsewhere").
3. **Main-stat fit** — slot- and role-relative bonus (an ATK-DPS wants an ATK%/crit main on
   gloves/chest/boots; a DEF-DPS wants DEF%; accessories' mains are largely fixed → minimal
   weight).

Output normalized to 0–100, reported as a **per-slot percentile** as well as the raw score
(so "top of slot" is meaningful regardless of absolute scale).

### 3.4 Investment flag (badge, never an exclusion)

Nothing is removed from delete consideration — investment is *displayed* so the human reviews
high-investment pieces carefully. Per piece:

- 💎 **Fully ascended** — `ASCLEVEL == 6`.
- 🔹 **Highly glyphed** — any substat with a decoded glyph at/above: **SPD ≥ +4**, **any %-stat
  ≥ +5**, **ACC or RES ≥ +8**.

**Equipped is context, not protection** (the mule technique — junk parked on unused champs for
storage). We show *which* champ a piece is on (join `Champs` by `cID`); judging real-vs-mule is
a champ-demand refinement (§9).

### 3.5 Supply (inventory saturation)

- **Accessories** bucketed by **(faction × slot)** where faction = raw `accset`. Bucketing by
  the raw id is correct regardless of the deferred faction *naming* question (§9) — counts and
  champ matches (`champ.Fraction == accset`) use the same id space; only display labels are
  provisional.
- **Artifacts** bucketed by **(slot × set)** (and rolled up by slot for the census).
- **Keep-floor** — a below-floor bucket is never nominated for deletion, even at low quality.
  Counts **only unequipped** pieces (worn is excluded, so the floor protects *spares*; a worn mule
  piece is still judged on its own merits). The two slot families use different floor shapes —
  demand-scaling is the artifact analog of the accessory faction split:
  - **Accessories**: flat **4** per **(faction × slot × set)**, **excluding setless** (no floor —
    freely cullable). **No demand scaling** — accessories are already oversupplied; faction
    bucketing alone subdivides their supply.
  - **Artifacts**: **`4 × demand`** per **(slot × set)** — no faction dimension, so demand-scaling
    takes its place (keep more spares of high-demand artifact sets).
- **Setless-dominated rule:** a setless accessory is a strong delete candidate when a
  set-bearing accessory in the **same (faction × slot)** has quality ≥ it ("as soon as you can
  match the stats with a real set, the setless one is redundant").

### 3.6 Keep-premium (scarcity + demand → how hard to cull)

**Demand-led.** Scarcity only protects a piece *in the presence of demand* — otherwise rare-but-
worthless sets (Setless 3/1; Immortal 5/1; Slayer/Instinct/Defiant 4/1) would be wrongly
shielded. Default rule (tunable):

- base keep-pressure = `demand`.
- add a scarcity bonus **only when `demand ≥ 3`**.

High keep-pressure ⇒ raise the quality bar before deleting + raise the supply floor. Low-demand
sets cull at low quality regardless of scarcity.

### 3.7 Triage (combine)

- **Focus** = high quality (top of slot) **and** worth investing (high demand, or scarce with
  demand) — the pieces to ascend / reroll / build around.
- **Delete candidate** = low quality (below cut line) **and** bucket above its floor **and** low
  keep-premium; plus all setless-dominated accessories. Each delete row shows its **reason** and
  its **investment badge**. A second **slot-balance** pass (§3.8) then trims for inventory evenness.
- **Keep (default)** = everything else.

All thresholds are parameters (§6); the human reviews the ranked lists.

### 3.8 Slot-balance (even the unequipped pool)

A second delete pass that evens **unequipped** inventory across slots, so the kept pool isn't
dominated by the structurally over-supplied slots (Weapon/Shield from fixed mains; Amulet/Banner
from the 17-faction split). **Artifacts** (6 slots) are evened as one family. **Accessories** (3 slots)
are evened **per faction**: ring/amulet/banner are faction-locked gear, so each faction is balanced
against *its own* mean kept-unequipped count rather than the pooled accessory total — cross-faction
totals are intentionally left alone (a faction with more usable champions keeps more accessories).
The per-slot cap = the relevant pool's (artifact family / per-faction accessory) **mean kept-unequipped**
count, then deletes **worst-quality-first** down to the cap. Protections: equipped mules are excluded
(not part of the unequipped pool); **invested** (💎 ascended / 🔹 glyphed) pieces are never trimmed;
and the §3.5 **keep-floor** still binds (no bucket drops below its floor). `balanceFactor` (§6) scales
the cap — `<1` more aggressive, `>1` gentler, `0` disables. On the current snapshot this caps the tall
artifact slots (Helmet/Weapon/Shield) at ~275 while leaving the short slots (Gloves/Chest/Boots) alone,
and within each faction trims the oversupplied amulets/banners toward that faction's scarcer ring
count. Because the keep-floor binds per faction × slot × set, heavily-multi-set factions stay somewhat
lopsided — the floor, not the cap, is the binding constraint for tight per-faction parity.

## 4. Census (descriptive, no judgment)

The first tool output and the opening of the writeup: distributions across slot, set, rarity,
rank, level, equipped (`cID`), ascension, glyphed, and per-(faction × slot) accessory buckets.
Reconciliation check: counts sum to the filtered row total. Known starting facts from the
current snapshot: 8,057 rows; 4,094 equipped; 1,182 fully ascended; 3,113 with ≥1 substat
glyph; 3,283 accessories incl. **728 setless** (the headline cull target).

## 5. Deliverable architecture

### 5.1 Tool suite — `oracle/analytics/`

Plain Node ESM. Each tool reads the DB (or a decoded cache) and emits JSON + a printed summary;
tools compose so the human can run one stage or the whole pipeline.

- **`lib/decode.mjs`** — factored out of `probe.mjs`: open DB, filter corrupt rows, decode each
  row into a canonical `Item` (`{id, slot, set, rank, rarity, level, faction, mainStat,
  substats[], glyphs[], ascLevel, equippedChampId}`). Single source of truth for decoding.
- **`lib/sets.mjs`** (or `sets.json`) — the §3.2 annotation table.
- **`lib/weights.mjs`** — the §6 tunable parameters (role×stat matrix, thresholds, floors).
- **`census.mjs`** — §4 distributions.
- **`supply.mjs`** — §3.5 bucket counts, saturation, setless-dominated detection.
- **`score.mjs`** — §3.3 quality + §3.4 investment flag per piece.
- **`triage.mjs`** — §3.6–3.8: focus list + delete list (junk + slot-balance) with reasons.
- **`analyze.mjs`** — orchestrates all of the above; writes `out/<snapshot-date>-report.json` +
  `out/<snapshot-date>-report.md`. With no arg it analyzes the newest `resources/*-RSLHelper.db`.
- **`refresh.sh`** — **manual** snapshot refresh: copies the live RSL Helper DB
  (`…/AppData/Roaming/RslHelper/Config/*_RSLHelper.db`, or `RSLHELPER_DB=`) into
  `resources/<date>-RSLHelper.db`, integrity-checks it, and stops. RSL Helper holds the live file
  open, so a sequential `cp` is required (a direct sqlite open hits `SQLITE_NOTADB`). Run
  `analyze.mjs` yourself afterwards — deliberately not chained.
- **`compare.mjs`** — diff two `out/<date>-report.json` snapshots (the two newest by default):
  roster churn (acquired/sold), census + recommendation deltas, focus/upgrade membership changes,
  leveled-up pieces, biggest quality swings.
- **`set-analysis.mjs`** — ore-aware worth/garbage analysis for one set's corpus. Ore re-randomizes
  a piece's main + substat types/values but preserves each substat's **roll count**, so the ceiling
  is set by roll concentration: a `≥ORE_ROLLS`-roll substat is a re-aimable "gem"; a spread piece
  can't be made elite even by a perfect ore. Honors the §3.5 keep-floor (below-floor accessories are
  faction/supply spares, not garbage). Tiers: elite / ore-gem / scarce-slot / floor-protected / garbage.

**Dating convention:** snapshots, reports, and findings are all prefixed with the **account-data
date** (the live DB's last-write day), *not* the day the tool was run — so re-analyzing an old
snapshot keeps its true date. `analyze.mjs` reads that date from the snapshot's filename prefix
(falling back to its mtime).

`oracle/analytics/out/` and `resources/` are gitignored (derived from / containing the personal DB).

### 5.2 Interactive analysis writeup

`oracle/analytics/findings/<snapshot-date>.md` — co-authored from the tool output: census highlights,
the biggest cull levers (setless 728; low-demand oversupplied buckets), the focus list, and
concrete recommendations. Also gitignored (reflects personal inventory).

## 6. Parameters (defaults; all tunable in `lib/weights.mjs`)

- **Role × stat desirability** (0–1; SPD = 1.0 everywhere). **Hard rule: every % stat outranks
  every flat stat** — "flat" here = flat HP/ATK/DEF (the variants that have a % counterpart);
  SPD/ACC/RES have no % form and are weighted on role-usefulness.
  - ATK-DPS: CR .9, CD .9, ATK% .8, ACC .5, DEF% .2, HP% .2, RES .15, flat HP/ATK/DEF .1
  - DEF-DPS: CR .9, CD .9, DEF% .8, ACC .5, ATK% .2, HP% .2, RES .2, flat HP/ATK/DEF .1
  - HP-DPS:  CR .9, CD .9, HP% .8, ACC .5, ATK% .2, DEF% .2, RES .2, flat HP/ATK/DEF .1
  - Support: HP% .8, RES .7, ACC .7, DEF% .6, CR .25, CD .25, ATK% .25, flat HP/ATK/DEF .15
    (RES > DEF% for supports)
- **Investment glyph thresholds**: SPD +4, %-stat +5, ACC/RES +8; ascended = `ASCLEVEL 6`.
- **Supply floor** (below-floor ⇒ not a delete candidate), counting unequipped only (worn excluded):
  - Accessories: flat **4** per (faction × slot × set), excluding setless — no demand scaling.
  - Artifacts: **`4 × demand`** per (slot × set).
- **Cut lines**: delete below slot-percentile 25; focus at/above slot-percentile 85 (starting
  points — calibrate against the snapshot).
- **Keep-premium**: pressure = `demand + (demand ≥ 3 ? scarcity − 2 : 0)`.

These defaults are starting points; calibration against the real snapshot is an explicit
implementation step, reviewed before the writeup is finalized.

## 7. Testing

- **Decode** is the one piece that must be exactly right → unit-test `lib/decode.mjs` against
  the existing **`oracle/known-gear.db` + `known-gear.manifest.json`** (24 hand-verified
  artifacts with decoded values across all 9 slots).
- **Scoring** — unit-test on hand-built pieces: a SPD/crit DPS piece on a DPS set scores high;
  the same subs on a Support-only set score low (synergy); a flat-stat amulet is **not**
  penalized for being flat (slot normalization); a flat-stat chest **is**.
- **Census** — reconciliation assertion (bucketed counts == filtered total).
- Lives under `oracle/analytics/__tests__/` and runs in the existing vitest setup, or as a
  standalone node test if pulling the gitignored DB into vitest is awkward.

## 8. Non-goals (YAGNI)

- No automatic deletion — advisory only.
- No web UI — CLI + markdown report.
- No attempt to model every set perfectly; the annotation table is data, tuned over time.
- No champ-demand modeling in v1 (see §9).

## 9. Deferred / open

- **Champ-demand overlay** — real-vs-mule equipped detection, faction/set demand from the 2,076-
  champ roster (join by raw `accset`/`Fraction`). Would make "reasonable supply per faction"
  precise. Phase 2.
- **Faction id-space naming** — release-order vs game-internal id for ids 13–17. Bucketing and
  champ matching are unaffected (same raw id space); only human-readable faction *labels* are
  provisional until resolved.
- **SFC maxed-Legendary-artifact protection** — a separate oracle investigation, unrelated to this
  tool's `.hsf`-correct evaluation.

## 10. Addendum — value-based scoring v2 (2026-06-07)

> **Supersedes §3.3** (quality score) and **extends §6** (adds a second weight matrix +
> mechanics-derived maxima). Everything else stands unchanged: §3.1 roles, §3.2 set table,
> §3.4 investment, §3.5 supply, §3.6 keep-premium, §3.7 triage, §4 census. The sections above
> are preserved verbatim as the original design record; this is the **as-built** model.

Building §3.3 surfaced two fatal flaws, so the quality score was rebuilt from the game's roll
mechanics rather than a normalized mean.

### 10.1 Why §3.3 was rebuilt

- **Saturation.** §3.3 divided a roll-weighted *mean* substat desirability by the *mean* of a
  slot's top-4 achievable desirabilities. A mean is not a valid upper bound for a weighted mean,
  and it under-shoots most where a slot's stats are least uniform — so **82% of rings, 63% of
  banners, 49% of amulets scored exactly 100**, "focus" could only fire on the variable-main
  artifact slots, and per-slot percentiles were meaningless wherever scores piled at the ceiling.
- **The main stat was never wired in.** §3.3 listed "main-stat fit" as a component but the build
  shipped substats-only, so a flat-DEF-main boots with good subs outscored a SPD-main boots
  (q100 vs q19) — exactly backwards.

### 10.2 Decode prerequisite — the 6th roll event

A substat accrues up to **6 roll events**: reveal + Mythical's bonus starting roll + 4 upgrades.
The decoder read only `sNlvlid` (reveal + upgrades), silently dropping the Mythical bonus
`sNmlvlid` (e.g. SPD subs capped at 30 instead of 34, 0 subs ≥ 31 instead of 5). Fixed:
`value = decode(sNlvlid + sNmlvlid)`. (Main stats get **no** Mythical bonus — a main's value is a
function of rank + level only, not rarity, confirmed against the vault.)

### 10.3 Two desirability matrices (main ≠ sub)

A stat's worth as a **main** differs from its worth as a **substat**, so there are two role×stat
matrices:

- **Substat `WEIGHTS`** (crit-led; §6) — unchanged. C.RATE = C.DMG as subs (you need crit rate to
  crit); flat HP/ATK/DEF = 0.1.
- **Main `MAIN_WEIGHTS`** (new): SPD 1.0 > **C.DMG 0.95 > C.RATE 0.9** > **dmg% 0.8** > ACC 0.5 >
  off-% 0.2 > RES 0.15 > flat 0.1. Support: **HP% = ACC = RES = 0.8** (equal "in general"),
  DEF% 0.6, SPD 1.0. (`dmg%` = ATK%/DEF%/HP% for ATK/DEF/HP-DPS.)
- **Flat accessory main → %**: a flat HP/ATK/DEF *main* on a Ring/Amulet/Banner is a large
  absolute stat, so it is scored as its % counterpart; on an artifact a flat main stays low.

### 10.4 Value-completeness (magnitude is neutralized)

Every stat contributes `desir × (value / theoreticalMax)`: the value is first normalized to
[0,1] against **its own** ceiling, *then* weighted. Raw magnitude can't leak in — a maxed flat HP
(3390) and a SPD (36) both read as "1.0 complete", and desirability does the ranking. A stat's
contribution therefore lives in `[0, desir]`: flat HP can never exceed **0.10** no matter the
number, while a single base SPD roll already contributes 0.17.

- `mainMax(slot, stat)` — actual 6★ / +16 main ceilings, a small validated table (`mainstats.mjs`).
- `subMax(stat) = MAX_ROLLS × maxPerRoll@6★` from core's `ROLL_RANGES`, with `MAX_ROLLS = 6`.
  **Theoretical, not empirical** — a luckier future roll can never break the ceiling, so results
  are reproducible across snapshots.

### 10.5 The substat ceiling (`subCeiling`)

The subComponent denominator is the **best *achievable* substat lineup** for the slot+role,
computed from the roll budget (`rolls.mjs`): take the 4 highest-desirability achievable substats,
then spend the budget (`STARTING_SUBSTATS` + `UPGRADE_LEVELS` = 9 events, one sub capped at
`MAX_ROLLS`) greedily on the highest-desirability sub → rolls `[6,1,1,1]`, summed as
desirability-weighted completeness.

- **Slot-relative**: boots ceiling ≈ 1.43 (SPD + 2 crits + dmg%), ring ≈ 0.88 (only HP/ATK/DEF).
  A ring is judged against what a *ring* can be, so flat-bound slots aren't unfairly crushed.
- **Main-excluded**: a substat can never duplicate the main, so the item's main is removed from
  the achievable pool (a SPD-main boots' subs are judged against the best *non-SPD* lineup). This
  is why even a perfect boots tops out below 100 — SPD can be main *or* sub, not both.

### 10.6 The score

For each role in the set's roles, then argmax over roles:

```
mainComponent = mainFit × (mainValue / mainMax),  mainFit = mainDesir / maxMainDesir(slot, role)
subComponent  = Σ_subs desir × (subValue / subMax)  ÷  subCeiling(slot, role, exclude = main)
quality       = 100 × (W_main · mainComponent + W_sub · subComponent) / (W_main + W_sub)
```

Both components are value-completeness in [0,1]; `subComponent` is clamped to 1. `W_main : W_sub =
1 : 1` (`BLEND`).

### 10.7 The blend principle

`W` is constrained by one rule: **best main + bad subs must rank below second-best main + perfect
subs** (a SPD-main boots with junk subs is worth less than an ATK%-main boots that's perfectly
rolled). Because the main tiers are deliberately close (1.0 / 0.95 / 0.9 / 0.8), this holds for
`W_main : W_sub` up to ~4:1; **1:1** is chosen — intuitive and well clear of the boundary.

### 10.8 Result

Saturation eliminated (**0%** at q100 on every slot), focus spans all 9 slots, the SPD-boots
misranking is inverted correctly (SPD boots 55 > flat-DEF boots 47), the cheap-vs-invested ring
collapse is resolved (74 vs 18, was 100 vs 100). Real maxima land at ~91–95 — a perfect item
(best main *and* fully-maxed subs) is unreachable, so 100 is asymptotic.

### 10.9 Code map

`weights.mjs` (`WEIGHTS`, `MAIN_WEIGHTS`, `BLEND`) · `mainstats.mjs` (`mainMax`) ·
`rolls.mjs` (`MAX_ROLLS`, `subMax`, `subCeiling`) · `score.mjs` (`desir`, `mainDesir`, `quality`).
