# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry carries a severity tag indicating its semver impact: `[major]`, `[minor]` or `[patch]`.

## [Unreleased]

### Added

- [minor] Add `gear-moves.mjs`: diff two snapshots and report which gear moved and where it went (#23)

### Fixed

- [patch] Open the shared artifact reader read-only, so a mistyped snapshot path fails instead of creating an empty database (#23)
