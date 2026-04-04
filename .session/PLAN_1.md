## Chunk 1 — Foundation & repository setup

### Tasks

- [ ] Initialize pnpm monorepo with `pnpm-workspace.yaml` — three packages: `core`, `cli`, `adapters`
- [ ] Configure root `tsconfig.json` (strict, composite, path aliases) and per-package `tsconfig.json`
- [ ] Set up `tsup` in each package — dual CJS/ESM, `.cjs` for CLI binary, `.mjs` for library
- [ ] Configure `package.json` exports with conditional `import`/`require`/`types` paths
- [ ] Add `bin` entry: `"dev-session": "./dist/index.cjs"` in `cli/package.json`
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
