# LLD — what the prompt points the agent at

**Area:** `PCX` — the chunk's brief, and the file-reference lines of
`NEXT_PROMPT.md`.

---

## Problem

Both found on DevNexus (2026-10-21).

**1. The agent never sees the work.** A DevNexus phase reads:

```markdown
## Phase 1: Monorepo Foundation + Shell Skeleton
**Goal**: pnpm + Turbo workspace with a React shell that renders sidebar, header, and empty content area.

### Tasks
1. Initialize pnpm workspace + Turborepo
2. Scaffold `apps/shell` with Vite + React 18 + TypeScript
...
### Definition of Done
- [ ] `pnpm dev` runs shell on localhost:3000
...
### Key Files
```

The checkboxes are acceptance criteria; the numbered list is the work. `readBody`
(`heading-source.ts:197`) keeps checkboxes, and `PlanParser.toMarkdown`
(`plan-parser.ts:176`) writes `PLAN_N.md` from the chunk alone, so the goal and
the steps exist nowhere in `.session/`. The prompt's `Next:` lists "Lighthouse
perf ≥ 90 on empty shell" and nothing says what to build.

**2. The load line stops at six.** Chunk 1 tags 11 files; the prompt names 6
and `+7 more`, so eval prompt recall is 5/11 (LLD-file-index.md). The cap is
`MAX_FILES_TO_SHOW = 6` in each of five formatters
(`claude-bootstrap-formatter.ts:36`, `cursor-…:34`, `opencode-…`,
`windsurf-…`, `plain-text-formatter.ts:35`) and `5` in a sixth copy in
`next-prompt-writer.ts:37`. Four of the formatters also carry a private copy of
the `+N more` logic that `capRefList` (`formatter-utils.ts:289`) already
implements — the shape of duplication the HLD's prompt-generation section
exists to prevent.

The six is not derived from anything. Every listed file is already charged to
the budget; the line hides files the budget paid for.

---

## Requirements

### The brief

**REQ-PCX-1** — When a plan section has text besides its task lines, the plan
source shall record that text as the chunk's `brief`, as the section's own
markdown with the task lines removed.

**REQ-PCX-2** — If removing task lines leaves a heading with nothing beneath it
before the next heading, then the plan source shall leave that heading out of
the brief. A horizontal rule at the start or end of a brief — the separator a plan
draws between sections — is left out the same way.

**REQ-PCX-3** — If a brief exceeds 6,000 characters, then the plan source shall
cut it at a line boundary and end it with a line stating it was shortened.

**REQ-PCX-4** — Where a chunk has a `brief`, `PLAN_N.md` shall carry it in its
frontmatter, and reading the file back shall yield the same text. A
`PLAN_N.md` without `brief` stays valid.

**REQ-PCX-5** — Where the active chunk has a `brief`, the prompt shall name that
chunk's `PLAN_N.md` on a `Plan:` line, in the formatter's reference syntax.

### File-reference lines

**REQ-PCX-6** — Every shipped formatter, and the prompt writer, shall render a
list of file references through one helper in `formatter-utils.ts`.

**REQ-PCX-7** — A file-reference line shall name every reference it is given
while the line stays within 1,200 characters, and shall end with `+N more`
naming how many it left out.

---

## Design

### Brief — `plan-sources/brief.ts` (new, `core`)

```ts
export const MAX_BRIEF_CHARS = 6_000;
/** A section's markdown without its task lines (REQ-PCX-1..3). */
export function extractBrief(lines: readonly ScannedLine[]): string | undefined;
```

Takes the section's `ScannedLine`s (already kept for `extractFileRefs`), drops
task lines outside fences, drops headings left empty (REQ-PCX-2), trims blank
runs at either end, and cuts at 6,000 characters on a line boundary with a
final `_(shortened — the full section is in the original plan)_` line.
Returns `undefined` when nothing is left. Both shipped sources call it;
`task-list-source.ts` on the whole document.

The text is the developer's plan, the same trust class as task text, which
LLD-context-provenance.md §Out of scope already renders unquoted. It is not
quoted here either.

### Schema and serialization

`PlanChunkSchema.brief: z.string().min(1).optional()`, with `PROTOCOL.md` in the
same commit. `toMarkdown` writes it as a YAML literal block with an explicit
indentation indicator, so a first line beginning with a space still parses:

```yaml
brief: |2-
  **Goal**: pnpm + Turbo workspace …

  ### Tasks
  1. Initialize pnpm workspace + Turborepo
```

It is written once, in the frontmatter, not repeated in the body: the agent
reads the file, and the budget counts it (REQ-BUD-1 counts `toMarkdown`'s
output, so a longer `PLAN_N.md` is charged without further change).

### `Plan:` line

```ts
export const PLAN_PREFIX = "Plan:";
/** `Plan: <ref>` for the active chunk's file, or undefined when it has no brief. */
export function formatPlanLine(chunk: PlanChunk, ref: (p: string) => string): string | undefined;
```

`PLAN_PREFIX` joins `FILE_LOAD_PREFIXES`, so the writer's validation and
`ReplayScorer` see it without a private copy (HLD cross-cutting rule). Each
formatter pushes it after the budget line. The path is `.session/PLAN_<id>.md`.

### `formatRefList` — the one list renderer

`capRefList` (`formatter-utils.ts:289`) is exported as `formatRefList(refs,
maxChars = MAX_REF_LINE_CHARS)`. It adds references while the joined list plus
a worst-case `, +N more` suffix stays within 1,200 characters. The five
formatters' `formatFilesToLoad` and the writer's `formatFilePaths` call it with
their own `ref` rendering; every `MAX_FILES_TO_SHOW` is deleted.

`formatLayeredContextLines(resolved, ref, maxFiles, focus)` is exported API, so
its signature stays. `maxFiles` becomes an optional *count* cap on top of the
character cap; the shipped formatters stop passing 6.

1,200 is five notes' worth (`MAX_NOTE_CHARS`), a tenth of `MAX_PROMPT_CHARS`:
room for about 25 layered refs, which no DevNexus chunk exceeds.

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-PCX-1 | unit | `brief.test.ts`: goal, numbered steps and a Key Files fence kept; checkbox lines gone |
| REQ-PCX-2 | unit | `### Definition of Done` with only checkboxes under it is dropped; a heading with prose kept |
| REQ-PCX-3 | unit | A 20,000-character section is cut under 6,000 at a newline, with the shortened line |
| REQ-PCX-1 | integration | `plan-dialects`: the DevNexus-shaped phase yields its goal and steps in `brief` |
| REQ-PCX-4 | unit | `toMarkdown` → `PlanChunkManager.loadAll` round-trips a brief whose first line starts with spaces and which contains `---`, `#`, `: ` and quotes |
| REQ-PCX-5 | e2e | `init -y` on a phase with a goal: the prompt has `Plan: @.session/PLAN_1.md`; a checklist-only plan has no `Plan:` line; the writer accepts both |
| REQ-PCX-6 | unit | Each formatter's flat load line for 30 files equals `formatRefList` over the same refs |
| REQ-PCX-7 | unit | 11 short refs → all named; 200 refs → line ≤ 1,200 chars ending `+N more` with N exact |
| REQ-PCX-7 | eval | DevNexus prompt recall for chunk 1 goes from 5/11 to 11/11 |

### What actually happened

| Requirement | Outcome |
|---|---|
| REQ-PCX-1..7 | **Failed first** — 15 tests, on missing modules and on the 6-file cap |
| REQ-PCX-2 | Extended after the first DevNexus run: the brief ended in `---`, the rule the plan draws between phases. A test for edge rules failed first, then passed |
| Existing tests | Six pinned the old cap (`+4 more` for 10 files; `+2 more` for 8). Rewritten to REQ-PCX-7: all named while they fit, `+N more` past 1,200 characters |
| `pnpm eval:units` | Its `proven-duplicates` scenario was *about* the two private `MAX_FILES_TO_SHOW` constants this change deletes. The scenario now uses `BYTES_PER_TOKEN`, a private constant read in both `context-budget-calculator.ts` and `token-counter.ts`; it passes with evidence for both |

The units eval also surfaced a private `FENCE_RE` this branch had added to
`claude-md-notes.ts` beside the one in `markdown-utils.ts`, and two copies of a
horizontal-rule regex. Both now live in `markdown-utils.ts` and are imported.

DevNexus, chunk 1, local build: prompt recall **11/11** (5/11 before; 0/11 on
2.4.2). The prompt is 14 lines, a `Plan:` line points at `PLAN_1.md`, and that
file holds the goal, all eight numbered steps with their sub-items, and the Key
Files block. Budget reads `~4509 [OVER]`: the brief is now charged, as REQ-BUD-1
requires.

---

## Out of scope

- **Which list counts as tasks.** Checkboxes remain the tracked tasks; the
  numbered steps are context, not state. Treating steps as tasks was the
  alternative considered and not chosen.
- **Showing the brief inline in the prompt.** The prompt has a 20-line cap; the
  brief can be 6,000 characters. It is a file the prompt points at.
- **Files a chunk will create.** Phase 8 names only files that do not exist
  yet; the brief now tells the agent what they are, but nothing is loaded for
  them.
