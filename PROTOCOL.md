# SESSION PROTOCOL v1.0

The Session Protocol defines the on-disk format of the `.session/` directory —
the "session brain" that lets an AI coding assistant resume work across context
windows without re-reading the whole codebase.

The protocol is deliberately **plain-text and tool-agnostic**: every file is
Markdown or YAML/JSON that a human can read and edit, and that any tool can
parse. `dev-sesssion` is the reference implementation, but nothing in this spec
is specific to it. This document describes version **1.0** of the format.

> Status: stable. Additive changes (new optional fields, new files) are allowed
> within v1.x. Removing or renaming a field, or changing its meaning, requires a
> major version bump.

---

## Design principles

1. **Human-readable first.** Every artifact is Markdown or YAML/JSON. No binary
   state, no databases. You can read and hand-edit any file.
2. **Self-resuming.** A fresh session reads a small, bounded set of files and
   knows exactly what to do next — without scanning the repository.
3. **Bounded context.** The protocol is built around a *context budget*; only
   files relevant to the active chunk are loaded.
4. **Deterministic.** Generated files (e.g. `ai-index.yaml`) serialize with
   sorted keys so diffs are stable.
5. **Safe to parse.** Frontmatter is parsed with the JS engine disabled and
   validated against a schema; untrusted keys are stripped.

---

## Directory layout

```
.session/
├── SESSION_STATE.md     # REQUIRED — active chunk, tasks, notes (the brain)
├── NEXT_PROMPT.md       # REQUIRED — ≤20-line self-contained resume prompt
├── FILE_INDEX.md        # REQUIRED — files grouped by chunk, with purposes
├── PLAN_<n>.md          # REQUIRED (≥1) — one plan chunk per file
├── ROUTINES.md          # OPTIONAL — the start/end session routine
├── DONE_LOG.md          # OPTIONAL — archive of completed chunks
├── CONTEXT_LOG.md       # OPTIONAL — append-only session memory / analytics
├── ai-index.yaml        # OPTIONAL — extracted symbol index (layered loading)
├── trim-overrides.json  # OPTIONAL — per-file context exclusions
└── backups/             # OPTIONAL — pre-compaction file backups
```

A directory is a valid v1.0 session if and only if the four REQUIRED artifacts
are present and parse against the schemas below.

---

## Core artifacts

### `SESSION_STATE.md` (required)

YAML frontmatter + a free-form Markdown body. The frontmatter is the
machine-readable state; the body is human narrative.

```yaml
---
active_chunk: 16              # integer id of the chunk in progress
session_id: "chunk-16-..."    # opaque id for the current session
last_updated: "2026-06-17"    # ISO date (YYYY-MM-DD)
tasks:                        # tasks for the active chunk
  - text: "Implement X"
    status: done              # one of: todo | in-progress | done
notes:                        # rolling notes, newest-relevant first
  - "Gotcha: CliError renders to stdout via clack, not stderr."
last_worked_files:            # files touched most recently
  - packages/cli/src/commands/init.ts
completed_chunks:             # map of chunk id -> completion date
  "1": "2026-01-01"
max_prompt_lines: 20          # optional; NEXT_PROMPT.md line cap (5-50)
---

# Session State
...human-readable narrative for the active chunk...
```

**Field semantics**

| Field | Type | Notes |
|---|---|---|
| `active_chunk` | integer ≥ 1 | Matches a `PLAN_<n>.md` chunk id. |
| `session_id` | string | Opaque; identifies the working session. |
| `last_updated` | string | `YYYY-MM-DD`. |
| `tasks[]` | list | `{ text, status }`; `status ∈ {todo, in-progress, done}`. Optional ISO-8601 `added_at` / `completed_at`. |
| `notes[]` | list of string | Durable gotchas/decisions. Trim aggressively. |
| `last_worked_files[]` | list of string | Repo-relative paths. |
| `completed_chunks` | map | chunk id → ISO date. |
| `max_prompt_lines` | number | Optional. `NEXT_PROMPT.md` line cap, 5–50. Defaults to 20; omitted from the file when default. |

### `NEXT_PROMPT.md` (required)

A **≤20-line, self-contained** plain-text prompt that a fresh session can act on
immediately. It names the active chunk, what was just done, the next step, the
key files to load, and any gotchas. It must not assume prior conversation. It is
regenerated whenever state changes (`update`, `advance`, `init`).

### `FILE_INDEX.md` (required)

YAML frontmatter (`version`, `last_updated`) followed by Markdown tables that map
files to the chunk that owns them, each with a one-line purpose:

```markdown
---
version: 1
last_updated: "2026-06-17"
---

# File Index

## Always Include
| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |

## Chunk 4 — CLI: init command
| File | Purpose |
|---|---|
| packages/cli/src/commands/init.ts | Init orchestrator |
```

The `## Always Include` group (chunk tag `0`) is loaded in every session; each
`## Chunk <n>` group is loaded only when that chunk is active. Grouping is by
heading — rows under any other heading are ignored. A file needed by two chunks
appears under both.

Indexes larger than 500 entries are paginated into `FILE_INDEX_1.md`,
`FILE_INDEX_2.md`, … alongside the root file.

### `PLAN_<n>.md` (required, one or more)

One file per plan chunk. The filename matches `^PLAN_(\d+)\.md$`. YAML
frontmatter declares the chunk; the body is the human plan. `chunk_id` is a
number ≥ 1 and may be fractional (e.g. `3.5`), so an interstitial chunk can be
inserted between two existing ones without renumbering the whole plan.

```yaml
---
chunk_id: 4
title: "CLI: init command"
depends_on: [3]        # chunk ids that must complete first (optional, default [])
est_sessions: 2        # optional estimate
tasks:
  - text: "Parse args and detect project"
    status: done
---

## Chunk 4 — CLI: init command
...
```

---

## Optional artifacts

### `ROUTINES.md`
Documents the **start** routine (read `SESSION_STATE.md` → load active-chunk
files from `FILE_INDEX.md` → confirm before coding) and the **end** routine
(update state, update index, rewrite `NEXT_PROMPT.md`).

### `CONTEXT_LOG.md`
Append-only log of session events (loads, expansions, advances) used for
staleness detection and analytics. Each entry is a timestamped record; the file
is prunable.

### `ai-index.yaml`
A deterministic, extracted index of exported symbols and their summaries, used
for **layered context loading**: Layer 0 = module summaries, Layer 1 = public
signatures, Layer 2 = full source (loaded on demand). Serialized with sorted
keys. When present, prompts reference summaries instead of inlining whole files.

### `DONE_LOG.md`
Append-only archive of chunks that have been completed and advanced past,
written when a chunk is archived. It exists so `SESSION_STATE.md` can be
compacted without losing the record.

### `trim-overrides.json`
Per-file context exclusions chosen by the user (or auto-selected to fit a
budget). Cleared on `advance`.

---

## Context layers (summary)

When `ai-index.yaml` exists, each indexed file is assigned an effective layer:

| Layer | Content | When |
|---|---|---|
| 0 | Module summary + symbol names | Default for chunk files |
| 1 | Public signatures | Always-include files; raised by `@ai-layer-default` |
| 2 | Full source | Files referenced by an active task |

Layering is the mechanism that keeps the resume prompt within budget while still
pointing the assistant at everything relevant.

---

## Conformance

A tool conforms to Session Protocol v1.0 if it:

1. Reads and writes the four required artifacts in the formats above.
2. Treats `active_chunk` as authoritative for what to load.
3. Keeps `NEXT_PROMPT.md` within the configured line cap and self-contained.
   The cap defaults to 20 and may be set per project via `max_prompt_lines`
   in `SESSION_STATE.md` frontmatter (bounds: 5–50). A conforming tool MUST
   refuse to write a prompt that exceeds it.
4. Parses frontmatter safely (no code execution) and validates required fields.
5. Ignores unknown optional fields and files rather than failing.

Adapters (see [docs/authoring-adapters.md](docs/authoring-adapters.md)) map this
neutral format onto a specific AI tool's native config (e.g. `CLAUDE.md`,
`AGENTS.md`, `.cursorrules`).
