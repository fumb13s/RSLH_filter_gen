# Quickstart: Gear Movement Diff

**Feature**: 001-gear-moves-diff | **Date**: 2026-08-16

## The workflow this serves

1. **Before** handing the account over, capture a baseline snapshot and keep it under a name that a
   routine refresh will not overwrite — the `<date>-pre-driver.db` convention, which sits outside
   the `*-RSLHelper.db` pattern the other tools glob for.
2. Someone rearranges gear.
3. **After**, let the source application finish syncing, then capture a second snapshot.
4. Run this tool over the pair and work through the restore in the game.

Step 1 is the one that cannot be recovered if skipped. Everything else can be redone.

## Run it

```
node --experimental-sqlite oracle/analytics/gear-moves.mjs <before.db> <after.db>
```

Both paths are required. Nothing is auto-selected — see `contracts/cli.md`.

## Build and verify

```
npm run build && npm test && npm run lint
```

`npm run build` is required before the first run: the tool imports `@rslh/core`, which is built from
`packages/core`.

## Reading the output

Four sections. **Moved items** is the audit list — what changed and where it went. **Restore by
champion** is what you work from when you know who is missing something: one champion at a time,
listing only changed slots. **Strip list by holder** is the same moves keyed the other way — open a
champion the swapper built up and every moved piece on them names where it goes back, so you empty
that champion in one pass instead of a round trip per piece. **Gone — cannot restore** is the one
section the tool cannot help with: those pieces were sold or consumed and no amount of re-equipping
brings them back. Read that section first, so you do not spend time hunting for something that no
longer exists.

In the strip list, a piece that came out of the vault carries one of three verdicts. `auto` means do
nothing — putting the original back into that slot displaces this piece by itself. `unequip` means
take it off by hand, because the slot was empty before and nothing will ever displace it. `keep`
means leave it on: the piece it replaced was sold, so removing this one would only leave the slot
bare.

Items are described the way they look in the game — rarity, rank, set, slot, level, main stat,
substats — because the restore happens in a UI that never shows internal ids. Where two pieces are
genuinely indistinguishable the line says so, and either one will do.

A `[leveled +12->+16 during session]` tag means the piece was upgraded while it was away, so its
substat values now read differently than they did in the baseline. Match on the printed values, not
on what you remember.

## Development

Eight pure functions are exported and unit-tested: `locationsFrom`, `diffLocations`, `fingerprint`,
`describeItem`, `collisionCounts`, `champNames`, `slotsBefore`, `byHolder`. Argument parsing and
printing sit below the `// Below this line nothing is unit-tested` marker, matching `speed.mjs` and
`champion-gear.mjs`.

Tests live in `oracle/analytics/__tests__/gear-moves.test.mjs` and use hand-built row and item
objects — **no database fixtures**. This is not a stylistic preference: snapshots hold personal
account data, are excluded from version control, and are absent from a fresh checkout, so a
fixture-based test would be unrunnable for anyone else.

For the same reason, the reference figures in the spec are a **conditional** check that only runs
where those snapshots happen to exist locally — the first pair (34 moved across 16 champions, 47
gone, 58 new, 4 of the moved also levelled) and the driver-session pair (108 moved: 92 off 44
champions, 50 onto 6, of which 34 from champions and 16 from the vault; nothing gone, nothing new).
The unit tests are the real acceptance gate.

Two of the four strip-list dispositions — `unequip` and `keep` — do not occur in either reference
pair, so running the tool will never show them to you. They exist because they are reachable, and
they are covered only by hand-built unit tests. Do not delete them as dead code.

## Two traps worth knowing before you edit

**Location comes from the champion table's slot columns, never the artifact table's wearer
pointer.** That pointer is left stale on unequip — 36 of them on the reference snapshot, every one
naming a champion that is no longer wearing the item. Keying on it invents 36 moves.

**The champion table's column order is not slot-id order.** Weapon is slot 5, Helmet is slot 1,
Shield is 6, Glouves is 3, Chest is 2, Shoes is 4; only Ring, Amulett and Banner line up with their
positions. Take the slot from the item, never from the column that referenced it.
