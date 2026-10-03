// Every key lin() reads. Checked up front so a typo in a logged reading fails here, naming the
// stat, rather than becoming a NaN that propagates into every number the fit returns.
const TOTAL_KEYS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"];

export function fitWeights(readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    throw new Error("power-fit: no readings");
  }
  readings.forEach((r, i) => {
    if (!Number.isFinite(r?.power) || r.power <= 0) {
      throw new Error(`power-fit: reading ${i} has power ${r?.power}`
        + " — expected a positive finite number");
    }
    for (const key of TOTAL_KEYS) {
      if (!Number.isFinite(r.totals?.[key])) {
        throw new Error(`power-fit: reading ${i} has a non-finite ${key} (${r.totals?.[key]})`);
      }
    }
  });

  const ids = [...new Set(readings.map((r) => r.baseTypeId))];
  if (ids.length > 1) {
    throw new Error(`power-fit: readings mix ${ids.length} champions (baseTypeId ${ids.join(", ")})`
      + " — weights are per champion, so fitting them together would silently average two sets;"
      + " group by baseTypeId and call once per champion");
  }
}
