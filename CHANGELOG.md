# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry carries a severity tag indicating its semver impact: `[major]`, `[minor]` or `[patch]`.

## [Unreleased]

### Added

- [minor] Read Gestal Desktop snapshots alongside RSL Helper ones, so `oracle/analytics` runs on a Mac, where RSL Helper does not: `refresh-gestal.mjs` freezes Gestal's gear, roster and stat documents into a dated `resources/<date>-Gestal.json.gz` without the account key or player id, and every tool reads it as it reads a `.db` snapshot. A Gestal snapshot carries no champion speed, so `speed.mjs` needs `--constant` on one (#39)
- [minor] Add `cross-check.mjs`: compare an RSL Helper snapshot with a Gestal one record by record — gear, champions and who wears what — and exit 1 on any difference it cannot explain (#39)

### Changed

- [patch] Pick the default snapshot in one place, `oracle/analytics/snapshots.mjs`, instead of seven per-tool copies; Gestal captures are candidates too, and on a same-date tie the Gestal capture wins (#39)

## [0.2.0] - 2026-09-30

### Added

- Version every format the app stores — `.fqbl` files, share links, `.fmbl` files and settings — behind one loader that migrates old data before checking it against today's set, faction and substat tables. Data from a newer app version is refused with a message advising a reload, and newer settings are never overwritten; damaged files and links are refused with the reason instead of failing silently (#36)

### Fixed

- Stop the Quick Generator writing values it would then refuse to open: a tier's rolls input stored a typed decimal as-is, and dropping text from another page onto a tier or ore-reroll column added a `NaN` key to the assignments (#36)

## [0.1.1] - 2026-09-25

### Fixed

- Exclude `.hivemind/` from eslint, so a probe script a hivemind worker leaves under `.hivemind/scratch/` no longer fails `npm run lint`: flat config's default ignores are only `node_modules` and `.git`, and eslint reads no `.gitignore`. Pinned by a test, because the failure is invisible in a diff (#33)

## [0.1.0] - 2026-09-25

### Added

- Add `gear-moves.mjs`: diff two snapshots and report which gear moved — where each piece was, where it is now, which pieces are gone for good, and what to take off a champion someone else geared up. Both snapshot paths are required and neither is inferred; the report goes to stdout (#23)

### Fixed

- Open the shared artifact reader read-only, so a mistyped snapshot path fails instead of creating an empty database (#23)
- Count two gear pieces as identical only when they really look alike: the "either will do" marker now accounts for the substat glyphs, the ascension bonus and the level, all of which are printed on the line (#23)
- Two pieces that read identically in slots 1-6 are counted as identical again: the "either will do" marker keyed the stored faction on every slot but is only printed on accessories, so it could split a genuine pair and stay quiet (#23)
- `restore.mjs` counts a sold piece's lookalikes over the before snapshot, where they still exist, rather than the after one the piece itself is missing from — the count came back as 1 and the marker never printed. It now states the count without offering a substitute, since a sold piece has none (#23)

### Changed

- `gear-moves.mjs` and `restore.mjs` share one copy of the slot columns, the visible-attribute fingerprint and the per-snapshot lookalike count (`oracle/analytics/gear-common.mjs`), so the two reports cannot disagree about which pieces are indistinguishable (#23)
