// oracle/analytics/__tests__/speed-corpus.test.mjs
//
// Every fixture here is synthetic and in-memory or written to a throwaway directory. The real corpus
// is an external local dataset that is deliberately not vendored into this repo, so no test may
// depend on one being present.
import { test, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCorpus, loadCorpus, lookupBase, squashName } from "../speed-corpus.mjs";

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

// The other half of the absent-vs-zero contract: "skips records with no speed" pins that a MISSING
// speed does not become 0, and this pins that a speed of 0 does not become missing. Both `??` in
// this module are load-bearing for it, and `||` is the one-character slip that breaks it — the CLI
// branches on `base === null` to decide whether to demand --base. No champion really has base speed
// 0, so this never fires in production; it fires when someone "simplifies" the coalescing.
test("a corpus speed of 0 is a speed, not a miss", () => {
  const c = parseCorpus({ "Zero": 0 });
  expect(lookupBase(c, "Zero")).toBe(0);
  expect(lookupBase(c, "Absent")).toBe(null);
  expect(parseCorpus([{ name: "Zero", stats: { spd: 0 } }]).get("zero")).toBe(0);
  expect(parseCorpus([{ name: "Zero", spd: 0 }]).get("zero")).toBe(0);
});

test("lookupBase tolerates a non-string name", () => {
  const c = parseCorpus({ "Arbiter": 110 });
  expect(lookupBase(c, 42)).toBe(null);
  expect(lookupBase(c, null)).toBe(null);
});

// --- the punctuation fallback -----------------------------------------------

test("squashName strips every non-alphanumeric character and lowercases the rest", () => {
  expect(squashName("Krok’mar the Devourer")).toBe("krokmarthedevourer");
  expect(squashName("Fyna, Blade of Aravia")).toBe("fynabladeofaravia");
  expect(squashName("Belletar Mage-slayer")).toBe("belletarmageslayer");
  expect(squashName("Big 'Un")).toBe("bigun");
  expect(squashName(42)).toBe("42");
});

// The game spells champion names with apostrophes (both ASCII and typographic), commas, colons and
// hyphens; a corpus that has been through a slug or an OCR pass often has not. It is not even
// consistent about it — the same corpus can drop an apostrophe outright ("mashalled") and turn a
// hyphen into a space ("belletar mage slayer") — so stripping EVERY non-alphanumeric from both sides
// is the only form the two reliably agree on. Without this, 17 of the 20 champions the CLI reports
// as "not in the corpus" are in it.
test("lookupBase matches a corpus that dropped the punctuation from its names", () => {
  const c = parseCorpus({
    "mashalled": 103, "krokmar the devourer": 102, "xena warrior princess": 100,
    "belletar mage slayer": 108, "big un": 104, "fyna blade of aravia": 113,
  });
  expect(lookupBase(c, "Ma'Shalled")).toBe(103);
  expect(lookupBase(c, "Krok’mar the Devourer")).toBe(102);
  expect(lookupBase(c, "Xena: Warrior Princess")).toBe(100);
  expect(lookupBase(c, "Belletar Mage-slayer")).toBe(108);
  expect(lookupBase(c, "Big 'Un")).toBe(104);
  expect(lookupBase(c, "Fyna, Blade of Aravia")).toBe(113);
});

// A fallback, not a replacement: a corpus that DOES keep punctuation must keep answering exactly as
// it did before, which is why the squash cannot simply be applied to both sides unconditionally.
test("lookupBase prefers an exact match over the punctuation-stripped fallback", () => {
  const c = parseCorpus({ "krok’mar the devourer": 102, "krokmar the devourer": 999 });
  expect(lookupBase(c, "Krok’mar the Devourer")).toBe(102);
});

// The cost of a looser key is that two DIFFERENT champions could land on one. When they do, the
// corpus cannot say which was meant, so the champion is reported absent and the user is sent to
// --base — the same answer as before the fallback existed, never a guess. (The pair here is
// illustrative; no two names in any corpus checked so far collide.)
test("lookupBase refuses the fallback when two corpus names collide on different speeds", () => {
  const c = parseCorpus({ "Skullcrusher": 90, "Skull Crusher": 101 });
  expect(lookupBase(c, "Skull-Crusher")).toBe(null);
  expect(lookupBase(c, "Skullcrusher")).toBe(90);
});

// Two spellings of ONE champion — the realistic collision, since a corpus merged from several files
// can hold both — are not a disagreement, and refusing them would re-create the miss this fixes.
test("lookupBase still answers when colliding corpus names agree on the speed", () => {
  const c = parseCorpus({ "krokmar the devourer": 102, "krok mar the devourer": 102 });
  expect(lookupBase(c, "Krok’mar the Devourer")).toBe(102);
});

// Absent stays absent: the looser key must not manufacture a match out of a name the corpus has
// never heard of, and a speed of 0 reached through the fallback is still a speed, not a miss.
test("the fallback neither invents a match nor turns a 0 into one", () => {
  const c = parseCorpus({ "arbiter": 110, "zero": 0 });
  expect(lookupBase(c, "Arbiter's Rival")).toBe(null);
  expect(lookupBase(c, "Arbite")).toBe(null);
  expect(lookupBase(c, "Ze-ro")).toBe(0);
});

// A name that squashes to nothing must not match a corpus key that also squashes to nothing —
// otherwise every punctuation-only string collapses onto the same key and matches whatever is there.
test("a name with no alphanumerics never matches through the fallback", () => {
  const c = parseCorpus({ "--": 50, "Arbiter": 110 });
  expect(lookupBase(c, "'")).toBe(null);
  expect(lookupBase(c, "")).toBe(null);
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

// An entry with no stats.json is not a faction directory at all — a loose file, a README, a scratch
// dir — so it is skipped. An entry whose stats.json EXISTS but cannot be used is a different thing:
// see the two tests below.
test("loadCorpus skips directory entries that have no stats.json", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "empty-faction"));
    writeFileSync(join(dir, "README.md"), "loose file, not a faction", "utf8");
    mkdirSync(join(dir, "banner-lords"));
    writeJson(join(dir, "banner-lords", "stats.json"), [{ name: "Kael", stats: { spd: 103 } }]);
    const c = loadCorpus(dir);
    expect([...c.keys()]).toEqual(["kael"]);
  } finally {
    cleanup();
  }
});

// Valid JSON of a shape parseCorpus cannot read. `null` is not exotic — it is what a scraper writes
// when a faction page comes back empty. Skipping it would drop every champion in that faction and
// then report them as absent, so the load fails; and it has to say WHICH file, or the user is left
// opening sixteen of them to find the bad one.
test("loadCorpus fails on a wrong-shaped stats.json and names the file", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "banner-lords"));
    writeJson(join(dir, "banner-lords", "stats.json"), [{ name: "Kael", stats: { spd: 103 } }]);
    mkdirSync(join(dir, "knights-revenant"));
    writeJson(join(dir, "knights-revenant", "stats.json"), null);
    expect(() => loadCorpus(dir)).toThrow(/corpus/i);
    expect(() => loadCorpus(dir)).toThrow(join(dir, "knights-revenant", "stats.json"));
  } finally {
    cleanup();
  }
});

// A stats.json that exists but cannot be read at all is a broken faction too, not a non-faction:
// only "there is no stats.json here" earns a skip. A directory named stats.json is the portable way
// to provoke a non-ENOENT read failure (EISDIR); a permission-denied file is the realistic one.
test("loadCorpus fails on an unreadable stats.json and names the file", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "banner-lords"));
    writeJson(join(dir, "banner-lords", "stats.json"), [{ name: "Kael", stats: { spd: 103 } }]);
    mkdirSync(join(dir, "odd-faction"));
    mkdirSync(join(dir, "odd-faction", "stats.json"));
    expect(() => loadCorpus(dir)).toThrow(/corpus/i);
    expect(() => loadCorpus(dir)).toThrow(join(dir, "odd-faction", "stats.json"));
  } finally {
    cleanup();
  }
});

// Same rule for a stats.json that is not valid JSON at all: it exists, so it is a broken faction
// rather than a non-faction. Tolerating one flavour of corrupt file while the other is fatal was the
// asymmetry that made the original failure undiagnosable.
test("loadCorpus fails on a malformed stats.json and names the file", () => {
  const { dir, cleanup } = tempDir();
  try {
    mkdirSync(join(dir, "banner-lords"));
    writeJson(join(dir, "banner-lords", "stats.json"), [{ name: "Kael", stats: { spd: 103 } }]);
    mkdirSync(join(dir, "broken-faction"));
    writeFileSync(join(dir, "broken-faction", "stats.json"), "{not json", "utf8");
    expect(() => loadCorpus(dir)).toThrow(/corpus/i);
    expect(() => loadCorpus(dir)).toThrow(join(dir, "broken-faction", "stats.json"));
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
