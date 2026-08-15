// oracle/analytics/__tests__/speed-solve.prop.test.mjs
// The solver claims a PROVABLE maximum. On instances small enough to enumerate exhaustively, that
// claim is checkable directly — so check it.
import { test, expect } from "vitest";
import fc from "fast-check";
import { buildIndex, solve, SLOTS } from "../speed-solve.mjs";
import { speedOfWith, buildSpeed } from "../speed-model.mjs";

const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 300;
const plain = speedOfWith(0, new Map());

const mkItem = (id, slot, set, speed) => ({
  id, slot, set, rank: 6, rarity: 5, level: 16, faction: 0, isAccessory: false,
  mainStat: { statId: 2, isFlat: false, value: 60 },
  substats: [{ statId: 4, isFlat: false, rolls: 0, value: speed, glyph: 0 }],
  ascStat: null, ascLevel: 0, equippedChampId: 0,
});

// Exhaustive search over every combination of one item per slot.
function bruteForce(items, base, constant) {
  const bySlot = new Map();
  for (const it of items) {
    if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
    bySlot.get(it.slot).push(it);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b);
  let best = null;
  const walk = (i, chosen) => {
    if (i === slots.length) {
      const speed = buildSpeed(base, constant, chosen, plain);
      if (best === null || speed > best) best = speed;
      return;
    }
    for (const it of bySlot.get(slots[i])) walk(i + 1, [...chosen, it]);
  };
  walk(0, []);
  return best;
}

// Sets chosen to span both mechanics: 4 and 38 are classic 2-piece stackers with different values,
// 35 is tiered with the odd 2/4/8 thresholds, 0 is setless.
const SETS = [0, 4, 38, 35];

const instance = fc.array(
  fc.record({
    slot: fc.constantFrom(...SLOTS.slice(0, 4)),
    set: fc.constantFrom(...SETS),
    speed: fc.integer({ min: 0, max: 40 }),
  }),
  { minLength: 1, maxLength: 10 },
);

test("solve returns the same maximum as exhaustive search", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), fc.integer({ min: -20, max: 60 }),
      (specs, base, constant) => {
        const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
        const index = buildIndex(items, 0, plain);
        const solved = solve(index, base, constant, plain);
        expect(solved.speed).toBe(bruteForce(items, base, constant));
      }),
    { numRuns: NUM_RUNS },
  );
});

// Two invariants that must hold on any instance, not just small ones.
test("solve is never worse than taking the fastest item in each slot", () => {
  fc.assert(
    fc.property(instance, fc.integer({ min: 50, max: 200 }), (specs, base) => {
      const items = specs.map((s, i) => mkItem(i + 1, s.slot, s.set, s.speed));
      const index = buildIndex(items, 0, plain);
      const greedy = [...index.values()].map((bySet) =>
        [...bySet.values()].reduce((b, e) => (e.speed > b.speed ? e : b)).item);
      expect(solve(index, base, 0, plain).speed)
        .toBeGreaterThanOrEqual(buildSpeed(base, 0, greedy, plain));
    }),
    { numRuns: NUM_RUNS },
  );
});
