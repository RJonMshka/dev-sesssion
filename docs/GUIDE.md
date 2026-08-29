# dev-sesssion: the complete guide

This guide explains the **ideas** — what the pieces are, why they exist, and how
a session actually runs day to day. It deliberately does not restate reference
material that lives elsewhere:

| For | Read |
|---|---|
| Installing and your first session | [getting-started.md](getting-started.md) |
| Every command, flag and exit code | [commands.md](commands.md) |
| Per-tool detection and output formats | [adapters.md](adapters.md) |
| Shared repos: what is committed | [team-mode.md](team-mode.md) |

---

## What problem does this solve?

AI coding assistants like Claude, Cursor, and opencode are powerful — but they suffer from a fundamental limitation: **they forget everything when the conversation ends**. Start a new session tomorrow, and the AI has no idea what you built yesterday, which files matter, what decisions you made, or where you left off. You spend the first 10 minutes of every session just re-explaining your project.

This gets worse as projects grow. A large codebase has hundreds of files, but the AI's **context window** (think of it as a whiteboard that gets fully erased after each meeting) can only hold a fraction of them. Load too many files and you waste tokens on irrelevant code. Load too few and the AI makes assumptions that break things.

`dev-sesssion` solves both problems. It gives your project a **persistent brain** — a `.session/` directory that survives between conversations. At the start of each session, you paste one short prompt and the AI knows exactly where it left off, which files to load, and what to do next. No re-explaining. No wasted context.

---

## 🗂️ The analogy: a hospital shift handoff

Imagine a hospital where nurses work 8-hour shifts. When Nurse A's shift ends and Nurse B arrives, A doesn't just say "good luck!" and leave. She writes a **handoff note**: which patients are critical, what medications were given, what tests are pending, and what needs to happen next.

Nurse B reads that note, walks the ward, and picks up exactly where A left off — without interviewing every patient from scratch.

`dev-sesssion` is that handoff system for AI coding sessions. The `.session/` directory is the nurses' station. `SESSION_STATE.md` is the handoff note. `NEXT_PROMPT.md` is the exact text Nurse B reads first thing in the morning. And you, the developer, are the charge nurse who decides what gets written down.

---

## Core concepts

### 1. The `.session/` directory — the brain 🧠

Running `dev-sesssion init` creates a `.session/` folder at your project root. This folder is the source of truth for everything the AI needs to resume work. It contains:

```
.session/
├── SESSION_STATE.md   — current status, active chunk, task list, notes
├── FILE_INDEX.md      — master list of every file the AI should know about
├── PLAN_1.md          — the tasks for chunk 1
├── PLAN_2.md          — the tasks for chunk 2
├── NEXT_PROMPT.md     — the ready-to-paste session start prompt
├── ROUTINES.md        — the bootstrap and self-update rituals
└── DONE_LOG.md        — archive of completed chunks (created after first advance)
```

None of these files are magic — they're plain Markdown. You can read and edit them directly. `dev-sesssion` just manages them so you don't have to.

---

### 2. Chunks — breaking the road trip into legs

Think of your project as a long road trip from New York to Los Angeles. You wouldn't try to drive it all in one sitting — you'd break it into legs: "Day 1: NYC to Chicago. Day 2: Chicago to Denver. Day 3: Denver to LA."

A **chunk** is exactly that: one focused leg of your project's journey. Each chunk has:
- A title (e.g., "Authentication system")
- A list of tasks to complete
- A set of files that are relevant to those tasks

The AI only loads the files for the *current* chunk. This keeps the context window lean and focused. When all tasks in a chunk are done, you `advance` to the next one.

Chunks live in `.session/PLAN_N.md` files — `PLAN_1.md` for chunk 1, `PLAN_2.md` for chunk 2, and so on.

**Example chunk file (`.session/PLAN_2.md`):**

```markdown
---
chunk_id: 2
title: "User authentication"
---

# Chunk 2 — User authentication

## Tasks
- [ ] Implement JWT token generation
- [ ] Add login/logout endpoints
- [ ] Write middleware for protected routes
- [ ] Tests for auth flow
```

---

### 3. `FILE_INDEX.md` — the table of contents

Imagine a thick textbook. Without a table of contents, you'd have to flip through every page to find what you need. With one, you jump straight to chapter 7.

`FILE_INDEX.md` is the table of contents for your codebase. Every file the AI might need is listed here, tagged with the chunk(s) it belongs to. At the start of a session, the AI looks up the active chunk number, filters the index, and loads only those files.

**Example entry in `FILE_INDEX.md`:**

```markdown
## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |

## Chunk 2 — User authentication

| File | Purpose |
|---|---|
| src/auth/jwt.ts | JWT generation and validation |
| src/auth/middleware.ts | Auth middleware for Express routes |
| src/users/user.model.ts | User schema — needed for auth too |
```

Files are grouped by heading, not by a column: the `## Always Include` group
(chunk tag `0`) is loaded in every session regardless of the active chunk — use
it for your `CLAUDE.md`, key config files, or anything the AI should always know
about. Each `## Chunk N` group is loaded only while chunk N is active. A file
needed by two chunks is listed under both.

> **Large repos:** If your project has more than 500 indexed files, `dev-sesssion` automatically
> splits the index into `FILE_INDEX_1.md`, `FILE_INDEX_2.md`, etc. You never need to manage this
> manually — load and save work the same way. Use `--max-files` on `dev-sesssion init` to cap
> how many files get indexed in the first place.

---

### 4. `SESSION_STATE.md` — the handoff note

This is the sticky note your previous self leaves for the next session. It tracks:
- Which chunk is currently active
- The status of each task (to-do, in progress, done)
- Notes from recent sessions ("decided to use Prisma instead of Knex")
- Which files were last worked on

The AI reads this first. It tells the AI "you're on chunk 3, these 2 tasks are done, these 3 are still pending, and you were last editing `src/payments/stripe.ts`."

---

### 5. `NEXT_PROMPT.md` — the ignition key

This is a short (≤20 lines by default), self-contained prompt that you paste at the start of every AI session. It tells the AI:
- What project this is
- Which chunk is active and what the goal is
- Exactly which files to load
- What was done last time and where to pick up

`dev-sesssion update` regenerates this file automatically after you mark tasks done. Think of it as the ignition key — one paste and the engine starts.

**Example `NEXT_PROMPT.md`:**

```
Project: my-saas-app
Active chunk: 3 — Billing integration
Budget: ~2180/4000 tokens [OK]
Load: CLAUDE.md, src/billing/stripe.ts, src/users/subscription.ts
Do NOT read: src/auth/**, dist/
Resume: 4/7 tasks done Chunks 1-2 done.
Last touched: src/billing/webhooks.ts
Next:
  [ ] POST /billing/upgrade endpoint
  [ ] Prorate calculation logic
  [ ] Tests for upgrade/downgrade
Note: decided to use Prisma instead of Knex
```

(The exact wording of the file-reference lines depends on the adapter — Claude
Code writes `@`-mentions, Cursor and Windsurf write `Ignore:` instead of
`Do NOT read:`. See [adapters.md](adapters.md).)

---

### 6. Context budget — the word count limit

Every AI session has a **token budget** — like a word count limit on an essay. Load too many files and you blow the budget; load too few and the AI is working blind.

`dev-sesssion` tracks a context budget estimate for each session, calculated from the files tagged to the active chunk. When you run `dev-sesssion status`, it shows you how much budget you're using and warns you if you're over the limit.

> **Rule of thumb:** if you're consistently over budget, split the chunk in two. If you're well under, you might be able to merge two small chunks.

---

## Getting started

```bash
npx dev-sesssion init
```

The wizard detects your plan and AI tool, asks whether this is a personal or a
team repo, splits an existing `PLAN.md` into chunks (or scaffolds one with you),
walks the codebase to build `FILE_INDEX.md`, and writes the session files.

The five phases, the flags, and the non-interactive path are covered in
[getting-started.md](getting-started.md).

---

## How it works day-to-day

The daily workflow has three moments: **start**, **during**, and **end**.

### Start of session — paste the prompt

Open your AI tool (Claude, Cursor, etc.) and paste the contents of `NEXT_PROMPT.md`.

```bash
# Print it:
dev-sesssion prompt

# Or copy it to clipboard:
dev-sesssion prompt --copy
```

The AI reads the prompt, loads only the files listed, confirms the plan, and waits for you to say "go."

### During the session — code normally

Work as you normally would. The AI builds features, fixes bugs, writes tests. `dev-sesssion` doesn't interfere during the session.

### End of session — update and regenerate

When you're done (or taking a break), run:

```bash
dev-sesssion update
```

This launches an interactive wizard that:

1. **Marks tasks done** — shows you the pending tasks as a checklist; pick the ones you completed.
2. **Adds session notes** — optionally type a note ("decided to use Zod instead of Yup for validation").
3. **Detects last-worked files** — reads `git status` and suggests which modified files to track.
4. **Regenerates `NEXT_PROMPT.md`** — writes a fresh, up-to-date handoff prompt for next time.
5. **Secret scan** — checks the prompt content for accidentally included API keys or tokens.

After `dev-sesssion update`, your `.session/` is up to date and `NEXT_PROMPT.md` is ready for the next session.

### When a chunk is complete — advance

When all tasks in the active chunk are done, `dev-sesssion status` will tell you:

```
⚠ All tasks in active chunk are done — run `dev-sesssion advance` to move to the next chunk
```

Run:

```bash
dev-sesssion advance
```

This:
1. Archives the completed chunk to `DONE_LOG.md` (so you have a record)
2. Compacts the session state (cleans up old notes)
3. Advances `active_chunk` to the next number
4. Regenerates `NEXT_PROMPT.md` for the new chunk

Think of it like tearing off the completed leg of your road trip map and unfolding the next section.

---

## Command reference

Every command, flag, exit code and JSON shape is in
[commands.md](commands.md). The ones that make up the daily loop are `prompt`,
`update`, `advance` and `status`; the rest you reach for occasionally:

| Command | Reach for it when |
|---|---|
| `init` / `migrate` | Setting up a project, or every package of a monorepo |
| `prompt` | Starting a session — print or `--copy` the handoff |
| `update` | Ending a session — mark tasks done, regenerate the prompt |
| `advance` | The active chunk is finished |
| `status` | You want to know where you are and whether you're over budget |
| `index add` / `index audit` | A new file should be known, or old entries went stale |
| `health` | Something feels off — a linter for the session files |
| `verify` | You want to know whether the session state is *true*, per git |
| `preview` / `trim` / `lint-context` / `compact` | Tuning what the context actually costs |
| `import` / `export` | Reusing rules you already wrote for another tool |
| `memory` | Reviewing how past sessions actually used their context |
| `mcp` | Serving session state to a tool over MCP instead of pasting |

---

## Adapters — fitting different AI tools

Think of an **adapter** like a power plug adapter when you travel abroad. The
electricity — your session data — is the same; only the shape of the connector
changes. Each AI tool has its own conventions for how it reads context, and the
adapter translates dev-sesssion's output into that shape.

Four are built in — Claude Code, opencode, Cursor and Windsurf — auto-detected
from files in your project root, with a plain-text fallback when nothing
matches. Override with `--adapter <name>`, or register your own with
`registerAdapter()`.

Detection order, the exact output each one writes, and how to switch: see
[adapters.md](adapters.md). To write a new one, see
[authoring-adapters.md](authoring-adapters.md).

---

## Team mode

When several developers use AI assistants on the same codebase, each has their
own session state — and without help, that means merge conflicts. Team mode
splits the difference: the **shared project structure** (`FILE_INDEX.md`,
`PLAN_N.md`, `ROUTINES.md`) is committed, while **per-developer state**
(`SESSION_STATE.md`, `NEXT_PROMPT.md`, `DONE_LOG.md`) stays local. `init --team`
writes both the `.gitignore` and the `.gitattributes` rules that make this work.

The full file-by-file breakdown is in [team-mode.md](team-mode.md).

---

## Advanced usage

### Dry-run everything before committing

Not sure what a command will do? Run it with `--dry-run` first:

```bash
dev-sesssion init --dry-run
dev-sesssion advance --dry-run
```

Dry-run logs every file that would be written without touching the filesystem.

### Changing the prompt line cap

`NEXT_PROMPT.md` is capped at **20 lines** by default. To change it for a project, add
`max_prompt_lines` to the `SESSION_STATE.md` frontmatter — any integer from **5 to 50**:

```yaml
---
active_chunk: 3
session_id: "chunk-3-billing"
last_updated: "2026-04-07"
max_prompt_lines: 12
---
```

The cap is threaded through to the formatter, so the generated prompt is trimmed to fit rather
than being rejected afterwards. It is written back to `SESSION_STATE.md` only when it differs
from the default, so state files that never set it stay untouched.

Lower it (10–15) to force yourself to lean harder on `FILE_INDEX.md`; raise it (30–50) for a
large chunk whose task list genuinely needs the room. Out-of-range values are rejected when the
state file is parsed.

Every command that touches the prompt reads the same setting: `init`, `update`, and
`advance` trim and validate against it, and both `dev-sesssion status` and
`dev-sesssion health` warn against it rather than against the default.

### Scriptable JSON output

Pipe `dev-sesssion status --json` into `jq` or other tools:

```bash
# Is the session over budget?
dev-sesssion status --json | jq '.budget.over_budget'

# How many tasks are done?
dev-sesssion status --json | jq '.tasks.percent_complete'
```

`status`, `health`, `preview`, `lint-context` and `memory` all take `--json`.
The full shape of each is in [commands.md](commands.md).

### CI integration

Use `--yes` and `--dry-run` in CI pipelines to validate that `dev-sesssion` is correctly configured without modifying files:

```yaml
# .github/workflows/ci.yml
- name: Validate dev-sesssion setup
  run: dev-sesssion status --json
```

`dev-sesssion verify` is the stronger gate — it exits non-zero when the session
state claims work that git has no record of.

---

## FAQ / Troubleshooting

**Q: I ran `dev-sesssion update` but `NEXT_PROMPT.md` didn't change.**

The prompt is regenerated from `SESSION_STATE.md`. If you didn't mark any tasks done or add notes, the output will be nearly identical to the previous prompt. That's expected.

---

**Q: My context budget shows "heuristic" — is that inaccurate?**

The heuristic estimates ~4 characters per token. It's accurate within ±20% for typical source code. The budget shows `accurate: true` only when an exact token counter is wired in via the external token counter interface. For daily use, the heuristic is good enough to catch over-budget situations.

---

**Q: I deleted a file and now `dev-sesssion index audit` is complaining.**

That's expected. Run:

```bash
dev-sesssion index audit --fix
```

It will show you the stale entries and ask if you want to remove them. Answer yes.

---

**Q: `dev-sesssion advance` says "No PLAN_4.md found — cannot advance beyond the last chunk."**

You've completed all your planned chunks. This is a good problem to have! You have two options:
- Create a new `PLAN_N.md` manually for the next phase of work
- Run `dev-sesssion init` again to scaffold a new plan (it will ask before overwriting)

---

**Q: How do I add notes without marking tasks done?**

Run `dev-sesssion update`, press Enter through the task checklist (select nothing), and type your note in the notes prompt. The note will be saved to `SESSION_STATE.md` and included in the next `NEXT_PROMPT.md`.

---

**Q: Someone else on my team committed `FILE_INDEX.md` with different entries. I have a merge conflict.**

If you enabled team mode, this shouldn't happen — the `.gitattributes` rule uses `merge=ours`. If you didn't enable team mode, either:
- Re-run `dev-sesssion init --team` to apply the patches, then resolve the conflict manually this once
- Manually add `.session/FILE_INDEX.md merge=ours` to your `.gitattributes`

---

**Q: Can I use dev-sesssion without a `PLAN.md`?**

Yes. The `init` wizard's scaffold path handles this case. It walks you through creating chunks from scratch via prompts. You don't need a pre-existing plan.

---

**Q: My `NEXT_PROMPT.md` is longer than 20 lines. Does that break anything?**

It can't get that way from a generated prompt — the formatter trims to the cap and
spends the last line on a `[N more lines trimmed — see .session/SESSION_STATE.md]`
marker, and `NextPromptWriter.write()` validates before it persists, so output over
the cap (or missing a required field) is refused rather than written. A *hand-edited*
file that exceeds the cap is what gets flagged: both `dev-sesssion health` (`PROMPT_TOO_LONG`) and
`dev-sesssion status` report it against your configured cap.

Only non-empty lines count, so a trailing newline never pushes a prompt over.

The limit is a discipline enforcer: a prompt that keeps hitting it usually means
you're cramming context into the prompt itself rather than letting `FILE_INDEX.md`
do the work. See [Changing the prompt line cap](#changing-the-prompt-line-cap) to
adjust it.

---

**Q: How do I handle a monorepo where only some packages use AI?**

Run `dev-sesssion migrate` from the monorepo root. It detects all workspace packages and lets you
select which ones to initialize. Packages you skip won't be touched. You can always run `migrate`
again later to initialize additional packages.

---

**Q: `dev-sesssion health` reports `STALE_INDEX_ENTRIES`. What do I do?**

Run:

```bash
dev-sesssion health --fix
```

It will list the stale files and ask for confirmation before removing them. Pass `--yes` to skip
the prompt. This is the same operation as `dev-sesssion index audit --fix`, but surfaced more
prominently via the health check.

---

**Q: I already have rules in `CLAUDE.md`. Do I need to re-enter them?**

No. Run:

```bash
dev-sesssion import --from claude
```

Every `##` section in your `CLAUDE.md` becomes a note in `SESSION_STATE.md`. The AI can then
reference those rules at the start of each session without loading the full `CLAUDE.md` file.

---

**Q: My repo has thousands of files and `dev-sesssion init` indexed all of them.**

Use `--max-files` to cap the index:

```bash
dev-sesssion init --max-files 150
```

Files are indexed in walk order (alphabetical, `.gitignore`-aware). Generated files and
dependencies that you haven't already excluded via `.gitignore` are common culprits — add them
to `.gitignore` first, then re-run init.

---

*Released changes are listed in [CHANGELOG.md](../CHANGELOG.md). Contributing:
[CONTRIBUTING.md](../CONTRIBUTING.md).*
