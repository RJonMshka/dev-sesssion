---
chunk_id: 11
title: "Context Intelligence: preview, trim, lint & compact"
depends_on: []
tasks:
  - text: "`dev-session preview` command — assemble bootstrap context, token breakdown table, full prompt text; --format json, --copy, --no-content flags"
    status: done
  - text: "`dev-session trim` command — interactive/auto file exclusion; --budget <N>, --dry-run; writes .session/trim-overrides.json; cleared on advance"
    status: done
  - text: "`NextPromptWriter.generateWithFormatter()` respects trim overrides"
    status: done
  - text: "`ContextLinter` class in packages/core — detectDuplicates, detectSoftLanguage, detectDeadReferences; LintResult type"
    status: done
  - text: "`dev-session lint-context` command — static analysis, exits 1 on errors, no API key required"
    status: done
  - text: "`dev-session compact <file>` command — AI compaction via Haiku, backup to .session/backups/, updates FileIndexEntry.token_cost; requires ANTHROPIC_API_KEY"
    status: done
  - text: "Tests: unit (ContextLinter methods, trim overrides in NextPromptWriter), E2E (preview --format json, trim --dry-run, lint-context exit 1, compact --dry-run, compact backup)"
    status: done
---

## Chunk 11 — Context Intelligence: preview, trim, lint & compact

### Tasks

- [x] `dev-session preview` command — assemble bootstrap context, token breakdown table, full prompt text; --format json, --copy, --no-content flags
- [x] `dev-session trim` command — interactive/auto file exclusion; --budget <N>, --dry-run; writes .session/trim-overrides.json; cleared on advance
- [x] `NextPromptWriter.generateWithFormatter()` respects trim overrides
- [x] `ContextLinter` class in packages/core — detectDuplicates, detectSoftLanguage, detectDeadReferences; LintResult type
- [x] `dev-session lint-context` command — static analysis, exits 1 on errors, no API key required
- [x] `dev-session compact <file>` command — AI compaction via Haiku, backup to .session/backups/, updates FileIndexEntry.token_cost; requires ANTHROPIC_API_KEY
- [x] Tests: unit (ContextLinter methods, trim overrides in NextPromptWriter), E2E (preview --format json, trim --dry-run, lint-context exit 1, compact --dry-run, compact backup)
