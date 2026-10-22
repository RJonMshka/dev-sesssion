# LLD — file index: files the plan names

**Area:** `IDX` — file index parsing, layout, and auto-tagging. REQ-IDX-1..11
live in [LLD-session-integrity.md](LLD-session-integrity.md); this document
continues at 12. HLD feature 3.

This is the first slice of feature 3: tagging files the plan *already names*.
The interactive tagging prompts and tagging-on-touch are the rest of the
feature, and are out of scope here.

---

## Problem

Found by running 2.4.2 against DevNexus on 2026-10-21 — a 195-file
micro-frontend monorepo with a 509-line `docs/PLAN.md`. Each `## Phase N:`
section carries a `**Goal**`, a numbered `### Tasks` list, a
`### Definition of Done` checklist, and a fenced `### Key Files` block:

````markdown
### Key Files
```
apps/shell/src/App.tsx
apps/shell/src/layout/{Sidebar,Header,ContentArea}.tsx
apps/shell/src/routing/MFEOutlet.tsx
turbo.json
```
````

`init -y` reported **"Tagged 0 files to chunks from task text; 194 left to the
ai-index."** The first prompt named only `CLAUDE.md`. Measured with
`pnpm eval --target` ([LLD-eval-harness.md](LLD-eval-harness.md), REQ-EVAL-10..12):
prompt recall 0/11 for chunk 1, tag recall 0% on all eight chunks whose named
files exist.

**1. A section's body is read for three things and discarded.** `readBody`
(`packages/core/src/parsers/plan-sources/heading-source.ts:197-225`) keeps
checkbox tasks, a `Depends on:` line and an estimate. Every other line — the
Key Files block, the numbered tasks, the goal — is dropped before a
`PlanChunk` exists. `PlanChunkSchema` (`schemas/plan-chunk.ts:10-27`) has
nowhere to put it.

**2. The matcher was built on the opposite assumption.** `file-reference.ts:4`
states it: *"Plans carry no file list, so task text is the only signal of which
files a chunk needs."* `LLD-first-run.md` §Problem 1 says the same. For a plan
written this way it is false, and the only text the matcher sees here is
Definition-of-Done checkboxes ("Lighthouse perf ≥ 90 on empty shell"), which
name no files.

**3. Brace groups would not survive tokenizing anyway.** `PATH_TOKEN_RE`
(`file-reference.ts:20`) ends a token at `{`, so
`layout/{Sidebar,Header,ContentArea}.tsx` reads as `apps/shell/src/layout/` and
`.tsx` — three files lost even if the line were scanned.

**4. The skip warning misstates its reason.** Phase 0 is excluded because
`chunk_id` must be ≥ 1 (REQ-PS-8, reason `unrepresentable-id`), but
`split-plan.ts:111-117` prints one message for every reason: *"the heading
declares no chunk number"*. It declares 0.

---

## Requirements

### Recording the files a section names

**REQ-IDX-12** — When a plan section names a file path outside its task lines,
the plan source shall record that path in the chunk's `files`.

A *file path* is a token whose last segment has an extension beginning with a
letter (`a.ts`, `tsconfig.base.json`; not `2.0`, not `.test.ts`) and which
either appears in a code span or fenced block, or contains a `/`. Bare prose
words such as `Node.js` or `e.g.` are not paths: authors put file names in
backticks or code blocks, and "wrong is worse than absent" (HLD).

**REQ-IDX-13** — Where a path contains a brace group, the plan source shall
record each expansion: `layout/{Sidebar,Header}.tsx` records
`layout/Sidebar.tsx` and `layout/Header.tsx`.

**REQ-IDX-14** — If a path contains a glob wildcard (`*` or `?`), then the plan
source shall not record it.

**REQ-IDX-15** — The plan source shall record each path in a chunk's `files`
once, in document order.

### Persisting them

**REQ-IDX-16** — Where a chunk has `files`, `PLAN_N.md` shall carry them in its
frontmatter, and reading the file back shall yield the same list. A `PLAN_N.md`
without `files` stays valid.

### Tagging from them

**REQ-IDX-17** — When `init` runs with `--yes`, the file index generator shall
tag a walked file to a chunk if the chunk's `files` names it, using the matcher
of REQ-RUN-2 and the ambiguity rule of REQ-RUN-3.

**REQ-IDX-18** — If every task in a chunk is done, then the file index
generator shall not tag files to that chunk on account of its `files`. A chunk
with no tasks still tags them. This mirrors REQ-RUN-1: finished work loads
nothing.

### Reporting

**REQ-PS-20** — When the CLI warns that a section carrying tasks was skipped,
it shall state that section's exclusion reason: no chunk number declared, or a
number a chunk id cannot hold.

(REQ-PS-20 belongs to the plan-sources area; it is recorded here because it was
found in the same run, and cross-listed in
[LLD-plan-sources.md](LLD-plan-sources.md).)

---

## Design

### Extraction — `plan-sources/file-refs.ts` (new, `core`)

```ts
/** Paths a plan section names outside its task lines (REQ-IDX-12..15). */
export function extractFileRefs(lines: readonly ScannedLine[]): string[];
```

It takes `ScannedLine`s from `scanLines` (`markdown-utils.ts:83`), which already
tracks `inFence`. Per line:

1. Skip task lines (`parseTaskLine` ≠ undefined). Tasks carry their own status,
   and a done task must not tag a file through the back door (REQ-IDX-18 is the
   chunk-level rule; this is the task-level one, already REQ-RUN-1's).
2. Collect candidate words: inside a fence, every whitespace-separated word;
   outside, the content of each `` `…` `` span split on whitespace, plus every
   bare word containing `/`.
3. Drop words containing `*` or `?` (REQ-IDX-14).
4. Expand brace groups (REQ-IDX-13). Expansion is capped at 64 results per
   word, so `{a,b}{c,d}{e,f}…` cannot multiply without bound — repo content is
   untrusted input (CLAUDE.md, trust boundary).
5. Strip trailing `.,;:)` punctuation and a leading `./`; keep the word if its
   last segment matches `^[^.]+(\.[^.]+)*\.[A-Za-z][A-Za-z0-9]{0,9}$`.
6. Reject anything `path.posix.normalize` makes absolute or `..`-leading.
7. Dedupe, preserving order (REQ-IDX-15).

Both shipped sources call it: `heading-source.ts` on each section's body,
`task-list-source.ts` on the whole document. A third-party `PlanSource` may set
`files` or not.

`collectSections` currently stores `bodyLines` as trimmed strings and loses
`inFence`. It changes to store `ScannedLine`s; `readBody` and `countTasks` read
`.trimmed`.

### Schema — `PlanChunkSchema.files` (optional)

```ts
/** Repository paths the chunk's section names outside its tasks (REQ-IDX-12). */
files: z.array(z.string().min(1)).optional(),
```

Optional and additive, per the HLD's cross-cutting rule; `PROTOCOL.md`'s
`PLAN_<n>.md` section gains the key in the same commit. The schema is
`.strict()`, so an older build reading a newer `PLAN_N.md` that carries `files`
fails — the same trade every optional key has made (`est_sessions`,
`project_name`), and the reason the open tension on conformance rule 5 is
recorded rather than resolved here.

`PlanParser.toMarkdown` (`plan-parser.ts:176`) writes `files:` as a YAML list of
JSON-quoted strings after `depends_on`, only when non-empty. The body gains a
`### Files` list so a human reading `PLAN_N.md` sees what the frontmatter says.

### Matching — `referencedFiles` (reuse)

`referencedFiles(chunks, files)` (`file-reference.ts:141`) gains a second loop
per chunk: unless the chunk has tasks and every one is done (REQ-IDX-18), feed
each entry of `chunk.files` through the same `pathTokens` → `resolveToken`
path the task loop uses. No new matcher: REQ-RUN-5 requires the layer resolver
and the index generator to agree, and both already go through this module.

The module comment at `:4` is corrected — plans can carry a file list.

`generate-index.ts`'s message changes from "from task text" to "from the plan"
(REQ-RUN-6 still holds: it reports tagged vs. left counts).

### Warning — `split-plan.ts:111-117`

Switch on `excluded.reason`:
- `no-position-declared` → "the heading declares no chunk number."
- `unrepresentable-id` → "chunk ids start at 1, so a chunk numbered below 1
  cannot be stored."

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-IDX-12 | unit | `file-refs.test.ts`: fenced path, backticked path, bare `a/b.ts` recorded; bare `Node.js`, `2.0`, `e.g.`, a directory `apps/shell/` not |
| REQ-IDX-12 | unit | A checkbox task's path is not in `files` |
| REQ-IDX-13 | unit | `layout/{Sidebar,Header,ContentArea}.tsx` → three paths; a 2^10 brace bomb is capped at 64 |
| REQ-IDX-14 | unit | `__tests__/*.test.ts` not recorded |
| REQ-IDX-15 | unit | A path named twice is recorded once, at its first position |
| REQ-IDX-12 | integration | `plan-dialects.integration.test.ts`: a `## Phase N:` plan with numbered tasks and a Key Files fence, through `parsePlan` |
| REQ-IDX-16 | unit | `toMarkdown` → `PlanChunkManager` read → identical `files`; a chunk without `files` round-trips without the key |
| REQ-IDX-17 | unit | `referencedFiles` tags from `files`; a basename two walked files share tags neither |
| REQ-IDX-18 | unit | All tasks done → no tags from `files`; zero tasks → tags |
| REQ-IDX-17 | e2e | `init -y` on a Key-Files fixture: `FILE_INDEX.md` tags the named files to their chunk, and the prompt's load line names them |
| REQ-PS-20 | e2e | A `## Phase 0:` section's warning names the id, not "declares no chunk number" |
| all | eval | `pnpm eval --local --target evals/targets/devnexus.local.json`: prompt recall and tag recall move off 0 |

Assertions run against parser and CLI output. Plan text in fixtures is input,
not expected output.

### What actually happened

| Requirement | Outcome |
|---|---|
| REQ-IDX-12..15 | **Failed first** — module missing. Passed once `file-refs.ts` existed |
| REQ-IDX-16 | **Failed first** — `files` read back as `undefined` until the schema and `toMarkdown` carried it |
| REQ-IDX-17 | **Failed first** in unit and integration; the e2e passed on the first build with the code in place |
| REQ-IDX-18 | "All done → no tags" **passed before the change**, trivially, since nothing tagged from `files` yet; it is a regression lock. "No tasks → tags" and "partly done → tags" failed first |
| REQ-PS-20 | Written with the e2e; the old message would have failed it |

`pnpm eval --local --target` on DevNexus, before → after:

| | 2.4.2 | this change |
|---|---|---|
| Tag recall, chunks 1–9 | 0/47 | **47/47** |
| Prompt recall, chunk 1 | 0/11 | 5/11 |
| Paths declared / grounded | 1 / 100% | 49 / 100% |
| Run | FAIL | clean |
| Benchmark | n/a — 0 files | 12 files, 926 tokens |

Every tag beyond the Key Files lists traces to plan prose: chunk 1's
`tsconfig.base.json` (numbered task 3) and chunk 3's `mfe-registry.ts`
("Register in shell's `mfe-registry.ts`"). No tag was wrong.

Prompt recall stops at 5/11 because a load line shows six refs and then
`+N more` (`formatter-utils.ts:295`, with private copies in four formatters).
The other files are in `FILE_INDEX.md`, which the managed block tells the agent
to read. Whether the line should show more is a prompt-shape question for HLD
feature 4, not this one.

---

## Out of scope

- **The section body itself.** `PLAN_N.md` still drops the goal, numbered tasks
  and Definition-of-Done distinction; the agent sees DoD checkboxes as its task
  list. Retaining the body changes what a "task" is, which is a bigger decision
  than file tagging and wants its own LLD (it touches HLD feature 4).
- **Directories.** `apps/mfe-api/src/app/components/request-builder/` names a
  directory. Tagging every file under it could evict better entries from a
  capped load list; left out until there is evidence it helps.
- **Interactive tagging and tagging-on-touch** — the rest of HLD feature 3.
- **Chunk id 0.** Still unrepresentable (REQ-PS-8); only the message changes.
- **Starting position.** `init` begins at chunk 1 with every task `todo` even
  where the code for later phases exists. Inferring progress is a separate
  problem.
