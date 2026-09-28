# Gestal snapshot capture — design

**Date:** 2026-09-28
**Status:** agreed 2026-09-28 — file format and contents chosen by the account owner. Implemented on
`feature/gestal-snapshot`: `oracle/analytics/gestal.mjs`, `refresh-gestal.mjs`, `snapshots.mjs`,
`cross-check.mjs`, and snapshot-kind dispatch in `decode.mjs` / `champs.mjs`. Where the shipped code
differs from the first draft of this document, the text has been corrected to match it.

## Motivation

Everything in `oracle/analytics/` reads an RSL Helper vault snapshot, `resources/<date>-RSLHelper.db`,
which `refresh.sh` copies out of the live `*_RSLHelper.db`. RSL Helper does not run on macOS, so on a
Mac there is no snapshot and none of the analytics runs.

Gestal Desktop does run there (a third-party companion app; see `oracle/gestal/overview.md`). While it
is attached to Raid it keeps a full dump of the account — every gear piece, every champion — in its
data folder, re-read every 10–20 seconds. This design freezes that dump into a dated snapshot that
every analytics tool can read.

It is also the first step of a larger goal: tuning Gestal's gear-score weights so its Armory score
agrees with our own quality model. Measuring that agreement needs our model running on the same gear
Gestal scores, which is exactly this snapshot.

## Scope

- A manual capture script that freezes Gestal's documents into one dated file in `oracle/resources/`.
- An adapter from Gestal's documents to the `Item` objects and champion rows the SQLite readers already
  produce.
- Snapshot-kind dispatch in the shared readers and in snapshot discovery, so every tool takes either
  kind.
- A cross-check tool that compares an RSL Helper snapshot with a Gestal one, record by record.
- **Non-goals:** computing champions' current speed from Gestal's stat breakdown (a follow-up); the
  gear-score weights (their own design); background or automatic capture; writing anything into
  Gestal's data folder; talking to Gestal's local engine API.

## Source: what Gestal writes

Verified 2026-09-28 against Gestal Desktop 0.8.15 (macOS, arm64) and Raid 11.75.0.

- **Data root:** `~/Library/Application Support/Gestal/`. Gestal honours a `GESTAL_DATA_ROOT` override,
  and so does the capture. On Windows the same layout sits under `%LOCALAPPDATA%\Gestal`.
- **Active account:** `active.json` → `payload.activeAccountKey`. `local` is the empty guest slot.
- **Documents:** `accounts/<account-key>/…`, each shaped `{schemaVersion, payload}`:

| Document | schemaVersion | payload | Captured |
|---|--:|---|---|
| `artifacts.json` | 2 | `{extractedAt, gameVersion, artifacts[]}` — every gear piece (8,738) | yes |
| `champions.json` | 2 | `{extractedAt, gameVersion, champions[]}` — every champion (1,979) | yes |
| `relic-inventory.json` | 1 | `{extractedAt, gameVersion, relics[], stones[]}` | yes |
| `great-hall-state.json` | 1 | `{extractedAt, gameVersion, affinities[]}` | yes |
| `account-bonuses.json` | 3 | `{extractedAt, gameVersion, affinityByAffinityId[], arena[], area, areaByLocationId{}}` | yes |
| `diagnostics/last-extraction.json` | 1 | `{attemptedAt, succeeded, errorMessage, elapsedMilliseconds, gameVersion, …}` | yes |
| `metadata.json` | 2 | display name, Raid player id, last snapshot time | **no** — identifies the account |

Relic inventory, Great Hall and account bonuses (arena and area) are account-wide stat sources RSL
Helper never exposed. They are small, and a capture of a past moment cannot be retaken, so they come
along even though no tool reads them yet.

**When documents change.** Gestal reads the account only while attached to a running Raid, and writes
a document only when its content changed (its log records `Skipped artifacts (unchanged)`). So:

- Each document carries its own `extractedAt`, and a set of them is not one instant. On 2026-09-28 the
  gear and roster reads were 53 s apart, and `great-hall-state.json` was three days older than both
  because nothing in it had changed.
- A document's `extractedAt` is *when it last changed*, not when Gestal last looked. That is
  `diagnostics/last-extraction.json`: on 2026-09-28 its `attemptedAt` was eight minutes newer than the
  gear dump's `extractedAt`, because the gear had not changed in between. It is therefore what dates a
  snapshot and what judges staleness.

**Torn reads.** The decompiled engine registers an `AtomicFileWriter` for these documents, which
suggests temp-file-and-rename writes. The capture does not rely on it: a document that fails to parse is
read once more, then the capture fails.

## Verified mapping

Established on 2026-09-28 by decoding the 2026-06-05 RSL Helper snapshot with our own decoder, decoding
a Gestal capture of the same account with the adapter, and comparing every record present in both —
first with a scratch script, then with `cross-check.mjs`, whose exact comparison (no tolerance) is
possible because the adapter rounds values the way `decodeValue` does.

**Gear.** 7,853 piece ids are in both, and 7,509 decode identically — every field, values to the last
digit. Every other difference is a real change between June and September, and none is unexplained:

| Difference | Pieces |
|---|--:|
| leveled since | 146 |
| glyphs and ascension changed | 81 |
| glyphs changed | 76 |
| ascension changed | 37 |
| reworked (Gestal's `isReworked`: new main and substats) | 4 |
| **unexplained** | **0** |

| Field | Gestal | `Item` |
|---|---|---|
| slot | 0 Weapon · 1 Helmet · 2 Shield · 3 Gauntlets · 4 Chestplate · 5 Boots · 6 Ring · 7 Amulet · 8 Banner | 5 · 1 · 6 · 3 · 2 · 4 · 7 · 8 · 9 |
| stat | 1 HP · 2 DEF · 3 ATK (flat) · 4 HP% · 5 DEF% · 6 ATK% · 7 SPD · 8 C.RATE · 9 C.DMG · 10 ACC · 11 RES | `{statId, isFlat}`: HP 1 · DEF 3 · ATK 2, each flat or %; SPD 4 · C.RATE 5 · C.DMG 6 · ACC 8 · RES 7. `isFlat` is true for SPD, ACC and RES, matching RSL Helper's `fl` flag |
| damage-type substats | 16–23: PvE, PvP, Boss, Dungeon DMG +, then the same four − | 11–18, not flat — the game's own ids, which the RSL Helper path already passes through untranslated. Scoring ignores them |
| values, glyphs | integers × 100; the Mythical bonus roll is already in the value | ÷ 100 |
| rarity | `rarityId` 1–6 | `rarity` 0–5 |
| set, faction | game ids; `null` when absent | same ids; `0` when absent |
| ascension | `ascensionLevel`, 0 when not ascended; `ascensionStat {statId, value}` | `ascLevel`, −1 when not ascended (RSL Helper's convention); `ascStat` through the stat map |
| wearer | `equippedOnHeroId`, `null` when unequipped | `equippedChampId`, 0 when unequipped |

**Champions.** 1,314 hero ids are in both and 1,156 are identical. Role, rarity, faction and base type
agree for all of them. 133 were progressed since June (stars, level, empower, ascension — which moves
`typeId` — or blessing), and 25 names are spelled differently: Gestal cuts some short and uses shorter
variants ("Xena" for "Xena: Warrior Princess"). None is unexplained.

| `Champs` column | Gestal `champions.json` |
|---|---|
| `ID` | `heroId` |
| `Name` | `name` |
| `Role`, `Rarity`, `Fraction` | `roleId`, `rarityId`, `factionId` — identical id spaces |
| `Rang`, `Lvl`, `EmpLvl` | `grade`, `level`, `empowerLevel` |
| `HeroID`, `BaseHeroID`, `BId` | `typeId`, `baseTypeId`, `blessingId` (`null` → 0) |
| the nine slot columns | derived from each piece's `equippedOnHeroId` and slot |
| `SPD` (current geared speed) | **absent** — see *Gaps* |
| `Br` | **absent** — its meaning is unconfirmed; it does not track "has a blessing" (952 of 1,247 agree) |

Faction ids are the game's own in both documents (Barbarians = 13) — the space RSL Helper's `accset` and
`Fraction` already use.

## The snapshot file

`oracle/resources/<date>-Gestal.json.gz`, gzipped JSON:

```
{ format: "gestal-snapshot", formatVersion: 1,
  capturedAt,        // when the capture ran
  gestalVersion,     // Gestal Desktop's version, or null when unreadable
  documents: { artifacts, champions, "relic-inventory", "great-hall-state",
               "account-bonuses", "last-extraction" } }
```

- **Documents verbatim.** Each is embedded exactly as Gestal wrote it, so a later adapter can re-read
  an old snapshot.
- **Date** = the local date of the last successful extraction — the account-data date, the same
  convention as the `.db` snapshots. If the last extraction failed, the gear dump's `extractedAt` dates
  it instead. A second capture on the same date overwrites the first.
- **`--out PATH`** writes elsewhere, for named baselines. `restore.mjs`'s defaults
  (`*-pre-driver`, `*-post-driver`) accept either extension.
- **Size:** about 9.3 MB of JSON, **about 470 KB gzipped** — smaller than a `.db` snapshot, so it syncs
  through the notes repo just as easily.

## Components

| Unit | Responsibility |
|---|---|
| `oracle/analytics/gestal.mjs` | Reading and validating a snapshot file; the id maps; `gestalItems(snapshot)` and `gestalChampRows(snapshot)`, producing exactly the shapes of `decodeRow` and of `readAllChampRows`'s rows. Any Gestal id outside the maps throws, and so does a champion wearing two pieces in one slot. |
| `oracle/analytics/refresh-gestal.mjs` | The capture CLI. |
| `oracle/analytics/snapshots.mjs` | What counts as a snapshot argument, its date, and the newest snapshot in a folder across both kinds. |
| `decode.mjs`, `champs.mjs` | `readArtifacts` and `readAllChampRows` dispatch on the path: `.json.gz` goes to the Gestal reader, anything else to SQLite. |
| `oracle/analytics/cross-check.mjs` | Compares an RSL Helper snapshot with a Gestal one, record by record. |

The adapter sits in `oracle/analytics/` rather than beside `oracle/lib/decode.mjs`: only analytics
reads it, and it builds champion rows from `gear-common.mjs`'s slot-column table, which `lib/` should
not import.

The three tools that query SQLite themselves — `restore.mjs`, `worst-artifacts.mjs` and
`spare-copies.mjs` — switch to `readAllChampRows`. It gains the columns they read (`HeroID`,
`BaseHeroID`, `BId`, `Br`) as optional ones: selected when the `Champs` table has them and null
otherwise, because hand-built test snapshots carry a minimal table. The "newest snapshot" default,
which seven tools each re-implemented as a `*-RSLHelper.db` glob, moves to `snapshots.mjs`, and every
snapshot-argument check (`parseArgs`, `parseSpeedArgs`, `spare-copies.mjs`) accepts `.json.gz`.

## Capture flow

1. Resolve the data root: `GESTAL_DATA_ROOT`, else the macOS default. If it is missing, fail and name the
   path searched.
2. Resolve the account: `--account KEY`, else `active.json`. The guest slot, or an account folder with
   no `artifacts.json`, fails with a list of the account folders that do have one.
3. Read each document. The ones something here reads — gear, roster, last extraction — must carry a
   `schemaVersion` the adapter knows, and gear and roster must hold their arrays; an unknown version
   refuses the capture and names it, because Gestal has changed its format and the adapter must learn
   the new one first. The three stat documents are kept verbatim whatever their version, since nothing
   reads them yet and refusing over them would block the gear. A document Gestal has not written is
   left out, and the capture says which.
4. Run the adapter over the result before writing, so a snapshot the readers cannot decode is never
   written.
5. Write to a temporary file, then rename it into place.
6. Print the destination, the piece and champion counts, and the age of the last successful extraction.
   When that is more than 15 minutes old, or the last extraction failed, warn: Gestal is not reading the
   game right now — start Raid with Gestal attached and give it a minute. Then stop; as with
   `refresh.sh`, analysis is run separately.

## Snapshot discovery

Tools that default to "the newest snapshot" consider both `*-RSLHelper.db` and `*-Gestal.json.gz` in
`oracle/resources/` and pick the newest date prefix. On a same-date tie they take the Gestal file,
because its wearer data is current (see *Gaps*). Reports already name the file they read.

## Gaps

- **No current speed.** `Champs.SPD` is the champion's geared speed as RSL Helper computed it. Gestal
  stores base stats and a per-source bonus breakdown (sets, masteries, blessing, relics, empower,
  faction guardian) instead, so Gestal rows carry `SPD: null`. `speed.mjs` then needs `--constant`, and
  says so, rather than measuring it; its `verify` mode refuses; `restore.mjs` leaves out its speed line.
  Deriving speed from the breakdown is a follow-up, and would also make `speed.mjs`'s external
  base-speed corpus unnecessary.
- **Wearers differ from RSL Helper's, in Gestal's favour.** `equippedOnHeroId` is the current wearer,
  while RSL Helper's `Artifacts.cID` can keep naming a previous one (see the analytics README). The same
  account state can therefore show slightly different equipped counts from the two sources.
- **Names.** About one champion in fifty is spelled differently, so name selectors can behave
  differently between sources. ID selectors do not — the hero ids are the same.
- **`Br`** is left unmapped, so `spare-copies.mjs` shows no blessing marker on a Gestal snapshot.
- **No corrupt rows.** Gestal's documents need no sentinel filtering; `readArtifacts` reports
  `corrupt: []`.

## Privacy

Snapshots are personal account data. They live in `oracle/resources/`, which is already deny-all in its
`.gitignore`, and because `--out` can point anywhere, the root `.gitignore` also denies `*.json.gz` (and
the capture's `.tmp`) everywhere — the same belt-and-braces the battle-log archive uses. The capture leaves out `metadata.json` (Raid player id and display name), and the account
key appears nowhere in the file. Test fixtures are synthetic and hand-built. Prose, tests and commits
cite counts, never account keys or instance ids.

## Testing

Vitest in `oracle/analytics/__tests__/` — `gestal.test.mjs`, `snapshots.test.mjs`,
`cross-check.test.mjs` — on synthetic data only:

- **Adapter:** both id maps pinned entry by entry; hand-built pieces covering flat and % stats,
  SPD/ACC/RES, both crits, a damage-type substat, glyphs, `decodeValue`'s rounding, an ascended piece
  and a setless faction accessory, decoded to exact `Item`s; champion rows including the slot
  columns. An unknown stat or slot id throws, as do two pieces in one champion's slot.
- **Capture:** against a temporary data root — the account comes from `active.json` or `--account`;
  `metadata.json` stays out of the file, and its player id and name appear nowhere in it; the date
  comes from the last extraction, else the gear dump; a missing root, the guest slot, an unknown
  `schemaVersion` and an undecodable dump each fail with a message; stale and failed reads warn. The
  CLI is run end to end: `--out`, the summary line, the warning, and a failed run writing nothing.
- **Dispatch and discovery:** `readArtifacts` and `readAllChampRows` on a snapshot file; the optional
  `Champs` columns on SQLite; `.json.gz` recognised as a snapshot argument; newest-snapshot selection
  across both kinds, including the tie rule and baselines never being the default.
- **Cross-check:** its classifier — identity differences unexplained, progress explained, changed
  stats explained only by a recorded rework.
- The existing suite keeps passing; the SQLite path is untouched.
- **Cross-check (manual, on personal data):** `cross-check.mjs <rslh.db> <gestal.json.gz>` repeats the
  verification above. Run it whenever both sources exist.

## Rejected alternatives

- **Convert to an `RSLHelper.db`.** No tool changes, but every value is re-encoded into RSL Helper's
  fixed point, columns Gestal does not have (`SPD`) are faked, and the file claims a provenance it does
  not have.
- **A plain folder of Gestal's files.** The same reader change, about twenty times the size, and more
  awkward to sync.
- **Reading Gestal's live folder from the tools.** Not reproducible: the files change every few seconds
  while Gestal is attached, and analysis needs frozen, dated inputs.
- **Gestal's local engine API** (`/api/roster`, `/api/snapshot`). It needs the per-launch token, which is
  only readable from Gestal's log; the documents are already on disk.
- **Copying the whole account folder.** Sync state, preferences and auth are not account data we
  analyse. An explicit list keeps the file small and free of identifiers.

## Follow-ups

- Tune Gestal's gear-score weights against our quality model, measured on these snapshots.
- Derive current speed from Gestal's stat breakdown.
