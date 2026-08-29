# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry carries a severity tag indicating its semver impact: `[major]`, `[minor]` or `[patch]`.

## [Unreleased]

### Added

- [minor] Add `gear-moves.mjs`: diff two snapshots and report which gear moved and where it went (#23)

### Fixed

- [patch] Open the shared artifact reader read-only, so a mistyped snapshot path fails instead of creating an empty database (#23)
- [patch] Count two gear pieces as identical only when they really look alike: the "either will do" marker now accounts for substat glyphs and the ascension bonus, both of which are printed on the line (#23)
- [patch] `gear-moves.mjs` rejects an extra argument or an option instead of ignoring it, so `-o report.md` carried over from `restore.mjs` fails with usage rather than vanishing (#23)
- [patch] `gear-moves.mjs` reports how many rows each snapshot dropped as unreadable, and warns when the two disagree — an undecodable row made a piece look sold with nothing in the report to show otherwise (#23)

### Changed

- [patch] `gear-moves.mjs` strip list states where every piece came from, not just the ones handed back to a champion: the three vault dispositions say so in words instead of leaving it to be inferred from the group header (#23)
- [patch] `gear-moves.mjs` and `restore.mjs` share one copy of the slot columns and the visible-attribute fingerprint (`oracle/analytics/gear-common.mjs`), so the two reports cannot disagree about which pieces are indistinguishable (#23)
