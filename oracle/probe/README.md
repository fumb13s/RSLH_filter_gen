# Oracle probe — differential testing vs Sellfile Creator (headless, no browser)

A local tool that screens our `evaluateFilter()` against **Sellfile Creator**'s gear
keep/sell engine. SFC is a third-party tool whose evaluation core is Rust→WASM running in
a Web Worker; because a Web Worker is DOM-free, we drive that worker in **plain Node** (a
tiny `self` shim + `WebAssembly`) — no Chromium, no Playwright.

`.hsf` is the source of truth. SFC is a *second*, independent reimplementation, used here
as a fast bulk screen: where the two disagree on random gear, our evaluator likely has a
bug — or SFC is layering an extra heuristic (see **Known divergence**).

## Third-party inputs are NOT committed
The scripts here are ours; the inputs/outputs they derive from Sellfile Creator are
git-ignored (see `.gitignore`). On a fresh machine you bring + regenerate them.

## Run it
1. Put `SellfileCreator.html` in `../resources/` (from your RSL Helper install,
   `…/SellFileCreator/SellfileCreator.html`; see `../resources/README.md`).
2. Extract the runnable worker + wasm (writes git-ignored files into `gen/`):
   `node oracle/probe/extract-runnable.mjs`
3. Build core: `npx tsc -b packages/core`
4. Run the diff: `node --experimental-sqlite oracle/probe/probe.mjs`
   (reads `../known-gear.db`; needs Node ≥ 22 for built-in `node:sqlite`).

## Scripts
- `probe.mjs` — the harness: decode `known-gear.db` → build BOTH our `Item` and SFC's
  artifact shape → run single-dimension `.hsf` filters through SFC's eval worker AND our
  `evaluateFilter()` → diff verdicts.
- `extract-runnable.mjs` — pull the runnable eval/parse workers + raw wasm out of
  `SellfileCreator.html`.
- `smoke.mjs` — minimal check that the eval worker boots in Node (`init-wasm` →
  `pipeline` → `pipeline:done`).
- `extract.mjs` + `extract-workers.mjs` — analysis only: strip the ~7.6 MB of inline
  assets and `js-beautify` the bundle, then pull the worker sources out for reading.

## How it talks to SFC's worker
`init-wasm` (wasm-0) → `pipeline` (payload `{hsf, recipes:[], metasets:[], safeguards,
artifacts}`) → `pipeline:done {matches}`. Per-item verdict = `matches[i].firstNonExcludedMatch`
(null → keep; `.keep === false` → sell). Each artifact must carry a `gearInspectorItem`
(`main` = main-stat variant id, `subValues` = `{variant: value}`). Decode reference
(stat `variant` formula, value scaling, slot/set/faction tables): see `../README.md`.

## Known divergence (the screen working as intended)
First run: 19–23/24 agree. The consistent disagreements are **fully-maxed Legendary artifacts**
(slots 1–6, rank 6, Legendary, lvl 16): SFC keeps them (returns no match) while our
evaluator applies the rule and sells. `.hsf` is the source of truth — SFC layers an extra
"don't auto-sell your best artifacts" protection on top of the raw rules. Adjudicate against
RSL Helper's Sell Test before changing anything on our side.
