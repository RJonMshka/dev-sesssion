---
chunk_id: 18
title: "BACKLOG — Open ecosystem: PROTOCOL spec, community adapters, registry"
depends_on: []
tasks: []
---

## Chunk 18 — BACKLOG: Open ecosystem

**Status: Deferred.** Do not start until v2 core (13A–16) is battle-tested in production.

**Why deferred:**
- Shipping a protocol spec before the protocol is stable locks in decisions prematurely. The annotation schema, layer semantics, and MCP tool contracts **will** change once real users hit them. Versioning a spec too early turns design debt into breaking changes.
- A community adapter registry is overbuilt when there are zero community adapters. npm naming convention (`dev-session-adapter-*`) + a docs page is sufficient for discovery until there are actual adapters to find.
- The `FallbackLayeredFormatter` backward-compatibility story requires a stable v2 interface to wrap — that interface isn't stable yet.

**Revisit when:**
- v2 core has been used in production for 1–2 months
- The annotation schema, `session.yaml` format, and MCP tool contracts have stabilized (no breaking changes in 4+ weeks)
- At least one community adapter exists or is being built
- PROTOCOL.md can describe what exists, not what was planned

**Original spec:** See `docs/PLANv2.md` — "Chunk 17 — Open ecosystem" for the full design
(PROTOCOL.md v2, FallbackLayeredFormatter, community registry, `dev-session registry search/add`).
