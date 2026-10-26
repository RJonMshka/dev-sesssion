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
| `--max-files <n>` | Cap the number of files indexed, in `FILE_INDEX.md` and the ai-index (useful for large repos) |
| `--chunk <id>` | Start at this chunk instead of the lowest-numbered. Lower-numbered chunks are recorded in `completed_chunks` (dated today, task statuses untouched) and get no files tagged. An id the plan does not define is an error, listing the ids it does. Without `--yes`, init asks |
| `--plan <file>` | Read this plan instead of looking for `PLAN.md` and `docs/PLAN.md`. The path is relative to the project root; one that leads outside it is refused (exit 3) before anything is written. Use it when `PLAN.md` already holds something else, such as a spec or a roadmap |

**What it does:**

1. Detects existing `PLAN.md` (or reads the `--plan` file), `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `.windsurfrules`
2. Splits an existing plan or scaffolds a new one interactively. With no plan,
   it says where it looked and how to write one, check it with `plan check`,
   and pass it with `--plan`. Under `--yes` it still exits 0 with one
   placeholder chunk, and says so
3. Walks the codebase to generate `FILE_INDEX.md`. A file is tagged
   to a chunk only when the plan names it for that chunk — by path
   (`src/utils.ts`) or by a basename no other file shares (`utils.ts`) — either
   in one of the chunk's unfinished tasks, or elsewhere in its section: a fenced
   "Key Files" block, a backticked path in a numbered step, or a bare path
   containing `/`. Brace groups expand (`layout/{Sidebar,Header}.tsx`); globs and
   directories are skipped; a chunk whose tasks are all done tags nothing. Files
   the plan never names are left out of `FILE_INDEX.md`; the ai-index still
   reaches them. Tagging is the same with or without `--yes` and asks no
   question: a file is never tagged because of the directory it is in. Tag a
   file by hand with `index add`
   - Each chunk's `PLAN_N.md` keeps the paths it named (`files`) and the rest of
     its section — goal, numbered steps, file list — as `brief`. The prompt points
     at it with a `Plan:` line. Checkboxes remain the tracked tasks
   - Paths the active chunk names that are not on disk yet go on a
     `Not on disk yet:` line, and the existing files beside them are loaded as
     summaries (not written to `FILE_INDEX.md`)
4. Builds `ai-index.yaml`, so the first prompt can focus the units your tasks
   name. If that fails (for example `--strict` refusing a secret), init warns and
   carries on without it
5. Writes `SESSION_STATE.md`, `ROUTINES.md`, `NEXT_PROMPT.md`
6. Optionally patches `.gitignore` (and `.gitattributes` in team mode)

---

## dev-sesssion plan check

Report whether `init` would read a plan, and how — without running `init` and
without writing any file. Use it after writing or editing a plan.

```bash
dev-sesssion plan check <file> [--json]
```

`<file>` is relative to the project root (`--cwd`); a path outside it is
rejected. The report names the plan format chosen and every format's score,
each chunk (id, title, task count, whether it has a goal or steps besides its
tasks, the paths it names), every section skipped and why, and dependencies on
chunks the plan does not define.

**Exit code:** `0` when the plan yields chunks and `init` would drop no task;
`1` when it yields none, no format recognizes it, or a skipped section holds
tasks. A skipped section with no tasks (an `## Overview`) does not fail it.

**`--json`** prints one document and nothing else:

```json
{
  "ok": true,
  "source": { "name": "headings", "confidence": 0.95 },
  "candidates": [
    { "name": "headings", "confidence": 0.95, "reason": "2 numbered h2 heading(s)" },
    { "name": "task-list", "confidence": 0, "reason": "document has headings" }
  ],
  "chunks": [
    { "id": 1, "title": "Client", "taskCount": 1, "hasBrief": true, "namedPaths": ["src/client.ts"] }
  ],
  "excluded": [],
  "warnings": []
}
```

`source` is `null` when no format recognizes the document; `candidates` still
lists every score.

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

**Warnings and what to do about them:**

| Warning | What it means | What to do |
|---|---|---|
| `NEXT_PROMPT.md has N lines (max 20)` | The prompt grew past the cap — the max shown is your configured `max_prompt_lines` | Run `dev-sesssion update` to regenerate |
| `always-include list has N files` | Too many "always load" files | Tighten the list; move some to chunk tags |
| `Context budget exceeded` | The session will be token-heavy | Remove large files or split the chunk |
| `All tasks done` | The chunk is complete | Run `dev-sesssion advance` |

**`--json` output:**

```json
{
  "active_chunk": 3,
  "chunk_title": "Billing integration",
  "session_id": "chunk-3-billing",
  "last_updated": "2026-04-07",
  "tasks": { "total": 11, "done": 6, "in_progress": 2, "todo": 3, "percent_complete": 55 },
  "files": { "always_include": 2, "indexed": 54, "context": 8 },
  "budget": {
    "total_tokens": 3840,
    "capped_tokens": 2890,
    "always_include_tokens": 950,
    "budget_cap": 4000,
    "over_budget": false,
    "accurate": false
  },
  "warnings": [],
  "days_since_last_session": 0
}
```

`budget_cap` (default 4,000 estimated tokens) caps what the active chunk brings
into context: `SESSION_STATE.md`, the plan chunk, and the chunk's files at the
layer they load. That figure is `capped_tokens`, the number on the prompt's
`Budget:` line, and `over_budget` compares it with the cap; `preview` and
`health` judge the same one. Always-include files such as `CLAUDE.md` load in
every chunk, so no trim or split can reduce them — they are reported as
`always_include_tokens`, beside the cap rather than against it, and
`total_tokens` is the two together. `SESSION_STATE.md` and the plan chunk (brief
included) are counted from the text written for them, and a file without an
ai-index entry at its measured size.
A `memory` object with session-log aggregates is included when
`.session/CONTEXT_LOG.md` exists, and `days_since_last_session` is `null` when
`last_updated` cannot be parsed.

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
3. Activates the next chunk — the lowest chunk id above the current one, so
   chunk `3.5` follows `3`, and a plan numbered `1, 3` goes from 1 to 3
4. Writes a fresh `NEXT_PROMPT.md`

On the highest-numbered chunk it reports that all chunks are complete and
exits 0 without changing anything.

If the active chunk still has open tasks, `advance` asks before moving on.
`--yes` (global) skips the question and advances anyway. When stdin is not a
terminal, as under a script or a coding harness, there is nobody to ask: it
exits 1 without changing anything and names `--yes` as the override.

| Option | Description |
|---|---|
| `--json` | Print the result as one JSON document on stdout; progress messages go to stderr |

`--json` output, for a harness driving the loop:

```json
{
  "archivedChunkId": 1,
  "newChunkId": 2,
  "newChunkTitle": "Core",
  "tasksRemaining": 1,
  "forceAdvanced": true,
  "allChunksComplete": false
}
```

Stop when `allChunksComplete` is `true`. In that case `newChunkId` equals
`archivedChunkId` and nothing was archived.

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

Run on its own, `dev-sesssion index` rebuilds `.session/ai-index.yaml`
(`--update` merges into the existing index) and then regenerates
`NEXT_PROMPT.md` and `context-manifest.json` from it, so the prompt focuses
units added since the last run. `--dry-run` writes none of them.

TypeScript and JavaScript files are indexed, and so are `.vue` and `.svelte`
components: their `<script>` blocks are parsed in place, so units carry the
component file's own line numbers.

The subcommands below manage `FILE_INDEX.md`.

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

## dev-sesssion symbols

Shows what the ai-index holds — the data prompts are built from — and whether
that record still matches the code. Reads only: it writes nothing and does not
regenerate the prompt.

```bash
dev-sesssion symbols <path> [--json]
dev-sesssion symbols --name <name> [--json]
```

`symbols <path>` prints the file's token cost and module summary, each export's
signature and line, and each code unit's id, kind, line range, token cost and
share of the file. Summaries come from doc comments in the file, so they are
printed as quotations (`quoted: "…"`).

```
src/utils.ts · 1,468 tokens · current
quoted: "Request parsing helpers."
Exports
  L12  export function parseBody(req: Request): Body — quoted: "Parses a JSON body."
Units
  parseBody          function  L10-48    210 tok  14%  exported
  normalizeHeaders   function  L50-61     58 tok   4%
```

`symbols --name <name>` lists every unit whose id, or member name after the
last `.`, is exactly `<name>` (no substring or fuzzy matching), as
`path#id:start-end`. `would focus` marks the declarations a task naming
`` `<name>` `` would focus. The decision comes from the same code the prompt
uses. When a name is declared more than once, each declaration shows its usage
evidence. If none or too many have evidence, the name is ambiguous and focuses
nothing. A plain word such as `helper` counts in a task only between backticks,
and the output says so. A prompt focuses at most 5 units across all its tasks,
so a unit marked `would focus` can still be crowded out by other tasks.

Each file is checked against the hash recorded when it was indexed:

| Mark | Meaning |
|---|---|
| `current` | The file matches its record |
| `STALE — run dev-sesssion index` | The file changed since indexing |
| `removed since indexing` | The file no longer exists |
| `freshness unknown` | The index predates file hashes |

Exit codes: `0` when a report prints, stale or not; `1` when `--name` matches
nothing, when there is no index or `.session/`, when the file is not indexed,
or when the path is outside the project. `--json` prints one JSON document with
`freshness` on every file; summaries stay raw strings there.

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
| Context budget over the cap — the same figure the prompt's `Budget:` line shows | `BUDGET_EXCEEDED` | warning |
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
| A unit or file the prompt points at has changed or been removed since `context-manifest.json` was written | `STALE_CONTEXT` | warning |
| A focused unit is unchanged, but its line range has moved | `MOVED_CONTEXT` | info |

The two context checks read the working tree, not git history, so they also run
outside a repository. Apart from them, outside a git repository the command
degrades to a single informational finding rather than failing. It exits non-zero only on an error-severity finding.

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
its own. Fix it by tagging the missed files to the chunk — `--verbose` lists them
by name. High waste alongside healthy recall is a tuning problem rather than a
bug: you are paying tokens for context nothing reads, so trim the chunk or run
`dev-sesssion trim`. Chasing precision to 100% is counter-productive — a little
over-inclusion is far cheaper than an agent hunting for a file it was never told
about.

Scoring runs entirely on local git history — no API key, no model call.

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

Each note is a quotation of the section's prose — fenced code, tables and rules are left out, list markers stripped, and a section with no prose makes no note. It is attributed to the file and capped at 240 characters, cut at a word with an ellipsis:

```
Quoted from CLAUDE.md § "Conventions": "Use tabs, not spaces."
```

The prompt shows it as quoted text from `CLAUDE.md`, not as your own note, so an agent can tell the two apart. Running the import again adds nothing new. A note left by an older version — the unquoted `CLAUDE.md: <title> — …` form, or 2.4.x's raw 120-character excerpt — is replaced with the current one.

The `<!-- dev-sesssion:start -->` … `<!-- dev-sesssion:end -->` block that `init` writes into `CLAUDE.md` is the tool's own text and is never imported; notes that 2.4.1 and earlier imported from it are removed. When the import changes `SESSION_STATE.md`, `NEXT_PROMPT.md` is regenerated (not under `--dry-run`).

### Import from Cursor

```bash
dev-sesssion import --from cursor
```

Reads `.cursor/rules/*.mdc` files and imports any file glob patterns into `FILE_INDEX.md`, tagged to the active chunk. When that adds files, `NEXT_PROMPT.md` is regenerated.

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
- The full assembled prompt text (unless `--no-content`) — the same prompt `update`, `index` and the other commands write to `NEXT_PROMPT.md` for the current `.session/`
- A warning when token counts are heuristic (not exact)

**JSON output shape:**

```json
{
  "total_tokens": 3210,
  "capped_tokens": 2260,
  "always_include_tokens": 950,
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
is judged against `capped_tokens` — everything but the always-include files,
which the table shows on their own row and leaves out of the capped line.

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

Exclusions are saved to `.session/trim-overrides.json`. Every command that writes `NEXT_PROMPT.md` applies them, and so does `preview`: an excluded file is left out of the load lines, out of any `Focus (read_unit):` unit in it, and out of `context-manifest.json`. `trim` regenerates `NEXT_PROMPT.md` itself when one exists (not under `--dry-run`), so the change takes effect immediately.

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
| `get_active_chunk` | Active chunk ID, title, and its tasks — each task's status the higher of what `PLAN_<n>.md` and `SESSION_STATE.md` record |
| `list_context_files` | Files in `FILE_INDEX.md`, optionally filtered to a chunk |
| `read_file_layer` | Render a file at layer 0 (summary), 1 (signatures), or 2 (full source) |
| `read_unit` | Return one function, method, class or type by `path#id` — the refs on the prompt's `Focus (read_unit):` line. Reads the file as it is now, so the range is current even after edits |
| `query_index` | Query the ai-index by exactly one of tag, chunk, or layer |
| `mark_task_done` | Mark a task of the active chunk done by exact text match; the next regenerated prompt counts it — disabled in read-only mode |
| `get_next_prompt` | Read the raw contents of `NEXT_PROMPT.md` |
| `check_plan` | Check a plan file by path, the way `init` would read it; returns the same report as `plan check --json` and writes nothing |

Requires a `.session/` directory. The server never exposes `advance` or `init`:
they rewrite session state, and an orchestrator runs them through the CLI
(`advance --json`) so `--read-only` keeps meaning what it says.

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
