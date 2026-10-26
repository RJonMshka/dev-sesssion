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
├── context-manifest.json # OPTIONAL — what the current NEXT_PROMPT.md loads, and why
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
active_chunk: 16              # id of the chunk in progress (may be fractional, e.g. 3.5)
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
project_name: "Rocket Shop"   # optional; overrides the detected project name
session_base:                 # optional; where the next session starts
  commit: "0123456789abcdef0123456789abcdef01234567"
  dirty:
    - path: "src/wip.ts"
      hash: "9f2c4e1a7b3d5f60"
---

# Session State
...human-readable narrative for the active chunk...
```

**Field semantics**

| Field | Type | Notes |
|---|---|---|
| `active_chunk` | number ≥ 1 | Matches a `PLAN_<n>.md` chunk id, so it may be fractional. Advancing moves it to the lowest chunk id above it — `3` → `3.5`, and `1` → `3` when there is no chunk `2`. |
| `session_id` | string | Opaque; identifies the working session. |
| `last_updated` | string | `YYYY-MM-DD`. |
| `tasks[]` | list | `{ text, status }`; `status ∈ {todo, in-progress, done}`. Optional ISO-8601 `added_at` / `completed_at`. Replaced by the new chunk's tasks on advance. A task's status is the higher of what this list and `PLAN_<n>.md` record for the same exact text — `done` > `in-progress` > `todo` — so recording status here is enough, and `PLAN_<n>.md` need not be rewritten. |
| `notes[]` | list of string | Durable gotchas/decisions. Trim aggressively. A note copied from a repository file is written as an attributed quotation, e.g. `Quoted from CLAUDE.md § "Setup step": "…"`, so a reader can tell it from the owner's own notes. |
| `last_worked_files[]` | list of string | Repo-relative paths. |
| `completed_chunks` | map | chunk id → ISO date. |
| `max_prompt_lines` | number | Optional. `NEXT_PROMPT.md` line cap, 5–50. Defaults to 20; omitted from the file when default. |
| `project_name` | string | Optional. The project name the prompt shows, 1–214 characters on one line. When absent, a tool uses the `name` in `package.json`, or else the directory name. Written only when it differs from that. |
| `session_base` | map | Optional. Where the next session starts, recorded by `init`, `update` and `advance` in a git work tree. `commit` is `HEAD` then (40 or 64 hex characters; absent in a repository with no commits). `dirty[]` lists the files already modified or untracked then, each `{ path, hash }` with `hash` the `contentHash`, at most 200; with more, no base is written. A tool that tags files a session touched diffs against it; a tool that does not may ignore it. Absent outside git. |

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

One file per plan chunk. The filename matches `^PLAN_(\d+(?:\.\d+)?)\.md$`. YAML
frontmatter declares the chunk; the body is the human plan. `chunk_id` is a
number ≥ 1 and may be fractional (e.g. `3.5`), so an interstitial chunk can be
inserted between two existing ones without renumbering the whole plan.

`files` is optional. It lists repository-relative paths the chunk's plan
section names outside its task lines — a "Key Files" block, a backticked path
in a numbered step. A tool MAY tag those files to the chunk in `FILE_INDEX.md`.
A chunk without `files` is valid, and a reader MUST accept it.

`brief` is optional. It holds the chunk's plan section — goal, steps, file
list — with its task lines removed, as a YAML string (written as a literal
block). At most 6,000 characters. A tool MAY point the agent at `PLAN_<n>.md`
for it. A chunk without `brief` is valid, and a reader MUST accept it.

```yaml
---
chunk_id: 4
title: "CLI: init command"
depends_on: [3]        # chunk ids that must complete first (optional, default [])
est_sessions: 2        # optional estimate
files:                 # optional — paths the plan section names outside its tasks
  - "src/commands/init.ts"
brief: |2-             # optional — the section's own text without its task lines
  **Goal**: a working `init` command.
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

A file entry MAY also carry two optional keys. An entry without them stays
valid, and a reader MUST accept it:

- `hash` — the content hash of the whole file.
- `units` — every **code unit** in the file, keyed by id. A unit is a top-level
  declaration, exported or not, or a method of a top-level class or object
  literal. Each one records `kind` (`function`, `class`, `method`, `variable`,
  `type`, `interface`, `enum`), `start` and `end` (1-based, inclusive; `start`
  is the attached `/** */` block when there is one), `tokens`, `hash`, and
  `exported`. An id is the declared name, `Parent.member` for a member, with
  `~2`, `~3`… appended to repeats of the same name, such as overloads.
  A member name is letters, digits, `_`, `$` and `-` only: a member whose
  string key holds anything else, such as `"a b"` or `"a.b"`, is not a unit,
  and a reader drops a row whose id is not of that shape. Ids are printed in
  prompts, so they must stay references.
  `exported` is also true for a declaration exported through a local
  `export { name }`. A unit MAY carry `refs`: how many references in its own
  file certainly bind to it. References inside its own lines are not counted,
  and the count is 0 when an inner binding of the same name could capture them.
- `imports` — `{ from, name, local }` for each relative import or re-export
  whose specifier resolves to a file inside the project. `name` is `*` for a
  namespace import. Package and alias specifiers are not recorded.
- `member_refs` — `local.prop` for each member access through an imported
  binding.

`refs`, `imports` and `member_refs` are the *usage evidence* a tool uses to
tell apart declarations that share a name. They are kept per file, so an
incremental re-index of one file never leaves another file's facts stale.

**Content hash.** Split the file on `\n`, take lines `start..end` inclusive,
join them with `\n`, take the SHA-256 digest, and keep the first 16 lowercase
hex characters. A `\r` stays part of its line. A file hash is the same digest
over the whole file. Any tool can recompute a hash independently, and that is
how a reference is checked against the code it points at.

### `context-manifest.json`
Written alongside every `NEXT_PROMPT.md` and overwritten with it. It records
each item the prompt references:

- `ref`: `path`, or `path#id` for a code unit
- `granularity`: `summary`, `signature`, `unit` or `file`
- `tokens`: the cost at that granularity
- `file_tokens`: the cost of the whole file
- `hash`, plus `start` and `end` for a unit
- `reason`: `always-include`, `chunk` or `task`; when it is `task`, the task's
  text appears in `task`
- `listed`: whether the prompt names the item itself, or only counts it in a
  `+N more`
- `evidence`: when a unit was chosen among several declarations with the same
  name, the proof of use, e.g. `imported by 2 files`

The top level carries `version: 1`, `generated_at`, `active_chunk`,
`prompt_hash` (the content hash of the prompt it describes), and `totals`, the
sums of `tokens` and of `file_tokens`, with each path counted once. JSON with
sorted keys. Every object is strict: an unknown key is a parse failure.

### `DONE_LOG.md`
Append-only archive of chunks that have been completed and advanced past,
written when a chunk is archived. It exists so `SESSION_STATE.md` can be
compacted without losing the record.

### `trim-overrides.json`
Per-file context exclusions chosen by the user (or auto-selected to fit a
budget). An excluded file is left out of `NEXT_PROMPT.md`, including any unit
focused in it, and out of `context-manifest.json`. Cleared on `advance`.

---

## Context layers (summary)

When `ai-index.yaml` exists, each indexed file is assigned an effective layer:

| Layer | Content | When |
|---|---|---|
| 0 | Module summary + symbol names | Default for chunk files |
| 1 | Public signatures | Always-include files; raised by `@ai-layer-default` |
| 2 | Full source | Files referenced by an active task |
| unit | One code unit's source, on a `Focus (read_unit):` line as `path#id:start-end` | Units an active task names by a code-shaped identifier (`parseBody`, `Store.add`), or by any identifier in backticks |

A task that names a unit loads that unit instead of escalating its file to
layer 2. When the name is declared in more than one place, the tool loads
every declaration it can prove is used: one imported elsewhere, or one
referenced in its own file. It loads none it cannot prove. If none can be
proven, or more than three can, it loads nothing, because guessing would point
the session at the wrong code.

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
   refuse to write a prompt that exceeds it, or that exceeds 12,000
   characters, whatever its line count.
4. Parses frontmatter safely (no code execution) and validates required fields.
5. Ignores unknown optional fields and files rather than failing.

Adapters (see [docs/authoring-adapters.md](docs/authoring-adapters.md)) map this
neutral format onto a specific AI tool's native config (e.g. `CLAUDE.md`,
`AGENTS.md`, `.cursorrules`).
