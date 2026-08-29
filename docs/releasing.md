# Releasing

How a release of `dev-sesssion` happens, what to check before one, and how to
verify the published artifact afterwards.

> The npm package, the GitHub repo and the `bin` command are all
> **`dev-sesssion`** — three `s`. The internal workspace scope
> `@dev-session/*` (two `s`) is private, bundled into the CLI, and never
> published; the spelling difference is deliberate.

---

## The pipeline

Releases are automated by **semantic-release** (`.releaserc.json`). Nobody bumps
versions or publishes by hand — merging Conventional Commits to `main` drives
everything.

1. Push or merge to `main`.
2. `.github/workflows/ci.yml` runs: typecheck → lint → audit → gitleaks →
   build → `pnpm test:coverage` → publint.
3. On CI success, `.github/workflows/release.yml` builds, copies the root
   `README.md` into `packages/cli/` (this is why the package has no committed
   README of its own), and runs `npx semantic-release`, which:
   - analyzes commits since the last tag (`feat` → minor, `fix` / `perf` →
     patch, `BREAKING CHANGE` → major),
   - updates `CHANGELOG.md` and `packages/cli/package.json`,
   - publishes `dev-sesssion` to npm (`@semantic-release/npm`, `pkgRoot:
     packages/cli`),
   - creates the GitHub release and the `v${version}` tag,
   - commits `chore(release): … [skip ci]`.

Required repo secrets: `NPM_TOKEN`, `RELEASE_TOKEN`.

**A breaking change needs `!` or a `BREAKING CHANGE:` footer** to trigger a major
bump:

```
feat(cli)!: <what changed>

BREAKING CHANGE: <what stops working, and what to do instead>
```

### Why `--version` reads at runtime

`packages/cli/src/read-version.ts` reads the version out of the package's own
`package.json` at runtime rather than having it injected at build time. This is
required, not stylistic: semantic-release sets the version **after** the build
step runs, so a build-time constant would ship stale. tsup `shims: true` makes
`import.meta.url` resolve in the CJS bundle so the file can be located.

Keep `read-version.ts` at `src` depth-1 — `../package.json` has to resolve in
both the source tree and the single dist bundle.

---

## Before merging to main

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test:coverage          # full suite + coverage gate (80% stmts / 75% br)
pnpm publint
pnpm audit --prod
cd packages/cli && npm pack --dry-run   # name "dev-sesssion", bin → dist/index.cjs
```

**Audit the prod deps by hand — CI does not.** The CI step runs
`npm audit --omit=dev`, which cannot work here: this is a pnpm workspace with no
`package-lock.json`, so npm exits `ENOLOCK` before auditing anything. The step
is also marked `continue-on-error: true`. It has therefore never gated a
release. Use `pnpm audit --prod` locally until that step is fixed.

Everything the CLI depends on transitively is either installed alongside it or
inlined into the bundle, so a transitive advisory does reach users. Most are
cleared by refreshing the lockfile — the patched versions usually sit inside the
ranges already declared.

e2e tests can flake under heavy parallel load — those are timeouts, not logic
failures. Re-run `pnpm test:e2e` in isolation to confirm green before blaming a
change.

---

## After publishing: smoke the real artifact

This validates the **published package**, not the source tree. Run it outside
any checkout.

> The repo directory is itself named `dev-sesssion`, which is exactly the
> substring the CLI's auto-run heuristic matches. Testing inside it can mask
> path-detection bugs.

### Install

```bash
npm install -g dev-sesssion     # or: npx dev-sesssion@latest <cmd>
which dev-sesssion              # resolves to the global shim
dev-sesssion --help             # usage line reads "dev-sesssion"
dev-sesssion --version          # the published version, not 0.0.0
```

### Per-command coverage

```bash
mkdir /tmp/ds-smoke && cd /tmp/ds-smoke && git init && npm init -y
```

| # | Command | Run | Expect |
|---|---------|-----|--------|
| 1 | `init` | `dev-sesssion init --yes` | `.session/` with `SESSION_STATE.md`, `FILE_INDEX.md`, `NEXT_PROMPT.md`; adapter auto-detected |
| 2 | `init --adapter` | `dev-sesssion init --yes --adapter cursor` (fresh dir) | Cursor adapter wired instead of auto-detect |
| 3 | `migrate` | in a monorepo fixture with workspace packages | `.session/` initialized per package |
| 4 | `status` | `status` / `--json` | progress, budget, warnings; `--json` is valid parseable JSON with no trailing output |
| 5 | `update` | `update` | interactive: mark a task done, add a note → `SESSION_STATE.md` + `NEXT_PROMPT.md` updated |
| 6 | `advance` | `advance --yes` | chunk archived, advanced; exit 0 |
| 7 | `prompt` | `prompt` | prints `NEXT_PROMPT.md` to stdout, pipeable |
| 8 | `index` | `index` / `--update` / `--dry-run` | generates `ai-index.yaml`; `--update` skips unchanged (mtime); `--dry-run` writes nothing |
| 9 | `health` | `health` / `--json` / `--fix` | audits session health; auto-fix repairs stale entries |
| 10 | `verify` | `verify` / `--replay` / `--json` | reconciles state against git; exits non-zero only on an error finding |
| 11 | `import` | `import --from claude` | external rules pulled into `.session/` |
| 12 | `export` | `export` | session state written back to the AI tool's config |
| 13 | `preview` | `preview` / `--format json` / `--no-content` | token breakdown + assembled bootstrap; JSON parses |
| 14 | `trim` | `trim` | interactively exclude files → budget drops |
| 15 | `lint-context` | `lint-context` / `--json` | duplicate blocks, soft language, dead `@mentions`; JSON parses |
| 16 | `compact` | `ANTHROPIC_API_KEY=… compact <file>` | AI-compacts a context file; without a key → a clear error |
| 17 | `memory` | `memory show -n` / `stats --json` / `stale` / `prune` | history, stats, staleness, pruning all emit cleanly |
| 18 | `mcp` | `mcp` | stdio MCP server serving `.session/`; responds to a client handshake |

### Cross-cutting

- **JSON commands** (`status`, `health`, `verify`, `preview`, `lint-context`,
  `memory … --json`): pipe through `| jq .` — must parse with zero trailing or
  duplicated output. This is the exact failure mode the auto-run
  double-execution bug produced.
- **Adapters:** repeat `init` in projects set up for claude, opencode, cursor
  and windsurf; confirm the right files are written.
- **Security:** try a traversal-y path and a file containing a fake secret;
  confirm the CLI refuses or warns rather than writing.
- **Exit codes:** success 0; user/validation errors non-zero with a readable
  message and **no absolute paths** leaked.
- **Idempotency:** re-running `init` on an initialized project does not clobber
  state.

### Matrix

- OS: macOS and Linux at minimum. One Windows run is worth it — the auto-run
  heuristic uses a full-path match specifically so the Windows `.cmd` shim
  (`…\node_modules\dev-sesssion\dist\index.cjs`) is detected.
- Node: matches `engines` (`>=20`); CI runs Node 24.

Sign-off: install resolves as `dev-sesssion`, every command behaves as above,
every `--json` output parses, and `--version` reports the real version.

---

## Rollback

- `npm deprecate dev-sesssion@<bad> "use <good>"` — npm forbids unpublishing
  after 72 hours.
- Revert the offending commit on `main`; semantic-release ships the fix as a new
  patch. **Never force-push `main`.**
