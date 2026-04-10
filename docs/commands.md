# Command reference

All commands support these global flags:

| Flag | Description |
|---|---|
| `--cwd <path>` | Run in a different directory (default: `process.cwd()`) |
| `-y, --yes` | Skip prompts and use defaults |
| `--dry-run` | Show what would be written without writing anything |
| `-v, --verbose` | Detailed output |
| `--strict` | Block (exit 1) on secret detection instead of warning |
| `--adapter <name>` | Override adapter auto-detection: `claude`, `opencode`, `cursor` |

---

## dev-session init

Initialize dev-session in the current project.

```bash
dev-session init [options]
```

**Options:**

| Flag | Description |
|---|---|
| `--team` | Enable team mode (auto-patches `.gitignore` + `.gitattributes`) |
| `--max-files <n>` | Cap the number of files indexed (useful for large repos) |

**What it does:**

1. Detects existing `PLAN.md`, `CLAUDE.md`, `.cursorrules`, `AGENTS.md`
2. Splits an existing plan or scaffolds a new one interactively
3. Walks the codebase to generate `FILE_INDEX.md`
4. Writes `SESSION_STATE.md`, `ROUTINES.md`, `NEXT_PROMPT.md`
5. Optionally patches `.gitignore` (and `.gitattributes` in team mode)

---

## dev-session status

Show task progress, context budget, and health warnings for the active chunk.

```bash
dev-session status [--json]
```

Output includes:
- Task completion percentage for the active chunk
- Context budget breakdown by file group
- Any health warnings (stale files, budget over threshold, etc.)

Use `--json` for machine-readable output.

---

## dev-session update

Interactively mark tasks done and add session notes.

```bash
dev-session update
```

**What it does:**

1. Shows the current task list with checkboxes
2. Lets you mark tasks done or in-progress
3. Prompts for optional session notes
4. Detects git-modified files and suggests adding them to the index
5. Regenerates `NEXT_PROMPT.md` for the next session
6. Scans written content for secrets

---

## dev-session advance

Archive the active chunk and move to the next one.

```bash
dev-session advance
```

Run this when all tasks in the active chunk are complete. The command:

1. Marks the current chunk as completed in `SESSION_STATE.md`
2. Archives it to `DONE_LOG.md`
3. Activates the next chunk
4. Writes a fresh `NEXT_PROMPT.md`

---

## dev-session prompt

Print `NEXT_PROMPT.md` to stdout.

```bash
dev-session prompt [--copy]
```

Use `--copy` to copy to clipboard (macOS `pbcopy` / Linux `xclip`).

Without `--copy`, stdout output is suitable for piping:

```bash
dev-session prompt | pbcopy
```

---

## dev-session index

Manage the `FILE_INDEX.md`.

### Add files

```bash
dev-session index add <files...> [--chunk <n>]
```

Adds one or more files to the index, tagged to the specified chunk (default: active chunk).

```bash
dev-session index add src/core/session.ts src/core/parser.ts
dev-session index add src/api/** --chunk 3
```

### Audit stale entries

```bash
dev-session index audit [--fix]
```

Finds FILE_INDEX entries whose files no longer exist. Use `--fix` to remove them automatically.

---

## dev-session health

Full session audit with severity-graded findings.

```bash
dev-session health [--fix] [--json]
```

**Checks performed:**

| Check | Severity |
|---|---|
| Stale FILE_INDEX entries (file missing) | warning |
| SESSION_STATE not updated in > 7 days | info |
| NEXT_PROMPT.md over 15 lines | warning |
| Missing PLAN file for active chunk | error |
| Context budget over 80% | warning |
| Active chunk has no tasks | info |
| Secret scan findings in session files | warning |
| DONE_LOG.md missing (chunks were advanced without archiving) | info |
| FILE_INDEX has no entries for active chunk | warning |

Use `--fix` to automatically remove stale FILE_INDEX entries. Use `--json` for CI integration.

---

## dev-session import

Import context from other AI tools into your session.

### Import from Claude Code

```bash
dev-session import --from claude
```

Reads `CLAUDE.md` and imports each H2 section as a note in `SESSION_STATE.md`. Useful for migrating an existing CLAUDE.md-based workflow.

### Import from Cursor

```bash
dev-session import --from cursor
```

Reads `.cursor/rules/*.mdc` files and imports any file glob patterns into `FILE_INDEX.md`, tagged to the active chunk.

---

## dev-session export

Sync session state back to tool-specific config files.

### Export to Claude Code

```bash
dev-session export --to claude
```

Writes a `# dev-session` section in `CLAUDE.md` with the current active chunk and task summary. Updates the section on subsequent runs (idempotent).

### Export to Cursor

```bash
dev-session export --to cursor
```

Writes `.cursor/rules/dev-session.mdc` with the FILE_INDEX globs for the active chunk as Cursor `alwaysApply` patterns.

---

## dev-session migrate

Initialize dev-session in each package of a monorepo.

```bash
dev-session migrate [--yes]
```

Detects the workspace layout (pnpm, npm, Yarn, Nx, Turborepo) and lists all packages. In interactive mode, lets you select which packages to initialize. With `--yes`, initializes all packages.

Each package gets its own `.session/` directory. The monorepo root is not initialized.
