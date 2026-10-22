# HLD — in-flight work

Architecture across the features currently planned. Per-feature detail lives in
`LLD-<feature>.md`, written when that feature is about to be built.

Method: [../METHOD.md](../METHOD.md).

---

## What the product is, stated plainly

`dev-sesssion` generates a bounded context for an AI coding session: given a
plan and a codebase, it decides what the assistant should load and writes a
resume prompt. Everything else — adapters, layers, budgets, MCP — serves that.

The eval harness has measured this. Two findings shape what follows:

| Finding | Evidence |
|---|---|
| It reduces context burn | Bootstrap arm ≤ control on turns *and* tokens in 8/8 pairs |
| It does **not** improve correctness | All 16 arm-runs passed the fixture's tests |

The second is the gap. Features 1–4 below either widen the funnel of projects the
tool can serve at all (1 and 3), or aim at correctness (4).

Measuring any of that turned up two further concerns that are not product
features and do not fit that framing. The tool is a **pipe from repository
content to agent instructions**, and it never marks which text came from where
(feature 5). And the instrument producing these findings is the only code in the
repository with no tests, having been wrong more often than the product it
measures (feature 6).

---

## The features

| # | Feature | LLD | Problem in one line |
|---|---|---|---|
| 1 | Plan source registry | `LLD-plan-sources.md` | Only one markdown dialect parses; everything else yields zero chunks |
| 2 | `symbols` command | `LLD-symbols.md` | Symbol data is extracted and indexed but never shown to a human |
| 3 | Bootstrap auto-pilot | `LLD-file-index.md` | Init demands up to 30 tagging prompts, or dumps every file into chunk 1 |
| 4 | Workflow-shaped prompt | `LLD-workflow-prompt.md` | `Next:` is a flat bullet list with no position and no exit condition |
| 5 | Context provenance | `LLD-context-provenance.md` | Text lifted from repo files reaches the agent indistinguishable from the tool's own instructions |
| 6 | Eval harness integrity | `LLD-eval-harness.md` | The harness that produces our published numbers has no tests and no CI |
| 7 | Code units | `LLD-code-units.md` | The smallest thing a prompt can load beyond signatures is a whole file, and nothing records what a prompt loaded |
| 8 | First run | `LLD-first-run.md` | `init -y` tags every file to chunk 1, `import` quotes the tool's own block back, and the prompt ignores `index` and `import` until `update` runs |
| 9 | Single-file components | `LLD-sfc-index.md` | `.vue` and `.svelte` files never reach the ai-index |
| 10 | One budget | `LLD-budget.md` | The prompt, `status`, `preview` and `health` each reported a different budget, all of them low |
| 11 | Prompt context | `LLD-prompt-context.md` | The agent saw a chunk's checkboxes but not its goal or steps, and the load line hid files past six |
| 12 | Files a chunk will create | `LLD-new-files.md` | A phase whose files do not exist yet loads nothing for them — not even the code they sit beside |
| 13 | Plan authoring and orchestration | `LLD-plan-authoring.md` | An agent cannot check a plan it wrote without running `init`, and a harness driving `advance` either hangs on a prompt or skips work |

### Status (2026-10-22)

Shipped in 2.4.2 or earlier: 1, 5, 7, 8 (first slice), 6 (all but REQ-EVAL-6's
adversarial corpus).

Built on `docs/lld-remaining-features`, pushed, **not yet released or PR'd** —
found by dogfooding 2.4.2 on DevNexus, a real 195-file micro-frontend monorepo
whose plan names each phase's files:

| Feature | Commit | What moved on DevNexus |
|---|---|---|
| 6 — recall, `--target`, honest benchmark (REQ-EVAL-10..18) | `f931566`, `8a83a22` | The eval now *fails* an empty context; it had passed one |
| 3 — files the plan names (REQ-IDX-12..18) | `a630e4a` | Tag recall 0/47 → 47/47, no wrong tags |
| 9 (SFC-1..5) | `84e646a` | Indexed files 95 → 111; 66 component units, hash fidelity 66/66 |
| 10 (BUD-1..5) | `48e4722`, `3e2595f` | One figure everywhere (~4,500, honestly over the 4,000 default) |
| 10 (BUD-6..8) | `fix(budget): judge the chunk` | Always-include (`CLAUDE.md`, ~1,960) reported beside the cap, not against it: chunks 1–8 `[OK]` at ~950–2,550; chunk 9 still `[OVER]` at ~6,120 for a 17 KB doc |
| 12 (NEW-1..6) | `feat(prompt): files a chunk will create` | Phase 8 states its 8 absent paths and loads `App.tsx`, `main.tsx`, `routing/MFEOutlet.tsx`, `routing/mfe-registry.ts`; recall unchanged |
| 8 — import notes, `init --chunk` (REQ-RUN-23..31) | `1c73bec`, `b74010f` | Readable notes; start at phase 8 in one command |
| 11 (PCX-1..7) | `4908221` | Prompt recall 5/11 → 11/11; `PLAN_1.md` holds the goal and all eight steps |

Measure any further change with
`pnpm eval --local --target evals/targets/devnexus.local.json` (gitignored; the
target names files from DevNexus's own plan).

Still open, in rough priority:

- **Feature 3's remaining half** — interactive tagging (up to 30 prompts) and
  tagging-on-touch.
- **Feature 4** (workflow-shaped prompt) and **feature 2** (`symbols`): no LLD yet.
- **Feature 13** (plan authoring, orchestration): LLD drafted 2026-10-22, not built.
- **REQ-EVAL-6**, the adversarial corpus.
- **The agent tier on a real target** — every number above is deterministic;
  nothing yet shows an agent does better with the new context.

1–4 are independent except that 4 depends on notes decay landing first. 8 takes over
the `--yes` half of 3; the interactive half and tagging-on-touch stay with 3. 5 and 6
are coupled in one direction: 6 supplies the adversarial corpus that locks 5's
fix, so 5's regression tests live in 6's tier. Neither blocks the others.

---

## Ownership

No new packages. Each feature lands in the package that already owns its concern:

| Concern | Package | Why |
|---|---|---|
| Plan parsing, chunk model, file index, formatters | `core` | Business logic; no CLI deps, no `process.argv` |
| Command surface, rendering, prompts, MCP tools | `cli` | Parse args → call core → format → exit |
| Tool-specific prompt shapes | `adapters` | Already owns the five `BootstrapFormatter` impls |
| Path, frontmatter, atomic write, secrets | `security` | Unchanged by this work |

Two standing constraints bound every design below:

- **`core` and `security` take no new runtime dependencies.** A markdown AST
  library in `core` is not available; parsing stays line-by-line regex.
- **`cli` holds no business logic.** A new command is an arg parser and a
  renderer over a `core` entry point.

---

## Contracts between the parts

### Plan ingestion

Today `PlanParser.fromMarkdown` *is* the contract, and it encodes one dialect.
The registry inverts this: many sources, one normalized output.

```
raw plan text
   │
   ▼  PlanSource.detect() → confidence, across a registry
   ▼  PlanSource.parse()
PlanChunk[]  ◄── unchanged; everything downstream is untouched
```

The seam is `PlanChunk[]`. Nothing after ingestion learns that formats vary.
This mirrors `packages/adapters/src/registry.ts`, which already solved the same
shape for output formats — `registerAdapter` / `getAdapterByName`, names derived
from the registry rather than a hand-maintained list.

### Symbol data

Already extracted and already indexed. `AutoExtractor` → `ai-index.yaml` holds
`{ signature, summary, line, surface, tags }` per exported symbol, and
`AiIndexManager.renderLayer0/renderLayer1` already format it. Feature 2 adds a
*console consumer* of existing data, not a new pipeline.

### Code units and the context manifest

Feature 7 adds a rung between signatures and full source. The ai-index stores
every function, method, and declaration as a **unit**, with a line range, a
token cost, and a content hash. That is about 8 units per file, measured on this
repo. A task that names a unit focuses that unit, instead of escalating its file
to full source. The prompt carries references (`path#id:start-end`), never
source.

```
ai-index units ──► UnitFocusResolver ──► LayerResolver ──► formatters (Focus line)
                         │                    │
                         └────────┬───────────┘
                                  ▼
                   .session/context-manifest.json   ◄── verify: STALE / MOVED
```

The manifest is the session's record of *what went into context and why*:
each item has its granularity, its cost against its whole file, its hash, and
the task that caused it. It is overwritten with each prompt. `verify` uses it
to detect references that the code has since moved past. Feature 2 (`symbols`)
reads the same unit data.

### File → chunk tagging

The one link in the chain with no automation. Discovery, token costing, purpose
inference, symbol extraction, git history, and workspace layout are all built;
the tag itself comes from a human pressing arrow keys, or from a blanket
fallback. Feature 3 does not add a smarter guesser — it removes the demand that
tagging be complete at init, and defers it to the moment a file is actually
touched.

### Prompt generation

`BootstrapContext` → five `BootstrapFormatter` implementations → validated,
capped text. Feature 4 extends the context with optional fields and adds **one**
shared helper in `formatter-utils.ts` that all five formatters call.

This is load-bearing. The dedupe bug (`82898dd`) was five private copies of a
one-line merge; the prefix-drift bug was three private copies of a string
constant. `formatter-utils.ts:105` codifies the rule. Anything a formatter does
more than once goes in that module.

### The trust boundary

Feature 5 names a contract that was always there and never written down.

```
repository files          ← the developer has not read all of this
   │  walkers, AnnotationParser, import
   ▼
.session/ artifacts       ← tool-owned, but carrying quoted foreign text
   │  BootstrapFormatter, AiIndexManager, MCP tools
   ▼
the agent's context       ← acts on what it reads, with write access
```

Repository content is **untrusted input**, not because the developer is
adversarial but because they did not write all of it: a fork, a vendored
dependency, a pull request. Two paths carried it across that boundary unmarked,
both confirmed reproducible: an imported `CLAUDE.md` section became a `Note:`
line, and an `@ai-summary` became text served by `read_file_layer`. Both are now
quoted and attributed (`LLD-context-provenance.md`), as are plain doc-comment
summaries, and unit ids on the `Focus` line are restricted to identifiers.

The rule this establishes: **text the tool did not author is rendered as an
attributed quotation, never as tool speech.** `SecretScanner` and `guardEgress`
already guard the outbound direction; this is the same boundary, inbound. The
mitigation is provenance rather than filtering — classifying text as
instruction-like is an arms race, and a filter that mostly works is worse than a
label that always does.

---

## Cross-cutting decisions

**Optional fields, never required ones.** `PlanChunkSchema`, `SessionStateSchema`,
and `FileIndexEntrySchema` are all `.strict()`, so an unknown key is a hard parse
failure. Every schema addition is optional and additive, keeping the change
inside Protocol v1.x, and `PROTOCOL.md` is updated in the same commit.

**Third-party formatters keep working.** `registerAdapter()` lets out-of-tree
code implement `BootstrapFormatter`. New `BootstrapContext` fields are optional
so a formatter that ignores them still compiles and still produces valid output.

**A new prompt line that names files must be registered.** `FILE_LOAD_PREFIXES`
is the single source of truth, and `NextPromptWriter.validate()` rejects output
whose file-load line it does not recognize — a formatter can otherwise produce
output the writer refuses to persist. This has happened once already.

**Wrong is worse than absent.** The prompt's load list is capped, so a
mis-tagged file evicts a correct one. Where a heuristic is uncertain, the design
leaves the entry out rather than guessing — this is why feature 3 indexes less
rather than guessing more.

---

## What this work does not do

- **No `ChunkId` value type.** Fractional ids (`3.5`, `13.1`) now work end to
  end. Alphanumeric ids (`13a`) do not, and are not planned: decimals already
  give interleaving, which is the only thing suffixes were used for.
- **`advance()` still does `active_chunk + 1`.** It cannot step onto a
  fractional chunk. Known, carried, not addressed here.
- **No enforcement machinery for the method.** No requirement-coverage gate, no
  phase transitions in the product. `docs/METHOD.md` is how *we* work; the
  workflow-prompt feature ships generic, user-defined steps that owe it nothing.
- **No correctness claim.** Feature 4 is aimed at the correctness gap, not proof
  of it. The eval harness measures whether it moved, and a single run cannot
  separate signal from ±30–45% noise.

---

## Verification

Per-feature test plans live in each LLD. Repo-wide:

- `pnpm test` / `typecheck` / `lint` clean at every step
- `pnpm eval` — deterministic tier, no API key, ~40s: path grounding and
  duplicate refs against the published CLI
- `pnpm eval:agent --tag <run>` with repeats for anything claiming an effect on
  agent behaviour

Note that the tool is no longer run against this repository, so the class of bug
that dogfooding used to catch — three data-loss bugs in Slice 0, none caught by
any test — now has to be caught by the eval harness and by fixtures captured
from real projects (`tests/fixtures/messy-file-index/`).

**That load-bearing role is why feature 6 exists.** The harness carries the
coverage dogfooding used to provide, and three of its first four rounds found
defects in *itself* rather than in the product. Until its own arithmetic is
tested and it runs unprompted, it is a safety net nobody has inspected. Its
methodological limits — a ceiling effect on the primary outcome, an uncalibrated
judge, statistics that overstate what 8 pairs can support — are catalogued in
[`evals/RIGOUR.md`](../../evals/RIGOUR.md); those are the LLD after next, and
they are worth nothing until the instrument itself is trustworthy.
