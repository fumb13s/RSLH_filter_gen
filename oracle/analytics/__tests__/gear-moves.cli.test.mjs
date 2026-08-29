// oracle/analytics/__tests__/gear-moves.cli.test.mjs
//
// The half of gear-moves.mjs that gear-moves.test.mjs stops short of: the DB reads, the section
// order, the warnings, and the exact text that reaches a terminal. It runs the real CLI over a pair
// of throwaway snapshots and reads its stdout and stderr.
//
// The snapshots are synthetic and built here. Real ones hold personal account data and are
// gitignored, but nothing about a MOVE needs real data — the fixture is nine artifacts and four
// champions, sized to put one of every case in the report at once.
//
// SC-006/SC-008 quote figures from reference snapshot pairs that are not in the repository and never
// will be, so this file is the acceptance gate for everything below the diff.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, test, expect } from "vitest";
import { ASC, SUB } from "../../lib/decode.mjs";

const SCRIPT = fileURLToPath(new URL("../gear-moves.mjs", import.meta.url));

// node:sqlite needs the flag on Node 22, which is what CI runs. It stopped being required once the
// module went stable, and passing a flag a Node build does not know is itself a hard failure, so it
// goes in only when this Node wants it.
const FLAGS = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-sqlite"] : [];

const ART_COLS = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset",
  "ASCLEVEL", "cID", ASC.id, ASC.fl, ASC.base,
  ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv, s.myth])];
const CHAMP_COLS = ["ID", "Role", "Rarity", "Rang", "Lvl", "Fraction", "SPD", "EmpLvl",
  "Weapon", "Helmet", "Shield", "Glouves", "Chest", "Shoes", "Ring", "Amulett", "Banner"];

const POW32 = 2 ** 32;
const HP = 1, ATK = 2, DEF = 3, SPD = 4;      // DB stat ids, remapped by the decoder
const WEAPON = 5, HELMET = 1, CHEST = 2;      // slot ids; NOT the Champs column order

// An Artifacts row the way the game writes one: a stat value is stored as value * 2**32, and rarity
// is 1-indexed there while the decoder hands back a 0-indexed one (6 -> Mythical).
//
// cID is deliberately set to a champion that does not hold the piece. It is the stale pointer the
// tool must never read: if a future change keyed locations off it instead of the Champs slot
// columns, every item in this fixture would report as sitting on champion 3.
function artifact({ id, slot, main, sub, set = 5, rank = 6, rarity = 6, level = 16 }) {
  const row = {
    ID: id, type: slot, rank, rarity, lvl: level, aset: set, accset: 0, cID: 3,
    mid: main[0], mfl: 1, mlvlid: main[1] * POW32,
    [SUB[0].id]: sub[0], [SUB[0].fl]: 1, [SUB[0].base]: sub[1] * POW32,
  };
  return row;
}

function makeSnapshot(path, { items, champs }) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE Artifacts (${ART_COLS.map((c) => `${c} INTEGER`).join(",")})`);
  db.exec(`CREATE TABLE Champs (Name TEXT, ${CHAMP_COLS.map((c) => `${c} INTEGER`).join(",")})`);
  const ins = db.prepare(`INSERT INTO Artifacts (${ART_COLS.join(",")})`
    + ` VALUES (${ART_COLS.map(() => "?").join(",")})`);
  for (const r of items) ins.run(...ART_COLS.map((c) => r[c] ?? 0));
  const cins = db.prepare(`INSERT INTO Champs (Name, ${CHAMP_COLS.join(",")})`
    + ` VALUES (${["?", ...CHAMP_COLS].map(() => "?").join(",")})`);
  for (const c of champs) cins.run(c.Name, ...CHAMP_COLS.map((k) => c[k] ?? 0));
  db.close();
}

// The nine pieces. 11/71 are visually identical and so are 15/16 — the two ambiguity cases, chosen
// so that an after-scoped count and a before-scoped one give DIFFERENT answers:
//   71 exists only in the after snapshot, so 11's line is ambiguous only when counted over after
//   15 is sold, so its twin 16 makes it ambiguous only when counted over before
const ITEM = {
  11: { slot: WEAPON, main: [ATK, 265], sub: [SPD, 12] },   // Elhain -> Kael, leveled on the way
  15: { slot: CHEST, main: [DEF, 100], sub: [HP, 200] },    // Elhain's chest, SOLD
  16: { slot: CHEST, main: [DEF, 100], sub: [HP, 200] },    // 15's twin, unequipped, survives
  21: { slot: WEAPON, main: [ATK, 200], sub: [SPD, 5] },    // Kael -> the vault
  22: { slot: CHEST, main: [DEF, 150], sub: [HP, 300] },    // Kael -> the vault
  31: { slot: HELMET, main: [HP, 1000], sub: [ATK, 50] },   // Varkos (consumed) -> Kael
  52: { slot: CHEST, main: [DEF, 175], sub: [HP, 350] },    // vault -> Kael, whose chest survives
  53: { slot: HELMET, main: [HP, 1100], sub: [ATK, 60] },   // vault -> Turvold, whose slot was empty
  54: { slot: CHEST, main: [DEF, 190], sub: [HP, 390] },    // vault -> Elhain, whose chest was sold
  71: { slot: WEAPON, main: [ATK, 265], sub: [SPD, 12] },   // 11's twin, acquired mid-session
};
const at = (id, over = {}) => artifact({ id: Number(id), ...ITEM[id], ...over });

const BEFORE = {
  items: [at(11, { level: 12 }), at(15), at(16), at(21), at(22), at(31), at(52), at(53), at(54)],
  champs: [
    { ID: 1, Name: "Elhain", Weapon: 11, Chest: 15 },
    { ID: 2, Name: "Kael", Weapon: 21, Chest: 22 },
    { ID: 3, Name: "Varkos Headsplitter", Helmet: 31 },
    { ID: 4, Name: "Turvold" },
  ],
};

// 15 is gone (sold). 71 is new. Varkos was consumed and is off the roster entirely, but the helmet
// he was wearing is now on Kael and still needs a home named.
const AFTER = {
  items: [at(11), at(16), at(21), at(22), at(31), at(52), at(53), at(54), at(71)],
  champs: [
    { ID: 1, Name: "Elhain", Chest: 54 },
    { ID: 2, Name: "Kael", Weapon: 11, Helmet: 31, Chest: 52 },
    { ID: 4, Name: "Turvold", Helmet: 53 },
  ],
};

let dir, beforeDb, afterDb, report;

const run = (...args) => {
  const r = spawnSync(process.execPath, [...FLAGS, SCRIPT, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gear-moves-cli-"));
  beforeDb = join(dir, "before.db");
  afterDb = join(dir, "after.db");
  makeSnapshot(beforeDb, BEFORE);
  makeSnapshot(afterDb, AFTER);
  // The order warning reads mtimes, and both files were just written, so pin them apart: the tool
  // must be quiet about a correctly ordered pair.
  const t = Date.now() / 1000;
  utimesSync(beforeDb, t - 3600, t - 3600);
  utimesSync(afterDb, t, t);
  report = run(beforeDb, afterDb);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The line a piece occupies in the report, so an assertion can name what it is looking at rather
// than an offset. Substring match on the description, which is what the reader matches by eye too.
const lineWith = (text) => report.out.split("\n").find((l) => l.includes(text));

// One section's text. Slicing on a champion name instead would land in whichever section mentions it
// first: the moved list indents its locations six spaces, so a naive search for "  Kael" finds a
// destination there long before the group header further down.
const HEADS = ["MOVED ITEMS", "RESTORE BY CHAMPION", "STRIP LIST BY HOLDER", "GONE - CANNOT"];
const sectionOf = (head) => {
  const next = HEADS[HEADS.indexOf(head) + 1];
  return report.out.slice(report.out.indexOf(head),
    next ? report.out.indexOf(next) : report.out.length);
};

test("a correctly ordered pair of readable snapshots produces a report and says nothing on stderr",
  () => {
    expect(report.code).toBe(0);
    expect(report.err.replace(/^.*ExperimentalWarning.*$|^\(Use `node.*$/gm, "").trim()).toBe("");
  });

// FR-016. The order is fixed and part of the contract: the flat audit list, then the two grouped
// views, then the one section the tool cannot help with. Empty sections are still announced, so an
// empty result reads as a result rather than as a truncated run.
test("the four sections appear in the contracted order, each with its count", () => {
  const headers = report.out.split("\n").filter((l) => /^[A-Z]/.test(l));
  expect(headers).toEqual([
    "MOVED ITEMS (7)",
    "RESTORE BY CHAMPION (3 affected)",
    "STRIP LIST BY HOLDER (3 champions, 5 pieces)",
    "GONE - CANNOT RESTORE (1)",
  ]);
});

// Every move, and only moves. A piece acquired mid-session (71) did not move and is not lost, so it
// has no line of its own; a piece that was sold (15) belongs in the gone section, not here.
test("moved items lists every changed location and nothing else", () => {
  const moved = sectionOf("MOVED ITEMS").split("\n").filter((l) => l.includes(" · #"));
  expect(moved.map((l) => l.match(/· #(\d+)/)[1])).toEqual(
    ["31", "53", "22", "52", "54", "11", "21"]);   // by slot, then id
  expect(report.out).not.toContain("#71");
});

// FR-004: the vault is named explicitly. A blank destination would read as "this piece did not
// move", which is the opposite of what the line is there to say.
test("a piece taken off a champion and left in the vault says so", () => {
  expect(lineWith("Elhain -> Kael")).toBeTruthy();
  expect(lineWith("Kael -> (unequipped)")).toBeTruthy();
});

// FR-011: the champion was consumed during the session and is off the roster, but its helmet is on
// someone else and still needs an origin named. A bare id would identify nothing in the game.
test("a champion that no longer exists is still named, and marked", () => {
  expect(lineWith("Varkos Headsplitter (champion no longer exists) -> Kael")).toBeTruthy();
});

// FR-008: the values printed on the piece read higher than the baseline showed, so without the tag
// the reader concludes they are holding the wrong item.
test("a piece that moved and leveled carries the tag", () => {
  expect(lineWith("Elhain -> Kael")).toContain("[leveled +12->+16 during session]");
  expect(lineWith("Kael -> (unequipped)")).not.toContain("[leveled");
});

// FR-006, and the scoping that makes it work. 11's twin exists only in the AFTER snapshot, so the
// marker on its line proves moved items are counted there; 15's twin survives while 15 itself was
// sold, so the marker on the gone line proves gone items are counted over BEFORE. Count either one
// against the wrong snapshot and its marker disappears.
//
// Each assertion is pinned to its section on purpose. A twin's description turns up in more than one
// place — the sold chest is also named on the `keep` line that displaced it — so an unscoped search
// finds whichever section prints it first and stops testing the one it was written for.
test("indistinguishable pieces are marked, each against the snapshot its row came from", () => {
  expect(sectionOf("MOVED ITEMS")).toMatch(/ATK 265 \| SPD 12.*\(2 identical — either will do\)/);
  expect(sectionOf("GONE - CANNOT")).toMatch(/DEF 100 \| HP 200.*\(2 identical — either will do\)/);
  // The sold piece named on a `keep` line has no after row either, for exactly the same reason.
  expect(sectionOf("STRIP LIST BY HOLDER")).toMatch(/replaced .*DEF 100 \| HP 200.*\(2 identical/);
  // And silence where a description really is unique, since silence is what carries that meaning.
  expect(sectionOf("MOVED ITEMS")).not.toMatch(/ATK 200 \| SPD 5.*identical/);
});

// FR-009: only champions that LOST something, and only the slots that changed. Biggest job first so
// the reader starts where the work is, then by name so two runs agree.
test("restore by champion lists only losing champions, biggest job first", () => {
  const section = sectionOf("RESTORE BY CHAMPION");
  expect(section.match(/^ {2}\S.*$/gm)).toEqual([
    "  Kael", "  Elhain", "  Varkos Headsplitter (champion no longer exists)"]);
  // Turvold only gained a piece, so it is nobody's restore; listing it would send the owner to a
  // champion with nothing missing from it.
  expect(section).not.toContain("Turvold");
});

// Kael lost a weapon and a chest and GAINED a helmet. Only the two losses are its business here —
// the helmet it is wearing belongs to the strip list, and naming it in both views would read as two
// separate jobs.
test("restore by champion lists only the slots a champion actually lost", () => {
  const restore = sectionOf("RESTORE BY CHAMPION");
  const kael = restore.slice(restore.indexOf("\n  Kael"), restore.indexOf("\n  Elhain"));
  expect(kael.match(/^ {4}(\S+) +want/gm).map((l) => l.trim().split(/\s+/)[0]))
    .toEqual(["Chest", "Weapon"]);
  expect(kael).not.toContain("Helmet");
});

// FR-017: all four dispositions, each saying what to DO. `auto` is a stated no-op rather than an
// omission — silence there reads as "this piece was missed".
test("the strip list gives every piece a disposition and an instruction", () => {
  expect(lineWith("Weapon  return")).toContain("to Elhain");
  expect(lineWith("Helmet  return")).toContain("to Varkos Headsplitter (champion no longer exists)");
  expect(lineWith("Chest   auto")).toContain("no action");
  expect(lineWith("Helmet  unequip")).toContain("take off deliberately");
  expect(lineWith("Chest   keep")).toContain("leave it on");
});

// The `keep` case in full. The piece it displaced was sold, so there is nothing to put back and
// stripping this one would only leave the slot bare — the report names the sold piece so the reader
// can see why they are being told to leave gear where the driver put it.
test("a `keep` piece names the sold piece it replaced", () => {
  expect(sectionOf("STRIP LIST BY HOLDER")).toMatch(/replaced .*DEF 100 \| HP 200.*— SOLD/);
});

// The per-holder header states the size of the job before the lines are read, split the two ways
// that matter: pieces with an owner to hand them back to, and pieces out of the vault.
test("the strip list header counts hand-backs and vault pieces separately", () => {
  expect(lineWith("Kael  —")).toBe("  Kael  — 3 moved pieces (2 to hand back, 1 from the vault)");
  expect(lineWith("Turvold  —")).toBe("  Turvold  — 1 moved piece (0 to hand back, 1 from the vault)");
});

// FR-010: the one class the tool cannot help with, rendered from the before row because there is no
// after row, and told plainly so no time is spent hunting for it.
test("a sold piece is reported as gone, from its before row, with where it was last seen", () => {
  const gone = sectionOf("GONE - CANNOT");
  expect(gone).toContain("These were sold or consumed. Nothing here can be put back.");
  expect(gone).toContain("DEF 100 | HP 200");
  expect(gone).toContain("last seen on Elhain");
});

// --- warnings (FR-013) ------------------------------------------------------

// An inverted report is internally CONSISTENT — every line is simply backwards — so it cannot be
// caught by reading it. Silence is the one clearly wrong answer.
test("swapping the arguments warns that the report reads backwards", () => {
  const r = run(afterDb, beforeDb);
  expect(r.code).toBe(0);
  expect(r.err).toContain("is NEWER than");
  expect(r.err).toContain("swapped");
});

test("naming the same snapshot twice warns that the empty report is not what was meant", () => {
  const r = run(beforeDb, beforeDb);
  expect(r.code).toBe(0);
  expect(r.err).toContain("both arguments name the same snapshot");
  expect(r.out).toContain("MOVED ITEMS (0)");
});

// --- refusing to run (FR-014, FR-015) ---------------------------------------

// "Nothing moved" and "I could not read your snapshot" must not look alike, and the failure has to
// name which of the two files it could not read.
test("an unreadable snapshot fails naming the file, and prints no report", () => {
  const missing = join(dir, "not-here.db");
  const r = run(missing, afterDb);
  expect(r.code).toBe(1);
  expect(r.err).toContain(`cannot read the before snapshot ${missing}`);
  expect(r.out).not.toContain("MOVED ITEMS");
  // FR-015: and it must not have brought the file into existence on the way past. A stray empty
  // database here would be read as a real snapshot holding no gear on the next run.
  expect(existsSync(missing)).toBe(false);
});

test("the after snapshot is named as the after one when it is the unreadable one", () => {
  const r = run(beforeDb, join(dir, "not-here-either.db"));
  expect(r.code).toBe(1);
  expect(r.err).toContain("cannot read the after snapshot");
});

// Two positionals and nothing else. restore.mjs next door takes `-o out.md`, so the habit is there
// to carry over, and both ways of carrying it used to fail quietly.
test("anything that is not exactly two option-free paths is a usage error", () => {
  for (const args of [[], [beforeDb], [beforeDb, afterDb, "extra.db"]]) {
    const r = run(...args);
    expect(r.code, `args: ${args.length}`).toBe(1);
    expect(r.err).toContain("<before.db> <after.db>");
  }
  for (const args of [[beforeDb, afterDb, "-o", "out.md"], ["-o", "out.md", beforeDb, afterDb]]) {
    const r = run(...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain("unrecognised option -o");
  }
  expect(existsSync(join(dir, "out.md"))).toBe(false);
  expect(existsSync("out.md")).toBe(false);
});
