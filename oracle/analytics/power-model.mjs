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

// --- the measured weights ----------------------------------------------------------------------

// Keyed by BASE champion id (Gestal `baseTypeId`), which every copy of a champion shares — the
// weights are a property of the champion, while the constant `c` is a property of the copy.
// `name` and `roleId` are carried for readability and for the roleId invariant in the tests;
// weightsFor reads neither. Thor's `k` was measured on an unleveled spare copy.
export const BUILT_IN = {
  7090:  { name: "Ultimate Deathknight", roleId: 1, b: 0.01936, r: 0.1870, a: 0.03483, s: 0.0038, k: 0.001245 },
  4570:  { name: "Madame Serris",        roleId: 3, b: 0.01187, r: 0.2644, a: 0.0552,  s: 0.0235, k: 0.00171 },
  9170:  { name: "Thor Faehammer",       roleId: 0, b: 0.01237, r: 0.2852, a: 0.0378,  s: 0.0205, k: 0.00125 },
  10410: { name: "Pelops the Victor",    roleId: 2, b: 0.01238, r: 0.2819, a: 0.02688, s: 0.0056, k: 0.00192 },
  // Partial ON PURPOSE: only SPD and crit steps were logged for this copy, so b, r and a are
  // ABSENT rather than guessed. weightsFor fills them from the defaults, per parameter, and still
  // reports the source as "built-in".
  7200:  { name: "Helicath",             roleId: 1, s: 0.0079, k: 0.00155 },
};

// Fallbacks for a champion with no measured row, keyed by Gestal roleId (0 Attack, 1 Defense,
// 2 HP, 3 Support). `b` and `r` are the two parameters that split by role — Defense sits apart
// from the other three — and `s` carries the role-or-SPD-level ambiguity in the open questions.
export const ROLE_DEFAULTS = {
  0: { b: 0.0122, r: 0.277, s: 0.022 },   // Attack
  1: { b: 0.0194, r: 0.187, s: 0.0059 },  // Defense
  2: { b: 0.0122, r: 0.277, s: 0.0056 },  // HP
  3: { b: 0.0122, r: 0.277, s: 0.022 },   // Support
};

// `a` and `k` showed NO role pattern, so there is nothing to key them on: these are the means over
// the measured champions. Between them these two tables cover all five parameters, which is what
// lets weightsFor always return five positive weights.
export const ALL_DEFAULTS = { a: 0.0387, k: 0.00154 };

// --- resolving one champion's weights ----------------------------------------------------------

// The five parameters in a fixed order, so `fromDefaults` reads the same way on every call.
const PARAMS = ["b", "r", "a", "s", "k"];

// A weight counts only when it is a finite number above zero. A least-squares fit returns null for
// a parameter it could not determine, and can return a zero or a negative one for a stat it barely
// saw; neither is plausible — every weight measured so far is positive — and a negative one would
// break the solvers, which need non-negative weights. Applying the same test to BUILT_IN is what
// makes a partial row like Helicath's fall through per parameter instead of yielding `undefined`.
const measured = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

// Each of the five parameters is resolved SEPARATELY down the chain, so a champion with one fitted
// weight and a partial built-in row gets the best available value for each rather than one table
// wholesale. `source` is the highest-priority table that supplied ANY parameter; `fromDefaults`
// lists the parameters that fell all the way through to a default table.
export function weightsFor({ baseTypeId, roleId }, fitted = {}) {
  // Indexed RAW, never through Number(): the roleId comes off champion data with no NOT NULL
  // guarantee, and Number(null) is 0, which would quietly grade a role-less champion as Attack.
  const role = ROLE_DEFAULTS[roleId];
  // Unconditional, even when a fitted or built-in row would supply all five. A roleId the defaults
  // do not know is bad champion data, and answering anyway hides it until the first champion that
  // actually needs the fallback arrives.
  if (!role) {
    throw new Error(`power-model: unknown roleId ${roleId}`
      + ` — ROLE_DEFAULTS knows ${Object.keys(ROLE_DEFAULTS).join(", ")}`);
  }
  // Highest priority first. The last two both report as "role default": ALL_DEFAULTS is the role
  // table's own fallback for the two parameters that showed no role pattern, not a tier a caller
  // would ever distinguish.
  const tiers = [
    { source: "fitted", table: fitted?.[baseTypeId], isDefault: false },
    { source: "built-in", table: BUILT_IN[baseTypeId], isDefault: false },
    { source: "role default", table: role, isDefault: true },
    { source: "role default", table: ALL_DEFAULTS, isDefault: true },
  ];
  const weights = {};
  const fromDefaults = [];
  // The last tier is the floor: ROLE_DEFAULTS + ALL_DEFAULTS cover all five parameters, so every
  // parameter resolves and this index can only move toward a higher-priority tier.
  let best = tiers.length - 1;
  for (const name of PARAMS) {
    for (let i = 0; i < tiers.length; i++) {
      if (!measured(tiers[i].table?.[name])) continue;
      weights[name] = tiers[i].table[name];
      if (tiers[i].isDefault) fromDefaults.push(name);
      if (i < best) best = i;
      break;
    }
  }
  return { weights, source: tiers[best].source, fromDefaults };
}
