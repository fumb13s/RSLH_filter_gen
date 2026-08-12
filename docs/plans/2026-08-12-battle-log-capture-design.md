# Battle-log capture and ingest — design

**Date:** 2026-08-12
**Status:** designed — not yet implemented

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

The eventual target is **live Arena** logs. No Arena battle has been captured yet, so its content ids
are unknown — which is exactly why this design captures everything and defers filtering.

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

- `skills[]` — `{t: skillTypeId, cd, max, base, ready, dis}`
- `buffs[]` / `debuffs[]` — `{t, k, tl, life, prod, cnt?}`, where `k` is an effect-kind id; 35
  distinct values observed across two bands (2001–2106, 3001–3104)
- `flags[]` — string enum; observed: `IsInvincible`, `IsBlockDebuff`, `IsStrongInvisible`,
  `IsStunned`, `IsSleep`, `IsFrozen`
- `stats` — line 0 only: `{atk, def, spd, res, acc, critCh, critDmg, critHeal}`

`inv` is the champion **instance** id, which is what makes this data worth keeping: it joins to
`Champs.ID` in the vault DB and through it to the champion's equipped artifacts.

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
happened, never by how much. 30 kinds, dominated by `DamageMultiplierModifyResult` (1,611
occurrences), `StaminaChangeResults`, `StatsChangeResult`, `UnappliedEffectResult`. Treat them as
markers, not measurements.

`t` is the subject hero id across every kind: 0–7, or `-1` for none/global.

`eff`, with its `ok` / `evd` / `failReason` triple, is the field most likely to answer accuracy and
resistance questions empirically — it records not just landed effects but evaded and failed ones.

### Observed content ids

Two `(kindId, regionTypeId, stageId)` tuples appeared:

| kindId | regionTypeId | stageId | lines | team sizes |
|--:|--:|--:|--:|---|
| 2 | 301 | 3019003 | 112 | `[4, 4]` |
| 1 | 216 | 2169025 | 54 | `[5, 1]` |

The line counts are from the first full sweep (166 pushes). Rotation evicted six files and added six
more between that sweep and a later one, so the two runs saw overlapping-but-different file sets;
`stageId` was constant per `(kindId, regionTypeId)` in both. This is itself a useful demonstration of
the eviction problem the design exists to solve.

**Which game mode each denotes is unknown and deliberately not guessed here.** They are recorded as
opaque observed values; identification comes later by cross-referencing captures against known play
sessions. Neither is Arena — no Arena battle has been captured yet. The index therefore stores these
ids verbatim so that a future Arena capture is identifiable after the fact.

## Architecture

Lives in `oracle/battlelogs/`, alongside `oracle/analytics/` and `oracle/probe/`.

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/codec.mjs` | `readBattle(path)` → decoded lines. Inflate, parse JSONL, validate shape. Pure; no policy. | `node:zlib` |
| `lib/summarize.mjs` | decoded battle → one index row. Pure function of its input, no I/O. | codec output |
| `watch.mjs` | foreground poller: detect → copy → decode → index → log | both libs |
| `archive/<account>/` | captured `.jsonl.z`, byte-identical to source | — |
| `archive/index.jsonl` | append-only, one row per battle | — |

Keeping `summarize` pure and separate from `codec` is load-bearing: the index schema will change as
we learn what to ask of this data, and rebuilding it means replaying `summarize` over the archive.
That only works if it is a pure function of a decoded battle, with no dependence on capture-time
state.

## Data flow

Poll the source directory every 3 seconds. On startup, reconcile the archive against the source so a
restart does not re-copy what is already held.

For each unseen file:

1. **Copy the bytes** to `archive/<account>/<filename>`.
2. Decode the copy.
3. Append an index row.
4. Log a line to the console.

Step 1 precedes step 2 by design. A decode bug must never cost a file that is about to be evicted —
bytes are the source of truth and the index is a derived convenience that can be rebuilt at any time
from the archive.

Copying is idempotent: a destination that already exists with the same size is skipped.

### Console output

Each newly copied battle prints one line, including the content ids, so that the first Arena session
immediately reveals its `kindId`/`regionTypeId` rather than requiring a later dig:

```
23:24:12  copied 20260812_232412_live.jsonl.z  kind=2 region=301 stage=3019003  9 turns  teams 4v4  3.6 KB
```

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
- **Decode failure** — not fatal, and specifically not a reason to skip the copy. The most likely
  cause is catching a file mid-write. The bytes are already archived; the row is written with
  `decodeFailed: true` and re-attempted on the next poll, **up to 3 attempts**. After the third the
  file is left marked, reported once, and not retried again in that run — a genuinely corrupt file
  must not be re-inflated every 3 seconds for the rest of the session. Re-running the watcher retries
  it once more, which is the escape hatch for a file that was mid-write at the moment capture stopped.
- **Duplicate `proc`** across two files — index both. Deduplication is an analysis-time concern.
- **Archive write failure** — report loudly and keep polling; a full disk should not silently stop
  capture.

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

This matters because **the repo is public** and the logs carry `ownerId` and champion instance ids.
`index.jsonl` lives under `archive/` for the same reason — it is derived from the same personal data.

Test fixtures are therefore **synthetic and hand-built**, never captured logs.

## Testing

Vitest under `oracle/battlelogs/__tests__/`, folded into `npm test` as the analytics tests are.

- `codec`: round-trips a synthetic fixture; truncated zlib raises a typed error, not a generic throw;
  a trailing blank line parses cleanly.
- `summarize`: index row matches expectation for a fixture with a known team layout, including the
  `survivors` count and a `turn`-skipping sequence.
- `watch`: pointed at a temp source directory with files dropped in mid-run — asserts the copy is
  byte-identical, the index row is appended, a restart re-copies nothing, and a deliberately corrupt
  file is still archived and marked `decodeFailed`.

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
