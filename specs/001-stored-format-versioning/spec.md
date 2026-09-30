# Feature Specification: Versioned Stored Formats

**Feature Branch**: `001-stored-format-versioning`  
**Created**: 2026-09-29  
**Status**: Draft  
**Input**: User description: "Version .fqbl, share links, .fmbl and settings with per-version schemas and one loader". This spec comes from a brainstormed and reviewed design; its technical detail is carried into the plan.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Saved work keeps opening with the same meaning (Priority: P1)

A player may have saved Quick Generator files (`.fqbl`) or Generator files (`.fmbl`), kept or received share links, or customised settings before this change. After the update, all of it opens, and it means exactly what it meant before: the same sets in the same tiers, and the same profiles, factions, rolls and settings.

**Why this priority**: Saved work is the player's investment. Losing it, or silently changing what it means, produces filters that sell gear the player meant to keep. It is also the foundation the planned faction renumbering depends on.

**Independent Test**: Load a sample of every historical version of each format, including share links and settings stored before versioning existed, and compare what loads with what the app produced before the change.

**Acceptance Scenarios**:

1. **Given** a Quick Generator file saved in any format version from 1 to 4, **When** the player opens it, **Then** it loads with the same content as before the change.
2. **Given** a share link created before links carried a version, **When** the player opens it, **Then** it loads as before.
3. **Given** settings stored before versioning, **When** the app starts, **Then** the player's settings apply unchanged.
4. **Given** a Generator file saved by an early build, carrying a since-removed field or lacking main stats, **When** the player opens it, **Then** it loads.
5. **Given** a file or link saved after the change, **When** it is opened again, **Then** it loads back identical.

---

### User Story 2 - Data from a newer app version is refused clearly (Priority: P2)

A player's browser may still run an older cached copy of the app while the file, link or settings in front of it were written by a newer copy. The app does not load half-understood data or fail silently. It says the data comes from a newer version and that reloading the page will update the app. The older copy never overwrites newer settings.

**Why this priority**: Without it, a stale copy could misread future format changes, starting with the faction renumbering, and silently produce wrong filters.

**Independent Test**: Present each format with a version above the current one. Check that the message appears and that nothing is loaded or overwritten.

**Acceptance Scenarios**:

1. **Given** a Quick Generator or Generator file from a newer version, **When** it is opened, **Then** the app refuses it with a message that names the file's version and the newest version the page reads, and advises a reload.
2. **Given** a share link from a newer version, **When** it is opened, **Then** the default tab opens, a message advises reloading, and the link stays in the address bar so that a reload can open it.
3. **Given** settings stored by a newer version, **When** the app runs, **Then** it uses default settings for that page load, never writes over the stored settings, and the settings dialog explains why its controls are disabled.

---

### User Story 3 - Broken data is refused with a reason (Priority: P2)

A player opens a damaged or hand-edited file, or a truncated link. The app refuses it and says why, instead of loading it half-broken or silently showing the default tab.

**Why this priority**: Today files are not checked at all and link failures are silent, so players cannot tell what went wrong.

**Independent Test**: Open invalid files and damaged links. Check that each shows a specific message and that nothing is loaded.

**Acceptance Scenarios**:

1. **Given** a file with an invalid value, **When** it is opened, **Then** it is refused with a message naming the first problem found (which field, and why).
2. **Given** a damaged or truncated share link, **When** it is opened, **Then** the default tab opens and a message says the link couldn't be opened.
3. **Given** a file with extra fields the app doesn't know, **When** it is opened, **Then** the extra fields are ignored and the rest loads.
4. **Given** any share link, **When** it is opened, **Then** it is accepted or rejected exactly as before this change: same size limits, same stripping of HTML-significant characters, same rejection of unexpected fields.

---

### User Story 4 - The app no longer writes data it would refuse (Priority: P3)

A player types a decimal into a roll input, or drags unrelated text onto a set column. The app stores a whole number or ignores the drop, so it never saves a file it would then refuse to open.

**Why this priority**: The validation in Story 3 must never lock players out of files the app itself just wrote.

**Independent Test**: Type decimals into the roll inputs and numeric settings, drop unrelated text onto set columns, and check the stored values.

**Acceptance Scenarios**:

1. **Given** a tier's roll input, **When** the player types 6.5, **Then** 7 is stored.
2. **Given** a numeric settings field, **When** the player types a decimal, **Then** the rounded value is stored.
3. **Given** a tier or ore-reroll column, **When** text that isn't a known set is dropped on it, **Then** nothing changes.

---

### User Story 5 - Maintainers can change a stored format safely (Priority: P3)

A maintainer changes what a format stores, starting with the planned faction renumbering. They add one upgrade step per affected format. Old data is upgraded before it is checked against the new reference tables, and each step is tested with a sample in the old shape.

**Why this priority**: It enables the faction fix, and every later format change, without breaking saved work.

**Independent Test**: Take a test format whose data holds an id that is valid only in an old numbering. The old version accepts the id, the upgrade step maps it, and the current version rejects it if it arrives unmapped.

**Acceptance Scenarios**:

1. **Given** a format with upgrade steps, **When** old data is loaded, **Then** every step runs in order, and the result is checked against the current reference tables only after upgrading.
2. **Given** an upgrade step that produces the wrong shape, **When** data passes through it, **Then** loading fails instead of accepting the result.

---

### Edge Cases

- A newer-version document that also has unfamiliar extra fields still reports "newer version", not "damaged".
- A version marker that isn't a positive whole number counts as damaged data. For settings, defaults are used and the next save replaces the stored value.
- If browser storage is unavailable (private browsing, some test environments), settings fall back to defaults without errors.
- A single invalid setting falls back to its default on its own; the other settings are kept.
- A file may hold more blocks than a share link allows; the link-only size limits do not apply to files.
- Share links with reserved object keys inside nested maps are rejected, as today.
- Files that already hold values the old UI could write by mistake (decimal rolls, stray entries from foreign drops) are refused with the reason. They are not repaired on load.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Every format the app writes (Quick Generator files, share links, Generator files and stored settings) MUST record the version of the format it was written with. The app MUST only ever write the current version.
- **FR-002**: The app MUST load data of every earlier version of each format by upgrading it one version at a time to the current version, preserving the meaning of every stored value.
- **FR-003**: Share links and stored settings written before versioning existed MUST be treated as a fixed, known version: share links as Quick Generator format version 4, settings as version 1.
- **FR-004**: Quick Generator files and share links MUST share one version number and one upgrade path.
- **FR-005**: Data MUST be upgraded to the current version before it is checked against the app's current reference tables (sets, accessory sets, factions, substat presets). Data in older versions is checked for structure only.
- **FR-006**: Every intermediate result of an upgrade MUST be checked against the next version's structure, so that a faulty upgrade step fails the load instead of producing bad data.
- **FR-007**: Data from a version newer than the app supports MUST NOT be loaded, partially or otherwise. For files and share links, the player MUST see a message that the data comes from a newer version and that reloading will update the app. FR-008 covers settings from a newer version.
- **FR-008**: Settings from a newer version MUST leave stored settings untouched. The app runs on defaults for that page load, and the settings dialog shows an explanation with its controls, including reset, disabled.
- **FR-009**: A share link that fails to open for any reason MUST produce a visible message after the default tab opens, and the link MUST remain in the address bar.
- **FR-010**: Share links MUST be accepted or rejected exactly as today: same size limits, same rejection of unexpected fields and reserved keys, same stripping of HTML-significant characters.
- **FR-011**: Quick Generator and Generator files MUST be validated when opened. An invalid file MUST be refused with a message naming the first problem found. Unknown extra fields MUST be ignored. Link-only size limits MUST NOT apply to files.
- **FR-012**: Generator files from early builds, carrying a since-removed field or lacking main stats, MUST load.
- **FR-013**: Each stored setting MUST fall back to its default individually when missing or invalid. Defaults handed out MUST be independent copies, so that editing them never alters the defaults themselves.
- **FR-014**: Stored settings MUST be upgraded in memory only. Storage is written only when the player changes a setting.
- **FR-015**: Roll inputs and numeric settings inputs MUST store whole numbers, rounding typed decimals. Set columns MUST ignore dropped text that isn't a known set.
- **FR-016**: Each upgrade step MUST have an automated test using a sample in its version's shape. The rule for when to bump a version MUST be documented alongside the format definitions.

### Key Entities

- **Stored document**: what the app writes to a file, a link or browser storage; a version marker plus the payload.
- **Format**: the version history of one kind of stored document. It holds the shape of each past version, the upgrade step from each version to the next, and the current version's checks.
- **Quick Generator state**: tiers, set assignments, build profiles, custom profiles, rare-accessory selections by faction, ore-reroll assignments and strict mode. Stored in `.fqbl` files and share links.
- **Generator groups**: rule groups with sets, slots, stats, rolls, rank, rarity and faction. Stored in `.fmbl` files.
- **Settings**: the player's preferences (default tab, tier rolls, rank-5 roll adjustment, ore-reroll columns, default rolls, tab limits). Stored in the browser.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Samples of every historical version of every format load with 100% of their content preserved. This covers Quick Generator versions 1–4, Generator version 1 with its early variants, and share links and settings from before versioning.
- **SC-002**: 100% of share links that were accepted before the change are still accepted, and 100% of those that were rejected are still rejected.
- **SC-003**: In 100% of newer-version cases nothing is loaded or overwritten. Files and share links show the newer-version message; for newer settings, the settings dialog shows it. Stored settings are byte-identical afterwards.
- **SC-004**: No share-link failure is silent.
- **SC-005**: Every upgrade step has at least one dedicated automated test.
- **SC-006**: Everything the app writes loads back identical in 100% of tested cases, including a document that uses every field.
- **SC-007**: A test format whose ids are renumbered between two versions loads correctly once one upgrade step is added, with no change to the loading logic. The follow-up faction renumbering relies on the same mechanism: one upgrade step per affected format.

## Assumptions

- The web app is served as a static site, and players get the latest version on reload. Newer-version data therefore mainly comes from stale cached pages or tabs left open across a release.
- RSL Helper's `.hsf` files and the oracle's local files are out of scope.
- The faction renumbering itself is a separate follow-up; this feature changes no stored meaning.
- Files that already hold values the old UI could write by mistake are refused with the reason rather than repaired. This was decided during design.
- Every pre-versioning share link is valid under Quick Generator version 4: links date from version 3, and version 4 only added optional fields.
