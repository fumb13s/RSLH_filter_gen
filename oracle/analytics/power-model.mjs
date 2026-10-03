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

// Power is the SQUARE of the linear part plus the copy's constant. Fitting in power rather than
// sqrt(power) is the mistake this shape exists to avoid: removing two gear pieces is additive in
// sqrt(power) to within 0.15%, and 4% off in power.
export const power = (totals, w, c) => (lin(totals, w) + c) ** 2;

// The copy constant from a SINGLE reading: whatever the stats do not explain. Left signed and never
// clamped at 0 — a disagreement between the weights and the reading has to stay visible rather than
// be absorbed into a floor. (measureConstant in speed-model.mjs is the same idea for speed.)
export const constantFrom = (totals, w, observedPower) => Math.sqrt(observedPower) - lin(totals, w);
