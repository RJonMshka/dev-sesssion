# METHOD — how we plan and build dev-sesssion

This is the working method for **developing this repository**. It is not a
feature of the CLI, it does not appear in `.session/`, and nothing here ships to
users. If you are looking for the on-disk format the tool manages, read
[PROTOCOL.md](../PROTOCOL.md) instead.

Work moves through four states: **HLD → LLD → tests → code**. Each one produces
something written down before the next begins.

---

## Where plans live

```
docs/plan/
├── HLD.md                    # architecture across all in-flight work
├── LLD-<feature>.md          # one per feature, carries its EARS requirements
└── …
```

One HLD. One LLD per feature. An LLD is written when that feature is about to be
built, not months ahead — a design written against a codebase you have not read
recently is fiction.

`.session/` is **not** used for planning this repo, and no longer exists in it.
The project was planned that way through chunk 19; what survives of that is in
[archive/](archive/README.md). See [Why not .session/](#why-not-session) below.

---

## HLD — high-level design

One document, revised as work lands. It answers questions that span features:

- What are the moving parts, and which package owns each one?
- What are the contracts between them?
- What existing code is being reused, and what is genuinely new?
- What is deliberately *not* being built, and why?

It does not contain requirements, signatures, or file lists. If a statement is
only true of one feature, it belongs in that feature's LLD.

Keep it short. An HLD that needs a table of contents has become an LLD.

---

## LLD — low-level design

One per feature. Structure:

```markdown
# LLD — <feature>

## Problem
What is wrong today, stated as observable behaviour. Cite file:line.

## Requirements
EARS statements, each with a stable id. This is the contract.

## Design
Types, signatures, and the modules they live in. Reuse called out explicitly.

## Test plan
Which requirement each test covers, and at which level (unit/integration/e2e).

## Out of scope
What a reader might reasonably expect and will not get.
```

The **Problem** section must cite real code. "The parser is inflexible" is not a
problem statement; "`plan-parser.ts:22` hard-codes `^## ` so a plan written in
h3 yields zero chunks and dies at `split-plan.ts:84`" is.

---

## EARS — writing requirements

EARS (Easy Approach to Requirements Syntax) constrains a requirement to one of
five shapes. The value is not the grammar; it is that each shape forces you to
say **when** the behaviour applies, which is the part people skip.

| Pattern | Shape |
|---|---|
| Ubiquitous | The \<system\> shall \<response\>. |
| Event-driven | **When** \<trigger\>, the \<system\> shall \<response\>. |
| State-driven | **While** \<state\>, the \<system\> shall \<response\>. |
| Unwanted behaviour | **If** \<condition\>, **then** the \<system\> shall \<response\>. |
| Optional feature | **Where** \<feature\>, the \<system\> shall \<response\>. |

Complex requirements combine them (`While … when … the system shall …`), but a
requirement needing three clauses is usually two requirements.

Real examples, taken from bugs this repo actually shipped:

> **REQ-IDX-1** — When a section heading names no chunk the index can represent,
> the file index parser shall end the current section.
>
> **REQ-IDX-2** — Where a `FILE_INDEX.md` already exists, save shall preserve its
> section order, heading text, and non-table content.
>
> **REQ-DRY-1** — While dry-run is active, `update` shall not modify any file
> under `.session/`.
>
> **REQ-PS-3** — If no plan source matches the input above the confidence
> threshold, then the CLI shall report the candidates and their scores rather
> than selecting one.

### Rules

1. **"Shall", always.** Not "should", "will", "must". One word means one thing.
2. **One testable claim per requirement.** If you cannot write a single failing
   test for it, split it.
3. **Name a concrete subject.** "The system" is acceptable at HLD level; an LLD
   should say "the file index parser".
4. **No implementation.** *What*, observably, not *how*. `shall use a Map` is a
   design note; `shall preserve section order` is a requirement.
5. **Requirements are append-only within a feature.** Ids are never reused or
   renumbered. Delete by marking `~~REQ-X-4~~ withdrawn — <reason>`, because
   commit messages and test names cite them.

### Ids

`REQ-<AREA>-<n>` — area is a short uppercase code declared at the top of the
LLD, `n` counts from 1 within that area.

| Area | Scope | LLD |
|---|---|---|
| `IDX` | File index parsing, layout, and auto-tagging | `LLD-session-integrity.md`, `LLD-file-index.md` |
| `CHK` | Chunk ids — discovery, ordering, representation | `LLD-session-integrity.md` |
| `DRY` | Dry-run contract | `LLD-session-integrity.md` |
| `PS` | Plan sources — parsing plans of varying formats | `LLD-plan-sources.md` |
| `SYM` | Symbol rendering — the `symbols` command | `LLD-symbols.md` |
| `WF` | Workflow-shaped `NEXT_PROMPT.md` | `LLD-workflow-prompt.md` |

Add a row when you add an area. Ids are global once written down: they appear in
test names, in code comments above the block that satisfies them, and in commit
messages.

---

## TDD

The loop, per requirement:

1. Write the test. Name it for the requirement: `it("ends the section on an
   unmappable heading (REQ-IDX-1)")`.
2. **Run it and watch it fail.** A test that has never failed has not been shown
   to test anything. If it passes immediately, the behaviour already existed —
   say so in the LLD and move on.
3. Write the smallest code that passes it.
4. Run the full suite, not just the new test.

### Test rules specific to this repo

- **Assert against real generator output, never hand-written fixture lines.**
  This repo has been bitten twice by fixtures that encoded what the author
  *believed* the emitter produced. Both times the emitter and parser drifted and
  every test stayed green. See
  `packages/adapters/src/__tests__/bootstrap-formatter-dedupe.test.ts` for the
  pattern, and `tests/fixtures/messy-file-index/` for a captured real document
  used as an integration fixture.
- Prefer a real, messy input over a tidy synthetic one. The FILE_INDEX
  round-trip bug was invisible to every synthetic fixture and obvious against a
  document maintained by hand.
- The remaining conventions — subprocess-only CLI tests, temp dirs, ANSI
  stripping — are in [CLAUDE.md](../CLAUDE.md).

---

## Definition of done

A feature is done when:

- [ ] Every requirement in its LLD has at least one test naming it
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` are clean
- [ ] Docs affected by the change are updated in the same commit
- [ ] The LLD's **Out of scope** section reflects what was actually left out

The gate is **advisory**. Nothing in CI enforces requirement coverage, and no
command refuses to run because a requirement lacks a test. The discipline is the
point, not the enforcement — a gate people route around teaches worse habits
than a checklist people read.

---

## Commits

Conventional commits, because `semantic-release` derives versions from them
(`fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major).

Cite requirement ids in the body when a commit satisfies them. A commit that
fixes real behaviour should state what was observably wrong, not what was
edited — `git diff` already shows what was edited.

---

## Why not .session/

`.session/` is the format this tool manages for its users, and this repo used it
to plan itself through chunk 19. It is gone now.

The reason is that chunks and designs answer different questions. A chunk is a
unit of *session scheduling* — what to load, what is active, what is next. An
LLD is a unit of *design* — what the thing must do and why. Forcing a design
into a chunk's frontmatter made the design hard to read and the chunk hard to
schedule, and the plan files ended up as neither.

Two consequences to be aware of:

1. **We no longer dogfood the tool on itself.** That is a real cost: running
   `dev-sesssion` against this repo is what surfaced the FILE_INDEX
   mis-attribution, the lossy round-trip, and the ignored `--dry-run` flag —
   three data-loss bugs, none of which any test caught. That coverage now has to
   come from the eval harness (`evals/`) and from fixtures captured out of real
   projects instead — `tests/fixtures/messy-file-index/` is that repo's own
   index, kept verbatim for exactly this reason.
2. **Do not run `dev-sesssion` against this repository.** `init`, `update`,
   `advance` and `index` would recreate `.session/` and reintroduce the split
   the removal was meant to end. `/.session/` is gitignored so an accidental run
   stays out of the tree.

What the directory held, and where the parts of it that were worth keeping went,
is documented in [archive/README.md](archive/README.md).
