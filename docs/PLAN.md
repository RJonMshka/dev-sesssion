# PLAN.md — dev-sesssion

> A self-managing context architecture for AI-assisted coding sessions.
> Installs via `npx dev-sesssion init`. First-class Claude Code + opencode support. Tool-agnostic by design.

> **Superseded — historical record.** This is how the project was planned
> through chunk 19, when planning used `.session/` chunks. Current work is
> planned as HLD/LLD/EARS documents in [`docs/plan/`](./plan/HLD.md); see
> [METHOD.md](./METHOD.md). Kept because it records why things are the way
> they are.

---

## Project metadata

| Field | Value |
|---|---|
| Package name | `dev-sesssion` |
| License | `UNLICENSED` (internal) → `MIT` on open-source release |
| Language | TypeScript (strict) |
| Runtime | Node.js 20+ |
| Package manager | pnpm |
| Build tool | tsup (dual CJS/ESM) |
| Test runner | vitest |
| Linter/formatter | Biome v2 |
| Primary tools | Claude Code, opencode (first-class); Cursor/Windsurf/Copilot (adapter roadmap) |

---

## Architecture overview

```
packages/
  core/        # data model, file managers, validators — zero CLI dep
  cli/         # commander + @clack/prompts — thin wrapper over core
  adapters/    # tool-specific adapters (claude, opencode, cursor...)
  security/    # secret scanner, path validator, input sanitizer
```

The CLI is a thin layer over the programmatic API. All business logic lives in `core`. Adapters are optional subpath exports. Security utilities are imported by both `core` and `cli` — never a peer concern.

---

## Build status (as of 2026-06-16)

> Legend: ✅ **shipped** (on `main`, released in v1.x) · 🟡 **on `dev/post-v1-features`** (built, WIP, not merged) · ⬜ **planned** (not yet built)

| Chunk | Title | Status | Notes |
|---|---|---|---|
| 1–9 | Foundation → adapters → polish/OSS prep | ✅ | Released in v1.0.x. The Cursor adapter landed here (Chunk 7), so it is **not** a future item. |
| 3.5 | Token counting infrastructure | ✅ | Shipped with the v1 core. |
| 10 | Context Intelligence (preview/trim/lint/compact) | 🟡 | Implemented on `dev/post-v1-features`; CLI commands not on `main`. |
| 11 | Session memory & analytics | 🟡 | `SessionMemoryManager` + `CONTEXT_LOG.md` on the branch. |
| 12 | ai-index auto-extraction & layered loading | 🟡 | `packages/core/src/annotation/` on the branch; **was missing from this plan entirely**. |
| 13 | `@ai-*` annotation refinement | 🟡 | `AnnotationParser` — partially in progress on the branch. |
| 14 | MCP server | ⬜ | Promoted from the original backlog. |
| 15 | Layered context loading (wiring) | ⬜ | Bootstrap/adapters escalate layer 0 → 1 → 2 on demand. |
| 16 | Windsurf adapter | ⬜ | Cursor already shipped in Chunk 7; only Windsurf remains. |

**Source-of-truth caveat:** the `.session/` brain on `main` currently tracks the *branch's* progress (it references an `annotation/` dir that does not exist on `main`) and its chunk numbering has drifted from this document. Reconciling those is tracked separately; this table reflects what is actually committed where.

---

## Cross-cutting mandates (apply to every chunk)

### Security (non-negotiable)
- **Gray-matter JS engine disabled** on every parse call — use `@11ty/gray-matter` fork
- **Path traversal prevention** — canonical resolution + boundary check on all FILE_INDEX paths
- **Zod schemas with `.strict()`** on all frontmatter and config parsing boundaries
- **Branded types** for validated paths — `ValidatedPath`, `ValidatedContent`
- **Atomic file writes** — write to `.tmp` then `rename()` — never write directly
- **Secret scanning middleware** — lightweight regex scan runs before every file write
- **`execFile()` only** — never `exec()` with user-supplied data
- **`Object.create(null)`** for all objects built from untrusted parsed data
- **Signal handlers** with re-entrancy guard — clean up temp files on SIGINT/SIGTERM

### Code quality
- Strict TypeScript — `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`
- Biome for lint + format — no ESLint, no Prettier
- Every public function has a JSDoc comment
- No `any` — use `unknown` and narrow explicitly
- Error messages never leak internal paths — sanitize with `path.relative(cwd, absPath)`
- All errors are typed `CliError | ParseError | SecurityError` — never raw `Error` throws

### Testing (minimum coverage gates)
- Unit: 80% statement, 75% branch coverage enforced in CI
- Every security function has dedicated adversarial test cases
- Every file manager has both happy-path and failure-mode tests
- CLI commands tested via `execa` subprocess — never by calling internals directly
- Filesystem tests use `memfs` for unit, real temp dirs (via `tmp-promise`) for integration

### Context budget (maximize quality, minimize tokens)
- **Bootstrap context must not exceed the configured token budget** (default: 4,000 tokens) — this includes SESSION_STATE, the active plan chunk, always-include files, and chunk-tagged files
- **NEXT_PROMPT.md is capped at 20 lines** (structured sections: header 3, context 4, resume 5, next 5, notes 3)
- **FILE_INDEX entries should include `token_cost`** — populated by `GitignoreAwareWalker.estimateTokenCost()` or live file scanning
- **Only the active plan chunk is loaded** — not the full PLAN.md. `docs/PLAN.md` is split into `.session/PLAN_N.md` files by `init`
- **SESSION_STATE is compacted on chunk advance** — completed chunk tasks are archived to DONE_LOG.md, SESSION_STATE keeps only the active chunk's tasks plus a summary line per completed chunk
- **`dev-sesssion status` must display the context budget breakdown** — tokens per category, over-budget warnings
- **Bootstrap formatters are adapter-specific** — Claude Code uses `@`-mention syntax, opencode uses its own format, generic uses plain text. Each adapter implements the `BootstrapFormatter` interface
- **Exclude patterns are explicit** — NEXT_PROMPT.md includes a "Do NOT load" line listing patterns to avoid (test files, other chunks, dist/)
- **Stale context detection** — `dev-sesssion health` flags always-include files that haven't been touched in N sessions

### Dependencies
- No runtime dependencies in `core` beyond: `@11ty/gray-matter`, `globby`, `zod`, `write-file-atomic`
- `commander` and `@clack/prompts` are `cli` dependencies only
- All devDependencies pinned to exact versions in lockfile
- `ignore-scripts=true` in `.npmrc`
- `npm audit --omit=dev` runs in CI on every push

---

## Chunk 1 — Foundation & repository setup

> **Goal:** Monorepo scaffolded, tooling configured, CI green, skeleton packages published privately
> **Depends on:** Nothing
> **Est. sessions:** 2

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

### Key files created
```
.npmrc
.nvmrc                    # Node 20 LTS
biome.json
pnpm-workspace.yaml
vitest.config.ts
.github/workflows/ci.yml
SECURITY.md
CONTRIBUTING.md
packages/core/package.json
packages/cli/package.json
packages/adapters/package.json
```

### Acceptance criteria
- `pnpm install` completes with no lifecycle scripts running
- `pnpm typecheck` passes across all packages
- `pnpm lint` passes with zero violations
- `pnpm test` runs and exits 0 (even with placeholder tests)
- `pnpm build` produces both `.mjs` and `.cjs` outputs
- `publint` reports no issues on built output

---

## Chunk 2 — Security utilities (`packages/security`)

> **Goal:** All security primitives built, tested, and battle-hardened before any business logic uses them
> **Depends on:** Chunk 1
> **Est. sessions:** 2–3

### Rationale
Security is built before the data model so that every subsequent chunk has no choice but to use validated paths, safe parsers, and bounded writes. This is a forcing function — not an afterthought.

### Tasks

#### 2a — Input validation
- [ ] `PathValidator` — `safeResolvePath(userPath, projectRoot)` using `fs.realpath()` + boundary check
  - Rejects null bytes, absolute paths, paths resolving outside `projectRoot`
  - Appends `path.sep` to root to prevent prefix attacks
  - Returns `ValidatedPath` branded type on success, throws `SecurityError` on failure
- [ ] `ContentSanitizer` — strips prototype pollution keys (`__proto__`, `constructor`, `prototype`) from parsed objects
- [ ] `FrontmatterParser` — wraps `@11ty/gray-matter` with JS engine disabled + Zod schema validation
  - Exported as a generic: `parseFrontmatter<T>(content, schema)` → `{ data: T, content: string }`
  - Throws `ParseError` with safe message (no raw YAML in user-facing error)

#### 2b — Secret detection
- [ ] `SecretScanner` — synchronous regex scan for 10 known secret patterns
  - AWS access keys, GitHub PATs, npm tokens, OpenAI/Anthropic keys, private key headers, generic `key=value` patterns
  - Returns `ScanResult[]` with pattern name, line number, redacted match (never full value)
- [ ] `WriteGuard` — middleware wrapping atomic file writes: scan → warn/block → write
  - Default: warn mode (prints warning, still writes)
  - `--strict` flag: block mode (throws `SecurityError`, no write)
  - Supports inline `<!-- dev-sesssion:allow -->` bypass comment
- [ ] `AtomicWriter` — `writeFileAtomic(path, content)` using `write-file-atomic` package
  - Sets `mode: 0o644` on all written files
  - Cleans up `.tmp` file on error via `finally` block

#### 2c — Error types
- [ ] `CliError` — user-facing message + optional `cause` + optional `suggestion` field
- [ ] `ParseError` — includes `file` (relative path), `line` (optional), safe `message`
- [ ] `SecurityError` — includes `threat` enum (PATH_TRAVERSAL | SECRET_DETECTED | INJECTION_ATTEMPT | PROTOTYPE_POLLUTION)

#### 2d — Tests (adversarial)
- [ ] PathValidator: `../../../etc/passwd`, null bytes, symlink traversal, absolute paths, valid paths
- [ ] FrontmatterParser: JS frontmatter `---js`, prototype pollution keys, unknown fields (`.strict()`), valid YAML
- [ ] SecretScanner: each of the 10 patterns triggers, partial matches don't trigger, redacted output verified
- [ ] WriteGuard: warn mode writes despite detection, strict mode blocks, bypass comment respected
- [ ] AtomicWriter: partial write simulation (process kill mid-write verifies no corruption)

### Key exports from `packages/security`
```typescript
export { PathValidator, ValidatedPath }
export { FrontmatterParser, ParseError }
export { ContentSanitizer }
export { SecretScanner, ScanResult, WriteGuard }
export { AtomicWriter }
export { CliError, SecurityError, SecurityThreat }
```

---

## Chunk 3 — Core data model (`packages/core`)

> **Goal:** All session file types, schemas, and read/write managers — the entire `.session/` brain
> **Depends on:** Chunk 2
> **Est. sessions:** 3

### Tasks

#### 3a — TypeScript types and Zod schemas
- [ ] `SessionState` type + `SessionStateSchema` — active chunk, task list, last-worked files, notes, session ID, timestamps
- [ ] `FileIndexEntry` type + `FileIndexEntrySchema` — filepath (ValidatedPath), chunk tags, purpose, last-modified
- [ ] `PlanChunk` type + `PlanChunkSchema` — chunk ID, title, depends-on, est-sessions, tasks array
- [ ] `Task` type — text, status (`todo | in-progress | done`), added-at, completed-at
- [ ] `NextPrompt` type — project name, active chunk, files to load, resume context, max 15 lines enforced by validator
- [ ] `ProjectInfo` type — detected tool (claude | opencode | cursor | unknown), existing files, project root
- [ ] `AdapterConfig` type — the public contract for community adapters

#### 3b — File managers (each uses `FrontmatterParser` + `AtomicWriter` from security package)
- [ ] `SessionStateManager`
  - `load(root)` → `SessionState` (throws `ParseError` if malformed)
  - `save(root, state)` → `void` (atomic write via `WriteGuard`)
  - `markTaskDone(state, taskText)` → `SessionState`
  - `markTaskInProgress(state, taskText)` → `SessionState`
  - `addNote(state, note)` → `SessionState`
  - `updateLastWorked(state, files: ValidatedPath[])` → `SessionState`

- [ ] `FileIndexManager`
  - `load(root)` → `FileIndexEntry[]`
  - `save(root, entries)` → `void`
  - `queryByChunk(entries, chunkId)` → `FileIndexEntry[]`
  - `alwaysInclude(entries)` → `FileIndexEntry[]`
  - `add(entries, entry)` → `FileIndexEntry[]` (deduplicates by path)
  - `audit(entries, root)` → `AuditResult` — stale entries (file deleted/moved), missing chunks

- [ ] `PlanChunkManager`
  - `loadAll(root)` → `PlanChunk[]` (reads all `PLAN_N.md` files, sorted)
  - `loadActive(root, state)` → `PlanChunk`
  - `advance(root, state)` → `SessionState` (moves to next chunk, resets in-progress tasks)
  - `isComplete(chunk)` → `boolean` (all tasks done)
  - `archive(root, chunk)` → `void` (appends to `DONE_LOG.md`)

- [ ] `NextPromptWriter`
  - `generate(state, chunk, files)` → `string` (enforces ≤15 lines)
  - `write(root, prompt)` → `void`
  - `validate(prompt)` → `ValidationResult` (line count, self-contained check)

- [ ] `RoutinesWriter`
  - `write(root)` → `void` (writes `ROUTINES.md` with bootstrap + self-update snippets)

#### 3c — Plan parser (for splitting existing PLAN.md files)
- [ ] `PlanParser`
  - `fromMarkdown(content)` → `PlanChunk[]` — splits on `##` headings using `remark-parse` AST
  - `detectBoundaries(content)` → `BoundaryResult[]` — returns suggested split points with confidence scores
  - `toMarkdown(chunk)` → `string` — serializes a chunk back to markdown

#### 3d — Project detector
- [ ] `ProjectDetector`
  - `detect(cwd)` → `ProjectInfo` — scans for `CLAUDE.md`, `AGENTS.md`, `PLAN.md`, `.cursor/rules/`, `opencode.json`, `package.json`, `.git/`
  - `hasExistingSession(cwd)` → `boolean` — checks for `.session/` directory
  - `getProjectType(info)` → `'vite' | 'next' | 'node' | 'unknown'`

#### 3e — Codebase walker (for auto-generating FILE_INDEX)
- [ ] `GitignoreAwareWalker`
  - `walk(root, options)` → `WalkedFile[]` — uses `globby` with `.gitignore` support
  - `groupByDirectory(files)` → `DirectoryGroup[]` — for interactive chunk-tagging prompts
  - `estimateTokenCost(file)` → `number` — rough token count for context budget display

#### 3f — Context budget system
- [ ] `ContextBudget` type + `ContextBudgetBreakdown` — breakdown by session state, plan chunk, files, always-include
- [ ] `ContextBudgetCalculator` — `estimate()` aggregates token costs, `formatSummary()` for display
- [ ] `DEFAULT_CONTEXT_BUDGET = 4000` tokens (tunable per-project)
- [ ] `FileIndexEntry.token_cost` optional field — populated by walker, used by budget calculator

#### 3g — Bootstrap formatter system
- [ ] `BootstrapFormatter` interface — `formatFilesToLoad()`, `formatExcludes()`, `generatePrompt()`
- [ ] `BootstrapContext` type — all data needed to generate a bootstrap prompt
- [ ] `PlainTextFormatter` — default implementation with structured sections (header/context/resume/next/notes)
- [ ] `NextPromptWriter.generateWithFormatter()` — delegates to a formatter for tool-specific output
- [ ] `MAX_PROMPT_LINES` increased from 15 → 20 (structured section budget: header 3, context 4, resume 5, next 5, notes 3)

#### 3h — State compaction
- [ ] `SessionStateManager.compact()` — archives completed chunk summaries, keeps SESSION_STATE lean
- [ ] `NextPromptWriter.validate()` — now accepts both `"Files to load:"` and `"Load:"` field names

#### 3i — Tests
- [ ] `SessionStateManager`: load valid, load malformed, markTaskDone idempotent, save atomic, compact
- [ ] `FileIndexManager`: queryByChunk returns correct entries, audit detects stale, add deduplicates
- [ ] `PlanChunkManager`: loadAll sorts correctly, advance updates state, isComplete logic
- [ ] `NextPromptWriter`: enforces 20-line limit, validate catches missing fields, generateWithFormatter delegates
- [ ] `PlanParser`: splits on `##` headings, ignores `#` and `###`, handles empty sections
- [ ] `ProjectDetector`: detects each tool type, handles missing files gracefully
- [ ] `GitignoreAwareWalker`: respects `.gitignore`, groups correctly, handles empty dirs
- [ ] `ContextBudgetCalculator`: estimate with/without token_cost, over-budget detection, formatSummary
- [ ] `PlainTextFormatter`: structured output, exclude patterns, budget display, truncation

### Key exports from `packages/core`
```typescript
export { SessionStateManager, SessionState, Task }
export { FileIndexManager, FileIndexEntry, AuditResult }
export { PlanChunkManager, PlanChunk }
export { NextPromptWriter, NextPrompt }
export { PlanParser, BoundaryResult }
export { ProjectDetector, ProjectInfo }
export { GitignoreAwareWalker, WalkedFile }
export { ContextBudgetCalculator, ContextBudget, DEFAULT_CONTEXT_BUDGET }
export { PlainTextFormatter, BootstrapFormatter, BootstrapContext }
export { SessionManager }  // unified facade over all managers
```

---

## Chunk 4 — CLI: `init` command

> **Goal:** `npx dev-sesssion init` works end-to-end for new, vibe-code, and enterprise projects
> **Depends on:** Chunks 2, 3
> **Est. sessions:** 2–3

### Tasks

#### 4a — CLI scaffold
- [ ] Set up `commander` v14 with global options: `--cwd`, `--dry-run`, `--yes`, `--verbose`, `--strict`
- [ ] Set up `@clack/prompts` wizard pattern with `group()` for multi-step flows
- [ ] Global error handler — catches `CliError | ParseError | SecurityError`, formats for terminal, exits with correct code
- [ ] `--dry-run` mode — all file writes replaced with log output showing what would be written
- [ ] Signal handler — cleans up partial writes on SIGINT during init

#### 4b — Detection phase (automatic, no prompts)
- [ ] Detect existing `PLAN.md` — report line count, heading count, estimated chunks
- [ ] Detect existing `CLAUDE.md` / `AGENTS.md` — note for adapter setup
- [ ] Detect `package.json` — show project name in wizard header
- [ ] Detect `.session/` — if exists, prompt to reinitialize or exit

#### 4c — Migration path A: split existing PLAN.md
- [ ] Parse `PLAN.md` with `PlanParser.detectBoundaries()`
- [ ] Display detected boundaries with confidence scores
- [ ] Prompt: confirm boundaries OR adjust manually (enter custom heading names)
- [ ] Write `PLAN_N.md` chunk files to `.session/`
- [ ] Report: "Split into N chunks. Active chunk: PLAN_1.md"

#### 4d — Migration path B: interactive scaffolding (no existing PLAN.md)
- [ ] Prompt: project name, one-sentence goal, estimated number of phases
- [ ] For each phase: name, goal, estimated sessions
- [ ] Generate `PLAN_1.md` with starter task template for phase 1
- [ ] Write remaining chunks as empty templates

#### 4e — Migration path C: auto-generate FILE_INDEX
- [ ] Walk codebase with `GitignoreAwareWalker`
- [ ] Display: "Found N files across M directories"
- [ ] For each directory group: prompt to tag to a chunk (or skip, or always-include)
- [ ] Display estimated token cost per tagged group
- [ ] Write `FILE_INDEX.md`
- [ ] Report: "Indexed N files. Always-include: 3 files."

#### 4f — Final writes
- [ ] Write `SESSION_STATE.md` — chunk 1 active, all tasks as `[ ]`, session ID (UUID v4)
- [ ] Write `ROUTINES.md` — bootstrap + self-update prompts
- [ ] Write `NEXT_PROMPT.md` — first-ever bootstrap, self-contained
- [ ] Run `SecretScanner` on all written files before finalizing
- [ ] Offer to add `.session/SESSION_STATE.md` and `.session/NEXT_PROMPT.md` to `.gitignore`
- [ ] Display: success summary + "Paste NEXT_PROMPT.md to start your first session"

#### 4g — Tests
- [ ] E2e: `npx dev-sesssion init --yes` on a fixture project with `PLAN.md`
- [ ] E2e: `npx dev-sesssion init --yes` on a bare `package.json` project
- [ ] E2e: `--dry-run` produces no filesystem changes
- [ ] Integration: migration path A correctly splits 3-phase PLAN.md
- [ ] Integration: FILE_INDEX generation respects `.gitignore`
- [ ] Unit: signal handler cleans up `.tmp` files

---

## Chunk 5 — CLI: session lifecycle commands

> **Goal:** Full session management from the terminal — status, update, advance, index
> **Depends on:** Chunk 4
> **Est. sessions:** 2

### Tasks

#### `dev-sesssion status`
- [ ] Read `SESSION_STATE.md` + active chunk
- [ ] Display: active chunk, task completion % (N/M done), files in context, days since last session
- [ ] Display: always-include file count, indexed file count, FILE_INDEX health
- [ ] Display: **context budget breakdown** — tokens per category (SESSION_STATE, plan chunk, always-include, context files), over-budget warning
- [ ] `--json` flag: machine-readable output (for CI / scripting integration)
- [ ] Warn if `NEXT_PROMPT.md` > 20 lines ("prompt has grown — consider regenerating")
- [ ] Warn if `always-include` list > 4 files ("creep detected")
- [ ] Warn if context budget exceeds `DEFAULT_CONTEXT_BUDGET` — suggest removing large files or splitting chunks

#### `dev-sesssion update`
- [ ] Interactive: show current task list with checkboxes
- [ ] Mark tasks done / in-progress / todo
- [ ] Add session notes (free text)
- [ ] Update "last worked" files (auto-suggest from git status)
- [ ] Regenerate `NEXT_PROMPT.md` from updated state (using `NextPromptWriter.generateWithFormatter()` with detected adapter's formatter)
- [ ] Display context budget after regeneration
- [ ] Run `SecretScanner` on updated files before write

#### `dev-sesssion advance`
- [ ] Check all tasks in active chunk are `done` — warn if not, prompt to confirm force-advance
- [ ] Archive completed chunk to `DONE_LOG.md`
- [ ] **Compact `SESSION_STATE.md`** — call `SessionStateManager.compact()` to move completed chunk details to DONE_LOG and keep SESSION_STATE lean
- [ ] Advance `SESSION_STATE.md` to next chunk
- [ ] Regenerate `NEXT_PROMPT.md` for new chunk (using `PlainTextFormatter` or adapter-specific formatter)
- [ ] Display: "Advanced to PLAN_2.md. N tasks remaining in this chunk."
- [ ] Display: context budget for the new chunk

#### `dev-sesssion prompt`
- [ ] Print `NEXT_PROMPT.md` to stdout (for piping or copying)
- [ ] `--copy` flag: copy to clipboard via `clipboardy`

#### `dev-sesssion index add <filepath>`
- [ ] Validate path (PathValidator) before processing
- [ ] Prompt: which chunk(s) to tag, purpose description
- [ ] Append to `FILE_INDEX.md` atomically

#### `dev-sesssion index audit`
- [ ] Run `FileIndexManager.audit()` — detect stale entries (deleted/moved files)
- [ ] Display: stale entries with suggested action (remove or re-path)
- [ ] `--fix` flag: auto-remove stale entries after confirmation

#### Tests
- [ ] E2e: `dev-sesssion status --json` parses correctly
- [ ] E2e: `dev-sesssion advance` when all tasks done
- [ ] E2e: `dev-sesssion advance` when tasks incomplete (warn path)
- [ ] E2e: `dev-sesssion update` marks tasks and regenerates prompt
- [ ] Integration: `FileIndexManager.audit()` detects deleted files
- [ ] Snapshot: `dev-sesssion status` output format (strip ANSI before asserting)

---

## Chunk 6 — Programmatic API (`packages/core` public surface)

> **Goal:** Clean, stable `import { SessionManager } from 'dev-sesssion/core'` API
> **Depends on:** Chunk 3
> **Est. sessions:** 1–2

### Tasks

- [ ] Design final public API surface — keep it minimal and stable (semver-safe)
- [ ] `SessionManager` unified facade:
  ```typescript
  const sm = await SessionManager.load({ cwd })
  sm.getActiveChunk()         → PlanChunk
  sm.getContextFiles()        → ValidatedPath[]
  sm.markDone(taskText)       → Promise<void>
  sm.markInProgress(taskText) → Promise<void>
  sm.advance()                → Promise<void>
  sm.writeNextPrompt()        → Promise<void>
  sm.status()                 → SessionStatus
  ```
- [ ] Re-export all useful types from root `index.ts`
- [ ] Write `API.md` — full programmatic API reference with examples
- [ ] Validate dual CJS/ESM output: `publint` + `@arethetypeswrong/cli` — zero errors
- [ ] Add `exports` map test — verify each subpath resolves correctly in both CJS and ESM contexts
- [ ] Write usage examples:
  - Reading active context files for a custom bootstrap script
  - Integrating with a CI pipeline to check session state
  - Building a custom adapter using the programmatic API

### Public API surface (what gets exported from `dev-sesssion/core`)
```typescript
// Main facade
export { SessionManager }

// Individual managers (for power users)
export { SessionStateManager, FileIndexManager, PlanChunkManager, NextPromptWriter }

// Parsers and utilities
export { PlanParser, ProjectDetector, GitignoreAwareWalker }

// Types
export type { SessionState, FileIndexEntry, PlanChunk, Task, NextPrompt, ProjectInfo, AdapterConfig }

// Errors
export { CliError, ParseError, SecurityError }
```

---

## Chunk 7 — Adapter system: Claude Code + opencode

> **Goal:** First-class adapters shipped as separate subpath exports
> **Depends on:** Chunk 6
> **Est. sessions:** 2–3

### Adapter interface (defined in `core`, implemented in `adapters`)
```typescript
export interface Adapter {
  name: string
  detect(cwd: string): Promise<boolean>          // is this tool present?
  setup(ctx: AdapterContext): Promise<void>       // one-time init
  transformState(state: SessionState): AdapterFiles  // state → files to write
  onSessionStart(ctx: AdapterContext): Promise<void>
  onSessionEnd(ctx: AdapterContext): Promise<void>
  getFormatter(): BootstrapFormatter              // tool-specific NEXT_PROMPT format
}
```

Each adapter MUST implement `BootstrapFormatter` (defined in `packages/core`) to produce
tool-native bootstrap prompts. This is how context reduction works end-to-end: the adapter
knows how its tool loads files, so it generates the most efficient NEXT_PROMPT format.

### Claude Code adapter (`dev-sesssion/adapters/claude`)
- [ ] Detect: check for `CLAUDE.md` or `.claude/` directory
- [ ] `setup`: generate a `CLAUDE.md` section for dev-sesssion with bootstrap/self-update routines
- [ ] `transformState`: map active chunk notes into `CLAUDE.md` update
- [ ] `onSessionStart`: read `.claude/MEMORY.md` (first 200 lines) and inject relevant state
- [ ] `onSessionEnd`: trigger self-update routine format compatible with Claude Code's file-read pattern
- [ ] `getFormatter()` → `ClaudeBootstrapFormatter` that uses `@`-mention syntax for file loading
- [ ] `ClaudeBootstrapFormatter.formatFilesToLoad()` produces `@path/to/file` syntax for surgical context injection
- [ ] `ClaudeBootstrapFormatter.formatExcludes()` produces "Do NOT read: ..." instruction
- [ ] Tests: fixture `.claude/` directory, verify generated `CLAUDE.md` is valid markdown
- [ ] Tests: verify `ClaudeBootstrapFormatter.generatePrompt()` produces valid `@`-mention format

### opencode adapter (`dev-sesssion/adapters/opencode`)
- [ ] Detect: check for `opencode.json` or `AGENTS.md`
- [ ] `setup`: write AGENTS.md section with dev-sesssion context protocol
- [ ] `transformState`: map state to AGENTS.md format
- [ ] `onSessionEnd`: write session-end instructions in opencode-compatible format
- [ ] `getFormatter()` → `OpencodeBootstrapFormatter` using opencode's context loading format
- [ ] Tests: fixture `opencode.json`, verify `AGENTS.md` output

### Adapter registry
- [ ] `AdapterRegistry` — auto-detects adapters based on `ProjectInfo`
- [ ] `--adapter` CLI flag overrides auto-detection
- [ ] Adapter resolution order: explicit flag → auto-detect → default (no adapter)
- [ ] Document community adapter authoring: `AdapterConfig` contract + publishing conventions

---

## Chunk 8 — Team mode & enterprise features

> **Goal:** Multi-developer workflows on shared repos
> **Depends on:** Chunks 5, 7
> **Est. sessions:** 2–3

### Two modes
| Mode | Plan chunks | SESSION_STATE | NEXT_PROMPT |
|---|---|---|---|
| Personal (default) | `.gitignore`d (local) | `.gitignore`d | `.gitignore`d |
| Team | Committed (shared) | `.gitignore`d | `.gitignore`d |

In team mode, `PLAN_N.md` and `FILE_INDEX.md` are committed. `SESSION_STATE.md` and `NEXT_PROMPT.md` are always personal.

### Tasks

#### Team mode init
- [ ] `dev-sesssion init --team` — prompts for team vs personal mode
- [ ] Generates `.gitignore` patch: adds `SESSION_STATE.md`, `NEXT_PROMPT.md`, `DONE_LOG.md`
- [ ] Generates `.gitattributes` entry: mark `FILE_INDEX.md` with a **union merge driver** (`merge=union`) so concurrent index additions from different developers are both kept — NEVER `merge=ours` (which would silently discard teammates' entries on a shared file). Document that union merge can produce duplicate lines; `dev-sesssion index audit` deduplicates after merge.

#### Migration tooling
- [ ] `dev-sesssion migrate` — handles monorepos: auto-detect `pnpm-workspace.yaml` / `nx.json` / `turborepo`
  - Prompt: one shared `.session/` or per-package `.session/`
  - Write symlinks or per-package configs as appropriate
- [ ] `dev-sesssion import --from claude` — parse existing `CLAUDE.md` content into chunk notes
- [ ] `dev-sesssion import --from cursor` — parse `.cursor/rules/*.mdc` frontmatter into FILE_INDEX tags

#### Health checks
- [ ] `dev-sesssion health` — full audit command:
  - Stale FILE_INDEX entries
  - Always-include list creep (>4 files = warning)
  - NEXT_PROMPT length (>15 lines = warning)
  - DONE_LOG size (>500 lines = suggest archiving)
  - Dependency audit (`npm audit --omit=dev`)
- [ ] `dev-sesssion health --fix` — auto-remediate where safe (remove stale index entries)

#### Large repo support
- [ ] FILE_INDEX pagination for repos with 500+ files — split into `FILE_INDEX_1.md`, `FILE_INDEX_2.md`
- [ ] `--max-files` flag on `init` to limit initial index size
- [ ] Token budget display: show estimated context window cost for current chunk's files

#### Tests
- [ ] Integration: team mode `.gitignore` patch is idempotent
- [ ] Integration: monorepo detection for pnpm, nx, turborepo workspace files
- [ ] E2e: `dev-sesssion import --from claude` on fixture `CLAUDE.md`
- [ ] E2e: `dev-sesssion health` on intentionally degraded `.session/`

---

## Chunk 9 — Polish, testing completeness & open-source prep

> **Goal:** Production-ready, fully tested, ready for public release
> **Depends on:** All previous chunks
> **Est. sessions:** 2–3

### Testing completeness
- [ ] Audit coverage report — hit 80% statement / 75% branch on all packages
- [ ] Add missing adversarial tests for any security function not yet tested
- [ ] Add property-based tests (using `fast-check`) for `PathValidator` and `PlanParser`
- [ ] Add regression tests for every bug found during internal use
- [ ] Performance benchmark: `dev-sesssion status` must complete < 500ms on 200-file project

### Documentation
- [ ] `README.md` — quick start (5 steps), core concepts, CLI reference, API reference
- [ ] `PROTOCOL.md` — the SESSION PROTOCOL v1.0 spec (`.session/` format, for community adoption)
- [ ] `API.md` — full programmatic API reference
- [ ] `ADAPTERS.md` — community adapter authoring guide
- [ ] `SECURITY.md` — threat model, vulnerability disclosure, known-safe patterns
- [ ] `CHANGELOG.md` — auto-generated by semantic-release
- [ ] Docs site — Vitepress, deployed to GitHub Pages

### Open-source transition checklist
- [ ] Audit git history for secrets — `gitleaks detect --source .`
- [ ] Run `license-checker` — all deps must be MIT/Apache-2.0/ISC/BSD
- [ ] Change `"license": "UNLICENSED"` → `"license": "MIT"` across all packages
- [ ] Remove `"private": true` from all packages
- [ ] Add `LICENSE` file (MIT)
- [ ] Add `AUTHORS` file
- [ ] Set up npm Trusted Publishing via GitHub Actions (OIDC — no long-lived tokens)
- [ ] Enable npm provenance attestation (`--provenance` flag in publish step)
- [ ] Enable GitHub secret scanning on repository
- [ ] Set up Socket.dev GitHub App

### Launch
- [ ] Submit to AGENTS.md foundation as compatible tooling
- [ ] Publish blog post: "Why your AI sessions keep losing context"
- [ ] Record 3-min demo: `npx dev-sesssion init` on a real Next.js project
- [ ] Post to r/ClaudeAI, r/cursor, Hacker News, dev.to

---

## Chunk 3.5 — Token counting infrastructure

> **Goal:** Accurate, Claude-native token counting as a shared utility; prerequisite for Chunk 10
> **Depends on:** Chunk 3
> **Est. sessions:** 1

### Rationale
The original plan listed `tiktoken-node` as a v0.2 backlog item. This is incorrect: `tiktoken` uses OpenAI's BPE encoding and is not compatible with Claude's tokenizer. Anthropic provides a free, official `messages.countTokens` API endpoint that returns ground-truth counts matching billing. This chunk adds accurate counting as a foundation before the Context Intelligence Layer (Chunk 10) builds on it.

### Tasks

- [ ] Add `TokenCounter` class to `packages/core`:
  - `countFile(filePath: ValidatedPath): Promise<number>` — reads file, calls `messages.countTokens`
  - `countString(content: string): Promise<number>` — counts raw string content
  - `countFiles(paths: ValidatedPath[]): Promise<TokenCostMap>` — batch count for budget display
  - Offline fallback: character-based heuristic (`Math.ceil(chars / 4)`) when `ANTHROPIC_API_KEY` is absent
  - Exposes `isAccurate: boolean` on each result — consumers can warn when using heuristic
- [ ] **Content-hash cache** (mandatory for feasibility): `TokenCounter` caches results in `.session/.token-cache.json` keyed by `sha256(file content)` → `{ tokens, accurate }`. `countFile`/`countFiles` only call the API for files whose hash is absent or changed; unchanged files are served from cache. Without this, per-file API calls on every `preview`/`index`/`status` blow the latency budgets and hit rate limits on non-trivial repos. Cache is gitignored, invalidated by hash mismatch, and bounded (LRU eviction at a configurable max entry count).
- [ ] `TokenCostMap` type: `Map<ValidatedPath, { tokens: number; accurate: boolean }>`
- [ ] `TokenBudget` type: `{ limit: number; used: number; remaining: number; overBudget: boolean; accurate: boolean }`
- [ ] Update `GitignoreAwareWalker.estimateTokenCost()` to delegate to `TokenCounter` (real API) with heuristic fallback — rename to `measureTokenCost()` to reflect accuracy upgrade
- [ ] Update `ContextBudgetCalculator.estimate()` to use `TokenCounter.countFiles()` — async, replaces sync heuristic
- [ ] Update `FileIndexEntry.token_cost` population in `init` flow to use real counts when API key present
- [ ] Validate `DEFAULT_CONTEXT_BUDGET = 4000` against real measured bootstrap contexts — adjust default if needed; document rationale in code
- [ ] Export `TokenCounter`, `TokenCostMap`, `TokenBudget` from `packages/core`
- [ ] No new runtime dependencies — uses `@anthropic-ai/sdk` already implied by the adapter system; add it to `core` if not already present (approve explicitly per cross-cutting dep rules)

### Tests
- [ ] Unit: `countString` returns heuristic result when no API key; `isAccurate: false`
- [ ] Unit: `countFile` reads file and delegates to `countString`
- [ ] Integration: `countFiles` batch returns correct `TokenCostMap` shape
- [ ] Unit: `ContextBudgetCalculator` marks budget as `accurate: false` when heuristic used
- [ ] Unit: offline mode does not throw — degrades gracefully

### Key exports added to `packages/core`
```typescript
export { TokenCounter, TokenCostMap, TokenBudget }
```

---

## Chunk 10 — Context Intelligence: preview, trim, lint & compact

> **Goal:** Pre-flight visibility into what enters the context and tools to shrink it before the session starts
> **Depends on:** Chunks 5, 7, 3.5
> **Est. sessions:** 3–4

### Rationale
Existing tools (Claude Code, Cursor, opencode) suffer from shared failure modes: context bloat in `CLAUDE.md`/`AGENTS.md`, silent compaction at hard limits (~167K tokens for Claude Code), no way to preview what the model will actually see, and no tooling to reduce context before a session. This chunk makes `dev-sesssion` the first tool that treats context as a measurable, auditable, reducible asset — not a black box.

### Feature A — `dev-sesssion preview`

- [ ] Assemble the full bootstrap context exactly as the active adapter's `BootstrapFormatter` would produce it
- [ ] Call `TokenCounter.countFiles()` on each component: SESSION_STATE, active plan chunk, always-include files, chunk-tagged files, NEXT_PROMPT header
- [ ] Render a breakdown table:
  ```
  Component              Lines   Tokens   % Budget
  ─────────────────────────────────────────────────
  SESSION_STATE.md          42      310      7.8%
  PLAN_1.md                 88      640     16.0%
  Always-include (3)       210    1,520     38.0%
  Context files (5)        190    1,390     34.8%
  NEXT_PROMPT header         8       60      1.5%
  ─────────────────────────────────────────────────
  TOTAL                    538    3,920     98.0%  ⚠ near budget
  ```
- [ ] Print assembled prompt to stdout (full text below breakdown) so user can see exactly what the model will receive
- [ ] `--format json` flag: machine-readable breakdown for scripting/CI
- [ ] `--copy` flag: copies assembled prompt to clipboard via `clipboardy`
- [ ] `--no-content` flag: show breakdown only, suppress full prompt text
- [ ] Warn if `accurate: false` (no API key) — show heuristic caveat
- [ ] Warn if total exceeds `DEFAULT_CONTEXT_BUDGET` — suggest `dev-sesssion trim`

### Feature B — `dev-sesssion trim`

- [ ] Read current context file list (same source as `preview`)
- [ ] Interactive mode: for each file, show token cost and prompt action:
  - `skip` — exclude this file from the session's NEXT_PROMPT (one-time, not persisted to FILE_INDEX)
  - `truncate <N>` — keep only first N lines of the file for this session (one-time)
  - `remove` — permanently remove from FILE_INDEX (calls `FileIndexManager` + confirms)
  - `keep` — no change
- [ ] `--budget <N>` flag: auto-suggest skipping files until under budget (largest-first)
- [ ] `--dry-run` flag: show what would be excluded without modifying anything
- [ ] Does NOT require `ANTHROPIC_API_KEY` — all operations are local
- [ ] Session-scoped skips/truncations written to a `.session/trim-overrides.json` file (gitignored); cleared on `dev-sesssion advance`
- [ ] `NextPromptWriter.generateWithFormatter()` respects trim overrides when assembling NEXT_PROMPT

### Feature C — `dev-sesssion lint-context`

- [ ] `ContextLinter` class in `packages/core`:
  - `detectDuplicates(files)` — fuzzy line-level dedup across CLAUDE.md, SESSION_STATE, NEXT_PROMPT (using normalized strings, not exact match)
  - `detectSoftLanguage(file)` — count occurrences of "try to", "prefer", "consider", "usually", "ideally", "might" — returns ratio and flagged lines
  - `detectLineBudgetOverrun(file, limit)` — compares line count to configured budget
  - `detectConflicts(files)` — simple pattern matching: e.g., "use tabs" + "use spaces" in different files
  - `detectDeadReferences(files, root)` — finds `@mentions` or file paths in content that no longer exist on disk
- [ ] `LintResult` type: `{ severity: 'error' | 'warning' | 'info'; rule: string; file: string; line?: number; message: string }`
- [ ] `dev-sesssion lint-context` command:
  - Runs all `ContextLinter` checks on always-include + SESSION_STATE + NEXT_PROMPT
  - Outputs structured report grouped by severity
  - Exit code 1 if any `error`-severity findings (for CI use)
  - `--fix` flag: auto-removes duplicate lines (after confirmation prompt per finding)
  - `--format json` flag for machine-readable output
- [ ] No `ANTHROPIC_API_KEY` required — fully local static analysis

### Feature D — `dev-sesssion compact <file>`

> ⚠ **Highest-blast-radius feature.** LLM compression is lossy and non-deterministic. Auto-rewriting a developer's rule files is the single most dangerous operation in the project, so this command is **dry-run by default and never writes without an explicit, reviewed diff approval.** The safe, deterministic overlap (dedup, soft-language, dead refs) is already covered by `lint-context` (Feature C) — prefer it first.

- [ ] Accepts a single file path (validated via `PathValidator`)
- [ ] Supported targets: any file in FILE_INDEX or always-include list; rejects files outside project
- [ ] **Refuses hard-rule files by default** — files matching a protected-glob list (`CLAUDE.md`, `AGENTS.md`, `**/HARD_RULES*`, `SECURITY.md`, anything tagged `protected` in FILE_INDEX) are rejected unless `--force-protected` is passed with an interactive confirmation. Constraint files must never be silently rewritten.
- [ ] **Dry-run is the default.** Writing requires `--write` AND an interactive, line-level **diff approval** (show unified diff, prompt to accept) — there is no non-interactive write path except `--yes --write` which still prints the full diff to the log first.
- [ ] Backup original to `.session/backups/<filename>.<timestamp>` via `AtomicWriter` before any write
- [ ] Calls `messages.create` with a compact system prompt:
  - "You are a context compressor. Reduce this file to its essential information only. Preserve all hard constraints, rules, and facts verbatim. Remove redundancy, soft language, examples that can be inferred, and formatting prose. Output only the compacted content, no commentary."
- [ ] **Post-compaction safety check**: re-run `SecretScanner` on the output, and warn if any line that looked like a hard rule in the original (`NEVER`, `MUST`, `ALWAYS`, `do not`) is absent from the compacted output — surfaces dropped constraints before the diff prompt.
- [ ] Shows before/after token count and line count diff
- [ ] `--write` flag: opt in to writing (default is print-to-stdout dry-run)
- [ ] `--model <id>` flag: override model used for compaction (default: cheapest available Haiku-class model)
- [ ] Explicit `ANTHROPIC_API_KEY` required — clear `CliError` with suggestion if absent
- [ ] Updates `FileIndexEntry.token_cost` only after a confirmed write

### Tests (Chunk 10)
- [ ] Unit: `ContextLinter.detectDuplicates` finds normalized duplicates across two files
- [ ] Unit: `ContextLinter.detectSoftLanguage` returns correct ratio and line numbers
- [ ] Unit: `ContextLinter.detectDeadReferences` flags non-existent `@mention` paths
- [ ] Unit: trim overrides are respected by `NextPromptWriter`
- [ ] E2e: `dev-sesssion preview --format json` on a fixture project parses correctly
- [ ] E2e: `dev-sesssion trim --budget 3000 --dry-run` on a fixture over-budget project
- [ ] E2e: `dev-sesssion lint-context` exits 1 on fixture with injected duplicate rules
- [ ] E2e: `dev-sesssion compact --dry-run` on a large fixture file (no write, output to stdout)
- [ ] Integration: `dev-sesssion compact` backup file appears in `.session/backups/`

---

## Chunk 11 — Session memory & analytics

> **Goal:** Long-term learning from session history to surface what context actually matters
> **Depends on:** Chunk 10
> **Est. sessions:** 2

### Rationale
No existing tool tracks *what was loaded* across sessions, so they can never tell you "this file has been in your context for 10 sessions and you've never modified it." Session memory closes this loop: `dev-sesssion` becomes the first tool that improves its context recommendations over time by observing your actual usage patterns.

### Tasks

#### 11a — `CONTEXT_LOG.md` and `SessionMemoryManager`

- [ ] `ContextLogEntry` type:
  ```typescript
  {
    sessionId: string          // UUID v4
    timestamp: string          // ISO 8601
    chunkId: string
    filesLoaded: Array<{ path: string; tokens: number; accurate: boolean }>
    totalTokens: number
    tasksCompleted: string[]
    tasksStarted: string[]
  }
  ```
- [ ] `CONTEXT_LOG.md` stored in `.session/` — append-only YAML frontmatter list; always gitignored
- [ ] `SessionMemoryManager` in `packages/core`:
  - `append(root, entry: ContextLogEntry)` → `void` — atomic append
  - `loadAll(root)` → `ContextLogEntry[]` — parse full log
  - `analyzeStaleness(entries, threshold: number)` → `StalenessReport[]` — files loaded in >N sessions without modification
  - `detectPassiveLoads(entries, fileIndex)` → `PassiveLoad[]` — always-include files with zero modifications across all logged sessions
  - `summarizeStats(entries)` → `MemoryStats` — avg tokens/session, most-loaded files, session count, date range
- [ ] Integrate into session lifecycle: `dev-sesssion update` and `dev-sesssion advance` both append to `CONTEXT_LOG.md`
- [ ] `StalenessReport` type: `{ path: string; sessionCount: number; lastModified: string | null; suggestion: 'remove-from-always-include' | 'remove-from-index' | 'investigate' }`

#### 11b — `dev-sesssion memory` command

- [ ] `dev-sesssion memory show` — formatted session history (most recent N entries, configurable)
- [ ] `dev-sesssion memory stats` — aggregate stats: avg tokens/session, top 5 most-loaded files, total sessions, date range
- [ ] `dev-sesssion memory stale` — runs `analyzeStaleness()` + `detectPassiveLoads()`, outputs actionable report
  - `--threshold <N>` flag: sessions without modification to consider stale (default: 3)
  - `--fix` flag: interactive — for each stale file, prompt to demote from always-include or remove from index
- [ ] `dev-sesssion memory prune --older-than <duration>` — removes log entries older than duration (e.g., `30d`, `3mo`)
  - Confirmation prompt before deleting
  - `--dry-run` flag

#### 11c — Integration with existing commands

- [ ] `dev-sesssion status` — add "Session memory" section:
  - Total sessions logged, avg tokens/session
  - Count of passive load candidates (with hint to run `dev-sesssion memory stale`)
- [ ] `dev-sesssion health` — add staleness check:
  - Flag always-include files with no modification in last N sessions (uses `SessionMemoryManager.analyzeStaleness()`)
  - Flag always-include list growth rate (sessions where a new file was added)

#### 11d — Tests

- [ ] Unit: `SessionMemoryManager.append()` is idempotent on repeated calls with same `sessionId`
- [ ] Unit: `analyzeStaleness()` correctly identifies files not modified across N sessions
- [ ] Unit: `detectPassiveLoads()` returns files in always-include with zero logged modifications
- [ ] Unit: `summarizeStats()` returns correct averages on fixture log data
- [ ] Integration: `dev-sesssion update` appends entry to `CONTEXT_LOG.md`
- [ ] E2e: `dev-sesssion memory stats` on a fixture log file
- [ ] E2e: `dev-sesssion memory stale --threshold 2` flags correct files in fixture

### Key exports added to `packages/core`
```typescript
export { SessionMemoryManager, ContextLogEntry, StalenessReport, PassiveLoad, MemoryStats }
```

---

## Chunk 12 — ai-index: auto-extraction & layered loading

> **Goal:** Surface a compact, structured map of the codebase's API to the model instead of whole files — the highest-leverage context-reduction feature.
> **Depends on:** Chunks 3.5, 10
> **Est. sessions:** 2–3
> **Status:** 🟡 built on `dev/post-v1-features` (WIP)

### Rationale
Loading whole source files into context is the dominant source of token waste. This chunk extracts each file's *public surface* — module summary, exported symbols, signatures, one-line JSDoc summaries — into a serialized `.session/ai-index.yaml`, with **zero source annotations required**. The model can then load a layered view (names → signatures → full file) and pull the full file only when it actually needs the body.

### Tasks

#### 12a — Extraction model and parser
- [ ] `ParsedSymbol` type — `{ name, surface, summary, signature, line, tags }`; `surface` defaults to `"public"` for exports; `summary` auto-extracted from existing `/** */` JSDoc
- [ ] `ParsedFile` type — `{ path, moduleSummary, exports, tokenCost, tokenCostAccurate }`; `moduleSummary` from the `@packageDocumentation` block
- [ ] `AutoExtractor` class in `packages/core/src/annotation/` — `extractFile(path)` via `@typescript-eslint/typescript-estree`; handles exported functions, classes, consts, type aliases, interfaces
- [ ] `AutoExtractor.extractDirectory(root, options)` — walks via `GitignoreAwareWalker`; graceful empty-result on parse errors (never throws on a malformed file)

#### 12b — Index build, serialize, query
- [ ] `AiIndex` + `FileEntry` + `SymbolEntry` types — the serialized `ai-index.yaml` shape
- [ ] `AiIndexBuilder` — `build`, `merge` (mtime-based incremental), `serialize` (deterministic YAML, sorted keys), `deserialize`
- [ ] Hand-rolled YAML serializer/deserializer (`yaml-utils.ts`) — **no new YAML runtime dep**; JSON-style string quoting
- [ ] `AiIndexManager` — `load`, `save` (atomic + `SecretScanner`), `queryByLayer`, `queryByTag`, `queryByChunk`, `renderLayer0`, `renderLayer1`, `renderLayer2`
  - Layer 0: file path + module summary only
  - Layer 1: + exported symbol names and one-line summaries
  - Layer 2: full file (escalation path via `ValidatedPath`)

#### 12c — CLI + adapter integration
- [ ] `dev-sesssion index` — full regen pipeline + reports + over-budget warning
- [ ] `dev-sesssion index --update` — incremental via mtime; `--dry-run`, `--file`, `--show`; `index stats` subcommand
- [ ] Add `ai-index.yaml` to gitignore (personal) / commit (team) in `init`
- [ ] `BootstrapFormatter.formatAiIndex()` + implementations for all four formatters (plain, claude, opencode, cursor)
- [ ] Export `AutoExtractor`, `AiIndexBuilder`, `AiIndexManager`, and the new types from `packages/core`

#### 12d — Tests
- [ ] Unit: `AutoExtractor.extractFile` — all export kinds, existing JSDoc, parse-error handling
- [ ] Unit: `AiIndexBuilder.merge` (add/remove/modify), `serialize` determinism
- [ ] Unit: `AiIndexManager.renderLayer0/1`, `queryByChunk`
- [ ] E2e: `dev-sesssion index` on fixture; `--update` skips unchanged; `--dry-run` writes nothing

### Key exports added to `packages/core`
```typescript
export { AutoExtractor, AiIndexBuilder, AiIndexManager }
export type { ParsedFile, ParsedSymbol, AiIndex, FileEntry, SymbolEntry, SymbolSurface }
```

---

## Chunk 13 — `@ai-*` annotation refinement

> **Goal:** Optional inline annotations to override auto-extracted index data when the heuristic is wrong.
> **Depends on:** Chunk 12
> **Est. sessions:** 1
> **Status:** 🟡 in progress on `dev/post-v1-features`

### Rationale
Chunk 12 requires zero annotations, but auto-extraction occasionally guesses wrong (an export that is technically public but not part of the intended surface, or a missing summary). `@ai-*` tags let an author correct the index at the source, parsed transparently by `AutoExtractor`.

### Tasks
- [ ] `AnnotationParser` class — parses JSDoc tags from a comment block:
  - `@ai-surface <public|private>` — override visibility
  - `@ai-summary <text>` — override the one-line summary
  - `@ai-layer-hint <0|1|2>` / `@ai-layer-default <0|1|2>` — preferred load layer
  - **Dropped** (derivable, not hand-maintained): `@ai-deps`, `@ai-context-cost`
- [ ] `AutoExtractor` calls `AnnotationParser` internally — transparent to callers; `ParsedSymbol.tags` populated from parsed annotations
- [ ] Export `AnnotationParser`, `FileAnnotations` from `packages/core`
- [ ] **Adversarial tests required**: YAML injection via annotation values, malformed values, unknown tags ignored safely, prototype-pollution keys in tag values
- [ ] E2e: mixed annotated + unannotated fixture; annotation-coverage report

---

## Chunk 14 — MCP server (basic, v1-compatible)

> **Goal:** Expose session state to the agent directly over MCP, so context is *pulled on demand* instead of front-loaded via a pasted `NEXT_PROMPT`.
> **Depends on:** Chunks 6, 12
> **Est. sessions:** 2–3
> **Status:** ✅ complete (2026-06-16)

### Rationale
The paste-`NEXT_PROMPT` flow front-loads a fixed context budget. An MCP server inverts this: the agent calls tools to fetch the active chunk, query the ai-index by layer, and mark tasks done — loading the full body of a file only when it decides it needs it. This is the natural end state of the "context as a reducible, pull-based asset" thesis.

### Tasks
- [x] MCP server entrypoint (`dev-sesssion mcp`) built on the official MCP SDK; reads `.session/` via the new `SessionManager` facade in core (no business logic in the server layer)
- [x] Tools: `get_active_chunk`, `list_context_files`, `read_file_layer(path, layer)`, `query_index(tag|chunk|layer)`, `mark_task_done(text)`, `get_next_prompt`
- [x] All writes go through `AtomicWriter` + `WriteGuard` (via the managers); all paths through `PathValidator` — the MCP boundary is treated as untrusted external input
- [x] Read-only mode flag (`--read-only`) for shared/team setups
- [x] Tests: tool I/O contract tests (facade unit + in-memory MCP boundary); path-traversal attempt via a tool argument is rejected

### Implementation notes
- Built **facade-in-core**, not a separate `packages/mcp`: new `SessionManager` (`packages/core/src/managers/session-manager.ts`) composes the existing managers and is the single surface the MCP layer (and future transports) call. This also resolves the `SessionManager` export named in CLAUDE.md's package contract, which previously did not exist.
- MCP wiring lives in `packages/cli/src/mcp/` (`server.ts` + `tools.ts`); `@modelcontextprotocol/sdk` (1.29.0) + `zod` added to `packages/cli` only.
- 6 tools map 1:1 to facade methods; args are zod-validated and errors sanitized (typed-error messages only, never absolute paths).

---

## Chunk 15 — Layered context loading (wiring)

> **Goal:** Wire the Chunk 12 layered index into the actual bootstrap so sessions start at layer 0 and escalate only as needed.
> **Depends on:** Chunks 12, 14
> **Est. sessions:** 1–2
> **Status:** ✅ complete (2026-06-17)

### Tasks
- [x] `BootstrapFormatter` defaults to **layer 0** for chunk-tagged files (path + module summary), layer 1 for always-include — driven by the new `LayerResolver` and surfaced via `resolvedLayers` on `BootstrapContext`
- [x] Escalation rule: a file referenced by an active (non-done) task loads at layer 2; everything else stays at the lowest useful layer (`@ai-layer-default` raises the floor but never lowers it)
- [x] `dev-sesssion preview` shows per-file layer and the escalation token delta (`+N full`), plus a layered-savings summary; both text and `--format json`
- [x] Budget calculator accounts for layered cost, not whole-file cost (`ContextBudgetCalculator.estimateLayered`); wired into `preview`, `update`, `advance`, and `init` final-writes
- [x] Tests: `LayerResolver` (escalation, layer floor, dedup, costs), `estimateLayered`, `formatLayeredContextLines`, plain-formatter layered section, preview table markers

### Implementation notes
- New `LayerResolver` (`packages/core/src/calculators/layer-resolver.ts`) is the pure decision layer; it reuses `AiIndexManager.renderLayer0/1` + `ContextBudgetCalculator.estimateFromString` to cost reduced layers. Building blocks `read_file_layer` (Chunk 14) and `renderLayer*` (Chunk 12) are unchanged.
- NEXT_PROMPT now communicates the *plan* (which layer per file; escalated files marked "Load full"); the MCP `read_file_layer` tool serves the *content* on demand — small prompts, pull-based detail.
- Layered loading only activates when an `ai-index.yaml` exists; without one, every file is charged at whole-file cost (graceful fallback, behavior unchanged).

---

## Chunk 16 — Windsurf adapter

> **Goal:** Round out first-party adapter coverage.
> **Depends on:** Chunk 7
> **Est. sessions:** 1
> **Status:** ⬜ planned (Cursor already shipped in Chunk 7)

### Tasks
- [ ] Detect Windsurf project markers; implement the `Adapter` interface and a `WindsurfBootstrapFormatter`
- [ ] Register in `AdapterRegistry`; `--adapter windsurf` override
- [ ] Tests: fixture project, formatter output, registry resolution

---

## Risks and open questions

| Question | Status | Decision |
|---|---|---|
| Commit `.session/PLAN_N.md` to git? | Decided | Team mode yes, personal mode no |
| `@11ty/gray-matter` vs upstream `gray-matter` | Decided | Use `@11ty/gray-matter` — JS engine RCE risk |
| MCP server mode for session state | Chunk 14 | Promoted from backlog — pull-based context delivery over MCP |
| Token counting in FILE_INDEX | Decided | Use `@anthropic-ai/sdk messages.countTokens` API (free, Claude-native); `tiktoken-node` is wrong — uses OpenAI BPE encoding, incompatible with Claude |
| Multiple concurrent users same repo | Chunk 8 | Handled via team mode + `.gitattributes` |
| Plugin system beyond adapters | Backlog | Not before v1 — keep scope tight |
| `DEFAULT_CONTEXT_BUDGET` calibration | Chunk 3.5 | Validate 4,000 token default against real measured bootstrap contexts; adjust if needed |
| `ANTHROPIC_API_KEY` requirement for compact/preview | Chunk 10 | `preview` and `lint-context` are fully offline; `compact` requires key explicitly; `trim` is offline-only |

---

## Success metrics

- `npx dev-sesssion init` completes in < 60s on a 200-file project
- `NEXT_PROMPT.md` is ≤ 15 lines and fully self-contained
- A session bootstrapped from only `NEXT_PROMPT.md` needs zero follow-up questions
- `dev-sesssion status` completes in < 500ms
- `dev-sesssion preview` completes in < 5s on a 10-file context (including API token count call)
- `dev-sesssion lint-context` completes in < 1s (fully local, no API)
- Core package < 100KB unpacked (no bloat)
- Zero `npm audit` vulnerabilities (production deps) at release
- 80% statement coverage, 75% branch coverage enforced in CI
- No breaking changes to `SessionManager` API between minor versions
- A project using `dev-sesssion memory stale` can identify and remove at least one unnecessary always-include file after 5 sessions