---
chunk_id: 14
title: "MCP server (basic, v1-compatible)"
depends_on: [6, "13a"]
tasks:
  - text: "`packages/mcp/` package scaffold — `package.json`, `tsconfig.json`, `tsup.config.ts`; imports from `packages/core` only (no direct CLI imports)"
    status: todo
  - text: "`packages/mcp/server.ts` — MCP server entry point, `stdio` transport; reads `--cwd` flag for project root; writes `.session/mcp.pid` on start, removes on clean exit"
    status: todo
  - text: "MCP tool `get_session_context` — returns: active chunk title, task list (all tasks with status), NEXT_PROMPT.md content, current token budget summary; `include_tasks: boolean` param; no layered context yet (that's Chunk 15)"
    status: todo
  - text: "MCP tool `list_tasks` — returns tasks array with text + status for active chunk"
    status: todo
  - text: "MCP tool `mark_task_done` — finds task by text substring match; requires `session_token`; updates SESSION_STATE.md via `SessionStateManager`"
    status: todo
  - text: "MCP tool `mark_task_in_progress` — same as mark_task_done but sets in-progress status"
    status: todo
  - text: "MCP tool `query_ai_index` — searches `ai-index.yaml` by symbol name, file path, or `@ai-tag`; returns summary + signature + layer hint; returns 404-style error if no index exists yet"
    status: todo
  - text: "MCP tool `get_context_budget` — returns token budget breakdown (always-include, chunk files, total, budget cap, % used)"
    status: todo
  - text: "Security: `session_token` — UUID written to `.session/mcp-token.txt` (mode 0o600) on server start; all write tools validate it; token regenerated on each `mcp start`"
    status: todo
  - text: "Security: all `path` inputs through `PathValidator.safeResolvePath()`; error responses sanitize absolute paths; audit log at `.session/mcp-audit.log` with 10MB rotation (rename to `.1` on overflow)"
    status: todo
  - text: "Security: rate limit 60 tool calls/min/connection — returns structured error, does not crash server; no arbitrary connection kill"
    status: todo
  - text: "`dev-session mcp start` — starts server process, writes pid, validates no existing pid before starting"
    status: todo
  - text: "`dev-session mcp config` — prints JSON block for `claude_desktop_config.json`; also prints CLAUDE.md snippet"
    status: todo
  - text: "`dev-session mcp ping` — starts server ephemerally, calls list-tools, prints result, exits"
    status: todo
  - text: "`ClaudeBootstrapFormatter.formatMcpBlock(mcpConfig)` — generates CLAUDE.md section; `dev-session update` auto-appends when `.session/mcp-token.txt` exists"
    status: todo
  - text: "Unit: `mark_task_done` with invalid `session_token` returns auth error"
    status: todo
  - text: "Unit: path traversal via `path` input to `query_ai_index` rejected by `PathValidator`"
    status: todo
  - text: "Unit: rate limiter returns structured error after 60 calls/60s"
    status: todo
  - text: "Unit: `query_ai_index` returns 404-style error when no `ai-index.yaml` exists"
    status: todo
  - text: "Integration: MCP server starts, registers all tools, responds to list-tools"
    status: todo
  - text: "Integration: `get_session_context` returns correct task list from SESSION_STATE.md"
    status: todo
  - text: "E2e: `dev-session mcp config` produces valid JSON block"
    status: todo
  - text: "E2e: `dev-session mcp start` writes `mcp.pid`; SIGINT removes pid and exits cleanly"
    status: todo
---

## Chunk 14 — MCP server (basic, v1-compatible)

**Goal:** Expose dev-session's session state as MCP tools so AI agents can read and update session context
programmatically. This chunk ships a **v1-compatible** server — it works with the existing flat file model.
Layered context tools (`get_file_at_layer`) are added in Chunk 15 when that infrastructure exists.

**Why MCP before layers:** MCP is the highest-leverage v2 feature and has no dependency on the annotation or
layered context system. A Claude Code agent can call `get_session_context` and `mark_task_done` today.
Deferring it until after Chunk 15 costs 2+ chunks of user value for no technical reason.

### Architecture

```
packages/mcp/
  server.ts
  tools/
    session.ts    # get_session_context
    tasks.ts      # list_tasks, mark_task_done, mark_task_in_progress
    index.ts      # query_ai_index (basic — no layers yet)
    budget.ts     # get_context_budget
```

### Tools in this chunk

| Tool | Auth | What it returns |
|---|---|---|
| `get_session_context` | none | chunk title, tasks, NEXT_PROMPT content, budget summary |
| `list_tasks` | none | tasks array with status |
| `mark_task_done` | session_token | updates SESSION_STATE.md |
| `mark_task_in_progress` | session_token | updates SESSION_STATE.md |
| `query_ai_index` | none | symbol summary + signature + layer hint (or 404 if no index) |
| `get_context_budget` | none | token breakdown + % used |

*`get_file_at_layer` is added in Chunk 15 when LayerManager exists.*

### Tasks

- [ ] `packages/mcp/` package scaffold
- [ ] `packages/mcp/server.ts` — stdio transport, `--cwd` flag, pid management
- [ ] MCP tool: `get_session_context`
- [ ] MCP tool: `list_tasks`
- [ ] MCP tool: `mark_task_done` (session_token auth)
- [ ] MCP tool: `mark_task_in_progress`
- [ ] MCP tool: `query_ai_index` (basic, 404 if no index)
- [ ] MCP tool: `get_context_budget`
- [ ] Security: session_token (0o600), path validation, audit log with 10MB rotation
- [ ] Security: rate limit 60/min/connection (structured error, no crash)
- [ ] `dev-session mcp start` / `mcp config` / `mcp ping`
- [ ] `ClaudeBootstrapFormatter.formatMcpBlock()` + auto-append in `dev-session update`
- [ ] Unit: invalid session_token → auth error; path traversal → rejected; rate limiter fires; no-index → 404
- [ ] Integration: server starts + registers tools + responds to list-tools; `get_session_context` correct
- [ ] E2e: `mcp config` valid JSON; `mcp start` writes pid, SIGINT cleans up
