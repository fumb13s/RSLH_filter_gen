// oracle/analytics/__tests__/gestal.test.mjs
//
// The Gestal adapter, the snapshot file, and the capture. Every fixture here is synthetic and
// hand-built: a real Gestal folder holds personal account data and never belongs in the repo. The
// mappings themselves were verified against real data (docs/plans/2026-09-28-gestal-snapshot-design.md);
// these tests pin them so an edit cannot change one silently.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import { FORMAT, FORMAT_VERSION, GESTAL_SLOT, GESTAL_STAT, checkSnapshot, gestalChampRows, gestalItem,
  gestalItems, isGestalPath, unlistedWearers } from "../gestal.mjs";
import { STALE_MINUTES, captureSnapshot, dataAsOf, dataRoot, destination, formatAge, freshnessWarnings,
  localDate, parseRefreshArgs, resolveAccount, scrub, writeSnapshot } from "../refresh-gestal.mjs";
import { readArtifacts } from "../decode.mjs";
import { isRealChamp, parseArgs, readAllChampRows } from "../champs.mjs";
import { ASC, SUB } from "../../lib/decode.mjs";

const SCRIPT = fileURLToPath(new URL("../refresh-gestal.mjs", import.meta.url));
const SPEED = fileURLToPath(new URL("../speed.mjs", import.meta.url));
// node:sqlite needs the flag on Node 22 and refuses it on builds that no longer know it.
const FLAGS = Number(process.versions.node.split(".")[0]) < 23 ? ["--experimental-sqlite"] : [];

// --- fixtures -----------------------------------------------------------------

// A Gestal artifact record: Legendary 6★ +16 Speed-set Boots with a SPD main, unequipped.
function piece(o = {}) {
  return {
    id: 1, slot: 5, gearSetId: 4, factionId: null, rarityId: 5, rank: 6, level: 16, ascensionLevel: 0,
    mainStatId: 7, mainStatValue: 4500,
    substats: [
      { statId: 8, value: 1200, glyphBonusValue: null, rolls: 2, isMythicalRoll: false },
      { statId: 4, value: 500, glyphBonusValue: null, rolls: 0, isMythicalRoll: false },
    ],
    ascensionStat: null, equippedOnHeroId: null, sellPrice: 0, isNew: false, isReworked: false,
    isAnomalous: false, ...o,
  };
}

function champion(o = {}) {
  return { heroId: 100, typeId: 1496, baseTypeId: 1490, grade: 6, level: 60, empowerLevel: 0,
    blessingId: null, factionId: 2, rarityId: 3, roleId: 0, name: "Elhain", ...o };
}

const doc = (schemaVersion, payload) => ({ schemaVersion, payload });

function snapshotOf({ artifacts = [piece()], champions = [champion()], lastExtraction } = {}) {
  const documents = {
    artifacts: doc(2, { extractedAt: "2026-09-28T12:00:00Z", gameVersion: "11.75.0", artifacts }),
    champions: doc(2, { extractedAt: "2026-09-28T12:00:30Z", gameVersion: "11.75.0", champions }),
  };
  if (lastExtraction) documents["last-extraction"] = doc(1, lastExtraction);
  return { format: FORMAT, formatVersion: FORMAT_VERSION, capturedAt: "2026-09-28T12:05:00Z",
    gestalVersion: "0.8.15", documents };
}

// A Gestal data folder laid out as the app writes it, with one account.
function gestalRoot({ artifacts = [piece()], champions = [champion()], key = "abc123", active = key,
  artifactsVersion = 2, lastExtraction = { attemptedAt: "2026-09-28T12:04:00Z", succeeded: true,
    errorMessage: null, elapsedMilliseconds: 1000, gameVersion: "11.75.0" } } = {}) {
  const root = mkdtempSync(join(tmpdir(), "gestal-root-"));
  const acct = join(root, "accounts", key);
  mkdirSync(join(acct, "diagnostics"), { recursive: true });
  mkdirSync(join(root, "accounts", "local"), { recursive: true });
  const put = (rel, body) => writeFileSync(join(acct, rel), JSON.stringify(body));
  writeFileSync(join(root, "active.json"), JSON.stringify(doc(1, { activeAccountKey: active })));
  put("artifacts.json", doc(artifactsVersion, { extractedAt: "2026-09-28T12:00:00Z", gameVersion: "11.75.0", artifacts }));
  put("champions.json", doc(2, { extractedAt: "2026-09-28T12:00:30Z", gameVersion: "11.75.0", champions }));
  put("great-hall-state.json", doc(1, { extractedAt: "2026-09-25T10:00:00Z", affinities: [] }));
  put("metadata.json", doc(2, { displayName: "Player One", raidPlayerId: "123456789" }));
  if (lastExtraction) put("diagnostics/last-extraction.json", doc(1, lastExtraction));
  return { root, acct, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const cleanups = [];
afterEach(() => { while (cleanups.length) cleanups.pop()(); });
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "gestal-out-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// --- the id maps ----------------------------------------------------------------

test("Gestal slots map onto ours: 0 Weapon, 1 Helmet, 2 Shield, 3 Gauntlets, 4 Chest, 5 Boots, 6-8 accessories", () => {
  expect(GESTAL_SLOT).toEqual({ 0: 5, 1: 1, 2: 6, 3: 3, 4: 2, 5: 4, 6: 7, 7: 8, 8: 9 });
});

test("Gestal stats map onto our id + flat flag, SPD/ACC/RES reading flat as in RSLHelper.db", () => {
  expect(GESTAL_STAT[1]).toEqual([1, true]);    // HP
  expect(GESTAL_STAT[2]).toEqual([3, true]);    // DEF — Gestal orders DEF before ATK
  expect(GESTAL_STAT[3]).toEqual([2, true]);    // ATK
  expect(GESTAL_STAT[4]).toEqual([1, false]);   // HP%
  expect(GESTAL_STAT[5]).toEqual([3, false]);   // DEF%
  expect(GESTAL_STAT[6]).toEqual([2, false]);   // ATK%
  expect(GESTAL_STAT[7]).toEqual([4, true]);    // SPD
  expect(GESTAL_STAT[8]).toEqual([5, false]);   // C.RATE
  expect(GESTAL_STAT[9]).toEqual([6, false]);   // C.DMG
  expect(GESTAL_STAT[10]).toEqual([8, true]);   // ACC
  expect(GESTAL_STAT[11]).toEqual([7, true]);   // RES
});

test("the damage-type substats keep the game's own ids 11-18, in Gestal's order", () => {
  expect([16, 17, 18, 19, 20, 21, 22, 23].map((g) => GESTAL_STAT[g])).toEqual(
    [11, 12, 13, 14, 15, 16, 17, 18].map((id) => [id, false]));
});

// --- gestalItem -----------------------------------------------------------------

describe("gestalItem", () => {
  test("decodes a piece into the Item shape decode.mjs produces", () => {
    expect(gestalItem(piece())).toEqual({
      id: 1, slot: 4, set: 4, rank: 6, rarity: 4, level: 16, faction: 0, isAccessory: false,
      mainStat: { statId: 4, isFlat: true, value: 45 },
      substats: [
        { statId: 5, isFlat: false, rolls: 2, value: 12, glyph: 0 },
        { statId: 1, isFlat: false, rolls: 0, value: 5, glyph: 0 },
      ],
      ascStat: null, ascLevel: -1, equippedChampId: 0,
    });
  });

  test("keeps decodeRow's key order, so the two sources serialise alike", () => {
    expect(Object.keys(gestalItem(piece()))).toEqual(["id", "slot", "set", "rank", "rarity", "level",
      "faction", "isAccessory", "mainStat", "substats", "ascStat", "ascLevel", "equippedChampId"]);
  });

  test("rounds like decodeValue: absolute stats to whole numbers, percentages to two decimals", () => {
    const it = gestalItem(piece({
      mainStatId: 1, mainStatValue: 34149, slot: 1,                        // flat HP 341.49 -> 341
      substats: [
        { statId: 7, value: 1050, glyphBonusValue: 250, rolls: 1 },        // SPD 10.5 -> 11, glyph 2.5 -> 3
        { statId: 9, value: 1234, glyphBonusValue: 55, rolls: 0 },         // C.DMG 12.34%, glyph 0.55
      ],
    }));
    expect(it.mainStat.value).toBe(341);
    expect(it.substats[0]).toMatchObject({ value: 11, glyph: 3 });
    expect(it.substats[1]).toMatchObject({ value: 12.34, glyph: 0.55 });
  });

  test("a setless accessory keeps its faction; set null reads 0", () => {
    const it = gestalItem(piece({ slot: 7, gearSetId: null, factionId: 13, mainStatId: 1, mainStatValue: 408000 }));
    expect(it).toMatchObject({ slot: 8, set: 0, faction: 13, isAccessory: true });
  });

  test("an ascended piece carries its level and bonus stat; not ascended reads -1", () => {
    const it = gestalItem(piece({ ascensionLevel: 3, ascensionStat: { statId: 9, value: 1200 } }));
    expect(it.ascLevel).toBe(3);
    expect(it.ascStat).toEqual({ statId: 6, isFlat: false, value: 12 });
    expect(gestalItem(piece({ ascensionLevel: 0 })).ascLevel).toBe(-1);
  });

  test("the wearer comes through; unequipped reads 0", () => {
    expect(gestalItem(piece({ equippedOnHeroId: 100 })).equippedChampId).toBe(100);
    expect(gestalItem(piece()).equippedChampId).toBe(0);
  });

  test("a damage-type substat reads as the percent the game shows", () => {
    const it = gestalItem(piece({ substats: [{ statId: 16, value: 500, glyphBonusValue: null, rolls: 0 }] }));
    expect(it.substats[0]).toEqual({ statId: 11, isFlat: false, rolls: 0, value: 5, glyph: 0 });
  });

  // 13 is Gestal's "SPD %" — a set-bonus stat that never sits on a piece. Guessing a meaning for an
  // unknown id would decode wrong numbers silently; refusing makes the next Gestal change visible.
  test("refuses any id outside the maps", () => {
    expect(() => gestalItem(piece({ mainStatId: 13 }))).toThrow(/unknown Gestal stat id 13/);
    expect(() => gestalItem(piece({ substats: [{ statId: 99, value: 1, rolls: 0 }] }))).toThrow(/99/);
    expect(() => gestalItem(piece({ slot: 9 }))).toThrow(/unknown Gestal slot id 9/);
  });
});

// --- gestalChampRows ------------------------------------------------------------

describe("gestalChampRows", () => {
  test("builds the readAllChampRows columns, slot columns from each piece's wearer", () => {
    const snap = snapshotOf({
      artifacts: [
        piece({ id: 11, slot: 0, mainStatId: 3, mainStatValue: 26500, equippedOnHeroId: 100 }),  // Weapon
        piece({ id: 12, slot: 5, equippedOnHeroId: 100 }),                                       // Boots
        piece({ id: 13, slot: 6, factionId: 2, mainStatId: 1, mainStatValue: 408000, equippedOnHeroId: 100 }),
        piece({ id: 14, slot: 1, mainStatId: 1, mainStatValue: 408000 }),                        // unequipped
      ],
      champions: [champion({ blessingId: 1301 }), champion({ heroId: 200, name: "Kael", blessingId: null })],
    });
    const [elhain, kael] = gestalChampRows(snap);
    expect(elhain).toEqual({
      ID: 100, Name: "Elhain", Role: 0, Rarity: 3, Rang: 6, Lvl: 60, Fraction: 2, SPD: null, EmpLvl: 0,
      Weapon: 11, Helmet: 0, Shield: 0, Glouves: 0, Chest: 0, Shoes: 12, Ring: 13, Amulett: 0, Banner: 0,
      HeroID: 1496, BaseHeroID: 1490, BId: 1301, Br: null,
    });
    expect(kael).toMatchObject({ ID: 200, BId: 0, Weapon: 0, Shoes: 0, Ring: 0 });
  });

  test("two pieces in one champion's slot is a broken dump, not something to pick between", () => {
    const snap = snapshotOf({ artifacts: [piece({ id: 1, equippedOnHeroId: 100 }), piece({ id: 2, equippedOnHeroId: 100 })] });
    expect(() => gestalChampRows(snap)).toThrow(/two Shoes pieces/);
  });

  // Gestal reads gear and roster on separate polls, so a champion geared in between is in one document
  // and not yet the other. Dropping it would put its gear "in the vault" for the diff tools.
  test("a wearer the roster does not list gets an unnamed placeholder row holding its gear", () => {
    const snap = snapshotOf({ artifacts: [piece({ id: 7, equippedOnHeroId: 300 })], champions: [champion()] });
    const rows = gestalChampRows(snap);
    expect(rows.map((r) => r.ID)).toEqual([100, 300]);
    expect(rows[1]).toMatchObject({ ID: 300, Name: "", Shoes: 7, SPD: null });
    expect(rows.filter(isRealChamp).map((r) => r.ID)).toEqual([100]);   // readChampRows leaves it out
    expect(unlistedWearers(snap)).toEqual([300]);
  });
});

// Triage breaks score ties by input order, so the SQLite path's ORDER BY ID has to be matched.
test("pieces and champion rows come back in id order, whatever order Gestal wrote them in", () => {
  const snap = snapshotOf({
    artifacts: [piece({ id: 30 }), piece({ id: 10 }), piece({ id: 20 })],
    champions: [champion({ heroId: 200 }), champion({ heroId: 100 })],
  });
  expect(gestalItems(snap).map((it) => it.id)).toEqual([10, 20, 30]);
  expect(gestalChampRows(snap).map((r) => r.ID)).toEqual([100, 200]);
});

// --- the snapshot file ----------------------------------------------------------

describe("snapshot file", () => {
  test("is recognised by its .json.gz extension", () => {
    expect(isGestalPath("x/2026-09-28-Gestal.json.gz")).toBe(true);
    expect(isGestalPath("x/2026-09-28-RSLHelper.db")).toBe(false);
    expect(parseArgs(["Elhain", "2026-09-28-Gestal.json.gz"]))
      .toEqual({ selector: "Elhain", dbArg: "2026-09-28-Gestal.json.gz" });
  });

  test("round-trips through writeSnapshot and the shared readers", () => {
    const snap = snapshotOf({ artifacts: [piece({ equippedOnHeroId: 100 })] });
    const path = join(tmp(), "2026-09-28-Gestal.json.gz");
    writeSnapshot(path, snap);
    expect(readArtifacts(path)).toEqual({ items: gestalItems(snap), corrupt: [], total: 1 });
    expect(readAllChampRows(path)).toEqual(gestalChampRows(snap));
  });

  test("checkSnapshot refuses what the readers cannot trust", () => {
    const snap = snapshotOf();
    expect(() => checkSnapshot({ ...snap, format: "other" })).toThrow(/not a Gestal snapshot/);
    expect(() => checkSnapshot({ ...snap, formatVersion: 2 })).toThrow(/formatVersion 2/);
    const noGear = { ...snap, documents: { champions: snap.documents.champions } };
    expect(() => checkSnapshot(noGear)).toThrow(/missing the artifacts document/);
    const future = { ...snap, documents: { ...snap.documents, artifacts: { ...snap.documents.artifacts, schemaVersion: 3 } } };
    expect(() => checkSnapshot(future)).toThrow(/schemaVersion 3 is not one this adapter knows/);
  });
});

// --- the SQLite side of readAllChampRows ------------------------------------------

test("readAllChampRows reads the optional columns where the table has them, null where not", () => {
  const dir = tmp();
  const make = (name, extra) => {
    const path = join(dir, name);
    const db = new DatabaseSync(path);
    const cols = ["ID", "Role", "Rarity", "Rang", "Lvl", "Fraction", "SPD", "EmpLvl", "Weapon", "Helmet",
      "Shield", "Glouves", "Chest", "Shoes", "Ring", "Amulett", "Banner", ...extra];
    db.exec(`CREATE TABLE Champs (Name TEXT, ${cols.map((c) => `${c} INTEGER`).join(",")})`);
    db.prepare(`INSERT INTO Champs (Name, ${cols.join(",")}) VALUES (${["?", ...cols].map(() => "?").join(",")})`)
      .run("Elhain", ...cols.map((c) => (c === "ID" ? 100 : c === "Br" ? 1 : c === "BaseHeroID" ? 1490 : 0)));
    db.close();
    return path;
  };
  expect(readAllChampRows(make("minimal.db", []))[0]).toMatchObject({ HeroID: null, BaseHeroID: null, BId: null, Br: null });
  expect(readAllChampRows(make("full.db", ["HeroID", "BaseHeroID", "BId", "Br"]))[0])
    .toMatchObject({ BaseHeroID: 1490, Br: 1 });
});

// --- capture --------------------------------------------------------------------

describe("capture", () => {
  test("parseRefreshArgs takes --account and --out, and nothing else", () => {
    expect(parseRefreshArgs([])).toEqual({ account: null, out: null });
    expect(parseRefreshArgs(["--account", "k", "--out", "o.json.gz"])).toEqual({ account: "k", out: "o.json.gz" });
    expect(() => parseRefreshArgs(["--out"])).toThrow(/--out needs a value/);
    expect(() => parseRefreshArgs(["stray"])).toThrow(/unexpected argument "stray"/);
  });

  // Any other name would be unreadable to every tool AND outside what .gitignore denies.
  test("parseRefreshArgs refuses an --out that does not end in .json.gz", () => {
    for (const name of ["baseline", "pre-driver.gz", "snap.json", "x.json.gz.bak"]) {
      expect(() => parseRefreshArgs(["--out", name])).toThrow(/--out must end in \.json\.gz/);
    }
  });

  test("dataRoot honours GESTAL_DATA_ROOT, else the macOS default", () => {
    expect(dataRoot({ GESTAL_DATA_ROOT: "/x" }, "/home/u")).toBe("/x");
    expect(dataRoot({}, "/Users/u")).toBe("/Users/u/Library/Application Support/Gestal");
  });

  test("resolveAccount follows active.json, and --account overrides it", () => {
    const g = gestalRoot();
    cleanups.push(g.cleanup);
    expect(resolveAccount(g.root, null)).toBe(g.acct);
    expect(resolveAccount(g.root, "abc123")).toBe(g.acct);
  });

  test("resolveAccount refuses a missing folder, the guest slot and an account with no gear dump", () => {
    const g = gestalRoot({ active: "local" });
    cleanups.push(g.cleanup);
    expect(() => resolveAccount(join(g.root, "nope"), null)).toThrow(/Gestal data folder not found/);
    expect(() => resolveAccount(g.root, null)).toThrow(/guest slot.*accounts with a gear dump: abc123/);
    expect(() => resolveAccount(g.root, "local")).toThrow(/account "local" has no gear dump/);
  });

  test("captureSnapshot takes the gear, roster and stat documents, and leaves metadata.json out", () => {
    const g = gestalRoot();
    cleanups.push(g.cleanup);
    const { snapshot, items, champions } = captureSnapshot(g.acct, { now: new Date("2026-09-28T12:05:00Z"), version: "t" });
    expect(Object.keys(snapshot.documents).sort()).toEqual(["artifacts", "champions", "great-hall-state", "last-extraction"]);
    expect({ items, champions }).toEqual({ items: 1, champions: 1 });
    expect(snapshot).toMatchObject({ format: FORMAT, formatVersion: FORMAT_VERSION, gestalVersion: "t",
      capturedAt: "2026-09-28T12:05:00.000Z" });
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("Player One");
    expect(text).not.toContain("123456789");
  });

  test("captureSnapshot refuses a gear dump in a format the adapter does not know", () => {
    const g = gestalRoot({ artifactsVersion: 3 });
    cleanups.push(g.cleanup);
    expect(() => captureSnapshot(g.acct, { version: null })).toThrow(/schemaVersion 3/);
  });

  test("captureSnapshot refuses a dump the readers could not decode", () => {
    const g = gestalRoot({ artifacts: [piece({ mainStatId: 13 })] });
    cleanups.push(g.cleanup);
    expect(() => captureSnapshot(g.acct, { version: null })).toThrow(/unknown Gestal stat id 13/);
  });

  // A document's extractedAt is when it last CHANGED; the last extraction is when Gestal last looked.
  test("the account data is dated by the last successful extraction, else by the newest document", () => {
    const ok = snapshotOf({ lastExtraction: { attemptedAt: "2026-09-28T12:04:00Z", succeeded: true } });
    expect(dataAsOf(ok)).toEqual({ at: "2026-09-28T12:04:00Z", source: "last extraction" });
    // The roster (12:00:30) is newer than the gear (12:00:00): the data is known to hold until then.
    const failed = snapshotOf({ lastExtraction: { attemptedAt: "2026-09-28T12:04:00Z", succeeded: false } });
    expect(dataAsOf(failed)).toEqual({ at: "2026-09-28T12:00:30Z", source: "newest document" });
    expect(dataAsOf(snapshotOf())).toEqual({ at: "2026-09-28T12:00:30Z", source: "newest document" });
  });

  test("a capture with no usable timestamp cannot be dated, rather than being named NaN", () => {
    const snap = snapshotOf();
    snap.documents.artifacts.payload.extractedAt = undefined;
    snap.documents.champions.payload.extractedAt = "garbage";
    expect(() => dataAsOf(snap)).toThrow(/cannot date this capture/);
  });

  test("localDate is the local calendar day of a timestamp", () => {
    // Built from local components, so the expectation holds in every time zone — including UTC+13/+14,
    // where midday UTC is already the next day.
    expect(localDate(new Date(2026, 8, 28, 12).toISOString())).toBe("2026-09-28");
    expect(localDate(new Date(2026, 8, 28, 0, 5).toISOString())).toBe("2026-09-28");
  });

  // A failed last read dates the capture by its documents, which can be days old when nothing changed.
  // Overwriting a genuine capture of that day would put newer data under an old label for good.
  test("destination keeps an existing snapshot when the capture could only be dated by its documents", () => {
    const dir = tmp();
    const failed = snapshotOf({ lastExtraction: { attemptedAt: "2026-09-29T09:00:00Z", succeeded: false } });
    const ok = snapshotOf({ lastExtraction: { attemptedAt: "2026-09-28T12:04:00Z", succeeded: true } });
    const date = localDate("2026-09-28T12:00:30Z");
    const exists = () => true, absent = () => false;
    expect(destination(failed, null, dir, exists).refusal).toMatch(/Not overwriting it/);
    expect(destination(failed, null, dir, absent)).toMatchObject({ refusal: null, date,
      dest: join(dir, `${date}-Gestal.json.gz`) });
    expect(destination(failed, join(dir, "b.json.gz"), dir, exists).refusal).toBeNull();   // --out: asked for
    expect(destination(ok, null, dir, exists).refusal).toBeNull();                          // a normal re-capture
  });

  test("scrub replaces identifiers in strings, keys included, and never touches numbers", () => {
    const count = { n: 0 };
    const out = scrub({ msg: "C:/x/0123456789abcdef/y", n: 1234567890, ["0123456789abcdef"]: [5, "ok"] },
      ["0123456789abcdef", "1234567890"], count);
    expect(out).toEqual({ msg: "C:/x/<redacted>/y", n: 1234567890, "<redacted>": [5, "ok"] });
    expect(count.n).toBe(2);
  });

  // The known way an identifier could slip into a capture: a path in last-extraction's errorMessage.
  test("captureSnapshot scrubs the account key and player id, but not the display name", () => {
    const key = "fedcba9876543210";
    const g = gestalRoot({ key, champions: [champion({ name: "Player One" })],
      lastExtraction: { attemptedAt: "2026-09-28T12:04:00Z", succeeded: false,
        errorMessage: `could not open /Gestal/accounts/${key}/x for 123456789` } });
    cleanups.push(g.cleanup);
    const { snapshot, redacted } = captureSnapshot(g.acct, { version: null });
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain(key);
    expect(text).not.toContain("123456789");
    expect(redacted).toBe(2);   // both identifiers, found in the one message
    // Free text that can equal real data — here a champion's name — is left alone on purpose.
    expect(snapshot.documents.champions.payload.champions[0].name).toBe("Player One");
  });

  test("freshnessWarnings flags a stale read and a failed one", () => {
    const at = "2026-09-28T12:00:00Z";
    const fresh = snapshotOf({ lastExtraction: { attemptedAt: at, succeeded: true } });
    const later = (min) => new Date(Date.parse(at) + min * 60000);
    expect(freshnessWarnings(fresh, later(STALE_MINUTES))).toEqual([]);
    expect(freshnessWarnings(fresh, later(STALE_MINUTES + 1))).toEqual([expect.stringMatching(/16 min old/)]);
    const failed = snapshotOf({ lastExtraction: { attemptedAt: at, succeeded: false, errorMessage: "boom" } });
    expect(freshnessWarnings(failed, later(1))).toEqual([expect.stringMatching(/last read of the game failed: boom/)]);
  });

  test("formatAge picks a readable unit", () => {
    expect(formatAge(5)).toBe("5 min");
    expect(formatAge(180)).toBe("3 h");
    expect(formatAge(3 * 1440)).toBe("3 days");
  });
});

// --- the CLI --------------------------------------------------------------------

describe("refresh-gestal.mjs", () => {
  const run = (args, root) => spawnSync(process.execPath, [SCRIPT, ...args],
    { encoding: "utf8", env: { ...process.env, GESTAL_DATA_ROOT: root } });

  test("writes a readable snapshot where --out says and reports what it took", () => {
    const g = gestalRoot();
    cleanups.push(g.cleanup);
    const out = join(tmp(), "baseline.json.gz");
    const res = run(["--out", out], g.root);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/snapshot saved: .*baseline\.json\.gz {2}\(1 pieces, 1 champions\)/);
    expect(res.stdout).toMatch(/not in Gestal's folder, so not captured: relic-inventory, account-bonuses/);
    const parsed = JSON.parse(gunzipSync(readFileSync(out)).toString("utf8"));
    expect(parsed.documents.artifacts.payload.artifacts).toHaveLength(1);
    expect(readArtifacts(out).items).toHaveLength(1);
  });

  test("warns when Gestal has not read the game recently", () => {
    const g = gestalRoot();
    cleanups.push(g.cleanup);
    const res = run(["--out", join(tmp(), "x.json.gz")], g.root);
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/warning: the data is .* old — Gestal is not reading the game right now/);
  });

  test("fails with a message, and writes nothing, when there is no Gestal folder", () => {
    const dir = tmp();
    const out = join(dir, "x.json.gz");
    const res = run(["--out", out], join(dir, "missing"));
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Gestal data folder not found/);
    expect(() => readFileSync(out)).toThrow();
  });

  test("refuses an --out name the tools could not read and git would not ignore", () => {
    const g = gestalRoot();
    cleanups.push(g.cleanup);
    const out = join(tmp(), "baseline");
    const res = run(["--out", out], g.root);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/--out must end in \.json\.gz/);
    expect(() => readFileSync(out)).toThrow();
  });
});

// --- speed.mjs on a snapshot without current speed --------------------------------

describe("speed.mjs verify", () => {
  const verify = (snapshot, corpus) => spawnSync(process.execPath,
    [...FLAGS, "--no-warnings", SPEED, "verify", snapshot, "--corpus", corpus], { encoding: "utf8" });
  const corpusFile = () => {
    const path = join(tmp(), "corpus.json");
    writeFileSync(path, JSON.stringify({ Elhain: 107, Kael: 109 }));
    return path;
  };

  test("refuses a Gestal snapshot, which carries no current speed at all", () => {
    const path = join(tmp(), "2026-09-28-Gestal.json.gz");
    writeSnapshot(path, snapshotOf({ artifacts: [piece({ equippedOnHeroId: 100 })] }));
    const res = verify(path, corpusFile());
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/does not carry/);
  });

  // RSL Helper's SPD column is nullable: one NULL must not cost the whole snapshot its verify.
  test("skips a champion with no current speed and measures the rest", () => {
    const path = join(tmp(), "fixture.db");
    const db = new DatabaseSync(path);
    const art = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset", "ASCLEVEL",
      "cID", ASC.id, ASC.fl, ASC.base, ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv, s.myth])];
    const champ = ["ID", "Role", "Rarity", "Rang", "Lvl", "Fraction", "SPD", "EmpLvl", "Weapon", "Helmet",
      "Shield", "Glouves", "Chest", "Shoes", "Ring", "Amulett", "Banner"];
    db.exec(`CREATE TABLE Artifacts (${art.map((c) => `${c} INTEGER`).join(",")})`);
    db.exec(`CREATE TABLE Champs (Name TEXT, ${champ.map((c) => `${c} INTEGER`).join(",")})`);
    const insA = db.prepare(`INSERT INTO Artifacts (${art.join(",")}) VALUES (${art.map(() => "?").join(",")})`);
    // One flat-HP weapon each, worn by champions 1 and 2; values are stat x 2**32 as the game stores them.
    for (const [id, wearer] of [[11, 1], [12, 2]]) {
      const row = { ID: id, type: 5, rank: 6, rarity: 6, lvl: 16, mid: 1, mfl: 1, mlvlid: 4080 * 2 ** 32, cID: wearer };
      insA.run(...art.map((c) => row[c] ?? 0));
    }
    const insC = db.prepare(`INSERT INTO Champs (Name, ${champ.join(",")}) VALUES (${["?", ...champ].map(() => "?").join(",")})`);
    const cells = (o) => champ.map((c) => (c in o ? o[c] : 0));   // `in`, so an explicit null stays NULL
    insC.run("Elhain", ...cells({ ID: 1, SPD: 107, Weapon: 11 }));
    insC.run("Kael", ...cells({ ID: 2, SPD: null, Weapon: 12 }));
    db.close();
    const res = verify(path, corpusFile());
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/1 geared champions in the corpus \(0 not in it, 1 with no current speed\)/);
    expect(res.stdout).not.toMatch(/NaN/);
  });
});
