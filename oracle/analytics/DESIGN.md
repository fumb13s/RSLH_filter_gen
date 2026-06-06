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

`bestRole(piece) = argmax over the set's roles` — this is the **synergy mechanism**: a crit
substat is weighted by the role that fits the set best. On a DPS set crit uses DPS weights
(high); on a Support-only set crit uses Support weights (low). Setless and "All" sets evaluate
`bestRole` over all four roles.

Components:

1. **Substat quality** — `Σ_subs desirability[bestRole][stat, isFlat] × rollWeight(sub)`.
   - `desirability` is a tunable **role × stat** matrix (defaults in §6). Flat variants get low
     desirability, **but** the score is then **normalized against the best achievable substat
     profile for that slot** (from `SLOT_STATS`). So an amulet — whose subs are flat by design —
     is judged against other amulets, not against armor's %-subs. This is how "flat is only
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
- **Armor** bucketed by **(slot × set)** (and rolled up by slot for the census).
- **Keep-floor** — a below-floor bucket is never nominated for deletion, even at low quality.
  Counts **only unequipped** pieces (worn is excluded, so the floor protects *spares*; a worn mule
  piece is still judged on its own merits). The two slot families use different floor shapes —
  demand-scaling is the armor analog of the accessory faction split:
  - **Accessories**: flat **4** per **(faction × slot × set)**, **excluding setless** (no floor —
    freely cullable). **No demand scaling** — accessories are already oversupplied; faction
    bucketing alone subdivides their supply.
  - **Armor**: **`4 × demand`** per **(slot × set)** — no faction dimension, so demand-scaling
    takes its place (keep more spares of high-demand armor sets).
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
  its **investment badge**.
- **Keep (default)** = everything else.

All thresholds are parameters (§6); the human reviews the ranked lists.

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
- **`triage.mjs`** — §3.6–3.7: focus list + delete list with reasons.
- **`analyze.mjs`** — orchestrates all of the above; writes `out/report.json` +
  `out/report.md`.

`oracle/analytics/out/` is gitignored (derived from personal DB).

### 5.2 Interactive analysis writeup

`oracle/analytics/findings/YYYY-MM-DD.md` — co-authored from the tool output: census highlights,
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
  - Armor: **`4 × demand`** per (slot × set).
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
- **SFC maxed-Legendary-armor protection** — a separate oracle investigation, unrelated to this
  tool's `.hsf`-correct evaluation.
