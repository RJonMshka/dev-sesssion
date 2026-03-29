---
version: 1
last_updated: "2026-03-29"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |
| docs/PLAN.md | Full project plan |
| .session/SESSION_STATE.md | Active chunk + task tracking |

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| package.json | Root monorepo config |
| pnpm-workspace.yaml | Workspace definition |
| tsconfig.json | Root TypeScript config |
| biome.json | Linter/formatter config |
| vitest.config.ts | Test runner config |
| .npmrc | npm/pnpm settings |
| .nvmrc | Node version |
| .github/workflows/ci.yml | CI pipeline |
| SECURITY.md | Security policy |
| CONTRIBUTING.md | Contributor guide |
| packages/security/package.json | Security package manifest |
| packages/security/tsconfig.json | Security TypeScript config |
| packages/security/tsup.config.ts | Security build config |
| packages/security/src/index.ts | Security entry point |
| packages/core/package.json | Core package manifest |
| packages/core/tsconfig.json | Core TypeScript config |
| packages/core/tsup.config.ts | Core build config |
| packages/core/src/index.ts | Core entry point |
| packages/cli/package.json | CLI package manifest |
| packages/cli/tsconfig.json | CLI TypeScript config |
| packages/cli/tsup.config.ts | CLI build config |
| packages/cli/src/index.ts | CLI entry point |
| packages/adapters/package.json | Adapters package manifest |
| packages/adapters/tsconfig.json | Adapters TypeScript config |
| packages/adapters/tsup.config.ts | Adapters build config |
| packages/adapters/src/index.ts | Adapters entry point |

## Chunk 2 — Security utilities

| File | Purpose |
|---|---|
| packages/security/src/index.ts | Security exports |
| packages/security/src/__tests__/ | Security adversarial tests |
