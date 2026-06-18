---
version: 1
last_updated: "2026-06-16"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |
| .session/SESSION_STATE.md | Active chunk + task tracking |

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| package.json | Root monorepo config |
| pnpm-workspace.yaml | Workspace definition |
| tsconfig.json | Root TypeScript config |
| biome.json | Linter/formatter config |
| vitest.config.ts | Test runner config |
| .npmrc | npm/pnpm settings |
| .nvmrc | Node version |
| .github/workflows/ci.yml | CI pipeline |
| SECURITY.md | Security policy |
| CONTRIBUTING.md | Contributor guide |
| packages/security/package.json | Security package manifest |
| packages/security/tsconfig.json | Security TypeScript config |
| packages/security/tsconfig.build.json | Security build-only tsconfig (no composite) |
| packages/security/tsup.config.ts | Security build config |
| packages/security/src/index.ts | Security entry point |
| packages/core/package.json | Core package manifest |
| packages/core/tsconfig.json | Core TypeScript config |
| packages/core/tsconfig.build.json | Core build-only tsconfig (no composite) |
| packages/core/tsup.config.ts | Core build config |
| packages/core/src/index.ts | Core entry point |
| packages/cli/package.json | CLI package manifest |
| packages/cli/tsconfig.json | CLI TypeScript config |
| packages/cli/tsconfig.build.json | CLI build-only tsconfig (no composite) |
| packages/cli/tsup.config.ts | CLI build config |
| packages/cli/src/index.ts | CLI entry point |
| packages/adapters/package.json | Adapters package manifest |
| packages/adapters/tsconfig.json | Adapters TypeScript config |
| packages/adapters/tsconfig.build.json | Adapters build-only tsconfig (no composite) |
| packages/adapters/tsup.config.ts | Adapters build config |
| packages/adapters/src/index.ts | Adapters entry point |

## Chunk 2 — Security utilities

| File | Purpose |
|---|---|
| packages/security/src/index.ts | Security exports (all modules) |
| packages/security/src/errors/security-threat.ts | SecurityThreat const enum (4 threat categories) |
| packages/security/src/errors/security-error.ts | SecurityError class + isSecurityError type guard |
| packages/security/src/errors/parse-error.ts | ParseError class + isParseError type guard |
| packages/security/src/errors/cli-error.ts | CliError class + isCliError type guard |
| packages/security/src/errors/index.ts | Error types barrel export |
| packages/security/src/validators/path-validator.ts | PathValidator — safeResolvePath + ValidatedPath branded type |
| packages/security/src/sanitizers/content-sanitizer.ts | ContentSanitizer — recursive prototype pollution key stripping |
| packages/security/src/parsers/frontmatter-parser.ts | FrontmatterParser — @11ty/gray-matter + Zod schema validation |
| packages/security/src/scanners/secret-scanner.ts | SecretScanner — 10 regex patterns, ScanResult, redacted matches |
| packages/security/src/guards/write-guard.ts | WriteGuard — scan/warn/block middleware with bypass support |
| packages/security/src/writers/atomic-writer.ts | AtomicWriter — atomic writes via write-file-atomic, mode 0o644 |
| packages/security/src/__tests__/errors.test.ts | Adversarial tests for error types (30 tests) |
| packages/security/src/__tests__/secret-scanner.test.ts | Unit tests for SecretScanner (28 tests) |
| packages/security/src/__tests__/write-guard.test.ts | Unit tests for WriteGuard (14 tests) |
| packages/security/src/__tests__/atomic-writer.test.ts | Unit tests for AtomicWriter (14 tests) |
| packages/security/src/__tests__/path-validator.adversarial.test.ts | Adversarial tests for PathValidator (26 tests) |
| packages/security/src/__tests__/path-validator.property.test.ts | Property-based (fast-check) tests for PathValidator — safety invariant + reject classes (10 tests) |
| packages/security/src/__tests__/content-sanitizer.adversarial.test.ts | Adversarial tests for ContentSanitizer (25 tests) |
| packages/security/src/__tests__/frontmatter-parser.adversarial.test.ts | Adversarial tests for FrontmatterParser (19 tests) |
| packages/security/src/__tests__/secret-scanner.adversarial.test.ts | Adversarial tests for SecretScanner (30 tests) |
| packages/security/src/__tests__/write-guard.adversarial.test.ts | Adversarial tests for WriteGuard (24 tests) |
| packages/security/src/__tests__/atomic-writer.adversarial.test.ts | Adversarial tests for AtomicWriter (22 tests) |
| packages/security/src/__tests__/index.test.ts | Smoke test for security package exports |

## Chunk 3 — Core data model

| File | Purpose |
|---|---|
| packages/core/src/index.ts | Core exports (all modules) |
| packages/core/src/schemas/task.ts | Task type + TaskSchema + TaskStatus const |
| packages/core/src/schemas/session-state.ts | SessionState type + SessionStateSchema |
| packages/core/src/schemas/file-index-entry.ts | FileIndexEntry type + AuditResult interface |
| packages/core/src/schemas/plan-chunk.ts | PlanChunk type + PlanChunkSchema |
| packages/core/src/schemas/next-prompt.ts | NextPrompt type + MAX_PROMPT_LINES + ValidationResult |
| packages/core/src/schemas/project-info.ts | ProjectInfo type + DetectedTool/ProjectType consts |
| packages/core/src/schemas/adapter-config.ts | AdapterConfig type + AdapterConfigSchema |
| packages/core/src/schemas/walked-file.ts | WalkedFile, DirectoryGroup, WalkOptions types |
| packages/core/src/schemas/boundary-result.ts | BoundaryResult interface for plan splitting |
| packages/core/src/schemas/index.ts | Schemas barrel export |
| packages/core/src/managers/session-state-manager.ts | SessionStateManager — load/save/markDone/addNote |
| packages/core/src/managers/file-index-manager.ts | FileIndexManager — load/save/query/audit |
| packages/core/src/managers/plan-chunk-manager.ts | PlanChunkManager — loadAll/loadActive/advance/archive |
| packages/core/src/managers/next-prompt-writer.ts | NextPromptWriter — generate/write/validate |
| packages/core/src/managers/routines-writer.ts | RoutinesWriter — writes ROUTINES.md |
| packages/core/src/parsers/plan-parser.ts | PlanParser — fromMarkdown/detectBoundaries/toMarkdown |
| packages/core/src/detectors/project-detector.ts | ProjectDetector — detect/hasExistingSession/getProjectType |
| packages/core/src/walkers/gitignore-aware-walker.ts | GitignoreAwareWalker — walk/groupByDirectory/estimateTokenCost |
| packages/core/src/schemas/context-budget.ts | ContextBudget type + DEFAULT_CONTEXT_BUDGET + ContextBudgetSummarySchema |
| packages/core/src/calculators/context-budget-calculator.ts | ContextBudgetCalculator — estimate/estimateFromString/formatSummary |
| packages/core/src/formatters/bootstrap-formatter.ts | BootstrapFormatter interface + BootstrapContext type |
| packages/core/src/formatters/plain-text-formatter.ts | PlainTextFormatter — default structured bootstrap format |
| packages/core/src/__tests__/index.test.ts | Smoke test for core exports (5 tests) |
| packages/core/src/__tests__/context-budget-calculator.test.ts | ContextBudgetCalculator tests (14 tests) |
| packages/core/src/__tests__/plain-text-formatter.test.ts | PlainTextFormatter tests (20 tests) |
| packages/core/src/__tests__/session-state-manager.test.ts | SessionStateManager tests (10 tests) |
| packages/core/src/__tests__/file-index-manager.test.ts | FileIndexManager tests (11 tests) |
| packages/core/src/__tests__/plan-chunk-manager.test.ts | PlanChunkManager tests (10 tests) |
| packages/core/src/__tests__/next-prompt-writer.test.ts | NextPromptWriter tests (10 tests) |
| packages/core/src/__tests__/plan-parser.test.ts | PlanParser tests (16 tests) |
| packages/core/src/__tests__/plan-parser.property.test.ts | Property-based (fast-check) tests for PlanParser — round-trip, empty/non-empty, boundary invariants (6 tests) |
| packages/core/src/__tests__/project-detector.test.ts | ProjectDetector tests (12 tests) |
| packages/core/src/__tests__/gitignore-aware-walker.test.ts | GitignoreAwareWalker tests (16 tests) |

## Chunk 3.5 — Token counting infrastructure

| File | Purpose |
|---|---|
| packages/core/src/schemas/token-counting.ts | TokenCountResult, TokenCostMap, TokenBudget, ExternalTokenCounter types |
| packages/core/src/counters/token-counter.ts | TokenCounter — create, heuristicCount, heuristicCountFromBytes; TokenCounterInstance |
| packages/core/src/__tests__/token-counter.test.ts | TokenCounter tests (26 tests) |

## Chunk 4 — CLI: init command

| File | Purpose |
|---|---|
| packages/cli/src/cli.ts | Commander program setup with global options |
| packages/cli/src/index.ts | CLI entry point + auto-run |
| packages/cli/src/commands/init.ts | Init command orchestrator (detection + migration + final writes) |
| packages/cli/src/commands/detect.ts | Detection phase — PLAN.md, tool files, package.json, .session/ |
| packages/cli/src/commands/split-plan.ts | Migration path A — split existing PLAN.md into chunks |
| packages/cli/src/commands/scaffold-plan.ts | Migration path B — interactive plan scaffolding |
| packages/cli/src/commands/generate-index.ts | Migration path C — auto-generate FILE_INDEX from codebase walk |
| packages/cli/src/commands/final-writes.ts | Final writes — SESSION_STATE, ROUTINES, NEXT_PROMPT, .gitignore |
| packages/cli/src/utils/error-handler.ts | Global error handler (CliError/ParseError/SecurityError) |
| packages/cli/src/utils/signal-handler.ts | SIGINT/SIGTERM cleanup handler |
| packages/cli/src/utils/dry-run.ts | Dry-run file write proxy |
| packages/cli/src/utils/index.ts | CLI utility barrel export |
| packages/cli/src/__tests__/cli.test.ts | CLI program tests (11 tests) |
| packages/cli/src/__tests__/detect.test.ts | Detection phase tests (13 tests) |
| packages/cli/src/__tests__/split-plan.test.ts | Split plan tests (6 tests) |
| packages/cli/src/__tests__/scaffold-plan.test.ts | Scaffold plan tests (6 tests) |
| packages/cli/src/__tests__/generate-index.test.ts | Generate index tests (6 tests) |
| packages/cli/src/__tests__/final-writes.test.ts | Final writes tests (8 tests) |
| packages/cli/src/__tests__/init-integration.test.ts | Init integration tests (3 tests) |
| packages/cli/src/__tests__/error-handler.test.ts | Error handler tests |
| packages/cli/src/__tests__/signal-handler.test.ts | Signal handler tests |
| packages/cli/src/__tests__/dry-run.test.ts | Dry-run tests |
| packages/cli/src/__tests__/index.test.ts | CLI smoke test |

## Chunk 5 — CLI: session lifecycle commands

| File | Purpose |
|---|---|
| packages/cli/src/commands/status.ts | Status command — task %, budget, warnings, --json |
| packages/cli/src/commands/update.ts | Update command — interactive task marking, notes, prompt regen |
| packages/cli/src/commands/advance.ts | Advance command — archive chunk, compact state, advance |
| packages/cli/src/commands/prompt.ts | Prompt command — print NEXT_PROMPT to stdout, --copy |
| packages/cli/src/commands/index-cmd.ts | Index commands — add files, audit stale entries |
| packages/cli/src/__tests__/status.test.ts | Status command tests (20 tests) |
| packages/cli/src/__tests__/update.test.ts | Update command tests (8 tests) |
| packages/cli/src/__tests__/advance.test.ts | Advance command tests (7 tests) |
| packages/cli/src/__tests__/prompt.test.ts | Prompt command tests (5 tests) |
| packages/cli/src/__tests__/index-cmd.test.ts | Index command tests (8 tests) |

## Chunk 6 — Adapters: Claude Code, opencode, Cursor

| File | Purpose |
|---|---|
| packages/core/src/formatters/formatter-utils.ts | Shared formatter utilities (progress, budget, chunks, trim) |
| packages/core/src/__tests__/formatter-utils.test.ts | Formatter utilities tests (14 tests) |
| packages/adapters/src/claude-bootstrap-formatter.ts | Claude Code formatter — @file mentions, "Do NOT read" excludes |
| packages/adapters/src/opencode-bootstrap-formatter.ts | opencode formatter — AGENTS.md-aware, "Exclude" directive |
| packages/adapters/src/cursor-bootstrap-formatter.ts | Cursor formatter — .cursorrules-aware, "Ignore" directive |
| packages/adapters/src/registry.ts | Adapter registry — getAdapterForTool, getFormatterForTool, getRegisteredTools |
| packages/adapters/src/index.ts | Adapters package entry point |
| packages/adapters/src/__tests__/test-helpers.ts | Shared test factories for adapter tests |
| packages/adapters/src/__tests__/claude-bootstrap-formatter.test.ts | Claude formatter tests (16 tests) |
| packages/adapters/src/__tests__/opencode-bootstrap-formatter.test.ts | opencode formatter tests (16 tests) |
| packages/adapters/src/__tests__/cursor-bootstrap-formatter.test.ts | Cursor formatter tests (16 tests) |
| packages/adapters/src/__tests__/registry.test.ts | Registry tests (14 tests) |
| packages/adapters/src/__tests__/index.test.ts | Adapters smoke tests (9 tests) |

## Chunk 7 — Adapter lifecycle hooks + CLI integration

| File | Purpose |
|---|---|
| packages/core/src/adapters/adapter.ts | Adapter interface + context types + IO helper types |
| packages/core/src/__tests__/adapter.test.ts | Adapter interface type contract tests (12 tests) |
| packages/adapters/src/claude-adapter.ts | Claude Code adapter — CLAUDE.md section, MEMORY.md reading |
| packages/adapters/src/opencode-adapter.ts | opencode adapter — AGENTS.md section generation |
| packages/adapters/src/cursor-adapter.ts | Cursor adapter — .cursorrules section generation |
| packages/adapters/src/__tests__/claude-adapter.test.ts | Claude adapter lifecycle tests |
| packages/adapters/src/__tests__/opencode-adapter.test.ts | opencode adapter lifecycle tests |
| packages/adapters/src/__tests__/cursor-adapter.test.ts | Cursor adapter lifecycle tests |
| packages/cli/src/utils/adapter-io.ts | AdapterWriteFile/ReadFile backed by AtomicWriter+PathValidator |
| packages/cli/src/utils/resolve-adapter.ts | Adapter resolution: flag → detect → fallback |

## Chunk 9 — Open-source prep & polish

| File | Purpose |
|---|---|
| .releaserc.json | semantic-release config — conventional commits, pkgRoot: packages/cli, CHANGELOG |
| .github/workflows/release.yml | Release workflow — triggered on main push, runs semantic-release |
| CHANGELOG.md | Auto-generated changelog (written by @semantic-release/changelog) |
| packages/cli/package.json | Updated: private removed, @dev-session/* moved to devDeps |
| packages/cli/tsup.config.ts | Updated: noExternal bundles @dev-session/* workspace deps into CLI dist |
| packages/adapters/package.json | Fixed: duplicate license key removed |
| tests/e2e/cli.e2e.test.ts | E2E tests — 15 subprocess tests via execa (init, status, health, prompt, index) |
| tests/helpers/run-cli.ts | execa wrapper — strips ANSI, reject:false, uses cli-runner.cjs |
| tests/helpers/cli-runner.cjs | CJS wrapper calling run() directly (not named dev-sesssion.* to avoid double-run) |
| tests/setup/e2e-global-setup.ts | Vitest globalSetup — builds CLI if dist missing before E2E |
| vitest.config.ts | Updated: globalSetup added to e2e project config |
| .github/workflows/ci.yml | Updated: build step moved before test step |
| packages/core/src/parsers/plan-parser.ts | Fixed: toMarkdown() now writes YAML frontmatter (required by PlanChunkManager) |
| packages/cli/src/commands/final-writes.ts | Fixed: added_at uses full ISO datetime, not date-only string |
| packages/cli/src/commands/export.ts | export command — --to claude (SESSION_STATE → CLAUDE.md section) and --to cursor (FILE_INDEX → .cursor/rules/dev-sesssion.mdc) |
| packages/cli/src/__tests__/export.test.ts | export command tests (19 tests) |
| README.md | Full project README — problem, how it works, quick start, commands, adapters, team mode, security, contributing |
| docs/getting-started.md | Installation, .session/ structure, first session walkthrough, advance, --yes mode |
| docs/commands.md | Full command reference for all 10 commands + global flags |
| docs/adapters.md | Claude Code / opencode / Cursor — detection, NEXT_PROMPT format, setup, export |
| docs/team-mode.md | Shared vs personal files, gitignore/gitattributes, team workflow, monorepo teams |

### Chunk 9 follow-up (2026-06-17) — audits, subprocess coverage, docs

| File | Purpose |
|---|---|
| .gitleaks.toml | gitleaks config — extends default + allowlists secret-scanner test fixtures |
| tests/coverage/collect-e2e-coverage.mjs | Runs e2e under NODE_V8_COVERAGE; c8 remaps CLI-bundle dumps → coverage/e2e/coverage-final.json |
| tests/coverage/merge-coverage.mjs | DISJOINT merge of vitest (in-process) + c8 (subprocess) coverage; per-pkg summary; enforces 80/75 gate |
| tests/e2e/lifecycle.e2e.test.ts | E2e for update/advance/export/import/health/status/prompt + status warning states (33 tests) — closed the CLI coverage gap |
| packages/adapters/src/__tests__/formatters-ai-index.test.ts | formatAiIndex across all 4 formatters: layers 0/1/2 + empty (20 tests) |
| tests/benchmarks/status-latency.ts | `status` latency benchmark — 200-file project, median < 500ms budget |
| vitest.config.ts | Updated: coverage reporter=json, reportsDirectory=coverage/unit, in-config threshold removed (merge script enforces) |
| package.json | Updated: test:coverage (build→unit→e2e→merge), test:coverage:unit/:e2e, benchmark:status; +devDeps c8, istanbul-lib-coverage |
| .github/workflows/ci.yml | Updated: gitleaks step (GITLEAKS_CONFIG=.gitleaks.toml); Test step runs `pnpm test:coverage` gate |
| AUTHORS | Project authors file |
| PROTOCOL.md | Session Protocol v1.0 spec — the `.session/` format for community adoption |
| docs/authoring-adapters.md | Guide for writing a new adapter (interface, formatter, hooks, registration, tests) |
| README.md | Updated: Documentation index section; Windsurf added to package table |

## Chunk 8 — Team mode & enterprise features

| File | Purpose |
|---|---|
| packages/core/src/detectors/monorepo-detector.ts | MonorepoDetector — detect pnpm/nx/turborepo/npm/yarn; resolve workspace packages |
| packages/core/src/__tests__/monorepo-detector.test.ts | MonorepoDetector tests (30 tests) |
| packages/core/src/checkers/health-checker.ts | HealthChecker — full session audit (9 checks), HealthReport, HealthSeverity |
| packages/cli/src/commands/migrate.ts | migrate command — detect monorepo, multiselect packages, run init per package |
| packages/cli/src/commands/health.ts | health command — display audit report, --fix stale entries, --json output |
| packages/cli/src/commands/import.ts | import command — --from claude (H2→notes) and --from cursor (.mdc globs→FILE_INDEX) |
| packages/cli/src/__tests__/monorepo-detector.test.ts | MonorepoDetector tests (30 tests) |
| packages/cli/src/__tests__/migrate.test.ts | migrate command tests (10 tests) |
| packages/cli/src/__tests__/health.test.ts | health command tests (12 tests) |
| packages/cli/src/__tests__/import.test.ts | import command tests (11 tests) |
| packages/cli/src/commands/init.ts | Updated: --team flag, --max-files flag, team mode prompt (resolveTeamMode), runInit exported |
| packages/cli/src/commands/generate-index.ts | Updated: --max-files cap after GitignoreAwareWalker.walk() |
| packages/cli/src/commands/final-writes.ts | Updated: teamMode option, patchGitattributes, auto-gitignore in team mode |
| packages/cli/src/__tests__/final-writes.test.ts | Updated: +6 team mode tests (gitattributes patch, idempotency, dry-run) |
| packages/cli/src/cli.ts | Updated: registerMigrateCommand, registerHealthCommand, registerImportCommand registered |

## Chunk 11 — Context Intelligence

| File | Purpose |
|---|---|
| packages/core/src/linters/context-linter.ts | ContextLinter — detectDuplicates, detectSoftLanguage, detectDeadReferences; LintResult type |
| packages/core/src/schemas/trim-overrides.ts | TrimOverrides schema + TrimOverrideEntry type for .session/trim-overrides.json |
| packages/core/src/managers/trim-overrides-manager.ts | TrimOverridesManager — load/save/clear/addExclusion/removeExclusion/isExcluded |
| packages/cli/src/commands/preview.ts | preview command — token breakdown table + assembled prompt; --format json, --copy, --no-content |
| packages/cli/src/commands/trim.ts | trim command — interactive/auto file exclusion; --budget <N>; writes trim-overrides.json |
| packages/cli/src/commands/lint-context.ts | lint-context command — ContextLinter static analysis, exits 1 on errors, no API key |
| packages/cli/src/commands/compact.ts | compact <file> command — AI compaction via Haiku, backup to .session/backups/, updates token_cost |
| packages/cli/src/commands/advance.ts | Updated: clears trim-overrides.json on advance |
| packages/cli/src/cli.ts | Updated: registers preview, trim, lint-context, compact commands |
| packages/cli/package.json | Updated: added @anthropic-ai/sdk + clipboardy dependencies |
| packages/core/src/__tests__/context-linter.test.ts | ContextLinter unit tests (33 tests) |
| packages/core/src/__tests__/trim-overrides-manager.test.ts | TrimOverridesManager unit tests (17 tests) |
| packages/cli/src/__tests__/preview.test.ts | renderBreakdownTable unit tests (9 tests) |
| packages/cli/src/__tests__/trim.test.ts | autoSelectExclusions unit tests (6 tests) |
| tests/e2e/context-intelligence.e2e.test.ts | E2E tests for preview, trim, lint-context, compact (19 tests) |

## Chunk 12 — Session memory & analytics

| File | Purpose |
|---|---|
| packages/core/src/schemas/context-log.ts | ContextLogEntry schema + ContextLog + ContextLogStats + StalenessReport types |
| packages/core/src/managers/session-memory-manager.ts | SessionMemoryManager — append/load/summarizeStats/analyzeStaleness/detectPassiveLoads/prune/parseDuration |
| packages/cli/src/commands/memory.ts | memory subcommand group — show/stats/stale/prune |
| packages/cli/src/commands/update.ts | Updated: appends ContextLogEntry to CONTEXT_LOG.md after each update |
| packages/cli/src/commands/advance.ts | Updated: appends ContextLogEntry to CONTEXT_LOG.md on advance |
| packages/cli/src/commands/status.ts | Updated: added "Session memory" section to output |
| packages/cli/src/commands/health.ts | Updated: added staleness check from session memory |
| packages/cli/src/cli.ts | Updated: registers memory command group |
| packages/core/src/__tests__/session-memory-manager.test.ts | SessionMemoryManager unit tests (31 tests) |
| tests/e2e/memory.e2e.test.ts | E2E tests for memory show/stats/stale/prune (12 tests) |

## Chunk 13A — Auto-extract ai-index (zero-config) [COMPLETE 2026-04-14]

| File | Purpose |
|---|---|
| packages/core/src/annotation/types.ts | ParsedSymbol, ParsedFile, AiIndex, FileEntry, SymbolEntry, SymbolSurface types |
| packages/core/src/annotation/yaml-utils.ts | Minimal YAML serializer/deserializer (no external dep, deterministic, sorted keys) |
| packages/core/src/annotation/auto-extractor.ts | AutoExtractor — extractFile (AST via @typescript-eslint/typescript-estree), extractDirectory; extracts all exported symbols + existing JSDoc summaries |
| packages/core/src/annotation/ai-index-builder.ts | AiIndexBuilder — build, merge (mtime-based), serialize (deterministic YAML, sorted keys), deserialize |
| packages/core/src/annotation/ai-index-manager.ts | AiIndexManager — load, save (atomic + SecretScanner), queryByLayer, queryByTag, queryByChunk, renderLayer0/1/2, stats |
| packages/core/src/annotation/index.ts | Annotation module barrel export |
| packages/core/src/index.ts | Updated: exports AutoExtractor, AiIndexBuilder, AiIndexManager, AiIndex, FileEntry, SymbolEntry, ParsedFile, ParsedSymbol |
| packages/cli/src/commands/index-cmd.ts | Updated: dev-sesssion index — full regen, --update (mtime-based), --dry-run, --file, --show, stats subcommand |
| packages/cli/src/commands/final-writes.ts | Updated: ai-index.yaml added to .gitignore (personal); team mode keeps it committed |
| packages/core/src/formatters/bootstrap-formatter.ts | Updated: formatAiIndex(index, layer) added to BootstrapFormatter interface |
| packages/core/src/formatters/plain-text-formatter.ts | Updated: formatAiIndex() — plain text layer 0/1/2 rendering |
| packages/adapters/src/claude-bootstrap-formatter.ts | Updated: formatAiIndex() — prose instruction block + Layer 0/1 content |
| packages/adapters/src/opencode-bootstrap-formatter.ts | Updated: formatAiIndex() — opencode style rendering |
| packages/adapters/src/cursor-bootstrap-formatter.ts | Updated: formatAiIndex() — cursor style rendering |
| packages/core/src/__tests__/auto-extractor.test.ts | AutoExtractor unit tests (all export kinds, existing JSDoc, parse error handling) — 14 tests |
| packages/core/src/__tests__/ai-index-builder.test.ts | AiIndexBuilder unit tests (build, merge add/remove/modify, serialize determinism) — 20 tests |
| packages/core/src/__tests__/ai-index-manager.test.ts | AiIndexManager unit tests (renderLayer0/1, queryByChunk, stats) — 12 tests |
| tests/e2e/ai-index.e2e.test.ts | E2e: dev-sesssion index on fixture, --update, --dry-run, stats, --show — 8 tests |
| tests/fixtures/ts-project/ | Fixture TypeScript project with existing JSDoc for E2e tests |

## Chunk 13B — @ai-* annotation refinement

| File | Purpose |
|---|---|
| packages/core/src/annotation/annotation-parser.ts | AnnotationParser — parse(commentBlock): SymbolAnnotations (@ai-surface/-summary/-layer-hint/-layer-default/-tag); collect() → FileAnnotations; allowlist-validated, null-proto, never throws |
| packages/core/src/annotation/auto-extractor.ts | Updated: resolveOverrides() calls AnnotationParser per JSDoc block; surface/summary/tags overrides applied transparently to ParsedSymbol |
| packages/core/src/annotation/index.ts | Updated: exports AnnotationParser + SymbolAnnotations/FileAnnotations/LayerHint types |
| packages/core/src/index.ts | Updated: re-exports AnnotationParser, SymbolAnnotations, FileAnnotations, LayerHint |
| packages/core/src/__tests__/annotation-parser.test.ts | AnnotationParser unit + adversarial tests (valid tags, malformed values, YAML injection, prototype pollution, determinism) — 24 tests |
| packages/core/src/__tests__/auto-extractor-annotations.test.ts | AutoExtractor×AnnotationParser integration: mixed annotated/unannotated fixture + annotation-coverage check — 5 tests |

## Chunk 14 — MCP server (basic, v1-compatible) [COMPLETE 2026-06-16]

> Built facade-in-core, not a separate `packages/mcp`. The original speculative
> file list (a standalone package with session_token auth + pid management) was
> superseded: the MCP layer reuses the existing managers via a `SessionManager`
> facade, and the server is a thin `dev-sesssion mcp` CLI command over stdio.

| File | Purpose |
|---|---|
| packages/core/src/managers/session-manager.ts | SessionManager facade — composes state/plan/file-index/ai-index managers; 6 ops; validates untrusted paths; read-only flag |
| packages/core/src/index.ts | Updated: exports SessionManager + ActiveChunkInfo/IndexQuery/MarkTaskResult types |
| packages/cli/src/mcp/server.ts | MCP server — createMcpServer(manager) + startStdioServer(); stdio transport |
| packages/cli/src/mcp/tools.ts | registerSessionTools — 6 tools mapped 1:1 to the facade; zod-validated args; sanitized errors |
| packages/cli/src/commands/mcp.ts | `dev-sesssion mcp [--read-only]` command |
| packages/cli/src/cli.ts | Updated: registers mcp command |
| packages/cli/package.json | Updated: + @modelcontextprotocol/sdk, zod deps |
| packages/core/src/__tests__/session-manager.test.ts | Facade unit tests (all 6 ops, path traversal, read-only, query validation) |
| packages/cli/src/__tests__/mcp.test.ts | MCP boundary tests via in-memory transport (tools/list, calls, traversal + read-only rejection) |

## Chunk 15 — Layered context loading (wiring) [COMPLETE 2026-06-17]

| File | Purpose |
|---|---|
| packages/core/src/calculators/layer-resolver.ts | LayerResolver.resolve — per-file effective layer (chunk→0, always-include→1, @ai-layer-default raises floor, active-task reference escalates to 2); ResolvedFileLayer/LayerResolverInput/FileLayerRole types |
| packages/core/src/calculators/context-budget-calculator.ts | Updated: estimateLayered(state, chunk, resolved[, cap]) — totals from layered file costs (chunk vs always-include split) |
| packages/core/src/formatters/formatter-utils.ts | Updated: formatLayeredContextLines(resolved, ref, maxFiles) — "Load full" + "Summaries (Ln)" lines |
| packages/core/src/formatters/bootstrap-formatter.ts | Updated: BootstrapContext.resolvedLayers? optional field |
| packages/core/src/formatters/plain-text-formatter.ts | Updated: layered Context section when resolvedLayers present |
| packages/core/src/index.ts | Updated: exports LayerResolver, formatLayeredContextLines + ResolvedFileLayer/LayerResolverInput/FileLayerRole |
| packages/adapters/src/claude-bootstrap-formatter.ts | Updated: layered Context section (@-mention refs) |
| packages/adapters/src/cursor-bootstrap-formatter.ts | Updated: layered Context section |
| packages/adapters/src/opencode-bootstrap-formatter.ts | Updated: layered Context section |
| packages/cli/src/commands/preview.ts | Updated: per-file layer marker + escalation delta (FileTokenInfo), layered budget, layered_savings, info line |
| packages/cli/src/commands/update.ts | Updated: resolves layers, layered budget, passes resolvedLayers |
| packages/cli/src/commands/advance.ts | Updated: resolves layers, layered budget, passes resolvedLayers |
| packages/cli/src/commands/final-writes.ts | Updated: resolves layers, layered budget, passes resolvedLayers (init) |
| packages/core/src/__tests__/layer-resolver.test.ts | LayerResolver unit tests (8) |
| packages/core/src/__tests__/context-budget-calculator.test.ts | Updated: estimateLayered tests (4) |
| packages/core/src/__tests__/formatter-utils.test.ts | Updated: formatLayeredContextLines tests (5) |
| packages/core/src/__tests__/plain-text-formatter.test.ts | Updated: layered Context section tests (2) |
| packages/cli/src/__tests__/preview.test.ts | Updated: layer marker + escalation delta tests (3) |

**Design note:** Built as a pure decision layer (`LayerResolver`) reusing existing managers — no separate `LayerManager`/`session.yaml`/new commands. NEXT_PROMPT communicates which layer per file; the MCP `read_file_layer` tool (Chunk 14) serves content on demand. Layering activates only when `ai-index.yaml` exists; otherwise whole-file cost (unchanged behavior).

## Chunk 16 — Windsurf adapter

| File | Purpose |
|---|---|
| packages/core/src/schemas/project-info.ts | Updated: WINDSURF added to DetectedTool enum; Zod schema includes "windsurf" |
| packages/core/src/detectors/project-detector.ts | Updated: detects .windsurfrules and .windsurf/ markers |
| packages/adapters/src/windsurf-adapter.ts | WindsurfAdapter — .windsurfrules section management with # dev-sesssion:start/end markers |
| packages/adapters/src/windsurf-bootstrap-formatter.ts | WindsurfBootstrapFormatter — plain paths, Ignore directive (mirrors CursorBootstrapFormatter) |
| packages/adapters/src/registry.ts | Updated: WINDSURF → WindsurfAdapter in ADAPTER_MAP |
| packages/adapters/src/index.ts | Updated: exports WindsurfAdapter + WindsurfBootstrapFormatter |
| packages/adapters/src/__tests__/windsurf-adapter.test.ts | Windsurf adapter lifecycle tests (16 tests) |
| packages/adapters/src/__tests__/windsurf-bootstrap-formatter.test.ts | Windsurf formatter tests |
| packages/adapters/src/__tests__/registry.test.ts | Updated: Windsurf resolution + 5 registered tools |
| packages/core/src/__tests__/project-detector.test.ts | Updated: Windsurf detection from .windsurfrules and .windsurf/ |

**Design note:** Windsurf adapter mirrors the Cursor adapter pattern (.cursorrules → .windsurfrules, same comment-style section markers). WindsurfBootstrapFormatter is identical to CursorBootstrapFormatter in behavior (plain paths, Ignore directive) — Windsurf reads .windsurfrules natively. +35 tests; 1102 total.

## Chunk 17 — BACKLOG: Cross-session intelligence (deferred)

See `.session/PLAN_17.md` for rationale and original spec reference. Do not start until 13A–16 complete.

## Chunk 18 — BACKLOG: Open ecosystem (deferred)

See `.session/PLAN_18.md` for rationale and original spec reference. Do not start until v2 is battle-tested.
