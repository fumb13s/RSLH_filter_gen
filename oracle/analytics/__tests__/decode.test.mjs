// oracle/analytics/__tests__/decode.test.mjs
import { test, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeValue, decodeRow, readArtifacts } from "../decode.mjs";
import { SUB, ASC } from "../../lib/decode.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Build a throwaway Artifacts DB with just the columns readArtifacts selects.
const ALLCOLS = ["ID", "type", "rank", "rarity", "lvl", "mid", "mfl", "mlvlid", "aset", "accset",
  "ASCLEVEL", "cID", ASC.id, ASC.fl, ASC.base,
  ...SUB.flatMap((s) => [s.id, s.fl, s.lvl, s.base, s.gv, s.myth])];
function makeTempDb(rows) {
  const dir = mkdtempSync(join(tmpdir(), "oracle-decode-"));
  const path = join(dir, "fixture.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE Artifacts (${ALLCOLS.map((c) => `${c} INTEGER`).join(",")})`);
  const ins = db.prepare(`INSERT INTO Artifacts (${ALLCOLS.join(",")}) VALUES (${ALLCOLS.map(() => "?").join(",")})`);
  for (const r of rows) ins.run(...ALLCOLS.map((c) => r[c] ?? 0));
  db.close();
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("decodeValue: percent stat x100 (ATK% 2576980377 -> 60)", () => {
  expect(decodeValue(2, false, 2576980377)).toBe(60);
});
test("decodeValue: flat/non-pct stat is integer (SPD 25769803776 -> 6)", () => {
  expect(decodeValue(4, true, 25769803776)).toBe(6);
});
test("decodeValue: zero stays zero", () => {
  expect(decodeValue(1, true, 0)).toBe(0);
});

test("decode matches known-gear manifest (24 items)", () => {
  const manifest = JSON.parse(readFileSync(here("../../known-gear.manifest.json"), "utf8"));
  const { items } = readArtifacts(here("../../known-gear.db"));
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const exp of manifest.items) {
    const got = byId.get(exp.id);
    expect(got, `item ${exp.id} decoded`).toBeTruthy();
    expect(got.slot, `#${exp.id} slot`).toBe(exp.ourSlotId);
    expect(got.set, `#${exp.id} set`).toBe(exp.setId);
    expect(got.rank, `#${exp.id} rank`).toBe(exp.rank);
    expect(got.rarity, `#${exp.id} rarity`).toBe(exp.ourRarityIndex);
    expect(got.level, `#${exp.id} level`).toBe(exp.level);
    expect(got.faction, `#${exp.id} faction`).toBe(exp.faction?.id ?? 0); // manifest faction = {id,name}|null
    expect(got.mainStat.statId, `#${exp.id} main id`).toBe(exp.mainStat.ourStatId);
    expect(got.mainStat.isFlat, `#${exp.id} main flat`).toBe(exp.mainStat.isFlat);
    expect(got.mainStat.value, `#${exp.id} main value`).toBe(exp.mainStat.value);
    expect(got.substats.length, `#${exp.id} sub count`).toBe(exp.substats.length);
    exp.substats.forEach((es, i) => {
      expect(got.substats[i].statId, `#${exp.id} sub${i} id`).toBe(es.ourStatId);
      expect(got.substats[i].isFlat, `#${exp.id} sub${i} flat`).toBe(es.isFlat);
      expect(got.substats[i].value, `#${exp.id} sub${i} value`).toBe(es.value);
      expect(got.substats[i].rolls, `#${exp.id} sub${i} rolls`).toBe(es.rolls);
    });
  }
});

test("Mythical bonus roll (sNmlvlid) is included in the substat value", () => {
  const { items } = readArtifacts(here("../../known-gear.db"));
  const myth = items.find((it) => it.id === 352891); // Mythical Shield
  const res = myth.substats.find((s) => s.statId === 7); // RES: base 12 + Mythical bonus 10
  expect(res.value).toBe(22);
});

// Regression: a real corrupt row appeared in the 2026-07-12 snapshot (ID 196608:
// type=-2 rank=215 rarity=0 lvl=-1) carrying 64-bit garbage in s1gv/s1mlvlid that
// exceeds Number.MAX_SAFE_INTEGER. node:sqlite throws on such a column unless the read
// enables BigInt, so isCorrupt() never got a chance to drop it. readArtifacts must read
// the row without throwing and then filter it out.
test("readArtifacts: out-of-range 64-bit values don't crash the read; corrupt row is dropped", () => {
  const valid = { ID: 1, type: 6, rank: 6, rarity: 5, lvl: 16, mid: 2, mfl: 0, mlvlid: 2576980377,
    s1id: 1, s1fl: 0, s1lvl: 0, s1lvlid: 515396074 };
  const corrupt = { ID: 196608, type: -2, rank: 215, rarity: 0, lvl: -1,
    s1gv: 4879650197399715840n, s1mlvlid: 4875709547725307904n };
  const { path, cleanup } = makeTempDb([valid, corrupt]);
  try {
    const res = readArtifacts(path); // previously threw a RangeError here
    expect(res.total).toBe(2);
    expect(res.corrupt).toContain(196608);
    expect(res.items.map((it) => it.id)).toEqual([1]);
  } finally {
    cleanup();
  }
});

// A minimal Artifacts row. 2**32 == 4294967296, so `n * 2**32` encodes the integer n.
const row = (o = {}) => ({
  ID: 1, type: 4, rank: 6, rarity: 5, lvl: 16, mid: 4, mfl: 0, mlvlid: 30 * 2 ** 32,
  aset: 4, accset: 0, ASCLEVEL: 0, cID: 0, ASCID: 0, ASCFL: 0, ASCLVLID: 0,
  s1id: 0, s1fl: 0, s1lvl: 0, s1lvlid: 0, s1gv: 0, s1mlvlid: 0,
  s2id: 0, s2fl: 0, s2lvl: 0, s2lvlid: 0, s2gv: 0, s2mlvlid: 0,
  s3id: 0, s3fl: 0, s3lvl: 0, s3lvlid: 0, s3gv: 0, s3mlvlid: 0,
  s4id: 0, s4fl: 0, s4lvl: 0, s4lvlid: 0, s4gv: 0, s4mlvlid: 0,
  ...o,
});

test("decodeRow reads a SPD ascension stat", () => {
  const item = decodeRow(row({ ASCID: 4, ASCFL: 0, ASCLVLID: 12 * 2 ** 32, ASCLEVEL: 6 }));
  expect(item.ascStat).toEqual({ statId: 4, isFlat: false, value: 12 });
});

// ASCID is a DB stat id and needs the same remap as substats: DB 7 (C.RATE) -> our 5.
test("decodeRow remaps the ascension stat id into our id space", () => {
  const item = decodeRow(row({ ASCID: 7, ASCFL: 0, ASCLVLID: 0.15 * 2 ** 32 }));
  expect(item.ascStat.statId).toBe(5);
  expect(item.ascStat.value).toBe(15);
});

// The live DB holds ASCID -1 on un-ascended rows and 0 on a handful of others. Neither is a stat.
test("decodeRow yields no ascension stat when ASCID is absent or -1", () => {
  expect(decodeRow(row({ ASCID: 0 })).ascStat).toBe(null);
  expect(decodeRow(row({ ASCID: -1, ASCLEVEL: -1 })).ascStat).toBe(null);
});

// ASCGV is 0 in every non-corrupt row of every snapshot checked (the sole nonzero one is the
// garbage row 196608 that isCorrupt drops), so the decoder must not invent a glyph field.
test("decodeRow's ascension stat carries no glyph field", () => {
  const item = decodeRow(row({ ASCID: 4, ASCLVLID: 12 * 2 ** 32 }));
  expect("glyph" in item.ascStat).toBe(false);
});
