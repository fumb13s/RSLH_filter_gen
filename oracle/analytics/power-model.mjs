// The linear part — everything the formula explains from stat totals. `totals` is a plain object
// keyed HP, ATK, DEF, SPD, "C.RATE", "C.DMG", RES, ACC, the same keys the stat model will export as
// STATS; nothing here imports it, so a hand-built object serves as well as a measured one.
export function lin(totals, w) {
  return w.b * (totals.HP / 15 + totals.ATK + totals.DEF)
    + w.r * totals.RES
    + w.a * totals.ACC
    + w.s * totals.SPD
    + w.k * totals["C.RATE"] * (100 + totals["C.DMG"]);
}
