# LLD — plan source registry

Areas: `PS`

Feature 1 of [HLD.md](./HLD.md). Method: [../METHOD.md](../METHOD.md).

---

## Problem

`PlanParser.fromMarkdown` (`packages/core/src/parsers/plan-parser.ts:254`) is the
only path from a plan document to `PlanChunk[]`. It encodes exactly one dialect —
`## ` headings, with `Chunk N` as the naming convention — and every plan that does
not match it either yields nothing or is silently altered.

Measured against the shipped parser (`packages/core/dist/index.cjs`, current with
`fc38979`):

### Zero chunks for any non-h2 document

`H2_RE` at `:22` is `/^## \s*(.+)$/`, and `:280` is the only place a chunk opens.
No other heading depth is considered.

| Input | Result |
|---|---|
| `### Auth` / `### Billing`, tasks under each | 0 chunks |
| `# Auth` / `# Billing`, tasks under each | 0 chunks |
| flat `- [ ]` list under one `# TODO` | 0 chunks |
| setext (`Auth` / `====`) | 0 chunks |

Downstream, `split-plan.ts:84` turns this into
`"No chunks found in PLAN.md. The file must contain ## headings."` with the
suggestion `"Add `## Chunk 1 -- ...` headings to your PLAN.md."` — the tool's
answer to an unrecognized plan is to ask the user to rewrite it into our dialect.
`detect.ts:114` compounds it: it counts only `confidence >= 1.0` boundaries, so
the same documents are reported as `estimatedChunks: 0` at init.

### Silent deletion when one heading happens to say "Chunk"

`hasExplicitChunkHeading` (`:77`) flips the parser into explicit mode if *any* h2
matches `Chunk N`. In that mode `:285` flushes and skips every h2 that does not.
The skip is deliberate — the docstring at `:237` explains it keeps `## Overview`
scaffolding out of the chunk list — but it does not distinguish scaffolding from
work, and it is silent:

```
## Chunk 1 — Auth        →  1:"Auth"(1 task)
- [ ] login
## Milestone 2 — Billing →  (dropped, no warning)
- [ ] stripe
## Phase 3 — Deploy      →  (dropped, no warning)
- [ ] ship
```

Two of three sections and two of three tasks vanish with no diagnostic. This is
the same failure class as the `FILE_INDEX` mis-attribution in
[LLD-session-integrity.md](./LLD-session-integrity.md) — loss that looks like
success.

### The same heading means two different things

`extractChunkIdFromHeading` (`:61`) rejects `0` via `id >= 1`, matching
`PlanChunkSchema.chunk_id`'s `z.number().min(1)`
(`packages/core/src/schemas/plan-chunk.ts:17`). So `## Chunk 0 — Setup`:

- alone in a document → sequential mode → emitted as **chunk 1, titled "Setup"**
- beside a `## Chunk 1` → explicit mode → **dropped entirely**

The heading's meaning depends on whether an unrelated sibling heading matched.

### Declared numbers are discarded, and dependencies drift onto them

In sequential mode (`:291`) ids come from ordinal position, and the number the
author wrote is thrown away. `DEPENDS_RE` at `:46` still reads the author's
number literally. The two disagree:

```
## Phase 3 — Auth      →  chunk_id 1
## Phase 4 — Billing   →  chunk_id 2   ("Depends on: Phase 3" → not parsed at all)
## Phase 5 — Deploy    →  chunk_id 3,  depends_on: [4]
```

`depends_on: [4]` names a chunk the document does not contain; the highest id
emitted is 3. The dependency graph is corrupted by the renumbering, and the one
dependency the author did write in prose is dropped because `DEPENDS_RE` only
recognizes the noun "Chunk".

---

## Requirements

### Detection (`PS`)

- **REQ-PS-1** — The plan source registry shall select the registered source
  with the highest detection confidence for the document.
- **REQ-PS-2** — Where two or more sources report the same highest confidence,
  the registry shall select the one registered earliest.
- **REQ-PS-3** — If no plan source matches the input above the confidence
  threshold, then the CLI shall report the candidates and their scores rather
  than selecting one.

### Heading depth (`PS`)

- **REQ-PS-4** — Where at least one heading declares a position, the heading
  source shall split the document on the depth with the most position-declaring
  headings.
- **REQ-PS-5** — Where no heading declares a position, the heading source shall
  split the document on the shallowest depth that occurs more than once.
- **REQ-PS-18** — The heading source shall ignore heading-like lines inside
  fenced code blocks.
- **REQ-PS-19** — When a heading shallower than the split depth appears, the
  heading source shall end the current section.

### Chunk ids (`PS`)

- **REQ-PS-6** — When a heading declares a position number, the heading source
  shall use that number as the chunk id rather than the heading's ordinal
  position.
- **REQ-PS-7** — Where no heading in a document declares a position number, the
  heading source shall assign chunk ids by ordinal position.
- **REQ-PS-8** — If a heading declares a position number that `PlanChunkSchema`
  cannot represent, then the heading source shall exclude that section rather
  than renumber it.

### Exclusions (`PS`)

- **REQ-PS-9** — Where a document contains both position-declaring and
  non-declaring headings at the split depth, the heading source shall exclude
  the non-declaring sections from its chunks.
- **REQ-PS-10** — The heading source shall report every section it excluded,
  with that section's heading text, line number, and task count.
- **REQ-PS-11** — If an excluded section contains at least one task, then the
  CLI shall warn naming that heading and its task count.

### Dependencies (`PS`)

- **REQ-PS-12** — The heading source shall recognize a dependency declaration
  that names the position noun the document itself uses.
- **REQ-PS-13** — If a chunk declares a dependency on an id that no chunk in the
  document defines, then the parser shall report it and preserve it.

### Documents without headings (`PS`)

- **REQ-PS-14** — Where a document contains tasks but no heading at any depth,
  the task-list source shall produce one chunk containing every task.

### Failure reporting (`PS`)

- **REQ-PS-15** — If the selected source produces zero chunks, then the CLI
  shall report every source it tried with that source's confidence.

### Extensibility (`PS`)

- **REQ-PS-16** — Where a caller registers a custom plan source, the registry
  shall include it in detection.
- **REQ-PS-17** — If a caller registers a source under a name already
  registered, then the registry shall reject the registration.

---

## Design

### Shape

The registry inverts today's control flow: instead of one parser that decides
what a document is, many sources each score a document and the best one parses
it. This is the shape `packages/adapters/src/registry.ts` already uses for output
formats, and it is copied deliberately — same function names, same
`Object.create(null)` lookup table, same `CliError` on duplicate registration.

```
raw plan text
   │
   ├─► headings   .detect() → 0.9
   ├─► task-list  .detect() → 0.4      ranked, threshold 0.3
   └─► <custom>   .detect() → 0.0
                     │
                     ▼  best.parse()
              PlanParseResult { chunks, excluded, warnings }
                     │
                     ▼  chunks
                PlanChunk[]  ◄── unchanged seam; nothing downstream changes
```

`excluded` and `warnings` are new information travelling *beside* the seam, not
through it. They exist so the CLI can say what it dropped; no consumer of
`PlanChunk[]` learns that formats vary.

### Modules

New directory `packages/core/src/parsers/plan-sources/`:

| File | Holds |
|---|---|
| `types.ts` | `PlanSource`, `PlanSourceDetection`, `PlanParseResult`, `ExcludedSection` |
| `registry.ts` | register / unregister / get / detect / `parsePlan` |
| `heading-source.ts` | the generalized heading dialect |
| `task-list-source.ts` | headings-free documents |
| `index.ts` | barrel |

Line-by-line regex throughout — `core` takes no new runtime dependency, per the
HLD's standing constraint. `H2_RE` and friends move out of `plan-parser.ts` into
`heading-source.ts`; the `parseTaskLine` / `parseEstSessions` helpers are shared
by both sources and stay exported from `plan-parser.ts` rather than being copied,
per the formatter-utils rule in the HLD.

### Types

```typescript
export interface PlanSourceDetection {
  readonly confidence: number;   // 0..1
  readonly reason: string;       // shown by REQ-PS-3 / REQ-PS-15 reporting
}

export interface ExcludedSection {
  readonly heading: string;
  readonly line: number;         // 1-indexed
  readonly taskCount: number;
  readonly reason: "no-position-declared" | "unrepresentable-id";
}

export interface PlanParseResult {
  readonly chunks: readonly PlanChunk[];
  readonly excluded: readonly ExcludedSection[];
  readonly warnings: readonly string[];   // dangling deps (REQ-PS-13)
}

export interface PlanSource {
  readonly name: string;
  readonly displayName: string;
  detect(content: string): PlanSourceDetection;
  parse(content: string): PlanParseResult;
}
```

### Heading depth (REQ-PS-4, REQ-PS-5, REQ-PS-18)

`HEADING_RE = /^(#{1,6})\s+(.+)$/`. Take a census of headings per depth —
skipping fenced code blocks — recording how many at each depth declare a
position. Then:

- if any depth has a position-declaring heading, split on the depth with the
  most of them, ties to the shallowest (REQ-PS-4);
- otherwise split on the shallowest depth occurring more than once, falling back
  to the shallowest depth present (REQ-PS-5).

The census drives the rule, and the census was wrong twice before it was right.
"Shallowest depth occurring more than once" as the primary rule selects **h1**
for `docs/PLANv2.md`, whose first two lines are both h1 — it would parse this
repo's own plan into two chunks instead of six. Measured over the four real plan
documents in the repo:

| Document | h1 | h2 (declaring) | h3 (declaring) | Split |
|---|---|---|---|---|
| `docs/PLANv2.md` | 2 | 12 (6) | 53 (5) | h2 |
| `docs/PLAN.md` | 1 | 23 (17) | 51 (0) | h2 |
| `tests/fixtures/medium-ts-monorepo/PLAN.md` | 0 | 3 (3) | 3 (0) | h2 |
| `tests/fixtures/simple-node-app/PLAN.md` | 0 | 1 (1) | 1 (0) | h2 |

All four select h2 and parse to exactly the ids they parse to today, which is
what keeps the existing suite green. Note also why the rule is not "most frequent
depth": `### Tasks` repeated under every chunk outnumbers the chunk headings in
three of the four.

REQ-PS-18 is load-bearing rather than cosmetic. `docs/PLANv2.md` contains fenced
YAML whose comment lines (`# .session/ai-index.yaml`) match `HEADING_RE` exactly;
without fence-skipping the h1 census is inflated by code-block content and the
depth choice becomes a function of how many YAML examples a document happens to
contain.

### Position numbers (REQ-PS-6, REQ-PS-7, REQ-PS-8)

```typescript
const POSITION_RE = /^(?:(chunk|phase|step|milestone|part|stage|sprint)\s+)?(\d+(?:\.\d+)?)\b/i;
```

Applied to the heading text after the `#`s. The noun is optional so `## 1. Auth`
declares position 1; a bare leading number is a declaration.

A document is in *declared* mode if any heading at the split depth declares a
position, and *ordinal* mode otherwise. The mode is per-document, which is what
makes REQ-PS-9's exclusion decidable.

REQ-PS-8 is the `Chunk 0` case. `PlanChunkSchema.chunk_id` is `min(1)`, so 0 has
no representation; the section is excluded and reported, in *both* documents that
contain it, rather than being renumbered in one and deleted in the other. This
follows the HLD's "wrong is worse than absent" and mirrors REQ-IDX-3, which made
the same call for unmappable `FILE_INDEX` sections.

### Section boundaries (REQ-PS-19)

A heading *shallower* than the split depth is a parent, and closes the open
section; deeper headings are children and stay inside it. Found by running the
CLI on an h3-structured plan ending in an `## Notes` section: its task was
appended to the last `###` chunk, silently. That is mis-attribution — the same
defect REQ-IDX-3 fixed for `FILE_INDEX.md`, reached by a different route.

Parent sections are never chunks. They are reported as excluded only when they
carry tasks, which separates a document title (`# Roadmap`) from lost work.

### Exclusions (REQ-PS-9, REQ-PS-10, REQ-PS-11)

The behaviour at `plan-parser.ts:285` is kept — scaffolding sections really do
need to stay out of the chunk list — and only its silence is fixed. Every skipped
section becomes an `ExcludedSection`. `split-plan.ts` warns for those with
`taskCount > 0`, which is the discriminator between `## Overview` (prose, silent)
and `## Notes / - [ ] …` (work, warned).

### Dependencies (REQ-PS-12, REQ-PS-13)

`DEPENDS_RE` becomes noun-agnostic, built from the noun the document's own
headings use:

```
depends\s+on:\s*(?:<noun>s?\s+)?([\d.,\s]+)
```

so a Phase-numbered plan can express dependencies in its own vocabulary. After
all chunks are parsed, each `depends_on` id is checked against the set of ids the
document produced, and unknown ids are named in `warnings`.

Unknown ids are **reported, not removed**. Dropping them was the first
implementation and it was wrong in a way the existing suite caught immediately:
`toMarkdown` emits one chunk per `PLAN_N.md`, so every single-chunk document has
a dependency on an id it does not itself define, and this repo's own plans
reference each other across `PLAN.md` and `PLANv2.md`. A dangling id is far more
often a cross-document reference than a typo, and the parser cannot tell the two
apart. Renumbering was the actual cause of corrupted dependency graphs, and
REQ-PS-6 removes it at the root; pruning would have destroyed correct data to
paper over a bug that no longer exists.

### Detection heuristics

| Source | Confidence |
|---|---|
| `headings` | 0.95 if ≥1 heading at the split depth declares a position; 0.6 if ≥2 headings exist at the split depth; else 0.0 |
| `task-list` | 0.5 if ≥1 task line and no headings; else 0.0 |

`PLAN_SOURCE_MIN_CONFIDENCE = 0.3`. Below it, REQ-PS-3 reports the ranked
candidates instead of picking one.

### Back-compat

`PlanParser.fromMarkdown` stays exported and keeps its signature — it is public
API in `docs/API.md` — and becomes a thin delegate to `parsePlan(content).result.chunks`.
`PlanParser.detectBoundaries` and `toMarkdown` are untouched. `split-plan.ts` and
`detect.ts` are the only two in-repo consumers; `split-plan.ts` moves to
`parsePlan` for the warnings, `detect.ts` keeps `detectBoundaries`.

---

## Test plan

| Requirement | Test | Level |
|---|---|---|
| REQ-PS-1, 2 | `plan-sources/registry.test.ts` → "selection" | unit |
| REQ-PS-3 | `split-plan.test.ts` → "ambiguous source" | unit |
| REQ-PS-4, 5, 18 | `plan-sources/heading-source.test.ts` → "split depth" | unit |
| REQ-PS-6, 7, 8 | `plan-sources/heading-source.test.ts` → "chunk ids" | unit |
| REQ-PS-9, 10 | `plan-sources/heading-source.test.ts` → "exclusions" | unit |
| REQ-PS-19 | `plan-sources/heading-source.test.ts` → "section boundaries" | unit |
| REQ-PS-11 | `split-plan.test.ts` → "warns on excluded work" | unit |
| REQ-PS-12, 13 | `plan-sources/heading-source.test.ts` → "dependencies" | unit |
| REQ-PS-14 | `plan-sources/task-list-source.test.ts` | unit |
| REQ-PS-15 | `split-plan.test.ts` → "zero chunks" | unit |
| REQ-PS-16, 17 | `plan-sources/registry.test.ts` → "registration" | unit |
| all PS | `tests/plan-dialects.integration.test.ts` | integration |
| REQ-PS-4, 6, 9 | `tests/e2e/split-plan.e2e.test.ts` | e2e |

The integration test is the one that matters, on the same reasoning as
`file-index-roundtrip`: it runs the four dialects that yield zero chunks today
(h3-only, h1-only, flat task list, `Phase N`) plus this repo's own
`docs/PLANv2.md` — a real 1063-line document with mixed `## Chunk N` and prose
scaffolding — and asserts against parser output, never hand-written expectations.

`docs/PLANv2.md` is the regression anchor: it must keep parsing to exactly the
chunk ids it produces today.

---

## Out of scope

- **Non-markdown sources.** No JSON, Linear, or GitHub-issue source. The
  registry exists so they can be added out of tree via `registerPlanSource`;
  none ships here.
- **Setext headings.** `Auth` / `====` is still not recognized as a heading —
  supporting it means two heading grammars in one source. Such a document no
  longer yields *nothing*, though: having no ATX heading, it falls to the
  task-list source and becomes one chunk holding every task. Same for
  `##Chunk 1` written without the space, which `HEADING_RE` still does not
  match.
- **Chunk id 0.** `PlanChunkSchema.chunk_id` is unchanged at
  `z.number().min(1)`, so REQ-PS-8 reports these rather than representing them.
- **Alphanumeric ids (`13a`).** Still unrepresentable, and the HLD's "no
  `ChunkId` value type" still holds. `POSITION_RE`'s trailing `\b` means
  `Chunk 13a` declares no position, so such a document parses in ordinal mode:
  ids 1, 2, … with the full heading kept as the title. That is a change worth
  naming — the old regex had no trailing boundary, so `Chunk 13a` and
  `Chunk 13b` both read as `13`, and since `split-plan` writes
  `PLAN_<chunk_id>.md` the second silently overwrote the first. Ordinal ids are
  not what the author wrote, but they no longer destroy a chunk.
- **Repairing dangling dependencies.** REQ-PS-13 reports and preserves; it
  neither guesses which chunk was meant nor deletes the reference.
- **`detectBoundaries` rework.** `detect.ts` will still under-report
  `estimatedChunks` for non-h2 plans at init. It is a cosmetic count on the
  detect screen, not an ingestion path, and folding it into the registry means
  running every source's `detect` during project detection.
