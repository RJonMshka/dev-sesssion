# LLD — files a chunk will create

**Area:** `NEW` — paths the plan names that are not on disk yet, and the
existing files the agent needs beside them.

---

## Problem

Found on DevNexus (2026-10-21), phase 8, "Polish & Integration". Its Key Files:

```
apps/shell/src/components/{NotificationToast,CommandPalette,Breadcrumbs}.tsx
apps/shell/src/hooks/usePreload.ts
apps/shell/src/routing/transitions.ts
e2e/golden-path.spec.ts
e2e/visual-regression.spec.ts
.github/workflows/bundle-budget.yml
```

None exists. `PLAN_8.md` records all eight in `files` (REQ-IDX-12), but tagging
matches walked files only (REQ-IDX-17), so the prompt says nothing about them:

```
Plan: @.session/PLAN_8.md
Summaries (read_file_layer for detail): @CLAUDE.md·L1
```

The agent is pointed at nothing but `CLAUDE.md`. What it needs to write
`routing/transitions.ts` is what already sits in `routing/` —
`MFEOutlet.tsx` and `mfe-registry.ts`, the code the new file plugs into and the
conventions it should follow. The tool has both facts: the plan's path, and
the ai-index's summary of every file beside it.

Absence is not always "to create". DevNexus's phases 2–7 name 6–8 files each
that do not exist because the code moved on from the plan (renamed, merged).
The tool cannot tell the two apart, so the prompt must report what it knows —
the plan names this path, and it is not on disk — rather than claim the file is
to be created.

---

## Requirements

**REQ-NEW-1** — When the active chunk's `files` names a path with a directory
that is neither on disk nor the tail of a file the index knows, the prompt
shall state that path on a `Not on disk yet:` line, as plain text rather than
in the formatter's file-reference syntax.

`files` comes from the plan's prose as well as its Key Files block, so it holds
bare names and expressions (`node.props`, `root.unmount`) and partial paths
(`src/lifecycle.ts`). The tagging matcher reads a partial path by its tail
(REQ-RUN-2); this requirement reads it the same way, so a path that tags a file
is never also reported missing.

A reference such as Claude Code's `@path` to a missing file is an error in the
tool that reads it, and the line reports the plan, not a file to open.

**REQ-NEW-2** — If a path the plan names contains a character outside
`A–Z a–z 0–9 . _ - + @ /`, then the prompt shall not state it.

Plan text is repository content (CLAUDE.md, trust boundary). `extractFileRefs`
constrains only the last segment's shape; this line renders paths outside any
quotation, so they must be path-shaped by construction, as unit ids are
(LLD-context-provenance.md).

**REQ-NEW-3** — If every task in the active chunk is done, then the prompt shall
not state its absent paths nor load their neighbours. This mirrors REQ-IDX-18.

**REQ-NEW-4** — Where an ai-index exists, for each path of REQ-NEW-1 the prompt
assembler shall load as chunk files the indexed files directly inside that
path's nearest ancestor directory that holds any, other than the project root —
same extension first, then path order, at most 3 per path and 8 per chunk —
leaving out files already loaded and files `trim` excluded. A directory whose
files are all loaded already contributes none; the search does not climb past
it.

The project root is excluded because its files neighbour everything: on
DevNexus, `e2e/golden-path.spec.ts` would otherwise load the root's configs. A
path whose only indexed ancestor is the root loads nothing for it — absent, not
wrong.

**REQ-NEW-5** — The prompt assembler shall charge the neighbours of REQ-NEW-4 to
the budget, and `status`, `preview` and `health` shall report that same budget
(REQ-BUD-2, 3, 5).

**REQ-NEW-6** — The file index generator shall not write the neighbours of
REQ-NEW-4 to `FILE_INDEX.md`.

A neighbour is a placement guess, recomputed on every regeneration; once the new
file exists and a session touches it, `update` tags the real one
(LLD-tagging.md, REQ-IDX-33). `index` does not. Persisting the guess would
outlive it.

---

## Design

### `NewFiles` — `core/src/calculators/new-files.ts` (new)

```ts
/** Plan-named paths of the active chunk that are not on disk (REQ-NEW-1..3). */
absent(chunk: PlanChunk, projectRoot: string): string[];

/** Indexed files beside each absent path (REQ-NEW-4). */
neighbours(input: {
  absent: readonly string[];
  index: AiIndex | null;
  taken: ReadonlySet<string>;     // chunk + always-include + excluded paths
  activeChunk: number;
}): FileIndexEntry[];
```

`absent(chunk, projectRoot, entries, index)` filters `chunk.files` by
REQ-NEW-2's charset, returns `[]` when every task is done (REQ-NEW-3), drops
paths without a `/` and paths that equal or tail an ai-index key or
`FILE_INDEX.md` entry, and keeps each remaining path that
`PathValidator.safeResolvePath` resolves inside the root and `fs.existsSync`
does not find. A path that fails validation is dropped, not reported.

`neighbours` walks each absent path's ancestors, nearest first, stopping before
the root; the first directory with any `index.files` key directly inside it
supplies up to 3 of them not in `taken` — possibly none, without climbing on. Results are deduped and capped at 8.
Each becomes a `FileIndexEntry` tagged to the active chunk with purpose
`Beside <absent path>`, so the layer resolver gives it the chunk role (layer 0,
the module summary) and the budget, manifest and load lines treat it like any
chunk file. Pure.

### Assembly

`ChargeInput` gains optional `absent?: readonly string[]`. `charge` computes
neighbours from it and appends them to `chunkFiles` before
`LayerResolver.plan`, so REQ-NEW-5 holds by construction for every caller that
passes `absent`. `BootstrapContext` gains optional `newFiles`.

Callers that pass it: `loadAssembleInput` (`regenerate-prompt.ts`, used by
`init`, `update`, `advance`, `index`, `status`, `preview`) and `health`'s
`checkBudget`. `FILE_INDEX.md` is written by `generate-index`, which never sees
neighbours (REQ-NEW-6).

### Rendering

`formatter-utils.ts` gains `NEW_FILES_PREFIX = "Not on disk yet:"` and
`formatNewFilesLine(paths)`: `undefined` for none, otherwise the prefix and
`formatRefList(paths)`. Each of the five shipped formatters pushes it after
the `Plan:` line — one call each, as with `formatPlanLine`.

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-NEW-1 | unit | `absent` on a temp dir: a named missing path returned, a named existing one not; `node.props`, a bare `x.ts` and a path tailing an indexed file not; a tagged entry counts as existing |
| REQ-NEW-2 | unit | `` a`b.ts ``, `a b.ts`, `"x".ts` and `../out.ts` not returned |
| REQ-NEW-3 | unit | All tasks done → `[]` |
| REQ-NEW-4 | unit | Over an ai-index built by `AiIndexBuilder` from a temp project: sibling directory chosen; missing directory falls back to the parent; root never used; same extension first; 3/8 caps; `taken` paths skipped; no climb past a fully taken directory |
| REQ-NEW-1 | unit | Each registered formatter renders `Not on disk yet:` with plain paths, and no line when there are none |
| REQ-NEW-1,4,5,6 | e2e | Plan naming `src/routing/transitions.ts` beside existing `src/routing/*.ts`: after `init -y` the prompt states the path and loads a sibling; `status --json` capped tokens equal the `Budget:` line; `FILE_INDEX.md` lacks the sibling |
| all | eval | DevNexus chunk 8: the prompt names the 8 paths and loads `routing/` siblings; recall unchanged |

### What actually happened

Every test **failed first**: the unit tests on the missing module, the five
formatter tests on a missing prefix, the e2e on a prompt with no
`Not on disk yet:` line.

The first DevNexus run then found two faults no test had covered:

- **Prose fragments stated as missing.** Phase 3 reported `node.props`,
  `mfe-registry.ts` and `src/lifecycle.ts`, all from `files`, which REQ-IDX-12
  fills from prose too. Two name existing files by their tail. REQ-NEW-1 now
  requires a directory and applies the tagging matcher's tail rule; the unit
  tests gained those three tokens and **failed first**.
- **Neighbours climbed past taken files.** Phase 8's three new components
  share `apps/shell/src`; the second and third found its files taken, climbed
  to `apps/shell` and loaded build output (`vite.config.d.ts`, `.js`) until the
  cap of 8 left no room for `routing/MFEOutlet.tsx`. The unit fixture had no
  file in the parent directory, so the new test passed vacuously until one was
  added; it then **failed first**.

DevNexus phase 8 after both fixes:

```
Budget: ~1085/4000 tokens [OK] + ~1960 always loaded
Not on disk yet: apps/shell/src/components/NotificationToast.tsx, … (all 8)
Summaries (read_file_layer for detail): @CLAUDE.md·L1, @apps/shell/src/App.tsx·L1,
  @apps/shell/src/main.tsx·L1, @apps/shell/src/routing/mfe-registry.ts·L1,
  @apps/shell/src/routing/MFEOutlet.tsx·L1
```

`status` reports the same 1,085; `health` is clean; `FILE_INDEX.md` gained
nothing. Prompt recall 11/11 and tag recall 100% on every chunk, unchanged.

---

## Out of scope

- **Telling "to create" from "renamed".** Needs history or similarity matching;
  the line reports what is known instead.
- **Neighbours without an ai-index.** `init` builds one; a session without it
  gets the line alone.
- **Escalating a neighbour** because a task names the new file. Tasks escalate
  files they name; a neighbour is named by nobody.
