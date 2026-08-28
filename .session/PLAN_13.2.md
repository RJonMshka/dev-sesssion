---
chunk_id: 13.2
title: "@ai-* annotation refinement layer"
depends_on: [13.1]
tasks:
  - text: "`AnnotationParser` class in `packages/core/annotation/` — `parseFile(path): Promise<FileAnnotations>` extracts `@ai-*` tags from JSDoc/TSDoc blocks via AST (same `@typescript-eslint/typescript-estree` instance, no double-parse)"
    status: todo
  - text: "5 supported tags: `@ai-summary` (overrides auto-extracted JSDoc), `@ai-surface` (`public | private`), `@ai-layer-hint` (`0 | 1 | 2`), `@ai-layer-default` (file-level default), `@ai-tags` (comma-separated strings)"
    status: todo
  - text: "`FileAnnotations` type: `{ path, moduleAnnotation?: ModuleAnnotation, symbols: Record<string, SymbolAnnotation> }` — sparse; only annotated symbols appear"
    status: todo
  - text: "`AnnotationParser.mergeInto(file: ParsedFile, annotations: FileAnnotations): ParsedFile` — merges @ai-* overrides into auto-extracted ParsedFile; @ai-surface private marks symbol for exclusion from Layer 0/1; @ai-summary replaces auto-extracted summary"
    status: todo
  - text: "`AutoExtractor.extractFile()` updated: calls `AnnotationParser.parseFile()` and merges annotations before returning — callers get a fully merged ParsedFile with no awareness of two phases"
    status: todo
  - text: "`dev-sesssion index` command updated: reports annotation coverage ('M of N public symbols have @ai-summary')"
    status: todo
  - text: "Unit: `@ai-surface: private` on exported symbol excludes it from renderLayer0 and renderLayer1"
    status: todo
  - text: "Unit: `@ai-summary` overrides auto-extracted JSDoc summary"
    status: todo
  - text: "Unit: `@ai-layer-hint: 0` on file with no auto-hint sets correct layer"
    status: todo
  - text: "Unit: `@ai-layer-default` file-level annotation applies to all symbols without explicit hint"
    status: todo
  - text: "Unit: unknown `@ai-*` tag is silently ignored (forward compatibility)"
    status: todo
  - text: "Adversarial: `@ai-summary` with YAML injection characters (quotes, colons, `{}`); verify serialize escapes correctly"
    status: todo
  - text: "Adversarial: malformed `@ai-layer-hint: banana` — falls back to default, no throw"
    status: todo
  - text: "E2e: `dev-sesssion index` on fixture with mixed annotated + unannotated files — annotated values take precedence; unannotated use auto-extracted values"
    status: todo
---

## Chunk 13B — @ai-* annotation refinement layer

**Goal:** Add optional `@ai-*` JSDoc tags that let developers *refine* what 13A auto-extracted.
13A gives you a working index on day one. 13B lets you improve it incrementally.

**What changes from the original PLANv2:**
- `@ai-deps` removed — call graphs should be derived from AST, not hand-maintained
- `@ai-context-cost` removed — `TokenCounter` already handles this
- 7 tags → 5 tags: `@ai-summary`, `@ai-surface`, `@ai-layer-hint`, `@ai-layer-default`, `@ai-tags`
- Merge is transparent to callers — `AutoExtractor.extractFile()` returns one unified `ParsedFile`

### Tasks

- [ ] `AnnotationParser` class — `parseFile(path): Promise<FileAnnotations>` via AST (no double-parse)
- [ ] 5 tags: `@ai-summary`, `@ai-surface`, `@ai-layer-hint`, `@ai-layer-default`, `@ai-tags`
- [ ] `FileAnnotations` type — sparse; only annotated symbols appear
- [ ] `AnnotationParser.mergeInto(file, annotations): ParsedFile` — override logic
- [ ] `AutoExtractor.extractFile()` updated: calls AnnotationParser internally, returns merged result
- [ ] `dev-sesssion index` annotation coverage report
- [ ] Unit: `@ai-surface: private` excludes from Layer 0/1
- [ ] Unit: `@ai-summary` overrides auto-extracted JSDoc
- [ ] Unit: `@ai-layer-hint: 0` sets correct layer
- [ ] Unit: `@ai-layer-default` applies file-level default
- [ ] Unit: unknown tag silently ignored
- [ ] Adversarial: YAML-injection in `@ai-summary`
- [ ] Adversarial: malformed `@ai-layer-hint` value falls back gracefully
- [ ] E2e: mixed annotated + unannotated fixture — correct merge precedence
