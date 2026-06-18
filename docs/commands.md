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

## dev-sesssion init

Initialize dev-sesssion in the current project.

```bash
dev-sesssion init [options]
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

## dev-sesssion status

Show task progress, context budget, and health warnings for the active chunk.

```bash
dev-sesssion status [--json]
```

Output includes:
- Task completion percentage for the active chunk
- Context budget breakdown by file group
- Any health warnings (stale files, budget over threshold, etc.)

Use `--json` for machine-readable output.

---

## dev-sesssion update

Interactively mark tasks done and add session notes.

```bash
dev-sesssion update
```

**What it does:**

1. Shows the current task list with checkboxes
2. Lets you mark tasks done or in-progress
3. Prompts for optional session notes
4. Detects git-modified files and suggests adding them to the index
5. Regenerates `NEXT_PROMPT.md` for the next session
6. Scans written content for secrets

---

## dev-sesssion advance

Archive the active chunk and move to the next one.

```bash
dev-sesssion advance
```

Run this when all tasks in the active chunk are complete. The command:

1. Marks the current chunk as completed in `SESSION_STATE.md`
2. Archives it to `DONE_LOG.md`
3. Activates the next chunk
4. Writes a fresh `NEXT_PROMPT.md`

---

## dev-sesssion prompt

Print `NEXT_PROMPT.md` to stdout.

```bash
dev-sesssion prompt [--copy]
```

Use `--copy` to copy to clipboard (macOS `pbcopy` / Linux `xclip`).

Without `--copy`, stdout output is suitable for piping:

```bash
dev-sesssion prompt | pbcopy
```

---

## dev-sesssion index

Manage the `FILE_INDEX.md`.

### Add files

```bash
dev-sesssion index add <files...> [--chunk <n>]
```

Adds one or more files to the index, tagged to the specified chunk (default: active chunk).

```bash
dev-sesssion index add src/core/session.ts src/core/parser.ts
dev-sesssion index add src/api/** --chunk 3
```

### Audit stale entries

```bash
dev-sesssion index audit [--fix]
```

Finds FILE_INDEX entries whose files no longer exist. Use `--fix` to remove them automatically.

---

## dev-sesssion health

Full session audit with severity-graded findings.

```bash
dev-sesssion health [--fix] [--json]
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

## dev-sesssion import

Import context from other AI tools into your session.

### Import from Claude Code

```bash
dev-sesssion import --from claude
```

Reads `CLAUDE.md` and imports each H2 section as a note in `SESSION_STATE.md`. Useful for migrating an existing CLAUDE.md-based workflow.

### Import from Cursor

```bash
dev-sesssion import --from cursor
```

Reads `.cursor/rules/*.mdc` files and imports any file glob patterns into `FILE_INDEX.md`, tagged to the active chunk.

---

## dev-sesssion export

Sync session state back to tool-specific config files.

### Export to Claude Code

```bash
dev-sesssion export --to claude
```

Writes a `# dev-sesssion` section in `CLAUDE.md` with the current active chunk and task summary. Updates the section on subsequent runs (idempotent).

### Export to Cursor

```bash
dev-sesssion export --to cursor
```

Writes `.cursor/rules/dev-sesssion.mdc` with the FILE_INDEX globs for the active chunk as Cursor `alwaysApply` patterns.

---

## dev-sesssion migrate

Initialize dev-sesssion in each package of a monorepo.

```bash
dev-sesssion migrate [--yes]
```

Detects the workspace layout (pnpm, npm, Yarn, Nx, Turborepo) and lists all packages. In interactive mode, lets you select which packages to initialize. With `--yes`, initializes all packages.

Each package gets its own `.session/` directory. The monorepo root is not initialized.

---

## dev-sesssion preview

Show the assembled bootstrap context that will be sent to the AI — including a token breakdown table and the full prompt text.

```bash
dev-sesssion preview [--format json] [--no-content] [--copy]
```

**Options:**

| Flag | Description |
|---|---|
| `--format json` | Output structured JSON instead of the human-readable table |
| `--no-content` | Print only the token breakdown; suppress the assembled prompt text |
| `--copy` | Copy the full assembled prompt to clipboard |

**What it shows:**

- Token counts per component: `SESSION_STATE`, `PLAN_CHUNK`, always-include files, context files
- Whether the total is over the configured budget cap
- The full assembled prompt text (unless `--no-content`)
- A warning when token counts are heuristic (not exact)

**JSON output shape:**

```json
{
  "total_tokens": 4210,
  "budget_cap": 8000,
  "over_budget": false,
  "accurate": false,
  "heuristic_warning": "Token counts are heuristic (~4 bytes/token). Use an external counter for accuracy.",
  "components": {
    "session_state": { "tokens": 320, "file": ".session/SESSION_STATE.md" },
    "plan_chunk": { "tokens": 180, "file": ".session/PLAN_01.md" },
    "always_include": { "tokens": 950, "files": [...] },
    "context_files": { "tokens": 2760, "files": [...] },
    "excluded_files": ["src/legacy/old-api.ts"]
  },
  "prompt_text": "..."
}
```

Exits non-zero if no `.session/` directory exists.

---

## dev-sesssion trim

Reduce the context footprint by excluding files from the bootstrap prompt.

```bash
dev-sesssion trim [--budget <n>] [--dry-run] [--yes]
```

**Options:**

| Flag | Description |
|---|---|
| `--budget <n>` | Target token budget; auto-select files to exclude until total is under `n` |
| `--dry-run` | Show what would be excluded without writing anything (global flag) |
| `--yes` | Skip confirmation prompts; apply exclusions immediately |

**Modes:**

- **Budget mode** (`--budget N`): Automatically selects the largest files to exclude until the total token count is under `N`. Shows which files would be (or are) excluded.
- **Interactive mode** (no `--budget`): Presents a multi-select list of all context files so you can choose which to exclude manually.

Exclusions are saved to `.session/trim-overrides.json`. They are applied to every subsequent `preview` and context assembly until cleared.

Run `dev-sesssion advance` to clear all trim overrides and start fresh for the next chunk.

Exits non-zero if `--budget` is not a valid number or if no `.session/` directory exists.

---

## dev-sesssion lint-context

Run static analysis on context files to catch common issues before they degrade AI responses.

```bash
dev-sesssion lint-context [--json]
```

**Options:**

| Flag | Description |
|---|---|
| `--json` | Output structured JSON (useful for CI) |

**Checks performed:**

| Check | Severity |
|---|---|
| Duplicate content blocks across files (normalized 3-line windows) | warning |
| Soft / hedging language ("maybe", "possibly", "consider", "might", "could") | info |
| Dead `@mention` references (paths that no longer exist) | error |

Exits **0** when there are no error-severity findings. Exits **1** if any `error` findings are present (e.g. dead `@mention` references).

Does **not** require `ANTHROPIC_API_KEY` — all analysis is done locally.

**JSON output shape:**

```json
{
  "passed": false,
  "summary": { "errors": 1, "warnings": 0, "infos": 2, "total": 3 },
  "findings": [
    {
      "severity": "error",
      "file": "docs/architecture.md",
      "line": 14,
      "message": "Dead @mention reference: src/old-module.ts does not exist"
    }
  ]
}
```

---

## dev-sesssion compact

Use an AI model to compress a context file, reducing its token count while preserving meaning.

```bash
dev-sesssion compact <file> [--model <id>] [--dry-run] [--yes]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<file>` | Path to the file to compact (relative to project root) |

**Options:**

| Flag | Description |
|---|---|
| `--model <id>` | Model to use (default: `claude-haiku-4-5-20251001`) |
| `--dry-run` | Print compacted content to stdout without writing (global flag) |
| `--yes` | Skip confirmation prompt |

**Requires** `ANTHROPIC_API_KEY` environment variable.

**What it does:**

1. Reads the target file and counts its tokens
2. Calls the Haiku model with a compaction system prompt
3. Shows before/after token and line counts
4. Prompts for confirmation (unless `--yes` or `--dry-run`)
5. Creates a timestamped backup at `.session/backups/<filename>.<timestamp>`
6. Writes the compacted content atomically
7. Updates `token_cost` in `FILE_INDEX.md` for the file

**Example:**

```bash
# See what the compacted version would look like (no writes)
dev-sesssion compact docs/architecture.md --dry-run

# Compact with a specific model, skip confirmation
dev-sesssion compact .session/SESSION_STATE.md --yes

# Use a different model
dev-sesssion compact CLAUDE.md --model claude-haiku-4-5-20251001
```

Backups are never auto-deleted. Run `dev-sesssion advance` or remove `.session/backups/` manually to clean them up.

Exits non-zero if `ANTHROPIC_API_KEY` is unset, the file does not exist, or the API call fails.
