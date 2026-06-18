# PLAN.md — dev-sesssion v2 extension
# Chunks 12–17: The Context Intelligence Layer and beyond

> v1 (Chunks 1–11) is complete and frozen. These chunks extend it.
> v1 delivered: session lifecycle, file index, context budgets, preview/trim/lint/compact,
> session memory, Claude Code + opencode adapters, and a programmatic API.
>
> v2 headline: **files stop being atoms**. AI tools read symbol-level summaries by default
> and pull full source only when they need to modify implementation. This is the shift from
> managing *which files* get loaded to managing *how much* of each file gets loaded.

---

## Architecture additions in v2

```
packages/
  core/
    annotation/       # NEW — AnnotationParser, AiIndexBuilder, layered context types
    ...               # all v1 core modules unchanged
  adapters/
    cursor/           # NEW — Cursor adapter
    windsurf/         # NEW — Windsurf adapter
    ...               # v1 adapters unchanged
  mcp/                # NEW — MCP server exposing session state as tools
```

**New artifacts written to `.session/`:**

```
.session/
  ai-index.yaml         # NEW — symbol-level surface map, generated from annotations
  layer-overrides.json  # NEW — per-session layer promotions/demotions (gitignored)
  ...                   # all v1 artifacts unchanged
```

---

## Critique of v1 plan — issues addressed in v2

Before the new chunks, here is an honest audit of v1 design decisions that v2 corrects
or supersedes. These are not regressions — they are things v1 got right for its scope
but that become limiting as the system grows.

### 1. `Chunk 3.5` should not be a standalone chunk

`TokenCounter` is a utility class, not a feature. It has one job: count tokens accurately
when an API key is present and fall back to heuristics when it is not. Shipping it as its
own chunk with its own release gate inflates the roadmap. In v2, `TokenCounter` is
treated as what it is — a module inside `packages/core` — and is referenced inline wherever
token counting is needed. The sequencing dependency it created (Chunk 3.5 before Chunk 10)
remains, but it is implemented within Chunk 3's final tasks, not as a separate delivery.

**Verdict:** Merge into Chunk 3. No separate release gate.

### 2. `DEFAULT_CONTEXT_BUDGET = 4000` is adapter-blind

Claude Code operates in a ~200K token context window. opencode is similar. A 4,000 token
bootstrap budget made sense for the manual protocol era (paste NEXT_PROMPT.md into chat),
but it is the wrong default for agent-mode sessions where the tool controls file loading.
A single constant cannot serve both use cases.

**Verdict:** Replace with `CONTEXT_BUDGET_DEFAULTS: Record<AdapterName | 'default', number>`:

```typescript
export const CONTEXT_BUDGET_DEFAULTS = {
  claude:   12_000,  // Claude Code agent mode — larger window, surgical @-mentions
  opencode:  8_000,  // opencode — moderate
  cursor:    6_000,  // Cursor — conservative, composer context fills fast
  windsurf:  6_000,
  default:   4_000,  // manual paste mode — keep original default for unknown adapters
} as const
```

Each adapter's `BootstrapFormatter` declares its own budget. `ContextBudgetCalculator`
reads from the active adapter. User can override per-project in `.session/config.yaml`.

### 3. `Chunk 10` is too wide

Four distinct features — `preview`, `trim`, `lint-context`, and `compact` — shipped under
one chunk creates a large, hard-to-test delivery. `preview` and `trim` are runtime tools
(they affect what gets loaded this session). `lint-context` and `compact` are authoring
tools (they improve the quality of your persistent context files). These are different
mental models and different audiences.

**Verdict:** In v2, if Chunk 10 has not yet been delivered, recommend splitting into
10A (preview + trim) and 10B (lint-context + compact) with separate acceptance criteria.
If already delivered, no action needed — the split is a planning concern only.

### 4. `Chunk 6` is sequenced after `Chunk 5` but `Chunk 7` depends on it

The `SessionManager` programmatic API (Chunk 6) is required by the adapter system (Chunk 7).
Adapters call `SessionManager.load()`, `getContextFiles()`, and `getFormatter()`. Shipping
adapters before the stable API surface means adapters are written against internal module
shapes that may change.

**Verdict:** Enforce in v2 planning: Chunk 6 must be complete before Chunk 7 work begins.
Add a gate to `CI` — a type-check that imports from `dev-sesssion/core` public surface only
(no deep imports) must pass before adapter code merges.

### 5. `FILE_INDEX.md` is markdown-for-humans, not machine-readable

`FILE_INDEX.md` uses frontmatter + prose. Every consumer (budget calculator, walker,
formatter) has to parse it. As the index grows to hundreds of entries, parsing becomes
brittle and slow. v1 chose markdown for approachability, which was right. v2 introduces
`ai-index.yaml` as the machine-readable twin — generated from annotations, not hand-authored.
`FILE_INDEX.md` remains for human editing. `ai-index.yaml` is the source of truth for tooling.

---

## Chunk 12 — Annotation schema + `ai-index` generator

> **Goal:** Source files can declare their own context surface via JSDoc/TSDoc annotations.
> `dev-sesssion index` reads annotations and generates `.session/ai-index.yaml` — a
> symbol-level surface map that is the AI's `.d.ts` file for your codebase.
> **Depends on:** Chunk 3 (core data model), Chunk 5 (CLI lifecycle)
> **Est. sessions:** 3

### Rationale

Today every AI tool loads full files. The only way to reduce context is to remove files
entirely. This chunk introduces a third option: load the *surface* of a file by default
(exported symbol names, signatures, and one-line summaries) and pull full source only
when the AI needs to modify implementation. This is the JSDoc-as-context-contract idea.

The key insight: TypeScript `.d.ts` files already do this for the type system. `ai-index.yaml`
does it for the AI context system. These are parallel structures for parallel consumers.

### The annotation schema

All tags are JSDoc-compatible — they work in existing JSDoc tooling and IDEs,
produce no warnings, and degrade gracefully (tools that don't understand them ignore them).

```typescript
/**
 * @ai-summary Validates and normalizes a transaction before processing.
 * @ai-surface public
 * @ai-layer-hint 1
 * @ai-deps validateAmount, normalizePayload
 * @ai-tags payments, validation
 */
export function processTransaction(payload: TxPayload): Promise<TxResult> { ... }

/**
 * @ai-surface private
 * Internal retry helper — AI should never load this unless debugging retry logic.
 */
function _retryWithBackoff(fn: () => Promise<unknown>, attempts: number): Promise<unknown> { ... }

/**
 * @ai-surface module
 * @ai-summary Core payments processing pipeline. Always-include in payments-related sessions.
 * @ai-layer-default 0
 */
// (file-level annotation — applied to the module as a whole)
```

**Tag reference:**

| Tag | Values | Meaning |
|---|---|---|
| `@ai-summary` | string | One-line description for the index entry — used instead of the full docblock |
| `@ai-surface` | `public \| private \| module` | `public` = include in index; `private` = exclude unless layer 2; `module` = file-level annotation |
| `@ai-layer-hint` | `0 \| 1 \| 2` | Suggested starting layer for this symbol (overridable per-session) |
| `@ai-layer-default` | `0 \| 1 \| 2` | File-level default layer — applied to all symbols without an explicit `@ai-layer-hint` |
| `@ai-deps` | comma-separated identifiers | Other symbols this symbol directly calls — enables targeted full-source fetches |
| `@ai-tags` | comma-separated strings | Domain tags for grouping in FILE_INDEX and index queries |
| `@ai-context-cost` | `low \| medium \| high` | Human-declared cost hint — used when token counting is offline/heuristic |

### The `ai-index.yaml` format

```yaml
# .session/ai-index.yaml
# Generated by `dev-sesssion index`. Do not edit manually.
# Regenerate with `dev-sesssion index --update`.

version: "2"
generated_at: "2026-04-08T10:00:00Z"
project_root: "."

files:
  src/payments/processor.ts:
    module_summary: "Core payments processing pipeline."
    layer_default: 0
    token_cost: 420
    token_cost_accurate: true
    exports:
      processTransaction:
        summary: "Validates and normalizes a transaction before processing."
        surface: public
        layer_hint: 1
        signature: "(payload: TxPayload) => Promise<TxResult>"
        deps: [validateAmount, normalizePayload]
        tags: [payments, validation]
        line: 45
      _retryWithBackoff:
        surface: private
        signature: "(fn: () => Promise<unknown>, attempts: number) => Promise<unknown>"
        line: 112

  src/core/engine.ts:
    module_summary: "Central event dispatch and plugin lifecycle."
    layer_default: 1
    token_cost: 1840
    token_cost_accurate: true
    exports:
      Engine:
        summary: "Main engine class — instantiated once per app."
        surface: public
        layer_hint: 1
        signature: "class Engine"
        deps: [PluginRegistry, EventBus]
        tags: [core]
        line: 12
```

### `AnnotationParser` (new module in `packages/core/annotation/`)

- [ ] `AnnotationParser` class:
  - `parseFile(path: ValidatedPath): Promise<ParsedFile>` — extracts all `@ai-*` tags from JSDoc/TSDoc blocks using `@typescript-eslint/typescript-estree` for AST parsing (not regex)
  - `parseDirectory(root: ValidatedPath, options: WalkOptions): Promise<ParsedFile[]>` — walks the project using `GitignoreAwareWalker`, delegates to `parseFile`
  - Returns `ParsedFile` type: `{ path, moduleAnnotation, exports: ParsedSymbol[] }`
  - `ParsedSymbol` type: `{ name, surface, summary, signature, layerHint, deps, tags, line }`
  - Falls back gracefully on files with no `@ai-*` annotations — returns `surface: 'public'`, no summary, layer inferred from file size heuristic
  - **Uses `@typescript-eslint/typescript-estree`** — handles `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`. Does NOT parse `.vue`, `.svelte` in this chunk (Chunk 14 adapter concern)
  - Handles JSDoc on: exported functions, exported classes, exported const/let, exported type aliases, exported interfaces

- [ ] `AiIndexBuilder` class:
  - `build(files: ParsedFile[], tokenCosts: TokenCostMap): AiIndex` — assembles the full index
  - `merge(existing: AiIndex, updated: AiIndex): AiIndex` — incremental update (only reprocess changed files, detected via mtime)
  - `serialize(index: AiIndex): string` — deterministic YAML output (keys sorted, no timestamp churn)
  - `deserialize(content: string): AiIndex` — parses existing `ai-index.yaml`

- [ ] `AiIndexManager` class (parallel to `FileIndexManager`):
  - `load(root: ValidatedPath): Promise<AiIndex>` — reads `.session/ai-index.yaml`
  - `save(root: ValidatedPath, index: AiIndex): Promise<void>` — atomic write
  - `queryByLayer(index: AiIndex, layer: 0 | 1 | 2): IndexEntry[]`
  - `queryByTag(index: AiIndex, tag: string): IndexEntry[]`
  - `queryByChunk(index: AiIndex, chunkId: string): IndexEntry[]` — cross-references FILE_INDEX chunk tags
  - `renderLayer0(entry: FileEntry): string` — returns the index-only representation (module summary + public symbol names)
  - `renderLayer1(entry: FileEntry): string` — returns signatures only (no impl)
  - `renderLayer2(path: ValidatedPath): Promise<string>` — reads and returns full file content

### `dev-sesssion index` command (new in `packages/cli`)

```bash
dev-sesssion index              # full regeneration
dev-sesssion index --update     # incremental — only reprocess files changed since last run
dev-sesssion index --dry-run    # print what would be written, no filesystem changes
dev-sesssion index --file src/payments/processor.ts   # single file
dev-sesssion index --show src/payments/processor.ts   # print index entry for a file
dev-sesssion index stats        # summary: N files indexed, M public symbols, token cost breakdown
```

- [ ] `dev-sesssion index`:
  - Runs `AnnotationParser.parseDirectory()` on the project
  - Calls `TokenCounter.countFiles()` for accurate token costs (heuristic fallback if no API key)
  - Builds `AiIndex` via `AiIndexBuilder.build()`
  - Writes to `.session/ai-index.yaml` via `AiIndexManager.save()`
  - Runs `SecretScanner` on generated YAML before write
  - Reports: "Indexed N files, M public symbols. Estimated context surface: X tokens."
  - Warns if a file has `@ai-surface: public` symbols but no `@ai-summary` tags ("summaries improve context quality")
  - Warns if total Layer 0 token cost exceeds the adapter's context budget
  - `--update` mode: reads existing index mtimes, skips unchanged files, merges via `AiIndexBuilder.merge()`

- [ ] Add `.session/ai-index.yaml` to `.gitignore` suggestions in `init` (personal mode)
  or commit it (team mode, since it is derived from source annotations that are committed)

### Integration with existing CLAUDE.md / AGENTS.md bootstrap

The `BootstrapFormatter` for each adapter gains a new method:

```typescript
interface BootstrapFormatter {
  // existing
  formatFilesToLoad(): string
  formatExcludes(): string
  generatePrompt(): string

  // NEW in v2
  formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string
  // Produces the adapter-specific instruction block:
  // "The ai-index.yaml below maps this codebase's public surface.
  //  Read it before accessing any source file. Request full source
  //  via @path only if you need to modify implementation."
}
```

`ClaudeBootstrapFormatter.formatAiIndex()` outputs:
1. A prose instruction block (injected into NEXT_PROMPT.md)
2. The full Layer 0 index content (module summaries + public symbol list, no signatures)

This replaces manually listing files in `NEXT_PROMPT.md` for sessions that have a generated index.

### Types exported from `packages/core`

```typescript
export { AnnotationParser, ParsedFile, ParsedSymbol }
export { AiIndexBuilder, AiIndexManager, AiIndex, FileEntry, IndexEntry }
export type { AnnotationTag, SurfaceLevel, LayerHint }
```

### Tests

- [ ] `AnnotationParser.parseFile`: exported function with all 6 tags, class with partial tags,
  unannotated export (graceful fallback), file-level `@ai-surface module` annotation
- [ ] `AnnotationParser.parseFile`: `.tsx` file with React component export
- [ ] `AiIndexBuilder.merge`: file added, file removed, file modified — correct diff behavior
- [ ] `AiIndexBuilder.serialize`: deterministic output — same input, same YAML byte-for-byte
- [ ] `AiIndexManager.renderLayer0`: returns only module summary + public symbol names, no signatures
- [ ] `AiIndexManager.renderLayer1`: returns signatures without impl
- [ ] `AiIndexManager.queryByChunk`: cross-references FILE_INDEX chunk tags correctly
- [ ] E2e: `dev-sesssion index` on fixture project with 10 annotated files — verify YAML shape
- [ ] E2e: `dev-sesssion index --update` skips unchanged files (verify via mtime mock)
- [ ] E2e: `dev-sesssion index --dry-run` produces no filesystem changes
- [ ] Adversarial: malicious `@ai-summary` content with YAML injection characters
- [ ] Adversarial: circular `@ai-deps` reference (A → B → A) — should not loop

---

## Chunk 13 — Layered context loading

> **Goal:** Session manifests declare which layer each file starts at. AI tools receive
> the appropriate depth by default. `expand` and `collapse` let the AI or developer
> promote/demote files during a session without regenerating the full index.
> **Depends on:** Chunk 12
> **Est. sessions:** 2–3

### Rationale

Chunk 12 builds the surface map. This chunk makes the surface map *load correctly* —
meaning the bootstrap context a developer pastes (or an AI tool reads) contains the right
depth of information for each file, and that depth can be adjusted without manual editing.

The three layers are deliberately coarse. Fine-grained line-range loading is a v3 concern.

### Layer semantics

| Layer | What gets loaded | Default token cost | When to use |
|---|---|---|---|
| 0 | Module summary + public symbol names | ~20–50 tokens | Files you need to know exist but not read |
| 1 | Signatures only (types, function heads, class shape) | ~100–300 tokens | Files you'll call into but not modify |
| 2 | Full source | ~500–5000 tokens | Files you're actively modifying this session |

Layer is declared in `session.yaml` (new file), not in `ai-index.yaml`.
`ai-index.yaml` declares *hints* (`@ai-layer-hint`) — the session can override them.

### `session.yaml` — the new session-scoped config file

```yaml
# .session/session.yaml
# Per-session layer declarations. Always gitignored.
# Override ai-index.yaml layer hints for this session only.

context_budget: 12000          # overrides adapter default for this project
active_adapter: claude

files:
  src/payments/processor.ts:
    layer: 0                   # only index entry — we're not touching payments this session
  src/core/engine.ts:
    layer: 1                   # signatures — we'll call Engine but not modify it
  src/auth/middleware.ts:
    layer: 2                   # full source — this is what we're working on today
  src/utils/helpers.ts:
    layer: 2                   # small file, just load it all
```

**Relationship to FILE_INDEX.md:** `FILE_INDEX.md` declares *which* files belong to which
chunk (a planning concern). `session.yaml` declares *at what depth* each file loads
(a session concern). They are orthogonal. A file can be in FILE_INDEX with chunk tag `3`
and also have `layer: 1` in session.yaml.

### `LayerManager` (new module in `packages/core`)

- [ ] `SessionYaml` type + `SessionYamlSchema` (Zod `.strict()`) — `context_budget`, `active_adapter`, `files: Record<ValidatedPath, { layer: 0 | 1 | 2 }>`
- [ ] `LayerManager` class:
  - `load(root: ValidatedPath): Promise<SessionYaml>` — reads `.session/session.yaml`
  - `save(root: ValidatedPath, config: SessionYaml): Promise<void>` — atomic write
  - `getLayer(config: SessionYaml, path: ValidatedPath): 0 | 1 | 2` — returns declared layer, falls back to `@ai-layer-hint` from index, falls back to `2` (full source) if no hint
  - `promote(config: SessionYaml, path: ValidatedPath): SessionYaml` — increments layer (0→1→2), clamps at 2
  - `demote(config: SessionYaml, path: ValidatedPath): SessionYaml` — decrements layer (2→1→0), clamps at 0
  - `setLayer(config: SessionYaml, path: ValidatedPath, layer: 0 | 1 | 2): SessionYaml`
  - `resolveContextContent(config: SessionYaml, index: AiIndex): Promise<ResolvedContext>` — assembles the full context for all declared files at their declared layers, returns token cost breakdown per file

- [ ] `ResolvedContext` type:
  ```typescript
  type ResolvedContext = {
    files: Array<{
      path: ValidatedPath
      layer: 0 | 1 | 2
      content: string            // rendered at declared layer
      tokens: number
      tokenAccurate: boolean
    }>
    totalTokens: number
    budgetUsed: number           // totalTokens / context_budget
    overBudget: boolean
  }
  ```

### New CLI commands

```bash
# Show current layer for all session files
dev-sesssion layers

# Promote a file: layer 0 → 1 → 2
dev-sesssion expand src/payments/processor.ts

# Demote a file: layer 2 → 1 → 0
dev-sesssion collapse src/payments/processor.ts

# Set explicit layer
dev-sesssion layer src/payments/processor.ts --set 1

# Initialize session.yaml from ai-index hints + FILE_INDEX chunk tags
dev-sesssion layers init

# Show what each layer would load for a given file
dev-sesssion layers inspect src/payments/processor.ts
```

- [ ] `dev-sesssion layers`:
  - Reads `session.yaml` + `ai-index.yaml`
  - Displays table: file | current layer | token cost at current layer | hint from annotation
  - Shows total token cost + budget utilization
  - Warns if any Layer 2 file has no `@ai-summary` ("full source without a summary costs you tokens on every session start")

- [ ] `dev-sesssion expand` / `dev-sesssion collapse`:
  - Calls `LayerManager.promote()` / `LayerManager.demote()`
  - Saves updated `session.yaml`
  - Prints: "src/payments/processor.ts: layer 0 → 1 (+220 tokens, budget now 68%)"
  - Automatically regenerates `NEXT_PROMPT.md` via `NextPromptWriter.generateWithFormatter()`

- [ ] `dev-sesssion layers init`:
  - For each file in FILE_INDEX for the active chunk, looks up `@ai-layer-hint` from ai-index
  - Files with hint 0 or 1: set at hint value
  - Files with no hint: default to 1 (signatures) unless file is < 100 lines (default to 2)
  - Writes initial `session.yaml`
  - Reports: "Initialized session.yaml. Estimated context: X tokens (Y% of budget)."

### Integration with `NextPromptWriter` and `BootstrapFormatter`

`NextPromptWriter.generateWithFormatter()` now accepts `ResolvedContext` as input
and calls `formatter.formatLayeredContext(resolved)` to produce the context block.

`ClaudeBootstrapFormatter.formatLayeredContext()` produces:
- Layer 0 files: their index entry only (inline in the prompt)
- Layer 1 files: `@path` mention with a note "signatures only — run `dev-sesssion expand` for full source"
- Layer 2 files: `@path` mention with no qualification (full source, load normally)

This replaces the flat file list in NEXT_PROMPT.md with a depth-aware context map.

### Integration with `dev-sesssion advance`

On `advance`, `session.yaml` layers are reset to their `@ai-layer-hint` defaults
(not cleared — the index hints carry forward, but any session-specific promotions are dropped).
This is correct behavior: the next chunk's files likely have different access patterns.

### Integration with `ContextBudgetCalculator`

`ContextBudgetCalculator.estimate()` now takes `ResolvedContext` as an optional input.
When present, it uses layer-accurate token costs instead of full-file estimates.
`dev-sesssion status` displays the layer-aware breakdown.

### Tests

- [ ] `LayerManager.getLayer`: declared in session.yaml → uses declared; missing from session.yaml, hint in index → uses hint; missing from both → returns 2
- [ ] `LayerManager.promote`: 0→1, 1→2, 2→2 (clamp), unknown file gets added at layer 1 (promote from inferred 0)
- [ ] `LayerManager.resolveContextContent`: layer 0 returns index entry, layer 1 returns signatures, layer 2 returns full source
- [ ] `ResolvedContext.overBudget`: correct when totalTokens > context_budget
- [ ] E2e: `dev-sesssion expand` updates session.yaml and regenerates NEXT_PROMPT.md
- [ ] E2e: `dev-sesssion layers init` on fixture project with mixed hints
- [ ] E2e: `dev-sesssion advance` resets session-specific layer promotions but preserves hint defaults
- [ ] Integration: `ClaudeBootstrapFormatter.formatLayeredContext()` produces correct `@path` syntax per layer
- [ ] Snapshot: `dev-sesssion layers` table output format (strip ANSI before asserting)

---

## Chunk 14 — Adapters: Cursor + Windsurf

> **Goal:** First-class adapters for Cursor and Windsurf, including support for their
> respective context injection models. Completes the "big four" AI editor adapters.
> **Depends on:** Chunk 7 (adapter system), Chunk 13 (layered context)
> **Est. sessions:** 2–3

### Why these two together

Cursor and Windsurf share a structural similarity: both use composer/cascade as the primary
agentic surface and both inject context via rules files (`.cursor/rules/*.mdc` and
`.windsurfrules`). Their `BootstrapFormatter` implementations will share significant logic —
a `RulesFileFormatter` base class makes sense as a shared abstraction.

### Context budget defaults (v2 correction)

```typescript
// In CONTEXT_BUDGET_DEFAULTS (v2 addition — see critique section)
cursor:   6_000,   // Composer context window fills quickly with rule files + codebase indexing
windsurf: 6_000,   // Cascade is similar
```

### Cursor adapter (`dev-sesssion/adapters/cursor`)

- [ ] Detect: check for `.cursor/` directory or `.cursor/rules/` files
- [ ] `setup`: generate `.cursor/rules/dev-sesssion.mdc` with YAML frontmatter describing the session protocol
- [ ] `transformState`: map `session.yaml` layer declarations to Cursor rules format — emit a rule per Layer 2 file instructing Cursor's codebase indexing to prioritize those files
- [ ] `getFormatter()` → `CursorBootstrapFormatter`:
  - `formatFilesToLoad()`: emits `@File` mentions in Cursor composer syntax
  - `formatLayeredContext(resolved: ResolvedContext)`: Layer 0 entries inline, Layer 1/2 as `@File` mentions with depth annotations
  - `formatExcludes()`: `@Docs` exclusion list in Cursor format
- [ ] `onSessionStart`: reads `.cursor/rules/dev-sesssion.mdc` and validates it is current (not stale from a previous chunk)
- [ ] `onSessionEnd`: updates `.cursor/rules/dev-sesssion.mdc` with completed tasks summary
- [ ] Handle `.mdc` frontmatter correctly: `description`, `globs`, `alwaysApply` fields
- [ ] Tests: fixture `.cursor/` directory, verify `.mdc` output is valid frontmatter + markdown
- [ ] Tests: `CursorBootstrapFormatter.formatLayeredContext()` uses `@File` syntax

### Windsurf adapter (`dev-sesssion/adapters/windsurf`)

- [ ] Detect: check for `.windsurfrules` file or `.windsurf/` directory
- [ ] `setup`: generate `.windsurfrules` section for dev-sesssion (appends, does not overwrite existing rules)
- [ ] `transformState`: map session state to `.windsurfrules` format
- [ ] `getFormatter()` → `WindsurfBootstrapFormatter`:
  - Windsurf Cascade uses a different context model than Cursor Composer — implement accordingly
  - `formatLayeredContext(resolved: ResolvedContext)`: Windsurf-native syntax
- [ ] `onSessionEnd`: update `.windsurfrules` session block
- [ ] Tests: fixture `.windsurfrules`, verify generated output

### `RulesFileFormatter` shared base class

Both adapters share the pattern of writing structured session state into a rules file.
Extract this into `packages/adapters/shared/RulesFileFormatter`:

```typescript
abstract class RulesFileFormatter implements BootstrapFormatter {
  abstract rulesFilePath: string
  abstract rulesFileSyntax: 'cursor-mdc' | 'windsurf-rules'

  // Shared implementations
  formatExcludes(): string { ... }
  appendToRulesFile(root: string, section: string): Promise<void> { ... }

  // Adapter-specific
  abstract formatFilesToLoad(): string
  abstract formatLayeredContext(resolved: ResolvedContext): string
  abstract generatePrompt(): string
}
```

### Adapter registry update

- [ ] Add Cursor and Windsurf to `AdapterRegistry` auto-detection order
- [ ] Detection priority: explicit `--adapter` flag → Claude Code → opencode → Cursor → Windsurf → default
- [ ] Document: when both Cursor and Claude Code are detected (e.g. developer uses both),
  `--adapter` flag is required — no silent preference

### Tests

- [ ] E2e: `dev-sesssion init --adapter cursor` on fixture project
- [ ] E2e: `dev-sesssion init --adapter windsurf` on fixture project
- [ ] E2e: `dev-sesssion update` with Cursor adapter regenerates `.cursor/rules/dev-sesssion.mdc`
- [ ] Unit: `AdapterRegistry` detection order is deterministic
- [ ] Unit: dual-adapter detection (Cursor + Claude Code) throws `CliError` with clear message

---

## Chunk 15 — MCP server mode

> **Goal:** Expose dev-sesssion's session state as MCP tools so AI agents can read and
> update session context programmatically — without filesystem access or manual NEXT_PROMPT.md pasting.
> **Depends on:** Chunk 6 (programmatic API), Chunk 13 (layered context)
> **Est. sessions:** 3

### Rationale

This was listed as a post-v1 backlog item: "expose session as MCP tool." v2 makes it
concrete. The MCP interface is the natural endpoint of the layered context architecture:
instead of the AI reading a NEXT_PROMPT.md file, it calls `get_session_context` and
receives exactly the layer-resolved content it needs. This turns dev-sesssion from a
file-management tool into a live context server.

### Architecture

```
packages/mcp/
  server.ts          # MCP server entry point
  tools/
    session.ts       # get_session_context, update_session
    index.ts         # query_ai_index, get_file_at_layer
    tasks.ts         # list_tasks, mark_task_done, mark_task_in_progress
    budget.ts        # get_context_budget
```

The MCP server is a separate package (`packages/mcp`) with its own `package.json` and
entry point. It imports `SessionManager` from `packages/core` — it does not duplicate any logic.

### MCP tool definitions

```typescript
// Tool: get_session_context
// Returns the full resolved context for the current session
// (same content as NEXT_PROMPT.md + layered file contents)
{
  name: "get_session_context",
  description: "Returns active session state, task list, and layer-resolved file context.",
  input_schema: {
    properties: {
      include_file_content: { type: "boolean", default: true },
      max_tokens: { type: "number", description: "Budget cap — returns layer 0 summaries for files over cap" }
    }
  }
}

// Tool: get_file_at_layer
// Returns a single file at a specified layer depth
{
  name: "get_file_at_layer",
  description: "Returns a file's content at the specified context layer (0=index, 1=signatures, 2=full).",
  input_schema: {
    required: ["path"],
    properties: {
      path: { type: "string" },
      layer: { type: "number", enum: [0, 1, 2] }
    }
  }
}

// Tool: query_ai_index
// Symbol-level lookup — AI can ask "what does processTransaction do" without loading the file
{
  name: "query_ai_index",
  description: "Looks up a symbol or module in the ai-index. Returns summary, signature, and deps.",
  input_schema: {
    required: ["query"],
    properties: {
      query: { type: "string", description: "Symbol name, file path, or @ai-tag" },
      surface: { type: "string", enum: ["public", "all"] }
    }
  }
}

// Tool: mark_task_done
{
  name: "mark_task_done",
  description: "Marks a task in the active chunk as done.",
  input_schema: {
    required: ["task_text"],
    properties: { task_text: { type: "string" } }
  }
}

// Tool: get_context_budget
{
  name: "get_context_budget",
  description: "Returns current token budget utilization broken down by context component.",
  input_schema: { properties: {} }
}
```

### Server modes

```bash
# Start MCP server for this project
dev-sesssion mcp start

# Print MCP config block for pasting into CLAUDE.md / claude_desktop_config.json
dev-sesssion mcp config

# Test — list available tools
dev-sesssion mcp ping
```

- [ ] `dev-sesssion mcp start`:
  - Starts `packages/mcp/server.ts` as a long-running process
  - Writes `.session/mcp.pid` (cleaned up on SIGINT/SIGTERM)
  - Uses `stdio` transport (compatible with Claude Code's MCP client)
  - Reads project root from `--cwd` flag (defaults to `process.cwd()`)

- [ ] `dev-sesssion mcp config`:
  - Prints the JSON block to add to `claude_desktop_config.json` or CLAUDE.md MCP section
  - Includes `command`, `args`, and any required environment variables

### Security considerations for MCP mode

The MCP server receives tool calls from an AI agent. Input validation is critical:

- [ ] All `path` inputs validated through `PathValidator` before any file read
- [ ] `mark_task_done` and any write tool require a `session_token` (a UUID written to
  `.session/mcp-token.txt` on server start, readable only by the local user) — prevents
  a compromised prompt from marking arbitrary tasks done
- [ ] Rate limiting: max 60 tool calls per minute per connection — prevent runaway agent loops
- [ ] `get_file_at_layer` with `layer: 2` on a non-indexed file still validates path boundary
- [ ] All MCP tool responses sanitize error messages — no internal paths in error text
- [ ] Log all tool calls to `.session/mcp-audit.log` (append-only, gitignored)

### Integration with Claude Code adapter

`ClaudeBootstrapFormatter` gains a new method:

```typescript
formatMcpBlock(mcpConfig: McpConfig): string
// Produces the CLAUDE.md section that registers dev-sesssion as an MCP server:
// "This project has a dev-sesssion MCP server. Use get_session_context at session start
// instead of reading NEXT_PROMPT.md. Use mark_task_done as tasks are completed."
```

When the Claude Code adapter is active and the MCP server has been started at least once
(`.session/mcp.pid` exists or `.session/mcp-token.txt` exists), `dev-sesssion update`
automatically appends the MCP block to CLAUDE.md.

### Tests

- [ ] Unit: `query_ai_index` tool returns correct entry for known symbol
- [ ] Unit: `get_file_at_layer` with layer 0 returns index entry, not file content
- [ ] Unit: `mark_task_done` with invalid `session_token` returns auth error
- [ ] Unit: path traversal via `path` input to `get_file_at_layer` is rejected
- [ ] Unit: rate limiter fires after 60 calls in 60s
- [ ] Integration: `get_session_context` assembles `ResolvedContext` correctly
- [ ] Integration: MCP server starts, registers tools, responds to `ping`
- [ ] E2e: `dev-sesssion mcp config` produces valid JSON block
- [ ] E2e: `dev-sesssion mcp start` writes `mcp.pid`, cleans up on SIGINT

---

## Chunk 16 — Cross-session and cross-project intelligence

> **Goal:** dev-sesssion learns from usage patterns across sessions and projects —
> surfacing which symbols are always loaded, which annotations are missing, and
> which context patterns correlate with productive sessions.
> **Depends on:** Chunk 11 (session memory), Chunk 12 (annotation system), Chunk 15 (MCP)
> **Est. sessions:** 3–4

### Rationale

Chunk 11 introduced `CONTEXT_LOG.md` — per-project session history. That data answers
questions like "which files am I always loading?" and "which always-include files have
I never modified?" But it is scoped to one project. A developer working across five
repos has no way to learn from patterns that span projects. This chunk introduces a
global dev-sesssion profile (local-only, opt-in) that aggregates anonymized usage patterns
and surfaces cross-project insights.

This is also where annotation quality feedback enters: if a file is always promoted to
Layer 2 within one session of being added to the index at Layer 0, its `@ai-layer-hint`
is wrong. The system should tell you.

### `~/.dev-sesssion/profile.yaml` — global profile (opt-in)

```yaml
# ~/.dev-sesssion/profile.yaml
# Created on first `dev-sesssion init` with --enable-profile flag, or via `dev-sesssion profile init`
# Never sent anywhere. Local only.

version: "1"
created_at: "2026-01-01T00:00:00Z"
opted_in: true

projects:
  /home/rajat/projects/resumind:
    last_session: "2026-04-07T14:00:00Z"
    session_count: 47
    adapter: claude
    avg_tokens_per_session: 8420
    top_symbols:
      - { symbol: "buildPrompt", file: "src/prompts/builder.ts", load_count: 47 }
      - { symbol: "AdaptiveRouter", file: "src/routing/adaptive.ts", load_count: 38 }
  /home/rajat/projects/clause:
    last_session: "2026-04-06T09:30:00Z"
    session_count: 12
    adapter: claude
    avg_tokens_per_session: 6100
```

### `ProfileManager` (new in `packages/core`)

- [ ] `ProfileManager` class:
  - `init(homeDir: string): Promise<void>` — creates `~/.dev-sesssion/profile.yaml`
  - `load(homeDir: string): Promise<Profile | null>` — returns null if not opted in
  - `recordSession(homeDir: string, projectRoot: string, entry: ContextLogEntry): Promise<void>` — appends session data to profile
  - `analyzeAnnotationQuality(homeDir: string, projectRoot: string): Promise<AnnotationQualityReport>`
    - Detects symbols that are consistently promoted from hint layer within the first session
    - Detects symbols that are declared `@ai-surface: public` but never appear in any loaded context
    - Returns suggested annotation corrections
  - `crossProjectStats(homeDir: string): Promise<CrossProjectStats>` — aggregates across all projects
  - `prune(homeDir: string, olderThan: Duration): Promise<void>` — removes old project entries

### `dev-sesssion profile` command

```bash
dev-sesssion profile init          # opt in, create ~/.dev-sesssion/profile.yaml
dev-sesssion profile stats         # cross-project summary
dev-sesssion profile quality       # annotation quality report for current project
dev-sesssion profile quality --fix # interactively apply suggested annotation corrections
dev-sesssion profile disable       # opt out, delete profile data
```

- [ ] `dev-sesssion profile quality`:
  - Runs `ProfileManager.analyzeAnnotationQuality()` for the current project
  - Reports: symbols whose `@ai-layer-hint` is consistently wrong (suggest updating annotation)
  - Reports: `@ai-surface: public` symbols that have never been loaded in any session (suggest `private`)
  - Reports: files that are always promoted to Layer 2 immediately (suggest changing layer default)
  - `--fix`: for each finding, prompts to update the annotation in source. Uses `AnnotationParser` to
    locate the JSDoc block and `AtomicWriter` to update it. Does NOT use a regex replacement —
    re-parses the file AST, locates the comment node, updates the specific tag value.

- [ ] `dev-sesssion profile stats`:
  - Lists all tracked projects with last session date, total sessions, avg token cost
  - Highlights: most expensive project (by avg tokens), most active project (by session count)
  - Suggests: projects with no session in >30 days (offer to remove from profile)

### Cross-session annotation feedback loop

This closes the loop that Chunk 12 opened:

```
Write @ai-layer-hint → index generates → session loads at hint depth
     ↑                                          ↓
profile quality --fix ←── profile records ← developer expands/collapses
```

The annotation is a hypothesis. Session behavior is the test. The profile is the feedback.

### Integration with `dev-sesssion update` and `dev-sesssion advance`

When a global profile is active, both commands call `ProfileManager.recordSession()`
after successfully writing `CONTEXT_LOG.md`. This is a best-effort write — profile
failures are logged as warnings, never as errors that block the lifecycle command.

### Privacy constraints (non-negotiable)

- [ ] Profile is **never transmitted** — no network calls from `ProfileManager`. Enforce
  in security audit: `ProfileManager` must not import any HTTP client or network module.
- [ ] Profile stores **symbol names and file paths only** — never file content, task text,
  or session notes. Enforced by `ProfileManager.recordSession()` schema validation.
- [ ] `dev-sesssion profile disable` deletes `~/.dev-sesssion/profile.yaml` and all its contents.
  No soft-delete, no backup. User must re-opt-in to re-enable.
- [ ] `dev-sesssion init` never creates a profile without explicit opt-in (`--enable-profile` flag
  or interactive confirmation). The default is opted-out.

### Tests

- [ ] Unit: `ProfileManager.recordSession()` stores only paths and symbol names, not content
- [ ] Unit: `ProfileManager.analyzeAnnotationQuality()` flags symbols promoted from hint within 1 session
- [ ] Unit: `ProfileManager.load()` returns null when `opted_in: false`
- [ ] Unit: profile write failure is caught and logged as warning — does not throw in `advance`
- [ ] E2e: `dev-sesssion profile quality --fix` updates annotation in source file correctly
- [ ] E2e: `dev-sesssion profile disable` deletes profile file
- [ ] Adversarial: `profile.yaml` with path traversal in project key — rejected by `PathValidator`
- [ ] Static analysis gate: `packages/core/src/profile/` must not import `http`, `https`, `fetch`,
  `node:http`, `node:https`, or `cross-fetch` — enforced via Biome custom lint rule

---

## Chunk 17 — Open ecosystem: PROTOCOL spec, community adapters, registry

> **Goal:** dev-sesssion's session format and annotation schema become a documented,
> stable protocol that the community can implement independently. A community adapter
> registry makes discovery easy.
> **Depends on:** Chunk 9 (open-source prep), Chunk 12 (annotation schema), Chunk 15 (MCP)
> **Est. sessions:** 2–3

### Rationale

v1's Chunk 9 prepared the codebase for open-source release. This chunk makes it a
platform. The distinction: open-source is about the code being available; platform is
about other people building on top of it. Two things turn a tool into a platform:
a stable protocol spec and a community adapter registry.

### PROTOCOL.md v2 — the session + annotation spec

Chunk 9 planned `PROTOCOL.md` as a spec for the `.session/` format. v2 extends it
to cover the annotation schema and `ai-index.yaml` format. The goal: any tool (not just
dev-sesssion) can read `.session/ai-index.yaml` and provide layered context to an AI agent.

- [ ] `PROTOCOL.md v2` sections:
  1. **Session format** — `.session/` directory layout, all file schemas with Zod-equivalent pseudocode
  2. **Annotation schema** — all `@ai-*` tags, their semantics, versioning policy
  3. **`ai-index.yaml` format** — full YAML schema, versioning, required vs optional fields
  4. **Layer semantics** — layer 0/1/2 definitions, how tools should render each
  5. **`session.yaml` format** — per-session config schema
  6. **Bootstrap contract** — what a compliant `BootstrapFormatter` must produce
  7. **MCP tool contract** — required tool names and input/output schemas for compliant MCP servers
  8. **Versioning policy** — semver for the protocol itself, separate from the package version

- [ ] Host `PROTOCOL.md v2` at `https://dev-sesssion.dev/protocol/v2` (GitHub Pages via Vitepress)
- [ ] Protocol version is declared in `ai-index.yaml` header (`version: "2"`) and in
  `session.yaml` header — consumers can detect incompatible versions

### Community adapter contract (v2 extension)

v1 documented the `Adapter` interface. v2 extends it for the layered context system:

```typescript
// New required methods in v2 adapter contract
export interface Adapter {
  // ... all v1 methods ...

  // NEW in v2 — required if adapter wants layered context support
  getFormatter(): BootstrapFormatter  // must implement formatLayeredContext()

  // NEW in v2 — optional, for adapters that support MCP
  getMcpConfig?(): McpConfig | null
}
```

Adapters that do not implement `formatLayeredContext()` fall back to the v1 flat file list behavior.
Backward compatible — v1 community adapters keep working.

- [ ] Update `ADAPTERS.md` with v2 contract changes, migration guide for v1 adapters
- [ ] Add `BootstrapFormatter.formatLayeredContext()` to the required interface in `packages/core`
- [ ] Provide a `FallbackLayeredFormatter` base class that wraps a v1 formatter and
  converts `ResolvedContext` to a flat file list (Layer 2 files only) — enables v1 adapters
  to opt into the v2 type system without breaking

### Community registry (`registry.dev-sesssion.dev`)

A minimal registry: a GitHub-hosted JSON file (`registry.json`) listing community adapters.
No npm registry dependency. Discovery via `dev-sesssion registry search`.

```json
{
  "version": "1",
  "adapters": [
    {
      "name": "zed",
      "description": "Zed editor adapter for dev-sesssion",
      "package": "dev-sesssion-adapter-zed",
      "version": "1.0.0",
      "protocol_version": "2",
      "author": "community",
      "repo": "https://github.com/example/dev-sesssion-adapter-zed"
    }
  ]
}
```

- [ ] `dev-sesssion registry search [query]` — fetches `registry.json` from GitHub, filters by query
- [ ] `dev-sesssion registry add <package>` — installs adapter package, registers in `session.yaml`
- [ ] `registry.json` PR-based contribution process — documented in `ADAPTERS.md`
- [ ] Registry fetch is always read-only from the CLI — no write API
- [ ] `registry.json` is versioned in a dedicated `registry` branch of the main repo

### Versioning policy for the protocol

The protocol version is independent of the npm package version:

| Scenario | Protocol bump | Package bump |
|---|---|---|
| New `@ai-*` tag added (backward compatible) | minor (2.1) | minor |
| `ai-index.yaml` schema field renamed | major (3.0) | major |

---

## Revision — 2026-04-14

The chunk structure above was revised based on a builder critique. The original spec (Chunks 12–17 above)
is preserved as the design record. **The actual implementation plan is in `.session/PLAN_13.md` through
`.session/PLAN_18.md`, which supersede the chunk sections above.**

### Changes made

| Original | Revised | Reason |
|---|---|---|
| Chunk 12: Annotation schema + index | Split: 13A (auto-extract) + 13B (annotations) | Cold-start: zero-config first, annotations as opt-in refinement |
| `@ai-deps` tag | Dropped | Call graphs are derivable from AST — don't ask humans to maintain them |
| `@ai-context-cost` tag | Dropped | `TokenCounter` already handles this; human guesses add no information |
| Chunk 15: MCP server | Moved to Chunk 14 (before layers) | Highest leverage, zero v2 dependency needed for basic server |
| Chunk 14: Adapters | Moved to Chunk 16; no shared base class | Cursor (.mdc YAML) and Windsurf (plain-text) differ enough to fight a base class |
| `session.yaml` + `trim-overrides.json` + `layer-overrides.json` | `session.yaml` with `excludes:` key | One file for session state; advance migrates existing trim-overrides |
| Chunk 16: Cross-project intelligence | Deferred to backlog (PLAN_17.md) | Requires 3 gates before value; `--fix` is fragile; defer until annotation data matures |
| Chunk 17: Open ecosystem | Deferred to backlog (PLAN_18.md) | Spec before battle-testing locks decisions; no community adapters to discover yet |

### Revised sequence

```
13A — Auto-extract ai-index (zero-config)       ← start here
13B — @ai-* annotation refinement               ← depends on 13A
14  — MCP server (basic, v1-compatible)         ← depends on 13A (query_ai_index)
15  — Layered context loading                   ← depends on 13A + 14
16  — Cursor + Windsurf adapters                ← depends on 7 + 15
--- ship, get real-world feedback ---
17  — BACKLOG: Cross-project intelligence
18  — BACKLOG: Open ecosystem
```
| New MCP tool added | minor (2.1) | minor |
| Bug fix in existing behavior | patch | patch |
| New adapter in `packages/adapters/` | none | minor |

- [ ] `AiIndexManager.deserialize()` checks `version` field and throws a clear `ParseError` with
  upgrade instructions if version is incompatible
- [ ] `dev-sesssion migrate-protocol` command: upgrades `.session/` files from protocol v1 to v2
  (renames fields, converts FILE_INDEX entries to `ai-index.yaml` format)

### Launch assets for ecosystem

- [ ] Blog post: "The context contract: how dev-sesssion v2 makes AI tools read less and understand more"
- [ ] `ADAPTERS.md` — updated with v2 contract, FallbackLayeredFormatter usage, registry submission guide
- [ ] GitHub issue templates: `adapter-request.md`, `protocol-feedback.md`
- [ ] `dev-sesssion doctor` command — validates that the current project's `.session/` directory
  is spec-compliant (checks all file schemas, version fields, cross-references between
  `ai-index.yaml` and `FILE_INDEX.md`)

### Tests

- [ ] Unit: `FallbackLayeredFormatter` correctly converts `ResolvedContext` to flat file list
- [ ] Unit: `AiIndexManager.deserialize()` throws `ParseError` on version mismatch with clear message
- [ ] Unit: `dev-sesssion migrate-protocol` correctly upgrades v1 session to v2 format
- [ ] E2e: `dev-sesssion registry search cursor` returns registry entries containing "cursor"
- [ ] E2e: `dev-sesssion doctor` on a valid v2 project exits 0
- [ ] E2e: `dev-sesssion doctor` on a corrupted `ai-index.yaml` exits 1 with actionable error

---

## Revised chunk sequence and dependencies

```
Chunks 1–11 (v1, frozen)
        │
        ├── Chunk 12 — Annotation schema + ai-index generator
        │         └── Chunk 13 — Layered context loading
        │                   └── Chunk 14 — Cursor + Windsurf adapters
        │                   └── Chunk 15 — MCP server mode
        │                             └── Chunk 16 — Cross-session intelligence
        │                             └── Chunk 17 — Open ecosystem
        │
        └── (Chunk 9 open-source prep must precede Chunk 17)
```

Chunks 12–13 are the critical path. Everything in v2 builds on the annotation system
and the layer model. Do not start Chunk 14, 15, or 16 until Chunk 13's `LayerManager`
and `ResolvedContext` types are stable.

---

## v2 success metrics (additions to v1 metrics)

| Metric | Target |
|---|---|
| `dev-sesssion index` on 200-file project | < 10s (including API token counting) |
| Layer 0 context for a 50-symbol module | < 200 tokens |
| `dev-sesssion layers init` produces under-budget session | >80% of the time on first run |
| MCP `get_session_context` response time | < 200ms |
| Annotation quality: symbols with correct `@ai-layer-hint` after 5 sessions + `profile quality --fix` | >90% |
| Community adapters in registry at launch | ≥ 2 (Zed, Neovim targets) |
| Protocol v2 adoption by non-dev-sesssion tool | ≥ 1 by 6 months post-launch |

---

## Open questions introduced in v2

| Question | Status | Notes |
|---|---|---|
| Should `ai-index.yaml` be committed in personal mode? | Open | Derived from source annotations (committed) but contains token costs (env-specific). Lean toward: commit the symbol entries, gitignore `token_cost` fields via a `--strip-costs` flag on `index`. |
| `.vue` / `.svelte` annotation parsing | Deferred to Chunk 14 | `AnnotationParser` is `.ts`/`.js` only in Chunk 12. Framework-specific parsers belong with their adapters. |
| Layer 1 "signatures only" for non-TypeScript files | Open | Python, Go, Rust all have different surface extraction approaches. v2 targets TypeScript/JavaScript only. Protocol v2 spec should leave room for language-specific layer renderers. |
| MCP server auth model | Decided (Chunk 15) | `session_token` in `.session/mcp-token.txt` — local file, not env var. Prevents token leakage into shell history. |
| Profile data format: YAML vs SQLite | Open | YAML is approachable but slow at scale (10k+ entries). SQLite is fast but adds a native dependency. Decision gate: if `ProfileManager.crossProjectStats()` is slow on 100-project fixture, migrate to SQLite. `ProfileManager` interface stays identical — storage is an implementation detail. |
| `dev-sesssion index` incremental update strategy | Decided (Chunk 12) | mtime-based. Not content-hash-based. mtime is fast and sufficient; false positives (mtime changed, content same) result in a no-op reindex, not an error. |