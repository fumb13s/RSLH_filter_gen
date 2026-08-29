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
- [patch] `gear-moves.mjs` rejects an extra argument or an option instead of ignoring it, so `-o report.md` carried over from `restore.mjs` fails with usage rather than vanishing. An empty argument counts as an argument, so an unset shell variable cannot pad a run out into a correct-looking one (#23)
- [patch] `gear-moves.mjs` reports how many rows each snapshot dropped as unreadable, and calls out a row that decodes in only one of them — an undecodable row made a piece look sold with nothing in the report to show otherwise. The call-out compares *which* rows failed to decode rather than how many, since equal counts hide a piece that stopped decoding while a different unreadable one was sold, and unequal counts cast doubt on a clean gone list. Each direction names the section it undermines: one puts a phantom in the gone list, the other leaves the moved list short (#23)
- [patch] Two pieces that read identically in slots 1-6 are counted as identical again: the "either will do" marker keyed the stored faction on every slot but is only printed on accessories, so it could split a genuine pair and stay quiet (#23)
- [patch] `gear-moves.mjs` extends the stopped-decoding caveat to the strip list, which draws the replaced piece on a `keep` line from the same gone list and so can assert a piece was SOLD when it only stopped decoding (#23)
- [patch] `gear-moves.mjs` states the started-decoding caveat as the decode flip it counts. "The after snapshot decodes N pieces the before one does not" is equally true of every piece acquired during the session, so the number could not be reconciled with the report; it also no longer asserts a move, since a row that started decoding may have sat still (#23)
- [patch] `gear-moves.mjs` stops offering a substitute for a piece that is gone: the two places that name a sold piece — the gone list and the `— SOLD` line in the strip list — now read "(2 pieces looked like this before)" instead of "either will do", which promised a replacement that does not exist and, even where a twin survives, never said which one it was (#23)
- [patch] `gear-moves.mjs` omits the main/substat separator on a piece that has no substats, instead of trailing off as `ATK 265 |  · #1`. A low-rank artifact at +0 has none, and that is the gear that gets sold, so these land in the gone list in quantity (#23)

### Changed

- [patch] `gear-moves.mjs` strip list states where every piece came from, not just the ones handed back to a champion: the three vault dispositions say so in words instead of leaving it to be inferred from the group header (#23)
- [patch] `gear-moves.mjs` and `restore.mjs` share one copy of the slot columns and the visible-attribute fingerprint (`oracle/analytics/gear-common.mjs`), so the two reports cannot disagree about which pieces are indistinguishable (#23)
