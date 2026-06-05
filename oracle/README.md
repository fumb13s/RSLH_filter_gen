# Gear oracle probe

Fixtures + tooling for differential-testing our `evaluateFilter()` against **Sellfile Creator**
(a third-party tool — `…/RSL_Helper_V4/SellFileCreator/SellfileCreator.html` — that reads the same
RSL Helper gear DB and produces keep/sell verdicts).

**Idea:** a fast, headless *proxy* oracle. Feed a known gear DB + a known `.hsf` to Sellfile
Creator, read its per-item keep/sell, and compare to our `evaluateFilter()` on the same items.
Disagreements become candidates to adjudicate against ground truth (RSL Helper's built-in **Sell
Test**; see claude_notes `rslh-ui-automation.md`). Sellfile Creator evaluates its own *recipe*
model, so it's a second fan reimplementation — a proxy, not ground truth.

## Files
- `build-known-db.py` — regenerates the DB + manifest by copying curated real rows out of a real
  `RslHelper.db`. The source-DB path is hardcoded near the top; edit it for your machine.
- `known-gear.db` — SQLite gear DB, 24 known artifacts (all 9 slots; 18 armor + 6 accessories with
  set + faction). Committed so the fixture is usable without a source DB present.
- `known-gear.manifest.json` — every item fully decoded (the "known contents"): slot (+ our slot
  id), set, faction, rank, rarity, level, main + substats with display values.

## Status
- [x] DB synthesis (this directory)
- [ ] **Headless load probe — DEFERRED until laptop setup.** Needs Playwright + headless Chromium
  (~100 MB) to load the 12.7 MB `SellfileCreator.html` (it uses `sql.js`/WASM, so jsdom won't
  work): load `known-gear.db` + a known `.hsf`, read the Gear Inspector's per-item verdicts, diff
  against `evaluateFilter()`.

---

## RSL Helper DB notes (reverse-engineered 2026-06-05)

Source: `…/RslHelper/Config/RSLHelper.db` (live) / `…/RSL_Helper_V4/RSLHelper.db`
(~75 MB). Gear lives in the **`Artifacts`** table — armor *and* accessories. The
`accessories`/`accessory_ids`/`presets` tables are an unused, empty loadout feature; `AccRecords`
is arena history.

### Per-stat columns
Main = `mid,mlvl,mfl,mlvlid,mgv`; substats `s1..s4` each = `sNid,sNlvl,sNfl,sNlvlid,sNgv`:
`id` (stat), `lvl` (roll count), `fl` (isAbsolute: 1 = flat number, 0 = percent/multiplier),
`lvlid` (encoded value), `gv` (glyph). Precomputed `sum*` columns exist but aren't used for matching.

### Value encoding
`display = lvlid / 2**32`, then `× 100` when percent (`fl == 0`). (Matches the bundle's own
`/4294967296` decode.) Examples: SPD `25769803776 → 6`; HP% `515396074 → 0.12 → 12%`; ATK% main
`2576980377 → 0.60 → 60%`.

### Stat ids
`1 HP · 2 ATK · 3 DEF · 4 SPD · 5 C.RATE · 6 C.DMG · 7 RES · 8 ACC` (matches `sum*` column order
and our `STAT_NAMES`).

### Slot `type` → slot
Derived from each type's **main-stat signature** — the websocket doc's `kindId` is a *different,
non-matching* convention and must NOT be trusted for the DB.

| DB `type` | slot | our `ARTIFACT_SLOT_NAMES` id |
|--|--|--|
| 1 | Helmet | 1 |
| 2 | Gloves | 3 |
| 3 | Chest  | 2 |
| 4 | Boots  | 4 |
| 5 | Weapon | 5 |
| 6 | Shield | 6 |
| 7 | Ring   | 7 |
| 8 | Banner | 9 |
| 9 | Amulet | 8 |

(Gloves/Chest and Banner/Amulet are swapped between DB order and our ids.)

### Sets & faction
- Gear **set** is in `aset` — same id space as our `ARTIFACT_SET_NAMES` (incl. 1000–1004
  accessory-only sets; `0` = no set). True for armor and accessories.
- Accessory **faction** is in `accset` (1–17). Proven: `accset == equipped champ.Fraction` for all
  1,286 equipped accessories; armor has `accset = 0`.

### Rarity / rank
DB `rarity` 1–6 (1 = Common … 6 = Mythical); our model rarity index = `dbRarity − 1`.
DB `rank` 1–6 = our rank.

## Candidate model gaps this surfaced (verify later — exactly what the oracle is for)
- `SLOT_STATS[8]` (Amulet) lists C.DMG as a primary, but real Amulets also roll **C.RATE main**
  (199× in the sample) — likely missing from our model.
- `FACTION_NAMES` maps 1–16; `accset = 17` appears in real data → a newer faction we don't map.
