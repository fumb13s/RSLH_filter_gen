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
// Failures inside a directory load name the file. "expected an object or an array of stat records"
// on its own leaves the user opening sixteen faction files to find the bad one.
const fileError = (file, e) =>
  new Error(`speed corpus: ${file}: ${e.message.replace(/^speed corpus: /, "")}`);

export function loadCorpus(path) {
  if (statSync(path).isDirectory()) {
    const corpus = new Map();
    for (const entry of readdirSync(path)) {
      const file = `${path}/${entry}/stats.json`;
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch (e) {
        // No stats.json here means this entry is not a faction directory — a README, a loose file,
        // a scratch dir — so it is skipped. Anything else is a stats.json that exists and cannot be
        // read, which is a broken faction, and falls through to the same loud failure as a broken
        // shape below.
        if (e.code === "ENOENT" || e.code === "ENOTDIR") continue;
        throw fileError(file, e);
      }
      // Past here the file exists, so nothing is skipped: a corpus that quietly loses a faction is
      // worse than one that refuses to load. `null` is what a scraper writes when a faction page
      // comes back empty, and dropping it would report every champion in that faction as absent.
      try {
        for (const [name, spd] of parseCorpus(JSON.parse(text))) corpus.set(name, spd);
      } catch (e) {
        throw fileError(file, e);
      }
    }
    if (corpus.size === 0) throw new Error(`speed corpus: no */stats.json found under ${path}`);
    return corpus;
  }
  const corpus = parseCorpus(JSON.parse(readFileSync(path, "utf8")));
  if (corpus.size === 0) throw new Error(`speed corpus: no champion speeds found in ${path}`);
  return corpus;
}

// The fallback key for a name the corpus does not hold verbatim. The game spells champions with
// apostrophes (ASCII and typographic), commas, colons and hyphens; a corpus that has been through a
// slug or an OCR pass often has not, and is not consistent about how — the same one can drop an
// apostrophe outright ("mashalled") and turn a hyphen into a space ("belletar mage slayer"). No
// single rewrite reconciles those, so this strips ALL of it from both sides.
export const squashName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");

// The exact lowercased key first, so a corpus that keeps its punctuation answers byte-for-byte and
// never reaches the scan below — this widens what can be FOUND without changing any answer that was
// already found. Only a miss pays for the scan, and a miss is rare by construction.
//
// A looser key can put two different champions on one key, so a collision is REFUSED rather than
// resolved: the corpus cannot say which was meant, and reporting absent sends the user to --base,
// which is where they already were. Colliding entries that agree on the speed are not a collision in
// the only respect that matters, and answering them is the point of the fallback — a corpus merged
// from several files can easily hold two spellings of one champion.
export function lookupBase(corpus, name) {
  const exact = corpus.get(String(name).toLowerCase());
  if (exact !== undefined) return exact;
  const key = squashName(name);
  // Every punctuation-only name squashes to "", and so does any such corpus key. Matching them to
  // each other would be a coincidence of shape, not a name lookup.
  if (key === "") return null;
  let found;
  for (const [candidate, spd] of corpus) {
    if (squashName(candidate) !== key) continue;
    if (found !== undefined && found !== spd) return null;
    found = spd;
  }
  return found ?? null;
}
