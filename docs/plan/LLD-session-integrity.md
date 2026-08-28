# LLD — session integrity

Areas: `IDX`, `CHK`, `DRY`

> **Written after the fact.** This work shipped in `fc38979`, before the method
> in [../METHOD.md](../METHOD.md) was adopted. It is recorded here because its
> requirement ids are cited by 22 tests and would otherwise be dangling
> references. Everything below is retrospective, not a plan.

---

## Problem

Three defects that silently destroyed data, all found by running the tool
against this repository's own `.session/` rather than by any test.

**1. Section mis-attribution.** `file-index-manager.ts:198` tracked
`currentChunkTag` while walking `FILE_INDEX.md`, but only ever *set* it — on a
heading it could not map, the previous value survived. Every row under an
unrecognized heading was therefore attributed to the preceding chunk.
`CHUNK_HEADING_PATTERN` at `:28` matched `^##\s+Chunk\s+(\d+)` only, so
`## Chunk 3.5` and `## Chunk 13A` were both unmappable.

Measured against the real index: 25 files under `## Chunk 13A`/`13B` were tagged
chunk 12, and the 3 files under `## Chunk 3.5` were tagged chunk 3.

This is worse than dropping the rows. The prompt's load list is capped at 6
entries, so a mis-tagged file evicts a correct one.

**2. Lossy round-trip.** `serializeEntries` at `:359` emitted `| path | purpose |`
rows grouped by tag in ascending order. It discarded heading text, section order,
`###` sub-sections, prose between tables, computed `token_cost`, and any section
it could not map. The real index carries ~35KB of hand-written design notes and
deliberately non-numeric section order; a single `dev-sesssion update` would have
deleted all of it.

**3. `--dry-run` ignored.** `update.ts` and `advance.ts` contained no reference
to `dryRun`. The global flag was accepted, documented in `docs/GUIDE.md`
("dry-run everything before committing"), and silently discarded — so both
commands performed every write, including archiving to `DONE_LOG.md` and moving
`active_chunk` forward. Only `init` honoured it.

This one caused real loss during development: a verification run of
`update --dry-run` overwrote a hand-written `NEXT_PROMPT.md` which, being
gitignored, was unrecoverable from git.

---

## Requirements

### Section attribution (`IDX`)

- **REQ-IDX-1** — When a section heading names no chunk the index can represent,
  the file index parser shall end the current section.
- **REQ-IDX-2** — The file index parser shall tag rows under a fractional
  heading to that fractional chunk.
- **REQ-IDX-3** — If a row falls under no mappable section, then the parser
  shall drop it rather than attribute it to the preceding chunk.

### Layout preservation (`IDX`)

- **REQ-IDX-4** — Where a `FILE_INDEX.md` exists, save shall preserve each
  section's heading text.
- **REQ-IDX-5** — Where a `FILE_INDEX.md` exists, save shall preserve the
  existing section order.
- **REQ-IDX-6** — Where a `FILE_INDEX.md` exists, save shall preserve non-table
  prose.
- **REQ-IDX-7** — Where a section's chunk id maps to no tag, save shall emit
  that section verbatim.
- **REQ-IDX-8** — If an entry carries a tag with no existing section, save shall
  append a new section.
- **REQ-IDX-9** — Where no `FILE_INDEX.md` exists, save shall emit the canonical
  ascending format.
- **REQ-IDX-10** — Where an entry's purpose is unchanged, save shall keep each
  section's own purpose.
- **REQ-IDX-11** — If a caller changes an entry's purpose, then save shall write
  the new purpose to every section.

### Chunk ids (`CHK`)

- **REQ-CHK-1** — The plan chunk manager shall discover plan files whose id is
  fractional.
- **REQ-CHK-2** — The plan chunk manager shall order fractional chunks
  numerically, not lexically.

### Dry run (`DRY`)

- **REQ-DRY-1** — While dry-run is active, `update` shall not modify
  `SESSION_STATE.md`.
- **REQ-DRY-2** — While dry-run is active, `update` shall not modify
  `NEXT_PROMPT.md`.
- **REQ-DRY-3** — While dry-run is active, `update` shall not append to
  `CONTEXT_LOG.md`.
- **REQ-DRY-4** — While dry-run is active, `advance` shall not modify
  `SESSION_STATE.md`.
- **REQ-DRY-5** — While dry-run is active, `advance` shall not append to
  `DONE_LOG.md`.
- **REQ-DRY-6** — While dry-run is active, `advance` shall not modify
  `NEXT_PROMPT.md`.

---

## Design

### Parsing

`SECTION_HEADING_PATTERN` (`/^##\s+\S/`) is separate from
`CHUNK_HEADING_PATTERN` (`/^##\s+Chunk\s+(\d+(?:\.\d+)?)(\s|$)/`). Any h2 closes
the section; only a mappable one opens a tagged section. The split is the fix —
`parseSectionHeading` returning `undefined` now means *section closed*, not *not
a heading*.

Ids with a non-numeric suffix (`13A`) deliberately do not match. `chunk_tags` is
numeric, so there is no tag to map them to; they close the section and their rows
are preserved by the serializer instead (REQ-IDX-7).

### Serialization

`save()` reads the existing document and recovers an `IndexLayout` — a preamble
plus an ordered list of `IndexBlock`s, each either a `chunk` (tag known) or
`opaque` (verbatim).

The decision that matters: chunk sections are **patched, not regenerated**.
`patchSection` walks the original lines, rewrites each row whose file is still
indexed, drops rows whose file is gone, and appends new rows after the last
existing row. Regenerating the table — the first approach tried — preserved
content but reordered it, because a section with `table / ### sub / table` came
back as `table+table / ### sub`. Patching preserves position by construction.

`resolvePurpose` handles the per-section purpose problem. `FileIndexEntry` holds
one `purpose`, but the format allows a different one per section, so `load()`
collapses to first-seen. Writing that value everywhere destroyed 64 hand-written
purposes. A row therefore keeps its own purpose when the entry's purpose still
equals the collapsed value (the caller changed nothing), and takes the new value
otherwise (the caller meant it).

### Dry run

`dryRunSkipWrite` joins `dryRunWrite` in `utils/dry-run.ts`, for callers that
never materialize content — a manager that serializes internally, or an
append-only log. Both share a `DRY_RUN_PREFIX` constant.

`UpdateOptions` and `AdvanceOptions` gain an optional `dryRun`, threaded from
`program.opts()` in each command's registration, and guard all seven write sites
(three in `update`, four in `advance`, counting `TrimOverridesManager.clear`).

---

## Test plan

| Requirement | Test | Level |
|---|---|---|
| REQ-IDX-1,2,3 | `file-index-manager.test.ts` → "load — section attribution" | unit |
| REQ-IDX-4…11 | `file-index-manager.test.ts` → "save — layout preservation" | unit |
| REQ-CHK-1,2 | `plan-chunk-manager.test.ts` → "loadAll" | unit |
| REQ-DRY-1,2,3 | `update.test.ts` → "dry-run" | unit |
| REQ-DRY-4,5,6 | `advance.test.ts` → "dry-run" | unit |
| all IDX | `tests/file-index-roundtrip.integration.test.ts` | integration |

The integration test is the one that matters. It round-trips
`tests/fixtures/messy-file-index/FILE_INDEX.md` — a verbatim capture of an index
maintained by hand over eighteen chunks — and asserts byte-for-byte equality
apart from `last_updated`. Every synthetic fixture in the unit suite passed
against the broken serializer; only the real document exposed it.

---

## Out of scope

- **A `ChunkId` value type.** Alphanumeric ids (`13a`) remain unrepresentable.
  Decimals give interleaving, which is the only thing suffixes were used for,
  and `active_chunk` reaches 21 files — the migration was not worth it for a
  capability decimals already provide.
- **`advance()` stepping onto fractional chunks.** Still `active_chunk + 1`.
- **`token_cost` round-tripping.** Still computed at generation and discarded on
  serialize; the format has no column for it.
- **Paginated indexes.** `savePaginatedIndex` (>500 entries) still emits
  canonical output. Those files are generated, not hand-maintained.
