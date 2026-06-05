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
  id), set, faction, rank, rarity, level, main + substats with display values + `ourStatId`.

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
`lvlid` (encoded value), `gv` (glyph). The precomputed `sum*` columns exist but are essentially
empty in practice — don't rely on them.

### Value encoding
`display = lvlid / 2**32`, then `× 100` when percent (`fl == 0`). (Matches the bundle's own
`/4294967296` decode.) Examples: SPD `25769803776 → 6`; HP% `515396074 → 0.12 → 12%`; ATK% main
`2576980377 → 0.60 → 60%`.

### Stat ids — the DB enum is its OWN, distinct from ours
DB `mid`/`sNid`: **`1 HP · 2 ATK · 3 DEF · 4 SPD · 5 RES · 6 ACC · 7 C.RATE · 8 C.DMG`**.
This is NOT the `sum*` column order and NOT our `STAT_NAMES` (which is `5 C.RATE · 6 C.DMG · 7 RES ·
8 ACC`). Map DB → our id: `{1:1, 2:2, 3:3, 4:4, 5:7, 6:8, 7:5, 8:6}`. Resolved via equipped-champion
stat lift (`Champs.ACC/RES/CritRate/CritDamage`), since `sum*` is empty.

### Slot `type` → slot  (identity — DB `type` == our `ARTIFACT_SLOT_NAMES` id)
Verified via the `Champs` equipped-slot columns (`Weapon/Helmet/Shield/Glouves/Chest/Shoes/Ring/
Amulett/Banner`) — ground truth.

| DB `type` | slot |
|--|--|
| 1 | Helmet |
| 2 | Chest |
| 3 | Gloves |
| 4 | Boots |
| 5 | Weapon |
| 6 | Shield |
| 7 | Ring |
| 8 | Amulet |
| 9 | Banner |

> ⚠️ Do **not** infer slots from main-stat signatures (they mislead, because the DB stat-id enum
> differs from ours) and do **not** trust the websocket doc's `kindId` (a different convention).
> Both produced wrong mappings before the `Champs`-equip check settled it.

### Sets & faction
- Gear **set** is in `aset` — same id space as our `ARTIFACT_SET_NAMES` (incl. 1000–1004
  accessory-only sets; `0` = no set). True for armor and accessories.
- Accessory **faction** is in `accset` (1–17). Proven: `accset == equipped champ.Fraction` for all
  1,286 equipped accessories; armor has `accset = 0`.

### Rarity / rank
DB `rarity` 1–6 (1 = Common … 6 = Mythical); our model rarity index = `dbRarity − 1`.
DB `rank` 1–6 = our rank.

## Candidate model gap (verify later)
- `FACTION_NAMES` maps 1–16; `accset = 17` appears in real data → a newer faction we don't map.

(Note: an earlier suspected "Amulet C.RATE main" gap was a *false alarm* caused by a mis-derived
stat-id enum + slot mapping. Amulets correctly roll C.DMG and never C.RATE — confirmed once the
ground-truth mappings were fixed.)
