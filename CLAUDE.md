# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- NEVER run `dev-sesssion` against this repo — `init`, `update`, `advance` and `index` would recreate `.session/`, which was deliberately removed

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

> This project planned itself in `.session/` through chunk 19, then stopped —
> chunks schedule sessions, LLDs record design, and forcing one into the other
> produced neither. The directory is gone; what was worth keeping is in
> `docs/archive/`. See "Why not .session/" in `docs/METHOD.md`.

---

## Commands

```bash
pnpm install
pnpm build              # tsup, all four packages
pnpm typecheck          # runs build first — dts feeds the downstream packages
pnpm lint               # biome check .   (lint:fix to apply)
pnpm test               # all three projects
pnpm test:unit          # packages/*/src/**/*.test.ts
pnpm test:integration   # tests/**/*.integration.test.ts
pnpm test:e2e           # tests/**/*.e2e.test.ts — spawns the built CLI, needs a build
pnpm test:coverage      # build + unit/integration + subprocess e2e, merged, gated 80/75
pnpm publint            # packaging lint, all packages
pnpm eval               # deterministic eval tier, no API key (~40s)
pnpm benchmark:status   # status latency (<500ms on 200 files)
pnpm audit --prod       # NOT `npm audit` — no package-lock, npm exits ENOLOCK
gitleaks detect --config .gitleaks.toml   # Go binary, `brew install`; not npx-runnable
```

**A single test file or case:**

```bash
pnpm vitest run tests/plan-dialects.integration.test.ts
pnpm vitest run packages/core/src/__tests__/plan-sources/registry.test.ts
pnpm vitest run --project unit -t "REQ-PS-4"     # by requirement id
```

Vitest is configured with three named projects (`vitest.config.ts`), split by
glob. `vitest run <path>` picks the right one; `--project` is only needed with
`-t`. e2e sets a 60s timeout and a global setup that builds the CLI.

---

## Architecture

One pipeline runs end to end. Understanding it is most of understanding the repo:

```
plan markdown
  │  PlanSource.detect() → confidence, across a registry   parsers/plan-sources/
  │  PlanSource.parse()
PlanChunk[]                    ← the seam: nothing downstream knows formats vary
  │  managers/ — SessionManager, PlanChunkManager, FileIndexManager
  │  calculators/ + counters/ — context budget
BootstrapContext
  │  BootstrapFormatter — one per tool, chosen from the adapter registry
  │  NextPromptWriter.validate() → write()
.session/NEXT_PROMPT.md
```

**Two registries are the extension points.** `parsers/plan-sources/registry.ts`
(`registerPlanSource`, `detectPlanSource`, `parsePlan`) decides which dialect a
plan is written in — highest confidence above `PLAN_SOURCE_MIN_CONFIDENCE` wins,
and a tie or a miss reports candidates rather than guessing.
`packages/adapters/src/registry.ts` (`registerAdapter`, `getAdapterByName`,
`getRegisteredTools`) decides output shape. Neither has a hand-maintained name
list — deriving `--adapter`'s valid names from the registry is what killed a
whole bug class where a new adapter worked via auto-detect but not via the flag.

**`formatters/formatter-utils.ts` is the single source of truth for prompt line
prefixes** (`LOAD_PREFIX`, `LOAD_FULL_PREFIX`, `SUMMARIES_PREFIX`,
`FILE_LOAD_PREFIXES`, `LAYER_SUFFIX_RE`). The formatter that emits a line, the
validator that accepts it, and `ReplayScorer` which parses it back all derive
from that module, and it is exported from the core barrel so out-of-tree
formatters import rather than hardcode. Private copies of these strings have
shipped two separate bug classes. Anything a formatter does more than once
belongs there.

**`NextPromptWriter.write()` validates before persisting.** Do not add a write
path that bypasses it — a registered third-party formatter can otherwise produce
output the writer would have refused.

**Build topology.** Only `packages/cli` is published; core, security and
adapters are `private: true` and bundled into it by tsup `noExternal`, so the
npm artifact is a single file. Consequence: a dependency of `core` is *inlined*
into the published bundle rather than installed, since tsup externalizes only
`cli`'s own dependencies. `read-version.ts` must stay at `src` depth-1 so
`../package.json` resolves in both the source tree and the dist bundle; the
version is read at runtime because semantic-release sets it after the build.

---

## Structure

```
dev-sesssion/
├── packages/
│   ├── core/       # business logic — no CLI deps, no process.argv
│   ├── cli/        # parse args → call core → format output → exit
│   ├── adapters/   # Claude Code, opencode, Cursor, Windsurf; never imports cli
│   └── security/   # PathValidator, FrontmatterParser, SecretScanner, AtomicWriter
├── docs/
│   ├── plan/       # HLD + one LLD per feature — current planning
│   └── archive/    # superseded plans; also live parser fixtures
├── evals/          # eval harness — the coverage that dogfooding used to give
└── tests/
    ├── fixtures/   # integration + e2e fixture projects
    └── helpers/    # shared test utilities
```

`docs/README.md` indexes the rest.

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
- `docs/archive/PLAN.md`, `docs/archive/PLANv2.md` and `tests/fixtures/messy-file-index/` are **live fixtures** — real, messy, hand-maintained documents that caught bugs no synthetic fixture did. Do not tidy or reformat them
- Name tests for the requirement they cover: `it("… (REQ-IDX-1)")`
- Strip ANSI before assertions (`strip-ansi`) — never snapshot colored output
- No `process.exit()` in tests — use Commander's `.exitOverride()`
- The repo directory is named `dev-sesssion`, which is exactly what the CLI's auto-run heuristic matches (`packages/cli/src/index.ts:32`). Unit and integration projects set `DEV_SESSSION_NO_AUTORUN=1` so importing the entry point does not execute it twice
- Coverage attribution must stay **disjoint**: `cli/**` and `core/src/checkers/**` come from c8 over `NODE_V8_COVERAGE` (vitest cannot instrument execa subprocesses), everything else from vitest, merged by `tests/coverage/merge-coverage.mjs`. The two collectors emit different statement maps for the same file, so overlapping them corrupts the percentages
