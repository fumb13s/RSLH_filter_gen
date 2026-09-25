# Gestal Desktop (gestal.gg) — macOS overview

**Gestal Desktop** is a third-party RAID companion app (not ours): gear optimizer, team equip,
auto-battle with auto-sell, summon/upgrade automation, cloud account sync. Like RSL Helper it reads
the live game client — on macOS by injecting a helper into it.

Snapshot **2026-09-26**: Gestal Desktop **0.8.15** (osx-arm64, stable channel), Raid **11.75.0**,
fresh install, signed in to gestal.gg. The first pass was made with **Raid not running**; the
*Attached* section records a second look the same night, after Raid was launched and Gestal attached.

Method: file listings, reads of its JSON/log files, `strings`/`nm`/`otool`/`codesign` on the
bundle, and the sources embedded in its shipped source maps; once attached, also `lsof` on the Raid
process, the extracted documents and the engine log. No decompilation, no network capture.
*Inferred* = read from type/method names or string literals, not from observed behaviour.

## TL;DR
- **Data root:** `~/Library/Application Support/Gestal/` — downloaded catalogs + memory offsets,
  gestal.gg login state, sync state, logs; once attached, a full per-account dump.
- **Once attached** it holds the whole account — every gear item, every champion, relics,
  currencies, progress — re-read every ~10–20 s, plus game data read from memory and the battles
  you play. Its `artifacts.json` is a candidate gear source for us on macOS.
- **Raid keeps no gear on disk on macOS** — no counterpart to `*_RSLHelper.db`; gear exists only in
  the running client (and in Gestal's dump once it attaches).
- **Access (macOS):** `task_for_pid` + `mach_vm_read_overwrite` with server-supplied IL2CPP offsets,
  plus a Rust helper dylib injected into Raid by thread hijack and reached over a shared-memory
  mailbox. It also *drives* the game through that helper.
- **Sources:** Electron main/preload = full original TypeScript (source maps with
  `sourcesContent`); .NET engine = un-obfuscated IL; React UI = minified bundle; native dylibs =
  binary only.
- **For us:** its catalogs expose Gestal's own ids next to the game ids it reads (Gestal's internal
  faction ids happen to equal our `FACTION_NAMES`), and it has its own sell-rule engine. All of
  that is Gestal's model, not RSL Helper's.

## What it is
- Electron UI shell + self-contained **.NET 8** engine (`Gestal.Engine.Host`, ASP.NET Core) +
  native dylibs. The Electron UI is a port of an Avalonia (.NET) desktop app that still ships on
  Windows; both share the data root, `preferences.json` and `window-state.json`.
- Engine libraries: Google OR-Tools (optimizer), a GPU optimizer (`libgestal_optimizer_gpu.dylib`),
  Google.Protobuf, Serilog, Polly, Konscious Argon2/Blake2, Velopack (updates).
- UI: React 19, TanStack Query (persisted to localStorage), `@microsoft/signalr`, `qrcode` +
  `zxing-wasm`.
- 0.8.15 release notes: Auto Puller, Auto Upgrader, Grim Forest map, Deck of Fate calculator, Cloud
  Sync, Battle Data Collection (macOS parity with Windows), "Use Fusion Champions" option.

## Install layout — `/Applications/Gestal Desktop.app/Contents/`
| Path | What |
|--|--|
| `MacOS/Gestal Desktop` | Electron launcher |
| `MacOS/UpdateMac`, `MacOS/sq.version` | Velopack updater + package manifest (id `Gestal.Desktop`, rid `osx-arm64`, release notes) |
| `Resources/app/dist-electron/{main,preload}.cjs` (+ `.map`) | Electron main/preload; the maps embed the TS source |
| `Resources/app/dist/` | Renderer: `index.html`, one minified `assets/index-*.js` (~1.4 MB), CSS, fonts, static art, `assets/grimforest/placements.json` |
| `Resources/engine/` | Self-contained .NET 8 publish: `Gestal.Engine.{Host,Core,Extraction.Mac,Optimizer.Gpu}.dll`, `appsettings.json` (API / web / update-feed base URLs), OR-Tools, runtime |
| `Resources/engine/helpers/osx-arm64/libgestal_mac_helper.dylib` | Rust helper that gets injected into Raid (arm64 only) |

## Runtime architecture
1. Electron main spawns `engine/Gestal.Engine.Host` with its launch config in the environment:
   `GESTAL_HOST_TOKEN` (32 random bytes, hex, fresh per launch), `GESTAL_HOST_PARENT_PID`,
   `GESTAL_HOST_DEV_ORIGIN`, `GESTAL_Auth__Enabled=true`, `GESTAL_Sync__Enabled=true`,
   `GESTAL_Updates__FeedUrl=''`, and on macOS `DOTNET_DefaultStackSize=800000` (code comment: "some
   IL2CPP giant-struct RPC responses overflow the default .NET stack on macOS").
2. The engine listens on `http://127.0.0.1:<random port>` and prints
   `GESTAL_ENGINE_HOST_READY {"port":…}` on stdout.
3. The renderer (origin `app://gestal`, the one origin its CORS policy admits) talks REST + a
   SignalR hub at `/hub`, passing the token as `access_token`.
4. The engine exits when its parent pid goes away; a single-instance lock keeps a second app from
   starting a second engine ("two engine hosts against one helper pool" is the failure they guard).

Local engine endpoints (first-run log + literals): `/hub`, `/api/state`, `/api/tabs`,
`/api/roster`, `/api/snapshot`, `/api/teamequip[/preset]`,
`/api/gear/{operation,inbox,locks,preset-usage,scoring-catalog,scoring-params,sell-rules}`,
`/api/optimizer/{catalog,criteria,equip-state,results,team}`,
`/api/autobattle/{config,events,keep-catalog,run,stage,wallet}`, `/api/foodupgrade/{config,plan}`,
`/api/fusion[/progress]`, `/api/grim-forest[/plan,/wallet]`, `/api/deck-of-fate`,
`/api/proving-ground[/predict]`, `/api/relics[/food-config]`, `/api/shardfarm/{config,state}`,
`/api/masteries`, `/api/mercy`, `/api/image?url=` (image proxy), `/api/admin/{champion-artwork,stage-artwork}`.

Upstream: `https://api.gestal.gg` (API), `https://cdn.gestal.gg` (images, update feed),
`https://gestal.gg` (web).

## Where the data lives (macOS)
| Path | What |
|--|--|
| `~/Library/Application Support/Gestal/` | **Engine data root** (.NET `LocalApplicationData` + `/Gestal`; overridable via `GESTAL_DATA_ROOT`) |
| `~/Library/Application Support/gestal-desktop/` | Electron/Chromium profile |
| `~/Library/Logs/velopack_Gestal.Desktop.log` | Updater log |
| `~/Library/Preferences/com.gestal.desktop.plist` | Nothing app-specific |

### Data root contents (observed)
| Path | Contents |
|--|--|
| `Desktop/champions-catalog.json` | 1047 champions: Gestal `id`, game `gameId`, slug, name, factionId, rarityId, affinityId, role |
| `Desktop/gearsets.json` | 69 sets: id, name, category (1-/2-/4-set/Variable), min/max set size, per-tier effect text + stat bonuses |
| `Desktop/{gearslots,factions,rarities,affinities,blessings}.json` | Small catalogs; factions/rarities/affinities carry `gameId` |
| `Desktop/slot-eligibility.json` | Main / sub / ascension stats allowed per slot, in Gestal ids (see *Id spaces*) |
| `Desktop/mappings.json` (+ `.etag`) | Game id → Gestal id for champions (1047), gearSets (69), masteries (66), blessings (30), relics (88), rarities, gemstones (80), factions (16), stages (2882), skills (3722), affinities; `stats` = game stat id → name |
| `Desktop/offsets_cache.json` (+ `.etag`) | `gameVersion` 11.75.0, `appModelRvas` / `applicationRvas`, and 454 field offsets over 152 IL2CPP classes (`class_Field` → byte offset) |
| `auth-state.json` | gestal.gg profile: `guestChosen, email, displayName, avatarSlug, profileComplete, roles` — no token |
| `active.json` | `{"schemaVersion":1,"payload":{"activeAccountKey":"local"}}` |
| `accounts/local/` | Guest slot, empty. Attaching adds `accounts/<account-key>/` (see *Attached*) |
| `sync/.lock`, `sync/<16-hex>/state.json` | Cloud-sync state: `serverUserKey, historyId, cursor, accounts, pending, parked, …`; `accounts` is `{}` |
| `imagecache/<hash>.{webp,json}` | Images fetched through `/api/image` (so far the 16 faction banners) |
| `logs/gestal-YYYYMMDD.log` | Serilog engine log, including ASP.NET request lines. `logs/electron-shell.log` appears only on shell failures |

Attaching to a running Raid adds `accounts/<account-key>/`, `static/` and `battle-outbox/` — see
*Attached: what it perceives* below.

### Electron profile (`gestal-desktop/`)
Standard Chromium profile (Cookies, Local Storage, caches, GPU caches, …). The only app state is
the localStorage key `gestal.query-cache` (persisted TanStack Query cache, buster
`gear-ref-cache-v1`), empty so far.

### Raid's own data, for comparison
- App: `~/Public/PlariumPlay/StandAloneApps/raid-shadow-legends/build/Raid.app`
  (`com.plarium.raidlegends`, 11.75.0, universal x86_64 + arm64).
- Data: `~/Library/Application Support/com.plarium.raidlegends/`
  - `raidV2.db`: tables `Migrations`, `Dictionary` (one key, `UserId`), `Events` (empty).
  - `static-data/11.60.0/<hash>`: 5.7 MB blob; its header looks like MessagePack with LZ4 blocks
    (not decoded). Stale — the game has not run since updating to 11.75.
  - `battle-results/`, `dynamic-data/`, `LoadedTextures/`, `Unity/` (analytics),
    `ZendeskIntegrationStorage/`.
- ⚠️ **No gear or roster on disk.** On macOS gear exists only in the running client (and, once
  Gestal attaches, in Gestal's own documents).

## Attached: what it perceives
Observed 2026-09-26 after launching Raid (native arm64) with Gestal running. The engine adopted the
account at 00:56 (local time); a full extraction takes ~2 s
(`accounts/<account-key>/diagnostics/last-extraction.json`). `lsof` on the Raid process shows
`libgestal_mac_helper.dylib` mapped into it.

From then on it **polls**: gear and roster are re-read roughly every 20 s, currencies every ~10 s,
and each document is rewritten only when it changed (log: `Skipped artifacts (unchanged)`).

### Account documents — `accounts/<account-key>/`
`<account-key>` is a 16-hex id; the active account flips from `local` to it (`active.json`).

| File | Contents |
|--|--|
| `metadata.json` | Display name, Raid player id (the identity source), avatar/frame ids, game version, last snapshot time, sync state |
| `artifacts.json` (~10 MB) | Every gear item — see *Gear dump* under *Id spaces* |
| `champions.json` (~6 MB) | Every champion, 31 fields: ids (`heroId`, `typeId`, `baseTypeId`), grade, level, ascension / empower / awaken levels, blessing, affinity, faction, `storageLocation` (0 roster · 1 Reserve · 2 Master vault), guardian flag, base and max-ascended stats, masteries, skills, relics, role, alternate-form data |
| `relic-inventory.json` | Relics (type, rank, level, socketed stones, wearer) and loose stones |
| `currency.json` | Silver, gems, energy and cap, account level, tokens, arena currencies, auto-battle tickets, mythical dust, broken hero parts, alliance coin, Plarium points, soulstones |
| `arena.json` | Classic and tag-team arena: points, league, weekly wins/losses, timers |
| `grim-forest.json` | Grim Forest map per difficulty: nodes, links, stages, rewards, completion |
| `faction-guardian-state.json`, `great-hall-state.json`, `account-bonuses.json` | Guardian slots and deployed champions; Great Hall levels; affinity / arena / area bonuses |
| `shard-tracker.json` | Shard inventory, mercy counters, summon statistics |
| `gear-presets.json`, `account-snapshots.json` | Saved teams: champion → the 9 artifact ids it wears |
| `gear-scoring-params.json`, `food-config.json` | User settings: gear-scoring weights; Food Upgrader |
| `diagnostics/last-extraction.json` | Last extraction: time, success, elapsed ms, game version |

### Game data read from memory — `static/`
`skill-effect-catalog.json` (~5 MB: every skill with cooldown and effect formulas such as
`3.2*ATK`, plus effect tags) and blessing, relic, mastery, empower, faction-guardian and Great Hall
catalogs. Cached per game version and re-read from IL2CPP when the version changes. Values use the
game's `/ 2**32` fixed point, as in RslHelper.db.

### Battles
It watches play: the team being launched and, when a battle ends, the stage, difficulty, result and
cause, auto vs manual, and skill priorities. It also tracks which game screen is open (view keys).
Both battles played during the session were captured.

### Uploads, observed
- Account sync pushed four documents — `gear-presets`, `account-snapshots`, `gear-scoring-params`,
  `shard-tracker` — whose last-synced copies sit in `sync/<user-key>/base/<account-key>/`.
  `artifacts.json` and `champions.json` were not among them.
- `battle-outbox/<user-key>.json` queues battle telemetry: full builds of the launched team (every
  gear piece's stats, relic, masteries, blessing), the team, the battle record (`battleId, kind,
  stageId, difficultyId, outcome, finishCause, turns, durationMs, deadSlots, bossDamage, stars, …`)
  and a roster list of champion ids. When read, nothing in it was marked confirmed (`confirmed*`
  lists empty, `sharingGeneration: 0`).

### Reading, observed
- On 11.75.0 the external AppModel walk failed ("UserWrapper pointer was invalid"), so the account
  identity came through the injected helper; the log calls this "a degraded path".
- The helper's in-process gear capture stops at 8,192 items; with more gear the engine falls back to
  an external walk of the gear pool ("never wrong, only slower").

## How it reads and drives Raid on macOS
From `Gestal.Engine.Extraction.Mac.dll` names/imports and the helper's exports (mechanism
*inferred* from those names):
1. Finds Raid processes; takes the task port with `task_for_pid`.
2. Reads memory with `mach_vm_read_overwrite`, walking IL2CPP objects from the AppModel /
   Application RVAs with the offsets in `offsets_cache.json` (the "managed roster read").
3. Injects `libgestal_mac_helper.dylib` (Rust — its install name is a cargo `target/` path) via
   `MacThreadHijackInjector`: suspends a "victim" Raid thread, `mach_vm_allocate` / `write` /
   `protect` a landing pad, sets the thread state to call `dlopen`, resumes.
4. The helper exports `gestal_helper_init`, `gestal_helper_request`, `gestal_ensure_detour`,
   `gestal_bridge_tick_callback`, `gestal_sync_context_callback` and the data symbols
   `GESTAL_MAILBOX_ABI`, `GESTAL_DETOUR_MAILBOX`, `GESTAL_GAME_COMMAND`, `GESTAL_GAME_ROOTS`,
   `GESTAL_GAME_EPOCH`. It detours a game tick to run requests on the game's main thread; the
   engine writes requests into a shared-memory mailbox and polls for replies (the "helper RPC",
   also the fallback when a managed read fails).

Why that works without root:
- The engine is Developer-ID signed (team `B8V3BGQ88C`), hardened runtime, with entitlements
  `com.apple.security.cs.debugger`, `disable-library-validation`,
  `allow-unsigned-executable-memory`, `allow-jit`.
- Raid.app is **ad-hoc signed without hardened runtime**, so a debugger-entitled process can take
  its task port.
- The helper is **arm64 only**, so Raid has to run natively, not under Rosetta.

On Windows the same engine "opens and injects a RAID client" and can run elevated
(`LaunchAsAdministrator`, on by default).

Game actions through the helper (engine literals): equip/unequip and team presets; artifact
upgrade / reroll / ascend / rework; lock/unlock; champion rank-up and feeding (Food Upgrader);
summons (Auto Puller, shard farm); vault moves; auto-battle (incl. Super Raid) with **auto-sell of
drops** and inbox sell; FPS cap; closing offer popups; relaunching Plarium Play (`MacRaidLauncher`
SIGKILLs the Plarium Play stack). The literal "Selling gear from the app needs the Windows build"
suggests gear selling is Windows-only for now.

## Id spaces
Gestal has its own ids and carries the game id next to them.

**Factions** (`factions.json`, `mappings.factions`):
| Faction | Game id | Gestal id | our `FACTION_NAMES` |
|--|--|--|--|
| Banner Lords, High Elves, Sacred Order, Ogryn Tribes … Knights Revenant | 1–3, 5–12 | same | same |
| Barbarians | **13** | 4 | 4 |
| Sylvan Watchers | **14** | 15 | 15 |
| Shadowkin | **15** | 14 | 14 |
| Dwarves | **16** | 13 | 13 |
| Argonites | **17** | 16 | 16 |

Game id 4 is unused. Our `FACTION_NAMES` (`packages/core/src/mappings.ts`) equals Gestal's
*internal* ids, not its game ids. The game-id numbers also appear in Sellfile Creator's decoder for
RSL Helper's `accset` (`UwA`), but each app is free to use its own model, so neither tells us what
RSL Helper itself uses. **Open:** which space the `.hsf` `Faction` field uses — only RSL Helper
data can settle that.

**Stats** — three spaces:
| Stat | Game (`mappings.stats` = RslHelper.db `mid`/`sNid`) | Gestal (`slot-eligibility`, `gearsets`) | ours (`STAT_NAMES`) |
|--|--|--|--|
| HP / HP% | 1 (+ `IsAbsolute` flag) | 1 / 4 | 1 |
| ATK / ATK% | 2 | 3 / 6 | 2 |
| DEF / DEF% | 3 | 2 / 5 | 3 |
| SPD | 4 | 7 | 4 |
| RES | 5 | 11 | 7 |
| ACC | 6 | 10 | 8 |
| C.RATE | 7 | 8 | 5 |
| C.DMG | 8 | 9 | 6 |

The game space also has 11–18 (PvE / PvP / Boss / Dungeon DMG ±). Gestal set bonuses add 13 (SPD %),
14 (Ignore DEF) and 15 (HP-scaled damage). The Gestal column is derived from which stats each slot
allows plus the set-bonus texts; both files agree.

**Slots:** `gearslots.json` is 0-based with no `gameId`: 0 Weapon, 1 Helmet, 2 Shield, 3 Gauntlets,
4 Chestplate, 5 Boots, 6 Ring, 7 Amulet, 8 Banner. The game `type` / ours: 1 Helmet, 2 Chest,
3 Gloves, 4 Boots, 5 Weapon, 6 Shield, 7 Ring, 8 Amulet, 9 Banner.

**Sets:** `mappings.gearSets` maps game set id (the `.hsf` / DB `aset` space) → Gestal id, e.g.
7 → 13 Accuracy, 9 → 16 Lifesteal, 18 → 26 Relentless, 31 → 41 Divine Offense, 1002 → 75
Bloodshield, 1003 → 77 Reaction, 1004 → 76 Revenge.

**Gear dump** (`accounts/<account-key>/artifacts.json`, one object per item) mixes both spaces:

| Field | Meaning |
|--|--|
| `slot` | Gestal slot, 0-based (0 Weapon … 8 Banner) |
| `gearSetId` | **Game** set id — the `.hsf` / RslHelper.db `aset` space; `null` = no set. The accessory sets seen are exactly our `ACCESSORY_SET_IDS` |
| `factionId` | **Game** faction id on accessories (1–3 and 5–17 seen, never 4); `null` on the other slots |
| `rarityId` | 1 Common … 6 Mythical |
| `rank`, `level`, `ascensionLevel` | Stars, 0–16, 0–6 |
| `mainStatId`, `mainStatValue` | Gestal stat id; the value looks like display × 100 (a DEF% main of `6000` = 60%) |
| `substats[]` | `statId` (Gestal), `value` (× 100), `glyphBonusValue`, `rolls`, `isMythicalRoll` |
| `ascensionStat` | `{statId, value}` |
| `equippedOnHeroId` | Wearer's `heroId`; unset when unequipped |
| `id`, `sellPrice`, `isNew`, `isReworked`, `isAnomalous` | As named |

Substat ids 16–23 are the new damage-type substats (PvE / PvP / Boss / Dungeon DMG ±) that came with
a fresh game release. Which id is which kind is inferred from the order of Gestal's scoring-weight
keys; our `STAT_NAMES` (1–8) has no entries for them.

**Artifact memory layout** (offsets for 11.75.0): `artifact_` Id 16, SellPrice 40, Level 48,
AscendLevelHasValue 52, AscensionLevel 56, IsActivated 60, KindId 64 (slot kind), VariantId 68,
RankId 72, RarityId 76, PrimaryBonus 80, SecondaryBonuses 88, AscensionBonuses 96, SetKindId 104,
**RequiredFraction 108** (faction — game `Fraction` ids), IsSeen 112, RerollsCount 120/124,
ReadOnly 136. `artifactBonus_` KindId 16, Value 24, PowerUpValue 32, RarityBonus 40/48, Level 56,
PowerUpRarityId 60. `statBonus_` StatKindId 16, Value 24, IsAbsolute 32.

## Source availability
| Component | Form | Readable? |
|--|--|--|
| Electron main / preload | `.cjs` + `.map` with `sourcesContent` | **Full original TS**: `electron/main.ts`, `host-supervisor.ts`, `admin-gate.ts`, `share-capture.ts`, `window-state.ts`, `preload.ts` (~90 KB, heavily commented; they cite internal docs such as `docs/electron-ui-rework-plan.md`, `docs/account-sync-plan.md`) |
| React renderer | one minified Vite bundle, no map | Beautify-readable: identifiers mangled, strings and JSON field names intact (same situation as Sellfile Creator) |
| .NET engine | IL assemblies (AnyCPU), no PDBs | **Not obfuscated** — full type/member names; ILSpy / `ilspycmd` should give near-source C# (neither `dotnet` nor `ilspycmd` is installed here yet) |
| Native dylibs | Mach-O arm64 | Disassembly only |

Recipe for the TS: parse `Resources/app/dist-electron/*.cjs.map` as JSON and write each
`sourcesContent[i]` out under its `sources[i]` path. It is third-party code — keep extracted copies
out of the repo, like `../resources/`.

## What leaves the machine
- Catalog / offset downloads from `api.gestal.gg`: `/api/extractor/{mappings,offsets}`,
  `/api/{affinities,blessings,factions,gearsets,gearslots,masteries,rarities,stats}`,
  `/api/desktop/champions/catalog`, `/api/optimizer/slot-eligibility`, `/api/fusions/{active,history}`.
- gestal.gg auth: `/api/gestal/auth/extractor/{login,refresh,revoke}`, `/api/gestal/auth/me`,
  `/api/gestal/auth/complete-profile`.
- Account sync (on in the Electron app, signed-in users only): `/api/me/desktop/{sync,accounts,documents,documents/fetch}`,
  `/api/me/account-snapshot[/meta]`, `/api/gestal/teams`.
- Battle telemetry: `/api/me/battles/batch` (log line: "… battles, builds, setups, teams, variants,
  rosters"). `/api/me/data-sharing` exists — *inferred:* the consent switch.
- `/api/desktop/security/events`, `/api/desktop/telemetry/launch`.
- Update checks: `cdn.gestal.gg/desktop/releases/stable/osx-arm64/releases.stable.json?localVersion=…&id=Gestal.Desktop&stagingId=<uuid>`.

## Observations
- The only login flow in the engine is gestal.gg's (`PasswordLoginClient` →
  `/api/gestal/auth/extractor/login`); it does not ask for Plarium credentials. The 401 in the
  first-run log was a gestal.gg login.
- The supervisor keeps the per-launch token out of argv on purpose, but the engine log records it
  in every request URL (`/hub?…&access_token=…`, `/api/image?…&access_token=…`). Anything that can
  read the log can call the engine API while it runs.
- Gestal runs code inside the game client and issues game commands — a different footprint from a
  read-only memory reader.

## Relevance to RSLH_filter_gen
- **Faction ids:** Gestal keeps two faction numberings: internal ids (equal to our
  `FACTION_NAMES`) and the game ids it reads (Barbarians 13; Sylvan Watchers, Shadowkin, Dwarves,
  Argonites at 14–17). That describes Gestal's model only. RSL Helper is a different application
  and may number factions differently, so this does not settle the "Candidate model gap" in
  `../README.md`. Still open: what `.hsf` `Faction` stores.
- **Stats:** Gestal's `mappings.stats` uses the same numbering as the RSL Helper DB enum in
  `../README.md` (1 HP · 2 ATK · 3 DEF · 4 SPD · 5 RES · 6 ACC · 7 C.RATE · 8 C.DMG).
- **Sell rules:** Gestal has its own sell-rule engine (`GearSellRulesService`,
  `/api/gear/sell-rules`; rules keyed by set × faction × slot "cells", with level / rolls /
  substat / threshold payloads) — a peer implementation of what `.hsf` filters do, readable via
  decompilation or the renderer bundle.
- **Catalogs:** `mappings.json` + `gearsets.json` give a server-maintained game-id → name table
  for all 69 sets — a cross-check for `ARTIFACT_SET_NAMES`.
- **Gear source on macOS:** once Gestal is attached, `artifacts.json` is a complete, continuously
  refreshed gear dump — a candidate stand-in for `RslHelper.db` on a machine without RSL Helper.
  Sets and factions arrive in game ids; slots and stats need a Gestal → our mapping.
- **New substats:** the damage-type substats (ids 16–23 in the dump) came with a fresh game
  release; our `STAT_NAMES` doesn't cover them yet.

## Open / next
- Map `artifacts.json` into our `Item` model (Gestal slot/stat ids → ours) if we want it as an
  analytics or probe input.
- No `gear-sell-rules` document appeared on macOS (gear selling looks Windows-only), so the
  sell-rule model still needs the decompiled engine or the Windows build.
- What gates the battle-outbox upload (`sharingGeneration`, `/api/me/data-sharing`).
- Decompile the engine (`dotnet` + `ilspycmd`), starting with the sell rules and the extraction
  model in `Gestal.Engine.Core` / `Gestal.Engine.Host`.
- Beautify the renderer bundle for the sell-rules UI and the engine contract types.
- Decode Raid's `static-data/…` blob (MessagePack + LZ4?) if the game's static data turns out useful.

## Addendum — Gestal's sell rules, and translating `.hsf` (2026-09-26)
Source: `Gestal.Engine.Core.dll` and `Gestal.Engine.Host.dll` 0.8.15, decompiled with `ilspycmd` (on a
.NET 10 runtime in a scratch directory; the decompiled code is third-party and stays out of the repo).
This amends two earlier points:
- *Source availability*: the engine is **partly** obfuscated. Public type and member names are
  intact, but private members are renamed (`A`, `m_A`) and some string literals are hidden behind
  generated helper calls. The ILSpy output is still readable.
- *Open / next*: the sell-rule model below comes from the decompiled engine; it no longer needs the
  Windows build.

### Gestal's sell rules
**Where they apply.** Only in auto-battle, and only to gear dropped during the current run (item id
above the highest id seen at run start); the existing vault is never swept. Auto-sell is armed by
the master toggle in the gear-keep config document and is off in Minotaur (region 210) and
ascension-material dungeons. The rules are re-read before every battle. Equipped items and items in
Gestal's locked-gear list are never sold. Matches are sold through the injected helper, at most 32
per command; when storage is full, an inbox prize is sold only if every piece in it matches.
Gear-scoring weights play no part.

**A rule** (`StoredGearSellRule`, in the account's `gear-sell-rules` document; C# property names —
the on-disk JSON casing is unverified):
- `Id`, `Name`, `Enabled`, `Keep` (new rules default to sell)
- a cell: one `Slot` (Gestal 0–8) plus exactly one of `GearSetId` / `FactionId`; a faction cell is
  only allowed on Ring / Amulet / Banner (slots 6–8)
- optional criteria: `RarityIds[]`, `Ranks[]`, `MainStatIds[]`, `Level {Op, Value}`, `Reworked`,
  `Substats[]` lines
- a substat line: `Stats[]`, each `{StatId, Threshold {Op, Value}?, Rolls {Op, Value}?}`, plus
  `Count` N and `MustHave`
- `Op` is ≤, = or ≥ only

**Matching** (`GearSellFilter`). Rules are checked in order; the first enabled rule that has at
least one criterion and matches decides — `Keep` keeps, otherwise sell; no match keeps.
1. The slot must match.
2. An item with a set must match the rule's set, and faction is ignored. An item without a set must
   match the rule's faction — so faction cells only catch setless accessories.
3. Rarity, rank and main stat must be in the rule's lists (empty = any); then level and reworked.
4. Each substat line counts the item's substats that are in the line and pass its value and roll
   thresholds (a mythical roll counts as one extra roll). Must-have needs ≥ N, must-not-have
   needs < N, and every line must pass.
5. A rule with no criteria (cell only) is skipped.

Thresholds are compared raw against the stored value, which is display × 100; the engine does no
conversion. Set and faction ids are game ids; slot and stat ids are Gestal's.

**Unused leftovers.** `GearKeepFilter` — a whitelist of keep rules by set / faction / rarity / rank
plus per-slot main-stat and substat requirements — is still stored and shown in the auto-battle
config, but its matcher is never called; only the document's `Enabled` flag is used, as the master
toggle. `GearSellPolicy` (a rarity / rank cap) is always passed as `Permissive`.

### Translating `.hsf` → Gestal
Gestal has no `.hsf` support (no references in the engine or the UI), so an import means generating
its sell-rules document ourselves. The core semantics already agree — ordered rules, first enabled
match wins, `Keep` keeps, no match keeps — so a one-way translation covers most of `.hsf`, with
fan-out and a few gaps.

| `.hsf` (per `packages/core/src/evaluate.ts`) | Gestal rule | Notes |
|--|--|--|
| Rule order, `Keep`, `Use` | Same order, `Keep`, `Enabled` | Identical behaviour |
| `ArtifactType` × `ArtifactSet` | One rule per (slot, set) cell | Slots remapped (below); set ids are game ids on both sides |
| `Rank` (minimum) | `Ranks` = [N … 6] | Exact |
| `Rarity` (minimum code) | `RarityIds` | 8 Rare → [3–6], 9 Epic → [4–6], 16 Legendary → [5, 6], 15 Mythical → [6] |
| `MainStatID` | `MainStatIds` | Gestal splits flat / %; our evaluator ignores `MainStatF`, so the mapping needs a decision |
| `Substats` (≤ 4, all required, value ≥ V) | One substat line per stat: that stat, value ≥ V × 100, count 1, must-have | Exact |
| `LVLForCheck` (level ≥ N) | `Level` ≥ N | Maps, but see gap 4 |
| `Faction` | Faction cell | Setless accessories only (gap 1) |

- Slots, ours → Gestal: Helmet 1 → 1, Chest 2 → 4, Gloves 3 → 3, Boots 4 → 5, Weapon 5 → 0,
  Shield 6 → 2, Ring 7 → 6, Amulet 8 → 7, Banner 9 → 8.
- Substat stats, ours (`ID` + `IsFlat`) → Gestal: HP 1 → 1 flat / 4 %, ATK 2 → 3 flat / 6 %,
  DEF 3 → 2 flat / 5 %, SPD 4 → 7, C.RATE 5 → 8, C.DMG 6 → 9, RES 7 → 11, ACC 8 → 10.

Gaps:
1. **Faction + set on accessories can't be expressed.** Gestal ignores faction on any item with a
   set, so "set X Rings of faction Y" becomes "set X Rings of every faction". Sell rules like that
   would have to be dropped (they would over-sell); keep rules only over-keep, which is safe.
2. **Criteria-less rules are skipped.** An `.hsf` rule that only names sets / slots ("sell all set
   X") does nothing in Gestal unless the translation adds an always-true criterion such as level ≥ 0.
3. **Rule-count explosion.** An "any set, any slot" `.hsf` rule becomes several hundred Gestal
   rules. The sample in `data/` has 20 such rules; Sellfile Creator exports already hold 12k–31k
   rules. Matching copes; Gestal's rule-list UI likely would not.
4. **Level rules never fire.** Gestal judges only fresh drops (level 0) and has no re-check as gear
   is upgraded.
5. **Faction id space still open.** Gestal cells use game faction ids; which space `.hsf` `Faction`
   uses is unresolved.
6. **No import path.** Either write the account's sell-rules document directly (it also syncs to
   gestal.gg) or call the engine's bulk replace (`ReplaceGearSellRules`, which drops invalid cells).
7. **Mac auto-sell unconfirmed.** In-app gear selling is Windows-only; whether auto-battle auto-sell
   runs in the Mac build is unverified.

Verdict: for filters our generator produces (specific sets and slots) the translation is faithful
apart from gaps 1 and 4. Large any-set `.hsf` files translate on paper but yield an unwieldy number
of Gestal rules.
