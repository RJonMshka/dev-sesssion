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

---

## Out of scope

- **`health`'s over-budget check** still charges whole-file costs, so it can warn
  where the prompt says `[OK]` after `index`. Moving it onto the assembler means
  giving a `core` checker the adapter's formatter; worth doing, not in this change.
- **Accurate token counts.** All of this is the bytes/4 heuristic; the point here
  is that the heuristic is applied once, to real text.
