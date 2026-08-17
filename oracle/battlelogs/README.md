# Battle logs

Captures RSL Helper's per-battle logs before it deletes them, and decodes them.

**RSL Helper keeps only the newest 20 files.** During active play that is 10–15 minutes of history,
so anything not copied promptly is gone. Start the watcher before you play.

## Run

```bash
node oracle/battlelogs/watch.mjs
```

Polls every 3s and copies each new battle into `archive/<account>/`, appending a summary row to
`archive/index.jsonl`. Ctrl-C to stop. Flags: `--source DIR`, `--archive DIR`, `--interval SEC`,
`--once`. Source is auto-detected under `/mnt/c/Users/*/AppData/Roaming/RslHelper/battlelogs/`, or
set `RSLHELPER_BATTLELOGS`.

Each captured battle logs its content ids. A tuple not seen before is flagged
`** NEW CONTENT TUPLE **` — that is how a mode we have not captured yet gets identified. It is how
**Live Arena** was pinned down on 2026-08-13:

| tuple | mode | when |
|---|---|---|
| `kind=6 region=901 stage=9019003` | **Live Arena** | 2026-08-13 |
| `kind=1 region=112 stage=1123003` | **Campaign 12-3 Brutal** | 2026-08-14 |

Live Arena specifically — Classic Arena has not been captured and will carry a different tuple.
Campaign varies by stage *and* difficulty, so one campaign tuple identifies one stage, not campaign
as a whole: `kind=1 region=112 stage=1123006` is the same chapter at a different stage and is still
unidentified.

Everything else observed so far is still unidentified on purpose — see *Observed content ids* in
`docs/plans/2026-08-12-battle-log-capture-design.md` for the full table and how this was confirmed
(short version: the enemy team's `ownerId` is what separates them).

That `ownerId` is a **three-way** test:

| `ownerId` | opponent | seen |
|---|---|---|
| `-1` | AI | every non-arena tuple so far |
| negative, but not `-1` | **Live Arena bot** | `-94341`, 2026-08-17 |
| positive | real player | Live Arena; **not** unique per battle, one has already recurred |

Live Arena hands you a bot after three losses in a row, or when you let the pick phase time out
(about a minute). Its team is generated rather than a real player's build, so it has to stay out of
any opponent corpus — one bot in the 38 Live Arena battles captured through 2026-08-17, and nothing
else in the index row tells it apart: same tuple, same 4v4, ordinary champions. The sign of
`ownerId` is the only marker.

`DECODE FAILED (attempt n/3)` means only that: the bytes are archived either way, and the
file is retried on the next two passes in case it was caught mid-write. After the third the decode
stops, but the copy does not — the bytes keep being refreshed, and a restart (or `rebuild-index.mjs`)
gets the decode another go. `MISSED` is a battle RSL Helper deleted before we could copy it, which is
the one thing this tool exists to prevent and the reason it is never silent. `capture pass failed:`
is a whole pass lost — most often the source directory going away with the drive mount — and the
watcher keeps polling through it, because stopping is what actually loses battles.

On start it also reconciles: bytes already in `archive/<account>/` with no index row, whose source
RSL Helper has since deleted, are decoded and indexed then, printed as `indexed`. Nothing else ever
looks at the archive, so without this an interrupted run's battle would stay unfindable.

## Read a captured battle

```js
import { readBattle } from "./lib/codec.mjs";
const lines = readBattle("archive/um.../20260812_232412_live.jsonl.z");   // one object per turn push
```

Format reference — envelope, teams, events: `docs/plans/2026-08-12-battle-log-capture-design.md`.

## Rebuild the index

```bash
node oracle/battlelogs/rebuild-index.mjs [--archive DIR]
```

The index is derived. `summarize()` is a pure function of a decoded battle, so replaying it over
`archive/<account>/` regenerates `index.jsonl` — after the row shape changes, after fixing a
summarizer bug that marked a batch of files `decodeFailed`, or to compact an index left untidy by a
torn tail. The rebuild writes to a temp file and renames, so a crash cannot destroy the index it was
repairing, and a file that will not decode gets a `decodeFailed` row rather than aborting the run.

**Stop the watcher first** — it appends to `index.jsonl`, and the rename would drop anything it
wrote during the rebuild.

## Privacy

`archive/` is gitignored and **never committed** — this repo is public and the logs carry `ownerId`
and champion instance ids. Test fixtures are synthetic (`__tests__/fixtures.mjs`); never use a
captured log as a fixture.

## Test

Folded into `npm test`, or just this package: `npx vitest run oracle/battlelogs`.
