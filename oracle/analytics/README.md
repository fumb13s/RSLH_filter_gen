# Gear Vault Analytics

Decodes `../resources/RSLHelper.db` and produces a keep/delete/focus triage report.
Design + rationale: `DESIGN.md`. Advisory only — never deletes anything.

## Run
1. Build core: `npx tsc -b packages/core`
2. `node --experimental-sqlite oracle/analytics/analyze.mjs [path-to.db]`
   (defaults to `../resources/RSLHelper.db`; writes `out/report.json` + `out/report.md`)

## Test
Folded into the repo suite — `npm test` (or just analytics: `npx vitest run oracle/analytics`).

`out/` and `findings/` are gitignored (derive from personal account data).
