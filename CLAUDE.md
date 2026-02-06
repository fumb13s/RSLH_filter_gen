# RSLH Filter Generator

TypeScript monorepo for generating JSON config files. Uses npm workspaces.

## Structure

- `packages/core` — shared config generation logic (library)
- `packages/cli` — command-line interface (uses commander)
- `packages/web` — web UI hosted on GitHub Pages (uses vite)

## Commands

```bash
npm install          # install all dependencies
npm run build        # build all packages (tsc for core/cli, vite for web)
npm test             # run tests with vitest
npm run lint         # lint with eslint
npm run dev          # start vite dev server for web UI
```

## Architecture

- `core` defines config types (zod schemas) and a `generateConfig()` function
- `cli` and `web` both depend on `core` and call `generateConfig()`
- TypeScript project references link packages together
- ESLint uses flat config (`eslint.config.js`)
- Tests live in `packages/*/src/__tests__/`
