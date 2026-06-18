---
chunk_id: 12
title: "Session memory & analytics"
depends_on: []
tasks:
  - text: "`ContextLogEntry` type + `CONTEXT_LOG.md` stored in `.session/` — append-only YAML frontmatter list; always gitignored"
    status: todo
  - text: "`SessionMemoryManager` in `packages/core` — `append()`, `load()`, `summarizeStats()`, `analyzeStaleness()`, `detectPassiveLoads()`, `prune()`"
    status: todo
  - text: "Integrate into session lifecycle: `dev-sesssion update` and `dev-sesssion advance` both append to `CONTEXT_LOG.md`"
    status: todo
  - text: "`StalenessReport` type: `{ path: string; sessionCount: number; lastModified: string | null; suggestion: 'remove-from-always-include' | 'remove-from-index' | 'investigate' }`"
    status: todo
  - text: "`dev-sesssion memory show` — formatted session history (most recent N entries, configurable)"
    status: todo
  - text: "`dev-sesssion memory stats` — aggregate stats: avg tokens/session, top 5 most-loaded files, total sessions, date range"
    status: todo
  - text: "`dev-sesssion memory stale` — runs `analyzeStaleness()` + `detectPassiveLoads()`, outputs actionable report"
    status: todo
  - text: "`dev-sesssion memory prune --older-than <duration>` — removes log entries older than duration (e.g., `30d`, `3mo`)"
    status: todo
  - text: "`dev-sesssion status` — add \"Session memory\" section"
    status: todo
  - text: "`dev-sesssion health` — add staleness check"
    status: todo
  - text: "Unit: `SessionMemoryManager.append()` is idempotent on repeated calls with same `sessionId`"
    status: todo
  - text: "Unit: `analyzeStaleness()` correctly identifies files not modified across N sessions"
    status: todo
  - text: "Unit: `detectPassiveLoads()` returns files in always-include with zero logged modifications"
    status: todo
  - text: "Unit: `summarizeStats()` returns correct averages on fixture log data"
    status: todo
  - text: "Integration: `dev-sesssion update` appends entry to `CONTEXT_LOG.md`"
    status: todo
  - text: "E2e: `dev-sesssion memory stats` on a fixture log file"
    status: todo
  - text: "E2e: `dev-sesssion memory stale --threshold 2` flags correct files in fixture"
    status: todo
---

## Chunk 12 — Session memory & analytics

### Tasks

- [ ] `ContextLogEntry` type + `CONTEXT_LOG.md` stored in `.session/` — append-only YAML frontmatter list; always gitignored
- [ ] `SessionMemoryManager` in `packages/core` — `append()`, `load()`, `summarizeStats()`, `analyzeStaleness()`, `detectPassiveLoads()`, `prune()`
- [ ] Integrate into session lifecycle: `dev-sesssion update` and `dev-sesssion advance` both append to `CONTEXT_LOG.md`
- [ ] `StalenessReport` type: `{ path: string; sessionCount: number; lastModified: string | null; suggestion: 'remove-from-always-include' | 'remove-from-index' | 'investigate' }`
- [ ] `dev-sesssion memory show` — formatted session history (most recent N entries, configurable)
- [ ] `dev-sesssion memory stats` — aggregate stats: avg tokens/session, top 5 most-loaded files, total sessions, date range
- [ ] `dev-sesssion memory stale` — runs `analyzeStaleness()` + `detectPassiveLoads()`, outputs actionable report
- [ ] `dev-sesssion memory prune --older-than <duration>` — removes log entries older than duration (e.g., `30d`, `3mo`)
- [ ] `dev-sesssion status` — add "Session memory" section
- [ ] `dev-sesssion health` — add staleness check
- [ ] Unit: `SessionMemoryManager.append()` is idempotent on repeated calls with same `sessionId`
- [ ] Unit: `analyzeStaleness()` correctly identifies files not modified across N sessions
- [ ] Unit: `detectPassiveLoads()` returns files in always-include with zero logged modifications
- [ ] Unit: `summarizeStats()` returns correct averages on fixture log data
- [ ] Integration: `dev-sesssion update` appends entry to `CONTEXT_LOG.md`
- [ ] E2e: `dev-sesssion memory stats` on a fixture log file
- [ ] E2e: `dev-sesssion memory stale --threshold 2` flags correct files in fixture
