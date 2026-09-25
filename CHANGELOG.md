# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry carries a severity tag indicating its semver impact: `[major]`, `[minor]` or `[patch]`.

## [Unreleased]

### Added

- [minor] Add `gear-moves.mjs`: diff two snapshots and report which gear moved — where each piece was, where it is now, which pieces are gone for good, and what to take off a champion someone else geared up. Both snapshot paths are required and neither is inferred; the report goes to stdout (#23)

### Fixed

- [patch] Open the shared artifact reader read-only, so a mistyped snapshot path fails instead of creating an empty database (#23)
- [patch] Count two gear pieces as identical only when they really look alike: the "either will do" marker now accounts for the substat glyphs, the ascension bonus and the level, all of which are printed on the line (#23)
- [patch] Two pieces that read identically in slots 1-6 are counted as identical again: the "either will do" marker keyed the stored faction on every slot but is only printed on accessories, so it could split a genuine pair and stay quiet (#23)
- [patch] `restore.mjs` counts a sold piece's lookalikes over the before snapshot, where they still exist, rather than the after one the piece itself is missing from — the count came back as 1 and the marker never printed. It now states the count without offering a substitute, since a sold piece has none (#23)

### Changed

- [patch] `gear-moves.mjs` and `restore.mjs` share one copy of the slot columns and the visible-attribute fingerprint (`oracle/analytics/gear-common.mjs`), so the two reports cannot disagree about which pieces are indistinguishable (#23)
