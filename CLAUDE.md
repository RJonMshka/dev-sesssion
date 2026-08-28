# CLAUDE.md — dev-sesssion

Self-managing context architecture for AI-assisted coding. Installs via `npx dev-sesssion init`. Manages `.session/` to keep AI sessions lean and self-resuming. Licensed MIT; published to npm as `dev-sesssion` (the other three packages are private).

---

## HARD RULES

- NEVER import `gray-matter` — use `@11ty/gray-matter` only (upstream allows RCE via `eval()`)
- NEVER use `exec()` / `execSync()` with user data — use `execFile()` or `spawn()` with arg arrays
- NEVER accept a raw `string` file path from external sources — pass through `PathValidator.safeResolvePath()` first; use `ValidatedPath` type
- NEVER write directly to a file path — use `AtomicWriter` (`.tmp` → `rename()`)
- NEVER call `matter()` directly — use `FrontmatterParser` (disables JS engine, runs Zod, sanitizes prototype keys)
- NEVER throw raw `Error` — throw `CliError`, `ParseError`, or `SecurityError`; never include absolute paths in messages
- NEVER bypass `WriteGuard` — secret scanning is wired into `AtomicWriter`; do not circumvent it
- NEVER use `any` — use `unknown` and narrow explicitly
- NEVER add dependencies to `packages/security` or `packages/core` without explicit approval
- NEVER put business logic in `packages/cli` — if it's logic, it belongs in `packages/core`
- NEVER start a feature without an LLD — see `docs/METHOD.md`
- NEVER write to `.session/` — it is a frozen archive; do not run `update`, `advance`, or `index` against this repo

---

## How we work

Plans live in `docs/plan/` as **HLD → LLD → tests → code**. One `HLD.md` for
architecture across features; one `LLD-<feature>.md` per feature carrying its
**EARS** requirements (`REQ-<AREA>-<n>`). Read **[docs/METHOD.md](docs/METHOD.md)** first — it defines the EARS
patterns, the id scheme, and the definition of done.

**Before coding:** find or write the LLD for what you're changing. Requirements
before design, design before tests, tests before code.

**Writing tests:** name each test for the requirement it covers
(`it("… (REQ-IDX-1)")`), and **watch it fail before you make it pass**. Assert
against real generator output, never hand-written fixture lines — this repo has
shipped two bugs that every test missed for exactly that reason.

The method is advisory. Nothing in CI enforces it.

> `.session/` is how this project was planned through chunk 19 and is kept as an
> archive. It is no longer used for planning, and the tool is no longer run
> against this repository. See "Why not .session/" in `docs/METHOD.md`.

---

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:coverage
pnpm dev
npm audit --omit=dev
npx gitleaks protect --staged
```

---

## Structure

```
dev-sesssion/
├── packages/
│   ├── core/       # business logic — no CLI deps, no process.argv
│   ├── cli/        # parse args → call core → format output → exit
│   ├── adapters/   # Claude Code, opencode, Cursor, Windsurf; never imports cli
│   └── security/   # PathValidator, FrontmatterParser, SecretScanner, AtomicWriter
├── tests/
│   ├── fixtures/   # integration + e2e fixture projects
│   └── helpers/    # shared test utilities
└── .session/       # live session brain (dogfoods the system)
```

---

## Package contracts

| Package | Depends on | Key exports |
|---|---|---|
| `security` | nothing internal | `PathValidator`, `FrontmatterParser`, `AtomicWriter`, `WriteGuard`, `CliError`, `ParseError`, `SecurityError` |
| `core` | security | `SessionManager`, `FileIndexManager`, `PlanChunkManager`, `PlanParser`, `ProjectDetector`, `HealthChecker`, `SessionVerifier`, `ReplayScorer`, `GitReader`, `NextPromptWriter` |
| `cli` | core + security | Commander commands, `@clack/prompts` wizard flows |
| `adapters` | core only | `Adapter` interface impls; subpath exports |

---

## Code rules

- Strict TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `// @ts-ignore` / `// @ts-expect-error` require an explanation comment + TODO
- Every public function needs JSDoc: description + `@param` + `@returns` + `@throws`
- Functions >30 lines: decompose
- Use `Object.create(null)` for objects built from untrusted parsed data
- Run `pnpm lint` before committing

---

## Testing rules

- Security functions: adversarial tests required (path traversal, null bytes, JS frontmatter, prototype pollution, secret patterns) in `packages/security/src/__tests__/`
- CLI tests: subprocess via `execa` only — never import CLI internals
- Unit tests: real temp dirs via `fs.mkdtempSync`; integration tests: `tmp-promise` with `unsafeCleanup`; clean up in `afterEach`
- Assert against real generator output, never hand-written fixture lines — see `docs/METHOD.md`
- Name tests for the requirement they cover: `it("… (REQ-IDX-1)")`
- Strip ANSI before assertions (`strip-ansi`) — never snapshot colored output
- No `process.exit()` in tests — use Commander's `.exitOverride()`
