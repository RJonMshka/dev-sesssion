# LLD — first run

**Area:** `RUN` — what a new user gets from `init`, `index` and `import` before
their first session: which files a chunk loads, which notes are imported, and
whether the prompt reflects either.

---

## Problem

Found by running the 2.4.1 build (`87cda6f`) against an exported copy of this
repository on 2026-10-19, with a two-chunk `PLAN.md` whose tasks name real
functions and files. The sequence was the one the README suggests:
`init -y` → `index` → `import --from claude`. Code-unit focus, stale-unit
detection and provenance quoting all behaved correctly once the prompt was
regenerated. Everything around them did not.

**1. `init -y` tags every file in the repository to chunk 1.**
`generateIndex` (`packages/cli/src/commands/generate-index.ts:114-125`) takes
the `--yes` branch and pushes every walked file with
`chunk_tags: [activeChunkId]`. On this repo that is 375 files. The first prompt
read:

```
Budget: ~598210/4000 tokens [OVER]
Load: @CLAUDE.md, @.github/workflows/ci.yml, @.github/workflows/release.yml, @.gitignore, @.gitleaks.toml, @.npmrc, +369 more
```

The plan's tasks named exactly one file (`final-writes.ts`). Chunk 2's tasks
were never consulted, so chunk 2 would start with every file tagged to chunk 1
and nothing tagged to itself. The interactive branch (`:126-195`) asks per
directory instead, up to 30 times, which is HLD feature 3's other half and is
not addressed here.

Plans carry no file list of their own: `PlanChunkSchema`
(`packages/core/src/schemas/plan-chunk.ts:10-27`) holds id, title,
dependencies and tasks, and a chunk's prose is dropped when `PLAN_N.md` is
written. **Task text is the only signal of which files a chunk needs.**

**2. `import --from claude` imports the tool's own text.** `init` writes a
`<!-- dev-sesssion:start -->` … `<!-- dev-sesssion:end -->` block into
`CLAUDE.md` (`upsertSection`, `packages/adapters/src/claude-adapter.ts:89`).
`extractH2Sections` (`packages/core/src/importers/claude-md-notes.ts:43`) does
not know the block exists, so the next `import` turns its `## dev-sesssion`
heading into a note:

```
Quoted from CLAUDE.md § "dev-sesssion": "This project uses [dev-sesssion](https://github.com/RJonMshka/dev-sesssion) to manage AI coding sessions. **Start:** Rea"
```

The tool's own instructions come back to the agent attributed to the
repository. The marker strings themselves have three private copies
(`claude-adapter.ts:32-33`, `opencode-adapter.ts:28-29`,
`packages/cli/src/commands/export.ts:33-34`), which is the shape of bug the
HLD's prompt-generation section exists to prevent.

**3. The prompt does not reflect the index or the import until `update` runs.**
`init` writes `NEXT_PROMPT.md` in `runFinalWrites`
(`packages/cli/src/commands/init.ts:186`) before any ai-index exists, so the
first prompt has no `Focus (read_unit):` line and charges full-file costs.
`runIndex` (`packages/cli/src/commands/index-cmd.ts:106-175`) saves
`ai-index.yaml` and stops; `importFromClaude`
(`packages/cli/src/commands/import.ts:97-149`) saves the notes and stops.
Neither touches the prompt. After all three commands, `NEXT_PROMPT.md` was
still the `init` output above, with no focus and no imported notes. Only after
`update -y` did it read:

```
Budget: ~27662/4000 tokens [OVER]
Focus (read_unit): packages/core/src/calculators/context-budget-calculator.ts#ContextBudgetCalculator.formatSummary:256-286, …
Load full: @packages/cli/src/commands/final-writes.ts
```

The reason only `update`, `advance` and `init` write the prompt is that prompt
assembly is a ~90-line block copied into each of them:
`final-writes.ts:158-248`, `update.ts:162-242`, `advance.ts:193-250`, each
with its own private `buildExcludePatterns` (`final-writes.ts:365`,
`update.ts:465`, `advance.ts:349`). Adding a fourth and fifth copy to `index`
and `import` is the wrong fix. The block is also business logic sitting in
`packages/cli`, which `CLAUDE.md` rules out.

**4. Smaller, same code path.** `final-writes.ts:259` logs
`` `Context budget: ${ContextBudgetCalculator.formatSummary(budget)}` `` and
`formatSummary` already begins with `Context budget:`, so `init` prints
`Context budget: Context budget: ~598210 / 4000 tokens`.

---

## Requirements

### Chunk tagging at init

**REQ-RUN-1** — When `init` runs with `--yes`, the file index generator shall
tag a walked file to a chunk only if an unfinished task in that chunk references
the file. A done task tags nothing, matching the layer resolver, which never
escalates on a done task's account.

**REQ-RUN-2** — The file reference matcher shall treat a task as referencing a
file when the task text contains the file's repository-relative path, or the
file's basename as a whole token. `formatter-utils.ts` in a task references
`packages/core/src/formatters/formatter-utils.ts` and does not reference
`src/utils.ts`.

**REQ-RUN-3** — If a basename named in a task belongs to more than one walked
file, then the file index generator shall tag none of those files on account of
that basename. A path that names one of them still tags it.

**REQ-RUN-4** — When `init` runs with `--yes`, the file index generator shall
omit from `FILE_INDEX.md` every walked file that no task references, except
always-include files.

**REQ-RUN-5** — The layer resolver shall decide whether a task references a file
with the same matcher as the file index generator.

**REQ-RUN-6** — When `init` runs with `--yes`, `init` shall report how many
files were tagged to a chunk and how many were left to the ai-index alone.

### Import

**REQ-RUN-7** — When importing from `CLAUDE.md`, the importer shall not create a
note from any section inside the dev-sesssion managed block.

**REQ-RUN-8** — If `CLAUDE.md` contains a managed-block start marker with no end
marker after it, then the importer shall treat everything from the start marker
to the end of the file as managed.

**REQ-RUN-9** — When importing from `CLAUDE.md`, the importer shall remove any
existing note that an import reading the managed block as ordinary content would
have written and that the current import does not write. That covers both notes
2.4.1 left behind: the one quoting the block's own section, and the one for the
section just before the block, which carried the start marker.

**REQ-RUN-18** — The importer shall not include managed-block markers or
managed-block text in the note for a section that precedes the block.

### Prompt freshness

**REQ-RUN-10** — When `init` writes `NEXT_PROMPT.md`, the prompt shall reflect an
ai-index built earlier in the same run.

**REQ-RUN-11** — If building or saving the ai-index fails during `init`, then
`init` shall warn, write the prompt without an ai-index, and exit 0.

**REQ-RUN-12** — Where `--max-files` is given to `init`, `init` shall apply the
same cap to ai-index extraction.

**REQ-RUN-13** — When `index` writes `ai-index.yaml` and `NEXT_PROMPT.md`
exists, the index command shall regenerate `NEXT_PROMPT.md` and
`context-manifest.json`.

**REQ-RUN-14** — When `import` changes `SESSION_STATE.md` or `FILE_INDEX.md`,
the import command shall regenerate `NEXT_PROMPT.md` and
`context-manifest.json`.

**REQ-RUN-15** — While dry-run is active, neither `index` nor `import` shall
write `NEXT_PROMPT.md` or `context-manifest.json`.

**REQ-RUN-16** — When `.session/` has not changed between two runs, `init`,
`update -y`, `advance`, `index` and `import` shall produce the same
`NEXT_PROMPT.md` for it.

**REQ-RUN-17** — When `init` reports the context budget, it shall print the
`Context budget:` label once.

### Found while implementing

Moving the assembly into one function showed two more places where commands
disagreed about the prompt for the same `.session/`.

**REQ-RUN-19** — `preview` shall show the same prompt that `update -y` writes
for the same `.session/`.

**REQ-RUN-20** — While `trim-overrides.json` excludes a file, the prompt
assembler shall leave that file out of the prompt's load lines, its budget and
its manifest, and add it to the prompt's exclude patterns. `docs/commands.md`
already says exclusions apply to "every subsequent `preview` and context
assembly"; in 2.4.1 only `preview` applied them.

**REQ-RUN-22** — When `trim` changes `trim-overrides.json` and `NEXT_PROMPT.md`
exists, the trim command shall regenerate `NEXT_PROMPT.md` and
`context-manifest.json`. While dry-run is active, it shall write neither.

**REQ-RUN-21** — Where the project name entered while `init` scaffolds a plan
differs from the name detected from `package.json` or the directory, `init`
shall record it as `project_name` in `SESSION_STATE.md`, and every command that
writes the prompt shall use the recorded name.

---

## Design

### File references — new `core/src/calculators/file-reference.ts`

```ts
/** True when `text` names `filepath` by path or by whole-token basename (REQ-RUN-2). */
export function mentionsFile(text: string, filepath: string): boolean;

/**
 * Maps each referenced file to the chunks whose tasks reference it.
 * A basename shared by several files counts for none of them (REQ-RUN-3).
 */
export function referencedFiles(
	chunks: readonly PlanChunk[],
	files: readonly string[],
): Map<string, number[]>;
```

Task text is split into path-shaped tokens — runs of `[A-Za-z0-9_.-/]`, so a
space, backtick, quote, bracket, `:`, `#` or `?` ends one — with trailing dots
dropped, so `final-writes.ts.` at the end of a sentence reads as
`final-writes.ts`. A token names a file when the segments they both have,
counted from the end, all agree. `formatter-utils.ts`,
`formatters/formatter-utils.ts` and `lib/packages/core/…/formatter-utils.ts` all
name `packages/core/src/formatters/formatter-utils.ts`; `utils.ts` names
`src/utils.ts`; `formatter-utils.ts`, `index.ts.map`, `utils.tsx` and
`mysrc/a.ts` name neither `src/utils.ts`, `src/index.ts` nor `src/a.ts`, because
the last segment, or one before it, differs.

`referencedFiles` resolves each token against every walked file with that
basename and keeps the file that agrees on the most segments; a tie names none
of them. So `index.ts` with forty `index.ts` files names nothing, and
`src/a/index.ts` still names its one (REQ-RUN-3). Uniqueness is judged against
the repository and not the chunk. This follows
the HLD's "wrong is worse than absent": a plan that says `index.ts` in a repo
with forty of them tags nothing rather than forty files.

`LayerResolver`'s private `taskReferencesFile`
(`layer-resolver.ts:111`) is deleted and its call site at `:142` uses
`mentionsFile` (REQ-RUN-5). That makes escalation stricter in one way: a task
naming `formatter-utils.ts` stops also escalating every `utils.ts` in the
chunk, which today's substring test does. The uniqueness rule
does not apply there, since escalation only ever considers the chunk's own
files.

### Tagging — `generate-index.ts`

The `--yes` branch builds entries from `referencedFiles(chunks, walked)`, one
entry per referenced file with every chunk that references it, plus
always-include. Unreferenced files get no entry (REQ-RUN-4). No schema change:
`chunk_tags` still has `.min(1)` (`file-index-entry.ts:16`), and that is the
reason unreferenced files are omitted rather than written untagged.

Nothing is lost by omitting them. The ai-index is built from its own walk
(below), so every file stays reachable through `read_file_layer`,
`query_index`, `read_unit` and unit focus, and `index add` still tags a file by
hand. What changes is that `FILE_INDEX.md` stops claiming the agent should load
375 files.

The interactive branch is unchanged.

### Managed block — new `core/src/importers/managed-block.ts`

```ts
export const MANAGED_BLOCK_START = "<!-- dev-sesssion:start -->";
export const MANAGED_BLOCK_END = "<!-- dev-sesssion:end -->";

/** Splits markdown into the user's content and the managed block's content (REQ-RUN-8). */
export function splitManagedBlock(content: string): { user: string; managed: string };
```

The Claude adapter, the opencode adapter and `export.ts` import the two
constants instead of declaring their own. The Cursor and Windsurf adapters use
`# dev-sesssion:start` in `.cursorrules` and `.windsurfrules`, which no
importer reads, and are left alone.

`ClaudeMdNotes.build` and `.merge` extract sections from `user` only (REQ-RUN-7,
-18). `merge` additionally builds the notes the whole, unsplit file would have
produced, and treats any of them the current import does not produce as stale,
the same way it already treats pre-quotation notes (REQ-PROV-11). That removes
both notes 2.4.1 users already have (REQ-RUN-9):

```
Quoted from CLAUDE.md § "Conventions": "Use tabs. <!-- dev-sesssion:start -->"
Quoted from CLAUDE.md § "dev-sesssion": "This project uses [dev-sesssion](…) to manage AI coding sessions. **Start:** Rea"
```

### Prompt assembly — new `core/src/managers/prompt-assembler.ts`

The three copied blocks become one core function:

```ts
export interface AssembleInput {
	readonly state: SessionState;
	readonly chunk: PlanChunk;
	readonly allChunks: readonly PlanChunk[];
	readonly entries: readonly FileIndexEntry[];
	readonly index: AiIndex | null;
	readonly formatter: BootstrapFormatter;
	readonly projectName: string;
	readonly transformState?: (state: SessionState) => SessionState;
}

export interface AssembledPrompt {
	readonly prompt: string;
	readonly manifest: ContextManifestData;
	readonly budget: ContextBudget;
	readonly chunkFiles: readonly FileIndexEntry[];        // for update/advance's context log
	readonly alwaysIncludeFiles: readonly FileIndexEntry[];
}

export const PromptAssembler = {
	assemble(input: AssembleInput): AssembledPrompt;
	excludePatterns(activeChunk: number, allChunks: readonly PlanChunk[]): string[];
};
```

`core` cannot import `adapters`, so the CLI resolves the adapter and passes in
its `formatter` and bound `transformState`. Everything from `LayerResolver.plan`
to `ContextManifest.build` moves into `assemble`.

In the CLI, one new `commands/regenerate-prompt.ts` loads what `assemble`
needs, resolves the adapter, runs the secret scan, and then either calls
`NextPromptWriter.write` + `ContextManifest.write` or logs dry-run. `update` and
`advance` pass the in-memory state they have just changed; `index` and `import`
let it load from disk. `assemble` is pure — it takes no `sessionDir` and writes
nothing. The project name is the state's `project_name` when set, otherwise
the name from `package.json` (or the directory name), for every command
(REQ-RUN-21). The secret scan blocks under `--strict`
for `update`, `index` and `import`, as `update`'s did; `init` and `advance` warn,
as before. With every command going through the same path,
REQ-RUN-16 holds by construction, and the test checks it.

`NextPromptWriter.write` remains the only way a prompt is persisted, so the
validate-before-write rule from `CLAUDE.md` is unchanged.

**Trim exclusions (REQ-RUN-20).** `AssembleInput` gains
`excluded?: readonly string[]`, the paths from `trim-overrides.json`.
`assemble` drops them from the chunk's files before `LayerResolver.plan`, so the
load lines, budget and manifest all lose them together, and appends them to
`excludePatterns`. Always-include files are not filtered, because `trim` only
offers chunk files. `regeneratePrompt` loads the overrides when the caller does
not pass them; `advance` clears them before it regenerates, so the new chunk
starts with none. `trim`, `index` and `import` share one
`refreshExistingPrompt` in `regenerate-prompt.ts`, which regenerates only when
`NEXT_PROMPT.md` exists (REQ-RUN-13, -14, -22).

**Preview (REQ-RUN-19).** `preview` gets its prompt from `assemble` with the same
inputs `regeneratePrompt` loads, through a shared `loadAssembleInput` in
`regenerate-prompt.ts`, so the two cannot disagree. `AssembledPrompt` gains
`plan: ContextPlan` so `preview` can show each file's resolved layer without
running the resolver a second time. The breakdown table and JSON keep their own
token counts, which charge the raw `SESSION_STATE.md` and `PLAN_n.md` files
rather than the budget's estimate. That is what they measured before, and they
describe the files, not the prompt. Before this, `preview` built the
prompt without `maxPromptLines`, so a project with a lowered cap previewed a
prompt the writer would have rejected.

**Project name (REQ-RUN-21).** `SessionStateSchema` gains an optional
`project_name` (1–214 characters, the npm name limit, no line breaks), and
`PROTOCOL.md` gains the matching row in the same commit. `runFinalWrites` sets it
only when the name it was given differs from `detectProjectName(cwd)`, so a
`-y` run, or an interactive run that accepts the default, writes the same
`SESSION_STATE.md` as before, and a later rename in `package.json` is still
picked up. The serializer omits the field when it is absent, as it does for a
default `max_prompt_lines`. With the name in state, `init` no longer needs the
`projectName` override on `regeneratePrompt`, and it is removed.

### Init order — `init.ts`

Phase 4 (FILE_INDEX) → **new phase 4b: build the ai-index** → phase 5 (final
writes). Phase 4b calls a new core helper shared with `runIndex`:

```ts
// core/src/annotation/ai-index-builder.ts
AiIndexBuilder.fromDirectory(root: ValidatedPath, opts?: { maxFiles?: number }): Promise<AiIndex>;
```

`runIndex` uses the same helper, so `init` and `index` cannot drift. An
exception from phase 4b, including `WriteGuard` refusing the save under
`--strict`, is caught, logged as a warning, and phase 5 runs with `index: null`
(REQ-RUN-11). On this repo the extraction took ~1s.

### Expected first prompt

The same plan, after this change, from `init -y` alone:

| | 2.4.1 | After |
|---|---|---|
| Files tagged to chunk 1 | 375 | 1 (`final-writes.ts`) + always-include |
| `Focus (read_unit):` in first prompt | no | yes, 5 units |
| Imported `dev-sesssion` note | yes | no |
| Commands needed before the prompt is right | `init`, `index`, `import`, `update` | `init`, `import` |

---

## Test plan

Unit tests run against real temp dirs. Every CLI-level test is an execa
subprocess against the built CLI and asserts on the files that run produced,
never on hand-written prompt lines.

| Req | Level | Test |
|---|---|---|
| RUN-2 | unit | `file-reference.test.ts`: path, basename, backticked, sentence-final `.`; `utils.ts` vs `formatter-utils.ts`; `index.ts.map` |
| RUN-3 | unit | `referencedFiles` with two `index.ts` and a task saying `index.ts` → none; saying `src/a/index.ts` → that one |
| RUN-5 | unit | `layer-resolver.test.ts`: a task naming `formatter-utils.ts` escalates it and not `src/utils.ts` |
| RUN-1, -4 | e2e | `init -y` on a fixture whose `PLAN.md` names two files in chunk 1 and one in chunk 2; `FILE_INDEX.md` lists exactly those plus always-include, under the right chunks |
| RUN-6 | e2e | same run; stripped stdout states the tagged and left-out counts |
| RUN-7 | e2e | `init -y --adapter claude` then `import --from claude` on the same fixture; no note quotes `dev-sesssion`. The block comes from the real adapter, not a fixture string |
| RUN-8 | unit | `splitManagedBlock` with a start marker and no end |
| RUN-9 | unit | `merge` given both notes 2.4.1 wrote for `tests/fixtures/first-run/CLAUDE.md` (captured from a real 2.4.1 run) removes them and keeps a hand-written note |
| RUN-18 | unit | `build` on the captured file: the note before the block contains no marker |
| RUN-10 | e2e | `init -y` on a TS fixture whose task names a function; `NEXT_PROMPT.md` has a `Focus (read_unit):` line resolving to that function |
| RUN-11 | e2e | `init -y --strict` on a project whose doc comment holds an AWS-shaped key: `WriteGuard` refuses `ai-index.yaml`; init exits 0 with a warning, no `ai-index.yaml`, and a prompt without Focus. Extraction itself cannot be made to fail from outside (it skips unparseable files, `auto-extractor.ts:114`, and an unreadable directory fails the earlier file-index walk instead), so the save is the failure that exists |
| RUN-12 | e2e | `init -y --max-files 5`; `ai-index.yaml` has ≤ 5 files |
| RUN-13 | e2e | `init -y`, add a function, name it in a task, `index`; prompt now focuses it |
| RUN-14 | e2e | `init -y`, add a `## Setup` section to `CLAUDE.md`, `import --from claude`; prompt contains its quoted note |
| RUN-15 | e2e | `--dry-run index` and `--dry-run import`; `NEXT_PROMPT.md` and manifest bytes unchanged |
| RUN-16 | e2e | `init -y`, then `index`, `import`, `update -y` in turn; prompt bytes identical after each |
| RUN-17 | e2e | `init -y` stdout contains `Context budget:` exactly once |
| RUN-19 | e2e | `init -y`, then `preview --format json`; `prompt_text` equals `NEXT_PROMPT.md` byte for byte |
| RUN-20 | unit | `prompt-assembler.test.ts`: with a chunk file excluded, the prompt does not load it, the manifest omits it, the budget is lower and `excludePatterns` lists it |
| RUN-20, -22 | e2e | `init -y`, then `trim --budget 1 --yes`; `NEXT_PROMPT.md` loads none of the excluded files, `update -y` keeps them out, and `preview` still matches the file |
| RUN-22 | e2e | `--dry-run trim --budget 1 --yes`; `NEXT_PROMPT.md` and manifest bytes unchanged |
| RUN-21 | unit | `session-state-manager.test.ts`: `project_name` round-trips, is omitted when absent, and a line break fails the schema |
| RUN-21 | integration | `init-integration.test.ts`: scaffold with a typed name; `SESSION_STATE.md` records it, the prompt shows it, and an `update` afterwards keeps it. Accepting the default records nothing |

The existing prompt tests for `update` and `advance` must pass unchanged
against `PromptAssembler`. That is the regression check that the move did not
change output.

`pnpm eval` and `pnpm eval:units` must stay green. `eval:units` runs
`init` → `index` on real targets (`evals/units.ts:341`), so chunk sizes and
budget numbers will move; if a baseline is checked, it is re-baselined in the
same PR with the reason in the commit body.

---

## Out of scope

Seen in the same run and deliberately left for later:

- **Interactive tagging** still asks up to 30 times. REQ-RUN-1..4 change `--yes`
  only.
- **Tagging on touch.** HLD feature 3 defers tagging to when a file is touched;
  `update` records `last_worked_files` but does not tag them. Not done here.
- **Imported notes are cut at 120 characters**, mid-token
  (`claude-md-notes.ts:18`), and the prompt shows at most two notes
  (`DEFAULT_MAX_NOTES`). Most of `CLAUDE.md` never reaches the agent this way.
- **A quoted note whose `CLAUDE.md` section later changes** is kept alongside the
  new one; `merge` only recognises exact matches.
- **`lint-context`** reported 1,483 errors and 12,539 warnings on this repo,
  mostly test files and one-line "duplicate blocks".
- **The tool's own edits count as the user's.** `init` changes `.gitignore` and
  `CLAUDE.md`; they show up as `Last touched:` and trigger
  `UNBACKED_WORKED_FILE` in `verify`.
- **`verify` raises `DONE_WITHOUT_EVIDENCE`** for a task the plan already marked
  done.
- **`index` warns about "Layer 0 token cost"** for a total that is all Layer 1.
- **`Context files (379 files)`** counts focused units as files.
