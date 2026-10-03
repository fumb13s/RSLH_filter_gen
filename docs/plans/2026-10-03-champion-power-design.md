# Champion power — design

**Date:** 2026-10-03
**Status:** measured and implemented. The model is in `oracle/analytics/power-model.mjs`, the fit in
`power-fit.mjs`, the stat model in `champion-stats.mjs`, the set table in `set-bonuses.mjs`, the
solvers in `build-solve.mjs` and `power-solve.mjs`, and the CLI in `power.mjs`.

## Motivation

The game shows a champion a single **Power** number and publishes no formula for it. Deciding which
gear to put on a champion means knowing what moves that number, and by how much. The community's
per-stat "power" tables are wrong in both scale and shape (see below), so the number had to be
reverse-engineered from the game itself.

Everything here was measured on 2026-10-03 from about 50 in-game power readings across five
champions: Ultimate Deathknight, Helicath, Madame Serris, Thor Faehammer and Pelops the Victor.

## The formula

```
sqrt(power) = b*(HP/15 + ATK + DEF) + r*RES + a*ACC + s*SPD + k*C.RATE*(100 + C.DMG) + c
```

Stats are the game's Total Stats with every source included — base, gear, sets, masteries, faction
guardians, empowerment, blessing, relic, Great Hall and Classic Arena. C.RATE and C.DMG are in
percentage **points**, not fractions. `c` is a property of the **copy**; the five weights are a
property of the **champion**.

## Evidence

### The stat model

- It reproduces the game's Total Stats screen **column for column** on all five champions —
  Ultimate Deathknight, Helicath, Madame Serris, Thor Faehammer and Pelops the Victor — apart from
  ±1 on some totals, which comes from the game's own per-column rounding and is reproduced rather
  than smoothed away.
- **Lore of Steel scales every set's bonus**, not only the eight basic sets. Verified on Thor's
  Merciless, Zeal and Pinpoint. The game shows that extra under **Masteries** rather than inside the
  set bonus.
- Account-wide sources are constants: the **Great Hall is maxed** and identical for all affinities,
  and the arena league is **assumed to be Gold 5**.

### The set table

Transcribed from Gestal's set catalogue. It reproduces the game's own per-champion set bonuses for
**532 of 532** geared champions on a 2026-09-29 capture, and in doing so **corrected six
speed-table entries** that had been hand-typed.

### Power is a square

- **Two removals on one build** were non-additive in power by **3,391** — about 4% of the change —
  but additive in √power to within **0.15%**.
- **Single-stat changes** are predicted from the measured weights to about **0.1%**: a control
  removal to within **0.07%**, an SPD-range check to within **0.03%**.
- The community **"per-stat power" table was ruled out**: any non-negative linear fit needs the stat
  contributions to sum to about **111%** of power.

### One weight for HP/15, ATK and DEF

**HP/15 = ATK = DEF** to within about 1% on four champions. The ratios to ATK were **0.99–1.00**
for HP×15 and for DEF.

### The crit form

Crit enters as the product `k·C.RATE·(100 + C.DMG)`. The `k` from a pure C.RATE step and the `k`
from a pure C.DMG step agree on every champion where both were measured:

| champion | k from C.RATE | k from C.DMG |
|---|--:|--:|
| Ultimate Deathknight | 0.00124 | 0.00125 |
| Madame Serris | 0.00171 | 0.00173 and 0.00170 |
| Thor Faehammer (spare copy) | 0.00126 | 0.00124 |
| Pelops the Victor | 0.00193 | 0.00190 |

### The weights vary by champion

Which is why the built-in table is keyed per champion and the role table is only a fallback. Both
are copied here from `oracle/analytics/power-model.mjs`.

`BUILT_IN`, keyed by Gestal `baseTypeId`:

| baseTypeId | champion | roleId | b | r | a | s | k |
|---|---|--:|--:|--:|--:|--:|--:|
| 7090 | Ultimate Deathknight | 1 | 0.01936 | 0.1870 | 0.03483 | 0.0038 | 0.001245 |
| 4570 | Madame Serris | 3 | 0.01187 | 0.2644 | 0.0552 | 0.0235 | 0.00171 |
| 9170 | Thor Faehammer | 0 | 0.01237 | 0.2852 | 0.0378 | 0.0205 | 0.00125 |
| 10410 | Pelops the Victor | 2 | 0.01238 | 0.2819 | 0.02688 | 0.0056 | 0.00192 |
| 7200 | Helicath | 1 | — | — | — | 0.0079 | 0.00155 |

Helicath's row is **partial on purpose**: only SPD and crit steps were logged for that copy, so `b`,
`r` and `a` are absent rather than guessed. `weightsFor` fills them from the defaults per parameter
and still reports the source as "built-in".

`ROLE_DEFAULTS`, keyed by Gestal `roleId` (0 Attack, 1 Defense, 2 HP, 3 Support):

| roleId | role | b | r | s |
|---|---|--:|--:|--:|
| 0 | Attack | 0.0122 | 0.277 | 0.022 |
| 1 | Defense | 0.0194 | 0.187 | 0.0059 |
| 2 | HP | 0.0122 | 0.277 | 0.0056 |
| 3 | Support | 0.0122 | 0.277 | 0.022 |

`ALL_DEFAULTS` = `{ a: 0.0387, k: 0.00154 }`. `a` and `k` showed no role pattern, so there is
nothing to key them on; these are the means over the measured champions. Between them the two
tables cover all five parameters, which is what lets `weightsFor` always return five positive
weights.

**Defense sits apart from the other three roles** in `b` (about 1.58×) and `r` (about 0.66×). `a`
and `k` vary per champion.

### The per-copy constant `c`

- **Unchanged by every gear change measured.**
- **Choosing a blessing added about 4.65 √power** beyond the blessing's own stats.
- **Breaking an Instinct 4-piece showed no hidden power** from set effects.
- **Empowerment alone does not explain** the differences between copies.

## The solver

### An exact additive core

`build-solve.mjs` solves, provably optimally, any objective that is a **per-item value plus a
per-(set, count) bonus**. It is stat-agnostic: it is handed `valueOf` and `bonusAt` and knows
nothing about what they measure.

A second solver was needed because `speed-solve.mjs`'s exactness rests on every speed bonus needing
at least **two** pieces, so at most four sets can be active in nine slots and one plan can name all
of them. Newer sets pay out from a **single piece**, so a build can hold nine active sets at once —
more than any plan can name — and that argument collapses. The fix is not a bigger plan space
(nine-set plans number in the billions) but a different shape: plans still name only the sets held
at a multi-piece count, and every one-piece bonus is bought instead by a **singleton column** in the
assignment, one per set, usable once. A useful count is at least two, so a fifth named set would
need a tenth slot — which is what keeps the four-set bound true in a world that has one-piece sets.

### Linearization and iteration

`power-solve.mjs` maximizes power. Since `power = (lin + c)^2` and squaring is increasing on the
non-negative reals, ranking builds by power is ranking them by `lin`, so `c` never enters the solver
at all and a caller does not have to measure one to rank builds.

`lin` is additive over pieces and over set bonuses in every term but one:
`k * C.RATE * (100 + C.DMG)` is a **product of two build totals**, so a piece's crit value depends
on what the other eight slots hold and no per-item value can express it. Freezing C.RATE and C.DMG
at reference levels splits that term into two per-stat scalars, leaving exactly the objective
`build-solve.mjs` solves exactly. So: linearize at the gear already worn, solve exactly,
re-linearize at the answer, and repeat.

When the iteration stops because the build stopped changing, the answer is a **fixed point** of that
map — the exact optimum of the objective linearized at its own crit totals. That is **not** the
optimum of the true objective, and nothing claims it is. The iteration can also cycle between two
builds or run out of rounds; both report `converged: false`. In every case the answer is the best
build on the true objective out of every build any round produced, **plus the gear already worn as
round 0** — which is what makes it never worse than what the champion is wearing.

### The certificate

`upperBound` is a genuine upper bound on the true objective over **every** assignment of the vault,
so `gap` is a proven ceiling on how much the answer could still be improved — "within X of the
maximum", never "the maximum". It comes from **McCormick estimators** of the crit product over the
box of C.RATE and C.DMG the vault can actually reach, each of which is affine and therefore one more
exact solve. The bound is loose exactly when that box is wide — a champion whose crit can swing from
almost nothing to a fully stacked double-crit build.

An opt-in exact mode (`--exact`, a provably optimal search over the crit product) is planned as a
separate issue, for champions whose certificate gap is wide.

## Open questions

- **SPD's weight: role or SPD level?** The measurements so far fit both, with a cut-off near
  215 SPD.
- **The 0.6–1.5% residual in power between very different builds of one copy**, against about 0.1%
  for single-stat changes from one build.
- **What besides blessings makes up `c`.**
- **The per-champion spread of `a` (2×) and `k` (1.5×).**
