---
version: 1
last_updated: "2026-03-29"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |
| docs/PLAN.md | Full project plan |
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
| packages/security/tsup.config.ts | Security build config |
| packages/security/src/index.ts | Security entry point |
| packages/core/package.json | Core package manifest |
| packages/core/tsconfig.json | Core TypeScript config |
| packages/core/tsup.config.ts | Core build config |
| packages/core/src/index.ts | Core entry point |
| packages/cli/package.json | CLI package manifest |
| packages/cli/tsconfig.json | CLI TypeScript config |
| packages/cli/tsup.config.ts | CLI build config |
| packages/cli/src/index.ts | CLI entry point |
| packages/adapters/package.json | Adapters package manifest |
| packages/adapters/tsconfig.json | Adapters TypeScript config |
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
