// oracle/battlelogs/__tests__/fixtures.mjs
// Synthetic battle-log builders. NEVER use a captured log as a fixture — this repo is public and
// real logs carry ownerId and champion instance ids.
import { deflateSync } from "node:zlib";

export function makeHero(id, over = {}) {
  return {
    id, typeId: 1000 + id, inv: 90000 + id, slot: id + 1, lvl: 60,
    turns: 0, hp: 100, maxHp: 100, dmgTaken: 0, stamina: 0,
    active: false, dead: false, boss: false, skipNext: false,
    flags: [], buffs: [], debuffs: [], skills: [], ...over,
  };
}

export function makeLine(over = {}) {
  return {
    type: "battleLiveState", proc: 123456789, kindId: 2, regionTypeId: 301, stageId: 3019003,
    hasStats: false, pushKind: "turn", turnsApplied: 1, turn: 1, round: 1,
    isAuto: true, finished: false, extraTurn: false,
    playerTurns: 0, playerAutoTurns: 0, bossTurns: 0, activeHeroId: 0,
    events: [], eventsTruncated: false,
    teams: [
      { team: 1, isPlayer: true, ownerId: 111, heroes: [makeHero(0), makeHero(1)] },
      { team: 2, isPlayer: false, ownerId: 222, heroes: [makeHero(2), makeHero(3)] },
    ],
    ...over,
  };
}

// JSONL text with the trailing newline RSL Helper writes.
export const makeBattleText = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

// deflateSync emits zlib-wrapped output (magic 78 9c), matching what RSL Helper writes.
export const makeBattleBytes = (lines) => deflateSync(Buffer.from(makeBattleText(lines), "utf8"));
