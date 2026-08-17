# Research: Gear Movement Diff

**Feature**: 001-gear-moves-diff | **Date**: 2026-08-16

No `NEEDS CLARIFICATION` markers were carried out of the specification, so this phase records the
decisions already taken and the evidence behind them rather than opening new investigations. Every
figure below was measured against the two reference snapshots, not estimated.

---

## D1. Location comes from the champion table's slot columns, never the artifact pointer

**Decision**: Derive "who is wearing this item" from the nine gear-slot columns on the champion
table. Never derive it from the artifact table's equipped-champion pointer.

**Rationale**: The source application does not clear the artifact pointer when a piece is
unequipped, so it keeps naming the last wearer indefinitely. Measured on the later reference
snapshot:

| Measure | Value |
| --- | --- |
| Champion slot entries | 4408 |
| ...of which dangling (no matching item) | 0 |
| Artifact rows with a non-empty wearer pointer | 4444 |
| **Stale pointers** | **36** |
| Stale pointers whose item is worn by someone else | 0 |
| Champion slot entries whose item does not point back | 0 |

The disagreement is strictly one-directional. All 36 stale pointers sit on the 7 champions whose
gear was swapped the day before the snapshot, and every one of them is on an item that is currently
unequipped. A tool keyed on the pointer would therefore report 36 moves that never happened, before
anyone touched the account.

**Alternatives considered**:

- *Use the artifact pointer and filter out the stale ones.* Requires the slot columns anyway to know
  which are stale, so it is strictly more work for the same answer.
- *Cross-check both and report disagreements.* Rejected as scope: the disagreement is a known
  property of the source application, not a signal about this account, and surfacing it every run
  would be noise.

---

## D2. Items are identified by in-game visible attributes, not by internal id

**Decision**: Every item, in every section, is printed as rarity, rank, set, slot, level, main stat
and value, each substat with value and glyph, ascension bonus, and faction where applicable. The
internal id may ride along as a trailing reference but is never the sole identifier.

**Rationale**: The restore is performed by hand in the game UI, which never displays internal ids.
An id-keyed report is unusable for the only task this feature exists to serve. A visible fingerprint
is discriminating enough to work: across 8485 items only **2** share a full visible appearance with
anything else.

**Alternatives considered**:

- *Print the id and let the user search for it.* There is nothing to search — the id does not appear
  anywhere in the game.
- *Print a shortened hash of the visible attributes.* Compact, but a human cannot match a hash
  against a piece of gear by eye, which is the entire operation.

---

## D3. The fingerprint sorts substats before joining

**Decision**: Normalize substat order inside `fingerprint`.

**Rationale**: Measured both ways over the same 8485 items — order-sensitive comparison finds **0**
collisions; order-insensitive finds the **1 group of 2 items** that D2 relies on. Since substats are
stored in an arbitrary order, two visually identical pieces can differ only in storage order. An
order-sensitive fingerprint would therefore report every item as unique, silently turning the
ambiguity marker into dead code that never fires — a failure that looks exactly like success.

**Alternatives considered**:

- *Compare in stored order and accept the miss.* Rejected: it produces a confidently wrong report,
  telling the user a piece is uniquely identified when two candidates exist.

---

## D4. Moved items render from the after snapshot; gone items from the before snapshot

**Decision**: Render a moved item as it appears in the after snapshot. Render a gone item from its
before row, since no after row exists for it.

**Rationale**: The user is matching printed values against what is in the game right now, so the
after snapshot is the correct source for anything that still exists. Levelling changes substat
values, so a piece described from the earlier snapshot may be unmatchable by eye — 19 items levelled
across the reference window, 4 of them among the moved. Those 4 carry an explicit tag.

Gone items are the exception and must be handled deliberately: all **47** of them have fingerprints
absent from the after snapshot, so an after-scoped collision lookup returns `undefined` for every
single one. A template interpolating that count would print "undefined identical" on all 47 lines.

**Alternatives considered**:

- *Render everything from the before snapshot.* Consistent and simpler, but the values printed for
  levelled pieces would not match what the user sees, defeating D2.
- *Render everything from the after snapshot.* Impossible for gone items by definition.

---

## D5. Extend the existing champion reader rather than adding a second one

**Decision**: Append the nine slot columns to `readChampRows` in `oracle/analytics/champs.mjs`.

**Rationale**: That function already does everything correctly — opens `readOnly: true`, names its
columns explicitly, and reads big integers safely. The extension is purely additive: both existing
callers destructure named fields only, and the big-integer coercion is generic over the selected
columns, so neither can break. A parallel reader would be a second way to interpret a snapshot,
which the suite deliberately avoids.

Two constraints ride along. The named-column `SELECT` is **not** stylistic: `SELECT *` throws
`RangeError: ERR_OUT_OF_RANGE` because `RecentBattleTicks` exceeds JS number range. And the
function's comment naming its two consumers goes stale on a third, so it must be refreshed.

**Alternatives considered**:

- *A local `SELECT` inside the new tool.* Duplicates the read-only and big-integer handling, and
  would have to rediscover the `SELECT *` overflow independently.

---

## D6. Both snapshot paths are required; nothing is auto-selected

**Decision**: Two required positional arguments. No "newest two" fallback.

**Rationale**: The other tools in the suite resolve a default snapshot by globbing
`/-RSLHelper\.db$/` and taking the lexically last match. Kept baselines are deliberately named
outside that pattern precisely so a routine refresh cannot overwrite them — which also means a
default would never select one. Since a baseline is exactly what a "before" argument should be, an
auto-selecting default would reliably choose the wrong file and produce a plausible, wrong report.

**Alternatives considered**:

- *Default the "after" argument to the newest snapshot.* Halves the typing and keeps the hazard,
  because the dangerous argument is the other one.

---

## D7. Two lookalike formatting helpers are avoided

**Decision**: Use `statDisplayName(statId, isFlat)` and `ITEM_RARITIES[item.rarity]`.

**Rationale**: `STAT_NAMES` is documented in-tree as a placeholder with unverified labels and is
percent-only, so a flat HP substat renders as "HP%" — wrong on the exact field a human matches
against. `describeRarity` maps `.hsf` threshold ids, not item rarity, and returns strings like
`">= Epic"` or `"Unknown(3)"`. Both are plausible-looking wrong choices, which is why they are
called out rather than left to judgement.

**Alternatives considered**: none — these are corrections, not trade-offs.

---

## D8. Faction labels are printed as-is

**Decision**: Print faction labels the way the existing tools do, and do not attempt to correct
them in this change.

**Rationale**: A known id-space discrepancy affecting human-readable faction labels is already
tracked as deferred in `oracle/analytics/DESIGN.md` §9. Raw ids are unaffected, so fingerprinting
and matching are safe. Fixing it here would widen an unrelated change and desynchronize this tool's
labels from every other tool in the suite.

**Alternatives considered**:

- *Fix the mapping as part of this work.* Rejected as scope creep against an explicitly deferred
  decision with its own open questions.

---

## D9. The shared artifact reader is switched to read-only

**Decision**: Change `oracle/lib/decode.mjs` to open the database with `{ readOnly: true }`.

**Rationale**: The champion reader already opens read-only, but the artifact reader — the only route
to item data — opens read-write with no options. That makes the read-only guarantee in
`contracts/cli.md` unachievable: a mistyped path is *created* rather than rejected, leaving a stray
empty database behind that a later run would treat as a real but empty snapshot.

Measured on the actual files, both halves of the claim hold:

| Behaviour | `readOnly: true` | current (read-write) |
| --- | --- | --- |
| Artifact read on a real snapshot | succeeds, 8485 rows | succeeds |
| Open a path that does not exist | throws `ERR_SQLITE_ERROR` | succeeds |
| Stray file left behind | **no** | **yes** |

The change is safe for both consumers. `readArtifactRows` is imported by exactly two callers —
`oracle/probe/probe.mjs` and `oracle/analytics/decode.mjs` — and both issue a single `SELECT`. There
is no write path to break.

**Scope note**: this file is shared with the differential-probe harness, and an existing repo TODO
deliberately left it alone pending its own verification pass. That caution is respected by verifying
the probe still runs as part of the change rather than by avoiding the change; the measurement above
is that verification for the analytics half.

**Alternatives considered**:

- *Validate both paths exist in the tool before opening anything.* Closes the hole for this one tool
  while leaving every other consumer of the shared reader exposed, and leaves the same latent bug
  for the next tool to rediscover. It also treats a one-word fix as untouchable.
- *Weaken the contract to match the current behaviour.* Rejected: it documents a defect as a
  feature, and the defect is the kind that destroys data confidence — an empty database that looks
  like a real snapshot.

## D10. The per-holder view is the same moves, keyed by who is wearing them

**Decision**: Add a fourth output section grouped by the champion currently **wearing** moved gear —
each piece on them plus the champion it came off — rather than treating "restore by champion" as
sufficient. Placed third, after the per-owner view and before the unrecoverable list.

**Rationale**: Measured on a real swapping session, gear is not spread thinly. Six champions were
built up and held **50 of the 108 moved pieces** between them, while 38 more were stripped of one to
three pieces each. Working only from the per-owner view, every one of those 50 costs a round trip:
open the champion who is missing a piece, learn it is on a rebuilt champion, go there, come back.
Keyed the other way, the same 50 pieces are six entries, and a rebuilt champion empties in one pass.

The two views are the same data, so the cost is a grouping and a print loop, not a second diff. That
they must agree is stated as FR-018 rather than left implicit, because they are computed by
different traversals of the same `moved` array and could drift.

Not every moved piece appears in the new view: it lists only the ones currently **on** a champion.
The 58 pieces sitting in the vault have no holder to open, and remain the per-owner view's business.

**Alternatives considered**:

- *Print the flat moved list sorted by current holder.* Cheaper, but the flat list already exists and
  the owner's problem is not sort order — it is that a holder's pieces belong to many different
  champions and each needs naming next to the piece.
- *Replace the per-owner view with this one.* Rejected: it answers "what is this champion wearing
  that isn't theirs", not "what is this champion missing". A champion whose piece went to the vault
  has no holder entry at all, so the restore would be incomplete.

## D11. A vault-sourced piece is classified by what its slot gets back

**Decision**: In the per-holder view, a piece the swapper pulled out of the vault carries one of
three dispositions — `auto`, `unequip`, or `keep` — decided by what the holder had in that slot in
the before snapshot. A piece that came off another champion is always `return`.

**Rationale**: The obvious rule, "vault pieces go back to the vault", is wrong twice.

| Holder's slot in the before snapshot | Disposition | Why |
| --- | --- | --- |
| Held a piece that still exists | `auto` | Restoring the slot puts the original back and displaces this one; telling the owner to unequip it invents a step |
| Was empty | `unequip` | Nothing will ever displace it — omitting it leaves the account short of the pre-session state with no sign why |
| Held a piece that is now **gone** | `keep` | There is nothing to put back, so unequipping only leaves an empty slot; the report says to leave it and names the sold piece it replaced |

Measured on the reference driver-session pair: all 16 vault-sourced pieces are `auto`, because every
one landed in a slot that had an occupant. That is what makes the other two branches dangerous —
they are invisible in the data on hand, so they must be covered by hand-built unit tests rather than
by running the tool and reading the output. The `keep` branch is reachable in practice: the earlier
reference pair carries 47 gone items.

**Alternatives considered**:

- *Treat `keep` as `unequip` — restore the pre-session state verbatim.* Rejected in the spec's
  Session 2026-08-17 clarification. It is the one variant that gives advice against the owner's
  interest: strip a working piece to leave a slot that cannot be refilled.
- *Say nothing and let the unrecoverable section carry it.* Makes the owner join two sections by eye
  to discover that one line of instruction is wrong.
