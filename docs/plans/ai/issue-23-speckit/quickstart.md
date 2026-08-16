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

Three sections. **Moved items** is the audit list — what changed and where it went. **Restore by
champion** is what you actually work from, one champion at a time, listing only changed slots.
**Gone — cannot restore** is the one section the tool cannot help with: those pieces were sold or
consumed and no amount of re-equipping brings them back. Read that section first, so you do not
spend time hunting for something that no longer exists.

Items are described the way they look in the game — rarity, rank, set, slot, level, main stat,
substats — because the restore happens in a UI that never shows internal ids. Where two pieces are
genuinely indistinguishable the line says so, and either one will do.

A `[leveled +12->+16 during session]` tag means the piece was upgraded while it was away, so its
substat values now read differently than they did in the baseline. Match on the printed values, not
on what you remember.

## Development

Six pure functions are exported and unit-tested: `locationsFrom`, `diffLocations`, `fingerprint`,
`describeItem`, `collisionCounts`, `champNames`. Argument parsing and printing sit below the
`// Below this line nothing is unit-tested` marker, matching `speed.mjs` and `champion-gear.mjs`.

Tests live in `oracle/analytics/__tests__/gear-moves.test.mjs` and use hand-built row and item
objects — **no database fixtures**. This is not a stylistic preference: snapshots hold personal
account data, are excluded from version control, and are absent from a fresh checkout, so a
fixture-based test would be unrunnable for anyone else.

For the same reason, the reference figures in the spec (34 moved across 16 champions, 47 gone, 58
new, 4 of the moved also levelled) are a **conditional** check that only runs where those snapshots
happen to exist locally. The unit tests are the real acceptance gate.

## Two traps worth knowing before you edit

**Location comes from the champion table's slot columns, never the artifact table's wearer
pointer.** That pointer is left stale on unequip — 36 of them on the reference snapshot, every one
naming a champion that is no longer wearing the item. Keying on it invents 36 moves.

**The champion table's column order is not slot-id order.** Weapon is slot 5, Helmet is slot 1,
Shield is 6, Glouves is 3, Chest is 2, Shoes is 4; only Ring, Amulett and Banner line up with their
positions. Take the slot from the item, never from the column that referenced it.
