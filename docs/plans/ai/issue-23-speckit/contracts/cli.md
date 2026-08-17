# CLI Contract: gear-moves.mjs

**Feature**: 001-gear-moves-diff | **Date**: 2026-08-16

The only interface this feature exposes. There is no library API for external consumers, no
machine-readable output, and no file output.

---

## Invocation

```
node --experimental-sqlite oracle/analytics/gear-moves.mjs <before.db> <after.db>
```

| Argument | Required | Meaning |
| --- | --- | --- |
| `<before.db>` | yes | Snapshot captured *before* the gear-swapping session |
| `<after.db>` | yes | Snapshot captured *after* it |

Both are positional and both are required. **Neither is ever inferred.** The suite's usual
"newest snapshot" default is deliberately not implemented here — kept baselines are named outside
the pattern that default globs for, so it would reliably pick the wrong file (see research.md D6).

`--experimental-sqlite` is required by `node:sqlite` on Node 22, matching every other tool in the
suite.

---

## Exit codes

| Code | Condition |
| --- | --- |
| 0 | Report produced, including the case where nothing changed |
| non-zero | Either argument missing; either file unreadable or not a snapshot |

A failure names the offending file. The tool must never emit an empty or partial report in place of
an error — "nothing moved" and "I could not read your snapshot" must not look alike (FR-014).

---

## Warnings on stderr

| Condition | Behaviour |
| --- | --- |
| The "before" snapshot is not the older of the two | Warn, then proceed (FR-013). An inverted report is internally consistent and cannot be spotted by reading it, so silence is the only clearly wrong answer. |
| The same path is given twice | Warn. The empty report that follows is correct but almost certainly not what was intended. |

---

## Output

Plain text on stdout, four sections, always in this order. Sections with no content are still
announced, so an empty result is legible rather than ambiguous.

### 1. Moved items

One line per item whose location changed: visible description, then `before → after`. Each location
is a champion name or the literal `(unequipped)`.

```
MOVED ITEMS (34)
  Mythical r6 +16 Feral Ring [Sacred Order]  ATK 265 | SPD 12, C.RATE 9, HP 402, DEF% 5
      Siegfrund the Nephilim -> Marius the Gallant
  Mythical r6 +16 Feral Boots  ATK% 60 | SPD 19, C.DMG 14, HP% 8, ACC 6
      Siegfrund the Nephilim -> (unequipped)   [leveled +12->+16 during session]
```

### 2. Restore by champion

Grouped by affected champion; only the slots that changed. States what the champion should be
wearing and where that piece is now.

```
RESTORE BY CHAMPION (16 affected)
  Siegfrund the Nephilim
    Ring    want  Mythical r6 +16 Feral [Sacred Order] ATK 265 | SPD 12, ...
            now   on Marius the Gallant
    Boots   want  Mythical r6 +16 Feral ATK% 60 | SPD 19, ...
            now   unequipped
```

### 3. Strip list by holder

Grouped by the champion **wearing** moved gear — the inverse index of section 2. Each piece names
where it came from, which for a piece taken off another champion is also where it goes back. Only
champions wearing at least one moved piece appear (FR-016).

The header counts the two kinds, so the size of the job is visible before reading the lines.

```
STRIP LIST BY HOLDER (6 champions, 50 pieces)
  Ash'nar Dragonsoul  — 9 moved pieces (4 to hand back, 5 from the vault)
    Gloves  return    to Turvold
            Mythical r6 +16 Feral  C.DMG 80 | DEF 19, C.RATE% 17, HP 714 (+325g), ATK 68
    Weapon  auto      back to the vault when this slot is restored
            Mythical r6 +16 Feral  ATK 265 | SPD 11 (+1g), C.RATE 7, C.DMG 32, ACC 10
    Boots   unequip   take off deliberately — this slot was empty before
            Epic r6 +16 Shield  SPD 45 | RES 21, HP% 6, C.DMG 18, ATK% 6
    Ring    keep      nothing to put back — replaced Epic r6 +16 Zeal Ring [Orcs], which was SOLD
            Mythical r6 +12 Feral [Orcs]  ATK 170 | HP 255, ATK% 13, HP% 6, DEF 91
```

The four dispositions are fixed by FR-017 and research.md D11. `auto` is the common case and is an
explicit no-op line rather than an omission: silence there reads as "this piece was missed".

### 4. Gone — cannot restore

Items present before and absent after. Rendered from their **before** row, and visually distinct —
this is the one class the tool cannot help with.

```
GONE - CANNOT RESTORE (47)
  Epic r6 +16 Zeal Gloves  C.DMG 80 | SPD 5, ATK% 9, HP 331, DEF 22
      last seen on Varkos Headsplitter
```

---

## Rendering rules that are part of the contract

- **Every item is identified by visible attributes.** An internal id may appear as a trailing
  reference, never as the sole identifier (FR-005).
- **Ambiguity is explicit.** When a description matches more than one item, the line carries a
  count — `(2 identical — either will do)`. Silence must never stand in for uniqueness (FR-006).
- **Moved items are described as they are now**; **gone items as they last were** (FR-007).
- **Level changes are tagged** on moved items, because levelling changes the printed substat values
  a reader matches against (FR-008).
- **A champion absent from the after snapshot** is still named, from the before snapshot, and marked
  missing — never reduced to a bare id (FR-011).
- **Newly acquired items get no section.** They appear only as the "now holding" side of a restore
  line.
- **The two grouped views agree.** A piece with disposition `return` in section 3 appears in section
  2 under the champion named there, and vice versa (FR-018). They are separate traversals of one
  `moved` array, so agreement is a contract term rather than an assumption.
- **A vault-sourced piece states its disposition explicitly** — `auto`, `unequip` or `keep` — never
  a bare "came from the vault", which would leave a required step and a no-op looking identical
  (FR-017).

---

## Guarantees

- Read-only. Both reads — champion rows and artifact rows — open `readOnly: true`, and nothing is
  written anywhere (FR-012).
- **No file is created, including on a mistyped path** (FR-015). A path that does not exist raises
  `ERR_SQLITE_ERROR` and leaves nothing behind. This depends on the shared artifact reader in
  `oracle/lib/decode.mjs` being opened read-only; with the read-write open it previously had, a
  mistyped path was silently *created* as an empty database — which a later run would then read as a
  real snapshot with no gear in it. See research.md D9.
- Deterministic: the same pair of snapshots always produces the same report.
