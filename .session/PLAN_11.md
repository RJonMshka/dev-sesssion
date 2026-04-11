---
chunk_id: 11
title: "Session memory & analytics"
depends_on: []
tasks:
  - text: "`ContextLogEntry` type:"
    status: todo
  - text: "`CONTEXT_LOG.md` stored in `.session/` — append-only YAML frontmatter list; always gitignored"
    status: todo
  - text: "`SessionMemoryManager` in `packages/core`:"
    status: todo
  - text: "Integrate into session lifecycle: `dev-session update` and `dev-session advance` both append to `CONTEXT_LOG.md`"
    status: todo
  - text: "`StalenessReport` type: `{ path: string; sessionCount: number; lastModified: string | null; suggestion: 'remove-from-always-include' | 'remove-from-index' | 'investigate' }`"
    status: todo
  - text: "`dev-session memory show` — formatted session history (most recent N entries, configurable)"
    status: todo
  - text: "`dev-session memory stats` — aggregate stats: avg tokens/session, top 5 most-loaded files, total sessions, date range"
    status: todo
  - text: "`dev-session memory stale` — runs `analyzeStaleness()` + `detectPassiveLoads()`, outputs actionable report"
    status: todo
  - text: "`dev-session memory prune --older-than <duration>` — removes log entries older than duration (e.g., `30d`, `3mo`)"
    status: todo
  - text: "`dev-session status` — add \"Session memory\" section:"
    status: todo
  - text: "`dev-session health` — add staleness check:"
    status: todo
  - text: "Unit: `SessionMemoryManager.append()` is idempotent on repeated calls with same `sessionId`"
    status: todo
  - text: "Unit: `analyzeStaleness()` correctly identifies files not modified across N sessions"
    status: todo
  - text: "Unit: `detectPassiveLoads()` returns files in always-include with zero logged modifications"
    status: todo
  - text: "Unit: `summarizeStats()` returns correct averages on fixture log data"
    status: todo
  - text: "Integration: `dev-session update` appends entry to `CONTEXT_LOG.md`"
    status: todo
  - text: "E2e: `dev-session memory stats` on a fixture log file"
    status: todo
  - text: "E2e: `dev-session memory stale --threshold 2` flags correct files in fixture"
    status: todo
---

## Chunk 11 — Session memory & analytics

### Tasks

- [ ] `ContextLogEntry` type:
- [ ] `CONTEXT_LOG.md` stored in `.session/` — append-only YAML frontmatter list; always gitignored
- [ ] `SessionMemoryManager` in `packages/core`:
- [ ] Integrate into session lifecycle: `dev-session update` and `dev-session advance` both append to `CONTEXT_LOG.md`
- [ ] `StalenessReport` type: `{ path: string; sessionCount: number; lastModified: string | null; suggestion: 'remove-from-always-include' | 'remove-from-index' | 'investigate' }`
- [ ] `dev-session memory show` — formatted session history (most recent N entries, configurable)
- [ ] `dev-session memory stats` — aggregate stats: avg tokens/session, top 5 most-loaded files, total sessions, date range
- [ ] `dev-session memory stale` — runs `analyzeStaleness()` + `detectPassiveLoads()`, outputs actionable report
- [ ] `dev-session memory prune --older-than <duration>` — removes log entries older than duration (e.g., `30d`, `3mo`)
- [ ] `dev-session status` — add "Session memory" section:
- [ ] `dev-session health` — add staleness check:
- [ ] Unit: `SessionMemoryManager.append()` is idempotent on repeated calls with same `sessionId`
- [ ] Unit: `analyzeStaleness()` correctly identifies files not modified across N sessions
- [ ] Unit: `detectPassiveLoads()` returns files in always-include with zero logged modifications
- [ ] Unit: `summarizeStats()` returns correct averages on fixture log data
- [ ] Integration: `dev-session update` appends entry to `CONTEXT_LOG.md`
- [ ] E2e: `dev-session memory stats` on a fixture log file
- [ ] E2e: `dev-session memory stale --threshold 2` flags correct files in fixture
