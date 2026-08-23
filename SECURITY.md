# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in dev-sesssion, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainers directly or use GitHub's private vulnerability reporting feature:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Provide a detailed description of the vulnerability

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 7 days
- **Fix timeline:** Depends on severity — critical issues will be patched within 72 hours

## Security Design Principles

dev-sesssion follows these security principles by design:

1. **No JavaScript execution in frontmatter** — uses `@11ty/gray-matter` (safe fork) instead of upstream `gray-matter`
2. **Path traversal prevention** — all external paths validated through `PathValidator.safeResolvePath()` with boundary checks
3. **Atomic file writes** — all writes go through `AtomicWriter` (write to `.tmp`, then `rename()`)
4. **Secret scanning** — regex-based scanning runs before every file write via `WriteGuard`, and before the one network upload the tool performs (see *Data handling* below)
5. **No shell interpolation** — uses `execFile()` exclusively, never `exec()` with user-supplied data
6. **Prototype pollution prevention** — `Object.create(null)` for objects built from parsed data
7. **Strict schema validation** — Zod schemas with `.strict()` on all parse boundaries
8. **Typed errors** — errors never leak internal file paths; all paths sanitized with `path.relative()`

## Data handling

dev-sesssion is a local tool. It reads and writes files under the project root
and does not phone home, collect telemetry, or transmit session state anywhere.

**`dev-sesssion compact <file>` is the only command that performs network
egress.** It sends the target file's contents to the Anthropic API for
compaction, and it runs only when the user invokes it with `ANTHROPIC_API_KEY`
set.

Because `WriteGuard` protects content on its way to *disk* and not on its way
out over the *network*, `compact` runs `SecretScanner` over the file content as
a pre-flight check, before the API call:

- If any pattern matches, the command **refuses to send the file** and exits
  with a `CliError`. Nothing is uploaded and nothing is written.
- Findings are reported as a line number, the matching pattern's name, and a
  **redacted** value. The secret itself is never printed.
- `--allow-secrets` downgrades the refusal to a warning for known false
  positives. It is opt-in per invocation and never implied by `--yes`.

Git access (`dev-sesssion verify`, replay scoring) is read-only and local: every
git call goes through `execFile` with an argument array, and revision strings are
shape-checked against `[A-Za-z0-9._/^~@{}-]` before use, so a ref or path taken
from a session file cannot inject a command.

## Dependency Policy

- All dependencies must be MIT / Apache-2.0 / ISC / BSD licensed
- `ignore-scripts=true` in `.npmrc` prevents lifecycle script execution
- `npm audit --omit=dev` runs in CI on every push
- New dependencies to `packages/core` or `packages/security` require explicit review
