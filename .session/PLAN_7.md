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
