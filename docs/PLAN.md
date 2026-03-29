# PLAN.md — dev-session

> A self-managing context architecture for AI-assisted coding sessions.
> Installs via `npx dev-session init`. First-class Claude Code + opencode support. Tool-agnostic by design.

---

## Project metadata

| Field | Value |
|---|---|
| Package name | `dev-session` |
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
  - Supports inline `<!-- dev-session:allow -->` bypass comment
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

#### 3f — Tests
- [ ] `SessionStateManager`: load valid, load malformed, markTaskDone idempotent, save atomic
- [ ] `FileIndexManager`: queryByChunk returns correct entries, audit detects stale, add deduplicates
- [ ] `PlanChunkManager`: loadAll sorts correctly, advance updates state, isComplete logic
- [ ] `NextPromptWriter`: enforces 15-line limit, validate catches missing fields
- [ ] `PlanParser`: splits on `##` headings, ignores `#` and `###`, handles empty sections
- [ ] `ProjectDetector`: detects each tool type, handles missing files gracefully
- [ ] `GitignoreAwareWalker`: respects `.gitignore`, groups correctly, handles empty dirs

### Key exports from `packages/core`
```typescript
export { SessionStateManager, SessionState, Task }
export { FileIndexManager, FileIndexEntry, AuditResult }
export { PlanChunkManager, PlanChunk }
export { NextPromptWriter, NextPrompt }
export { PlanParser, BoundaryResult }
export { ProjectDetector, ProjectInfo }
export { GitignoreAwareWalker, WalkedFile }
export { SessionManager }  // unified facade over all managers
```

---

## Chunk 4 — CLI: `init` command

> **Goal:** `npx dev-session init` works end-to-end for new, vibe-code, and enterprise projects
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
- [ ] E2e: `npx dev-session init --yes` on a fixture project with `PLAN.md`
- [ ] E2e: `npx dev-session init --yes` on a bare `package.json` project
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

#### `dev-session status`
- [ ] Read `SESSION_STATE.md` + active chunk
- [ ] Display: active chunk, task completion % (N/M done), files in context, days since last session
- [ ] Display: always-include file count, indexed file count, FILE_INDEX health
- [ ] `--json` flag: machine-readable output (for CI / scripting integration)
- [ ] Warn if `NEXT_PROMPT.md` > 15 lines ("prompt has grown — consider regenerating")
- [ ] Warn if `always-include` list > 4 files ("creep detected")

#### `dev-session update`
- [ ] Interactive: show current task list with checkboxes
- [ ] Mark tasks done / in-progress / todo
- [ ] Add session notes (free text)
- [ ] Update "last worked" files (auto-suggest from git status)
- [ ] Regenerate `NEXT_PROMPT.md` from updated state
- [ ] Run `SecretScanner` on updated files before write

#### `dev-session advance`
- [ ] Check all tasks in active chunk are `done` — warn if not, prompt to confirm force-advance
- [ ] Archive completed chunk to `DONE_LOG.md`
- [ ] Advance `SESSION_STATE.md` to next chunk
- [ ] Regenerate `NEXT_PROMPT.md` for new chunk
- [ ] Display: "Advanced to PLAN_2.md. N tasks remaining in this chunk."

#### `dev-session prompt`
- [ ] Print `NEXT_PROMPT.md` to stdout (for piping or copying)
- [ ] `--copy` flag: copy to clipboard via `clipboardy`

#### `dev-session index add <filepath>`
- [ ] Validate path (PathValidator) before processing
- [ ] Prompt: which chunk(s) to tag, purpose description
- [ ] Append to `FILE_INDEX.md` atomically

#### `dev-session index audit`
- [ ] Run `FileIndexManager.audit()` — detect stale entries (deleted/moved files)
- [ ] Display: stale entries with suggested action (remove or re-path)
- [ ] `--fix` flag: auto-remove stale entries after confirmation

#### Tests
- [ ] E2e: `dev-session status --json` parses correctly
- [ ] E2e: `dev-session advance` when all tasks done
- [ ] E2e: `dev-session advance` when tasks incomplete (warn path)
- [ ] E2e: `dev-session update` marks tasks and regenerates prompt
- [ ] Integration: `FileIndexManager.audit()` detects deleted files
- [ ] Snapshot: `dev-session status` output format (strip ANSI before asserting)

---

## Chunk 6 — Programmatic API (`packages/core` public surface)

> **Goal:** Clean, stable `import { SessionManager } from 'dev-session/core'` API
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

### Public API surface (what gets exported from `dev-session/core`)
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
}
```

### Claude Code adapter (`dev-session/adapters/claude`)
- [ ] Detect: check for `CLAUDE.md` or `.claude/` directory
- [ ] `setup`: generate a `CLAUDE.md` section for dev-session with bootstrap/self-update routines
- [ ] `transformState`: map active chunk notes into `CLAUDE.md` update
- [ ] `onSessionStart`: read `.claude/MEMORY.md` (first 200 lines) and inject relevant state
- [ ] `onSessionEnd`: trigger self-update routine format compatible with Claude Code's file-read pattern
- [ ] Bootstrap prompt format: uses `@`-mention syntax for file loading
- [ ] Tests: fixture `.claude/` directory, verify generated `CLAUDE.md` is valid markdown

### opencode adapter (`dev-session/adapters/opencode`)
- [ ] Detect: check for `opencode.json` or `AGENTS.md`
- [ ] `setup`: write AGENTS.md section with dev-session context protocol
- [ ] `transformState`: map state to AGENTS.md format
- [ ] `onSessionEnd`: write session-end instructions in opencode-compatible format
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
- [ ] `dev-session init --team` — prompts for team vs personal mode
- [ ] Generates `.gitignore` patch: adds `SESSION_STATE.md`, `NEXT_PROMPT.md`, `DONE_LOG.md`
- [ ] Generates `.gitattributes` entry: mark `FILE_INDEX.md` as merge=ours to reduce conflicts

#### Migration tooling
- [ ] `dev-session migrate` — handles monorepos: auto-detect `pnpm-workspace.yaml` / `nx.json` / `turborepo`
  - Prompt: one shared `.session/` or per-package `.session/`
  - Write symlinks or per-package configs as appropriate
- [ ] `dev-session import --from claude` — parse existing `CLAUDE.md` content into chunk notes
- [ ] `dev-session import --from cursor` — parse `.cursor/rules/*.mdc` frontmatter into FILE_INDEX tags

#### Health checks
- [ ] `dev-session health` — full audit command:
  - Stale FILE_INDEX entries
  - Always-include list creep (>4 files = warning)
  - NEXT_PROMPT length (>15 lines = warning)
  - DONE_LOG size (>500 lines = suggest archiving)
  - Dependency audit (`npm audit --omit=dev`)
- [ ] `dev-session health --fix` — auto-remediate where safe (remove stale index entries)

#### Large repo support
- [ ] FILE_INDEX pagination for repos with 500+ files — split into `FILE_INDEX_1.md`, `FILE_INDEX_2.md`
- [ ] `--max-files` flag on `init` to limit initial index size
- [ ] Token budget display: show estimated context window cost for current chunk's files

#### Tests
- [ ] Integration: team mode `.gitignore` patch is idempotent
- [ ] Integration: monorepo detection for pnpm, nx, turborepo workspace files
- [ ] E2e: `dev-session import --from claude` on fixture `CLAUDE.md`
- [ ] E2e: `dev-session health` on intentionally degraded `.session/`

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
- [ ] Performance benchmark: `dev-session status` must complete < 500ms on 200-file project

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
- [ ] Record 3-min demo: `npx dev-session init` on a real Next.js project
- [ ] Post to r/ClaudeAI, r/cursor, Hacker News, dev.to

---

## Risks and open questions

| Question | Status | Decision |
|---|---|---|
| Commit `.session/PLAN_N.md` to git? | Decided | Team mode yes, personal mode no |
| `@11ty/gray-matter` vs upstream `gray-matter` | Decided | Use `@11ty/gray-matter` — JS engine RCE risk |
| MCP server mode for session state | Backlog | Post-v1 — expose session as MCP tool |
| Token counting in FILE_INDEX | Backlog | v0.2 — `tiktoken-node` for accurate counts |
| Multiple concurrent users same repo | Chunk 8 | Handled via team mode + `.gitattributes` |
| Plugin system beyond adapters | Backlog | Not before v1 — keep scope tight |

---

## Success metrics

- `npx dev-session init` completes in < 60s on a 200-file project
- `NEXT_PROMPT.md` is ≤ 15 lines and fully self-contained
- A session bootstrapped from only `NEXT_PROMPT.md` needs zero follow-up questions
- `dev-session status` completes in < 500ms
- Core package < 100KB unpacked (no bloat)
- Zero `npm audit` vulnerabilities (production deps) at release
- 80% statement coverage, 75% branch coverage enforced in CI
- No breaking changes to `SessionManager` API between minor versions