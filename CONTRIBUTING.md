# Contributing to RSLH Filter Generator

## Prerequisites

- Node.js 22+
- npm

## Getting Started

```bash
git clone https://github.com/fumb13s/RSLH_filter_gen.git
cd RSLH_filter_gen
npm install
npm run build && npm test && npm run lint
```

All three commands should pass before you start making changes.

## Project Structure

```
packages/
  core/    — shared library: zod schemas, filter generation/parsing, ID-to-name mappings
  cli/     — command-line interface (commander): validate and stub commands
  web/     — web UI hosted on GitHub Pages (vite, vanilla HTML+JS)
data/      — sample .hsf files for testing
snippets/  — Kotlin enum sources used to derive ID mappings
scripts/   — automation scripts for RSL Helper UI testing
```

## Build Order

The monorepo uses TypeScript project references. Packages must build in order: **core -> cli -> web**. The root build script enforces this:

```bash
npm run build
```

If you hit stale-build issues after changing config files, clean first:

```bash
npm run clean && npm run build
```

## Development

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `npm run dev`    | Start vite dev server for the web UI |
| `npm test`       | Run all tests with vitest            |
| `npm run lint`   | Lint with eslint (flat config)       |
| `npm run build`  | Build all packages in order          |
| `npm run clean`  | Remove dist/ and .tsbuildinfo files  |

## Testing

Tests live in `packages/*/src/__tests__/`. There are 14 test files across `core` and `web`:

- **`*.test.ts`** — unit and integration tests
- **`*.prop.test.ts`** — property-based tests using fast-check
- **`prop-regressions.test.ts`** — regression replay from JSON counterexample files in `__tests__/`

Web tests use jsdom for DOM simulation.

To run a specific test file:

```bash
npx vitest run packages/core/src/__tests__/generator.test.ts
```

## Code Conventions

- **ESM** — all packages use `"type": "module"`
- **TypeScript strict mode** — enabled in all tsconfig files
- **Zod schemas with `.passthrough()`** — preserves unknown fields for byte-exact .hsf round-trip fidelity
- **Linting** — eslint recommended + typescript-eslint recommended (flat config)

## CI

GitHub Actions runs on every push and PR to `main`:

1. **Build** — `npm run build`
2. **Test** — `npm test`
3. **Lint** — `npm run lint`

On merge to `main`, the web UI is automatically deployed to GitHub Pages.

A separate **fuzz CI** workflow runs property-based tests at scale (10 shards, 25k iterations each) every 15 minutes to catch edge cases.

## Agentic Development

This project is developed primarily by an AI coding agent (Claude Code). PRs — whether from humans or agents — follow the same workflow. `CLAUDE.md` contains architecture context for agents.

Agents should run the full CI check locally before committing:

```bash
npm run build && npm test && npm run lint
```

## Pull Requests

1. Branch off `main`
2. Make your changes
3. Run `npm run build && npm test && npm run lint` locally
4. Push and open a PR against `main`
5. CI must pass on GitHub before merge
