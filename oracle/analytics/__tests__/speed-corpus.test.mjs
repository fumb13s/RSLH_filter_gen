// oracle/analytics/__tests__/speed-corpus.test.mjs
//
// Every fixture here is synthetic and in-memory or written to a throwaway directory. The real corpus
// is an external local dataset that is deliberately not vendored into this repo, so no test may
// depend on one being present.
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCorpus, loadCorpus, lookupBase } from "../speed-corpus.mjs";

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "speed-corpus-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value), "utf8");

test("parseCorpus accepts a flat name -> speed object", () => {
  const c = parseCorpus({ "Arbiter": 110, "Kantra the Cyclone": 109 });
  expect(c.get("arbiter")).toBe(110);
  expect(c.get("kantra the cyclone")).toBe(109);
});

test("parseCorpus accepts an array of stat records", () => {
  const c = parseCorpus([
    { name: "Arbiter", stats: { spd: 110, hp: 21135 } },
    { name: "Elhain", stats: { spd: 107 } },
  ]);
  expect(c.get("arbiter")).toBe(110);
  expect(c.get("elhain")).toBe(107);
});

// A record may carry its speed directly rather than under a stats block.
test("parseCorpus accepts a record with a top-level spd", () => {
  const c = parseCorpus([{ name: "Arbiter", spd: 110 }]);
  expect(c.get("arbiter")).toBe(110);
});

// Absent, NOT zero: the CLI has to be able to tell "this champion is not in the corpus" (fall back
// to --base) from "this champion's base speed is 0".
test("parseCorpus skips records with no speed", () => {
  const c = parseCorpus([{ name: "Nameless", stats: {} }, { name: "Ok", stats: { spd: 100 } }]);
  expect(c.has("nameless")).toBe(false);
  expect(c.get("ok")).toBe(100);
});

// A speed that arrived as a string would sail through arithmetic as concatenation ("110" + 6), so
// the type guard is load-bearing rather than defensive.
test("parseCorpus skips array records whose name or speed has the wrong type", () => {
  const c = parseCorpus([
    { name: 110, stats: { spd: 110 } },
    { name: "Stringly", stats: { spd: "107" } },
    { stats: { spd: 100 } },
    { name: "Ok", stats: { spd: 100 } },
  ]);
  expect([...c.keys()]).toEqual(["ok"]);
});

test("parseCorpus skips non-numeric values in a flat map", () => {
  const c = parseCorpus({ "Arbiter": 110, "Stringly": "107", "Missing": null });
  expect([...c.keys()]).toEqual(["arbiter"]);
});

// Corpus names carry apostrophes, non-ASCII punctuation and commas. Lowercasing must leave the rest
// of the name byte-for-byte intact, because the CLI looks these up by the DB's spelling.
test("parseCorpus lowercases names without otherwise altering them", () => {
  const c = parseCorpus({ "Ma'Shalled": 96, "Krok’mar the Devourer": 94, "Fyna, Blade of Aravia": 103 });
  expect(c.get("ma'shalled")).toBe(96);
  expect(c.get("krok’mar the devourer")).toBe(94);
  expect(c.get("fyna, blade of aravia")).toBe(103);
});

// Loudly, not with an empty Map: a silent empty corpus makes every champion look absent and sends
// the user hunting for a --base flag they should not need.
test("parseCorpus rejects a shape it does not recognise", () => {
  expect(() => parseCorpus(42)).toThrow(/corpus/i);
  expect(() => parseCorpus(null)).toThrow(/corpus/i);
});

test("parseCorpus rejects other non-object shapes", () => {
  expect(() => parseCorpus(undefined)).toThrow(/corpus/i);
  expect(() => parseCorpus("Arbiter")).toThrow(/corpus/i);
  expect(() => parseCorpus(true)).toThrow(/corpus/i);
});

// Lookup is case-insensitive because the DB and the corpus disagree on casing for some names.
test("lookupBase is case-insensitive and returns null on a miss", () => {
  const c = parseCorpus({ "Arbiter": 110 });
  expect(lookupBase(c, "ARBITER")).toBe(110);
  expect(lookupBase(c, "Nobody")).toBe(null);
});

test("lookupBase tolerates a non-string name", () => {
  const c = parseCorpus({ "Arbiter": 110 });
  expect(lookupBase(c, 42)).toBe(null);
  expect(lookupBase(c, null)).toBe(null);
});

// --- loadCorpus -------------------------------------------------------------

test("loadCorpus reads a single JSON file in either shape", () => {
  const { dir, cleanup } = tempDir();
  try {
    writeJson(join(dir, "flat.json"), { "Arbiter": 110 });
    writeJson(join(dir, "records.json"), [{ name: "Elhain", stats: { spd: 107 } }]);
    expect(lookupBase(loadCorpus(join(dir, "flat.json")), "arbiter")).toBe(110);
    expect(lookupBase(loadCorpus(join(dir, "records.json")), "elhain")).toBe(107);
  } finally {
    cleanup();
  }
});

// The corpus is split one file per faction, so a directory load has to merge them all — stopping at
// the first would silently lose every champion outside one faction.
test("loadCorpus merges every subdirectory's stats.json", () => {
  const { dir, cleanup } = tempDir();
  try {
    for (const [faction, rows] of [
      ["banner-lords", [{ name: "Kael", stats: { spd: 103 } }]],
      ["sacred-order", [{ name: "Elhain", stats: { spd: 107 } }, { name: "Arbiter", stats: { spd: 110 } }]],
      ["knights-revenant", [{ name: "Athel", stats: { spd: 102 } }]],
    ]) {
      mkdirSync(join(dir, faction));
      writeJson(join(dir, faction, "stats.json"), rows);
    }
    const c = loadCorpus(dir);
    expect(c.size).toBe(4);
    expect([lookupBase(c, "Kael"), lookupBase(c, "Arbiter"), lookupBase(c, "Athel")])
      .toEqual([103, 110, 102]);
  } finally {
    cleanup();
  }
});

// One unreadable or stats-less entry among many must not cost the rest of the corpus; the guard
// against a wholly unusable directory is the size check below, not per-entry strictness.
test("loadCorpus skips directory entries with no readable stats.json", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "empty-faction"));
    mkdirSync(join(dir, "broken-faction"));
    writeFileSync(join(dir, "broken-faction", "stats.json"), "{not json", "utf8");
    writeFileSync(join(dir, "README.md"), "loose file, not a faction", "utf8");
    mkdirSync(join(dir, "banner-lords"));
    writeJson(join(dir, "banner-lords", "stats.json"), [{ name: "Kael", stats: { spd: 103 } }]);
    const c = loadCorpus(dir);
    expect([...c.keys()]).toEqual(["kael"]);
  } finally {
    cleanup();
  }
});

// Pointing --corpus at the wrong directory is the likely mistake, and it has to say so rather than
// hand back a corpus in which every champion is missing.
test("loadCorpus throws when a directory holds no stats.json at all", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "empty-faction"));
    expect(() => loadCorpus(dir)).toThrow(/corpus/i);
    expect(() => loadCorpus(dir)).toThrow(dir);
  } finally {
    cleanup();
  }
});

// Same guarantee for the single-file branch: a recognised container that yields no speeds at all
// (here name -> stats object, a shape parseCorpus does not read) is a pointing error, not a corpus.
test("loadCorpus throws rather than return an empty corpus from a file", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "nested.json");
    writeJson(path, { "Arbiter": { spd: 110 } });
    expect(() => loadCorpus(path)).toThrow(/corpus/i);
    expect(() => loadCorpus(path)).toThrow(path);
  } finally {
    cleanup();
  }
});

test("loadCorpus throws on a path that does not exist", () => {
  const { dir, cleanup } = tempDir();
  try {
    expect(() => loadCorpus(join(dir, "nope.json"))).toThrow();
  } finally {
    cleanup();
  }
});
