# LLD — workflow-shaped prompt

**Area:** `WF` — where the session stands in its chunk, when the chunk is done,
the steps the owner works each task by, and which notes the prompt carries.

Feature 4 of [HLD.md](./HLD.md). Method: [../METHOD.md](../METHOD.md).

The LLD is in three parts, built in this order:

| Part | Ids | What it does |
|---|---|---|
| A — Notes decay | REQ-WF-1..6 | The prerequisite the HLD names. Without it, stale notes take every note slot |
| B — One task status | REQ-WF-7..11 | A second prerequisite, found while writing this LLD. Without it, a position line would be wrong |
| C — The workflow-shaped prompt | REQ-WF-12..22 | The feature itself: position, exit condition, user-defined steps |

---

## Problem

Every run quoted below used the local build (`packages/cli/dist/index.cjs`,
2026-10-24) in a scratch project outside this repo. The project had a
three-chunk plan and a two-section `CLAUDE.md`.

### C. `Next:` has no position and no exit condition

All five formatters render the tail of the prompt with the same 22 lines,
byte for byte: `claude-bootstrap-formatter.ts:138-159`,
`plain-text-formatter.ts:134-155`, `cursor-bootstrap-formatter.ts:139-160`,
`windsurf-bootstrap-formatter.ts:139-160` and
`opencode-bootstrap-formatter.ts:142-163`. The HLD's prompt-generation rule
forbids this kind of duplication. The block prints `Next:`, at most four pending
tasks (`DEFAULT_MAX_NEXT_TASKS`, `formatter-utils.ts:17`), a `(+N more tasks)`
line, and then notes:

```
Resume: 0/2 tasks done
Next:
  [ ] Add `src/a.ts` export
  [ ] Write tests for a
Note: Session initialized on 2026-10-24
```

The prompt never says which of these tasks is the current one, where it falls
in the chunk, or when the session is finished. What "finished" means already
exists in code: `PlanChunkManager.isComplete` (`plan-chunk-manager.ts:236`)
returns true when every task is `done`, and `advance` asks for confirmation
until it does (`advance.ts:98-125`). The agent is never told that condition.
When every task is done, `getPendingTasks` returns nothing and the prompt has
no `Next` section at all, so it carries no instruction.

### A. Notes decay — the prerequisite, and what it turned out to mean

The HLD says "4 depends on notes decay landing first" (`HLD.md:87`). The phrase
appears nowhere else in the tree, and no commit defines it. It came in with the
HLD itself (`481706d`, 2026-08-27). At that point this repo still planned itself
in `.session/`, and its `SESSION_STATE.md` notes block had grown to ~14 KB
(`eca8031`). `evals/RIGOUR.md:148-152` quotes those archived notes: the block
reached "~20KB" and "the lean-context system leaks context by construction".
So **notes decay** means old notes stop occupying the prompt and the state
file. It was never designed. Nothing that has shipped since makes it obsolete:

- PROV and RUN-23..26 changed how imported notes are *worded* (quoted, cut at
  a word, at most 240 characters). They did not change *which* notes appear.
- `addNote` appends (`session-state-manager.ts:113-118`). `import` appends
  (`claude-md-notes.ts:199`), and so does the Claude adapter's `[memory]`
  transform (`claude-adapter.ts:193-202`). Every formatter then shows
  `state.notes.slice(0, DEFAULT_MAX_NOTES)`, which is the **two oldest**
  (`claude-bootstrap-formatter.ts:155` and the four copies of it).
  `PROTOCOL.md:70` says the opposite: "rolling notes, newest-relevant first".
  The spec and the implementation drifted.
- `init` seeds the first slot with `Session initialized on <date>`
  (`final-writes.ts:256`). `compact` puts `Completed: Chunks …` in front of it
  (`:177`), but only if no `Completed:` note exists yet (`:157`), so that note
  freezes at the first advance that writes it.
- No code removes a note. `SESSION_STATE.md` is charged to the budget in full
  (`context-budget-calculator.ts:42-44`, REQ-BUD-1), so every note ever added
  stays on the `Budget:` line for good.

Reproduced: `init`, then a hand-written blocker note (the line `update` would
append), then `import --from claude`, then `advance -y` twice:

```yaml
notes:
  - "Completed: Chunks 1. See DONE_LOG.md for details."
  - "Session initialized on 2026-10-24"
  - "Blocker: b.ts must not import a.ts (cycle)"
  - "Quoted from CLAUDE.md § \"Conventions\": \"Use tabs. Prefer named exports.\""
  - "Quoted from CLAUDE.md § \"Testing\": \"Run vitest before committing.\""
```

```
Active chunk: 3 — Polish
Resume: 0/1 tasks done Chunks 1-2 done.
Note: Completed: Chunks 1. See DONE_LOG.md for details.
Note: Session initialized on 2026-10-24
```

Both note slots hold bookkeeping the tool wrote itself, and one of them is
wrong: the `Resume:` line two lines above says chunks 1–2. The owner's note and
both conventions are not shown, and they will not be shown again, whatever is
added later. `GUIDE.md:437` promises that a note added through `update` "will
be … included in the next `NEXT_PROMPT.md`". That holds only while the session
has fewer than two notes.

This is why the feature depends on it. The workflow prompt tells the agent
where it is *now*. Its two note slots are the one part of the prompt that
carries old text forward and sorts the oldest first. A position line beside a
frozen note from a past chunk contradicts itself. The two parts also compete for
the 20-line cap (§C, line budget).

### B. The tool's own way of marking a task done does not move the prompt

Found while checking where a position would come from. The prompt, `status`
and `advance` read task status from `PLAN_N.md` (`chunk.tasks`).
`loadActive` returns that file unchanged (`plan-chunk-manager.ts:157-169`).
`update` (`update.ts:100`) and the MCP tool `mark_task_done`
(`session-manager.ts:267-279`) write status only to `SESSION_STATE.md`
(`state.tasks`). After `split-plan` and `scaffold-plan`, nothing writes
`PLAN_N.md` again (`toMarkdown` has no other caller).

Reproduced on a fresh `init`. Mark the first task done in `SESSION_STATE.md`
exactly as `markTaskDone` writes it, then regenerate (`index`):

```
Resume: 0/2 tasks done
  [ ] Add `src/a.ts` export
●  Tasks: [                    ] 0% (0/2 done)        ← `status`
```

`advance` also never resets `state.tasks` (`plan-chunk-manager.ts:212-223`
changes only `active_chunk` and `completed_chunks`). On chunk 3 of the run
above, `SESSION_STATE.md` still listed chunk 1's tasks. So `mark_task_done
"Polish"` finds no match, and the MCP tool `get_active_chunk`
(`session-manager.ts:129`) returns chunk 1's tasks for chunk 3. The documented
loop, "run `update` to mark tasks done and regenerate the prompt"
(`getting-started.md:88`, `GUIDE.md:148`), does not change the prompt.

A line reading `task k of n` built on this would be wrong after the first task
the agent recorded.

---

## Requirements

### Part A — Notes decay

*Built 2026-10-26 on `feat/workflow-prompt`. `selectNotes`, `isProgressNote`
and `isDerivedNote` in `formatter-utils.ts`; `compact` now only drops
progress notes; `takeChunkNotes` splits them at `advance`. Three departures
from the test plan: REQ-WF-6 is tested at e2e (captured 2.4.x notes saved
with core's writer, then the real `advance`) rather than integration; the
REQ-WF-1..3 replay adds its owner note on chunk 3, because REQ-WF-5 moves a
chunk-1 note into `DONE_LOG.md` before chunk 3; and `advance` reports the
moved-note count as a log line, not in `advance --json`, whose shape
`docs/commands.md` documents. The `notes` correction in `PROTOCOL.md`
(*User decision 2*) lands here rather than with `workflow`.*

**REQ-WF-1** — When the session holds more notes than the prompt shows, the
prompt shall show the most recently added notes, newest first.

**REQ-WF-2** — The prompt shall show the owner's notes ahead of notes the tool
derived from a file: those beginning `Quoted from ` (REQ-PROV-1) or `[memory] `.

The owner's words cannot be found anywhere else. A quoted note points at a file
the agent can read, and for Claude Code that file is already loaded.

**REQ-WF-3** — The prompt shall not show a note in either shape the tool writes
to record progress: `Session initialized on <YYYY-MM-DD>`, or
`Completed: Chunks <ids>. See DONE_LOG.md for details.`

Both repeat the `Resume:` line, and the second goes stale (Problem §A). The
match is on the whole note, so a note the owner wrote that merely starts with
`Completed:` still shows.

**REQ-WF-4** — `init` and `advance` shall not add a progress note to
`SESSION_STATE.md`.

**REQ-WF-5** — When `advance` archives a chunk, it shall move the owner's notes
out of `SESSION_STATE.md` and into that chunk's `DONE_LOG.md` entry. Notes that
REQ-WF-2 classes as derived stay in `SESSION_STATE.md`.

From then on, the notes in the state file are the active chunk's, and the
`DONE_LOG.md` entry records what was learned in each chunk. A note that should
outlive its chunk belongs in `CLAUDE.md`, which `import` quotes back. *User
decision 1.*

**REQ-WF-6** — When `advance` runs, it shall remove from `SESSION_STATE.md`
every note in a progress shape of REQ-WF-3.

These notes are the tool's own, and `completed_chunks` and `DONE_LOG.md`
already record what they say. This cleans up state files that 2.4.x wrote.

### Part B — One task status

*Built 2026-10-24 on `fix/live-bugs`. REQ-WF-7's test asserts the `Resume:`
count and `status --json`; the `Next (task k of n):` line is Part C.*

**REQ-WF-7** — When `SESSION_STATE.md` records a status for a task of the
active chunk, the prompt, `status` and `advance` shall count that task with
that status.

**REQ-WF-8** — If either `PLAN_N.md` or `SESSION_STATE.md` records a task as
done, then the task shall count as done.

A ticked box in the plan is not undone by a stale copy in the state file. In
the same way, in-progress outranks todo.

**REQ-WF-9** — When `advance` makes a chunk active, `SESSION_STATE.md` `tasks`
shall hold that chunk's tasks.

**REQ-WF-10** — When `mark_task_done` names, by exact text, a task of the active
chunk that `SESSION_STATE.md` does not list, the MCP server shall record that
task as done.

**REQ-WF-11** — The MCP tool `get_active_chunk` shall return the active chunk's
tasks, with their status as REQ-WF-7 and REQ-WF-8 decide it.

### Part C — The workflow-shaped prompt

*Built 2026-10-26 on `feat/workflow-prompt`. `formatWorkLines` and
`orderPendingTasks` in `formatter-utils.ts` render the tail for all five
formatters; `PromptAssembler` passes `state.workflow` as
`BootstrapContext.workflow`. Departures from the design: `MAX_WORKFLOW_STEPS`
and `MAX_WORKFLOW_STEP_CHARS` live in `schemas/session-state.ts`, beside the
schema that enforces them, not in `formatter-utils.ts`; REQ-WF-19's drop order
ends with the workflow line, after `+N more`, a place the design left open; a
one-task chunk reads `the 1 task is done`. REQ-WF-14 is tested over every
status vector up to length 5 rather than random ones. Passed before any code,
so the behaviour already held: REQ-WF-17, REQ-WF-22, the zero-task half of
REQ-WF-15, and the "absent" cases of REQ-WF-18. Added beyond the test plan:
`tests/e2e/workflow-prompt.e2e.test.ts`, which is the only test of the
assembler wiring (it failed with that line removed). The deterministic eval
checks under "Measuring it" are not built yet; `pnpm eval --local` is clean.*

**REQ-WF-12** — Where the active chunk has a pending task, the prompt shall
give the current task's position as `task <k> of <n>`. Here `k` is the current
task's 1-based place in the chunk's task list and `n` is the number of tasks.

**REQ-WF-13** — The current task shall be the first in-progress task in plan
order or, when there is none, the first todo task. The prompt shall list the
current task first among the pending tasks.

**REQ-WF-14** — Where the active chunk has a pending task, the prompt shall
carry a `Done when:` line. The line states that the chunk is done when all `n`
tasks are done, how many are left, and that the session stops there. The count
of tasks left shall equal the number that `PlanChunkManager.isComplete` finds
not done.

**REQ-WF-15** — If the active chunk has tasks and all of them are done, then
the prompt shall carry a `Chunk done:` line naming `dev-sesssion advance` as
the next step, in place of the `Next` list and the `Done when:` line.

**REQ-WF-16** — Where the session defines `workflow` steps, the prompt shall
render them in order on one `Each task:` line, numbered from 1.

**REQ-WF-17** — Where the session defines no `workflow`, the prompt shall carry
no `Each task:` line.

**REQ-WF-18** — `SESSION_STATE.md` shall accept an optional `workflow`: a list
of 1–7 steps, each one line of 1–120 characters. A state file without
`workflow` stays valid. A malformed `workflow` is a parse failure that names
the field. `PROTOCOL.md` documents the field in the same commit.

**REQ-WF-19** — If the prompt would exceed its line cap, then the formatter
shall drop lines in this order until the prompt fits: pending tasks after the
current one (each counted into `+N more`), then notes. The position, the
current task and the `Done when:` line are dropped only after everything
before them in that order.

**REQ-WF-20** — Every shipped formatter shall render its pending tasks, the
position, the workflow line, the exit line and its notes through one helper in
`formatter-utils.ts`.

**REQ-WF-21** — The prompt writer's validation and `ReplayScorer` shall read
the same declared files from a prompt as from that prompt with its Part C lines
removed. This holds whatever text the workflow steps and tasks contain.

**REQ-WF-22** — The prompt writer shall accept a prompt that carries none of
the Part C lines.

A formatter registered through `registerAdapter()` that renders today's shape
keeps working.

---

## Design

### What the prompt looks like

The scratch project from the Problem section, chunk 1, after `mark_task_done`
on the first task, with no `workflow` set:

```
Resume: 1/2 tasks done
Next (task 2 of 2):
  [ ] Write tests for a
Done when: all 2 tasks are done (1 left) — then stop.
Note: Blocker: b.ts must not import a.ts (cycle)
Note: Quoted from CLAUDE.md § "Testing": "Run vitest before committing."
```

With `workflow: ["Write a failing test", "Make it pass", "Run the full suite"]`
in `SESSION_STATE.md`, one more line appears after the task list:

```
Each task: 1. Write a failing test 2. Make it pass 3. Run the full suite
```

When every task is done:

```
Resume: 2/2 tasks done
Chunk done: all 2 tasks are done — the next step is `dev-sesssion advance`.
```

**What the default changes, and why it is not opt-in.** A session without
`workflow` gets two changes. The `Next:` header gains `(task k of n)`, and one
`Done when:` line is added. The note slots also show different notes (Part A).
Nothing else moves. Position and exit come from data every session already
has, and they are what the HLD aims at the correctness gap. Making them opt-in
would ship that aim to nobody. *User decision 3.*

"Then stop" fits both ways the tool is driven. A person ends the session and
runs `advance`. A harness following LLD-plan-authoring.md hands one chunk to a
fresh agent and runs `advance --json` itself. The line does not say *how* to
record a task done, because the tool cannot tell whether the agent has
`mark_task_done` (no adapter's `setup` configures the MCP server), and `update`
is interactive. *User decision 5.*

### The tool knows the task, not the step

The tool observes task status and nothing finer. It cannot tell whether the
agent is on step 2 of the owner's workflow, so the position is a task position.
The workflow line is a fixed per-task procedure in the owner's words, and no
code checks it. That is the HLD's "generic, user-defined steps that owe
[METHOD.md] nothing": no phases, no gates, no transitions.

### One helper — `formatter-utils.ts`

```ts
export const NEXT_PREFIX = "Next";                 // header: `Next (task 3 of 8):`
export const DONE_WHEN_PREFIX = "Done when:";
export const CHUNK_DONE_PREFIX = "Chunk done:";
export const WORKFLOW_PREFIX = "Each task:";
export const NOTE_PREFIX = "Note:";
export const QUOTED_NOTE_PREFIX = "Quoted from ";  // formatQuotedNote now uses it
export const MEMORY_NOTE_PREFIX = "[memory] ";     // moved from claude-adapter.ts
export const MAX_WORKFLOW_STEPS = 7;
export const MAX_WORKFLOW_STEP_CHARS = 120;

/** Whether a note is in a shape the tool writes to record progress (REQ-WF-3). */
export function isProgressNote(note: string): boolean;

/** Notes to show: progress notes dropped, owner's first, newest first (REQ-WF-1..3). */
export function selectNotes(notes: readonly string[], max: number): string[];

/**
 * The prompt's tail: position + pending tasks, workflow line, exit line, notes
 * (REQ-WF-12..17, 19). `linesUsed` is how many lines the formatter has already
 * written, so the tail can fit what is left of `context.maxPromptLines`.
 */
export function formatWorkLines(context: BootstrapContext, linesUsed: number): string[];
```

Each of the five formatters replaces its 22-line block with
`lines.push(...formatWorkLines(context, lines.length))`. `trimToMaxLines` stays
as the backstop. `DEFAULT_MAX_NEXT_TASKS` and `DEFAULT_MAX_NOTES` keep their
values and become arguments of the helper rather than of five copies.

`isProgressNote` matches the two exact shapes with anchored regexes
(`^Session initialized on \d{4}-\d{2}-\d{2}$` and
`^Completed: Chunks [\d., -]+\. See DONE_LOG\.md for details\.$`).

**Line budget (REQ-WF-19).** Today's worst case is 19 lines: 3 header, `Plan`,
`Not on disk yet`, 3 load lines, `Do NOT read`, `Resume`, `Last touched`,
`Next:`, 4 tasks, `+N more`, 2 notes. `Done when:` makes it 20, and a workflow
line makes it 21. The helper computes `room = maxPromptLines - linesUsed`. It
first lays out the full tail. While the tail is longer than `room`, it drops the
last listed task after the current one (the `+N more` count goes up), then the
oldest shown note, then the `+N more` line. At the 20-line default, the worst
case loses one task line, and both notes survive. With `max_prompt_lines: 5`,
the tail is cut by `trimToMaxLines` as it is today.

### Context and schema

`BootstrapContext` gains one optional field:

```ts
/** The owner's per-task steps (REQ-WF-16). Optional: a formatter that ignores it is valid. */
readonly workflow?: readonly string[];
```

`PromptAssembler.assemble` (`prompt-assembler.ts:193-207`) sets it from
`shown.workflow` when present. The assembler resolves it, not the formatter
reading `state`. If a per-chunk workflow from the plan is added later, it
changes one place.

`SessionStateSchema` (`.strict()`):

```ts
workflow: z.array(
  z.string().min(1).max(MAX_WORKFLOW_STEP_CHARS).regex(/^[^\r\n]*$/, "a workflow step must be a single line"),
).min(1).max(MAX_WORKFLOW_STEPS).optional(),
```

The serializer writes it only when it is an array (the `typeof` guard lesson
from `max_prompt_lines`, `docs/archive/session-notes.md`). `PROTOCOL.md` gets a
`workflow` row in the field table and the example. In the same commit it
corrects `notes`: "in the order added; a tool showing some shows the most
recent". *User decision 2.* The budget already charges
`SessionStateManager.toMarkdown`, so the steps cost what they weigh with no
budget change.

**Trust.** The steps are the owner's words in a file the tool owns, the same
class as a note written by `update`, which REQ-PROV-3 renders unquoted. They
are rendered unquoted, with two limits that keep them from turning into prompt
structure. The schema forces each step onto one line. Each step is printed
after a numeral on the `Each task:` line, never at the start of a line, so it
cannot begin with a file-load prefix or a required field (REQ-WF-21). Task text
stays as LLD-context-provenance.md §Out of scope leaves it. The `Done when:`
and `Chunk done:` lines are entirely tool text plus counts. They name no path,
so they need no `FILE_LOAD_PREFIXES` entry, and the `Plan:` line already points
at `PLAN_N.md`.

### Validator and replay scorer

There are no new `REQUIRED_FIELDS` (`next-prompt-writer.ts:48`) and no
`FILE_LOAD_PREFIXES` entries (`formatter-utils.ts:196`), so REQ-WF-22 holds by
construction. `ReplayScorer` matches a trimmed line against those prefixes
(`replay-scorer.ts:125`). Every Part C line begins with `Next (`,
`Done when:`, `Chunk done:`, `Each task:`, `Note:`, or two spaces and `[`. None
is a file-load prefix, so the declared set does not change (REQ-WF-21). The
eval harness keeps its private prefix copy (`evals/checks/grounding.ts:19`) by
design, and it needs no change either.

### Notes decay — `SessionStateManager`

```ts
/** Splits notes at advance (REQ-WF-5, 6): owner's notes leave, derived stay, progress dropped. */
takeChunkNotes(state: SessionState): { readonly state: SessionState; readonly archived: readonly string[] };
```

This is pure. `compact` (`session-state-manager.ts:155-185`) stops writing the
`Completed:` note (REQ-WF-4), and `buildInitialState` stops seeding
`Session initialized` (`final-writes.ts:256`). `PlanChunkManager.archive` gains
an optional `notes` parameter. `buildArchiveSummary`
(`plan-chunk-manager.ts:98-101`) appends a `Notes:` list under the chunk's
`Completed:` / `Tasks:` lines when it is given any. `advance.ts` calls
`takeChunkNotes` before `archive` (`:159`). Under `--dry-run` neither write
happens (REQ-DRY-1, unchanged), and the command reports how many notes it moved.

### One task status — `PlanChunkManager`

```ts
/** The chunk with each task's status raised to what SESSION_STATE.md records (REQ-WF-7, 8). */
withSessionStatus(chunk: PlanChunk, stateTasks: readonly Task[]): PlanChunk;
```

This is pure. It matches tasks by exact text, and the rank is
`done > in-progress > todo`. `loadActive` applies it, so `advance`'s
completeness check, `update`'s checklist, `status`, `health`, the assembler and
the archive all see one status. The overlay is read-only: `PLAN_N.md` is never
rewritten, because `toMarkdown` writes the file from the chunk alone and would
discard a hand-edited body. *User decision 7.*

`advance.ts` loads the next chunk before it saves the state, and sets
`state.tasks` from it (REQ-WF-9). Coordinate with REQ-ORC-6, which changes how
that next chunk is chosen in the same lines (`advance.ts:129`).
`SessionManager.markTaskDone` loads the active chunk. When the text matches a
chunk task that `state.tasks` lacks, it appends that task and then marks it
done (REQ-WF-10). `getActiveChunk` returns `loadActive(...).tasks`
(REQ-WF-11).

---

## Test plan

Every test is named for its requirement and watched failing first. Formatter
tests assert against what the registered formatters actually produce from a
real `BootstrapContext`, never hand-typed lines, following the
`bootstrap-formatter-dedupe.test.ts` pattern. CLI tests run the built CLI
through `execa`. State is put in place with core's own writers
(`SessionStateManager.save`, `SessionManager.markTaskDone`), never with
hand-written YAML.

| Requirement | Level | Test |
|---|---|---|
| REQ-WF-1 | unit | `selectNotes` over notes appended by `addNote` returns the last two, newest first |
| REQ-WF-2 | unit | Owner notes come before a `formatQuotedNote(...)` note and a `[memory]` note, even when those are newer |
| REQ-WF-3 | unit | The two progress shapes are hidden; `Completed: the migration` (owner) is shown |
| REQ-WF-4 | e2e | `init -y`: `SESSION_STATE.md` has no notes; `advance -y` ×2: still none written by the tool |
| REQ-WF-5 | e2e | Notes saved through `addNote` + `save`, then `advance -y`: they are gone from state and present under the chunk's `DONE_LOG.md` entry; a quoted note stays; `--dry-run` changes neither file |
| REQ-WF-6 | integration | A state file captured from the Problem §A run (2.4.x shapes) → `advance`: both progress notes removed |
| REQ-WF-1..3 | e2e | The Problem §A sequence replayed: on chunk 3 the prompt shows the owner's blocker, not either progress note |
| REQ-WF-7 | integration | `init` via execa → `SessionManager.markTaskDone` → `index` via execa: prompt `Resume: 1/2`, `Next (task 2 of 2):`; `status --json` reports 1 done |
| REQ-WF-8 | unit | `withSessionStatus`: plan `done` + state `todo` → done; plan `todo` + state `in-progress` → in-progress |
| REQ-WF-9 | e2e | `advance -y`: `SESSION_STATE.md` `tasks` equal `PLAN_2.md`'s task texts |
| REQ-WF-10 | unit | `SessionManager` on a temp session whose state lists an earlier chunk's tasks: `markTaskDone("Polish")` → `matched: true`, prompt counts it |
| REQ-WF-11 | unit | `getActiveChunk` on the same session returns the active chunk's tasks |
| REQ-WF-12 | unit | For each registered formatter: tasks `[done, todo, todo]` → `Next (task 2 of 3):` |
| REQ-WF-13 | unit | `[done, todo, in-progress, todo]` → `task 3 of 4`, the `[WIP]` line first, then tasks 2 and 4 |
| REQ-WF-14 | unit | Property test over random status vectors: the `Done when:` count left equals `tasks.filter(t => t.status !== "done").length`, and the line exists iff `!isComplete && tasks.length > 0` |
| REQ-WF-15 | unit | All done → one `Chunk done:` line naming `dev-sesssion advance`, no `Next`, no `Done when:`; zero tasks → neither line |
| REQ-WF-16 | unit | `workflow` of 3 steps → `Each task: 1. … 2. … 3. …` in order |
| REQ-WF-17 | unit | No `workflow` → no `Each task:` line; the rest of the tail equals the same context with `workflow: undefined` |
| REQ-WF-18 | unit | Schema: absent OK; 0 or 8 steps, a 121-character step, or a step with `\n` fail and name `workflow`; `toMarkdown` → `load` round-trips; a state without it serializes byte-identical to today |
| REQ-WF-19 | unit | Each formatter, context built to today's 19-line worst case + workflow at cap 20: output is 20 lines, keeps position, current task, `Done when:` and both notes, and `+N more` counts the dropped task exactly |
| REQ-WF-20 | unit | Each formatter's tail equals `formatWorkLines(context, n)` for the same context |
| REQ-WF-21 | unit | Workflow steps and task texts beginning `Plan: a/b.ts`, `Load full: x.ts`, `Project: y`: `extractDeclaredFiles` and the writer's file-load check give the same result with and without the Part C lines |
| REQ-WF-22 | unit | `NextPromptWriter.write` accepts a 2.4.2-shaped prompt captured from `generatePrompt` with Part C lines removed |

### Measuring it with the eval harness

**Deterministic tier (no API key).** These are black-box checks over the CLI,
added to `pnpm eval` once this is built. They get `EVAL` ids in
LLD-eval-harness.md when written.

1. **Position grounding.** After `init` on each target, the `k` and `n` in
   `Next (task k of n)` match the `status:` lines of the active `PLAN_N.md`.
2. **Progress moves the prompt.** Record one task done through the protocol
   (the `SESSION_STATE.md` status that `mark_task_done` writes), then run
   `index`. `k` advances and `Resume` counts it. This fails on 2.4.2.
3. **Notes chain.** This is RIGOUR §5's longitudinal scenario without an agent:
   `init`, then for each chunk add a note and `advance`. Measure the bytes in the
   state file's notes per session, whether the newest owner note is in the
   prompt, and lines used against the cap. Pass: notes bytes stay flat, and the
   newest note is always shown. On 2.4.2, notes bytes grow every session and the
   newest note never shows after session 1.
4. **Exit line.** `Done when:` is present iff tasks are pending, and its count
   equals pending tasks. The DevNexus target (`--target
   evals/targets/devnexus.local.json`) must keep prompt recall 11/11 and line
   count ≤ 20 on every chunk.

**Agent tier — what a run would need.** This tier is not designed here.
RIGOUR §1 says the current fixture cannot show a correctness effect, because
all 16 arm-runs passed. A run that could show one needs:

- a target calibrated to a 40–60% control pass rate (RIGOUR step 4), with a
  chunk of **at least 4 tasks**, so that position and stopping can matter;
- `mark_task_done` available to the bootstrap arms (the cold-agent harness
  starts `dev-sesssion mcp`), or a task cannot be recorded at all;
- three arms: control, the last release's prompt, and the WF prompt, so the
  WF effect is separated from the tool's existing effect, with 5 repeats per
  cell;
- outcome measures beyond tests passing: tasks recorded done that `verify`
  backs with evidence (`DONE_WITHOUT_EVIDENCE` counts against), **scope
  overrun** (files written that belong to a later chunk's tag set), **early
  stop** (pending tasks left with turns unused), and turns to first write.

---

## Out of scope

- **Tracking which workflow step the agent is on.** The tool cannot observe
  it, and the HLD rules out phase machinery.
- **Workflow from the plan**, such as a `## Workflow` section or a per-chunk
  workflow. Each plan source would have to extract it. `BootstrapContext.workflow`
  leaves room for it. *User decision 4.*
- **A CLI to set `workflow`.** In v1 it is set by hand in `SESSION_STATE.md`,
  like `max_prompt_lines`. The schema rejects a malformed value, and `health`
  reports the parse failure.
- **A non-interactive `update --done <text>`.** It would give agents without
  MCP a way to record a task. It belongs with ORC.
- **Un-marking a task.** Done wins (REQ-WF-8). Reopening a task means editing
  both files.
- **Numbered steps from the brief as the position.** PCX decided checkboxes are
  the tracked tasks, and the steps are context in `PLAN_N.md`.
- **Pinning a note across chunks.** A durable note belongs in `CLAUDE.md`.
- **The legacy `NextPromptWriter.generate`.** It is exported but called only
  by its tests, and it keeps its first-note rendering.
- **A correctness claim.** As in the HLD: this aims at the gap. The agent tier
  above is what would measure it.
