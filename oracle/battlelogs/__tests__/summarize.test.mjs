// oracle/battlelogs/__tests__/summarize.test.mjs
import { test, expect } from "vitest";
import { summarize } from "../lib/summarize.mjs";
import { makeHero, makeLine } from "./fixtures.mjs";

const META = { file: "20260812_232412_live.jsonl.z", account: "um1", capturedAt: "2026-08-12T23:24:12.000Z" };

test("summarize pulls identity from the first line and counters from the last", () => {
  const row = summarize([
    makeLine({ turn: 1 }),
    makeLine({ turn: 9, round: 2, playerTurns: 7, bossTurns: 2, finished: true }),
  ], META);
  expect(row.proc).toBe(123456789);
  expect(row.kindId).toBe(2);
  expect(row.regionTypeId).toBe(301);
  expect(row.stageId).toBe(3019003);
  expect(row.lines).toBe(2);
  expect(row.turns).toBe(9);
  expect(row.rounds).toBe(2);
  expect(row.playerTurns).toBe(7);
  expect(row.bossTurns).toBe(2);
  expect(row.finished).toBe(true);
  expect(row.file).toBe(META.file);
  expect(row.account).toBe("um1");
  expect(row.capturedAt).toBe(META.capturedAt);
});

test("survivors counts non-dead heroes per side on the final line", () => {
  const last = makeLine({
    finished: true,
    teams: [
      { team: 1, isPlayer: true, ownerId: 111, heroes: [makeHero(0), makeHero(1, { dead: true })] },
      { team: 2, isPlayer: false, ownerId: 222, heroes: [makeHero(2, { dead: true }), makeHero(3, { dead: true })] },
    ],
  });
  const row = summarize([makeLine(), last], META);
  expect(row.survivors).toEqual({ player: 1, enemy: 0 });
});

test("no win field is emitted — a live enemy is not necessarily a loss", () => {
  const row = summarize([makeLine(), makeLine({ finished: true })], META);
  expect(row).not.toHaveProperty("win");
});

test("hero rows keep the join keys and drop volatile per-turn state", () => {
  const row = summarize([makeLine(), makeLine({ finished: true })], META);
  const h = row.teams[0].heroes[0];
  expect(h).toEqual({ id: 0, typeId: 1000, inv: 90000, slot: 1, lvl: 60, maxHp: 100, boss: false });
});

test("a turn counter that skips values is recorded as-is", () => {
  const row = summarize([makeLine({ turn: 6 }), makeLine({ turn: 8, finished: true })], META);
  expect(row.turns).toBe(8);
});

// Auto can be toggled mid-battle, so first-vs-last is a real choice and not a detail: the row
// records how the battle was launched. Nothing else in this file would catch a switch to last.
test("isAuto records the launch state from the first line, not the final one", () => {
  const row = summarize([makeLine({ isAuto: true }), makeLine({ isAuto: false, finished: true })], META);
  expect(row.isAuto).toBe(true);
});

test("a single-line battle summarizes without special-casing", () => {
  const row = summarize([makeLine({ finished: true })], META);
  expect(row.lines).toBe(1);
  expect(row.survivors).toEqual({ player: 2, enemy: 2 });
});
