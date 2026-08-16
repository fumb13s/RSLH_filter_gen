# Data Model: Gear Movement Diff

**Feature**: 001-gear-moves-diff | **Date**: 2026-08-16

Nothing here is persisted. These are the in-memory shapes the tool builds while comparing two
snapshots, and they exist only for the duration of one run.

---

## Snapshot (input)

A SQLite file read twice per run — once as "before", once as "after". Opened read-only; never
written.

Two reads are performed against each:

| Source | Reader | Yields |
| --- | --- | --- |
| Artifact rows | `readArtifacts(dbPath)` — `oracle/analytics/decode.mjs`, via `readArtifactRows` in `oracle/lib/decode.mjs` | `{ items, corrupt, total }` |
| Champion rows | `readChampRows(dbPath)` — `oracle/analytics/champs.mjs` (extended) | array of champion rows |

Both open `readOnly: true`. The champion reader already did; the shared artifact reader is changed
to match (research.md D9), which is what makes "no file is created on a mistyped path" true rather
than aspirational.

---

## Item

Decoded artifact, supplied by `readArtifacts`. Consumed as-is; this feature adds no fields.

| Field | Notes |
| --- | --- |
| `id` | Internal identifier. Used as a map key and may be printed as a trailing reference, but is never the sole identifier (FR-005). |
| `slot` | 1–9. **The only authoritative source of an item's slot.** Never inferred from which champion column referenced it. |
| `set`, `rank`, `rarity`, `level`, `faction` | `rarity` is 0-indexed into `ITEM_RARITIES`. |
| `isAccessory` | True for slots 7–9; gates whether faction is shown. |
| `mainStat` | `{ statId, isFlat, value }` |
| `substats[]` | `{ statId, isFlat, rolls, value, glyph }` — **order is not meaningful** and must be normalized before fingerprinting. |
| `ascStat`, `ascLevel` | Ascension bonus; part of the visible description. |
| `equippedChampId` | Present because the shared reader always selects it. **Must not be used to derive location** (FR-003). |

---

## Champion

Row from `readChampRows`, extended with the nine gear-slot columns.

| Field | Notes |
| --- | --- |
| `ID` | Champion identifier; the value stored in the slot columns is an item id. |
| `Name` | Printed in reports. Empty-`Name` placeholder rows are dropped by `isRealChamp`. |
| `Weapon, Helmet, Shield, Glouves, Chest, Shoes, Ring, Amulett, Banner` | Item id or 0/null. Spellings are the schema's own and are misspelled. **Column order is not slot-id order** — see plan.md. |

---

## Location

Where one item sits in one snapshot. A **value, not a set**: verified across both reference
snapshots that no item is claimed by two champions (4396 of 4396 and 4408 of 4408 entries reference
a distinct item, zero duplicate claims).

```
Location = champId (number)  |  null  (meaning unequipped)
```

Built by `locationsFrom(champRows) -> Map<itemId, champId>`. An item absent from the map is
unequipped. There is no third state, and a location is never rendered as blank (FR-004).

---

## Move

Produced by `diffLocations`. One entry per item whose location differs between snapshots.

```js
{
  id,                 // item id
  from,               // champId | null  (location in the before snapshot)
  to,                 // champId | null  (location in the after snapshot)
  item,               // the AFTER row — what the item looks like now
  leveledFrom,        // before level when it changed, else null
}
```

**Invariant**: `from !== to`. An item whose location is unchanged never appears, regardless of any
other change to it — levelling alone is not a move.

---

## Gone item

Also produced by `diffLocations`. Present in the before snapshot, absent from the after one; sold or
consumed.

Holds the **before** row, because no after row exists. This is the single exception to the
render-from-after rule, and it propagates: collision counts for these are computed over the before
snapshot's items, not the after's.

```js
{ moved: Move[], gone: Item[] }   // diffLocations return shape
```

---

## Fingerprint

A string key over an item's visible attributes, used to detect indistinguishable pieces.

Covers: slot, set, rarity, rank, faction, main stat (id, flat flag, value), and every substat
(id, flat flag, value, glyph).

**Substat terms are sorted before joining.** Order-sensitive comparison finds 0 collisions across
8485 items; the real 2-item collision appears only order-insensitively.

---

## Collision counts

`collisionCounts(items) -> Map<fingerprint, count>`.

Scoped to whichever snapshot the rendered row came from:

| Rendering | Counted over |
| --- | --- |
| Moved item | after snapshot's items |
| Gone item | **before** snapshot's items |

A count above 1 produces an explicit "N identical" marker (FR-006). Getting the scope wrong yields
`undefined` for all 47 gone items in the reference window.

---

## Champion name entry

`champNames(beforeRows, afterRows) -> Map<champId, { name, missing }>`.

| Field | Notes |
| --- | --- |
| `name` | The after snapshot's name when present, else the before snapshot's. |
| `missing` | True when the champion is absent from the after snapshot. **About champions only** — unrelated to the `gone` item list, and deliberately named differently to keep the two apart. |

161 champion ids present in the earlier reference snapshot are absent from the later one, so this
path is routine rather than exceptional.
