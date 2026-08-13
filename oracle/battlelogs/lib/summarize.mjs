// oracle/battlelogs/lib/summarize.mjs
// Decoded battle -> one index row. A pure function of its inputs: no I/O and no capture-time state
// beyond the meta the caller passes, so the whole index can be rebuilt by replaying this over the
// archive when the row shape changes. Imported by lib/capture.mjs, which pairs each row with the
// bytes it archived; the decode itself lives in lib/codec.mjs.
// Row shape reference: docs/plans/2026-08-12-battle-log-capture-design.md ("Index row")

// Keep the join keys (inv -> Champs.ID, typeId) and the identity fields; drop per-turn state, which
// belongs to the battle body rather than to an index.
const heroRow = (h) => ({
  id: h.id, typeId: h.typeId, inv: h.inv, slot: h.slot, lvl: h.lvl, maxHp: h.maxHp, boss: !!h.boss,
});

export function summarize(lines, { file, account, capturedAt }) {
  const first = lines[0];
  const last = lines[lines.length - 1];

  let player = 0;
  let enemy = 0;
  for (const t of last.teams) {
    const alive = t.heroes.filter((h) => !h.dead).length;
    if (t.isPlayer) player += alive;
    else enemy += alive;
  }

  return {
    file, account, capturedAt,
    proc: first.proc,
    kindId: first.kindId,
    regionTypeId: first.regionTypeId,
    stageId: first.stageId,
    isAuto: !!first.isAuto,
    lines: lines.length,
    turns: last.turn,
    rounds: last.round,
    playerTurns: last.playerTurns,
    bossTurns: last.bossTurns,
    finished: !!last.finished,
    teams: last.teams.map((t) => ({
      team: t.team, isPlayer: !!t.isPlayer, ownerId: t.ownerId, heroes: t.heroes.map(heroRow),
    })),
    // Facts, not a verdict. Boss content ends with the boss alive, so "enemy team wiped" would
    // score every such run a loss. A win rule is per-content-type and comes after identification.
    survivors: { player, enemy },
  };
}
