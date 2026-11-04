# LLD — marking a task done from the command line

**Area:** `TASK` — one command that ticks a task of the active chunk.

---

## Problem

Found in the overnight eval of 2026-11-03. In every handoff run the agent
edited `SESSION_STATE.md`, `PLAN_2.md` and `FILE_INDEX.md` by hand to say "I
finished task 2". It had no other way:

- `update` marks tasks only through an interactive checklist
  (`update.ts:275`), and `--yes` skips tasks entirely.
- The MCP `mark_task_done` tool (`SessionManager.markTaskDone`) does it, but
  `init` never connects the MCP server, and the tool takes exact text only.

Hand-editing state is the main bookkeeping cost of a session, and a typo in the
YAML fails the `.strict()` schema. A one-line command removes it.

---

## Requirements

**REQ-TASK-1** — When `task done <n>` runs with a whole number `n`, the CLI
shall mark done the `n`-th task of the active chunk, counting from 1 in plan
order.

**REQ-TASK-2** — When `task done <text>` runs with anything else, the CLI shall
mark done the task whose text equals `<text>`; failing that, the one task whose
text contains `<text>`, ignoring case.

**REQ-TASK-3** — If the selector matches no task, or more than one, then the
CLI shall exit 1, change nothing, and list the active chunk's tasks with their
numbers.

**REQ-TASK-4** — When the CLI marks a task done, it shall record it exactly as
the MCP `mark_task_done` tool does, and regenerate `NEXT_PROMPT.md` and
`context-manifest.json`.

**REQ-TASK-5** — If the task is already done, then the CLI shall exit 0, say
so, and change nothing.

**REQ-TASK-6** — Where `--json` is given, the CLI shall write exactly one JSON
document to stdout, whether it marked a task or refused.

**REQ-TASK-7** — Where `--dry-run` is given, the CLI shall say which task it
would mark and write nothing.

**REQ-TASK-8** — When the task marked was the active chunk's last open one, the
CLI shall say so and name `dev-sesssion advance`.

---

## Design

Core: `TaskSelector.resolve(tasks, selector)` in
`core/src/managers/task-selector.ts`, pure, returns
`{ kind: "one", number, task } | { kind: "none" } | { kind: "many", numbers }`.
A selector that is all digits is a number (REQ-TASK-1); a number outside the
list is `none`, not a text search. Exact text wins over containment, so a task
whose text is a prefix of another's can still be named.

CLI: `commands/task.ts` registers `task done <selector...>`. The words are
joined with one space, so `task done Wire auth` works unquoted. It reads the
active chunk through `SessionManager.getActiveChunk()` (status merged, as the
prompt shows it), marks through `SessionManager.markTaskDone(text)`
(REQ-TASK-4, one write path with MCP), then `regeneratePrompt`.

JSON shape:

```ts
{ ok: true,  number, task, alreadyDone, done, total, chunkComplete }
{ ok: false, error, tasks: { number, text, status }[] }
```

`--json` routes clack output to stderr (`withStdoutOnStderr`), as `advance
--json` does. Exit codes: 0 marked or already done, 1 no single match, and the
usual `handleError` codes otherwise.

---

## Test plan

| Req | Level | Test |
|---|---|---|
| TASK-1, -2, -3 | unit | `task-selector.test.ts`: number, exact text, unique substring, ambiguous substring, out-of-range number, prefix task |
| TASK-1, -4 | e2e | `init -y`, `task done 1`; `SESSION_STATE.md` has task 1 done, and `NEXT_PROMPT.md` equals what `prompt` prints |
| TASK-2 | e2e | `task done tooling` marks the one task containing it |
| TASK-3 | e2e | `task done 9` exits 1, state bytes unchanged, output lists `1.` and `2.` |
| TASK-5 | e2e | marking the same task twice: second exit 0, says already done, state bytes unchanged |
| TASK-6 | e2e | `--json` success and refusal both parse as one document |
| TASK-7 | e2e | `--dry-run task done 1`; `.session/` bytes unchanged |
| TASK-8 | e2e | marking the last open task names `dev-sesssion advance`; JSON has `chunkComplete: true` |

---

## Out of scope

- Marking a task in progress, or undoing done. `update` still does both
  interactively.
- Telling the agent to use the command. The prompt and adapter instructions
  are changed with the "instructions contradict the CLI loop" finding.
