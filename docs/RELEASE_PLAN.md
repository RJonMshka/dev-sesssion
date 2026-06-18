# Release Plan — `dev-sesssion`

> Package name is **`dev-sesssion`** (three `s`). The npm package, the GitHub
> repo, the `bin` command, and all docs now use this spelling. The internal
> workspace scope `@dev-session/*` (two `s`) is private/bundled and intentionally
> left unchanged — it never ships.

Releases are automated by **semantic-release** (`.releaserc.json`). You do not
bump versions or publish by hand; merging Conventional Commits to `main` drives
everything.

## Pipeline (how a release actually happens)

1. Push / merge to `main`.
2. `.github/workflows/ci.yml` runs: typecheck → lint → `npm audit` → gitleaks →
   build → `pnpm test:coverage` → publint.
3. On CI success, `.github/workflows/release.yml` runs `npx semantic-release`,
   which:
   - analyzes commits since the last tag (`feat` → minor, `fix`/`perf` → patch,
     `BREAKING CHANGE` → major),
   - updates `CHANGELOG.md` and `packages/cli/package.json` version,
   - publishes **`dev-sesssion`** to npm (`@semantic-release/npm`, `pkgRoot:
     packages/cli`),
   - creates the GitHub release + `v${version}` tag,
   - commits `chore(release): … [skip ci]`.

Required repo secrets: `NPM_TOKEN`, `RELEASE_TOKEN`.

## Pre-release checklist (run locally before merging the rename)

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test:coverage      # full suite + coverage gate
pnpm publint
npm audit --omit=dev
cd packages/cli && npm pack --dry-run   # confirm name "dev-sesssion", files = [dist]
```

Current status (verified during the rename):
- ✅ build, typecheck, lint (0 errors; 8 pre-existing warnings unrelated to the rename)
- ✅ 1183/1183 tests pass (e2e can flake under heavy parallel load — timeouts, not
  logic failures; re-run `pnpm test:e2e` in isolation to confirm green)
- ✅ publint "All good!" for `dev-sesssion`
- ✅ `npm pack` → `dev-sesssion@1.0.0`, 7 files, ships `dist/` only
- ✅ `dev-sesssion --version` reports the real version from package.json

## `--version` (resolved)

`--version` previously reported a hardcoded `0.0.0`. It now reads the version
from the package's own `package.json` at runtime (`packages/cli/src/cli.ts`,
`readVersion()`). Runtime read — not build-time injection — is required because
semantic-release sets the version *after* the build step runs; reading at runtime
picks up the version semantic-release writes into the published `package.json`.
tsup `shims: true` makes `import.meta.url` resolve in the CJS bundle so the file
can be located. Verified: the built CJS bin reports `1.0.0`, matching
`packages/cli/package.json`.

## Cutting the release

1. Open a PR from `dev/post-v1-features` → `main` with the rename.
   Use a Conventional Commit title. Because the user-facing command changed from
   `dev-session` to `dev-sesssion`, this is a **breaking change**:

   ```
   feat(cli)!: rename package and command to dev-sesssion

   BREAKING CHANGE: the published package and the binary are now
   `dev-sesssion` (three s). Installs and invocations using `dev-session`
   no longer resolve.
   ```

   (A `!` / `BREAKING CHANGE` triggers a **major** bump via semantic-release.)
2. Merge once CI is green.
3. Watch the Release workflow publish to npm.
4. Verify: `npm view dev-sesssion version` matches the new tag.
5. Proceed to `docs/TEST_PLAN.md` against the published package.

## Rollback

- `npm deprecate dev-sesssion@<bad> "use <good>"` (npm forbids unpublish after 72h).
- Revert the offending commit on `main`; semantic-release ships the fix as a new
  patch. Never force-push `main`.
