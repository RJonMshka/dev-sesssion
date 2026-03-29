# CLAUDE.md — dev-session

> This file is read automatically by Claude Code at session start.
> Keep it accurate. It is the AI's single source of truth for this project.

---

## Project identity

**Package:** `dev-session`
**What it does:** A self-managing context architecture for AI-assisted coding. Installs via `npx dev-session init`. Manages a `.session/` directory that keeps AI coding sessions lean, focused, and self-resuming.
**Stage:** Internal development (pre-open-source)
**License:** `UNLICENSED` until open-source release, then `MIT`

---

## Repository structure

```
dev-session/
├── packages/
│   ├── core/          # data model, file managers, validators — no CLI deps
│   ├── cli/           # commander + @clack/prompts — thin wrapper over core
│   ├── adapters/      # Claude Code, opencode, Cursor adapters
│   └── security/      # PathValidator, FrontmatterParser, SecretScanner, AtomicWriter
├── tests/
│   ├── fixtures/      # fixture projects used in integration + e2e tests
│   └── helpers/       # shared test utilities (tmp dirs, memfs setup)
├── .session/          # this repo dogfoods the system
├── biome.json
├── vitest.config.ts
├── pnpm-workspace.yaml
├── PLAN.md            # full project plan — read this before starting any work
├── SECURITY.md
└── CONTRIBUTING.md
```

---

## How to read the plan

`PLAN.md` is split into 9 chunks. Each chunk is self-contained with explicit dependencies.
Check `.session/SESSION_STATE.md` for the **active chunk** before touching any code.
Only work on the active chunk's tasks unless explicitly told otherwise.

---

## Non-negotiable rules

These apply to every line of code written in this project. No exceptions.

### Security rules (STOP and re-read if you are about to violate these)

1. **Never use upstream `gray-matter`** — always import from `@11ty/gray-matter`. The upstream package allows JavaScript frontmatter execution (RCE via `eval()`). This is a hard ban.

2. **Never use `exec()` or `execSync()`** with user-supplied data. Always use `execFile()` or `spawn()` with an argument array. No shell interpolation, ever.

3. **Every file path from an external source** (FILE_INDEX.md, CLI args, frontmatter) must pass through `PathValidator.safeResolvePath()` before any filesystem operation. The return type is `ValidatedPath` — functions that read/write files must accept `ValidatedPath`, not `string`.

4. **Every file write must use `AtomicWriter`** from `packages/security`. Write to `.tmp` then `rename()`. Never write directly to the target path.

5. **All frontmatter parsing must use `FrontmatterParser`** from `packages/security`. It disables the JS engine, runs Zod schema validation, and sanitizes prototype pollution keys. Never call `matter()` directly.

6. **Never throw raw `Error`** — always throw `CliError`, `ParseError`, or `SecurityError`. Error messages must never contain absolute paths — sanitize with `path.relative(cwd, absPath)`.

7. **Secret scanning runs before every write** via `WriteGuard`. This is already wired into `AtomicWriter`. Do not bypass it.

### Code quality rules

8. **Strict TypeScript everywhere**: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. No `any` — use `unknown` and narrow explicitly.

9. **No `// @ts-ignore` or `// @ts-expect-error`** without a comment explaining exactly why and a TODO to remove it.

10. **Every public function needs a JSDoc comment** — one-line description + `@param` + `@returns` + `@throws` where applicable.

11. **Functions over 30 lines are suspicious.** Decompose. Name the pieces.

12. **Use `Object.create(null)` for objects built from untrusted parsed data** to prevent prototype pollution.

13. **Biome is the linter and formatter.** Run `pnpm lint` before committing. Never disable Biome rules without a comment.

### Testing rules

14. **Every security function must have adversarial tests** — path traversal, null bytes, JS frontmatter, prototype pollution keys, each secret pattern. These tests live in `packages/security/src/__tests__/`.

15. **Test the CLI via subprocess (`execa`)**, not by importing internals. The CLI's public contract is its terminal interface.

16. **Filesystem tests**: use `memfs` for unit tests, real temp directories (via `tmp-promise`) for integration tests. Always clean up in `afterEach`.

17. **Never snapshot ANSI-colored output** — strip ANSI codes with `strip-ansi` before any assertion.

18. **Do not write a test that calls `process.exit()`** — use Commander's `.exitOverride()` in tests.

---

## Package-level contracts

### `packages/security` — imported by everything, depends on nothing internal
The security package has zero internal dependencies. It is built and tested first.
Key exports: `PathValidator`, `FrontmatterParser`, `ContentSanitizer`, `SecretScanner`, `WriteGuard`, `AtomicWriter`, `CliError`, `ParseError`, `SecurityError`

### `packages/core` — the brain, depends on security
Business logic only. No CLI, no terminal output, no `process.argv`.
Key exports: `SessionManager` (facade), `SessionStateManager`, `FileIndexManager`, `PlanChunkManager`, `NextPromptWriter`, `PlanParser`, `ProjectDetector`, `GitignoreAwareWalker`
All public types are re-exported from `packages/core/src/index.ts`.

### `packages/cli` — thin layer, depends on core + security
Only responsibility: parse args → call core → format output → exit.
All business logic that ends up in CLI code is a smell — move it to core.
Uses `commander` for commands, `@clack/prompts` for interactive wizard flows.

### `packages/adapters` — optional, depends on core
Adapters implement the `Adapter` interface from core.
Shipped as subpath exports: `dev-session/adapters/claude`, `dev-session/adapters/opencode`.
An adapter may never import from `packages/cli`.

---

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order)
pnpm build

# Type check all packages
pnpm typecheck

# Lint + format check
pnpm lint

# Run all tests
pnpm test

# Run tests by tier
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# Run tests with coverage
pnpm test:coverage

# Validate published package output
pnpm publint

# Security audit (prod deps only)
npm audit --omit=dev

# Check for secrets in staged files
npx gitleaks protect --staged

# Interactive dev (watch mode)
pnpm dev
```

---

## Dependency decisions (do not change without discussion)

| Package | Reason | Notes |
|---|---|---|
| `@11ty/gray-matter` | Safe fork of gray-matter — JS engine removed | Do NOT use upstream `gray-matter` |
| `globby` | .gitignore-aware file walking | Wraps fast-glob |
| `zod` | Runtime schema validation at parse boundaries | Use `.strict()` on all frontmatter schemas |
| `write-file-atomic` | Atomic file writes | Used inside `AtomicWriter` only |
| `commander` | CLI framework | v14+ only, zero deps |
| `@clack/prompts` | Interactive CLI prompts | TypeScript-native, replaces inquirer |
| `tsup` | Build tool | Dual CJS/ESM output |
| `vitest` | Test runner | Native TS/ESM, ~5x faster than Jest |
| `biome` | Lint + format | Replaces ESLint + Prettier |
| `execa` | Subprocess in tests | E2e CLI testing only |
| `memfs` | In-memory filesystem | Unit tests only |
| `tmp-promise` | Temp directories | Integration tests only |
| `fast-check` | Property-based testing | PathValidator + PlanParser |

**Before adding any new dependency:**
1. Check its license (must be MIT / Apache-2.0 / ISC / BSD)
2. Check its Socket.dev score
3. Check when it was last published (>12 months unmaintained = red flag)
4. Check how many dependencies it brings in (`npm info <pkg> dependencies`)
5. Get explicit approval before adding to `packages/core` or `packages/security`

---

## `.session/` directory (this repo dogfoods the system)

This repository uses dev-session itself. The `.session/` directory at the root is the live session brain for developing dev-session.

```
.session/
  SESSION_STATE.md    # active chunk + task list (gitignored)
  FILE_INDEX.md       # file → chunk tag mapping (committed in team mode)
  NEXT_PROMPT.md      # ready-to-paste bootstrap (gitignored)
  ROUTINES.md         # bootstrap + self-update prompts (committed)
  PLAN_1.md           # chunk 1: foundation
  PLAN_2.md           # chunk 2: security utilities
  ...
  PLAN_9.md           # chunk 9: open-source prep
```

At the start of every session: read `SESSION_STATE.md` to find the active chunk. Load only the files tagged to that chunk in `FILE_INDEX.md`. Do not load the entire codebase.

At the end of every session: run the self-update routine from `ROUTINES.md`. Update `SESSION_STATE.md`, `FILE_INDEX.md`, and regenerate `NEXT_PROMPT.md`. Do not end a session without doing this.

---

## What not to do

- **Do not start implementing** before reading `SESSION_STATE.md` and confirming the active chunk
- **Do not load the entire codebase** into context — use `FILE_INDEX.md` to identify relevant files
- **Do not use `any`** — if you're tempted, use `unknown` and add a narrowing function
- **Do not write directly to a file path** — always use `AtomicWriter`
- **Do not call `matter()` directly** — always use `FrontmatterParser`
- **Do not build CLI logic in `packages/core`** — no `process.argv`, no terminal output in core
- **Do not add dependencies to `packages/security` or `packages/core`** without explicit approval
- **Do not suppress TypeScript errors** without a written explanation
- **Do not skip the self-update routine** at session end — the system degrades without it
- **Do not write tests that import CLI internals** — test via subprocess

---

## How to start a session

1. Read `.session/SESSION_STATE.md` — note active chunk and open tasks
2. Read `.session/FILE_INDEX.md` — identify files tagged to the active chunk
3. Read the active chunk file (e.g. `.session/PLAN_2.md`)
4. Load only the tagged files into context
5. Summarize: active chunk goal, today's tasks, files in context
6. Ask for confirmation before writing any code

## How to end a session

Run the self-update routine:

```
Session ending. Execute in order:
1. Update .session/SESSION_STATE.md — mark completed tasks [x], note stopping point, update last-worked files
2. Update .session/FILE_INDEX.md — add new files created, update chunk tags if scope changed
3. Rewrite .session/NEXT_PROMPT.md from scratch — project name, active chunk, files to load,
   exact resume point, any prerequisite context. Must be ≤15 lines, fully self-contained.
4. If all tasks in active chunk are done: advance to next chunk in SESSION_STATE.md
Show me each file's new content before writing. I will confirm.
```