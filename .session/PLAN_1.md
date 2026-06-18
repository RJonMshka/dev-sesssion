---
chunk_id: 1
title: "Foundation & repository setup"
depends_on: []
tasks:
  - text: "Initialize pnpm monorepo with `pnpm-workspace.yaml` — three packages: `core`, `cli`, `adapters`"
    status: todo
  - text: "Configure root `tsconfig.json` (strict, composite, path aliases) and per-package `tsconfig.json`"
    status: todo
  - text: "Set up `tsup` in each package — dual CJS/ESM, `.cjs` for CLI binary, `.mjs` for library"
    status: todo
  - text: "Configure `package.json` exports with conditional `import`/`require`/`types` paths"
    status: todo
  - text: "Add `bin` entry: `\"dev-sesssion\": \"./dist/index.cjs\"` in `cli/package.json`"
    status: todo
  - text: "Set up Biome v2 — `biome.json` at root, shared across all packages"
    status: todo
  - text: "Configure vitest — `vitest.config.ts` with three projects: `unit`, `integration`, `e2e`"
    status: todo
  - text: "Add `.npmrc`: `ignore-scripts=true`, `audit=true`, `save-exact=true`"
    status: todo
  - text: "Set up GitHub Actions CI: typecheck → lint → audit → test → build (on every push and PR)"
    status: todo
  - text: "Set up semantic-release with conventional commits for automated versioning"
    status: todo
  - text: "Write root `SECURITY.md` with vulnerability disclosure policy"
    status: todo
  - text: "Set `\"license\": \"UNLICENSED\"`, `\"private\": true` in all `package.json` files"
    status: todo
  - text: "Run `publint` and `@arethetypeswrong/cli` as part of CI build step"
    status: todo
  - text: "Write `CONTRIBUTING.md` — commit conventions, branch strategy, PR checklist"
    status: todo
  - text: "Dogfood: write `.session/` directory for this repo using the manual protocol"
    status: todo
---

## Chunk 1 — Foundation & repository setup

### Tasks

- [ ] Initialize pnpm monorepo with `pnpm-workspace.yaml` — three packages: `core`, `cli`, `adapters`
- [ ] Configure root `tsconfig.json` (strict, composite, path aliases) and per-package `tsconfig.json`
- [ ] Set up `tsup` in each package — dual CJS/ESM, `.cjs` for CLI binary, `.mjs` for library
- [ ] Configure `package.json` exports with conditional `import`/`require`/`types` paths
- [ ] Add `bin` entry: `"dev-sesssion": "./dist/index.cjs"` in `cli/package.json`
- [ ] Set up Biome v2 — `biome.json` at root, shared across all packages
- [ ] Configure vitest — `vitest.config.ts` with three projects: `unit`, `integration`, `e2e`
- [ ] Add `.npmrc`: `ignore-scripts=true`, `audit=true`, `save-exact=true`
- [ ] Set up GitHub Actions CI: typecheck → lint → audit → test → build (on every push and PR)
- [ ] Set up semantic-release with conventional commits for automated versioning
- [ ] Write root `SECURITY.md` with vulnerability disclosure policy
- [ ] Set `"license": "UNLICENSED"`, `"private": true` in all `package.json` files
- [ ] Run `publint` and `@arethetypeswrong/cli` as part of CI build step
- [ ] Write `CONTRIBUTING.md` — commit conventions, branch strategy, PR checklist
- [ ] Dogfood: write `.session/` directory for this repo using the manual protocol
