# RSLH Filter Generator

TypeScript monorepo for generating .hsf artifact filter files. Uses npm workspaces.

## Structure

- `packages/core` — shared library: zod schemas, filter generation/parsing, ID-to-name mappings
- `packages/cli` — command-line interface (uses commander): `validate` and `stub` commands
- `packages/web` — web UI hosted on GitHub Pages (uses vite)
- `data/` — sample .hsf files for testing
- `snippets/` — Kotlin enum sources for ID mappings

## Commands

```bash
npm install          # install all dependencies
npm run build        # build all packages (tsc for core/cli, vite for web)
npm test             # run tests with vitest
npm run lint         # lint with eslint
npm run dev          # start vite dev server for web UI
```

## Core API

- `parseFilter(json)` — parse .hsf JSON (handles BOM) into validated `HsfFilter`
- `serializeFilter(filter)` — compact JSON matching game client output
- `generateFilter(rules)` — validate and wrap rules into `HsfFilter`
- `defaultRule(overrides?)` / `emptySubstat()` — factory helpers
- `lookupName(map, id)` / `describeRarity(value)` — human-readable labels

## Architecture

- `core` defines .hsf types (zod schemas with `.passthrough()`) and filter functions
- `cli` and `web` both depend on `core`
- TypeScript project references link packages together
- ESLint uses flat config (`eslint.config.js`)
- Tests live in `packages/*/src/__tests__/`

## Services

- **Analytics dashboard:** https://rslh-filter-gen.goatcounter.com/ (GoatCounter, privacy-friendly, no cookies)
