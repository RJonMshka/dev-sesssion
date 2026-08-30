# HLD — in-flight work

Architecture across the four features currently planned. Per-feature detail
lives in `LLD-<feature>.md`, written when that feature is about to be built.

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

The second is the gap. Everything below either widens the funnel of projects the
tool can serve at all (features 1 and 3), or aims at correctness (feature 4).

---

## The four features

| # | Feature | LLD | Problem in one line |
|---|---|---|---|
| 1 | Plan source registry | `LLD-plan-sources.md` | Only one markdown dialect parses; everything else yields zero chunks |
| 2 | `symbols` command | `LLD-symbols.md` | Symbol data is extracted and indexed but never shown to a human |
| 3 | Bootstrap auto-pilot | `LLD-file-index.md` | Init demands up to 30 tagging prompts, or dumps every file into chunk 1 |
| 4 | Workflow-shaped prompt | `LLD-workflow-prompt.md` | `Next:` is a flat bullet list with no position and no exit condition |

They are independent except that 4 depends on notes decay landing first.

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
