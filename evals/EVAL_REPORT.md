# Measuring dev-sesssion

An eval harness for the published CLI — what it measures, what four rounds of
measurement established, and what had to be retracted along the way.

| | |
|---|---|
| **Under test** | dev-sesssion 2.2.0 & 2.2.1 |
| **Measured pairs** | 8 |
| **Targets** | 1 (`tests/fixtures/simple-node-app`) |
| **Last updated** | 2026-08-24 |

Raw data for every claim below is in `evals/report/`.

---

## Where this stands

The harness works and has already paid for itself in shipped bug fixes. The
product looks directionally good on the claim it actually makes — leaner
sessions — but no quantitative version of that claim survives contact with the
noise floor yet.

| Status | Claim |
|---|---|
| **Established** | The generated context contains no invented file paths. 17/17 declared paths grounded, across every run. |
| **Established** | The bootstrapped agent used fewer or equal turns *and* tokens in **8 of 8** pairs. |
| **Directional** | Median token saving ≈ 23%. Spread runs 0–52%, and run-to-run noise on identical inputs spans −30% to +45%. |
| **Directional** | Where the judge returned an order-stable verdict, the bootstrapped arm won 2 of 2. Both margins "slight". |
| **Retracted** | *"The bootstrap arm uses half the input tokens."* Three early runs agreed at 0.48; a repeat run returned 1.00. |
| **Not shown** | That the tool improves correctness. All 16 arm-runs passed the project's tests, with or without context. |

---

## What is measured, and why

The harness installs a pinned version from npm into a throwaway prefix and
drives that binary — not the workspace build. Packaging defects only reproduce
against the artifact users actually install.

| Signal | What it is | Why measured this way |
|---|---|---|
| **Path grounding** | Every path the generated context names must exist on disk. | Inventing paths is the worst real-world failure for a context generator, and it needs no model to detect. Deterministic and free, so it runs first. |
| **Duplicate refs** | Paths the capped load list names more than once. | The list is capped, so a duplicate *evicts a real file* rather than just looking untidy. This is how the 2.2.1 fix was found. |
| **Replay recall / precision / waste** | Read from `verify --replay --json`. | The CLI already computes these from git with no API key. Ground truth, so every judged score is anchored to something that isn't an opinion. |
| **Turns · files read · input tokens** | Cost for a cold agent to complete an ablated task. | The product claims lean, self-resuming sessions. This is that claim, stated as a number. |
| **Tests pass** | The project's own suite, after restoring it. | The only fully objective correctness gate. Restored first because the agent can otherwise edit the tests grading it — and did, in 7 of 8 control runs. |
| **New type errors** | Diagnostics absent from an unablated baseline. | Measured relative, not absolute: the fixture ships with a pre-existing error and real repos will too. |
| **Pairwise verdict** | Blinded forced choice between the arms, run in both orderings. | Absolute 1–5 scoring could not resolve the arms at all. Comparison is an easier judgement than placement; the order swap catches position bias. |

**The design that makes any of it meaningful:** every ablation runs two arms —
one shown the generated context, one shown nothing — and both are blocked from
reading `.session/`. Without the control arm, a score measures how well Claude
writes Express middleware, not whether the tool helped.

---

## How it got here

Four rounds. In three of them the measurement was wrong before the product was,
which is the main reason to trust round four at all.

### 1. Scope the judge down
- **Believed:** an LLM judge should evaluate the CLI end to end.
- **Measured:** 1,279 existing tests already cover the mechanical layer; path
  grounding is an `fs.existsSync` loop.
- **Revised:** the judge only gets what assertions genuinely cannot reach.

### 2. Deterministic tier — four real bugs, first run
- **Measured:** a duplicate `CLAUDE.md` burning a slot in the six-item load
  list; a "15 lines" instruction contradicting the enforced 20; a dead
  `anthropics/` repo URL in every generated file; a fixture that never
  typechecked.
- **Result:** the dedupe fix shipped in 2.2.1 and was verified against the
  published artifact. Root cause was five private copies of one merge — the same
  shape as a prior bug in this repo.

### 3. Cold-agent tier — the harness was the problem
- **Believed:** the first scores were meaningful.
- **Measured:** three defects, all in the harness. The fixture's plan said "JWT"
  while its reference implementation wasn't; the judge saw one file and marked a
  module the agent had itself created as fabricated; the agent could edit the
  tests grading it.
- **Revised:** test tree snapshotted and restored; judge given every file the
  agent wrote; task text aligned to what is actually discoverable.

### 4. The 2× claim, and the repeat run that killed it
- **Believed:** bootstrap uses half the tokens — three pairs at 0.49, 0.48, 0.48.
- **Measured:** an identical repeat, nothing changed but randomness, returned
  1.00 and 0.95. Same-config token noise: −30% to +45%.
- **Revised:** magnitude retracted. The tight cluster was three draws that
  happened to agree. Direction survives; the number does not.

### 5. The judge could not tell the arms apart
- **Measured:** absolute scoring returned *identical* per-dimension scores for
  both arms, run after run, parking mid-scale. That reads as "no difference" but
  is really an instrument with no resolution.
- **Revised:** rebuilt as a blinded pairwise forced choice, run in both
  orderings, with a flipped verdict reported as a tie rather than a result.

### 6. Position bias, caught in both directions
- **Measured:** on one dimension the judge picked whichever candidate was shown
  *first*, both times. On another it picked whichever was shown *second*, both
  times.
- **Result:** either, run in a single ordering, would have produced a confident
  false finding. Four of six comparisons failed the swap and were correctly
  reported as ties.

---

## The numbers

### Efficiency — every measured pair

| Run | Ablation | Turns b/c | Input tokens b/c | Ratio |
|---|---|---|---|---|
| 2.2.0 | auth | 6 / 11 | 35,776 / 72,332 | 0.49 |
| 2.2.0 | body | 5 / 9 | 15,548 / 32,574 | 0.48 |
| 2.2.1 r1 | auth | 7 / 10 | 25,416 / 53,030 | 0.48 |
| 2.2.1 r1 | body | 6 / 8 | 23,586 / 28,277 | 0.83 |
| 2.2.1 r2 | auth | 8 / 9 | 36,880 / 36,972 | **1.00** |
| 2.2.1 r2 | body | 6 / 7 | 22,456 / 23,569 | 0.95 |
| 2.2.1 r3 | auth | 9 / 10 | 53,448 / 62,888 | 0.85 |
| 2.2.1 r3 | body | 6 / 8 | 19,177 / 27,106 | 0.71 |

`b` = bootstrap arm, `c` = control. Ratio = bootstrap tokens ÷ control tokens.
mean 0.72 · median 0.77 · range 0.48–1.00 · bootstrap ≤ control in 8/8 on both
turns and tokens.

### Pairwise quality — run 3, blinded and order-swapped

| Ablation | Dimension | Raw (ordering 1, 2) | Verdict |
|---|---|---|---|
| auth | `convention_match` | bootstrap, bootstrap | **bootstrap** · slight |
| body | `no_fabrication` | bootstrap, bootstrap | **bootstrap** · slight |
| auth | `contract_satisfaction` | bootstrap, control | unstable → tie *(picked first, twice)* |
| auth | `no_fabrication` | bootstrap, tie | unstable → tie |
| body | `contract_satisfaction` | control, tie | unstable → tie |
| body | `convention_match` | control, bootstrap | unstable → tie *(picked second, twice)* |

2 of 6 order-stable. Both went to the bootstrapped arm; control won none.

### The behavioural split nobody designed for

Test-file tampering was added as an integrity guard, not a metric. It turned
into the sharpest categorical result in the dataset: **the control arm rewrote
or added to the tests grading it in 7 of 8 runs. The bootstrapped arm did so in
0 of 8.** An agent without context reaches for the test file; an agent handed
context does not.

---

## Is the product going the right way?

Qualified yes — on the claim it makes, not the claim it might be assumed to make.

**Points in favour**

- The core correctness property holds: **zero hallucinated paths**, and deleted
  files correctly vanish from regenerated context.
- Direction on efficiency is **8/8** across both metrics. Under a coin-flip null
  that is p ≈ 0.004.
- Both order-stable quality verdicts favoured the bootstrapped arm; none
  favoured control.
- Context appears to change agent *behaviour*, not just cost — the 7/8 vs 0/8
  tampering split is hard to explain otherwise.
- The tool is measurable at all. Its own `verify --replay` supplies ground truth
  without an API key, which most tools in this category cannot do.

**Points against, and unknowns**

- **Correctness is unchanged.** All 16 arm-runs passed the tests. The tool
  alters how much context is burned, not whether the work lands.
- Effect magnitude is unstable — 0% to 52% — and smaller than the noise on a
  single run.
- Quality margins are "slight" at best, and 4 of 6 comparisons were too close to
  call.
- One target, two ablations, one synthetic fixture. These are not independent
  samples.
- The fixtures contradict themselves — a plan saying "JWT" over an
  implementation that isn't, and code that never typechecked.

> **The honest one-liner:** dev-sesssion consistently gets a cold agent to the
> same result with less rummaging, and appears to keep it better-behaved. It
> does not make the agent more correct, and the size of the saving is not yet
> measured.

For a context-management tool, the first half is the product thesis and it is
holding up.

---

## What this cannot yet tell you

- **n** — one target and two ablations. Every pair draws from the same fixture,
  so the 8/8 result is directional evidence, not a measured effect size.
- **Power** — 4 of 6 pairwise comparisons were unstable. Real bootstrap and
  control outputs are close enough that the instrument often, honestly, cannot
  separate them.
- **Scope** — the `auth` ablation's contract requires `process.env.API_TOKEN`,
  which appears in no test, doc, or comment; it existed only in the deleted
  file. No amount of context can recover it, so that clause is unwinnable for
  both arms.
- **Realism** — fixtures are hand-written and tiny. Replay scoring gets sharply
  better on repositories with genuine git history.

---

## What would move this forward

1. **A second target.** `tests/fixtures/medium-ts-monorepo` already exists and is
   untouched — different shape, three packages. The cheapest route to genuinely
   independent samples.
2. **Repeats per cell.** Roughly 5–10 to turn the 8/8 direction into an effect
   size with an error bar.
3. **Narrow the `auth` contract** to clauses that are actually discoverable.
4. **A `--local` mode** that builds and packs the workspace, so a fix can be
   verified before it ships rather than needing a release round-trip.
5. **Real repositories at pinned SHAs.** Genuine commit history is what makes the
   replay metrics mean something.

---

## Running it

```bash
pnpm eval                      # deterministic tier — no API key, ~40s
pnpm eval:baseline             # probe a target's unablated baseline
pnpm eval:agent                # cold-agent + judge — needs ANTHROPIC_API_KEY

pnpm eval --version 2.2.1
pnpm eval:agent --version 2.2.1 --only body-validation --tag run4
```

`--tag` keeps repeat runs of the same version in separate reports. Repeating an
identical configuration is the only way to estimate run-to-run variance, without
which a version-to-version difference cannot be told from noise.
