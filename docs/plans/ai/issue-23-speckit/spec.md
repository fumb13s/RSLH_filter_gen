# Feature Specification: Gear Movement Diff

**Feature Branch**: `001-gear-moves-diff`
**Created**: 2026-08-16
**Status**: Draft
**Input**: User description: build a tool that takes two gear-vault snapshots, one from before a gear-swapping session and one from after, and reports which gear items moved and where they went, so the owner can put the gear back.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See exactly what moved (Priority: P1)

The owner hands the account to another person to build teams. That person rearranges worn gear across many champions. Afterwards the owner captures a second snapshot and asks the tool what changed. They get a list: for every piece that moved, what the piece is, which champion was wearing it before, and which champion is wearing it now — or that it is now sitting unequipped.

**Why this priority**: This is the whole point of the feature and the minimum that delivers value. With nothing but this list the owner can already restore gear by hand. Every other story is a convenience layered on top.

**Independent Test**: Capture two snapshots with a handful of known swaps between them, run the tool, and confirm the list names exactly those swaps and nothing else.

**Acceptance Scenarios**:

1. **Given** two snapshots in which one piece was taken off champion A and put on champion B, **When** the owner runs the tool, **Then** the report names that piece and states it went from A to B.
2. **Given** two snapshots in which a piece was taken off a champion and left in the vault, **When** the owner runs the tool, **Then** the report states its new location is unequipped rather than naming a champion.
3. **Given** two snapshots in which no gear was equipped or unequipped, **When** the owner runs the tool, **Then** the report lists zero moved items.
4. **Given** any moved piece, **When** the owner reads its line, **Then** the piece is described by attributes they can see on it in the game, not by an internal identifier.

---

### User Story 2 - Work through the restore champion by champion (Priority: P2)

The owner performs the restore by hand in the game, one champion at a time. Rather than mentally regrouping a flat list, they want a view organized the way the work is actually done: for each affected champion, only the slots that changed, what that champion should be wearing, and where that piece is right now.

**Why this priority**: It does not add information beyond User Story 1 — it reorganizes it — but it is the difference between a report you cross-reference and a report you work from. Valuable, but the feature is still useful without it.

**Independent Test**: Run against a pair of snapshots with several affected champions and confirm each champion appears once, listing only its changed slots, and that following the list restores that champion completely.

**Acceptance Scenarios**:

1. **Given** a champion that lost two pieces and kept seven, **When** the owner reads that champion's entry, **Then** only the two changed slots are listed.
2. **Given** a piece that should return to champion A but is currently on champion B, **When** the owner reads champion A's entry, **Then** it states the piece is currently on champion B.
3. **Given** a piece that should return to a champion and is currently unequipped, **When** the owner reads that entry, **Then** it says so explicitly rather than omitting the location.

---

### User Story 3 - Know what cannot be put back (Priority: P3)

Some pieces are not merely moved — they were sold or consumed during the session and no longer exist. The owner needs these called out separately, because no amount of re-equipping will recover them and time spent hunting for them is wasted.

**Why this priority**: Lower frequency and lower urgency than the moves, but it is the one category the tool cannot help with, so leaving it silent would be actively misleading.

**Independent Test**: Run against a pair of snapshots in which pieces were sold, and confirm those pieces appear only in the unrecoverable section and never in the moved list.

**Acceptance Scenarios**:

1. **Given** a piece present in the before snapshot and absent from the after snapshot, **When** the owner runs the tool, **Then** it appears in the unrecoverable section and not among the moved items.
2. **Given** an unrecoverable piece, **When** the owner reads its description, **Then** it is described as it last appeared, since there is no current appearance to describe.

### Edge Cases

- **Nothing changed.** Two identical snapshots produce an empty report, not an error.
- **Newly acquired gear.** A piece present only in the after snapshot did not move and is not lost; it appears only as context for whatever it displaced.
- **Two pieces that look the same.** When a description matches more than one piece, the report says how many match, so the owner knows any of them will serve rather than believing the report is wrong.
- **A piece that changed while it moved.** Upgrading a piece changes the values printed on it. A piece described from the wrong point in time cannot be matched by eye, so descriptions must state which pieces changed.
- **A champion that no longer exists.** Champions can be consumed between snapshots. Their gear still needs a home named, so the champion must be identified by name and flagged as gone rather than reduced to a bare identifier.
- **Snapshots supplied in the wrong order.** The report would be exactly inverted and still internally consistent, so it cannot be caught by reading it. The tool warns when the "before" snapshot is not the older of the two.
- **The same snapshot supplied twice.** Produces an empty report, which is correct but likely a mistake; the tool says so.
- **An unreadable or missing snapshot.** Fails immediately with a message naming the file, rather than reporting an empty or partial diff that reads like "nothing moved".

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The tool MUST require the operator to name both snapshots explicitly, and MUST refuse to run if either is missing.
- **FR-002**: The tool MUST NOT select a snapshot automatically or infer one from naming conventions, because kept baselines are deliberately named outside the pattern the other tools recognize and a silent default would select the wrong file.
- **FR-003**: The tool MUST determine what each champion is wearing from a record that reflects current equipment. It MUST NOT rely on any record the source system is known to leave stale after an unequip. For a pair of snapshots in which nothing was equipped or unequipped, the report MUST contain zero moved items.
- **FR-004**: The tool MUST express every location as either a named champion or an explicit statement that the piece is unequipped. A blank or omitted location is not acceptable.
- **FR-005**: The tool MUST identify every piece, in every section, by attributes visible on it in the game — rarity, rank, set, slot, level, main stat and value, each substat with its value and any enhancement, ascension bonus, and faction where it applies. An internal identifier MUST NOT be the only means of identifying a piece.
- **FR-006**: Where a visible description matches more than one piece, the tool MUST state how many pieces match, so ambiguity is explicit rather than silent.
- **FR-007**: The tool MUST describe moved pieces as they currently appear, and unrecoverable pieces as they last appeared.
- **FR-008**: The tool MUST flag any moved piece whose level changed between snapshots, since its printed values will differ from what the earlier snapshot would have shown.
- **FR-009**: The tool MUST provide a per-champion view listing only that champion's changed slots, what each should hold, and where that piece currently is.
- **FR-010**: The tool MUST list pieces present before and absent after in a section distinct from the moved items, marked as unrecoverable.
- **FR-011**: The tool MUST name a champion absent from the after snapshot using the name recorded in the before snapshot, and MUST mark that champion as missing.
- **FR-012**: The tool MUST NOT modify either snapshot or any data belonging to the source system. It is strictly advisory.
- **FR-013**: The tool MUST warn when the snapshot named "before" is not the older of the two, since an inverted report is internally consistent and cannot be detected by reading it.
- **FR-014**: The tool MUST report a failure that names the offending file when a snapshot cannot be read, and MUST NOT emit an empty or partial report in that case.
- **FR-015**: The tool MUST NOT create any file, including when given a path that does not exist. A mistyped snapshot path must fail, not quietly produce an empty database that a later run would then treat as a real but empty snapshot.

### Key Entities

- **Snapshot**: A point-in-time capture of the account's gear and champions. Two are compared; neither is altered.
- **Item**: A single piece of gear. Has a slot it can occupy, a visible appearance, and at most one wearer at a time.
- **Champion**: A wearer of items. May be present in one snapshot and absent from the other.
- **Location**: Where an item sits in a given snapshot — a specific champion, or unequipped. There is no third state.
- **Move**: An item whose location differs between the two snapshots. Defined solely by the location change; changes to the item itself do not constitute a move.
- **Visible description**: The set of attributes a person can read off an item in the game, used both to name items in the report and to detect when two items are indistinguishable.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For every piece that moved, the owner can state both where it was and where it is now from the report alone, without consulting any other tool or record.
- **SC-002**: The report contains zero moves that did not happen. Two snapshots taken with no equipment changes between them yield an empty moved list.
- **SC-003**: Every item named in the report can be located in the game from its printed description alone. Where more than one piece matches a description, the report says so, and the owner can pick any match without affecting the outcome.
- **SC-004**: The owner can complete a full restore working champion by champion from the report, without re-deriving which champion owned which piece.
- **SC-005**: Pieces that cannot be recovered are identifiable as such before the owner starts, so no time is spent searching for them.
- **SC-006**: Against the reference pair of snapshots the report accounts for 34 moved items across 16 champions, 47 unrecoverable and 58 newly acquired, with 4 of the moved items also having changed level. This check is conditional on those snapshots being present locally; they hold personal account data and are excluded from version control.

## Assumptions

- Both snapshots come from the same account. Comparing snapshots from different accounts is out of scope and not guarded against.
- The after snapshot reflects a completed sync with the game. A snapshot captured mid-session will under-report, and detecting that is out of scope.
- The restore itself is performed by hand in the game. The tool advises and never acts, so no automation of equipping is in scope.
- The reference snapshots used for the numeric success criterion are personal data excluded from version control, so that criterion is unverifiable in a fresh checkout. The automated tests are the acceptance gate there.
- Machine-readable output and writing the report to a file are deliberately out of scope until a consumer exists that needs them.
- Ordering the restore steps is out of scope: equipping a piece in the game displaces whatever occupied that slot automatically, so per-champion order does not matter.
- The tool reads the same snapshot format the existing analytics tools already read, and reuses their reading and naming behavior rather than introducing a second way to interpret a snapshot.
- Within a single snapshot an item has at most one wearer. Verified against both reference snapshots: 4396 of 4396 and 4408 of 4408 equipment entries reference a distinct item, with no item claimed by two champions. A location is therefore a single value per item per snapshot, not a set.
- Both snapshots are assumed to come from the same version of the source application. Comparing snapshots written by different versions, where the stored shape may have changed, is out of scope.
- Performance is not a constraint at the observed scale (roughly 8,500 items and 2,000 champions per snapshot). No throughput or latency target is set.
