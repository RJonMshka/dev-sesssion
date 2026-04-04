## Chunk 6 — Programmatic API (`packages/core` public surface)

### Tasks

- [ ] Design final public API surface — keep it minimal and stable (semver-safe)
- [ ] `SessionManager` unified facade:
- [ ] Re-export all useful types from root `index.ts`
- [ ] Write `API.md` — full programmatic API reference with examples
- [ ] Validate dual CJS/ESM output: `publint` + `@arethetypeswrong/cli` — zero errors
- [ ] Add `exports` map test — verify each subpath resolves correctly in both CJS and ESM contexts
- [ ] Write usage examples:
