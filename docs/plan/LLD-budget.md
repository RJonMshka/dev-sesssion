# LLD — one context budget

**Area:** `BUD` — the context budget: how it is counted, and that every command
reports the same one.

---

## Problem

Found on DevNexus (2026-10-21). For one session, with nothing changed between
commands:

| Command | SESSION_STATE | Plan chunk | Total |
|---|---|---|---|
| `NEXT_PROMPT.md` `Budget:` line, `status` | ~135 | ~141 | ~326 |
| `preview` | ~226 | ~235 | ~511 |

After `index` built an ai-index, the prompt's line became `~872` while `status`
still said `~326`.

**1. Two components are guessed, not measured.**
`estimateSessionStateTokens` and `estimatePlanChunkTokens`
(`packages/core/src/calculators/context-budget-calculator.ts:44-92`) add a fixed
allowance per task (`+ 30`) and per note to the text lengths. The files on disk
carry ISO timestamps, quoting and YAML structure the allowance does not cover,
so both components came in ~40% under the bytes actually written. This is the
number that decides `[OK]` versus `[OVER]`.

**2. `status` charges a different plan.** The prompt assembler charges layered
costs once an ai-index exists (`prompt-assembler.ts:96-98`); `status` always
calls `estimate` with whole-file costs (`status.ts:352`). The two agree only
until the first `index`.

**3. `preview` recounts.** It reads `SESSION_STATE.md` and `PLAN_N.md` from disk
and adds them up itself (`preview.ts:198-235`), so its total cannot match the
prompt it prints beneath it — which is the prompt REQ-RUN-19 promises it shows.

---

## Requirements

**REQ-BUD-1** — The budget calculator shall count `SESSION_STATE.md` and the
active plan chunk from the text the tool serializes for them, at the same
bytes-per-token rate it applies to files.

**REQ-BUD-2** — `status` shall report the budget the prompt assembler charges
for the same session.

**REQ-BUD-3** — `preview`'s total and its `SESSION_STATE.md` and plan-chunk rows
shall equal the budget the prompt assembler charges for the same session.

**REQ-BUD-4** — If a file index entry carries no token cost, then the prompt
assembler's input shall charge that file at its measured size rather than a
fixed default.

Found while verifying REQ-BUD-2 on DevNexus: after `init`, the prompt said
`~2225` and `status` `~1094`. `FILE_INDEX.md` has no cost column, so an entry
read back from disk has no `token_cost`, and a file the ai-index does not cover
— `tokens.css`, ~962 tokens — is charged `DEFAULT_FILE_TOKEN_COST`, 50
(`layer-resolver.ts:88`). `init` charges its in-memory entries, which carry the
walker's measurement; every later command charged the default. The figure
`status` reported was the wrong one.

Measuring on reload then exposed the same gap inside `init`: its always-include
entry for `CLAUDE.md` is built without a cost, so `init` too charged 50 for a
7.8 KB file that Claude Code loads whole every session (~1,960 tokens). Every
entry is now measured on the way into the assembler, whoever built it.

**REQ-BUD-5** — `health` shall judge whether the session is over budget by the
budget the prompt assembler charges for it.

Added 2026-10-21, after the rest of this LLD shipped. On DevNexus the prompt read
`~5019/4000 [OVER]` while `health` reported "7 checks passed, no issues":
`checkBudget` (`health-checker.ts:281`) called `estimate` on entries read from
`FILE_INDEX.md`, which carry no costs, so every file was charged the flat
default and the ai-index was never consulted.

---

## Design

- `SessionStateManager.toMarkdown(state)` — the existing private
  `serializeToMarkdown` (`session-state-manager.ts:271`), exposed. Pure.
- The calculator counts `estimateTokensFromString(SessionStateManager.toMarkdown(state))`
  and `estimateTokensFromString(PlanParser.toMarkdown(chunk))`. Both are the
  writers the tool uses, so the count is of what it writes. No import cycle:
  neither module imports a calculator.
- `status` builds `loadAssembleInput` → `PromptAssembler.assemble` and reports
  `.budget`, as `update`/`advance` already do through `regenerate-prompt.ts`.
- `preview` takes `budget.totalTokens`, `.breakdown.sessionState` and
  `.breakdown.planChunk` from the assembly it already performs. Its per-file
  rows stay as they are: with an ai-index they already charge
  `layeredTokenCost`, the same figure the calculator uses.

- `FileIndexManager.withMeasuredCosts(entries, projectRoot)` fills a missing
  `token_cost` from the file's size, using the walker's heuristic
  (`TokenCounter.heuristicCountFromBytes`), so a reload charges what `init`
  charged. A file that cannot be stat'ed keeps no cost and falls back as
  before. `loadAssembleInput` applies it to every entry, read from disk or
  passed in by `init` (REQ-BUD-4).

`HealthChecker`'s over-budget check (`health-checker.ts:288`) inherits REQ-BUD-1
through the calculator but still charges whole-file costs; see Out of scope.

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-BUD-1 | unit | For a state and a chunk with timestamps and notes, the breakdown equals `ceil(bytes(toMarkdown(x)) / 4)` |
| REQ-BUD-2 | e2e | `status --json` total equals the number on the prompt's `Budget:` line — after `init`, and again after `index` |
| REQ-BUD-3 | e2e | `preview --json` total equals the same number, after `init` and after `index` |
| REQ-BUD-5 | e2e | A plan naming a 20 KB file: the prompt reads `[OVER]`, and `health` reports `BUDGET_EXCEEDED` with the prompt's figure |
| REQ-BUD-4 | e2e | A 4 KB CSS file a task names: `status` after `init`, and the prompt after `update -y`, equal the prompt `init` wrote |

### What actually happened

| Requirement | Outcome |
|---|---|
| REQ-BUD-1 | **Failed first** — the breakdown was the per-task allowance, not the serialized size |
| REQ-BUD-2, 3 | **Failed first** on the fixture: after `init`, prompt 523, `status` 214, `preview` 557 |
| REQ-BUD-4 | Found by checking REQ-BUD-2 on DevNexus, not by the fixture, which named only TypeScript files the ai-index covers. The e2e gained a 4 KB stylesheet and **failed first** (707 vs 1697) |

DevNexus, chunk 1, prompt / `status` / `preview`:

| | after `init` | after `index` |
|---|---|---|
| 2.4.2 | 326 / 326 / 511 | 872 / 326 / — |
| this change | 4135 / 4135 / 4135 | 4135 / 4135 / 4135 |

The figure went *up*, and the prompt now reads `[OVER]` against the 4,000 cap.
That is the correction, not a regression: `CLAUDE.md` (~1,960 tokens, loaded
whole by Claude Code every session) and `tokens.css` (~962) were each being
charged 50.

REQ-BUD-5 **failed first** (`health` printed "All 7 checks passed" over an
`[OVER]` prompt). With `health` on `PromptAssembler.charge`, DevNexus reports
`BUDGET_EXCEEDED ~4507 / 4000`, the prompt's own figure.

---

## Always-loaded files (added 2026-10-22)

### Problem

With one honest figure everywhere, DevNexus reads `[OVER]` on its first two
chunks. `init --chunk N`, then `preview --format json`, per chunk:

| Chunk | Total | Always-include (`CLAUDE.md`) | The rest |
|---|---|---|---|
| 1 | 4,507 | 1,960 | 2,547 |
| 2 | 4,497 | 1,960 | 2,537 |
| 3–8 | 2,905–3,362 | 1,960 | 945–1,402 |
| 9 | 8,080 | 1,960 | 6,120 — `docs/architecture.md` alone is 4,304 |

The cap exists to tell the developer when a *chunk* carries too much: trim a
file, split the chunk. Always-include files are the same in every chunk, and
`CLAUDE.md` is loaded by the agent whether or not the prompt names it. Charging
them against the cap spends half of it before the chunk adds anything, and no
`trim` or chunk split can earn it back — `trim` already leaves them out of its
own total (`trim.ts:172-182`). An ordinary `CLAUDE.md` therefore turns `[OVER]`
into noise, and chunk 9, the one chunk that is too heavy, reads the same as the
two that are not.

Raising the default instead would hide chunk 9's 6,120 along with chunk 1's
2,547: any cap high enough to absorb a large `CLAUDE.md` absorbs a heavy chunk
too.

### Requirements

**REQ-BUD-6** — The budget calculator shall judge the session over budget when
its capped tokens — `SESSION_STATE.md`, the active plan chunk, and the chunk's
files and focused units — exceed the cap; always-include files shall not count
toward the capped tokens.

**REQ-BUD-7** — The prompt's `Budget:` line shall state the capped tokens
against the cap and, where always-include files cost any tokens, state their
cost as a separate figure on the same line.

**REQ-BUD-8** — `status --json` and `preview --format json` shall report
`capped_tokens` and `always_include_tokens`, which sum to `total_tokens`; and
when `status`, `preview` or `health` reports the session over budget, it shall
state the capped tokens against the cap and the always-include cost apart.

### Design

- `ContextBudget` gains `cappedTokens` — `totalTokens − breakdown.alwaysInclude`.
  `totalTokens` keeps meaning everything loaded, so the context log's
  `total_tokens` history is unchanged in meaning. `overBudget` is
  `cappedTokens > cap` in both `estimate` and `estimateLayered`.
- `formatBudgetLine` → `Budget: ~2547/4000 tokens [OK] + ~1960 always loaded`;
  the suffix is omitted when always-include costs nothing, so a project with no
  `CLAUDE.md` sees the line it saw before.
- `formatOverBudgetMessage(budget)` in `formatter-utils.ts` is the one sentence
  `status` and `health` print; they held identical private copies.
- `preview`'s TOTAL row compares the capped figure with the cap; the component
  rows and their percentages are unchanged.

### Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-BUD-6 | unit | Always-include costing more than the cap, with a small chunk: `overBudget` false, `cappedTokens = total − alwaysInclude`; the same tokens tagged to the chunk instead: `overBudget` true |
| REQ-BUD-7 | unit | `formatBudgetLine` on that budget names the capped figure and the always-loaded cost; with none, no suffix |
| REQ-BUD-8 | e2e | A 20 KB `CLAUDE.md`: the prompt reads `[OK]`, `status --json` and `preview` report `capped_tokens` equal to the line's number and summing with `always_include_tokens` to `total_tokens`, and `health` reports no `BUDGET_EXCEEDED` |

### What actually happened

All three **failed first**: the seven unit tests on the missing `cappedTokens`,
the e2e on a prompt that read `[OVER]` for a project whose only weight was its
`CLAUDE.md`.

DevNexus, `init --chunk N`, after the change:

| Chunk | `Budget:` line | `health` |
|---|---|---|
| 1 | `~2547/4000 tokens [OK] + ~1960 always loaded` | clean |
| 2 | `~2537/4000 [OK]` | clean |
| 3–8 | `~945`–`~1402` `/4000 [OK]` | clean |
| 9 | `~6120/4000 [OVER]` | `BUDGET_EXCEEDED ~6120 / 4000, plus ~1960 always loaded` |

Prompt recall 11/11 and tag recall 100% on every chunk, unchanged. The one
chunk the cap now flags is the one that loads a 17 KB design doc whole.

`trim` was already consistent with this — it never counted always-include
files — but it still recounts from disk with its own counter rather than
taking the assembler's figure; see Out of scope.

---

## Out of scope

- ~~`health`'s over-budget check~~ — addressed by REQ-BUD-5. The budget does
  not depend on the formatter, so `PromptAssembler.charge` exposes the plan and
  budget half of `assemble` and `health` calls it; no formatter is needed.
- **`trim`'s own count.** `trim` sums `SESSION_STATE.md`, `PLAN_N.md` and the
  chunk's files at full size from disk (`trim.ts:172-182`), so its "Context: ~N"
  line can differ from the prompt's capped figure once an ai-index layers the
  files. It judges the same set of things, so it agrees on what is over; making
  it report the assembler's number is the REQ-BUD-3 fix applied to one more
  command.
- **A large always-include file.** Leaving it out of the cap means nothing warns
  when `CLAUDE.md` itself grows heavy; every report now shows its cost, and
  `status` still warns on always-include count creep. A size warning is its own
  requirement if it proves needed.
- **Accurate token counts.** All of this is the bytes/4 heuristic; the point here
  is that the heuristic is applied once, to real text.
