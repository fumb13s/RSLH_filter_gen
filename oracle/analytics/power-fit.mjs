import { lin, power } from "./power-model.mjs";

// The design columns, in the FIXED order the factorization walks them. The order is part of the
// contract: the QR does not pivot, so which of two mutually dependent stats is kept and which is
// reported undetermined follows THIS LIST rather than whichever happened to end up with the larger
// norm. ACC sits after RES, so a champion whose ACC only ever moves with RES loses `a`, not `r`.
const COLUMNS = [
  { param: "b", of: (t) => t.HP / 15 + t.ATK + t.DEF },
  { param: "r", of: (t) => t.RES },
  { param: "a", of: (t) => t.ACC },
  { param: "s", of: (t) => t.SPD },
  { param: "k", of: (t) => t["C.RATE"] * (100 + t["C.DMG"]) },
];

// Every key lin() reads. Checked up front so a typo in a logged reading fails here, naming the
// stat, rather than becoming a NaN that propagates into every number the fit returns.
const TOTAL_KEYS = ["HP", "ATK", "DEF", "SPD", "C.RATE", "C.DMG", "RES", "ACC"];

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;
const norm2 = (xs) => Math.sqrt(sum(xs.map((x) => x * x)));

// --- Householder QR ----------------------------------------------------------------------------
// Hand-rolled because the repo has no linear algebra and this needs none beyond one reflector at a
// time. NOT solved through the normal equations: the stat columns span about 1 to 1e5, and forming
// X'X squares that conditioning.

const tailNorm = (col, p) => {
  let t = 0;
  for (let i = p; i < col.length; i++) t += col[i] * col[i];
  return Math.sqrt(t);
};

// A reflector that zeroes rows p+1.. of `col`. Rows above p are untouched, so applying the kept
// columns' reflectors in order builds R one column at a time.
function reflector(col, p) {
  const tail = tailNorm(col, p);
  // -sign(col[p]) keeps v[p] away from zero; the other sign subtracts two nearly equal numbers.
  const alpha = (col[p] >= 0 ? -1 : 1) * tail;
  const v = new Array(col.length).fill(0);
  for (let i = p; i < col.length; i++) v[i] = col[i];
  v[p] -= alpha;
  let vtv = 0;
  for (let i = p; i < v.length; i++) vtv += v[i] * v[i];
  return { p, v, vtv };
}

function reflect(h, vec) {
  if (h.vtv === 0) return;   // unreachable: a kept column's tail is nonzero, so v[p] != 0
  let dot = 0;
  for (let i = h.p; i < h.v.length; i++) dot += h.v[i] * vec[i];
  const f = (2 * dot) / h.vtv;
  for (let i = h.p; i < h.v.length; i++) vec[i] -= f * h.v[i];
}

// Unpivoted QR over `cols` (each already unit 2-norm), left to right. `kept` holds the positions
// that survived; `R[kept[q]]` is that column after every earlier reflection, so its entry at row q
// is the diagonal.
function factorize(cols) {
  const R = cols.map((c) => c.slice());
  const reflectors = [];
  const kept = [];
  for (let j = 0; j < cols.length; j++) {
    for (const h of reflectors) reflect(h, R[j]);
    const p = kept.length;
    const h = reflector(R[j], p);
    reflect(h, R[j]);
    reflectors.push(h);
    kept.push(j);
  }
  return { R, reflectors, kept };
}

// Q' applied to the right-hand side, then back-substitution over the kept columns.
function solve({ R, reflectors, kept }, rhs) {
  const b = rhs.slice();
  for (const h of reflectors) reflect(h, b);
  const out = new Array(kept.length).fill(0);
  for (let i = kept.length - 1; i >= 0; i--) {
    let acc = b[i];
    for (let j = i + 1; j < kept.length; j++) acc -= R[kept[j]][i] * out[j];
    out[i] = acc / R[kept[i]][i];
  }
  return out;
}

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

  const y = readings.map((r) => Math.sqrt(r.power));
  const x = COLUMNS.map((col) => readings.map((r) => col.of(r.totals)));

  // Step 1: the copy constants, removed EXACTLY. Centering y and every column within each copy
  // leaves a system the constants cannot appear in, so no constant is ever dropped or flagged —
  // they come back at step 6 from the fitted weights.
  const copies = new Map();
  readings.forEach((r, i) => {
    if (!copies.has(r.heroId)) copies.set(r.heroId, []);
    copies.get(r.heroId).push(i);
  });
  const cy = y.slice();
  const cx = x.map((col) => col.slice());
  for (const rows of copies.values()) {
    const my = mean(rows.map((i) => y[i]));
    for (const i of rows) cy[i] = y[i] - my;
    for (let j = 0; j < COLUMNS.length; j++) {
      const m = mean(rows.map((i) => x[j][i]));
      for (const i of rows) cx[j][i] = x[j][i] - m;
    }
  }

  const scale = cx.map((col) => norm2(col));
  const varying = [...COLUMNS.keys()];

  // Step 4: the factorization, over the varying columns scaled to unit 2-norm.
  const fac = factorize(varying.map((j) => cx[j].map((v) => v / scale[j])));
  const gamma = solve(fac, cy);

  const params = { b: null, r: null, a: null, s: null, k: null };
  fac.kept.forEach((q, i) => {
    const j = varying[q];
    params[COLUMNS[j].param] = gamma[i] / scale[j];
  });
  const undetermined = [];

  // Step 6: each copy's constant is the mean, over its readings, of sqrt(power) - lin(totals, w).
  const constants = new Map();
  for (const [heroId, rows] of copies) {
    constants.set(heroId, mean(rows.map((i) => y[i] - lin(readings[i].totals, params))));
  }

  // In input order, so a caller can line a residual up with the reading it came from.
  const residuals = readings.map((r) => {
    const predicted = power(r.totals, params, constants.get(r.heroId));
    return { heroId: r.heroId, t: r.t, power: r.power, predicted,
      errorPct: ((predicted - r.power) / r.power) * 100 };
  });

  return { params, constants, undetermined, residuals };
}
