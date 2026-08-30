# LLD — eval harness integrity

**Area:** `EVAL` — the measuring instrument itself: its own correctness, its
adversarial corpus, and running it automatically.

---

## Problem

`evals/` produces the numbers published in `evals/EVAL_REPORT.md`. It is the only
code in the repository that generates external claims, and it is the only code
with no tests at all.

**1. No test can currently reach it.** `vitest.config.ts` defines three projects,
and every `include` glob excludes `evals/`:

```ts
include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/__tests__/**/*.test.ts"]  // :9
include: ["tests/**/*.integration.test.ts"]                                            // :20
include: ["tests/**/*.e2e.test.ts"]                                                     // :29
```

A file written at `evals/checks/judge.test.ts` today is collected by no project
and runs in no command. The absence of tests is not an oversight anyone could
have fixed by writing one.

**2. The harness has been wrong more often than the product.** Three of the first
four measurement rounds found defects in the harness, not in `dev-sesssion`
(`EVAL_REPORT.md` §3, §4, §5). The failure mode is silent: a harness bug does not
crash, it produces a number.

The sharpest example is live. `compareOnce` maps a positional verdict back to an
arm at `judge.ts:182-183`:

```ts
const winner: Arm | "tie" =
  parsed.winner === "tie" ? "tie" : parsed.winner === "first" ? first.arm : second.arm;
```

`compareArms` then calls it twice with the arguments swapped
(`judge.ts:211-214`). Invert that ternary and every verdict in the report
reverses, the order-stability check still passes — because both orderings invert
together — and nothing in the repository would notice. The same class covers
`declaredFromPrompt`'s prefix and `+N more` handling (`grounding.ts:39-55`) and
`restoreTree`'s tamper detection (`workspace.ts:155`), where a missed comparison
silently under-reports the 7/8-vs-0/8 result.

**3. The deterministic tier runs only when someone remembers.** It needs no API
key, takes ~40s, and found four real bugs on its first run. `.github/workflows/ci.yml`
has no step that invokes it.

**4. Nothing measures whether the tool can be attacked.** Two prompt-injection
paths were confirmed by hand (`evals/RIGOUR.md`); the remaining classes — context
eviction, path traversal through a FILE_INDEX row, resource exhaustion, secret
laundering — are untested, and there is no fixture shape in which to test them.

---

## Requirements

**REQ-EVAL-1** — When a pairwise comparison returns a positional verdict, the
harness shall report the arm that produced the candidate in that position.

**REQ-EVAL-2** — When both orderings of a pairwise comparison disagree, the
harness shall report the dimension as unstable rather than as a winner.

**REQ-EVAL-3** — When a prompt names a file reference more than once, the harness
shall report that reference as duplicated.

**REQ-EVAL-4** — Where a load list ends in a truncation marker, the harness shall
not report the marker as a declared path.

**REQ-EVAL-5** — When a file under the gate directory differs from its
pre-run snapshot, the harness shall restore the original content and report the
path as tampered.

**REQ-EVAL-6** — Where an adversarial fixture places attacker-controlled text in
a repository file, the deterministic tier shall report whether that text appears
in the generated context.

**REQ-EVAL-7** — If any deterministic check fails, then the deterministic tier
shall exit non-zero.

**REQ-EVAL-8** — The deterministic tier shall complete every check it defines
without a model API key.

---

## Design

### Making `evals/` testable

`vitest.config.ts` gains a fourth project rather than widening an existing glob:

```ts
{
  test: {
    name: "evals",
    include: ["evals/**/*.test.ts"],
    exclude: ["evals/.cache/**"],
    environment: "node",
  },
}
```

The `exclude` is load-bearing: `evals/.cache/deps/` holds installed fixture
dependencies, and a bare `evals/**` glob collects several hundred `zod` tests
from `node_modules`. A `test:evals` script joins the existing per-project
scripts, and `pnpm test` picks the project up with no change.

Coverage attribution stays disjoint (`CLAUDE.md`): `evals/` is dev tooling, not
shipped code, and is excluded from the coverage `include` so it neither inflates
nor dilutes the 80/75 gate.

### What gets tested, and what does not

The harness splits cleanly into pure functions and I/O orchestration. Only the
first half is worth unit-testing, and it is where every known defect has been:

| Unit | Requirement | Why it is the risk |
|---|---|---|
| Arm mapping in `compareOnce` | REQ-EVAL-1 | An inversion reverses every published verdict, undetectably |
| Order-stability in `compareArms` | REQ-EVAL-2 | The tie rule is the only defence against position bias |
| `duplicatePromptRefs` | REQ-EVAL-3 | Found the 2.2.1 dedupe bug; a regression re-hides it |
| `declaredFromPrompt` | REQ-EVAL-4 | `+N more` counted as a path would report a false missing-path failure |
| `restoreTree` | REQ-EVAL-5 | Under-reporting tampering silently weakens the strongest categorical result |

REQ-EVAL-1 and REQ-EVAL-2 need the judge's decision without the judge's cost. The
`Anthropic` client is constructed inside `compareOnce` (`judge.ts:206`), so the
seam is to take the verdict-producing call as a parameter defaulted to the real
one — the arm mapping and the swap logic then test against a stub returning a
scripted `"first"` / `"second"` / `"tie"`, with no network and no key. This
mirrors `fakeReader` in `session-verifier.test.ts`, which does the same for
`GitReader`.

`prepareWorkspace`, `installPublishedCli`, and `runColdAgent` stay untested:
they are thin I/O over `git`, `npm`, and the Messages API, and a test would
assert the mock.

### The adversarial corpus

A new target shape, because an ablation deletes a file whereas an attack *adds*
one:

```ts
export interface AdversarialCase {
  readonly id: string;
  /** Files planted before `init` runs. */
  readonly plant: ReadonlyMap<string, string>;
  /** CLI invocations, in order, after `init`. */
  readonly commands: readonly (readonly string[])[];
  /** Text that must NOT appear unattributed in generated context. */
  readonly marker: string;
  readonly classification: "injection" | "eviction" | "traversal" | "exhaustion" | "secret";
}
```

Detection is `String.includes` against the generated files — no judge, no key,
which is what keeps this in the deterministic tier (REQ-EVAL-8). The corpus seeds
with the two confirmed cases from `evals/RIGOUR.md`, which fail today and are the
regression lock for `LLD-context-provenance.md`, plus one case per untested class
from that document's attack table.

**The marker check asserts attribution, not absence.** After
`LLD-context-provenance.md` lands, planted text legitimately *does* appear in the
context — quoted and attributed. A test asserting the string is absent would fail
on correct behaviour. REQ-EVAL-6 is therefore phrased as *reports whether it
appears*, and the assertion is that it appears only in attributed form.

### Wiring into CI

`pnpm eval` runs after Build in `ci.yml` — it drives the published CLI, so it
needs neither the workspace build nor a key. REQ-EVAL-7 makes the exit code the
gate; `run.ts` currently sets `process.exitCode = 1` only on a thrown error
(`run.ts:169`), so a *reported* failure exits 0 today.

Deliberately **not** `continue-on-error`. The audit step already demonstrates what
that produces: a step that has never gated anything and was believed to be
gating (`docs/releasing.md`).

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-EVAL-1 | unit | Stub verdict `"first"` with bootstrap in first position → `bootstrap`; with the arguments swapped → `control` |
| REQ-EVAL-2 | unit | Stub disagreeing orderings → `winner: null`, `orderStable: false`; agreeing → the arm |
| REQ-EVAL-3 | unit | A prompt naming one path twice across two load lines reports it once |
| REQ-EVAL-4 | unit | `Load: a.ts, +11 more` declares `a.ts` only |
| REQ-EVAL-5 | unit | Modified, added, and deleted gate files each restore and report |
| REQ-EVAL-6 | integration | Each corpus case through the real CLI; assert planted text appears only attributed |
| REQ-EVAL-7 | e2e | A deliberately failing case makes `pnpm eval` exit non-zero |
| REQ-EVAL-8 | e2e | The deterministic tier completes with `ANTHROPIC_API_KEY` unset |

REQ-EVAL-1 is the one to watch fail first in the most literal sense: invert the
ternary at `judge.ts:182`, confirm the test goes red, restore it. A test that
cannot catch that inversion is not testing the thing that matters.

---

## Out of scope

Everything in `evals/RIGOUR.md` beyond steps 1 and 2 of its sequence. Named here
so the omission is deliberate, not forgotten:

- **Task difficulty calibration** to a 40–60% control pass rate, and the ceiling
  effect it addresses. The largest methodological problem, and the next LLD.
- **Statistics** — paired log-differences, bootstrap confidence intervals,
  variance decomposition.
- **Judge calibration** against human labels, and the κ ≥ 0.6 gate.
- **Dose-response arms**, **longitudinal chains**, **behavioural metrics**, and
  the additional targets.

Each depends on a harness whose own arithmetic is trusted, which is what this
document is for. Designing them now would be designing against a codebase that
is about to change.

Also out of scope: **running the agent tier in CI.** It costs money per run and
its variance is wider than the effects it measures — it is a deliberate,
tagged activity, not a gate.
