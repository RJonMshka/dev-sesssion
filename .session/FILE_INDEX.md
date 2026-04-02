---
version: 1
last_updated: "2026-03-30"
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
| packages/core/src/__tests__/project-detector.test.ts | ProjectDetector tests (12 tests) |
| packages/core/src/__tests__/gitignore-aware-walker.test.ts | GitignoreAwareWalker tests (14 tests) |
