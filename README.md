# RSLH Filter Tools

A tool for generating and viewing **.hsf** artifact filter files for **RSL Helper**, a companion app for *Raid: Shadow Legends*.

## Overview

RSLH Filter Tools creates and inspects **.hsf** artifact filter files for **RSL Helper**. It has three modes:

- **Quick Generator** — fast, tier-based filter building (recommended starting point)
- **Manual Generator** — full control over every rule parameter
- **Viewer** — load and inspect any existing .hsf file

Each mode opens in its own tab. Click the **+** button to add tabs, or use the **▾** arrow to pick a specific tab type. You can also drag-and-drop files anywhere on the page — the correct tab type opens automatically.

## Quick Generator

The Quick Generator lets you build a filter by sorting artifact sets into tiers.

- **Tiers** — four columns (S / A / B / C). Each tier has a roll threshold that controls the minimum substat quality for that tier.
- **Moving sets** — click a set chip to move it one tier to the right, right-click to move it left, or drag and drop between columns.
- **Roll thresholds** — the number in each tier header is the minimum "good roll" count (see below). Edit it directly or use the spinner arrows.
- **Sell toggle** — enable Sell on any tier to generate sell rules for artifacts that don't meet the threshold (instead of simply ignoring them).
- **Build profiles** — checkboxes below the tiers control which champion build profiles generate rules. Each profile defines which substats count as "good" for that build (see below).
- **Blocks** — use multiple blocks to apply different tier layouts to different content (e.g. one block for Clan Boss sets, another for Arena sets).
- **Generate** — click Generate to produce the .hsf. This opens both a Generator tab (showing the intermediate rules) and a Viewer tab (showing the final filter).

### Understanding "Good Rolls"

A **"good roll"** is either a starting substat you want for the build, or an upgrade (at levels 4, 8, 12, 16) that lands on a substat you want. A fully upgraded 6★ artifact has up to **4 starting substats**, **1 starting roll** if it's Mythical, plus **4 upgrades** at levels 4/8/12/16, for a maximum of **9 total rolls** spread across its substats.

The **roll threshold** in each tier is the minimum number of good rolls an artifact needs (across all its substats combined) to be kept. For example, a tier with threshold **7** means: "keep this artifact only if 7 out of its up to 9 possible rolls landed on stats I care about."

**Build profiles** define which substats count as "good." For instance:

- **ATK Nuker** — ATK%, SPD, C.RATE, and C.DMG are good
- **Support** — HP%, DEF%, SPD, RES, and ACC are good

The tool generates rules for every possible way the required rolls could be distributed across the good stats. For example, with the ATK Nuker profile and a threshold of **3**, it creates rules for distributions like:

- 3 rolls in ATK%, 0 in anything else
- 2 in ATK%, 1 in SPD
- 1 in ATK%, 1 in C.RATE, 1 in C.DMG
- …and every other combination that totals 3

An artifact is kept if *any one* of those distributions is satisfied. This means a piece with 2 rolls into C.RATE and 1 into SPD passes a threshold of 3 just as well as one with all 3 in ATK%.

Rules are also created at lower level checkpoints (12, 8, 4) with reduced thresholds, so artifacts that haven't been fully upgraded yet are evaluated fairly — a level-8 piece only needs to meet a lower bar because it hasn't had all its upgrade chances.

### Ore Reroll

The Ore Reroll section (inside the Quick Generator) creates rules for artifacts you plan to reroll at the Forge.

- **Columns** — assign sets to the 3-roll, 4-roll, or 5-roll column based on how many good substats you require before keeping a rerolled piece.
- Sets in the Ignore column produce no ore-reroll rules.
- Generated rules use Keep so matching pieces are flagged for rerolling rather than sold.

### Rare Accessories

Some accessory set + faction combinations are so hard to come by (e.g. Mercurial) that you want to keep every piece regardless of substats. The Rare Accessories grid lets you mark those combinations for unconditional keeping.

- Each row is an artifact set; each column is a faction.
- **Row header** — click a set name to toggle all factions for that set.
- **Column header** — click a faction name to toggle all sets for that faction.
- Checked cells generate unconditional Keep rules — any accessory from that set + faction is kept regardless of substats.

## Viewing Filters

The Viewer lets you load and inspect any .hsf file.

- **Loading** — drag-and-drop a .hsf file onto the drop zone, or click Browse.
- **Summary bar** — shows total rules, keep/sell breakdown, and active/inactive counts.
- **Rule cards** — each rule is displayed as a card with set, slot, main stat, rarity, substats, and action (Keep/Sell). Click the "Raw" badge to see the underlying JSON.
- **Test Item** — expand the Test Item panel to simulate an artifact against the loaded filter. Pick a set, slot, rarity, main stat, and substats, then click Test to see which rule matches (if any).

## Manual Generator

The Manual Generator gives full control over every rule field.

- **Groups** — each group becomes one or more .hsf rules. Add groups with the "+ Add Group" button.
- **Sets & slots** — use the searchable dropdown to pick artifact sets and the checkboxes for slots.
- **Main stats & substats** — check the stats you want. Use the preset buttons (ATK, DEF, HP, SPD, etc.) for quick selection.
- **Rank toggle** — switch between 5★ and 6★ rules.
- **Roll slider** — set the minimum substat roll threshold (0–8).

## File Formats

- **.hsf** — the RSL Helper filter file. This is what you import into the app.
- **.fqbl** — Quick Generator save file. Stores your tier assignments, profiles, and ore-reroll/rare-accessory settings so you can reload them later.
- **.fmbl** — Manual Generator save file. Stores your groups and rule settings.

Drag-and-drop any of these files onto the page — the tool automatically detects the format and opens the correct tab type.

## Sharing

Click the **Share** button in the Quick Generator toolbar to copy a shareable URL to your clipboard. Anyone who opens the link gets the exact same Quick Generator state — tier assignments, profiles, ore reroll, and rare accessories all included.

- The state is compressed and encoded in the URL's hash fragment (`#q=...`), so nothing is sent to a server.
- Opening a shared link automatically loads the Quick Generator with the shared configuration.
- The hash is cleared after loading so refreshing the page gives a clean slate.

## Tips

- **Start with Quick Gen** — it covers most use cases. Switch to Manual only if you need fine-grained control over individual rules.
- **Use blocks** for different content — e.g. one block for Clan Boss sets with strict thresholds, another for Arena sets with looser ones.
- **Verify in the Viewer** — after generating, check the Viewer tab to confirm the rules look right. Use the Test Item panel to spot-check edge cases.
- **Sell toggle** — only enable this if you want RSL Helper to actively mark non-matching artifacts for sale. Without it, unmatched pieces are simply ignored.
- **Save your work** — use Save .fqbl / Save .fmbl to keep your settings. You can reload them later without rebuilding from scratch.
- **Share your config** — use the Share button to get a link you can send to friends or post in your clan's Discord.
