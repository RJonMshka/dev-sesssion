# Command reference

All commands support these global flags:

| Flag | Description |
|---|---|
| `--cwd <path>` | Run in a different directory (default: `process.cwd()`) |
| `-y, --yes` | Skip prompts and use defaults |
| `--dry-run` | Show what would be written without writing anything |
| `-v, --verbose` | Detailed output |
| `--strict` | Block (exit 1) on secret detection instead of warning |
| `--adapter <name>` | Override adapter auto-detection: `claude`, `opencode`, `cursor`, `windsurf` |

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

1. Detects existing `PLAN.md`, `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.windsurfrules`
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
- Any health warnings (stale files, budget over the cap, an over-long
  `NEXT_PROMPT.md` measured against the session's `max_prompt_lines`, and a
  reminder to `advance` when every task is done)

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

### Add a file

```bash
dev-sesssion index add <filepath>
```

Adds a single file to the index. Interactively prompts for the chunk tags and a
one-line purpose; with the global `--yes` flag it tags the file to the active
chunk and skips the prompts.

```bash
dev-sesssion index add src/core/session.ts
dev-sesssion index add src/core/parser.ts --yes
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

| Check | Code | Severity |
|---|---|---|
| SESSION_STATE.md unreadable or invalid | `SESSION_STATE_INVALID` | error |
| Missing PLAN file for active chunk | `PLAN_MISSING` | error |
| FILE_INDEX.md unreadable or malformed | `FILE_INDEX_INVALID` | error |
| Stale FILE_INDEX entries (file missing) | `STALE_INDEX_ENTRIES` | warning |
| FILE_INDEX references chunks with no plan file | `MISSING_CHUNK_FILES` | warning |
| More than 4 always-include files | `ALWAYS_INCLUDE_CREEP` | warning |
| Context budget over the cap | `BUDGET_EXCEEDED` | warning |
| NEXT_PROMPT.md missing | `PROMPT_MISSING` | warning |
| NEXT_PROMPT.md over the configured cap (default 20) | `PROMPT_TOO_LONG` | warning |
| FILE_INDEX has more than 500 entries | `FILE_INDEX_LARGE` | info |
| All tasks in the active chunk are done | `ALL_TASKS_DONE` | info |
| SESSION_STATE not updated in > 7 days | `SESSION_STALE` | info |

`PROMPT_TOO_LONG` is measured against `max_prompt_lines` from `SESSION_STATE.md`
frontmatter when set, and against the default of 20 otherwise. `dev-sesssion
status` applies the same cap, so the two commands cannot disagree.

Use `--fix` to automatically remove stale FILE_INDEX entries — the only fixable
issue. Use `--json` for CI integration.

---

## dev-sesssion verify

Reconciles what the session files *claim* against what git actually shows.

`health` asks whether the session files are internally consistent. `verify` asks
whether they are true — a task marked done with no commit behind it, or a
`last_worked_files` entry no diff ever touched, is state that has drifted from
reality, and the next prompt will inherit the drift.

```bash
dev-sesssion verify [--replay] [--limit <n>] [--lookback <n>] [--json]
```

**Checks performed:**

| Check | Code | Severity |
|---|---|---|
| Tasks marked done with no commit and no working-tree change | `DONE_WITHOUT_EVIDENCE` | error |
| `last_worked_files` with no git evidence behind them | `UNBACKED_WORKED_FILE` | warning |
| Modified files absent from FILE_INDEX.md | `UNINDEXED_CHANGE` | warning |
| Session files with uncommitted changes | `UNCOMMITTED_SESSION` | info |
| Not a git repository (history checks skipped) | `NOT_A_REPO` | info |

Outside a git repository the command degrades to a single informational finding
rather than failing. It exits non-zero only on an error-severity finding.

### Replay scoring

`--replay` measures prompt quality instead of merely checking it. Every commit
that rewrote `NEXT_PROMPT.md` marks a session boundary: the prompt declares
which files the next session should load, and the commits that follow show
which files it really touched.

```bash
dev-sesssion verify --replay --verbose
```

| Metric | Meaning |
|---|---|
| **Recall** | Share of files the session needed that the prompt named. Low recall means the agent had to rediscover context. |
| **Precision** | Share of files the prompt named that the session used. |
| **Waste** | Share of declared context never touched — tokens loaded for nothing. |

Recall is the number to watch: a missed file is context the agent had to find on
its own. Scoring runs entirely on local git history — no API key, no model call.

Replay requires `.session/NEXT_PROMPT.md` to be **tracked by git**. Both the
personal and team `.gitignore` patches written by `init` exclude it, so replay
is unavailable out of the box — the command reports why instead of showing a
silent zero. To enable it, remove `.session/NEXT_PROMPT.md` from `.gitignore`
and commit the file; every subsequent session boundary then becomes scorable.

Paths under `.session/`, `docs/`, and `CHANGELOG.md` are excluded from scoring —
they are bookkeeping, not the work being measured.

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
  "total_tokens": 3210,
  "budget_cap": 4000,
  "over_budget": false,
  "accurate": false,
  "components": {
    "session_state": { "tokens": 320, "file": ".session/SESSION_STATE.md" },
    "plan_chunk": { "tokens": 180, "file": ".session/PLAN_3.md" },
    "always_include": { "tokens": 950, "files": [] },
    "context_files": { "tokens": 1760, "files": [] },
    "excluded_files": ["src/legacy/old-api.ts"]
  },
  "layered_savings": 0,
  "prompt_text": "...",
  "heuristic_warning": true
}
```

`heuristic_warning` is a boolean — it is `true` whenever any count came from the
character-based heuristic rather than a real tokenizer (the inverse of
`accurate`). `layered_savings` is the token count saved by layered loading versus
loading every file in full. `budget_cap` defaults to 4,000 estimated tokens and
covers the *generated bootstrap context*, not the source files the AI loads
afterwards.

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

Each finding carries a `severity`, the `file` and `line` it was found on, and a
message.

Info-severity findings are hidden in the default text output — pass the global
`-v, --verbose` flag to see them. `--json` always includes every finding.

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

## dev-sesssion memory

Session memory analytics, backed by the append-only `.session/CONTEXT_LOG.md`.

```bash
dev-sesssion memory show [-n <number>]
dev-sesssion memory stats [--json]
dev-sesssion memory stale [--threshold <number>]
dev-sesssion memory prune --older-than <duration>
```

| Subcommand | Options | What it does |
|---|---|---|
| `show` | `-n, --limit <number>` (default `10`) | Print the most recent session log entries |
| `stats` | `--json` | Aggregate stats across the logged sessions |
| `stale` | `--threshold <number>` (default `3`) | List files loaded in at least N sessions but never modified |
| `prune` | `--older-than <duration>` (required) | Drop entries older than a duration, e.g. `30d`, `3mo`, `1y` |

`prune` honours the global `--dry-run` flag.

---

## dev-sesssion mcp

Start an MCP server over stdio that serves `.session/` state to an agent, so a
tool that speaks MCP can read the session directly instead of being handed a
pasted prompt.

```bash
dev-sesssion mcp [--read-only]
```

**Options:**

| Flag | Description |
|---|---|
| `--read-only` | Disable mutating tools (`mark_task_done`) |

**Tools exposed:**

| Tool | What it does |
|---|---|
| `get_active_chunk` | Active chunk ID, title, and live task list |
| `list_context_files` | Files in `FILE_INDEX.md`, optionally filtered to a chunk |
| `read_file_layer` | Render a file at layer 0 (summary), 1 (signatures), or 2 (full source) |
| `query_index` | Query the ai-index by exactly one of tag, chunk, or layer |
| `mark_task_done` | Mark a task done by exact text match — disabled in read-only mode |
| `get_next_prompt` | Read the raw contents of `NEXT_PROMPT.md` |

Requires a `.session/` directory.

---

## dev-sesssion compact

Use an AI model to compress a context file, reducing its token count while preserving meaning.

```bash
dev-sesssion compact <file> [--model <id>] [--allow-secrets] [--dry-run] [--yes]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<file>` | Path to the file to compact (relative to project root) |

**Options:**

| Flag | Description |
|---|---|
| `--model <id>` | Model to use (default: `claude-haiku-4-5-20251001`) |
| `--allow-secrets` | Send the file even if the pre-flight secret scan flags it |
| `--dry-run` | Print compacted content to stdout without writing (global flag) |
| `--yes` | Skip confirmation prompt |

**Requires** `ANTHROPIC_API_KEY` environment variable.

**What it does:**

1. Reads the target file and counts its tokens
2. Scans the content for secrets and refuses to send if any match (see below)
3. Calls the Haiku model with a compaction system prompt
4. Shows before/after token and line counts
5. Prompts for confirmation (unless `--yes` or `--dry-run`)
6. Creates a timestamped backup at `.session/backups/<filename>.<timestamp>`
7. Writes the compacted content atomically
8. Updates `token_cost` in `FILE_INDEX.md` for the file

**Pre-flight secret scan:**

`compact` is the only command that sends data over the network, so the file
content is run through `SecretScanner` *before* the API call. If anything
matches, the command aborts and prints each finding as a line number, a pattern
name, and a redacted value — the secret itself is never echoed. The file is not
sent and nothing is written.

Pass `--allow-secrets` to downgrade the refusal to a warning and send anyway —
use it only when the matches are known false positives.

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
