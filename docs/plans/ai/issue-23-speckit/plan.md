# Implementation Plan: Gear Movement Diff

**Branch**: `001-gear-moves-diff` | **Date**: 2026-08-16, amended 2026-08-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-gear-moves-diff/spec.md`

## Summary

Add a read-only CLI to the gear vault analytics suite that diffs two account snapshots and reports which gear moved, where it was, and where it is now, so a manual restore can be performed in the game UI.

The technical approach is settled rather than exploratory: the design was derived by measuring the real snapshots and survived four rounds of adversarial review against this codebase. Two findings drive it. First, location must be read from the champion table's nine gear-slot columns, because the artifact table's equipped-champion pointer is left stale on unequip — 36 such pointers exist on the reference snapshot, all one-directional, and trusting them would fabricate 36 moves. Second, items must be printed by their in-game visible attributes rather than by internal id, because the restore happens in a UI that never shows ids; a visible fingerprint is discriminating enough, with only 2 of 8485 items colliding.

The 2026-08-17 amendment adds a second grouping of the same moves. A real session was restored by hand from the per-owner view alone, and the cost that showed up was round trips: the gear is not spread thinly but concentrated on a few rebuilt champions — six champions held 50 of 108 moved pieces — so the owner repeatedly opened one champion, learned a piece was on another, and went there. The per-holder view (US4) inverts the index so a rebuilt champion is emptied in one pass.

## Technical Context

**Language/Version**: JavaScript (ESM, `.mjs`), Node 22
**Primary Dependencies**: `node:sqlite` (`DatabaseSync`, experimental — requires `--experimental-sqlite`); `@rslh/core` for id→name mappings; existing in-repo readers `oracle/analytics/decode.mjs` and `oracle/analytics/champs.mjs`
**Storage**: Reads two SQLite snapshot files. Opens read-only and writes nothing.
**Testing**: vitest. `vitest.config.ts` already globs `oracle/analytics/**/*.test.mjs`, so no config change is needed.
**Target Platform**: Local developer machine (Linux/WSL), terminal
**Project Type**: CLI tool within an existing analytics suite
**Performance Goals**: None. At roughly 8,500 items and 2,000 champions per snapshot the work is trivial; no target is set.
**Constraints**: Strictly read-only and advisory. No file output, no machine-readable output, no writes to any snapshot or to the source application's database.
**Scale/Scope**: Two snapshots per run; ~8.5k items and ~2k champions each; one new module, one new test file, two small edits.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

No `.hivemind/specify/memory/constitution.md` exists in this repo, so there are no formal constitutional gates. The repo's documented conventions in `CLAUDE.md` and `oracle/analytics/DESIGN.md` are applied in their place:

| Convention | Status | Notes |
| --- | --- | --- |
| Verification gate `npm run build && npm test && npm run lint` before commit | PASS | Carried into the plan as the definition of done |
| Analytics tools are advisory and never mutate snapshots | PASS (after D9) | Both readers open `readOnly: true`. The champion reader already did; the shared artifact reader in `oracle/lib/decode.mjs` opened read-write and is changed here — see research.md D9. Without that change the read-only guarantee in `contracts/cli.md` would be unachievable. |
| Pure logic exported and unit-tested; I/O and printing below a marker comment | PASS | Eight exported functions; marker matches `speed.mjs:137` and `champion-gear.mjs:228` |
| Tests use hand-built objects, not DB fixtures | PASS | Snapshots are git-ignored personal data and cannot be fixtures |
| One snapshot-reading mechanism, not several | PASS | Extends `readChampRows` rather than adding a second champion reader |
| No secrets, credentials, or local absolute paths in committed artifacts | PASS | All paths in this plan are repo-relative |

**Post-Phase 1 re-check**: PASS. The design adds no new dependency, no new configuration, and no second way to read a snapshot. The only change to existing code is additive (nine columns appended to an existing `SELECT`, plus a comment refresh).

## Project Structure

### Documentation (this feature)

```text
specs/001-gear-moves-diff/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output — CLI contract
│   └── cli.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
oracle/
├── analytics/
│   ├── gear-moves.mjs               # NEW — the tool
│   ├── champs.mjs                   # EDIT — extend readChampRows with 9 slot columns
│   ├── decode.mjs                   # unchanged — provides readArtifacts()
│   ├── README.md                    # EDIT — add a numbered entry under "## Run"
│   ├── DESIGN.md                    # unchanged — §9 documents the faction-label caveat
│   └── __tests__/
│       └── gear-moves.test.mjs      # NEW — unit tests
└── lib/
    └── decode.mjs                   # EDIT — open readOnly (shared with oracle/probe)

oracle/probe/probe.mjs               # not edited, but re-verified: shares lib/decode.mjs

packages/core/                       # unchanged — supplies @rslh/core mappings
```

**Structure decision**: Single new module inside the existing `oracle/analytics/` suite, following the established shape of `speed.mjs` and `champion-gear.mjs`. No new package, directory, or dependency.

One edit reaches outside the suite: `oracle/lib/decode.mjs` is shared with the differential-probe harness. It is a one-word change (adding `{ readOnly: true }` to a single `DatabaseSync` open) and both of its callers are SELECT-only, but the probe must be re-verified rather than assumed — see research.md D9.

## Implementation Design

### Module layout

`oracle/analytics/gear-moves.mjs` splits at a marker comment, matching `speed.mjs:137` and `champion-gear.mjs:228`:

```
// Below this line nothing is unit-tested: DB reads, layout and printing.
```

Above the marker, eight exported pure functions:

| Function | Signature | Returns |
| --- | --- | --- |
| `locationsFrom` | `(champRows)` | `Map<itemId, champId>` |
| `diffLocations` | `(beforeItems, beforeLoc, afterItems, afterLoc)` | `{ moved, gone }` |
| `fingerprint` | `(item)` | string key over visible attributes |
| `describeItem` | `(item)` | one-line human-readable description |
| `collisionCounts` | `(items)` | `Map<fingerprint, count>` |
| `champNames` | `(beforeRows, afterRows)` | `Map<champId, { name, missing }>` |
| `slotsBefore` | `(beforeItems, beforeLoc)` | `Map<champId, Map<slotId, item>>` |
| `byHolder` | `(moved, goneIds, slotsBefore)` | `Map<champId, entry[]>` — the per-holder view (US4) |

`moved` entries are `{ id, from: champId|null, to: champId|null, item, leveledFrom }`. **`moved[].item` is the AFTER row; `gone[]` holds BEFORE rows**, because a gone item has no after row at all. `leveledFrom` is the before level when the level changed, else null.

`champNames`'s `missing` flag is about **champions**; it is unrelated to the `gone` **item** list. The two are deliberately named differently.

### Reading a snapshot

Items come from `readArtifacts(dbPath)` in `oracle/analytics/decode.mjs`, returning `{ items, corrupt, total }`. Item fields already available: `id, slot, set, rank, rarity` (0-indexed), `level, faction, isAccessory, mainStat {statId, isFlat, value}, substats [{statId, isFlat, rolls, value, glyph}], ascStat, ascLevel, equippedChampId`.

Champion rows come from `readChampRows(dbPath)` in `oracle/analytics/champs.mjs`, **extended** with the nine slot columns rather than duplicated:

- It already opens `readOnly: true` — which, per its own comment, is what stops a typo'd path from creating a stray 0-byte database before failing on a missing table.
- It already calls `setReadBigInts(true)` and coerces back to Number generically over whatever columns are selected, so the extension needs no change to that logic.
- Its named-column `SELECT` is **load-bearing, not stylistic**: `SELECT * FROM Champs` throws `RangeError: ERR_OUT_OF_RANGE` because `RecentBattleTicks` holds values beyond JS number range (e.g. `639216111872650000`).
- Both existing callers (`champion-gear.mjs:16`, `speed.mjs:18`) destructure named fields only, so appending columns cannot break them.
- It filters rows through `isRealChamp`, dropping empty-`Name` placeholders. Safe here: the 17 such rows in the later reference snapshot hold zero slot entries between them.
- Its comment at `champs.mjs:36-37` currently reads "Fraction/SPD/EmpLvl are for speed.mjs; champion-gear.mjs ignores them" — a third consumer makes that stale and it must be refreshed.

Column names carry schema misspellings that must be copied verbatim: `Weapon, Helmet, Shield, Glouves, Chest, Shoes, Ring, Amulett, Banner`.

### The slot-order trap

Champion column order is **not** slot-id order:

| Column | Weapon | Helmet | Shield | Glouves | Chest | Shoes | Ring | Amulett | Banner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Slot id | 5 | 1 | 6 | 3 | 2 | 4 | 7 | 8 | 9 |

Indexing columns 1..9 as slot ids mislabels **six of the nine** — only Ring, Amulett and Banner coincide. Slot must always be taken from `item.slot`, never from which column referenced the item. Note that no exported function maps a column to a slot id, so this hazard is guarded by convention and review rather than by a unit test.

### Naming and formatting

From `@rslh/core`: `ARTIFACT_SLOT_NAMES`, `ARTIFACT_SET_NAMES`, `FACTION_NAMES`, `ITEM_RARITIES`, `lookupName`, `statDisplayName`.

Two lookalike helpers are wrong here and must be avoided:

- Use **`statDisplayName(statId, isFlat)`**, not `STAT_NAMES`. The latter is a documented placeholder (`packages/core/src/mappings.ts:90`) and percent-only, so a flat HP substat would print as "HP%" — on precisely the field a human has to match by eye.
- Use **`ITEM_RARITIES[item.rarity]`** (0-indexed), not `describeRarity`. The latter maps `.hsf` threshold ids and yields strings like `">= Epic"` or `"Unknown(3)"` for an item rarity.

`FACTION_NAMES` carries a known deferred id-space discrepancy affecting human-readable labels only (`oracle/analytics/DESIGN.md` §9). Raw ids are unaffected, so fingerprinting is safe. Print labels as the existing tools do and do not attempt to fix it in this change.

### Fingerprinting and collisions

`fingerprint` covers slot, set, rarity, rank, faction, main stat (id, flat flag, value) and every substat (id, flat flag, value, glyph). **Substat terms must be sorted before joining.** This is not cosmetic: an order-sensitive fingerprint finds **0** collisions across 8485 items, while the measured 2-item collision appears only order-insensitively — so getting it wrong silently makes the ambiguity marker dead code.

Collision scope follows the row being rendered:

- **Moved items** render from the after snapshot, so count over the after snapshot's items.
- **Gone items** have no after row, so render from the before row and count over the **before** snapshot's items. All 47 gone items in the reference window have fingerprints absent from the after snapshot, so an after-scoped lookup returns `undefined` for every one of them and a naive template prints "undefined identical".

### The per-holder view (US4)

The inverse index of "restore by champion": keyed by the champion **wearing** moved gear rather than the one missing it. It answers the question asked while standing on a rebuilt champion — where does this piece go back to — so that champion can be emptied in one pass instead of one round trip per piece.

`slotsBefore` inverts `beforeLoc` into `Map<champId, Map<slotId, item>>`. Slot comes from `item.slot` (see the slot-order trap above), never from a column index. It exists as its own exported function because the disposition below needs *what a champion held in that slot before*, which the flat `Map<itemId, champId>` cannot answer.

`byHolder` walks the moved entries with `to !== null` and classifies each into one of four dispositions. Only the vault-sourced ones need thought — a piece that came off another champion simply goes back to it:

| Disposition | When | What the report says |
| --- | --- | --- |
| `return` | `from` is a champion | Hand it back to that champion — the origin is also the destination |
| `auto` | `from` is the vault, and the holder's slot had an occupant that still exists | No action: restoring that slot displaces this piece to the vault by itself |
| `unequip` | `from` is the vault, and the holder's slot was empty before | The owner must take it off deliberately; nothing will displace it |
| `keep` | `from` is the vault, and the slot's original occupant is **gone** | Leave it on, naming the sold piece it replaced — removing it would only empty a slot that cannot be refilled |

The `keep` case is the one a naive implementation gets wrong in the harmful direction: it would tell the owner to strip a champion of a piece and leave the slot bare, because the piece that "belongs" there no longer exists. It is decided in the spec's Session 2026-08-17 clarifications, not left to the implementer.

On the reference driver-session pair all 16 vault-sourced pieces are `auto` and 34 are `return`, so `unequip` and `keep` have no natural coverage there and must be unit-tested with hand-built rows.

### Output

Four sections, printed to stdout, always in this order:

1. **Moved items** — flat list, description plus `before → after`, each location a champion name or `(unequipped)`.
2. **Restore by champion** — grouped, only changed slots, what the champion should hold and where that piece is now.
3. **Strip list by holder** — grouped by the champion wearing moved gear; each piece with its origin and disposition (FR-016; placement fixed by the Session 2026-08-17 clarification).
4. **Gone — cannot restore** — visually distinct; rendered from before rows.

Newly-acquired items get no section; they surface as the "now holding" side of a restore line. Moved items whose level changed carry a `[leveled +12→+16 during session]` tag — 4 of the 34 moved items in the reference window, not the 19 that leveled vault-wide, since only moved and gone items are printed.

### CLI

Both snapshot paths are required positional arguments. No defaulting to the newest snapshots: kept baselines are named outside the `/-RSLHelper\.db$/` pattern that `resolveDb` globs for (`champion-gear.mjs:236-239`), so a silent default would select the wrong file. Missing or unreadable arguments exit non-zero with a message naming the file. Per FR-013, warn when the snapshot given as "before" is not the older of the two.

```
node --experimental-sqlite oracle/analytics/gear-moves.mjs <before.db> <after.db>
```

## Complexity Tracking

No constitutional violations to justify. Two deliberate simplifications, both recorded in the spec's Assumptions:

| Decision | Why simpler is correct here |
| --- | --- |
| No restore ordering | Equipping a piece in-game displaces the current occupant automatically, so a topological order would be ceremony with no effect. |
| No JSON/file output | No consumer exists. Adding one now would fix an interface before anything constrains it. |
