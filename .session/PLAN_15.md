---
chunk_id: 15
title: "Layered context loading"
depends_on: ["13a", 14]
tasks:
  - text: "`SessionYaml` type + `SessionYamlSchema` (Zod `.strict()`) — `context_budget`, `active_adapter`, `files: Record<string, { layer: 0 | 1 | 2 }>`, `excludes: string[]` (absorbs trim-overrides.json — one session file not two)"
    status: todo
  - text: "`LayerManager` class — `load(root)`, `save(root, config)` (atomic), `getLayer(config, path)` (declared → @ai-layer-hint → fallback 2), `promote(config, path): SessionYaml` (0→1→2, clamped), `demote(config, path): SessionYaml` (2→1→0, clamped), `setLayer(config, path, layer): SessionYaml`, `resolveContextContent(config, index): Promise<ResolvedContext>`"
    status: todo
  - text: "`ResolvedContext` type: `{ files: Array<{ path, layer, content, tokens, tokenAccurate }>, totalTokens, budgetUsed, overBudget }`"
    status: todo
  - text: "`dev-session advance` migrates existing `trim-overrides.json` → `session.yaml` `excludes:` key on first run; removes `trim-overrides.json` after migration"
    status: todo
  - text: "`dev-session layers` command — table: file | layer | tokens at current layer | annotation hint; total cost + budget %; warns if any Layer 2 file lacks `@ai-summary`"
    status: todo
  - text: "`dev-session expand <path>` — calls `LayerManager.promote()`, saves `session.yaml`, prints 'layer 0→1 (+220 tokens, budget now 68%)', regenerates NEXT_PROMPT.md"
    status: todo
  - text: "`dev-session collapse <path>` — calls `LayerManager.demote()`, saves, prints diff, regenerates NEXT_PROMPT.md"
    status: todo
  - text: "`dev-session layer <path> --set <0|1|2>` — explicit override via `LayerManager.setLayer()`"
    status: todo
  - text: "`dev-session layers init` — for each FILE_INDEX active-chunk file, looks up `@ai-layer-hint`; files with hint 0/1 set at hint; no hint + file < 100 lines → layer 2; no hint + larger → layer 1; writes initial `session.yaml`"
    status: todo
  - text: "`dev-session layers inspect <path>` — shows what each layer would render for a file (Layer 0 preview, Layer 1 signature block, Layer 2 line count)"
    status: todo
  - text: "`BootstrapFormatter` interface gains `formatLayeredContext(resolved: ResolvedContext): string`; implemented for Claude + opencode adapters (existing 2); Layer 0 inline, Layer 1 `@path` + note, Layer 2 plain `@path`"
    status: todo
  - text: "`NextPromptWriter.generateWithFormatter()` updated: accepts optional `ResolvedContext`; uses `formatLayeredContext()` when present"
    status: todo
  - text: "`dev-session advance` resets `session.yaml` layers to `@ai-layer-hint` defaults (session promotions dropped, hints carry forward); clears `excludes:` (was: cleared trim-overrides.json)"
    status: todo
  - text: "`ContextBudgetCalculator.estimate()` accepts optional `ResolvedContext`; uses layer-accurate token costs when present; `dev-session status` shows layer-aware breakdown"
    status: todo
  - text: "MCP tool `get_file_at_layer` added to Chunk 14's server — returns file at specified layer via `AiIndexManager.renderLayer0/1` or full read at layer 2; all path inputs validated"
    status: todo
  - text: "Export from `packages/core`: `LayerManager`, `SessionYaml`, `ResolvedContext`"
    status: todo
  - text: "Unit: `LayerManager.getLayer` — declared wins; missing→hint; missing both→2"
    status: todo
  - text: "Unit: `LayerManager.promote` — 0→1, 1→2, 2→2 clamp, unknown file added at layer 1"
    status: todo
  - text: "Unit: `LayerManager.resolveContextContent` — layer 0 returns index entry, layer 1 returns signatures, layer 2 returns full source"
    status: todo
  - text: "Unit: `ResolvedContext.overBudget` correct when totalTokens > context_budget"
    status: todo
  - text: "Unit: `trim-overrides.json` migration — file moved to `session.yaml` excludes key, original deleted"
    status: todo
  - text: "E2e: `dev-session expand` updates `session.yaml` and regenerates NEXT_PROMPT.md"
    status: todo
  - text: "E2e: `dev-session layers init` on fixture project with mixed hints"
    status: todo
  - text: "E2e: `dev-session advance` resets session-specific promotions, preserves hint defaults"
    status: todo
  - text: "Integration: `ClaudeBootstrapFormatter.formatLayeredContext()` produces correct `@path` syntax per layer"
    status: todo
  - text: "Snapshot: `dev-session layers` table output (strip ANSI)"
    status: todo
---

## Chunk 15 — Layered context loading

**Goal:** Session manifests declare which layer each file starts at. `expand` and `collapse` let the AI or
developer promote/demote files during a session. `session.yaml` replaces both `trim-overrides.json` (absorbed
as `excludes:` key) and `layer-overrides.json` — **one file for session state, not three**.

**What changed from PLANv2 original:**
- `session.yaml` merges `trim-overrides.json` → `excludes:` key; advance migrates existing files
- `formatLayeredContext()` added to **existing 2 adapters** (Claude, opencode) in this chunk
- Cursor/Windsurf adapters implement it in Chunk 16 (their chunk)
- MCP `get_file_at_layer` tool added to Chunk 14's running server (not a new package deployment)

### Layer semantics

| Layer | What loads | Default tokens | When |
|---|---|---|---|
| 0 | Module summary + public symbol names | ~20–50 | Know it exists, don't read |
| 1 | Signatures only | ~100–300 | Call into but don't modify |
| 2 | Full source | ~500–5000 | Actively modifying |

### Tasks

- [ ] `SessionYaml` type + `SessionYamlSchema` — `context_budget`, `active_adapter`, `files`, `excludes` (absorbs trim-overrides)
- [ ] `LayerManager` class — `load`, `save`, `getLayer`, `promote`, `demote`, `setLayer`, `resolveContextContent`
- [ ] `ResolvedContext` type
- [ ] `dev-session advance` migrates `trim-overrides.json` → `session.yaml` `excludes:` on first run
- [ ] `dev-session layers` — table display
- [ ] `dev-session expand` / `collapse` — promote/demote + NEXT_PROMPT regen
- [ ] `dev-session layer <path> --set <0|1|2>` — explicit override
- [ ] `dev-session layers init` — initializes session.yaml from hints + FILE_INDEX
- [ ] `dev-session layers inspect <path>` — layer preview
- [ ] `BootstrapFormatter.formatLayeredContext()` — added to interface + implemented for Claude + opencode
- [ ] `NextPromptWriter.generateWithFormatter()` accepts ResolvedContext
- [ ] `dev-session advance` resets layers to hint defaults
- [ ] `ContextBudgetCalculator.estimate()` accepts ResolvedContext; `status` shows layer breakdown
- [ ] MCP: `get_file_at_layer` tool added to Chunk 14's server
- [ ] Export: `LayerManager`, `SessionYaml`, `ResolvedContext`
- [ ] Unit: `getLayer` priority chain; `promote` clamping; `resolveContextContent` per layer; `overBudget`; migration
- [ ] E2e: `expand` updates session.yaml + NEXT_PROMPT; `layers init` with mixed hints; `advance` resets
- [ ] Integration: `formatLayeredContext()` correct @path syntax; snapshot `layers` table
