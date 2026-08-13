# Battle-log capture and ingest — design

**Date:** 2026-08-12
**Status:** implemented — `oracle/battlelogs/`: `lib/codec.mjs`, `lib/summarize.mjs`,
`lib/capture.mjs` (the capture pass and the startup reconcile), `watch.mjs` (the poller),
`rebuild-index.mjs` (replay the archive into a fresh index). Where the shipped behaviour differs
from what is described below, the text has been corrected to match the code.

## Motivation

A recent RSL Helper build writes per-battle logs to
`%APPDATA%/RslHelper/battlelogs/<account>/YYYYMMDD_HHMMSS_live.jsonl.z` — zlib-compressed JSONL, one
file per battle, carrying the full turn-by-turn state: team composition with champion instance ids,
per-champion stats, buffs/debuffs, and a damage/heal/effect event stream. This is a data source the
repo has never had: everything in `oracle/` to date reads the *static* `RslHelper.db` vault snapshot,
which says what gear exists but nothing about how it performs.

**RSL Helper keeps only the newest 20 files and deletes the rest.** Measured on 2026-08-12: during
active play battles land every 25–50 seconds, so the window holds roughly 10–15 minutes of history.
Six files listed at 23:31 were already gone when re-checked about fifteen minutes later. Anything not
copied promptly is lost permanently, and there is no setting to disable the rotation.

The eventual target is **Live Arena** logs. When this was written no Arena battle had been captured
and its content ids were unknown — which is exactly why this design captures everything and defers
filtering. That paid off on 2026-08-13: Live Arena was identified from captures nothing was
filtering for at the time (see *Observed content ids*).

## Scope

- Watch the live battle-log directory, copy every new file into an archive we control, before it is
  evicted.
- Decode a captured file into typed objects.
- Maintain a thin index so battles can be found without decompressing the whole archive.
- **Non-goals:** interest/filter rules; a normalized query store; any analysis; a background daemon;
  any UI. Identification of which content type each `kindId`/`regionTypeId` denotes is explicitly
  deferred (see *Observed content ids*).

## Observed format

Verified against 20 files / 166 state pushes captured 2026-08-12 23:19–23:39.

Raw bytes are **zlib** (magic `78 9c`), ~20× ratio, ~6 KB per battle compressed. Each line is one
JSON object; **one file is exactly one battle** — 20 files yielded 20 distinct `proc` values, one per
file, and in every file the last line has `finished: true` while no earlier line does.

### Envelope

Every line: `type: "battleLiveState"`, `pushKind: "turn"`. No other values observed for either.

| Field | Meaning |
|---|---|
| `proc` | battle handle; constant within a file |
| `kindId`, `regionTypeId`, `stageId` | content identity — see below |
| `turn`, `round`, `turnsApplied` | turn counters; `turn` may skip values (6 → 8 observed) |
| `playerTurns`, `playerAutoTurns`, `bossTurns` | turn attribution |
| `activeHeroId` | acting champion's in-battle id |
| `isAuto`, `extraTurn`, `finished` | run state |
| `hasStats` | **true only on line 0** — full stats are serialized once, at battle start |
| `cast` | `{skillId, producer, target}`; absent on line 0, and occasionally mid-battle |
| `eventsTruncated` | never true in this sample, but the cap exists and must be honoured |

### Teams and heroes

`teams` is a 2-element array of `{team, isPlayer, ownerId, heroes[]}`. Each hero carries `id` (0–7),
`typeId`, `inv`, `slot`, `lvl`, `hp`, `maxHp`, `dmgTaken`, `stamina`, `active`, `dead`, `boss`,
`skipNext`, plus:

- `skills[]` — `{t: skillTypeId, cd, max, base, ready, dis}`. Cooldowns do move turn to turn, so
  cooldown-manipulating effects are observable here even though stat changes are not.
- `buffs[]` / `debuffs[]` — `{t, k, tl, life, prod, cnt?}`, where `k` is an effect-kind id.
  **`prod` is the producing hero id and is authoritative** — do NOT attribute effects by
  correlating them with the line's `cast`, because a line is a whole turn and carries passives,
  counterattacks and enemy reactions too (this produced a confidently wrong attribution once).
  **The band is the polarity: 2xxx are buffs (29 ids seen), 3xxx are debuffs (19).** Zero crossover
  observed — no id has ever appeared as both. `tl: -1` together with `cnt: 1..5` marks a
  stack-based permanent effect; timed effects carry `tl: 1..3` and no `cnt`.
- `flags[]` — string enum; observed: `IsInvincible`, `IsBlockDebuff`, `IsStrongInvisible`,
  `IsStunned`, `IsSleep`, `IsFrozen`, `ActiveSkillsBlocked`, `HeroPassiveSkillsBlocked`.
  Flags are a channel for *guessing* effect ids: an id co-occurring with a flag at 100% coverage
  and 100% specificity is a **candidate** for that flag's effect. ⚠️ **None of these is confirmed.**
  They are single-sample correlations from 10 Live Arena battles, and co-occurrence is not identity —
  an id could be a marker set alongside the real cause rather than the cause. The sample also proves
  its own limitation: `HeroPassiveSkillsBlocked` reaches only 52% coverage from its best candidate,
  i.e. that flag has a second source, so 100% in-sample coverage does not generalise. Candidates,
  with the flag they track and the number of flag occurrences behind them:

  | id | tracks flag | n | confidence |
  |--:|---|--:|---|
  | 2002 | `IsBlockDebuff` | 459 | strongest |
  | 2001 | `IsInvincible` | 319 | strong |
  | 2013 | `IsStrongInvisible` | 129 | strong |
  | 3006 | `ActiveSkillsBlocked` | 45 | moderate |
  | 3001 | `IsFrozen` | 42 | moderate |
  | 3004 | `IsStunned` | 40 | moderate |
  | 3017 | `HeroPassiveSkillsBlocked` | 25 | weak — 52% coverage, second source exists |
  | 3003 | `IsSleep` | **1** | worthless |

  Note these track *flag names*, not game-mechanic names — mapping `IsStrongInvisible` onto a
  particular in-game buff is a further inference nobody has made yet.
- `stats` — **line 0 only**: `{atk, def, spd, res, acc, critCh, critDmg, critHeal}`, for **both**
  teams. Opponent stat blocks are therefore fully readable. Because it is captured once, a
  mid-battle stat change is never visible as a number; only the buff/debuff entry that caused it,
  and its consequences, can be seen. See *What `stats.spd` actually is* below.

#### The two join keys (both verified 2026-08-13)

| log field | joins to | scope | gives you |
|---|---|---|---|
| `inv` | `Champs.ID` | **your champions only** | the exact copy, and through it their equipped artifacts |
| `typeId` | `Champs.HeroID` | **any champion, including opponents'** | the champion's name |

`inv` is the champion **instance** id — one specific copy you own — so it resolves only for your own
side. That is what ties a battle to the gear that fought it.

`typeId` is the champion **type**, and `typeId == Champs.HeroID` **exactly**: 95 of 95 player heroes
across 10 Live Arena battles matched with zero mismatches. This is a direct column join, not
arithmetic — an earlier `BaseHeroID + stars` guess was wrong (the delta is 0 at `Rang=2` but 6 at
`Rang=6`, so it does not hold). `Champs.HeroID` is not unique per row, so build the map as
`DISTINCT HeroID -> Name`.

The consequence is the useful part: **opponents can be named**, because `HeroID` is a global
champion-type id and the roster table happens to contain the mapping for any champion you have ever
owned a copy of. Of 40 enemy slots in those 10 battles, 38 resolved to names from the local roster;
the 2 that did not are champions never owned, and must be reported as an unresolved `typeId` rather
than guessed. (In that session the unowned one was `typeId 8846` = Nais, identified by the account
owner — an example of the only way an unowned champion gets a name.)

#### What `stats.spd` actually is

`stats.spd` is **not** the champion's geared speed. It is the geared speed **plus the team aura**,
and the aura is computed on the champion's *base* speed, not on the geared value. So comparing two
battles' `spd` for the same champion measures aura conditions, **not** a gear change — an error
worth naming, because "their speed changed, so they re-geared" is the obvious wrong reading.

The decomposition that fits:

```
in-battle spd  =  Champs.SPD  +  round(base_spd × effective_aura)
effective_aura =  nominal_aura × (1 + your_IP_boost − their_IP_reduction)
```

- `Champs.SPD` — the geared value from the vault DB. **Authoritative over the in-game champion
  screen**, which can differ by 1: substituting the displayed value scored 0/22 exact integer
  matches against 15/22 for the DB value.
- `base_spd` — the champion's unequipped base speed. Not in the DB or the log; it comes from an
  external champion reference.
- `nominal_aura` — the team's best applicable SPD aura, also external. A team with no SPD-aura
  champion shows a delta of exactly 0 across every hero, which is the cleanest signature in the data.
- **Intimidating Presence** (a blessing, `Champs.BId = 2102`) — *"Strengthens your team's Aura and
  weakens the enemy team's Aura. If multiple Champions on the same team have Intimidating Presence,
  only one will work."* By blessing level: 1★ +2.5%/−5% · 3★ +7.5%/−10% · 5★ +15%/−20% ·
  6★ +35%/−20%. It is explicitly **non-stacking**, which is why a second carrier changes nothing.

**Verification status — the fit is good but not exact.** Across 7 aura-bearing Live Arena battles
the model reproduces the observed speeds to within 0.55 percentage points, and at integer precision
it is exact for 15 of 22 champion-battles, including **all six** for the champion carrying the
aura. The residual is not noise and is not explained:

- **Six misses are off by exactly +1** (predicted one high). That is a rounding-rule question —
  `round` fits some champions and `floor` fits others — most likely meaning a few external base-speed
  values are slightly wrong rather than the model being wrong.
- **One miss is off by +9** (Cruetraxa), and the same champion gains ~+8 in battles where the team
  has *no* SPD aura at all, so it is a separate effect entirely and remains unidentified.
- **Opponent Intimidating Presence levels are inferred, never confirmed.** Blessings appear nowhere
  in the log, and `Champs` holds only your own roster, so an opponent's blessing is unreadable from
  both sources. The inferred levels have survived several chances to be contradicted — including a
  same-opponent pair 19 minutes apart where a single champion swap flipped the prediction from "no
  IP" to "5★/6★", matching a 6★ champion whose only plausible blessing is IP — but *consistent with*
  is not *confirmed*, and nothing here should be read as settled.

Settling it needs a prospective session: screenshot opponents' blessings while the watcher captures.
That would also separate 5★ from 6★, which is impossible from this side — both reduce the enemy
aura by 20% and differ only in the ally-boost half.

### Events

36 distinct kinds, in two classes.

**Rich** — carry a payload, and hold essentially all the analyzable signal:

| `k` | Fields |
|---|---|
| `dmg` | `t, v, hit, elem, calc, blk, let` |
| `heal` | `t, v, hit, calc` |
| `eff` | `t, e, kind, ok, evd, failReason?` |
| `skill` | `t, skillId, producer, tgt, team` |
| `counter` | `t, kind, old, new` |
| `heroCounter` | `t, cid, old, new` |

**Bare** — carry *only* `t`; RSL Helper does not serialize their payloads. They record that something
happened, never by how much. 30 kinds, and they dominate the stream by volume —
`DamageMultiplierModifyResult`, `StaminaChangeResults`, `StatsChangeResult`, `UnappliedEffectResult`
are the bulk of it. Treat them as markers, not measurements.

`t` is the subject hero id across every kind: 0–7, or `-1` for none/global.

`eff`, with its `ok` / `evd` / `failReason` triple, is the field most likely to answer accuracy and
resistance questions empirically — it records not just landed effects but evaded and failed ones.

### Observed content ids

`stageId` has been constant per `(kindId, regionTypeId)` across every file examined.

| kindId | regionTypeId | stageId | team sizes | identified as | when |
|--:|--:|--:|---|---|---|
| **6** | **901** | **9019003** | `[4, 4]` | **Live Arena** | 2026-08-13 |
| 2 | 301 | 3019003 | `[4, 4]` | unidentified | 2026-08-12 |
| 1 | 216 | 2169025 | `[5, 1]` | unidentified | 2026-08-12 |
| 1 | 112 | 1123006 | `[4, 4]` | unidentified | 2026-08-13 |
| 1 | 1402 | 14022130 | `[5, 5]` | unidentified | 2026-08-13 |

Everything still unidentified is recorded as an opaque observed value and **deliberately not guessed
at**. Identification happens by the method below, not by inference from team size or stage number.

#### Live Arena — `kind=6 / region=901 / stage=9019003`

**Live Arena specifically**, as stated by the account owner who played the session. Classic Arena is
a different mode and has not been captured, so it will carry a different tuple — do not treat this
key as "Arena" generally.

Confirmed 2026-08-13 from 10 captured battles, by two independent lines of evidence:

1. **Live cross-reference.** These were the tuples landing while the account owner was playing Live
   Arena and said so at the time — the "cross-reference captures against known play sessions" method
   this section originally called for.
2. **The data proves it is PvP without relying on the timing.** Every other tuple's enemy team
   carries `ownerId: -1` — no owner, i.e. AI. These carry a **real, distinct account id per battle**
   (10 battles, 10 different opponents, no repeats), against a constant player-side `ownerId`. That
   establishes live matchmaking against real accounts; which *named* PvP mode it is comes from the
   owner's statement, not from the ids.

The enemy `ownerId` is itself worth having: it is a real account key, so repeat opponents are
trackable across sessions.

**This is the filter key** for anyone who later wants to stop capturing everything and take Live
Arena only. Note that capture-everything remains the design; a filter belongs at query time over the
archive, not at capture time (see *Rejected alternatives*).

Two cautions carried from these captures:

- **Survivor counts are not outcomes.** Live Arena battles ended `4/3` and `4/4` (player/enemy survivors)
  — wins on points with the enemy team still standing. A naive "enemy team wiped" rule would score
  both as losses. This is the concrete evidence behind the *Index row* section's refusal to emit a
  `win` field.
- **One session is not the id space.** Three of the five tuples above appeared only after a second
  night of capture, and none of 2026-08-12's two reappeared on 2026-08-13. Treat this table as
  "what has been seen", never "what exists".

## Architecture

Lives in `oracle/battlelogs/`, alongside `oracle/analytics/` and `oracle/probe/`.

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/codec.mjs` | `readBattle(path)` → decoded lines. Inflate, parse JSONL, validate shape. Pure; no policy. | `node:zlib` |
| `lib/summarize.mjs` | decoded battle → one index row. Pure function of its input, no I/O. | codec output |
| `lib/capture.mjs` | one capture pass, plus the startup reconcile that reads the archive back | both libs |
| `watch.mjs` | foreground poller: detect → copy → decode → index → log | capture |
| `rebuild-index.mjs` | replay `summarize` over the whole archive into a fresh `index.jsonl` | capture |
| `archive/<account>/` | captured `.jsonl.z`, byte-identical to source | — |
| `archive/index.jsonl` | append-only, one row per battle | — |

Keeping `summarize` pure and separate from `codec` is load-bearing: the index schema will change as
we learn what to ask of this data, and rebuilding it means replaying `summarize` over the archive.
That only works if it is a pure function of a decoded battle, with no dependence on capture-time
state.

## Data flow

Poll the source directory every 3 seconds. On startup, rebuild the capture state from disk — what is
held, what has a row — so a restart does not re-copy or double-index what is already done.

For each file with no good index row:

1. **Copy the bytes** to `archive/<account>/<filename>`.
2. Decode the copy.
3. Append an index row.
4. Log a line to the console.

Step 1 precedes step 2 by design, and sits above every other gate in the loop. A decode bug must
never cost a file that is about to be evicted — bytes are the source of truth and the index is a
derived convenience that can be rebuilt at any time from the archive.

The copy repeats every pass until the file has a row, because re-copying is the only thing that
repairs a partial captured mid-write; re-*inflating* is what the retry budget below limits.

### Reading the archive back

The capture pass iterates the source directory and nothing else, so bytes held with no index row —
a watcher killed between the copy and the append, a torn index tail, a file whose decode was retired
by a bug since fixed — become unreachable the moment RSL Helper evicts the source, which is inside
the same 10–15 minute window everything else here is racing. Two passes read the other direction:

- **Startup reconcile** (`reconcileArchive`): for each held file with no row *whose source is
  already gone*, decode the archived bytes and append the row. Files still in the source are left
  alone — the next capture pass reaches them with a fresh copy and the full retry budget, which
  beats replaying bytes that may still be mid-write. Runs once per start; normally zero files.
- **`rebuild-index.mjs`**: replay `summarize` over the entire archive into a new `index.jsonl`,
  written to a temp file and renamed. This is what makes "the index is derived" a claim that can be
  cashed, and it is the compaction path for the one case where the append-only index holds two rows
  for a file (a `decodeFailed` row that a later success superseded).

### Console output

Each newly captured battle prints one line, including the content ids, so that the first Arena
session immediately reveals its `kindId`/`regionTypeId` rather than requiring a later dig:

```
23:24:12  captured 20260812_232412_live.jsonl.z  kind=2 region=301 stage=3019003  9 turns  4v4
```

"captured", not "copied": a result can be a file already held that was only decoded this pass. A row
written by the startup reconcile reads `indexed` instead, because those bytes were archived on an
earlier run and only the row is new. There is deliberately no byte size — it is the one field on the
line that says nothing about which battle this was.

Unrecognised id tuples — any pair not already seen in the archive — are marked in the output, since a
new tuple is the signal that a new game mode has been captured.

## Index row

One JSON object per line in `archive/index.jsonl`:

```
{file, account, capturedAt, proc, kindId, regionTypeId, stageId,
 isAuto, lines, turns, rounds, playerTurns, bossTurns, finished,
 teams: [{team, isPlayer, ownerId,
          heroes: [{id, typeId, inv, slot, lvl, maxHp, boss}]}],
 survivors: {player: N, enemy: M},
 decodeFailed?: true}
```

`survivors` counts non-dead heroes per side on the final line. There is deliberately **no `win`
field**: the `[5, 1]` captures all end at exactly 6 turns with the single enemy alive, so a naive
"enemy team wiped" rule would score every one of them a loss. Survival counts are a fact; a win rule
is a per-content-type interpretation that can be layered on later, once the content types are
identified.

## Error handling

- **Source directory missing** (RSL Helper not installed, different account) — clear message naming
  the path searched, exit non-zero.
- **Decode failure** — not fatal, and specifically not a reason to skip the copy. The bytes are
  already archived; the decode is re-attempted on the next poll, **up to 3 attempts**, and only after
  the third is a `decodeFailed: true` row written. The decode then stops for that file — a genuinely
  corrupt file must not be re-inflated every 3 seconds for the rest of the session — but **the copy
  does not**, so the bytes keep being refreshed. A `decodeFailed` row is "we hold these bytes and
  could not read them", not "done with this file": restarting the watcher gives the decode another
  go, and `rebuild-index.mjs` gives it one at any time. That distinction is load-bearing, because the
  case it lands on is the anticipated one — a novel Arena shape that crashes `summarize` would
  otherwise retire every file of the first Arena session permanently, with no way to pick them back
  up after the fix.
- **Eviction lost the race** — a file listed by the poll but deleted before the copy. There is
  nothing to archive and nothing to index, so the console line is the only trace it ever existed and
  it is reported as `MISSED`. Silence is the one output a capture tool must not produce for a miss.
- **Duplicate `proc`** across two files — index both. Deduplication is an analysis-time concern.
- **Archive write failure** — report loudly and keep polling; a full disk should not silently stop
  capture.

### Why 3 attempts over 9 seconds is enough

The retry budget looks alarmingly small next to a 10–15 minute eviction window if you assume the log
is streamed during the battle — and the surface evidence says it is: filename stamps sit **8–80
seconds before** mtime, and file size tracks battle duration (2 KB for a 9-second battle, 12.5 KB for
an 80-second one). If the file really were appended to across the battle, every battle watched live
would burn all 3 attempts before it ended, get retired, and the feature would fail at its purpose.

It is not streamed. Counting zlib `Z_SYNC_FLUSH` boundary markers (`00 00 FF FF`) in the compressed
bytes of four live logs spanning 2 KB–12.5 KB found **zero** in all four:

```
20260813_195637_live.jsonl.z size=12504 hdr=789c syncFlushMarkers=0
20260813_195950_live.jsonl.z size=9601  hdr=789c syncFlushMarkers=0
20260813_200856_live.jsonl.z size=2039  hdr=789c syncFlushMarkers=0
20260813_200520_live.jsonl.z size=2091  hdr=789c syncFlushMarkers=0
```

Zero markers in a 12.5 KB file means the whole stream came out of **one** deflate call: RSL Helper
buffers the entire battle and writes the compressed file once, at battle end. The filename is the
battle *start* time, which is what produces the misleading 8–80 second gap. So the mid-write window
is a single 2–12 KB write — milliseconds — and a 9-second budget is comfortably right.

**Do not widen the budget or add streaming support on the strength of the timestamp gap alone.** If
RSL Helper ever does switch to incremental flushing this feature breaks completely and silently, and
the marker count above is the one-command canary for exactly that.

## Privacy

The archive is gitignored using the `oracle/resources/` pattern — deny everything, allow only
metadata:

```gitignore
# Local-only battle logs: personal account data. NOT committed.
*
!.gitignore
!README.md
```

Deny-by-default rather than an extension list, so a new artifact type in the archive is ignored
without anyone remembering to add it.

That protects the *default* archive only, and `--archive DIR` is a documented flag, so the root
`.gitignore` also denies `*.jsonl.z`, `index.jsonl` and `index.jsonl.tmp` by extension. Belt and
braces on purpose: the deny-all is the rule, and the extension list is what catches an archive
pointed somewhere else in the tree.

This matters because **the repo is public** and the logs carry `ownerId` and champion instance ids.
`index.jsonl` lives under `archive/` for the same reason — it is derived from the same personal data.

Test fixtures are therefore **synthetic and hand-built**, never captured logs.

## Testing

Vitest under `oracle/battlelogs/__tests__/`, folded into `npm test` as the analytics tests are.

- `codec`: round-trips a synthetic fixture; truncated zlib raises a typed error, not a generic throw;
  a trailing blank line parses cleanly.
- `summarize`: index row matches expectation for a fixture with a known team layout, including the
  `survivors` count and a `turn`-skipping sequence.
- `capture`: pointed at a temp source directory with files dropped in mid-run — asserts the copy is
  byte-identical, the index row is appended, a restart re-copies nothing, a deliberately corrupt file
  is still archived and marked `decodeFailed` and then *retried* after a restart, a lost eviction is
  reported, two accounts sharing one index do not shadow each other, and the reconcile picks up bytes
  held with no row.
- `watch`: the pure helpers — argument parsing, source resolution, and one real `summarize` row run
  through `formatCapture`, which is the pipeline's last joint.
- `rebuild-index`: replays a synthetic archive, replaces an existing index rather than appending, and
  gives an undecodable file a row instead of aborting.

Every test uses temp directories and synthetic fixtures. None may read the live RSL Helper directory.

## Rejected alternatives

- **Filter at capture time.** Rejected: the source is evicted within minutes, so a filter bug or a
  changed mind loses battles permanently. At ~6 KB per battle the archive is cheap enough that
  filtering is better expressed as a query over our own copy. This is doubly true while the Arena
  content ids are still unknown — there is nothing to filter *on* yet.
- **Decode straight into SQLite at capture time.** Deferred: it would commit to an event schema
  derived from a single night's sample, in which 30 of 36 event kinds carry no payload. Reshaping it
  later means re-ingesting from the raw files we would have to keep anyway. Revisit once real queries
  exist.
- **A background service or cron sweep.** Rejected for now: a WSL user service dies with the distro
  and a silently-dead watcher is indistinguishable from a quiet night. A foreground script started
  before play is visible and matches how every other `oracle/` tool is invoked.
- **inotify / filesystem events.** Not available: the source is a `/mnt/c` drvfs mount, which does
  not deliver inotify events for Windows-side writes. Polling is forced, not chosen.
- **Storing decoded JSONL instead of the compressed original.** Rejected: 20× larger for no gain,
  and it discards the byte-exact original that makes re-derivation trustworthy.
