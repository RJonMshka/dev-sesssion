---
chunk_id: "13a"
title: "Auto-extract ai-index (zero-config)"
depends_on: [3, 5]
tasks:
  - text: "`ParsedSymbol` type: `{ name, surface, summary, signature, line, tags }` — surface defaults to `public` for exported symbols; summary auto-extracted from existing JSDoc `/** */` blocks"
    status: todo
  - text: "`ParsedFile` type: `{ path, moduleSummary, exports: ParsedSymbol[], tokenCost, tokenCostAccurate }` — fully populated from TypeScript compiler API with no annotations required"
    status: todo
  - text: "`AutoExtractor` class in `packages/core/annotation/` — `extractFile(path: ValidatedPath): Promise<ParsedFile>` using `@typescript-eslint/typescript-estree` AST; handles exported functions, classes, consts, type aliases, interfaces; extracts existing `/** */` JSDoc summary if present"
    status: todo
  - text: "`AutoExtractor.extractDirectory(root, options)` — walks via `GitignoreAwareWalker`; skips non-TS/JS files; graceful empty-result on parse errors (logs warning, never throws)"
    status: todo
  - text: "`AiIndexBuilder` class — `build(files: ParsedFile[], tokenCosts: TokenCostMap): AiIndex`, `merge(existing: AiIndex, updated: AiIndex): AiIndex` (mtime-based, only reprocesses changed files), `serialize(index: AiIndex): string` (deterministic YAML, keys sorted), `deserialize(content: string): AiIndex`"
    status: todo
  - text: "`AiIndex` type: `{ version: '2', generated_at, project_root, files: Record<string, FileEntry> }`; `FileEntry`: `{ module_summary, layer_default, token_cost, token_cost_accurate, exports: Record<string, SymbolEntry> }`"
    status: todo
  - text: "`AiIndexManager` class — `load(root)`, `save(root, index)` (atomic write + SecretScanner), `queryByLayer(index, layer)`, `queryByTag(index, tag)`, `queryByChunk(index, chunkId)`, `renderLayer0(entry)` (module summary + public symbol names only), `renderLayer1(entry)` (signatures, no impl), `renderLayer2(path)` (full source)"
    status: todo
  - text: "`dev-sesssion index` command — runs `AutoExtractor.extractDirectory()` → `TokenCounter.countFiles()` → `AiIndexBuilder.build()` → `AiIndexManager.save()`; reports: 'Indexed N files, M public symbols. Estimated context surface: X tokens'; warns if Layer 0 cost exceeds adapter budget"
    status: todo
  - text: "`dev-sesssion index --update` — reads existing index mtimes, skips unchanged files, merges via `AiIndexBuilder.merge()`"
    status: todo
  - text: "`dev-sesssion index --dry-run` — no filesystem changes; `--file <path>` single file; `--show <path>` prints index entry; `index stats` subcommand — N files, M symbols, token cost breakdown by layer"
    status: todo
  - text: "Add `.session/ai-index.yaml` to `.gitignore` in personal mode `init`; include (commit) in team mode"
    status: todo
  - text: "`BootstrapFormatter` interface gains `formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string`; `ClaudeBootstrapFormatter` implements it — prose instruction block + Layer 0 content replaces manual file list in NEXT_PROMPT.md when index exists"
    status: todo
  - text: "Export from `packages/core`: `AutoExtractor`, `AiIndexBuilder`, `AiIndexManager`, `AiIndex`, `FileEntry`, `SymbolEntry`, `ParsedFile`, `ParsedSymbol`"
    status: todo
  - text: "Unit: `AutoExtractor.extractFile` — exported function, class, const, type alias, interface; existing JSDoc summary extracted; unannotated export gets empty summary; parse error returns empty exports with warning"
    status: todo
  - text: "Unit: `AiIndexBuilder.merge` — file added, removed, modified; unchanged file skips re-extraction"
    status: todo
  - text: "Unit: `AiIndexBuilder.serialize` — deterministic byte-for-byte output on same input"
    status: todo
  - text: "Unit: `AiIndexManager.renderLayer0` — returns only module summary + public symbol names (no signatures); `renderLayer1` — signatures only; `queryByChunk` cross-references FILE_INDEX chunk tags"
    status: todo
  - text: "E2e: `dev-sesssion index` on fixture project — verify ai-index.yaml YAML shape"
    status: todo
  - text: "E2e: `dev-sesssion index --update` skips unchanged files; `--dry-run` writes nothing"
    status: todo
---

## Chunk 13A — Auto-extract ai-index (zero-config)

**Goal:** Generate `.session/ai-index.yaml` — a symbol-level surface map — from existing TypeScript/JS source
with **zero annotations required**. Any existing `/** */` JSDoc summaries are captured. The tool provides
immediate value on day one, before any `@ai-*` tags are added.

**Key design decisions:**
- `AutoExtractor` uses `@typescript-eslint/typescript-estree` for AST parsing. No regex.
- Handles `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`. Skips `.vue`, `.svelte` (Chunk 16 concern).
- `@ai-*` tag support is added in Chunk 13B on top of this foundation — not a prerequisite.
- Dropped from original plan: `@ai-deps` (call graph is derivable from AST, not hand-maintained) and `@ai-context-cost` (TokenCounter already handles this).

### Tasks

- [ ] `ParsedSymbol` type: `{ name, surface, summary, signature, line, tags }` — surface defaults to `public` for exported symbols; summary auto-extracted from existing `/** */` JSDoc
- [ ] `ParsedFile` type: `{ path, moduleSummary, exports: ParsedSymbol[], tokenCost, tokenCostAccurate }` — fully populated from TS compiler with no annotations required
- [ ] `AutoExtractor` class in `packages/core/annotation/` — `extractFile(path)` via `@typescript-eslint/typescript-estree`; handles exported functions, classes, consts, type aliases, interfaces
- [ ] `AutoExtractor.extractDirectory(root, options)` — walks via `GitignoreAwareWalker`; graceful empty-result on parse errors
- [ ] `AiIndexBuilder` class — `build`, `merge` (mtime-based incremental), `serialize` (deterministic YAML, sorted keys), `deserialize`
- [ ] `AiIndex` + `FileEntry` + `SymbolEntry` types
- [ ] `AiIndexManager` class — `load`, `save` (atomic + SecretScanner), `queryByLayer`, `queryByTag`, `queryByChunk`, `renderLayer0`, `renderLayer1`, `renderLayer2`
- [ ] `dev-sesssion index` command — full regen pipeline + reports + over-budget warning
- [ ] `dev-sesssion index --update` — incremental via mtime
- [ ] `dev-sesssion index --dry-run`, `--file`, `--show`, `stats` subcommand
- [ ] Add `ai-index.yaml` to gitignore (personal) / commit (team) in `init`
- [ ] `BootstrapFormatter.formatAiIndex()` + `ClaudeBootstrapFormatter` implementation
- [ ] Export new types from `packages/core`
- [ ] Unit: `AutoExtractor.extractFile` (all export kinds, existing JSDoc, parse error handling)
- [ ] Unit: `AiIndexBuilder.merge` (add/remove/modify), `serialize` (deterministic)
- [ ] Unit: `AiIndexManager.renderLayer0/1`, `queryByChunk`
- [ ] E2e: `dev-sesssion index` on fixture; `--update` skips unchanged; `--dry-run` writes nothing
