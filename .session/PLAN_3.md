## Chunk 3 — Chunk 3.5 — Token counting infrastructure

### Tasks

- [ ] Add `TokenCounter` class to `packages/core`:
- [ ] `TokenCostMap` type: `Map<ValidatedPath, { tokens: number; accurate: boolean }>`
- [ ] `TokenBudget` type: `{ limit: number; used: number; remaining: number; overBudget: boolean; accurate: boolean }`
- [ ] Update `GitignoreAwareWalker.estimateTokenCost()` to delegate to `TokenCounter` (real API) with heuristic fallback — rename to `measureTokenCost()` to reflect accuracy upgrade
- [ ] Update `ContextBudgetCalculator.estimate()` to use `TokenCounter.countFiles()` — async, replaces sync heuristic
- [ ] Update `FileIndexEntry.token_cost` population in `init` flow to use real counts when API key present
- [ ] Validate `DEFAULT_CONTEXT_BUDGET = 4000` against real measured bootstrap contexts — adjust default if needed; document rationale in code
- [ ] Export `TokenCounter`, `TokenCostMap`, `TokenBudget` from `packages/core`
- [ ] No new runtime dependencies — uses `@anthropic-ai/sdk` already implied by the adapter system; add it to `core` if not already present (approve explicitly per cross-cutting dep rules)
- [ ] Unit: `countString` returns heuristic result when no API key; `isAccurate: false`
- [ ] Unit: `countFile` reads file and delegates to `countString`
- [ ] Integration: `countFiles` batch returns correct `TokenCostMap` shape
- [ ] Unit: `ContextBudgetCalculator` marks budget as `accurate: false` when heuristic used
- [ ] Unit: offline mode does not throw — degrades gracefully
