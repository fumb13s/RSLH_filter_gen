# 001-stored-format-versioning Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-09-29

## Active Technologies

- TypeScript 5.x, ESM (`"type": "module"`), npm workspaces + zod 3 (`^3.24.0`, locked 3.25.76; newly a direct dependency of `packages/web`), vite 6, `@rslh/core` id tables (001-stored-format-versioning)

## Project Structure

```text
packages/core/src/          # id tables (read only for this feature)
packages/web/src/           # versioned.ts, quick-state-format.ts, fmbl-format.ts + edited modules
packages/web/src/__tests__/ # vitest suites
```

## Commands

npm run build && npm test && npm run lint

## Code Style

TypeScript 5.x, ESM (`"type": "module"`), npm workspaces: Follow standard conventions

## Recent Changes

- 001-stored-format-versioning: Added TypeScript 5.x, ESM (`"type": "module"`), npm workspaces + zod 3 (`^3.24.0`, locked 3.25.76; newly a direct dependency of `packages/web`), vite 6, `@rslh/core` id tables

<!-- MANUAL ADDITIONS START -->
- The real layout is the npm-workspaces monorepo shown under Project Structure. If a regenerated tree above says `backend/`, `frontend/` or `tests/`, ignore it; see plan.md, "Project Structure".
- Pre-commit gate: `npm run build && npm test && npm run lint`. Type check the web package with `npx tsc -p packages/web/tsconfig.json --noEmit` after `npm run build`.
<!-- MANUAL ADDITIONS END -->
