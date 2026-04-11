---
chunk_id: 7
title: "Adapter system: Claude Code + opencode"
depends_on: []
tasks:
  - text: "Detect: check for `CLAUDE.md` or `.claude/` directory"
    status: todo
  - text: "`setup`: generate a `CLAUDE.md` section for dev-session with bootstrap/self-update routines"
    status: todo
  - text: "`transformState`: map active chunk notes into `CLAUDE.md` update"
    status: todo
  - text: "`onSessionStart`: read `.claude/MEMORY.md` (first 200 lines) and inject relevant state"
    status: todo
  - text: "`onSessionEnd`: trigger self-update routine format compatible with Claude Code's file-read pattern"
    status: todo
  - text: "`getFormatter()` → `ClaudeBootstrapFormatter` that uses `@`-mention syntax for file loading"
    status: todo
  - text: "`ClaudeBootstrapFormatter.formatFilesToLoad()` produces `@path/to/file` syntax for surgical context injection"
    status: todo
  - text: "`ClaudeBootstrapFormatter.formatExcludes()` produces \"Do NOT read: ...\" instruction"
    status: todo
  - text: "Tests: fixture `.claude/` directory, verify generated `CLAUDE.md` is valid markdown"
    status: todo
  - text: "Tests: verify `ClaudeBootstrapFormatter.generatePrompt()` produces valid `@`-mention format"
    status: todo
  - text: "Detect: check for `opencode.json` or `AGENTS.md`"
    status: todo
  - text: "`setup`: write AGENTS.md section with dev-session context protocol"
    status: todo
  - text: "`transformState`: map state to AGENTS.md format"
    status: todo
  - text: "`onSessionEnd`: write session-end instructions in opencode-compatible format"
    status: todo
  - text: "`getFormatter()` → `OpencodeBootstrapFormatter` using opencode's context loading format"
    status: todo
  - text: "Tests: fixture `opencode.json`, verify `AGENTS.md` output"
    status: todo
  - text: "`AdapterRegistry` — auto-detects adapters based on `ProjectInfo`"
    status: todo
  - text: "`--adapter` CLI flag overrides auto-detection"
    status: todo
  - text: "Adapter resolution order: explicit flag → auto-detect → default (no adapter)"
    status: todo
  - text: "Document community adapter authoring: `AdapterConfig` contract + publishing conventions"
    status: todo
---

## Chunk 7 — Adapter system: Claude Code + opencode

### Tasks

- [ ] Detect: check for `CLAUDE.md` or `.claude/` directory
- [ ] `setup`: generate a `CLAUDE.md` section for dev-session with bootstrap/self-update routines
- [ ] `transformState`: map active chunk notes into `CLAUDE.md` update
- [ ] `onSessionStart`: read `.claude/MEMORY.md` (first 200 lines) and inject relevant state
- [ ] `onSessionEnd`: trigger self-update routine format compatible with Claude Code's file-read pattern
- [ ] `getFormatter()` → `ClaudeBootstrapFormatter` that uses `@`-mention syntax for file loading
- [ ] `ClaudeBootstrapFormatter.formatFilesToLoad()` produces `@path/to/file` syntax for surgical context injection
- [ ] `ClaudeBootstrapFormatter.formatExcludes()` produces "Do NOT read: ..." instruction
- [ ] Tests: fixture `.claude/` directory, verify generated `CLAUDE.md` is valid markdown
- [ ] Tests: verify `ClaudeBootstrapFormatter.generatePrompt()` produces valid `@`-mention format
- [ ] Detect: check for `opencode.json` or `AGENTS.md`
- [ ] `setup`: write AGENTS.md section with dev-session context protocol
- [ ] `transformState`: map state to AGENTS.md format
- [ ] `onSessionEnd`: write session-end instructions in opencode-compatible format
- [ ] `getFormatter()` → `OpencodeBootstrapFormatter` using opencode's context loading format
- [ ] Tests: fixture `opencode.json`, verify `AGENTS.md` output
- [ ] `AdapterRegistry` — auto-detects adapters based on `ProjectInfo`
- [ ] `--adapter` CLI flag overrides auto-detection
- [ ] Adapter resolution order: explicit flag → auto-detect → default (no adapter)
- [ ] Document community adapter authoring: `AdapterConfig` contract + publishing conventions
