# Tasks: Gear Movement Diff

**Feature**: 001-gear-moves-diff | **Date**: 2026-08-16
**Input**: Design documents in `specs/001-gear-moves-diff/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/cli.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]** — parallelizable (different file, no dependency on an incomplete task)
- **[US1/US2/US3/US4]** — the user story this task serves

## Path Conventions

All paths are repo-relative from the repository root. Run commands from the repository root.

---

## Phase 1: Setup

- [ ] T001 Build `@rslh/core` so the new module can import it: run `npm run build` from the repository root and confirm it succeeds before writing any code

---

## Phase 2: Foundational (blocking prerequisites)

**Blocks every user story.** Nothing below Phase 2 can be tested until these land.

### Shared reader: make read-only real (research.md D9)

- [ ] T002 Change the `DatabaseSync` open in `readArtifactRows` at `oracle/lib/decode.mjs:42` from `new DatabaseSync(dbPath)` to `new DatabaseSync(dbPath, { readOnly: true })`. This is what makes the no-writes guarantee in `contracts/cli.md` true: with the read-write open, a mistyped path is silently *created* as an empty database, which a later run then reads as a real snapshot containing no gear. Update the function's comment block above it to say the open is read-only and why.
- [ ] T003 Re-verify the differential-probe harness, which shares `oracle/lib/decode.mjs`: confirm `oracle/probe/probe.mjs` still works after T002. Its only database use is the same `readArtifactRows` `SELECT`, so no write path exists to break — but the file was deliberately left alone by a prior TODO pending its own verification, so confirm rather than assume. If the probe's local inputs are unavailable, record that its sole DB call is a single SELECT via `readArtifactRows` and that no other call site exists.

### Champion reader and module skeleton

- [ ] T004 Extend `readChampRows` in `oracle/analytics/champs.mjs` to also select the nine gear-slot columns `Weapon, Helmet, Shield, Glouves, Chest, Shoes, Ring, Amulett, Banner` — copy those spellings verbatim, they are the schema's own misspellings. Keep the existing `readOnly: true` open and `setReadBigInts(true)`; do NOT switch to `SELECT *`, which throws `RangeError: ERR_OUT_OF_RANGE` on `RecentBattleTicks`.
- [ ] T005 Refresh the now-stale comment above `readChampRows` at `oracle/analytics/champs.mjs:36-37`, which currently claims the extra columns serve only `speed.mjs` and are ignored by `champion-gear.mjs` — a third consumer makes that false.
- [ ] T006 Create `oracle/analytics/gear-moves.mjs` with the module skeleton: imports from `oracle/analytics/decode.mjs` (`readArtifacts`), `oracle/analytics/champs.mjs` (`readChampRows`), and `@rslh/core` (`ARTIFACT_SLOT_NAMES`, `ARTIFACT_SET_NAMES`, `FACTION_NAMES`, `ITEM_RARITIES`, `lookupName`, `statDisplayName`), plus the split marker comment `// Below this line nothing is unit-tested: DB reads, layout and printing.` matching `speed.mjs:137`
- [ ] T007 Implement `locationsFrom(champRows)` in `oracle/analytics/gear-moves.mjs`, returning `Map<itemId, champId>` and skipping `0`/`null` slot entries. Do not attach slot information here — slot always comes from `item.slot`, never from column position (`Weapon` is slot 5, `Helmet` is slot 1; positional indexing mislabels six of nine).
- [ ] T008 Implement `champNames(beforeRows, afterRows)` in `oracle/analytics/gear-moves.mjs`, returning `Map<champId, { name, missing }>` — the after snapshot's name when present, otherwise the before snapshot's name with `missing: true`. The `missing` flag describes champions and is deliberately named apart from the `gone` item list.

### Foundational tests

- [ ] T009 [P] Create `oracle/analytics/__tests__/gear-moves.test.mjs` with the vitest scaffold and hand-built row/item factory helpers, following `oracle/analytics/__tests__/champs.test.mjs`. No database fixtures — snapshots are git-ignored personal data and absent from a fresh checkout.
- [ ] T010 [P] Test `locationsFrom` in `oracle/analytics/__tests__/gear-moves.test.mjs`: maps each of the nine slot columns to its champion, and ignores `0`/`null` entries
- [ ] T011 [P] Test `champNames` in `oracle/analytics/__tests__/gear-moves.test.mjs`: returns the after name for a champion present in both, and the before name with `missing: true` for one absent from after
- [ ] T012 [P] Test that opening a nonexistent snapshot path creates no file and raises an error, in `oracle/analytics/__tests__/gear-moves.test.mjs` — covers FR-015 and closes the gap that FR-012 previously had no task for. Point a reader at a path under the OS temp directory that does not exist, assert it throws, and assert the path still does not exist afterwards.

**Checkpoint**: reads are genuinely read-only; locations and champion names resolve from real snapshot rows.

---

## Phase 3: User Story 1 — See exactly what moved (Priority: P1) 🎯 MVP

**Goal**: A flat list naming every piece that moved, where it was, and where it is now.

**Independent test**: Run against two snapshots with a handful of known swaps; the list names exactly those swaps and nothing else, and every line identifies its piece by visible attributes.

### Tests for User Story 1

- [ ] T013 [P] [US1] Test `diffLocations` reports an item moving champion → champion, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T014 [P] [US1] Test `diffLocations` reports an item moving champion → unequipped, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T015 [P] [US1] Test `diffLocations` reports an item moving unequipped → champion, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T016 [P] [US1] Test `diffLocations` excludes an item whose location did not change, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T017 [P] [US1] Test `diffLocations` sets `leveledFrom` to the before level when the level changed and null otherwise, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T018 [P] [US1] Test `fingerprint` returns equal keys for two items whose substats are identical but stored in a different order — the ordering-normalization regression test, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T019 [P] [US1] Test `fingerprint` returns differing keys when any visible attribute differs, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T020 [P] [US1] Test `collisionCounts` marks a shared fingerprint with its count, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T021 [P] [US1] Test `describeItem` renders a flat HP substat as flat and not as `HP%` — guards the `statDisplayName` vs `STAT_NAMES` trap, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T022 [P] [US1] Test `describeItem` names the slot from `item.slot` (an item with `slot: 5` renders as Weapon), in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T023 [P] [US1] Test `describeItem` output contains the set, slot, main stat and substat values and never relies on the id alone, in `oracle/analytics/__tests__/gear-moves.test.mjs`

### Implementation for User Story 1

- [ ] T024 [US1] Implement `fingerprint(item)` in `oracle/analytics/gear-moves.mjs` over slot, set, rarity, rank, faction, main stat and every substat — **sorting the substat terms before joining**. Order-sensitive comparison finds 0 collisions across 8485 items and would silently make the ambiguity marker dead code.
- [ ] T025 [US1] Implement `collisionCounts(items)` in `oracle/analytics/gear-moves.mjs`, returning `Map<fingerprint, count>`
- [ ] T026 [US1] Implement `describeItem(item)` in `oracle/analytics/gear-moves.mjs` rendering rarity, rank, set, slot, level, main stat and value, every substat with value and glyph, ascension bonus, and faction on accessories. Use `statDisplayName(statId, isFlat)` NOT `STAT_NAMES`, and `ITEM_RARITIES[item.rarity]` NOT `describeRarity`. Print faction labels as the other tools do — the known discrepancy in `oracle/analytics/DESIGN.md` §9 is out of scope here.
- [ ] T027 [US1] Implement `diffLocations(beforeItems, beforeLoc, afterItems, afterLoc)` in `oracle/analytics/gear-moves.mjs` returning `{ moved, gone }`. `moved` entries are `{ id, from, to, item, leveledFrom }` where `item` is the **after** row; `gone` holds **before** rows.
- [ ] T028 [US1] Implement CLI argument handling in `oracle/analytics/gear-moves.mjs` below the untested marker: two required positional snapshot paths, no auto-selection, non-zero exit with a message naming the file when an argument is missing or a snapshot is unreadable, and a stderr warning when the "before" snapshot is not the older of the two or when the same path is given twice
- [ ] T029 [US1] Implement the "Moved items" output section in `oracle/analytics/gear-moves.mjs` per `contracts/cli.md`: one line per moved item with its description and `before → after`, each location a champion name or `(unequipped)`, collisions counted over the **after** snapshot's items, and a `[leveled +12→+16 during session]` tag where `leveledFrom` is set

**Checkpoint**: MVP complete. The tool is independently useful — a restore can be done by hand from this list alone.

---

## Phase 4: User Story 2 — Work through the restore champion by champion (Priority: P2)

**Goal**: The same information reorganized the way the work is done — per champion, changed slots only.

**Independent test**: Run against snapshots with several affected champions; each appears once, listing only its changed slots, and following its entry restores that champion completely.

- [ ] T030 [US2] Implement the "Restore by champion" output section in `oracle/analytics/gear-moves.mjs` per `contracts/cli.md`: group by affected champion, list only changed slots, and for each state what the champion should hold and where that piece is now (on a named champion, or unequipped). Reuses `describeItem`, `champNames` and the existing diff — no new exported function.

**Checkpoint**: The report is now directly workable, champion by champion.

---

## Phase 5: User Story 3 — Know what cannot be put back (Priority: P3)

**Goal**: Call out pieces that were sold or consumed, which no re-equipping can recover.

**Independent test**: Run against snapshots in which pieces were sold; those appear only in the unrecoverable section, never among the moved items.

### Tests for User Story 3

- [ ] T031 [P] [US3] Test an item present in `before` and absent from `after` lands in `gone` rather than `moved`, and carries its before row, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T032 [P] [US3] Test `collisionCounts` for a gone item is computed over the **before** snapshot so a gone item never yields `undefined`, in `oracle/analytics/__tests__/gear-moves.test.mjs`

### Implementation for User Story 3

- [ ] T033 [US3] Implement the "Gone — cannot restore" output section in `oracle/analytics/gear-moves.mjs` per `contracts/cli.md`, rendered from **before** rows and visually distinct from the moved list. Collisions here are counted over the before snapshot: all 47 gone items in the reference window have fingerprints absent from the after snapshot, so an after-scoped lookup returns `undefined` for every one and a naive template prints "undefined identical".

**Checkpoint**: Three of the four sections complete — everything the pre-amendment scope called for.

---

## Phase 6: User Story 4 — Clear a rebuilt champion in one pass (Priority: P4)

**Goal**: The same moves keyed by the champion *wearing* them, so a rebuilt champion is emptied in one pass instead of one round trip per piece.

**Independent test**: Run against snapshots where one champion was given pieces from several others; that champion appears once, lists every moved piece it wears, and names the correct origin for each.

### Tests for User Story 4

- [ ] T034 [P] [US4] Test `slotsBefore` keys a champion's before items by `item.slot` — an item with `slot: 5` lands under 5 — and returns an empty map for a champion wearing nothing, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T035 [P] [US4] Test `byHolder` groups by the wearing champion, includes only moves with `to !== null`, and omits champions wearing no moved pieces, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T036 [P] [US4] Test `byHolder` marks a piece that came off another champion as `return`, with `from` naming that champion, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T037 [P] [US4] Test `byHolder` marks a vault-sourced piece `auto` when the holder's slot held a piece that still exists, in `oracle/analytics/__tests__/gear-moves.test.mjs`
- [ ] T038 [P] [US4] Test `byHolder` marks a vault-sourced piece `unequip` when the holder's slot was empty in the before snapshot, in `oracle/analytics/__tests__/gear-moves.test.mjs`. This case does not occur in either reference snapshot pair — the unit test is its only coverage.
- [ ] T039 [P] [US4] Test `byHolder` marks a vault-sourced piece `keep` when the slot's original occupant is in `goneIds`, and sets `replaced` to that occupant, in `oracle/analytics/__tests__/gear-moves.test.mjs`. Also absent from both reference pairs; guards the one branch whose failure mode is advising the owner to strip a slot they cannot refill.
- [ ] T040 [P] [US4] Test the FR-018 agreement invariant in `oracle/analytics/__tests__/gear-moves.test.mjs`: for a fixture where champion A's piece is worn by champion B, `byHolder` files it under B with `from: A` and the per-champion restore data files it under A — the two never disagree about which champion it belongs to

### Implementation for User Story 4

- [ ] T041 [US4] Implement `slotsBefore(beforeItems, beforeLoc)` in `oracle/analytics/gear-moves.mjs`, returning `Map<champId, Map<slotId, item>>`. Slot comes from `item.slot` — never from which champion column referenced the item (six of nine columns disagree with their slot id).
- [ ] T042 [US4] Implement `byHolder(moved, goneIds, slotsBefore)` in `oracle/analytics/gear-moves.mjs` per `data-model.md`, returning `Map<champId, entry[]>` with `{ item, from, disposition, replaced }`. Four dispositions: `return` when `from` is a champion; for vault-sourced pieces `auto` (slot's original still exists), `unequip` (slot was empty before) or `keep` (slot's original is gone — set `replaced`). See research.md D11; the three-way split is decided, not open.
- [ ] T043 [US4] Implement the "Strip list by holder" output section in `oracle/analytics/gear-moves.mjs` per `contracts/cli.md` — **third**, after "Restore by champion" and before "Gone", with a header counting champions and pieces, and one explicit line per disposition (`auto` prints as a stated no-op, never as an omission)

**Checkpoint**: Both groupings of the moves are available; a restore can be driven from either end.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T044 [P] Add a numbered entry for `gear-moves.mjs` to `oracle/analytics/README.md` under `## Run`, matching the format of the `analyze.mjs`, `champion-gear.mjs` and `speed.mjs` entries, including its full `node --experimental-sqlite …` invocation and why both arguments are required
- [ ] T045 Confirm empty-result legibility: two identical snapshots produce all four section headers with zero entries and exit 0, never an error and never a silent empty output
- [ ] T046 If the local snapshots happen to be present, smoke-test against `oracle/resources/2026-08-12-RSLHelper.db` → `oracle/resources/2026-08-16-RSLHelper.db` and confirm 34 moved items across 16 champions, 47 gone and 58 new, with 4 of the moved also leveled. These files are git-ignored personal data and absent from a fresh checkout — skip this task when they are missing; it is not the acceptance gate.
- [ ] T047 If the local snapshots happen to be present, smoke-test the driver-session pair `oracle/resources/2026-08-16-pre-driver.db` → `oracle/resources/2026-08-16-post-driver.db` and confirm 108 moved pieces — 92 off 44 champions, 50 onto 6 champions, of which 34 `return` and 16 `auto` — with 0 gone, 0 new, 4 moved pieces leveled and exactly one fingerprint shared by two items. Same git-ignored caveat as T046; skip when absent.
- [ ] T048 Run the verification gate from the repository root: `npm run build && npm test && npm run lint` — all three must pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → blocks everything
- **Phase 2 (Foundational)** → blocks all user stories. T002 must land first: it changes shared behaviour every later task depends on, and T012 asserts it.
- **Phase 3 (US1)** → depends on Phase 2. Delivers the MVP.
- **Phase 4 (US2)** → depends on US1's `describeItem` and diff; adds no new exported function
- **Phase 5 (US3)** → depends on US1's `diffLocations` and `collisionCounts`. Also supplies `gone`, which US4's `keep` disposition reads as `goneIds` — so US4 lands after US3, not merely after US1.
- **Phase 6 (US4)** → depends on US1's `diffLocations` and `describeItem`, and on US3's `gone`. T040 asserts agreement with US2's grouping, so it is written after Phase 4.
- **Phase 7 (Polish)** → last

### Within Phase 2

T002 → T003 (verify the shared consumer before building on the change) → T004 → T005 (same file, comment describes the change) → T006 → T007, T008. T009 gates T010, T011 and T012.

### Within User Story 1

All tests T013–T023 are parallel with each other. Implementation order: T024 → T025 → T026 → T027 → T028 → T029.

### Parallel Opportunities

- T010, T011, T012 after T009
- T013 through T023 — eleven independent test cases in one file; if one agent owns the file, write them in a single pass
- T034 through T040 — seven more independent test cases in that same file
- T044 is independent of all code tasks and can run at any point

⚠️ Note: every test task targets the same file, `oracle/analytics/__tests__/gear-moves.test.mjs`. They are marked [P] because they are logically independent, but concurrent edits to one file will conflict — have one agent write them, or serialize the writes.

---

## Implementation Strategy

### MVP First

Phases 1–3 (T001–T029) produce a working, useful tool: every moved piece named by sight, with where it was and where it went. A restore is possible from that list by hand. Stop there and it is still worth shipping.

### Incremental Delivery

US2 reorganizes existing information into the shape the work actually takes — high convenience, no new data. US3 adds the one category the tool cannot fix but must not hide. US4 reorganizes it a second time, keyed by who is wearing the gear rather than who is missing it, which is what a session concentrated on a few rebuilt champions actually costs to undo. Each is independently valuable and independently testable.

### Blast Radius

One task reaches outside this feature. T002 edits `oracle/lib/decode.mjs`, which is shared with the differential-probe harness — hence T003 verifying that consumer explicitly. The change itself is one word, and both callers are SELECT-only, but a prior TODO deliberately left this file alone, so it is confirmed rather than assumed.

### Test Count

23 unit tests total: 4 in Foundational (T010, T011, T012 plus the scaffold in T009), 11 in US1 (T013–T023), 2 in US3 (T031, T032), 7 in US4 (T034–T040). Fifteen are carried through from the reviewed design; T012 closes the FR-012/FR-015 coverage gap, and the US4 seven come with the 2026-08-17 amendment.

Two of them — T038 (`unequip`) and T039 (`keep`) — cover dispositions that appear in neither reference snapshot pair. Running the tool cannot exercise them, so the unit tests are not a supplement to manual verification there; they are the whole of it.
