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
`** NEW CONTENT TUPLE **` — that is how a mode we have not captured yet, such as Arena, gets
identified. `DECODE FAILED` means only that: the bytes are archived either way, and the file is
retried on the next two passes in case it was caught mid-write. `capture pass failed:` is a whole
pass lost — most often the source directory going away with the drive mount — and the watcher keeps
polling through it, because stopping is what actually loses battles.

## Read a captured battle

```js
import { readBattle } from "./lib/codec.mjs";
const lines = readBattle("archive/um.../20260812_232412_live.jsonl.z");   // one object per turn push
```

Format reference — envelope, teams, events: `docs/plans/2026-08-12-battle-log-capture-design.md`.

## Rebuild the index

The index is derived. `summarize()` is a pure function of a decoded battle, so replaying it over
`archive/<account>/` regenerates `index.jsonl` whenever the row shape changes.

## Privacy

`archive/` is gitignored and **never committed** — this repo is public and the logs carry `ownerId`
and champion instance ids. Test fixtures are synthetic (`__tests__/fixtures.mjs`); never use a
captured log as a fixture.

## Test

Folded into `npm test`, or just this package: `npx vitest run oracle/battlelogs`.
