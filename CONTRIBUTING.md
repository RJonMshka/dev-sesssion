# Contributing to dev-sesssion

## Development Setup

```bash
# Clone the repository
git clone <repo-url>
cd dev-sesssion

# Install dependencies
pnpm install

# Verify everything works
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Project Structure

```
packages/
  security/    # Security primitives — zero internal deps
  core/        # Data model, file managers — depends on security
  cli/         # CLI wrapper — depends on core + security
  adapters/    # Tool-specific adapters — depends on core
```

**Dependency rule:** `security` has zero internal deps. `core` depends on `security`. `cli` depends on `core` + `security`. `adapters` depends on `core`. Never add circular or reverse dependencies.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: documentation changes
test: adding or updating tests
refactor: code changes that neither fix a bug nor add a feature
chore: maintenance tasks
security: security-related changes
```

### Scope (optional)

Use the package name as scope: `feat(core): add SessionStateManager`

## Branch Strategy

- `main` — stable, CI-green at all times
- `feat/<name>` — feature branches
- `fix/<name>` — bug fix branches

All changes go through pull requests. No direct pushes to `main`.

## PR Checklist

Before submitting a PR, ensure:

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero violations
- [ ] `pnpm test` passes (all tiers)
- [ ] `pnpm build` succeeds
- [ ] New public functions have JSDoc comments
- [ ] Security functions have adversarial tests
- [ ] No `any` types — use `unknown` and narrow
- [ ] No `// @ts-ignore` without explanation
- [ ] Error throws use `CliError`, `ParseError`, or `SecurityError`
- [ ] File writes use `AtomicWriter`
- [ ] Path inputs validated through `PathValidator`
- [ ] Frontmatter parsed through `FrontmatterParser`

## Testing

```bash
# Run all tests
pnpm test

# Run by tier
pnpm test:unit
pnpm test:integration
pnpm test:e2e

# Run with coverage
pnpm test:coverage
```

### Testing rules

- **Unit tests**: Use `memfs` for filesystem mocking
- **Integration tests**: Use real temp dirs via `tmp-promise`, clean up in `afterEach`
- **E2E tests**: Test CLI via `execa` subprocess, never import internals
- **Never snapshot ANSI output** — strip with `strip-ansi` first
- **Never call `process.exit()`** in tests — use Commander's `.exitOverride()`

## Code Quality

- TypeScript strict mode: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- Biome for linting and formatting — run `pnpm lint:fix` to auto-fix
- Functions over 30 lines should be decomposed
- All errors use typed error classes, never raw `Error`

## Adding Dependencies

Before adding any dependency:

1. Check license (must be MIT / Apache-2.0 / ISC / BSD)
2. Check Socket.dev score
3. Check last publish date (>12 months = red flag)
4. Check transitive dependency count
5. Get explicit approval for `packages/core` or `packages/security`
