// oracle/analytics/__tests__/speed-cli.test.mjs
import { test, expect } from "vitest";
import fc from "fast-check";
import { describeSets, formatBuild, parseSpeedArgs, rankBuilds, topBuilds } from "../speed.mjs";
import { SLOTS, buildIndex, solve } from "../speed-solve.mjs";
import { buildSpeed, speedOfWith } from "../speed-model.mjs";

// --- parseSpeedArgs ---------------------------------------------------------

test("parseSpeedArgs keeps the champion selector and snapshot conventions", () => {
  const a = parseSpeedArgs(["Kantra", "oracle/resources/x.db"]);
  expect(a.selector).toBe("Kantra");
  expect(a.dbArg).toBe("oracle/resources/x.db");
});

// The two positionals are not ordered, same as champion-gear.mjs: whichever looks like a path is the
// snapshot however it was typed.
test("parseSpeedArgs takes the positionals in either order", () => {
  const a = parseSpeedArgs(["oracle/resources/x.db", "Kantra"]);
  expect(a.selector).toBe("Kantra");
  expect(a.dbArg).toBe("oracle/resources/x.db");
});

test("parseSpeedArgs reads the numeric options", () => {
  const a = parseSpeedArgs(["Kantra", "--glyph", "8", "--base", "109", "--constant", "10", "--top", "3"]);
  expect(a).toMatchObject({ selector: "Kantra", glyph: 8, base: 109, constant: 10, top: 3 });
});

test("parseSpeedArgs defaults glyph to 0, top to 1, and leaves overrides null", () => {
  const a = parseSpeedArgs(["Kantra"]);
  expect(a).toMatchObject({ glyph: 0, top: 1, base: null, constant: null });
});

// Option values must never be mistaken for the champion selector.
test("parseSpeedArgs does not treat an option value as the selector", () => {
  expect(parseSpeedArgs(["--glyph", "8", "Kantra"]).selector).toBe("Kantra");
  expect(parseSpeedArgs(["--base", "109"]).selector).toBe(null);
});

// A corpus path holds separators, so leaking it into the positionals would silently make it the
// snapshot path and read the champion table out of a JSON file.
test("parseSpeedArgs consumes the --corpus value rather than reading it as a path positional", () => {
  const a = parseSpeedArgs(["--corpus", "/data/speeds", "Kantra", "x/y.db"]);
  expect(a).toMatchObject({ corpus: "/data/speeds", selector: "Kantra", dbArg: "x/y.db" });
});

test("parseSpeedArgs falls back to $RSLH_SPEED_CORPUS and lets --corpus win", () => {
  const saved = process.env.RSLH_SPEED_CORPUS;
  try {
    process.env.RSLH_SPEED_CORPUS = "/from/env";
    expect(parseSpeedArgs(["Kantra"]).corpus).toBe("/from/env");
    expect(parseSpeedArgs(["Kantra", "--corpus", "/from/flag"]).corpus).toBe("/from/flag");
    delete process.env.RSLH_SPEED_CORPUS;
    expect(parseSpeedArgs(["Kantra"]).corpus).toBe(null);
  } finally {
    if (saved === undefined) delete process.env.RSLH_SPEED_CORPUS;
    else process.env.RSLH_SPEED_CORPUS = saved;
  }
});

test("parseSpeedArgs recognises the verify subcommand", () => {
  expect(parseSpeedArgs(["verify"]).verify).toBe(true);
  expect(parseSpeedArgs(["Kantra"]).verify).toBe(false);
});

// `verify` is the subcommand, never also a champion name, and it takes the same snapshot positional.
test("parseSpeedArgs does not leave verify behind as a selector", () => {
  expect(parseSpeedArgs(["verify"]).selector).toBe(null);
  expect(parseSpeedArgs(["verify", "x/y.db"])).toMatchObject({
    verify: true, selector: null, dbArg: "x/y.db",
  });
});

test("parseSpeedArgs rejects a non-numeric option value", () => {
  expect(() => parseSpeedArgs(["Kantra", "--glyph", "lots"])).toThrow(/--glyph/);
  expect(() => parseSpeedArgs(["Kantra", "--top", "all"])).toThrow(/--top/);
});

// Number("") and Number(" ") are both 0, so an empty value would silently parse as a legal option
// rather than as the typo it is. A missing value is Number(undefined) -> NaN.
test("parseSpeedArgs rejects an empty or missing option value", () => {
  expect(() => parseSpeedArgs(["Kantra", "--glyph", ""])).toThrow(/--glyph/);
  expect(() => parseSpeedArgs(["Kantra", "--base", "  "])).toThrow(/--base/);
  expect(() => parseSpeedArgs(["Kantra", "--constant"])).toThrow(/--constant/);
});

// Same rule as champion-gear.mjs: an empty arg is no arg, because an empty selector matches the whole
// roster by substring.
test("parseSpeedArgs drops empty positional arguments", () => {
  expect(parseSpeedArgs([""])).toMatchObject({ selector: null, dbArg: undefined });
});

// A mistyped flag taken as a positional is the worst outcome available: `--glpyh 8` loses the option
// value race, runs an un-lifted solve, exits 0, and prints nothing to say the glyph lift was dropped.
// A plausible wrong answer beats a crash for damage done.
test("parseSpeedArgs rejects an unknown option instead of taking it as a positional", () => {
  expect(() => parseSpeedArgs(["Kantra", "--glpyh", "8"])).toThrow(/--glpyh/);
  expect(() => parseSpeedArgs(["--corpsu", "/data/speeds"])).toThrow(/unknown option/);
  expect(() => parseSpeedArgs(["verify", "--baze", "9"])).toThrow(/--baze/);
});

// --- describeSets -----------------------------------------------------------

test("describeSets names only the sets that actually paid out, biggest first", () => {
  // Speed x6 = three 2-piece completions at 12% of 100; Perception x2 = one at 5%. Instinct needs
  // four pieces, and set 12 (Cursed) grants no speed at all.
  const counts = new Map([[4, 6], [12, 3], [38, 2], [50, 2]]);
  expect(describeSets(counts, 100)).toBe("Speed x6 (+36) · Perception x2 (+5)");
});

test("describeSets says so when nothing paid out", () => {
  expect(describeSets(new Map([[4, 1], [12, 9]]), 100)).toBe("no speed sets");
  expect(describeSets(new Map(), 100)).toBe("no speed sets");
});

// The percentage is floored against base per completion, so the printed gain has to be computed at
// the champion's own base rather than carried as a percentage.
test("describeSets floors each completion against the champion's base", () => {
  expect(describeSets(new Map([[38, 2]]), 99)).toBe("Perception x2 (+4)");   // floor(99 * 5 / 100)
  expect(describeSets(new Map([[38, 2]]), 100)).toBe("Perception x2 (+5)");
});

// --- formatBuild ------------------------------------------------------------

const item = (o = {}) => ({
  id: 1, slot: 1, set: 4, rank: 6, rarity: 4, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 1, isFlat: true, value: 0 },
  substats: [], ascStat: null, ...o,
});
const spdSub = (value, glyph = 0) => ({ statId: 4, isFlat: true, rolls: 0, value, glyph });

// Deliberately out of slot order, and one setless piece.
const BOOTS = item({ id: 7, slot: 4, set: 4, level: 16, substats: [spdSub(20, 3)] });
const HELM = item({ id: 3, slot: 1, set: 4, level: 12, mainStat: { statId: 4, isFlat: true, value: 30 } });
const WEAPON = item({ id: 5, slot: 5, set: 0, level: 8, rarity: 3, rank: 5, substats: [spdSub(7, 0)] });
const BUILD = { items: [BOOTS, HELM, WEAPON], counts: new Map([[4, 2]]), plan: [] };

test("formatBuild prints the build slot by slot with the arithmetic that produced it", () => {
  // items 23 + 30 + 7 = 60; Speed x2 at base 100 = +12; 100 + 12 + 60 + 5 = 177.
  const out = formatBuild({ ...BUILD, speed: 177 }, 100, 5, 0, new Map());
  expect(out.split("\n")).toEqual([
    "  177 SPD   Speed x2 (+12)",
    "    Helmet  Speed          +12   spd  30   #3",
    "    Boots   Speed          +16   spd  23   #7",
    "    Weapon  (setless)      + 8   spd   7   #5",
    "    base 100 + sets 12 + items 60 + constant 5 = 177",
  ]);
});

// The glyph floor has to reach the per-item speeds AND stay under each rarity x rank ceiling, or the
// printed arithmetic stops matching the total the solver actually maximised.
test("formatBuild applies the glyph floor to each item, clamped to its rarity x rank ceiling", () => {
  const ceilings = new Map([["4|6", 6], ["3|5", 10]]);
  // Boots clamp 8 -> 6, so 20 + 6 = 26 (not 28); Weapon's ceiling is not binding, 7 + 8 = 15.
  const out = formatBuild({ ...BUILD, speed: 188 }, 100, 5, 8, ceilings);
  expect(out.split("\n")).toEqual([
    "  188 SPD   Speed x2 (+12)",
    "    Helmet  Speed          +12   spd  30   #3",
    "    Boots   Speed          +16   spd  26   #7",
    "    Weapon  (setless)      + 8   spd  15   #5",
    "    base 100 + sets 12 + items 71 + constant 5 = 188",
  ]);
});

// The audit line has to be able to FAIL. Every term is computed independently — `sets` from the
// build's own counts rather than as the remainder — so when they stop adding up to the speed the
// solver reported, the line says so instead of absorbing the difference into the set term and
// balancing anyway. Here the four terms make 177 against a solver total of 200.
test("formatBuild reconciles against the solver's total and flags a disagreement", () => {
  const out = formatBuild({ ...BUILD, speed: 200 }, 100, 5, 0, new Map());
  expect(out).toContain("base 100 + sets 12 + items 60 + constant 5 = 177");
  expect(out).toContain("MISMATCH: the solver said 200");
  // The header is computed from the same counts, so the two lines can no longer disagree with each
  // other while both looking right.
  expect(out.split("\n")[0]).toContain("Speed x2 (+12)");
});

test("formatBuild stays quiet when the terms reconcile", () => {
  expect(formatBuild({ ...BUILD, speed: 177 }, 100, 5, 0, new Map())).not.toContain("MISMATCH");
  expect(formatBuild({ ...BUILD, speed: 188 }, 100, 5, 8,
    new Map([["4|6", 6], ["3|5", 10]]))).not.toContain("MISMATCH");
});

test("formatBuild handles a negative constant without losing the sign", () => {
  const out = formatBuild({ ...BUILD, speed: 165 }, 100, -7, 0, new Map());
  expect(out).toContain("base 100 + sets 12 + items 60 + constant -7 = 165");
});

// --- topBuilds / rankBuilds -------------------------------------------------

const plain = speedOfWith(0, new Map());
const mkItem = (id, slot, set, speed) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 1, isFlat: true, value: 0 },
  substats: [{ statId: 4, isFlat: true, rolls: 0, value: speed, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
});
const indexOf = (items) => buildIndex(items, 0, plain);

// A genuine set-versus-flat trade-off: the two Speed pieces are 4 slower each than the setless
// alternatives in their slots, and Speed x2 at base 100 pays +12 for that 8.
const TRADEOFF = indexOf([
  mkItem(1, 1, 4, 5), mkItem(2, 1, 0, 9),
  mkItem(3, 2, 4, 5), mkItem(4, 2, 0, 9),
  mkItem(5, 3, 0, 10), mkItem(6, 4, 0, 10), mkItem(7, 5, 0, 10), mkItem(8, 6, 0, 10),
]);

test("topBuilds ranks every distinct build best-first", () => {
  // 100 + Speed x2 (+12) + (5+5+10+10+10+10) = 162, against 100 + 0 + (9+9+40) = 158 for the
  // all-setless build.
  expect(topBuilds(TRADEOFF, 100, 0, plain, 5).map((b) => b.speed)).toEqual([162, 158]);
  expect(topBuilds(TRADEOFF, 100, 0, plain, 1).map((b) => b.speed)).toEqual([162]);
});

// --top 0 is a typo, not a request for nothing.
test("topBuilds always returns at least the winner", () => {
  expect(topBuilds(TRADEOFF, 100, 0, plain, 0).map((b) => b.speed)).toEqual([162]);
  expect(topBuilds(TRADEOFF, 100, 0, plain, -3).map((b) => b.speed)).toEqual([162]);
});

test("topBuilds agrees with solve on the winner, items and all", () => {
  const best = solve(TRADEOFF, 100, 7, plain);
  const [top] = topBuilds(TRADEOFF, 100, 7, plain, 4);
  expect(top.speed).toBe(best.speed);
  expect(top.items.map((it) => it.id).sort()).toEqual(best.items.map((it) => it.id).sort());
});

// Two plans can reach the same nine items — here the empty plan's free picks complete Speed by
// accident, which is also what proves the empty plan is rescored on what it actually holds rather
// than on the (empty) set list it named.
//
// Which of the two survives is not arbitrary. The first one reached wins, so the build is reported
// under the empty plan — the honest description, since nothing here chose those pieces for Speed.
test("topBuilds does not list the same items twice under two different plans", () => {
  const index = indexOf([
    mkItem(1, 1, 4, 20), mkItem(2, 2, 4, 20),
    mkItem(3, 3, 0, 10), mkItem(4, 4, 0, 10), mkItem(5, 5, 0, 10), mkItem(6, 6, 0, 10),
  ]);
  const ranked = topBuilds(index, 100, 0, plain, 5);
  expect(ranked.map((b) => b.speed)).toEqual([192]);
  expect(ranked[0].plan).toEqual([]);
});

// An index with nothing in it is not a build of zero items worth base + constant.
test("topBuilds and rankBuilds return nothing for an empty index", () => {
  expect(topBuilds(new Map(), 100, 7, plain, 3)).toEqual([]);
  expect(rankBuilds(new Map(), 100, 7, plain, 3)).toEqual([]);
  expect(rankBuilds(new Map(), 100, 7, plain, 1)).toEqual([]);
});

test("rankBuilds returns one build by default and N when asked", () => {
  expect(rankBuilds(TRADEOFF, 100, 0, plain, 1).map((b) => b.speed)).toEqual([162]);
  expect(rankBuilds(TRADEOFF, 100, 0, plain, 5).map((b) => b.speed)).toEqual([162, 158]);
});

// --- topBuilds property -----------------------------------------------------
// solve() is the reviewed, brute-force-verified maximum. topBuilds drops its branch-and-bound to keep
// the runners-up, so the claim that has to hold on every instance is that dropping it changed only
// what comes AFTER the winner.
//
// The winner's *speed* is what is compared, not its `plan`. solve's bound is computed from the sets a
// plan NAMES, so it can skip a plan whose free picks complete an extra set by accident and record a
// later plan naming that set instead — a tie on speed reached under two different descriptions. What
// is checked instead, on every entry rather than only the winner, is that the items listed actually
// add up to the speed reported for them.

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const instance = fc.array(
  fc.record({
    slot: fc.constantFrom(...SLOTS.slice(0, 4)),
    set: fc.constantFrom(0, 4, 38, 35),
    speed: fc.integer({ min: 0, max: 40 }),
  }),
  { minLength: 1, maxLength: 10 },
);

test("topBuilds' winner is solve's winner, and the rest descend from it without repeating", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), fc.integer({ min: -20, max: 60 }),
      (specs, base, constant) => {
        const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
        const index = buildIndex(items, 0, plain);
        const ranked = topBuilds(index, base, constant, plain, 4);
        const best = solve(index, base, constant, plain);
        expect(ranked[0].speed).toBe(best.speed);
        for (let i = 0; i < ranked.length; i++) {
          expect(buildSpeed(base, constant, ranked[i].items, plain)).toBe(ranked[i].speed);
          // The printer's independent reconciliation must agree with the solver on every build it
          // is ever handed, which is what makes its MISMATCH marker meaningful when it does fire.
          expect(formatBuild(ranked[i], base, constant, 0, new Map())).not.toContain("MISMATCH");
          if (i > 0) expect(ranked[i].speed).toBeLessThanOrEqual(ranked[i - 1].speed);
        }
        const keys = ranked.map((b) => b.items.map((it) => it.id).sort((x, y) => x - y).join(","));
        expect(new Set(keys).size).toBe(keys.length);
      }),
    { numRuns: NUM_RUNS },
  );
});
