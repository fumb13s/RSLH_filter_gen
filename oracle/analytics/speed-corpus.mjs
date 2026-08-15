// Champion base speed, looked up by name.
//
// The corpus is an EXTERNAL local dataset. Its path comes from --corpus or $RSLH_SPEED_CORPUS, and
// nothing is vendored into this repo. Three shapes are accepted so it can point straight at whatever
// you already have:
//
//   { "Arbiter": 110, ... }                                  a flat name -> speed map
//   [ { name: "Arbiter", stats: { spd: 110 } }, ... ]         an array of stat records
//   a directory containing */stats.json, each in either shape above
import { readFileSync, readdirSync, statSync } from "node:fs";

// A record with no speed is SKIPPED, not defaulted to 0: the caller has to be able to tell "not in
// the corpus" (fall back to --base) from "base speed 0". Same reason the unrecognised shape throws
// instead of returning an empty Map — that would make every champion look absent at once.
export function parseCorpus(raw) {
  const corpus = new Map();
  if (Array.isArray(raw)) {
    for (const record of raw) {
      const spd = record?.stats?.spd ?? record?.spd;
      if (typeof record?.name !== "string" || typeof spd !== "number") continue;
      corpus.set(record.name.toLowerCase(), spd);
    }
    return corpus;
  }
  if (raw && typeof raw === "object") {
    for (const [name, spd] of Object.entries(raw)) {
      if (typeof spd !== "number") continue;
      corpus.set(name.toLowerCase(), spd);
    }
    return corpus;
  }
  throw new Error("speed corpus: expected an object or an array of stat records");
}

// Never returns an empty corpus — it throws instead. A --corpus pointed one directory too high, or
// at a JSON file whose shape parseCorpus cannot read (name -> stats object, say), parses fine and
// yields nothing; reporting every champion as missing sends the user after the wrong problem.
// Individual entries stay forgiving: only the total is checked, so one unreadable faction file does
// not cost the rest of the corpus.
export function loadCorpus(path) {
  if (statSync(path).isDirectory()) {
    const corpus = new Map();
    for (const entry of readdirSync(path)) {
      let raw;
      try {
        raw = JSON.parse(readFileSync(`${path}/${entry}/stats.json`, "utf8"));
      } catch {
        continue;    // not every subdirectory has to hold a stats file
      }
      for (const [name, spd] of parseCorpus(raw)) corpus.set(name, spd);
    }
    if (corpus.size === 0) throw new Error(`speed corpus: no */stats.json found under ${path}`);
    return corpus;
  }
  const corpus = parseCorpus(JSON.parse(readFileSync(path, "utf8")));
  if (corpus.size === 0) throw new Error(`speed corpus: no champion speeds found in ${path}`);
  return corpus;
}

export const lookupBase = (corpus, name) => corpus.get(String(name).toLowerCase()) ?? null;
