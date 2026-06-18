---
chunk_id: 17
title: "BACKLOG — Cross-session and cross-project intelligence"
depends_on: []
tasks: []
---

## Chunk 17 — BACKLOG: Cross-session and cross-project intelligence

**Status: Deferred.** Do not start until Chunks 13A–16 are complete and have real-world usage data.

**Why deferred:**
- The annotation quality feedback loop (`@ai-layer-hint` is wrong → profile detects it → `--fix` corrects it) requires: (a) @ai-* annotations exist on the project, (b) multiple sessions of usage data, (c) user has opted into profiling. That's three gates before any value lands.
- `profile quality --fix` requires programmatic JSDoc modification while preserving formatting — notoriously difficult and a major bug surface for marginal value at this stage.
- Cross-project aggregation adds no insight beyond what a single project's `CONTEXT_LOG.md` already provides, until the per-project data is mature.

**Revisit when:**
- Chunks 13A–16 are shipped and in use
- Real users are adding `@ai-*` annotations
- `CONTEXT_LOG.md` has multiple sessions of layer expand/collapse data
- Annotation hints are actually being found to be wrong in practice

**Original spec:** See `docs/PLANv2.md` — "Chunk 16 — Cross-session and cross-project intelligence" for the
full design (ProfileManager, `dev-sesssion profile` commands, privacy constraints, annotation correction loop).
The design is sound; the sequencing was premature.
