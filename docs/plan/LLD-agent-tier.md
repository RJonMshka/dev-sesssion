# LLD — the agent tier on a real target

**Area:** `EVAL`, the same area as [LLD-eval-harness.md](LLD-eval-harness.md).
Ids are global and append-only. REQ-EVAL-1..18 already exist there, so this
document continues at **REQ-EVAL-19**.

It answers the open question in [HLD.md](HLD.md) (Status, "Still open"): *every
number above is deterministic; nothing yet shows an agent does better with the
new context.* It builds RIGOUR steps 3–5 ([`evals/RIGOUR.md`](../../evals/RIGOUR.md),
Sequence) and nothing more. The scope is the smallest design that could give a
trustworthy yes, no, or "can't tell" to one question:

> On a real repository, does a cold agent shown the generated context pass a
> task's held-out tests more often than the same agent shown nothing?

---

## Problem

**1. The one correctness result we have is a ceiling, so it can't express a
difference.** All 16 arm-runs passed (`EVAL_REPORT.md:31`, `:172`). RIGOUR §1
names the fix: tasks where control fails 40–60% of the time
(`RIGOUR.md:43-57`). Every task we have is a single-file restore in a 10-file
fixture whose tests sit in plain view. `run-agent.ts:88` snapshots `tests/`
and leaves it readable, so the agent learns the contract from the tests. That
was the point of the original ablation (`targets.ts:24-27`), and it is also
why both arms pass.

**2. The agent tier can't run on a real target at all.**

- `run-agent.ts:163` iterates the built-in `TARGETS` only. `--target` exists in
  the deterministic tier only (`run.ts:278-281`).
- A target file can't describe a task. `parseTargetFile` hard-codes
  `chunk: 1` and `ablations: []` (`target-file.ts:73-74`).
- The gate is hard-wired to one layout. Root `node_modules/.bin/tsc` and
  `vitest run` (`verification.ts:101-103`), deps installed with `npm` from the
  root manifest only (`fixture-deps.ts:45-54`, `:75`), and a gate directory
  named `tests` (`run-agent.ts:88`). DevNexus is a pnpm/turbo workspace. Its
  three test files are in `packages/shared/__tests__/`, and its root manifest
  has `link:../mfkit/...` dev dependencies that npm can't install.
- The agent tier pins `DEFAULT_VERSION = "2.2.1"` (`run-agent.ts:43`), the
  drift REQ-EVAL-14 fixed for the deterministic tier only. It also has no
  `--local` (`run-agent.ts:159`), but everything the HLD lists as moving
  DevNexus is unreleased (HLD Status table).
- It writes its report to the committed `evals/report/`
  (`run-agent.ts:258-261`). On a private target that would commit the
  target's file names. The deterministic tier sends those reports to the
  gitignored `report/local/` instead (`run.ts:294-302`, `.gitignore:43`).

**3. A workspace copied from a real repo's working tree leaks the answer.**
`prepareWorkspace` copies the working tree (`workspace.ts:74`, `:47-59`) and
skips only directories (`:29`). On DevNexus the working tree has untracked
build output beside the sources: `packages/shared/src/events/EventBus.d.ts`
sits next to `EventBus.ts`. Git tracks 198 files, and exactly one of them is a
`.d.ts`. Ablate `EventBus.ts` and the agent can still read its full declared
API. The tree is also dirty: 10+ modified or deleted files when this was
written, so two runs a week apart don't measure the same repository.

**4. The behavioural metrics RIGOUR calls "already collected" aren't.**
RIGOUR's Sequence step 3 says the §6 metrics are "all derivable from data
`runColdAgent` already collects" (`RIGOUR.md:360`). Several are not:

- `filesRead` is a `Set` (`cold-agent.ts:163`), which loses order and the turn
  of each read.
- A read is recorded only after it succeeds (`cold-agent.ts:199-200`), so a
  refused read of a denied path leaves no trace (`:212-218`).
- Turns-to-first-write, reads-before-first-write and "Do NOT read" violations
  (`claude-bootstrap-formatter.ts:75` emits that line) all need the ordered
  call log, which isn't kept.

**5. The token figure would misreport once caching is on.** Only
`usage.input_tokens` is summed (`cold-agent.ts:180`). With prompt caching that
field excludes cache reads and writes, so turning caching on to save money
would look like a context-burn effect.

**6. The statistics are the wrong shape, and the one p-value quoted doesn't
say which test it is.** The report uses mean and median of ratios
(`EVAL_REPORT.md:127`). RIGOUR §2 asks for log-differences and intervals
(`RIGOUR.md:59-83`). The "8/8, p ≈ 0.004" (`EVAL_REPORT.md:162`) is a
one-sided sign test (0.5⁸ = 0.0039), and nowhere says so. Two-sided, it is
0.0078. That kind of choice has to be fixed before the data exists. Nothing in
`evals/` computes any of these numbers yet, so nothing tests them.

---

## Requirements

### Target and task

**REQ-EVAL-19**: Where `--target <file>` is passed to the agent tier, the
agent tier shall run only the tasks that file declares, and shall not write to
the target's source directory.

**REQ-EVAL-20**: Where a target file pins a commit, the harness shall build
each workspace from that commit's tracked tree rather than from the source
directory's working tree.

**REQ-EVAL-21**: The harness shall withhold a task's gate files from the
workspace while the agent runs. It shall plant them only after the agent
stops, and shall report any agent write to a gate path as tampering.

**REQ-EVAL-22**: If a task's gate fails on the pinned tree with nothing
removed (the oracle run), then the harness shall report the task invalid and
run no agent on it.

**REQ-EVAL-23**: If a task's gate passes with the task's files removed and no
agent run (the null run), then the harness shall report the task invalid and
run no agent on it.

**REQ-EVAL-24**: If a file a task removes leaves a sibling with the same stem
in the workspace (for example `X.d.ts`, `X.js` or `X.js.map` beside a removed
`X.ts`), then the harness shall report the task invalid.

**REQ-EVAL-25**: Where `--version` is not passed, the agent tier shall install
the version that `packages/cli/package.json` declares.

**REQ-EVAL-26**: Where `--local` is passed, the agent tier shall install the
CLI from a tarball packed from the workspace build.

**REQ-EVAL-27**: Where `--target` is passed, the agent tier shall write every
report under `evals/report/local/`.

### What the agent did

**REQ-EVAL-28**: The cold-agent runner shall record every tool call in order:
its turn, tool name, path argument, and whether it succeeded. Refused calls
are recorded too.

**REQ-EVAL-29**: For each run, the harness shall report the turns before the
first successful write and the files read before it.

**REQ-EVAL-30**: For each run, the harness shall report the files read that
are neither named by the run's generated prompt nor declared for the task's
chunk in the target's `expectedFiles`.

**REQ-EVAL-31**: For each run, the harness shall report the reads and read
attempts of paths that match a `Do NOT read:` pattern in the run's generated
prompt.

**REQ-EVAL-32**: The input-token figure reported for a run shall be the sum of
uncached, cache-write and cache-read input tokens across all its turns.

**REQ-EVAL-33**: For each run, the harness shall report its cost in dollars,
computed from its token usage and a price table stored in the harness.

### Calibration

**REQ-EVAL-34**: While in calibration mode, the agent tier shall run only the
control arm. It shall report each task as admitted or retired by the band in
the pre-registration.

**REQ-EVAL-35**: When a task is calibrated, the harness shall measure how
similar the ground truth is to a completion of the removed file written with no
context and no tools. It shall retire the task if that similarity exceeds the
pre-registered threshold.

**REQ-EVAL-36**: The analysis shall exclude calibration runs from the
measurement.

### Measurement and analysis

**REQ-EVAL-37**: While in measurement mode, the agent tier shall run each
admitted task the pre-registered number of times in each arm, in an order
shuffled from the pre-registered seed.

**REQ-EVAL-38**: If a run ends at the turn cap or with an unrecovered API
error, then the analysis shall count it as a gate failure and report how many
such runs there were in each arm.

**REQ-EVAL-39**: The analysis shall report the primary endpoint: the mean over
tasks of each task's bootstrap-arm pass rate minus its control-arm pass rate,
with a 95% hierarchical bootstrap interval. Given the same input and seed,
the interval shall be the same.

**REQ-EVAL-40**: The analysis shall report, over tasks, how many favoured each
arm, with an exact two-sided sign-test p-value.

**REQ-EVAL-41**: The analysis shall report the efficiency endpoint: the
geometric-mean ratio of bootstrap-arm to control-arm input tokens, computed
from per-task mean log-differences. It shall come with a 95% bootstrap
interval and an exact two-sided Wilcoxon signed-rank p-value.

**REQ-EVAL-42**: The analysis shall report, for each arm, the within-task and
between-task standard deviation of log input tokens.

**REQ-EVAL-43**: The analysis shall classify the primary result as `better`,
`worse`, `no-meaningful-effect` or `inconclusive`, using the rule and
thresholds stated in the pre-registration.

**REQ-EVAL-44**: If the task file's content hash, or the run's model, CLI
version, repeats or seed, differs from the pre-registration, then the agent
tier shall refuse to run in measurement mode.

**REQ-EVAL-45**: Where `--target` is passed, the agent tier shall not run the
judge unless `--judge` is also passed.

---

## Design

### What runs, end to end

```
target file (gitignored) ──┐
tasks file (gitignored) ───┼─► validate ──► oracle / null / sibling checks   free, no key
gates dir (gitignored) ────┘                     │ (REQ-EVAL-22..24)
                                                 ▼
                         probe ──► memorisation check, 1 call per task         cents
                                                 ▼
                     calibrate ──► control × 5 per task ──► admit / retire     paid
                                                 ▼
  pre-registration (committed) ─► measure ──► both arms × R, shuffled          paid
                                                 ▼
                               analyse ──► stats over run records              free, unit-tested
```

Four modes of one entry point, `evals/run-agent.ts`: `--mode
check|calibrate|measure|analyse`. `check` and `analyse` need no API key and
run in seconds. That is where every decision lives that could be got wrong
without spending money. `analyse` reads run records from disk, so a
measurement can be re-analysed for free and the statistics never re-run an
agent.

### Specifying tasks on a target outside the repo

A target can't live in this tree, so its tasks can't either. Three files,
none committed:

| File | Holds | Committed? |
|---|---|---|
| `evals/targets/<id>.local.json` | The existing target file (REQ-EVAL-13), plus `sha`, `deps`, `deny` | No, already ignored (`.gitignore:42`) |
| `evals/targets/<id>.tasks.local.json` | The task list | No, same glob |
| `evals/targets/<id>.local/gates/<task>/…` | Held-out test files written for each task | No, **new `.gitignore` line** |

The target file gains optional fields. `parseTargetFile` keeps rejecting
anything malformed, and the additions are optional, so today's
`devnexus.local.json` still parses:

```ts
// evals/types.ts — additions
export interface TargetDeps {
  /** argv run once in the dependency cache, e.g. ["pnpm","install","--frozen-lockfile","--filter","@devnexus/shared..."]. */
  readonly install: readonly string[];
  /** Repo-relative node_modules dirs symlinked from the cache into each workspace. */
  readonly link: readonly string[];
}

export interface AgentTask {
  readonly id: string;
  /** Chunk the session resumes at; passed as `init --chunk`. */
  readonly chunk: number;
  /** The plan's own task line, verbatim. Identical across arms. */
  readonly task: string;
  /** Files deleted before `init`; their content is the ground truth. */
  readonly removeFiles: readonly string[];
  readonly gate: {
    /** Repo-relative test files held out of the workspace (REQ-EVAL-21). Content comes from
     *  `<id>.local/gates/<task>/<path>` if present there, else from the pinned tree. */
    readonly files: readonly string[];
    readonly cwd: string;              // repo-relative, e.g. "packages/shared"
    readonly argv: readonly string[];  // e.g. ["node_modules/.bin/vitest","run"]
    readonly timeoutMs: number;
  };
}

// EvalTarget gains: sha?: string; deps?: TargetDeps; deny?: readonly string[]
```

**Reproducibility comes from the pin, not from committing the target.**

- **Workspace from the pin.** With `sha` set, `prepareWorkspace` builds the
  workspace with `git -C <sourceDir> archive <sha> | tar -x`. That reads the
  object database and writes nothing to the source (REQ-EVAL-19 keeps
  REQ-EVAL-13's guarantee). Untracked build output and uncommitted edits don't
  exist in the workspace, which closes Problem §3 at its cause (REQ-EVAL-20).
  A real target without `sha` is refused in `calibrate` and `measure`, and
  allowed in `check`.
- **Dependencies installed once.** `deps.install` runs once into
  `evals/.cache/targets/<id>-<sha>/`. The cache is keyed by sha plus lockfile
  hash, and each workspace symlinks `deps.link` from it. This is
  `ensureFixtureDeps`/`linkDeps` (`fixture-deps.ts:37`, `:90`) generalised
  from "npm, root only" to the target's own package manager. The `link:`
  dependencies stay the target author's problem, solved by scoping the
  install to the gated package.
- **Paths the agent can't read.** `deny` adds prefixes to the agent's denied
  list (`cold-agent.ts:28`). DevNexus tracks `.agents/` and `.claude/` skill
  files. Both arms see them equally, so they aren't a confound, but they are
  free orientation material that pushes control towards the ceiling.

The agent tier's `runArm` (`run-agent.ts:69`) changes in three places. It
calls `init --chunk <task.chunk>` (the flag exists, `init.ts:68-69`). It
replaces the `snapshotTree(ws, "tests")` / `restoreTree` pair with the
withhold-then-plant gate below. And it calls `runGate` (`verification.ts:76`,
exported) with the task's `cwd`/`argv` instead of `verifyWorkspace`'s fixed
pair.

### The gate: held out, then planted

The fixture's gate was visible, and agents rewrote it (7 of 8 control runs,
`EVAL_REPORT.md:147`). A held-out gate fixes both problems at once:

1. `prepareWorkspace` deletes `removeFiles` **and** `gate.files`.
2. The agent runs. Any `write_file` to a gate path is recorded in the trace.
3. The harness writes the gate files into place, overwriting whatever the agent
   wrote there, and records each one it overwrote as tampering (REQ-EVAL-21).
4. `runGate`. Pass means exit 0 within `timeoutMs`.

Withholding the tests is also what moves the task off the ceiling. The
contract now has to come from the code, its conventions and the plan, and
that is what the prompt claims to supply. It is the "plan text is genuinely
underspecified" lever of RIGOUR §1 (`RIGOUR.md:53`), and it costs both arms
the same.

**Hand-written gate tests don't break "assert against real generator
output".** They are ground truth about the target's behaviour, not about the
generator. The generator's output is what gets scored. They are held to two
checks that cost nothing and run before any money is spent:

- **Oracle** (REQ-EVAL-22): the pinned tree, nothing removed, gate planted.
  It must pass. A gate that fails on the real code is a wrong gate.
- **Null** (REQ-EVAL-23): files removed, no agent, gate planted. It must fail.
  A gate that passes without the code tests nothing.

Plus the sibling check (REQ-EVAL-24), which stops the `.d.ts` leak even when a
target is run unpinned in `check` mode.

These three are also the harness's own end-to-end test. `--mode check`
exercises workspace, deps, init, withholding, planting and the gate on a real
target with a scripted "agent" that either restores the ground truth or does
nothing. No key, about a minute.

### The trace (REQ-EVAL-28..31)

`ColdAgentRun` gains one field, and keeps `filesRead`/`filesWritten` for the
existing report shape:

```ts
export interface ToolEvent {
  readonly turn: number;
  readonly tool: "list_files" | "read_file" | "write_file" | string;
  readonly path: string | null;
  readonly ok: boolean;
}
// ColdAgentRun.events: readonly ToolEvent[]
// ColdAgentRun.usage: { input: number; cacheWrite: number; cacheRead: number; output: number }
```

The events are recorded in the loop at `cold-agent.ts:190-219`, on both the
success and the catch path. Every metric is then a pure function over
`events` plus strings already on disk:

```ts
// evals/checks/behaviour.ts
export function turnsToFirstWrite(events: readonly ToolEvent[]): number | null;
export function readsBeforeFirstWrite(events: readonly ToolEvent[]): string[];
export function offListReads(events, promptDeclared: readonly string[], expected: readonly string[]): string[];
export function doNotReadPatterns(prompt: string): string[];   // parses the `Do NOT read:` line
export function doNotReadViolations(events, patterns: readonly string[]): string[]; // path.matchesGlob
```

**Both arms are measured against the same prompt.** `init` runs in both arms
(`run-agent.ts:79-80`) and only bootstrap is *shown* the result. So "off-list"
and "Do NOT read" mean the same thing for control. Control is the baseline for
how much an uninformed agent strays. `promptDeclared` reuses
`declaredFromPrompt` (`grounding.ts:41`). `expected` is the target's existing
`expectedFiles[task.chunk]`, written from the plan's own `### Key Files`
(LLD-eval-harness.md, "Declared files").

RIGOUR's "redundant reads" (files the prompt already described) is dropped as
mis-specified for this product. The prompt carries references, not source
(HLD, "Code units"), so reading a file the prompt names is the intended use,
not waste. Its mechanism question is answered instead by the share of reads
that were prompt-named, reported per arm.

Each run record also stores the generated prompt's SHA-256. If repeats of the
bootstrap arm ever see different prompts, the generator is non-deterministic.
That would add variance to every result, and the record makes it visible
(RIGOUR §6, output determinism) at no cost.

### Tokens and dollars (REQ-EVAL-32, -33)

`usage.input` sums `input_tokens + cache_creation_input_tokens +
cache_read_input_tokens`. That is the context the agent consumed, whatever
was billed for it. Cost is computed separately from a `PRICES` table in
`evals/harness/prices.ts`, keyed by model and dated. The `claude-opus-5` rates
used below are $5 input, $25 output, $6.25 cache write and $0.50 cache read
per MTok. The table is copied by hand and dated because the evals tree has no
other price source. A stale table would misstate dollars, but it can't touch
the primary endpoint.

Automatic prompt caching (`cache_control: { type: "ephemeral" }` on each
`messages.create` at `cold-agent.ts:171`) roughly halves the cost of a run
(see *Cost*). Caching doesn't change what the model sees, so it is not a
change to the subject. REQ-EVAL-32 is what makes switching it on safe.

### Calibration (RIGOUR step 4)

`--mode calibrate` runs control only, **5 repeats per candidate task**
(`RIGOUR.md:55`). A task is admitted when control passes **1–4 of 5**, and
retired at 0/5 (floor) or 5/5 (ceiling).

RIGOUR asks for a 40–60% band. With 5 draws the only results inside it are 2/5
and 3/5. A 95% interval on 2/5 runs from about 5% to 85%, so a 5-run
calibration can't place a task inside 40–60%. It can only reject the floor and
the ceiling. A tighter band would mean 10+ calibration repeats per task,
nearly doubling calibration cost to buy a precision the measurement doesn't
need. The band is a pre-registered parameter, and this is the default.

**Calibration runs are thrown away** (REQ-EVAL-36). Tasks are chosen *because*
their control runs landed mid-band. Reusing those runs would pull the control
estimate towards 50% by selection (regression to the mean). Measurement draws
fresh runs.

**Memorisation probe** (REQ-EVAL-35, RIGOUR §7 "Watch for contamination").
DevNexus has a GitHub remote. Before calibrating a task, one no-tool call
asks the model to write the removed file given only its path and the task
line. Similarity to the ground truth is a normalised token-level LCS ratio, a
pure function in `evals/stats/similarity.ts`. Above the threshold (default
**0.6**) the task is burned and retired. One call per task, cents in total.

### Measurement and the statistics (RIGOUR step 5)

`--mode measure` runs **T admitted tasks × R repeats × 2 arms**. The run order
is shuffled from the pre-registered seed (REQ-EVAL-37), so model drift over a
multi-hour run can't line up with one arm. Today's loop runs bootstrap
strictly before control (`run-agent.ts:181`). Runs are independent
workspaces, so `--concurrency N` is safe. It changes wall-clock time, not
results.

A run that hits `MAX_TURNS` (`cold-agent.ts:25`) or dies on an API error
counts as a gate failure (REQ-EVAL-38). Leaving it out would bias the arm
that flounders more towards looking better (survivorship). The counts are
reported so a lopsided failure rate is visible.

All arithmetic lives in `evals/stats/`. These are pure functions with a seeded
generator, unit-tested on known inputs in the evals project:

```ts
// evals/stats/random.ts
export function mulberry32(seed: number): () => number;

// evals/stats/paired.ts
export interface TaskOutcomes {
  readonly task: string;
  readonly bootstrap: readonly boolean[];        // gate pass per repeat
  readonly control: readonly boolean[];
  readonly bootstrapTokens: readonly number[];   // REQ-EVAL-32 figure per repeat
  readonly controlTokens: readonly number[];
}
export interface Interval { readonly estimate: number; readonly lo: number; readonly hi: number }

/** Mean over tasks of (pass-rate bootstrap − pass-rate control). REQ-EVAL-39. */
export function passRateDifference(tasks: readonly TaskOutcomes[]): number;
/** Two-level resample: tasks with replacement, then repeats within each task and arm. */
export function hierarchicalBootstrap(
  tasks: readonly TaskOutcomes[],
  statistic: (t: readonly TaskOutcomes[]) => number,
  opts: { draws: number; seed: number; level: number },
): Interval;
/** exp(mean over tasks of (mean log b − mean log c)). REQ-EVAL-41. */
export function geometricMeanRatio(tasks: readonly TaskOutcomes[]): number;
/** Exact two-sided; ties count for neither side. REQ-EVAL-40. */
export function signTest(wins: number, losses: number): number;
/** Exact two-sided by enumeration (n ≤ 20); zeros dropped, tied ranks averaged. */
export function wilcoxonSignedRank(diffs: readonly number[]): { readonly w: number; readonly p: number };
/** REQ-EVAL-42. */
export function varianceSplit(groups: readonly (readonly number[])[]): { readonly within: number; readonly between: number };

// evals/stats/verdict.ts — REQ-EVAL-43
export type Verdict = "better" | "worse" | "no-meaningful-effect" | "inconclusive";
export function classify(primary: Interval, rule: PreRegistration["rule"]): Verdict;
```

**Why the task is the unit, not the run.** Repeats within a task are
correlated: the same file, the same difficulty. Treating 30 runs as 30
independent draws would overstate precision. The hierarchical bootstrap
resamples tasks first, so between-task variation widens the interval as it
should. With only 4–8 tasks that interval is itself rough. That is why the
exact sign test over tasks (REQ-EVAL-40) sits next to it as a companion
assuming nothing about distributions. If the two disagree, the result is
reported as fragile.

**Why log-differences for tokens.** RIGOUR §2. A ratio of noisy positive
numbers is heavy-tailed. Per-task mean log-differences are symmetric. Their
mean exponentiates back to a geometric-mean ratio, and that ratio takes a real
interval.

### Pre-registration: what counts as "does better", decided now

The run is fixed in a committed file *before* `--mode measure`:
`evals/preregistration/<run-id>.json`, plus a prose note of the hypothesis in
the same commit. The commit hash is the timestamp (RIGOUR, "Rules").

```ts
export interface PreRegistration {
  readonly runId: string;
  readonly hypothesis: string;          // one sentence
  readonly primaryEndpoint: "gate-pass-difference";
  readonly tasksSha256: string;         // hash of <id>.tasks.local.json — fixes the task set without revealing it
  readonly targetSha: string;           // the pinned commit
  readonly model: string;               // "claude-opus-5"
  readonly cliVersion: string;          // or "local@<git sha>"
  readonly repeats: number;             // R
  readonly seed: number;
  readonly calibrationBand: readonly [number, number]; // [1, 4] of 5
  readonly memorisationThreshold: number;               // 0.6
  readonly rule: {
    readonly level: 0.95;
    readonly sesoi: number;             // smallest effect of interest, default 0.15
  };
}
```

`tasksSha256` lets a private task set be pre-registered publicly. Anyone can
later check that the analysed tasks are the registered ones by hashing the
file, and the file's content never enters the tree. The harness checks the
hash and every other field against the live run, and refuses on any mismatch
(REQ-EVAL-44).

**The decision rule**, for Δ = task-mean pass-rate difference (bootstrap −
control) and its 95% interval [lo, hi]:

| Verdict | Condition | What it licenses saying |
|---|---|---|
| `better` | lo > 0 | "On this target, the context raised the task pass rate by Δ (95% CI lo–hi)." |
| `worse` | hi < 0 | The same, reversed. A real finding, not a failed experiment. |
| `no-meaningful-effect` | lo > −sesoi and hi < +sesoi | "Any effect is smaller than ±sesoi." |
| `inconclusive` | otherwise | "This run can't tell. The interval includes 0 and an effect as large as hi." |

**Exactly one primary endpoint.** Everything else is secondary and labelled
exploratory in the report: tokens, turns, the behavioural metrics, tampering
and cost. A `better` on tokens with an `inconclusive` primary is reported as
exactly that. It is the existing efficiency finding repeated on a real
target, not a correctness claim.

**What this design can and can't show, stated before the data.** Assume
control at about 50%, no between-task variation, and n = T × R runs per arm.
The interval's half-width is then roughly 1.96·√(2·0.25/n):

| T × R per arm | Half-width | Smallest Δ that reads `better` | Can it show `no-meaningful-effect` at sesoi 0.15? |
|---|---|---|---|
| 30 (6 × 5) | ±0.25 | ~+0.25 | Only if Δ ≈ 0 and variance is low. Unlikely |
| 50 (5 × 10, or 10 × 5) | ±0.20 | ~+0.20 | Marginal |
| 100 (10 × 10) | ±0.14 | ~+0.14 | Yes, if Δ ≈ 0 |

Between-task variation only widens these. **At the recommended size (6 × 5)
the run can detect a large effect, about 25 points or more, or come back
inconclusive. It cannot establish absence.** That limit is the honest price of
a run costing under $200. If the result is `inconclusive`, the follow-up is
more repeats on the same registered tasks under a new run id, not a new
analysis of the old one.

**A `better` shows the context mattered, not which part.** Two arms can't
separate "a correct file list" from "any file list". That separation is the
`shuffled` arm of RIGOUR §3, deferred below. If the primary reads `better`,
`shuffled` is the first follow-up, and until then the report says the effect
is of the generated context as a whole.

### The judge stays off

The pairwise judge has never been checked against human labels (RIGOUR §4,
step 6). By RIGOUR's own rule it is a diagnostic until κ ≥ 0.6
(`RIGOUR.md:324-325`). The primary endpoint is a test exit code, which needs
no judge. With `--target` the judge is off unless `--judge` is passed
(REQ-EVAL-45). That saves its cost: `compareArms` runs each dimension in both
orderings plus two absolute scores per task (`run-agent.ts:202-210`). It also
keeps an uncalibrated number out of a report about a real repository.

### Cost

Measured per run on the fixture (`report/agent-2.2.1-run3-pairwise.json`):
6–10 turns, 19k–63k input tokens, 1.7k–9k output tokens. DevNexus is larger.
`list_files` alone returns about 200 tracked paths, and that result is resent
every turn after it is called. A planning figure, to be replaced by the first
real run's records:

| Per run | Uncached | Cached (automatic caching) |
|---|---|---|
| Assumed | ~15 turns · ~300k input · ~15k output | same tokens, ~88% of input read from cache |
| `claude-opus-5` cost | 300k × $5 + 15k × $25 ≈ **$1.90** | ~$0.22 writes + ~$0.13 reads + $0.38 output ≈ **$0.75** |
| Worst case (24-turn cap, ~80k avg context) | ≈ $10 | ≈ $3 |

| Phase | Runs | Uncached | Cached | Wall-clock, sequential |
|---|---|---|---|---|
| `check` (oracle, null, siblings) | — | $0 | $0 | ~1 min |
| Memorisation probe, 8 candidate tasks | 8 calls | < $0.50 | < $0.50 | ~2 min |
| Calibration, 8 tasks × 5, control only | 40 | ~$76 | ~$30 | ~6–7 h |
| Measurement, 6 admitted × 5 × 2 | 60 | ~$114 | ~$45 | ~9–10 h |
| **Full run** | **100** | **~$190** (range $100–$500) | **~$75** (range $40–$250) | **~15–17 h**; ~4–5 h at `--concurrency 4` |

Time assumes about 30–40 s per high-effort turn, plus about 30 s of gate per
run. Concurrency is bounded by the account's rate limits, not by the harness.

**The knobs, roughly in order of effect on cost:**

- **Repeats R.** Linear in measurement cost. It is also the main lever on
  interval width (√R).
- **Candidate tasks.** Linear in calibration cost. Write about 1.5× the tasks
  you want admitted. Expect about half to land in band.
- **Prompt caching.** About −60% with no change to the subject (REQ-EVAL-32
  keeps the token metric honest).
- **Model.** `claude-opus-5` is the subject today (`cold-agent.ts:22`) and was
  for every published number. `claude-opus-5-5` is $4/$20 (−20%), but it is a
  different subject, and its effort default differs, so `effort` must stay
  pinned (`cold-agent.ts:175` already sets `high`). Changing it breaks
  comparability with `EVAL_REPORT.md`.
- **Turn cap** (`MAX_TURNS = 24`). Bounds the worst case. Lowering it also
  turns more runs into failures (REQ-EVAL-38), so it is pre-registered.
- **Concurrency.** Wall-clock only.

---

## Which RIGOUR steps are in, and why

| Step (`RIGOUR.md:356-365`) | Here? | Why |
|---|---|---|
| 1. Harness tests, CI | Done | REQ-EVAL-1..18 |
| 2. Provenance, adversarial corpus | Provenance done; corpus not | The corpus is REQ-EVAL-6. Separate, and deltas are listed below |
| 3. Behavioural metrics | **In, a subset** | Turns-to-first-write, reads before it, off-list reads, Do-NOT-read violations. They need the trace (Problem §4) and are free once it exists. "Redundant reads" is replaced (see *The trace*). "Recovery from bad context" is an arm, so it is deferred with step 7 |
| 4. Calibrate difficulty | **In, on the real target** | It is the whole fix for the ceiling. Done on DevNexus rather than `medium-ts-monorepo`, because the question is about a real target. The fixture is also published (contamination, `RIGOUR.md:194-197`), tidy, and has no real history |
| 5. Repeats, log-differences, bootstrap CIs | **In** | Without it, any result is a direction, not an effect size |
| 6. Judge calibration | Out | The primary endpoint doesn't need a judge. 30 human labels is a person-day, not code |
| 7. Dose-response arms | Out, first follow-up | Doubles or triples cost. Only worth paying for once the two-arm result says there is an effect to explain |
| 8. Longitudinal chains | Out | A different claim (drift over sessions), with a different harness shape (chained workspaces) |

---

## REQ-EVAL-6: deltas against current code

The adversarial-corpus design (LLD-eval-harness.md, "The adversarial corpus")
was written before LLD-context-provenance.md landed. It still holds in
outline: `AdversarialCase`, `String.includes`, no key, attribution rather than
absence. What has changed since:

1. **The seeds no longer fail.** "The two confirmed cases … fail today"
   (LLD-eval-harness.md:209-211) is stale. Both are fixed and locked, and so
   are two more paths found during the build: plain doc-comment summaries
   (REQ-PROV-8) and string-literal unit ids (REQ-PROV-9). Their inputs already
   exist as `tests/fixtures/provenance/` (`CLAUDE.md`, `src/annotated.ts`,
   `src/plain-doc.ts`, `src/routes.ts`) and are tested by
   `tests/provenance.integration.test.ts` and
   `tests/e2e/provenance.e2e.test.ts`. The corpus should **plant from that
   fixture** rather than copy its strings, so the injection rows are four
   regression rows over one source. The untested classes are what the corpus
   adds.
2. **"Attributed form" is now concrete, and a naive `includes` would get it
   wrong.** Quoting is JSON string escaping (`quoteText`,
   `formatter-utils.ts:233-235`), notes read `Quoted from <file> § "<h>":
   "<text>"` (`formatQuotedNote`, `:279`), and summaries carry `quoted:`
   (`QUOTED_LABEL`, `:218`). A marker containing `"`, `\` or a newline appears
   escaped, so `includes(marker)` misses the attributed copy. Notes are also
   capped at 240 characters with an ellipsis (`MAX_NOTE_CHARS`, `:215`), so a
   long marker appears only in part. The corpus needs **short markers made of
   one distinctive token, with no quote, backslash or newline**. Each
   occurrence is checked as lying inside a `Quoted from …: "…"` span or after
   `quoted:`. Since `evals/` can't import `packages/`, the matcher restates
   the two shapes, and a unit test pins them against real generator output
   captured from the provenance fixture.
3. **Which files to scan has to be stated.** `ai-index.yaml` deliberately
   keeps doc comments as written. Summaries are quoted at render time, not in
   the data file (LLD-context-provenance.md, Design table). So a scan of
   "the generated files" would flag correct behaviour. Scan agent-facing
   output only: `NEXT_PROMPT.md`, the adapter file, and notes in
   `SESSION_STATE.md`, which are quoted at write time. Not `ai-index.yaml`.
4. **Path 2's agent-facing surface isn't a file.** It is the MCP
   `read_file_layer` response. A file scan can't reach it. Either the
   corpus drives `mcp` over stdio (more harness), or it leaves that path to
   the existing integration test and says so. Recommendation: the latter,
   recorded as a known gap.
5. **Exhaustion now has a defined expected result.** `MAX_PROMPT_CHARS`
   (12,000, REQ-PROV-5) makes the writer refuse over-cap content with a
   `CliError` (REQ-PROV-6). An exhaustion case can assert "exits non-zero with
   the character-cap message, within N seconds" instead of "doesn't hang".
6. **The test level is the evals tier, not `tests/`.** The design's test plan
   says "integration" (LLD-eval-harness.md:241). The corpus drives the
   published CLI, so it belongs to `pnpm eval`. Its failures must join the
   `failures` filter at `run.ts:306-313` to honour REQ-EVAL-7. The attribution
   matcher is a unit test in `evals/__tests__/`.

None of this changes REQ-EVAL-6's wording.

---

## Test plan

Everything below except the last two rows runs in the `evals` vitest project
(`vitest.config.ts:37-43`) with no key and no network. Statistics are tested
on inputs whose answers are known in closed form. The paid run is not a test.
It is the measurement.

| Requirement | Level | Test |
|---|---|---|
| REQ-EVAL-19 | unit + eval | `parseTargetFile` / `parseTasksFile` reject a task with no gate, a non-relative path, or a duplicate id. `--mode check --target` on DevNexus leaves its tree byte-identical (`git status --porcelain` and an mtime scan before and after) |
| REQ-EVAL-20 | unit | A temp git repo with an untracked `X.d.ts` and a dirty tracked file: the workspace from `sha` has neither, and has the committed content |
| REQ-EVAL-21 | unit | Gate paths absent while a scripted agent "runs". After planting, they equal the held-out content. A scripted write to a gate path is reported as tampering and overwritten |
| REQ-EVAL-22 | unit | A gate that fails on the unablated tree yields `invalid: oracle`, and the agent stub is never called |
| REQ-EVAL-23 | unit | A gate that passes with files removed yields `invalid: null` |
| REQ-EVAL-24 | unit | Removing `a/X.ts` with `a/X.d.ts` present yields `invalid: sibling a/X.d.ts`. `a/X.test.ts` is not a sibling |
| REQ-EVAL-25 | unit | The agent tier's default version equals `packages/cli/package.json`'s, reusing `readDefaultVersion` |
| REQ-EVAL-26 | eval | `--mode check --local` reports the installed version as `local` |
| REQ-EVAL-27 | unit | The report path for a target run is under `evals/report/local/` |
| REQ-EVAL-28 | unit | A scripted message sequence (stubbed client, the seam REQ-EVAL-1 introduced) with a read, a refused read of `.session/x` and a write yields three events in order with the right `ok` |
| REQ-EVAL-29 | unit | Events `[list, read a, read b, write c, read d]` → 1 turn before the first write (per turn numbering), reads `[a, b]`. No write → `null` |
| REQ-EVAL-30 | unit | Prompt captured from a real `init` on `simple-node-app`, plus `expected`. A read outside both is reported, one inside either is not |
| REQ-EVAL-31 | unit | `doNotReadPatterns` on prompt text *captured from the claude formatter's real output*, not typed by hand. A refused read matching a pattern counts |
| REQ-EVAL-32 | unit | A usage of `{input 100, cache_creation 50, cache_read 850}` sums to 1,000 |
| REQ-EVAL-33 | unit | Known usage × the `PRICES` row equals the hand-computed dollar figure. An unknown model throws |
| REQ-EVAL-34 | unit | Control results `[5/5, 0/5, 2/5, 4/5]` under band [1, 4] → retired, retired, admitted, admitted |
| REQ-EVAL-35 | unit | LCS similarity: identical → 1, disjoint → 0, a known pair → the hand-computed ratio. Above threshold → retired |
| REQ-EVAL-36 | unit | `analyse` given calibration and measurement records uses measurement only (record `phase` field) |
| REQ-EVAL-37 | unit | The schedule has T × R × 2 entries, each (task, arm) exactly R times. Same seed gives the same order, a different seed a different one |
| REQ-EVAL-38 | unit | A `max_turns` run and an `api_error` run count as failures and appear in the per-arm counts |
| REQ-EVAL-39 | unit | Arms identical on every task → estimate 0, interval [0, 0]. Bootstrap all-pass and control all-fail → 1, [1, 1]. Same seed → byte-identical interval. A seeded simulation with true Δ = 0.3 lands it inside the interval in ≥ 90% of 200 replications (marked slow) |
| REQ-EVAL-40 | unit | `signTest(8, 0)` = 0.0078125 (two-sided; the report's 0.0039 is the one-sided value). `signTest(3, 3)` = 1. Ties excluded |
| REQ-EVAL-41 | unit | Every task's bootstrap tokens exactly half its control → ratio 0.5. `wilcoxonSignedRank` of six positive diffs → p = 0.03125, of eight → 0.0078125. Zeros dropped, tied ranks averaged (a published small-n table value) |
| REQ-EVAL-42 | unit | Groups `[[1, 1], [3, 3]]` → within 0, between > 0. `[[1, 3], [1, 3]]` → between 0 |
| REQ-EVAL-43 | unit | Intervals `[0.05, 0.4]` → better, `[-0.4, -0.05]` → worse, `[-0.1, 0.1]` with sesoi 0.15 → no-meaningful-effect, `[-0.1, 0.4]` → inconclusive. Boundary values follow the strict inequalities in the table |
| REQ-EVAL-44 | unit | A pre-registration whose `tasksSha256` or `repeats` differs from the run → refusal naming the field |
| REQ-EVAL-45 | unit | With `--target` and no `--judge` the judge stub is never called |
| — | eval (paid, manual) | `--mode calibrate`, then a committed pre-registration, then `--mode measure --tag <run-id>`. Results go into `EVAL_REPORT.md` as aggregate numbers only, without target file names |

**Watch it fail first.** These are the ones that matter most:

- REQ-EVAL-39: flip the sign in `passRateDifference` and the all-pass test
  must go red.
- REQ-EVAL-40: halve the p-value and the 0.0078 test must go red.
- REQ-EVAL-20: point the workspace back at `copyTree` and the untracked-`.d.ts`
  test must go red. That is Problem §3 reproduced.

---

## Out of scope

- **Dose-response arms** (`degraded-25/50`, `shuffled`). The first follow-up,
  and only if the primary is `better`.
- **Judge calibration** and any judged dimension in a target run.
- **Longitudinal chains**, recovery-from-bad-context, and adapters other than
  `claude` (`run-agent.ts:80` hard-codes it).
- **A second real target.** One target answers "on this target". A
  generalisation claim needs more, and the task-file shape here is what makes
  adding one cheap.
- **`medium-ts-monorepo`.** Superseded for this question by the real target.
  It remains the cheapest independent synthetic sample if one is ever wanted.
- **Running any paid mode in CI.** Unchanged from LLD-eval-harness.md: it costs
  money and its variance is wider than the effects it measures. `--mode check`
  on built-in targets *could* gate CI. Whether it should is left until it has
  run a few times.
- **Publishing a private target's files.** Reports with paths stay in
  `report/local/`. The public record is the pre-registration (with the task
  hash) and aggregate numbers.
- **The REQ-EVAL-6 corpus itself.** Deltas only, above.
