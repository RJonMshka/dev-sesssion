# CLAUDE.md — dev-session

Self-managing context architecture for AI-assisted coding. Installs via `npx dev-session init`. Manages `.session/` to keep AI sessions lean and self-resuming. Stage: pre-open-source (`UNLICENSED` → `MIT`).

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
- NEVER start coding without reading `SESSION_STATE.md` first

---

## Session workflow

**Start:** Read `.session/SESSION_STATE.md` → note active chunk → load only files tagged to that chunk in `FILE_INDEX.md` → confirm before writing code.

**End:** Update `SESSION_STATE.md` (mark tasks done), update `FILE_INDEX.md` (add new files), rewrite `NEXT_PROMPT.md` (≤15 lines, self-contained). See `.session/ROUTINES.md` for the full routine. Do not skip this.

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
dev-session/
├── packages/
│   ├── core/       # business logic — no CLI deps, no process.argv
│   ├── cli/        # parse args → call core → format output → exit
│   ├── adapters/   # Claude Code, opencode, Cursor; never imports cli
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
| `core` | security | `SessionManager`, `FileIndexManager`, `PlanChunkManager`, `PlanParser`, `ProjectDetector` |
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
- Unit tests: `memfs`; integration tests: real temp dirs via `tmp-promise`; clean up in `afterEach`
- Strip ANSI before assertions (`strip-ansi`) — never snapshot colored output
- No `process.exit()` in tests — use Commander's `.exitOverride()`
