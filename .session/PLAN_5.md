---
chunk_id: 5
title: "CLI: session lifecycle commands"
depends_on: []
tasks:
  - text: "Read `SESSION_STATE.md` + active chunk"
    status: todo
  - text: "Display: active chunk, task completion % (N/M done), files in context, days since last session"
    status: todo
  - text: "Display: always-include file count, indexed file count, FILE_INDEX health"
    status: todo
  - text: "Display: **context budget breakdown** — tokens per category (SESSION_STATE, plan chunk, always-include, context files), over-budget warning"
    status: todo
  - text: "`--json` flag: machine-readable output (for CI / scripting integration)"
    status: todo
  - text: "Warn if `NEXT_PROMPT.md` > 20 lines (\"prompt has grown — consider regenerating\")"
    status: todo
  - text: "Warn if `always-include` list > 4 files (\"creep detected\")"
    status: todo
  - text: "Warn if context budget exceeds `DEFAULT_CONTEXT_BUDGET` — suggest removing large files or splitting chunks"
    status: todo
  - text: "Interactive: show current task list with checkboxes"
    status: todo
  - text: "Mark tasks done / in-progress / todo"
    status: todo
  - text: "Add session notes (free text)"
    status: todo
  - text: "Update \"last worked\" files (auto-suggest from git status)"
    status: todo
  - text: "Regenerate `NEXT_PROMPT.md` from updated state (using `NextPromptWriter.generateWithFormatter()` with detected adapter's formatter)"
    status: todo
  - text: "Display context budget after regeneration"
    status: todo
  - text: "Run `SecretScanner` on updated files before write"
    status: todo
  - text: "Check all tasks in active chunk are `done` — warn if not, prompt to confirm force-advance"
    status: todo
  - text: "Archive completed chunk to `DONE_LOG.md`"
    status: todo
  - text: "**Compact `SESSION_STATE.md`** — call `SessionStateManager.compact()` to move completed chunk details to DONE_LOG and keep SESSION_STATE lean"
    status: todo
  - text: "Advance `SESSION_STATE.md` to next chunk"
    status: todo
  - text: "Regenerate `NEXT_PROMPT.md` for new chunk (using `PlainTextFormatter` or adapter-specific formatter)"
    status: todo
  - text: "Display: \"Advanced to PLAN_2.md. N tasks remaining in this chunk.\""
    status: todo
  - text: "Display: context budget for the new chunk"
    status: todo
  - text: "Print `NEXT_PROMPT.md` to stdout (for piping or copying)"
    status: todo
  - text: "`--copy` flag: copy to clipboard via `clipboardy`"
    status: todo
  - text: "Validate path (PathValidator) before processing"
    status: todo
  - text: "Prompt: which chunk(s) to tag, purpose description"
    status: todo
  - text: "Append to `FILE_INDEX.md` atomically"
    status: todo
  - text: "Run `FileIndexManager.audit()` — detect stale entries (deleted/moved files)"
    status: todo
  - text: "Display: stale entries with suggested action (remove or re-path)"
    status: todo
  - text: "`--fix` flag: auto-remove stale entries after confirmation"
    status: todo
  - text: "E2e: `dev-session status --json` parses correctly"
    status: todo
  - text: "E2e: `dev-session advance` when all tasks done"
    status: todo
  - text: "E2e: `dev-session advance` when tasks incomplete (warn path)"
    status: todo
  - text: "E2e: `dev-session update` marks tasks and regenerates prompt"
    status: todo
  - text: "Integration: `FileIndexManager.audit()` detects deleted files"
    status: todo
  - text: "Snapshot: `dev-session status` output format (strip ANSI before asserting)"
    status: todo
---

## Chunk 5 — CLI: session lifecycle commands

### Tasks

- [ ] Read `SESSION_STATE.md` + active chunk
- [ ] Display: active chunk, task completion % (N/M done), files in context, days since last session
- [ ] Display: always-include file count, indexed file count, FILE_INDEX health
- [ ] Display: **context budget breakdown** — tokens per category (SESSION_STATE, plan chunk, always-include, context files), over-budget warning
- [ ] `--json` flag: machine-readable output (for CI / scripting integration)
- [ ] Warn if `NEXT_PROMPT.md` > 20 lines ("prompt has grown — consider regenerating")
- [ ] Warn if `always-include` list > 4 files ("creep detected")
- [ ] Warn if context budget exceeds `DEFAULT_CONTEXT_BUDGET` — suggest removing large files or splitting chunks
- [ ] Interactive: show current task list with checkboxes
- [ ] Mark tasks done / in-progress / todo
- [ ] Add session notes (free text)
- [ ] Update "last worked" files (auto-suggest from git status)
- [ ] Regenerate `NEXT_PROMPT.md` from updated state (using `NextPromptWriter.generateWithFormatter()` with detected adapter's formatter)
- [ ] Display context budget after regeneration
- [ ] Run `SecretScanner` on updated files before write
- [ ] Check all tasks in active chunk are `done` — warn if not, prompt to confirm force-advance
- [ ] Archive completed chunk to `DONE_LOG.md`
- [ ] **Compact `SESSION_STATE.md`** — call `SessionStateManager.compact()` to move completed chunk details to DONE_LOG and keep SESSION_STATE lean
- [ ] Advance `SESSION_STATE.md` to next chunk
- [ ] Regenerate `NEXT_PROMPT.md` for new chunk (using `PlainTextFormatter` or adapter-specific formatter)
- [ ] Display: "Advanced to PLAN_2.md. N tasks remaining in this chunk."
- [ ] Display: context budget for the new chunk
- [ ] Print `NEXT_PROMPT.md` to stdout (for piping or copying)
- [ ] `--copy` flag: copy to clipboard via `clipboardy`
- [ ] Validate path (PathValidator) before processing
- [ ] Prompt: which chunk(s) to tag, purpose description
- [ ] Append to `FILE_INDEX.md` atomically
- [ ] Run `FileIndexManager.audit()` — detect stale entries (deleted/moved files)
- [ ] Display: stale entries with suggested action (remove or re-path)
- [ ] `--fix` flag: auto-remove stale entries after confirmation
- [ ] E2e: `dev-session status --json` parses correctly
- [ ] E2e: `dev-session advance` when all tasks done
- [ ] E2e: `dev-session advance` when tasks incomplete (warn path)
- [ ] E2e: `dev-session update` marks tasks and regenerates prompt
- [ ] Integration: `FileIndexManager.audit()` detects deleted files
- [ ] Snapshot: `dev-session status` output format (strip ANSI before asserting)
