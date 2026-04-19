---
chunk_id: 16
title: "Adapters: Cursor + Windsurf"
depends_on: [7, 15]
tasks:
  - text: "`CONTEXT_BUDGET_DEFAULTS` updated: `cursor: 6_000`, `windsurf: 6_000`; `BootstrapFormatter` adapters use adapter's declared budget"
    status: todo
  - text: "Cursor adapter (`packages/adapters/src/cursor-adapter.ts`) — detect `.cursor/` directory; `setup` generates `.cursor/rules/dev-session.mdc` with YAML frontmatter (`description`, `globs`, `alwaysApply`)"
    status: todo
  - text: "Cursor `transformState` — maps `session.yaml` layers to Cursor rules format; emits file-priority rule per Layer 2 file"
    status: todo
  - text: "`CursorBootstrapFormatter` — `formatFilesToLoad()` emits `@File` Cursor composer syntax; `formatLayeredContext(resolved)` (Layer 0 inline, Layer 1/2 as `@File` with depth annotation); `formatExcludes()` `@Docs` list"
    status: todo
  - text: "Cursor `onSessionStart` — validates `.cursor/rules/dev-session.mdc` is current (not stale from prior chunk); `onSessionEnd` — updates `.mdc` with completed tasks summary"
    status: todo
  - text: "Windsurf adapter (`packages/adapters/src/windsurf-adapter.ts`) — detect `.windsurfrules` or `.windsurf/` directory; `setup` appends session block to `.windsurfrules` (does not overwrite existing rules)"
    status: todo
  - text: "`WindsurfBootstrapFormatter` — `formatLayeredContext(resolved)` in Windsurf-native plain-text syntax (no YAML frontmatter); `onSessionEnd` updates `.windsurfrules` session block"
    status: todo
  - text: "`AdapterRegistry` updated — detection order: explicit `--adapter` flag → Claude Code → opencode → Cursor → Windsurf → default; no shared base class (Cursor `.mdc` and Windsurf `.windsurfrules` differ enough to fight a shared abstraction)"
    status: todo
  - text: "Dual-adapter detection (Cursor + Claude Code both present) throws `CliError` with clear message: 'Both Claude Code and Cursor detected. Pass --adapter to choose.'"
    status: todo
  - text: "Unit: `CursorBootstrapFormatter.formatLayeredContext()` uses `@File` syntax; `.mdc` output is valid YAML frontmatter + markdown"
    status: todo
  - text: "Unit: `WindsurfBootstrapFormatter.formatLayeredContext()` uses plain-text syntax"
    status: todo
  - text: "Unit: `AdapterRegistry` detection order is deterministic"
    status: todo
  - text: "Unit: dual-adapter detection throws `CliError` with actionable message"
    status: todo
  - text: "E2e: `dev-session init --adapter cursor` on fixture project — verify `.mdc` written correctly"
    status: todo
  - text: "E2e: `dev-session init --adapter windsurf` on fixture project — verify `.windsurfrules` appended"
    status: todo
  - text: "E2e: `dev-session update` with Cursor adapter regenerates `.cursor/rules/dev-session.mdc`"
    status: todo
---

## Chunk 16 — Adapters: Cursor + Windsurf

**Goal:** First-class adapters for Cursor and Windsurf, completing the "big four" AI editor adapters.
Both implement `formatLayeredContext()` (defined in Chunk 15's interface) from the start.

**What changed from PLANv2 original:**
- No `RulesFileFormatter` shared base class — Cursor (`.mdc` YAML frontmatter) and Windsurf (plain-text `.windsurfrules`) are structurally different enough that a base class will fight you. Build both concretely; extract if real duplication emerges in practice.
- Chunk dependency is on Chunk 15 (layers) not just Chunk 7 — these adapters implement `formatLayeredContext()` from day one.
- `CONTEXT_BUDGET_DEFAULTS` v2 correction (`cursor: 6_000`, `windsurf: 6_000`) ships here.

### Tasks

- [ ] `CONTEXT_BUDGET_DEFAULTS` updated: `cursor: 6_000`, `windsurf: 6_000`
- [ ] Cursor adapter — detect, setup `.mdc`, `transformState`, `onSessionStart/End`
- [ ] `CursorBootstrapFormatter` — `@File` syntax, `formatLayeredContext()`, `@Docs` excludes
- [ ] Windsurf adapter — detect, setup (append-only), `onSessionEnd`
- [ ] `WindsurfBootstrapFormatter` — plain-text `formatLayeredContext()`
- [ ] `AdapterRegistry` updated (no shared base class)
- [ ] Dual-adapter detection → `CliError` with `--adapter` guidance
- [ ] Unit: Cursor `.mdc` valid frontmatter; Windsurf plain-text; registry order; dual-detect error
- [ ] E2e: `init --adapter cursor`; `init --adapter windsurf`; `update` regenerates `.mdc`
