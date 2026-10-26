# LLD — plan authoring and harness orchestration

Areas: `PLA` (writing and checking a plan), `ORC` (a harness driving the loop)

Feature 13 of [HLD.md](./HLD.md). Method: [../METHOD.md](../METHOD.md).

---

## Problem

Feature 1 made the parser accept more plans. It did nothing for a project that
has **no usable plan**, and it gave an agent no way to tell whether the plan it
just wrote will parse. A coding harness that wants to drive the
plan → chunk → advance loop also hits interactive prompts and output meant for a
person.

### An agent cannot check a plan without running `init`

`splitPlan` (`packages/cli/src/commands/split-plan.ts:49`) is the only code that
runs `parsePlan` on a user's plan, and it is reachable only from `init`
(`init.ts:157`). It reports through `@clack/prompts` (spinner, `log.warn` at
`:118`, `log.info` at `:131`), not in any machine-readable form. To find out
whether a plan parses, an agent has to run `init --dry-run` and read decorated
prose, and pay for everything else `init` does around the split.

What the parser already knows and nobody can query:

- the source chosen and its confidence (`registry.ts:139`, threshold `0.3`);
- sections excluded, with line and task count (`result.excluded`, `:111`);
- dangling dependencies (`result.warnings`, `:127`);
- per chunk: whether a brief exists (`brief.ts`) and which paths it names
  (`file-refs.ts`). These decide what the prompt loads (PCX, IDX-12..18).

### A plan only counts at two paths

`NOTABLE_FILES` (`packages/core/src/detectors/project-detector.ts:17-18`) holds
exactly `PLAN.md` and `docs/PLAN.md`. A plan an agent writes anywhere else is
invisible. If `PLAN.md` already exists in another shape, such as a product spec
or a roadmap someone maintains by hand, the only way in is to overwrite the
user's file.

### No plan under `--yes` silently becomes one generic chunk

With no plan found, `init -y` calls `scaffoldPlan` (`init.ts:170`), which in
`--yes` mode invents one phase, `"Initial setup"` /
`"Set up the project foundation"` (`scaffold-plan.ts:75-83`). A harness running
`init -y` on a planless repo gets a session that looks valid but points at
nothing. This is the "loss that looks like success" class again.

### `advance` blocks on a prompt no harness can answer

When the chunk has incomplete tasks and `--yes` is absent, `advance` awaits
`confirm()` (`advance.ts:113`). Nothing in `packages/cli/src` checks
`process.stdin.isTTY`. The opposite flag, `--yes`, force-advances past
unfinished work (`:109`). A harness has only two choices: hang, or silently skip
work.

### The loop's state is only readable as prose

`status`, `health`, `verify`, `lint-context` and `memory stats` take `--json`.
`advance` does not: its `AdvanceResult` (`advance.ts:63-71`), including
`allChunksComplete`, is built and then thrown away, and the CLI prints
`log.success` text (`:135`, `:232`). A harness can't tell "advanced to 4" from
"that was the last chunk" without matching English.

### Nothing teaches an agent the plan shape

The format the registry scores highest is documented for humans in
`LLD-plan-sources.md`. No agent-facing artifact describes it. The Claude adapter's
`setup` (`packages/adapters/src/claude-adapter.ts:154`) writes a workflow block
into `CLAUDE.md`, and that block is paid for in **every** session, including the
ones that never touch the plan.

---

## Context cost — why a skill plus CLI, not more MCP tools

The question this LLD answers before any other: which surface costs the agent
the fewest tokens?

| Surface | Standing cost per session | Cost when used |
|---|---|---|
| Skill | its `description` only | body, once, on trigger |
| CLI via shell | 0 | one command line + its `--json` output |
| MCP tool | each tool's name, or its schema if the host doesn't defer | structured call + result |
| `CLAUDE.md` block | the whole block, always | — |

So the **how** goes in a skill, the **do** goes through CLI commands with
`--json`, and MCP gains only the one read-only tool a skill-less host
(Cursor, opencode, Windsurf: 3 of 4 adapters) can't replace. REQ-PLA-9 and
REQ-PLA-10 turn "the skill is cheap" from a claim into a test.

---

## Requirements

### Checking a plan (`PLA`)

- **REQ-PLA-1** — When `plan check <file>` runs, the CLI shall report the
  selected plan source, its confidence, and every candidate's score.
- **REQ-PLA-2** — When `plan check` runs, the CLI shall report, for each chunk,
  its id, title, task count, whether it has a brief, and the paths it names.
- **REQ-PLA-3** — When `plan check` runs, the CLI shall report every excluded
  section and every dangling dependency that `parsePlan` produced.
- **REQ-PLA-4** — If the plan yields zero chunks, or excludes a section that
  carries tasks, then `plan check` shall exit non-zero.
- **REQ-PLA-5** — Where `--json` is given, `plan check` shall write exactly one
  JSON document to stdout and nothing else.
- **REQ-PLA-6** — `plan check` shall not create or modify any file.

### Pointing at a plan (`PLA`)

- **REQ-PLA-7** — Where `init --plan <file>` is given, init shall ingest that
  file instead of searching `PLAN.md` and `docs/PLAN.md`.
- **REQ-PLA-8** — If `--plan` names a path outside the project root, then init
  shall reject it with a `SecurityError`.

### The skill (`PLA`)

- **REQ-PLA-9** — Where the Claude Code adapter is active, init shall write a
  plan-authoring skill whose description is at most 300 characters.
- **REQ-PLA-10** — The plan-authoring skill's body shall count at most 1,500
  tokens by the core token counter.
- **REQ-PLA-11** — The skill's example plan, run through `parsePlan`, shall
  yield at least two chunks, no exclusions, and a brief and at least one named
  path for every chunk.
- **REQ-PLA-12** — Every `dev-sesssion` subcommand and flag the skill names
  shall be one the CLI registers.
- **REQ-PLA-13** — If a skill file already exists at that path without this
  tool's managed marker, then init shall leave it unchanged and report that it
  was skipped.
- **REQ-PLA-14** — When a skill file carries the managed marker of an older
  version, init and `update` shall replace it.

### Orchestration (`ORC`)

- **REQ-ORC-1** — Where `--json` is given, `advance` shall write its result,
  including `allChunksComplete`, as one JSON document to stdout.
- **REQ-ORC-2** — If `advance` would prompt for confirmation and stdin is not a
  TTY, then it shall exit non-zero without advancing, and name `--yes` as the
  override.
- **REQ-ORC-3** — If init finds no plan, then init shall state that no plan was
  found and name the steps to write one, check it, and pass it with `--plan`.
- **REQ-ORC-4** — Where the MCP server is running, it shall expose a read-only
  `check_plan` tool returning the same report as `plan check --json`.
- **REQ-ORC-5** — The MCP server shall not expose `advance` or `init`.
- **REQ-ORC-6** — When `advance` runs, it shall make the active chunk the
  lowest-numbered chunk above the current one, whether that id is fractional
  or leaves a gap.
- **REQ-ORC-7** — While a chunk with a higher id than the active one exists,
  `advance` shall not report `allChunksComplete`.

REQ-ORC-3 adds a message and changes no outcome: `init -y` still scaffolds its
placeholder chunk and exits 0, so nothing in this LLD is a breaking change.

---

## Design

### Shape

```
         agent (with skill)                 harness / orchestrator
              │                                       │
  writes plan │                                       │ per chunk:
              ▼                                       ▼
   dev-sesssion plan check --json ◄─ fix ─┐   status --json
              │ exit 0                    │   spawn FRESH agent ← prompt
              ▼                           │   (agent works, marks tasks)
   dev-sesssion init --plan <f> -y        │   advance --json
              │                           │   until allChunksComplete
              ▼                           │
         .session/  ──────────────────────┘
```

The plan check is the feedback loop. The skill tells the agent what shape to
write; the check tells it whether it worked. Neither one is enough without the
other: a skill alone gets an agent to write something that looks right and
scores 0.28.

### Core: `checkPlan` (REQ-PLA-1..4)

New `packages/core/src/parsers/plan-sources/check.ts`. A pure function over
existing parts; nothing new is parsed.

```typescript
export interface PlanCheckChunk {
  readonly id: number;
  readonly title: string;
  readonly taskCount: number;
  readonly hasBrief: boolean;          // brief.ts produced non-empty text
  readonly namedPaths: readonly string[];  // file-refs.ts
}

export interface PlanCheckReport {
  readonly ok: boolean;                // REQ-PLA-4
  readonly source: { readonly name: string; readonly confidence: number } | null;
  readonly candidates: readonly { name: string; confidence: number; reason: string }[];
  readonly chunks: readonly PlanCheckChunk[];
  readonly excluded: readonly ExcludedSection[];
  readonly warnings: readonly string[];
}

/** @throws never — an unrecognized plan is a report with ok: false. */
export function checkPlan(content: string): PlanCheckReport;
```

`parsePlan` throws `ParseError` below threshold (REQ-PS-3). `checkPlan` catches
it and returns `source: null` with the ranked candidates, so the agent gets the
same report shape whether the plan is good, weak or unrecognized.

`init` and `plan check` read the same `parsePlan` result, so they agree on
chunks, exclusions and warnings by construction; the integration test pins that
on both archive plans. `split-plan.ts` keeps its own flow, because it needs the
full `PlanChunk[]` to write, but the sentence explaining an exclusion moved to
core as `describeExclusion(reason)` so the two commands cannot word it
differently.

Built 2026-10-22. Running it on `docs/archive/PLANv2.md` exits 1: its
`Revision — 2026-04-14` section holds 12 tasks and declares no chunk number, so
`init` would drop them. `init` only warns about that; `plan check` fails, which
is the point.

### CLI: `plan check` (REQ-PLA-5, 6)

`packages/cli/src/commands/plan.ts`, a `plan` parent command with `check <file>`
as its only subcommand. `<file>` passes `PathValidator.safeResolvePath()`. It reads
the file, calls `checkPlan`, and renders the result either as clack text or as
`JSON.stringify(report)`. In `--json` mode no spinner is started, because clack
writes to stdout. The command never resolves `.session/`, so REQ-PLA-6 holds by
construction and running it in this repo is safe.

### `init --plan` (REQ-PLA-7, 8)

New option on `init.ts:383`. When present, it replaces `detection.plan` before
`:150`. The path goes through `PathValidator.safeResolvePath()`, which already
throws `SecurityError` on escape (REQ-PLA-8). The detector is unchanged.

### The skill (REQ-PLA-9..14)

**Owner:** `packages/adapters`. The skill is a Claude Code artifact, and the
Claude adapter's `setup` already writes Claude Code files (`claude-adapter.ts:154`).
Its text lives in `packages/adapters/src/claude-skill.ts` as an exported
template, so tests can import it. Destination:
`.claude/skills/dev-sesssion/SKILL.md`, written through `context.writeFile`
(AtomicWriter + WriteGuard).

**One skill, two sections**, because two skills would pay for two descriptions:

1. *Writing a plan.* The shape that scores 0.95 (REQ-PS-4, 6): `## Chunk N —
   <title>` per unit of work; under each, a one-line goal, numbered steps, a
   `Files:` list of backticked paths, then `- [ ]` tasks; `Depends on: Chunk N`
   when needed. Rules: keep a chunk to one session's work; name paths that will
   exist even if they don't yet (NEW-1..6 loads their neighbours). Then the
   loop: write → `plan check <file> --json` → fix until `ok` → `init --plan
   <file> -y`. Never overwrite an existing `PLAN.md`; write
   `docs/dev-sesssion-plan.md` and use `--plan`.
2. *Running the loop.* `status --json` → hand `dev-sesssion prompt` output to a
   **fresh** subagent or session for the chunk → `advance --json` → stop on
   `allChunksComplete`. The orchestrator itself reads only JSON and never loads
   chunk files. Running every chunk in one conversation undoes what the tool is
   for, and the skill says so in one sentence.

**Drift guards**, following the "real generator output" rule:

- REQ-PLA-11: the test cuts the fenced example out of the generated `SKILL.md`
  and runs it through `checkPlan`. It doesn't use a copy.
- REQ-PLA-12: the test extracts every `dev-sesssion <cmd> [--flag]` from the
  generated text and resolves each one against the real Commander program
  (`createProgram()` from `cli.ts`). This is the registry lesson from
  `--adapter` applied to docs: a renamed flag fails CI instead of failing an
  agent.
- REQ-PLA-10: `TokenCounter` from `packages/core/src/counters/`. It's the same
  counter the budget uses, so "1,500" means what it means everywhere else.

**Managed marker** (REQ-PLA-13, 14): first body line
`<!-- dev-sesssion:managed v<version> -->`. This is the same pattern as the
`CLAUDE.md` managed block from LLD-first-run. A file without the marker belongs
to the user and is never touched.

*Built 2026-10-26 on `feat/plan-orchestration`. `setup` writes the skill when the
CLI passes its version (`AdapterSetupContext.version`, optional, so third-party
callers without one write nothing). `update` reaches it through a new optional
`Adapter.refresh` hook, which replaces a managed file and never creates one.
Ownership notices travel as `AdapterSetupResult.notices` and are always shown;
`refresh` doesn't repeat the "skipped" notice on every update. The e2e test
found that the adapter writer couldn't create `.claude/skills/dev-sesssion/`;
`createAdapterWriteFile` now creates the parent directory.*

### `advance --json` and non-TTY (REQ-ORC-1, 2)

`runAdvance` already returns `AdvanceResult`. The command handler prints it when
`--json` is set and skips the clack logging. The TTY guard goes immediately before
`confirm()` at `advance.ts:113`. It throws a `CliError` whose suggestion names
`--yes`. It's a check in the CLI, not core: TTY is a CLI concern.

### Advancing in plan order (REQ-ORC-6, 7)

*Built 2026-10-24 on `fix/live-bugs`. `--json` (REQ-ORC-1) is not built, so the
e2e test reads the active chunk from `status --json`. Landing on a fractional
chunk also needed `CONTEXT_LOG.md`'s `active_chunk` widened from integer to
number, as `SESSION_STATE.md`'s already was — otherwise the log entry `advance`
appends made every later command fail to parse.*

Found while checking this LLD against the code on 2026-10-24. The HLD carried it
as "`advance()` still does `active_chunk + 1`". The orchestration loop turns that
from a known gap into data loss:

- `advance.ts:129` computes `nextChunkId = currentChunkId + 1`, and
  `PlanChunkManager.advance` (`plan-chunk-manager.ts:218`) writes
  `active_chunk + 1`.
- Chunks 1, 2, 3, 3.5, 4: advancing from 3 lands on 4 and skips 3.5.
- Chunks 1, 3 (2 excluded, or a plan numbered from 10): advancing from 1 finds
  no chunk 2 and takes the last-chunk branch (`advance.ts:132`). The session
  reports "All chunks complete" with work left. Under `advance --json`, a
  harness reads `allChunksComplete: true` and stops for good.

Fix in core, mirroring `startAt` (`plan-chunk-manager.ts:191`), which already
orders chunks numerically (REQ-CHK-2): `PlanChunkManager.nextAfter(chunks, id)`
returns the lowest `chunk_id` greater than `id`, or `undefined`.
`PlanChunkManager.advance(state, nextId)` takes the target instead of computing
it, and `advance.ts` asks `nextAfter` instead of adding 1. Ids stay plain
numbers, so the schema doesn't change.

### Init without a plan (REQ-ORC-3)

Don't fail; tell the user what to do. At `init.ts:168`, before `scaffoldPlan`,
replace the one-line `"No PLAN.md found. Starting interactive setup."` with a
direction that names the next steps:

```
No plan found (looked for PLAN.md, docs/PLAN.md).
  1. Write one — ask your agent to use the dev-sesssion skill, or give each
     unit of work a "## Chunk N — <title>" heading with "- [ ]" tasks beneath
  2. Check it:  dev-sesssion plan check <file>
  3. Use it:    dev-sesssion init --plan <file> -y
```

Then scaffolding proceeds as today: the interactive wizard without `-y`, the
one placeholder chunk with it. Under `-y`, the direction also says that the
session currently holds a placeholder chunk, which is the part that used to look
like success. The text comes from one function in core
(`noPlanDirection()`), so the skill and this message can't name different
commands. Its commands get the same `createProgram()` check as REQ-PLA-12.

### MCP (REQ-ORC-4, 5)

One entry added to `packages/cli/src/mcp/tools.ts`: `check_plan { path }`, which
returns the `PlanCheckReport`. The path is validated, and the tool is marked
read-only. The tool list goes from 7 to 8. `advance` stays off MCP: it archives
and compacts state, and the server has a read-only mode (`server.ts:36`) that
should stay meaningful.

---

## Test plan

| Requirement | Test | Level |
|---|---|---|
| REQ-PLA-1..4 | `plan-sources/check.test.ts`: good / weak / unrecognized / excluded-with-tasks | unit |
| REQ-PLA-1..4 | `tests/plan-check.integration.test.ts` over `docs/archive/PLAN.md`, `PLANv2.md` and the four PS dialect fixtures | integration |
| REQ-PLA-5, 6 | `tests/e2e/plan-check.e2e.test.ts`: stdout parses as JSON; temp dir file list unchanged | e2e |
| REQ-PLA-4 | same e2e: exit codes for `ok` true/false | e2e |
| REQ-PLA-7, 8 | `tests/e2e/first-run.e2e.test.ts`: `--plan docs/x.md`; `--plan ../x.md` rejected | e2e |
| REQ-PLA-9, 10, 11 | `packages/adapters/src/__tests__/claude-skill.test.ts`: over generated text | unit |
| REQ-PLA-12 | `packages/cli/src/__tests__/skill-commands.test.ts`: generated text vs `createProgram()` | unit |
| REQ-PLA-13, 14 | `claude-adapter` setup tests with a user-owned file and an old-marker file | unit |
| REQ-PLA-9, 13, 14 | `tests/e2e/plan-skill.e2e.test.ts`: init writes the skill with the CLI's version; a user file survives init and update; update replaces an old marker and creates nothing | e2e |
| REQ-ORC-1 | `tests/e2e/lifecycle.e2e.test.ts`: `advance --json` mid-plan and at last chunk | e2e |
| REQ-ORC-2 | same: execa with `stdin: "pipe"`, incomplete tasks, no `--yes` → non-zero, state unchanged | e2e |
| REQ-ORC-3 | `tests/e2e/first-run.e2e.test.ts`: planless fixture with `-y` exits 0, stdout names `plan check` and `--plan` and the placeholder; commands resolve against `createProgram()` | e2e |
| REQ-ORC-6 | `plan-chunk-manager` unit: `nextAfter` over `[1,2,3,3.5,4]` from 3 → 3.5, over `[1,3]` from 1 → 3, from the max → `undefined` | unit |
| REQ-ORC-6, 7 | `tests/e2e/lifecycle.e2e.test.ts`: plan with chunks 1, 3 and 1, 1.5, 2 — `advance --json --yes` lands on 3 / 1.5 and reports `allChunksComplete: false` | e2e |
| REQ-ORC-4, 5 | `packages/cli/src/__tests__/mcp.test.ts`: tool list and `check_plan` output equals `checkPlan` | unit |

REQ-PLA-11 is the test that matters most. Without it, the skill becomes
the next hand-written fixture: text describing what the author *believes* the
parser accepts.

Not tested here: whether an agent with the skill actually writes plans that pass
on the first try. That needs the agent tier of the eval harness, which hasn't
run on a real target yet (HLD Status). An eval case for it belongs in
`LLD-eval-harness.md` once that tier exists.

---

## Out of scope

- **Skills for other hosts.** Cursor, opencode and Windsurf get `check_plan` over
  MCP and nothing else. Their rule/agent-file formats each need their own
  adapter work.
- **A plan-generation command.** `dev-sesssion` doesn't call a model. Writing
  the plan is the agent's job; the tool checks it.
- **Rewriting a user's existing plan.** The skill writes a new file and points
  `--plan` at it. Converting a foreign `PLAN.md` in place is a choice the
  user makes, not the skill.
- **Slimming the `CLAUDE.md` workflow block** by moving its content into the
  skill. That's worth doing for the same context reason, but it changes
  LLD-first-run's managed block and should be measured before and after. It is a
  follow-up.
- **`--json` on the remaining commands** (`init`, `update`, `index`). The loop
  above needs only `status`, `advance` and `plan check`.
- **An orchestrator binary.** The harness *is* the orchestrator; this LLD only
  makes the CLI safe and legible for one.
