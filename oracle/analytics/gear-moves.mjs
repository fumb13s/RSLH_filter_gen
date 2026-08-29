// Gear movement diff: hand two snapshots to this and it says which pieces moved, where they were,
// and where they are now, so the account can be put back by hand in the game.
//
// The use case is a "driver" session — the account goes to someone else to build teams, they
// rearrange worn gear across dozens of champions, and afterwards it all has to go back. Bracket the
// session with two snapshots and this turns the delta into a worklist.
//
//   node --experimental-sqlite oracle/analytics/gear-moves.mjs <before.db> <after.db>
//     before.db   the snapshot taken BEFORE the session
//     after.db    the snapshot taken AFTER it
//
// Two positional arguments and no options; the report goes to stdout. Anything else is rejected
// rather than ignored, because restore.mjs next door takes `-o out.md` and the habit carries.
//
// Both are required and neither is ever inferred. The suite's usual "newest snapshot" default is
// deliberately absent: kept baselines are named outside the /-RSLHelper\.db$/ pattern that default
// globs for — that is what stops a routine refresh overwriting them — so a default would reliably
// pick the wrong file and produce a plausible, wrong report.
//
// Advisory only. Both reads open readOnly and nothing is written anywhere.
//
// This overlaps restore.mjs, which answers a narrower version of the same question and writes
// markdown. Which of the two survives is a maintainer decision that has not been taken; until it is,
// everything they must not disagree about lives in gear-common.mjs.

import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_SET_NAMES, ARTIFACT_SLOT_NAMES, FACTION_NAMES, ITEM_RARITIES, lookupName,
  statDisplayName } from "@rslh/core";
import { readChampRows } from "./champs.mjs";
import { readArtifacts } from "./decode.mjs";
import { SLOT_COLUMNS, fingerprint } from "./gear-common.mjs";

// Who is wearing what, read from the Champs slot columns and NEVER from Artifacts.cID. That pointer
// is not cleared on unequip, so it keeps naming the last wearer indefinitely — 36 such stale
// pointers on the reference snapshot, every one on a piece that is actually sitting in the vault.
// A diff keyed on it would invent 36 moves before anyone touched the account.
//
// An item absent from the returned map is unequipped. There is no third state.
export function locationsFrom(champRows) {
  const loc = new Map();
  for (const row of champRows) {
    const champId = Number(row.ID);
    for (const col of SLOT_COLUMNS) {
      const itemId = Number(row[col] ?? 0);
      if (itemId > 0) loc.set(itemId, champId);
    }
  }
  return loc;
}

// Champion id -> the name to print, plus whether the champion is gone from the after snapshot.
// Champions can be consumed mid-session (161 ids in the reference window), and their gear still
// needs a home named, so a champion is never reduced to a bare id (FR-011).
//
// `missing` is about CHAMPIONS. It has nothing to do with the `gone` item list, and the two are
// named apart deliberately.
export function champNames(beforeRows, afterRows) {
  const names = new Map();
  for (const row of beforeRows) names.set(Number(row.ID), { name: row.Name, missing: true });
  for (const row of afterRows) names.set(Number(row.ID), { name: row.Name, missing: false });
  return names;
}

// What changed between two snapshots, and only what changed.
//
//   moved  one entry per item whose LOCATION differs. `item` is the AFTER row, because the owner is
//          matching printed values against what is in the game right now.
//   gone   items present before and absent after — sold or consumed. These carry the BEFORE row,
//          since no after row exists. That exception propagates: collision counts for them have to
//          be taken over the before snapshot too.
//
// Iterating the before items is what excludes newly-acquired gear: a piece that exists only in the
// after snapshot did not move and is not lost, so it has no line of its own. It shows up as the
// "now holding" side of whatever it displaced.
//
// A move is a change of location and nothing else. Levelling a piece in place is not a move.
export function diffLocations(beforeItems, beforeLoc, afterItems, afterLoc) {
  const afterById = new Map(afterItems.map((it) => [it.id, it]));
  const moved = [], gone = [];
  for (const before of beforeItems) {
    const after = afterById.get(before.id);
    if (!after) { gone.push(before); continue; }
    const from = beforeLoc.get(before.id) ?? null;
    const to = afterLoc.get(before.id) ?? null;
    if (from === to) continue;
    moved.push({ id: before.id, from, to, item: after,
      leveledFrom: before.level === after.level ? null : before.level });
  }
  return { moved, gone };
}

// How many items share each visible appearance. Scoped to whichever snapshot the rendered row came
// from: moved items are drawn from the after snapshot, gone items from the before one. Counting gone
// items against the after snapshot returns undefined for every one of them — all 47 in the reference
// window — and a naive template then prints "undefined identical".
export function collisionCounts(items) {
  const counts = new Map();
  for (const it of items) {
    const fp = fingerprint(it);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  return counts;
}

// What each champion was wearing before, keyed by slot. Exists as its own function because the
// per-holder disposition below needs "what did this champion hold in THIS slot before", a question
// the flat Map<itemId, champId> cannot answer.
//
// The slot key comes from `item.slot` and never from which champion column referenced the item —
// column order is not slot-id order, and six of the nine disagree.
export function slotsBefore(beforeItems, beforeLoc) {
  const slots = new Map();
  for (const it of beforeItems) {
    const champId = beforeLoc.get(it.id);
    if (champId === undefined) continue;
    if (!slots.has(champId)) slots.set(champId, new Map());
    slots.get(champId).set(it.slot, it);
  }
  return slots;
}

// "Restore by champion": the moves keyed by the champion that LOST the piece, so the owner opens a
// champion once and sees every slot that changed on it. A move out of the vault has no owner missing
// it and is not in here at all — it is the strip list's business (FR-009).
//
// Its own function rather than a few lines inside the printer, because the strip list below is a
// SEPARATE traversal of the same `moved` array and the two have to agree (FR-018). An agreement test
// can only catch drift if it calls both sides; re-deriving this grouping in the test would pin a
// copy, and the printer could then be changed without a single test noticing.
export function byOwner(moved) {
  const owners = new Map();
  for (const m of moved) {
    if (m.from === null) continue;
    if (!owners.has(m.from)) owners.set(m.from, []);
    owners.get(m.from).push(m);
  }
  return owners;
}

// The inverse index of "restore by champion": the same moves keyed by the champion WEARING the gear
// rather than the one missing it. It answers the question asked while standing on a champion the
// swapper built up — where does this piece go back to — so that champion empties in one pass instead
// of one round trip per piece.
//
// Only moves that ended on a champion appear. A piece now sitting in the vault has no holder to open.
//
// A piece that came off another champion is always `return`: the origin is also the destination.
// Only vault-sourced pieces need a decision, and "vault pieces go back to the vault" is wrong twice:
//
//   auto      the slot's original occupant still exists — restoring that slot displaces this piece
//             by itself, so telling the owner to unequip it invents a step
//   unequip   the slot was empty before — nothing will ever displace this piece, so omitting it
//             leaves the account short of its pre-session state with no sign why
//   keep      the slot's original occupant was SOLD — there is nothing to put back, so unequipping
//             only leaves an empty slot; `replaced` names the sold piece so the reader can see why
//
// `keep` is the branch a naive implementation gets wrong in the harmful direction: it would tell the
// owner to strip a working piece off a slot they cannot refill. Neither reference snapshot pair
// contains a `keep` or an `unequip` — all 16 vault-sourced pieces there are `auto` — so running the
// tool can never show these two. Their unit tests are not a supplement to manual verification; they
// are the whole of it.
export function byHolder(moved, goneIds, slotsByChamp) {
  const holders = new Map();
  for (const m of moved) {
    if (m.to === null) continue;
    const entry = { item: m.item, from: m.from, disposition: "return", replaced: null };
    if (m.from === null) {
      const original = slotsByChamp.get(m.to)?.get(m.item.slot) ?? null;
      if (!original) entry.disposition = "unequip";
      else if (goneIds.has(original.id)) { entry.disposition = "keep"; entry.replaced = original; }
      else entry.disposition = "auto";
    }
    if (!holders.has(m.to)) holders.set(m.to, []);
    holders.get(m.to).push(entry);
  }
  return holders;
}

// --- describing a piece the way the game shows it ---------------------------

const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// statDisplayName, NOT STAT_NAMES: the latter is an in-tree placeholder and percent-only, so a flat
// HP substat renders through it as "HP%" — wrong on exactly the field a human matches by eye.
const stat = (s) => `${statDisplayName(s.statId, s.isFlat)} ${num(s.value)}`;

const setName = (id) => (id === 0 ? "(setless)" : lookupName(ARTIFACT_SET_NAMES, id));

// One line naming a piece by what is printed on it in the game — rarity, rank, level, set, slot,
// faction on accessories, main stat, every substat with its glyph, and the ascension bonus. The id
// trails as a reference only: the restore happens in a UI that never shows it, so it can identify
// nothing on its own (FR-005).
//
// ITEM_RARITIES[rarity], NOT describeRarity: that one maps .hsf threshold ids and would render an
// item rarity as ">= Epic" or "Unknown(3)".
//
// Faction labels carry a known id-space discrepancy tracked as deferred in DESIGN.md §9. It affects
// human-readable labels only, never the raw ids fingerprinting compares, and is printed here the way
// every other tool in the suite prints it rather than corrected in passing.
export function describeItem(it) {
  const subs = it.substats
    .map((s) => `${stat(s)}${s.glyph ? ` (+${num(s.glyph)}g)` : ""}`).join(", ");
  const faction = it.isAccessory && it.faction
    ? ` [${lookupName(FACTION_NAMES, it.faction)}]` : "";
  const asc = it.ascStat ? ` · asc ${stat(it.ascStat)}` : "";
  return `${ITEM_RARITIES[it.rarity]} r${it.rank} +${it.level} ${setName(it.set)} `
    + `${lookupName(ARTIFACT_SLOT_NAMES, it.slot)}${faction}`
    + `  ${stat(it.mainStat)} | ${subs}${asc} · #${it.id}`;
}

// --- what each line SAYS ----------------------------------------------------
// Still pure and still unit-tested. These decide the wording; the printers below only decide where
// it goes. Nothing here touches a database or console.

// Ambiguity is stated, never implied. Silence has to mean "this description is unique", so a shared
// appearance says so and tells the reader either piece will serve (FR-006).
//
// `counts` is the caller's choice of scope and the whole correctness of the marker rests on it:
// after-scoped for a moved item, before-scoped for a gone one. The `?? 1` is for an item genuinely
// absent from the map, not a licence to pass the wrong one — a gone item counted against the after
// snapshot misses the map every time and reads as unique on every line.
export function ambiguity(it, counts) {
  const n = counts.get(fingerprint(it)) ?? 1;
  return n > 1 ? `   (${n} identical — either will do)` : "";
}

// A location is always a name or an explicit "(unequipped)" — never blank, never a bare id (FR-004).
// A champion consumed during the session keeps the name the before snapshot recorded and is marked
// gone, because its gear still needs a home named (FR-011).
export function label(champId, names) {
  if (champId === null) return "(unequipped)";
  const entry = names.get(champId);
  if (!entry) return `unknown champion #${champId}`;
  return entry.missing ? `${entry.name} (champion no longer exists)` : entry.name;
}

// Levelling changes the values printed on a piece, so one that moved AND leveled cannot be matched
// against what the baseline showed. Say so rather than let the reader conclude they have the wrong
// item (FR-008).
export const leveledTag = (m) =>
  (m.leveledFrom === null ? "" : `   [leveled +${m.leveledFrom}->+${m.item.level} during session]`);

const bySlotThenId = (a, b) => a.item.slot - b.item.slot || a.item.id - b.item.id;

// Biggest job first, then by name so the report is stable run to run.
export function sortedGroups(groups, names) {
  return [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || label(a[0], names).localeCompare(label(b[0], names)));
}

// What the owner actually has to do about each piece on a champion that was built up. `auto` is the
// common case and gets a stated no-op line rather than being left out: silence there reads as "this
// piece was missed" (FR-017).
//
// Every line states where the piece CAME FROM before it says what to do with it (FR-016): `return`
// names the champion, and the three vault dispositions all open on the vault. That was inferable
// before — from the group header's "N from the vault" and from the disposition word itself — and
// FR-016 exists precisely to stop the reader inferring. An entry has to be workable on its own,
// read out of order, with no other line in view.
//
// `keep` is a named case and the default THROWS, which is the whole point of writing it this way.
// With `keep` on the default arm, any disposition byHolder did not produce — a typo, a fourth one
// added without a line here — rendered "leave it on": the one piece of advice that costs the owner a
// slot they cannot refill. A disposition this code does not recognise has to fail where it is seen.
export function action(entry, names) {
  switch (entry.disposition) {
    case "return": return `to ${label(entry.from, names)}`;
    case "auto": return "came from the vault — back there on its own when this slot is restored,"
      + " no action";
    case "unequip": return "came from the vault — take off deliberately, this slot was empty"
      + " before, so nothing will displace it";
    case "keep": return "came from the vault — leave it on, the piece it replaced was sold, so"
      + " taking this off would only empty the slot";
    default: throw new Error(`unknown disposition ${JSON.stringify(entry.disposition)}`);
  }
}

// --- CLI: I/O and layout ----------------------------------------------------
// Below this line is not unit-tested: DB reads, section order, and console.log. It is covered
// end-to-end instead — __tests__/gear-moves.cli.test.mjs builds a pair of throwaway snapshots, runs
// the tool over them and asserts on what actually reaches stdout and stderr.

// 0. Provenance, before any of it is read. Both item lists reaching the diff are POST-filter —
// readArtifacts drops rows whose 64-bit garbage cannot be decoded — so a row that decodes in one
// snapshot and not in the other is silently reclassified, and in the direction that matters most:
// readable-then-corrupt lands in GONE - CANNOT RESTORE, the one section the reader is told to trust
// and stop looking. Corrupt-then-readable is quieter but also wrong — the piece drops out of the
// diff and resurfaces only as the "now holding" side of whatever it displaced.
//
// Equal counts do not prove no row flipped; unequal ones prove some did. That is the difference
// between a reader who knows to discount the gone list and one with nothing to notice it by. Both
// sides are printed the way compare.mjs prints them, since that is the other two-snapshot tool.
function printProvenance(before, after) {
  const side = (s) => `${s.total} rows, ${s.corrupt.length} unreadable`;
  console.log(`snapshots: before ${side(before)} · after ${side(after)}`);
  if (before.corrupt.length !== after.corrupt.length) {
    console.log("  the snapshots disagree about how many rows decode, so a piece can be listed as"
      + " gone only because its row stopped decoding — treat GONE as approximate");
  }
  console.log("");
}

// 1. Moved items — the flat audit list. Every piece that changed hands, described as it looks NOW,
// with where it was and where it is. A restore can be driven from this section alone.
function printMoved(moved, names, afterCounts) {
  console.log(`MOVED ITEMS (${moved.length})`);
  for (const m of [...moved].sort(bySlotThenId)) {
    console.log(`  ${describeItem(m.item)}${ambiguity(m.item, afterCounts)}`);
    console.log(`      ${label(m.from, names)} -> ${label(m.to, names)}${leveledTag(m)}`);
  }
  console.log("");
}

// 2. Restore by champion — the same moves grouped the way the work is done. Keyed by the champion
// that LOST the piece, listing only the slots that changed, so the owner opens a champion once and
// sees exactly what is missing from it and where each piece went.
//
// Ordering the steps is not needed: equipping a piece in the game displaces the current occupant
// automatically, so within a champion the slots can be done in any order.
function printRestoreByChampion(moved, names, afterCounts) {
  const owners = byOwner(moved);
  console.log(`RESTORE BY CHAMPION (${owners.size} affected)`);
  for (const [champId, rows] of sortedGroups(owners, names)) {
    console.log(`  ${label(champId, names)}`);
    for (const m of rows.sort(bySlotThenId)) {
      const slot = lookupName(ARTIFACT_SLOT_NAMES, m.item.slot).padEnd(7);
      console.log(`    ${slot} want  ${describeItem(m.item)}${ambiguity(m.item, afterCounts)}`);
      console.log(`    ${" ".repeat(7)} now   ${m.to === null ? "unequipped"
        : `on ${label(m.to, names)}`}${leveledTag(m)}`);
    }
  }
  console.log("");
}

// 3. Strip list by holder — the inverse index of section 2, and the reason it exists: the gear is
// not spread thinly. Six champions held 50 of 108 moved pieces in the reference session, so working
// only from the per-owner view costs a round trip per piece. Keyed this way a rebuilt champion
// empties in one pass (FR-016).
//
// Placed third, after the per-owner view and before the unrecoverable list.
function printStripList(holders, names, afterCounts, beforeCounts) {
  const pieces = [...holders.values()].reduce((n, v) => n + v.length, 0);
  console.log(`STRIP LIST BY HOLDER (${holders.size} champions, ${pieces} pieces)`);
  for (const [champId, entries] of sortedGroups(holders, names)) {
    const handBack = entries.filter((e) => e.from !== null).length;
    console.log(`  ${label(champId, names)}  — ${entries.length} moved`
      + ` piece${entries.length === 1 ? "" : "s"} (${handBack} to hand back,`
      + ` ${entries.length - handBack} from the vault)`);
    for (const e of entries.sort(bySlotThenId)) {
      const slot = lookupName(ARTIFACT_SLOT_NAMES, e.item.slot).padEnd(7);
      console.log(`    ${slot} ${e.disposition.padEnd(8)}  ${action(e, names)}`);
      console.log(`    ${" ".repeat(7)} ${describeItem(e.item)}${ambiguity(e.item, afterCounts)}`);
      // The sold piece is counted against the BEFORE snapshot for the same reason the gone section
      // is: it has no after row for an after-scoped count to find.
      if (e.replaced) {
        console.log(`    ${" ".repeat(7)} replaced ${describeItem(e.replaced)}`
          + `${ambiguity(e.replaced, beforeCounts)}  — SOLD`);
      }
    }
  }
  console.log("");
}

// 4. Gone — the one class the tool cannot help with. Read it first: these pieces were sold or
// consumed and no amount of re-equipping brings them back, so any time spent hunting for them is
// wasted (FR-010).
//
// Rendered from the BEFORE row, because there is no after row, and counted against the BEFORE
// snapshot for the same reason — every gone item's appearance is by definition absent from the
// after snapshot, so an after-scoped count would come back undefined for every line.
function printGone(gone, beforeLoc, names, beforeCounts) {
  console.log(`GONE - CANNOT RESTORE (${gone.length})`);
  if (gone.length) console.log("  These were sold or consumed. Nothing here can be put back.");
  for (const it of [...gone].sort((a, b) => a.slot - b.slot || a.id - b.id)) {
    const was = beforeLoc.get(it.id) ?? null;
    console.log(`  ${describeItem(it)}${ambiguity(it, beforeCounts)}`);
    console.log(`      ${was === null ? "was unequipped" : `last seen on ${label(was, names)}`}`);
  }
  console.log("");
}

function loadSnapshot(path) {
  const { items, corrupt, total } = readArtifacts(path);
  const champRows = readChampRows(path);
  return { items, corrupt, total, champRows, loc: locationsFrom(champRows) };
}

// A snapshot that cannot be read is reported as a failure naming the file, never as an empty report
// (FR-014). "Nothing moved" and "I could not read your snapshot" must not look alike.
function readOrDie(path, which) {
  try {
    return loadSnapshot(path);
  } catch (e) {
    console.error(`cannot read the ${which} snapshot ${path}: ${e.message}`);
    process.exit(1);
  }
}

// mtime rather than anything inside the file: the snapshots carry no capture stamp of their own, and
// the question here is only which file is older.
function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// An inverted report is internally CONSISTENT — every line is simply backwards — so it cannot be
// caught by reading it. Silence is the one clearly wrong answer here (FR-013).
function warnAboutOrder(beforePath, afterPath) {
  let same = beforePath === afterPath;
  try {
    same = realpathSync(beforePath) === realpathSync(afterPath);
  } catch { /* unreadable paths are the caller's problem, and it reports them properly */ }
  if (same) {
    console.error(`warning: both arguments name the same snapshot (${beforePath}).`
      + " The empty report below is correct but probably not what you meant.");
    return;
  }
  const b = mtimeOf(beforePath), a = mtimeOf(afterPath);
  if (b !== null && a !== null && b > a) {
    console.error(`warning: ${beforePath} is NEWER than ${afterPath}, so the arguments look`
      + " swapped. The report below reads backwards — every move is inverted — and nothing in it"
      + " will look wrong.");
  }
}

const USAGE = "usage: node --experimental-sqlite oracle/analytics/gear-moves.mjs"
  + " <before.db> <after.db>\n"
  + "Two positional snapshots and nothing else. The report goes to stdout; there is no -o, unlike"
  + " restore.mjs next door — redirect if you want a file.\n"
  + "Neither path is inferred: a kept baseline is deliberately named outside the pattern the other"
  + " tools glob for, so a default would reliably pick the wrong file.";

function usageError(problem) {
  console.error(`${problem}\n${USAGE}`);
  process.exit(1);
}

// Anything that is not exactly two positionals is rejected rather than trimmed to fit. Reading only
// the first two arguments made both ways of carrying restore.mjs's `-o out.md` habit fail quietly:
// trailing, the flag was read past and vanished with no comment; leading, it was opened as the
// before snapshot and the run died complaining about a file called "-o".
function main() {
  const args = process.argv.slice(2).filter((a) => a !== "");
  const flag = args.find((a) => a.startsWith("-"));
  if (flag) usageError(`unrecognised option ${flag}: this tool takes no options`);
  if (args.length !== 2) usageError(`need exactly two snapshots, got ${args.length}`);

  const [beforePath, afterPath] = args;
  warnAboutOrder(beforePath, afterPath);

  const before = readOrDie(beforePath, "before");
  const after = readOrDie(afterPath, "after");

  const { moved, gone } = diffLocations(before.items, before.loc, after.items, after.loc);
  const names = champNames(before.champRows, after.champRows);
  // Two scopes, deliberately. Moved items are rendered from the after snapshot and gone items from
  // the before one, so each is counted against the snapshot its row came from.
  const afterCounts = collisionCounts(after.items);
  const beforeCounts = collisionCounts(before.items);

  const holders = byHolder(moved, new Set(gone.map((it) => it.id)),
    slotsBefore(before.items, before.loc));

  printProvenance(before, after);
  printMoved(moved, names, afterCounts);
  printRestoreByChampion(moved, names, afterCounts);
  printStripList(holders, names, afterCounts, beforeCounts);
  printGone(gone, before.loc, names, beforeCounts);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
