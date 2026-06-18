---
chunk_id: 10
title: "Context Intelligence: preview, trim, lint & compact"
depends_on: []
tasks:
  - text: "Assemble the full bootstrap context exactly as the active adapter's `BootstrapFormatter` would produce it"
    status: todo
  - text: "Call `TokenCounter.countFiles()` on each component: SESSION_STATE, active plan chunk, always-include files, chunk-tagged files, NEXT_PROMPT header"
    status: todo
  - text: "Render a breakdown table:"
    status: todo
  - text: "Print assembled prompt to stdout (full text below breakdown) so user can see exactly what the model will receive"
    status: todo
  - text: "`--format json` flag: machine-readable breakdown for scripting/CI"
    status: todo
  - text: "`--copy` flag: copies assembled prompt to clipboard via `clipboardy`"
    status: todo
  - text: "`--no-content` flag: show breakdown only, suppress full prompt text"
    status: todo
  - text: "Warn if `accurate: false` (no API key) — show heuristic caveat"
    status: todo
  - text: "Warn if total exceeds `DEFAULT_CONTEXT_BUDGET` — suggest `dev-sesssion trim`"
    status: todo
  - text: "Read current context file list (same source as `preview`)"
    status: todo
  - text: "Interactive mode: for each file, show token cost and prompt action:"
    status: todo
  - text: "`--budget <N>` flag: auto-suggest skipping files until under budget (largest-first)"
    status: todo
  - text: "`--dry-run` flag: show what would be excluded without modifying anything"
    status: todo
  - text: "Does NOT require `ANTHROPIC_API_KEY` — all operations are local"
    status: todo
  - text: "Session-scoped skips/truncations written to a `.session/trim-overrides.json` file (gitignored); cleared on `dev-sesssion advance`"
    status: todo
  - text: "`NextPromptWriter.generateWithFormatter()` respects trim overrides when assembling NEXT_PROMPT"
    status: todo
  - text: "`ContextLinter` class in `packages/core`:"
    status: todo
  - text: "`LintResult` type: `{ severity: 'error' | 'warning' | 'info'; rule: string; file: string; line?: number; message: string }`"
    status: todo
  - text: "`dev-sesssion lint-context` command:"
    status: todo
  - text: "No `ANTHROPIC_API_KEY` required — fully local static analysis"
    status: todo
  - text: "Accepts a single file path (validated via `PathValidator`)"
    status: todo
  - text: "Supported targets: any file in FILE_INDEX or always-include list; rejects files outside project"
    status: todo
  - text: "Backup original to `.session/backups/<filename>.<timestamp>` via `AtomicWriter` before modifying"
    status: todo
  - text: "Calls `messages.create` with a compact system prompt:"
    status: todo
  - text: "Shows before/after token count and line count diff for confirmation before writing"
    status: todo
  - text: "`--dry-run` flag: print compacted version to stdout without writing"
    status: todo
  - text: "`--model <id>` flag: override model used for compaction (default: cheapest available Haiku/Flash class model)"
    status: todo
  - text: "Explicit `ANTHROPIC_API_KEY` required — clear `CliError` with suggestion if absent"
    status: todo
  - text: "Updates `FileIndexEntry.token_cost` after writing compacted file"
    status: todo
  - text: "Unit: `ContextLinter.detectDuplicates` finds normalized duplicates across two files"
    status: todo
  - text: "Unit: `ContextLinter.detectSoftLanguage` returns correct ratio and line numbers"
    status: todo
  - text: "Unit: `ContextLinter.detectDeadReferences` flags non-existent `@mention` paths"
    status: todo
  - text: "Unit: trim overrides are respected by `NextPromptWriter`"
    status: todo
  - text: "E2e: `dev-sesssion preview --format json` on a fixture project parses correctly"
    status: todo
  - text: "E2e: `dev-sesssion trim --budget 3000 --dry-run` on a fixture over-budget project"
    status: todo
  - text: "E2e: `dev-sesssion lint-context` exits 1 on fixture with injected duplicate rules"
    status: todo
  - text: "E2e: `dev-sesssion compact --dry-run` on a large fixture file (no write, output to stdout)"
    status: todo
  - text: "Integration: `dev-sesssion compact` backup file appears in `.session/backups/`"
    status: todo
---

## Chunk 10 — Context Intelligence: preview, trim, lint & compact

### Tasks

- [ ] Assemble the full bootstrap context exactly as the active adapter's `BootstrapFormatter` would produce it
- [ ] Call `TokenCounter.countFiles()` on each component: SESSION_STATE, active plan chunk, always-include files, chunk-tagged files, NEXT_PROMPT header
- [ ] Render a breakdown table:
- [ ] Print assembled prompt to stdout (full text below breakdown) so user can see exactly what the model will receive
- [ ] `--format json` flag: machine-readable breakdown for scripting/CI
- [ ] `--copy` flag: copies assembled prompt to clipboard via `clipboardy`
- [ ] `--no-content` flag: show breakdown only, suppress full prompt text
- [ ] Warn if `accurate: false` (no API key) — show heuristic caveat
- [ ] Warn if total exceeds `DEFAULT_CONTEXT_BUDGET` — suggest `dev-sesssion trim`
- [ ] Read current context file list (same source as `preview`)
- [ ] Interactive mode: for each file, show token cost and prompt action:
- [ ] `--budget <N>` flag: auto-suggest skipping files until under budget (largest-first)
- [ ] `--dry-run` flag: show what would be excluded without modifying anything
- [ ] Does NOT require `ANTHROPIC_API_KEY` — all operations are local
- [ ] Session-scoped skips/truncations written to a `.session/trim-overrides.json` file (gitignored); cleared on `dev-sesssion advance`
- [ ] `NextPromptWriter.generateWithFormatter()` respects trim overrides when assembling NEXT_PROMPT
- [ ] `ContextLinter` class in `packages/core`:
- [ ] `LintResult` type: `{ severity: 'error' | 'warning' | 'info'; rule: string; file: string; line?: number; message: string }`
- [ ] `dev-sesssion lint-context` command:
- [ ] No `ANTHROPIC_API_KEY` required — fully local static analysis
- [ ] Accepts a single file path (validated via `PathValidator`)
- [ ] Supported targets: any file in FILE_INDEX or always-include list; rejects files outside project
- [ ] Backup original to `.session/backups/<filename>.<timestamp>` via `AtomicWriter` before modifying
- [ ] Calls `messages.create` with a compact system prompt:
- [ ] Shows before/after token count and line count diff for confirmation before writing
- [ ] `--dry-run` flag: print compacted version to stdout without writing
- [ ] `--model <id>` flag: override model used for compaction (default: cheapest available Haiku/Flash class model)
- [ ] Explicit `ANTHROPIC_API_KEY` required — clear `CliError` with suggestion if absent
- [ ] Updates `FileIndexEntry.token_cost` after writing compacted file
- [ ] Unit: `ContextLinter.detectDuplicates` finds normalized duplicates across two files
- [ ] Unit: `ContextLinter.detectSoftLanguage` returns correct ratio and line numbers
- [ ] Unit: `ContextLinter.detectDeadReferences` flags non-existent `@mention` paths
- [ ] Unit: trim overrides are respected by `NextPromptWriter`
- [ ] E2e: `dev-sesssion preview --format json` on a fixture project parses correctly
- [ ] E2e: `dev-sesssion trim --budget 3000 --dry-run` on a fixture over-budget project
- [ ] E2e: `dev-sesssion lint-context` exits 1 on fixture with injected duplicate rules
- [ ] E2e: `dev-sesssion compact --dry-run` on a large fixture file (no write, output to stdout)
- [ ] Integration: `dev-sesssion compact` backup file appears in `.session/backups/`
