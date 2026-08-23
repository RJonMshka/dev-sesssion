# dev-sesssion: the complete guide

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

### Installation

```bash
# In any project directory:
npx dev-sesssion init
```

No global install needed. You can also install globally if you prefer:

```bash
npm install -g dev-sesssion
dev-sesssion init
```

### The init wizard

When you run `dev-sesssion init`, a wizard walks you through setup in five phases:

**Phase 1 — Detection** (automatic)

`dev-sesssion` scans your project and detects:
- Whether you have an existing `PLAN.md` file
- Which AI tool you're using (Claude Code, Cursor, opencode)
- Your project name from `package.json`
- Whether a `.session/` directory already exists

**Phase 2 — Team or personal mode**

```
? How is this session being used?
  ❯ Personal  (session files are local only)
    Team      (auto-adds .gitignore + .gitattributes for shared repos)
```

Choose **Personal** if you're the only developer. Choose **Team** if multiple developers will work with AI on this project — it patches `.gitignore` to keep session files local by default and adds a `.gitattributes` rule so `FILE_INDEX.md` doesn't create merge conflicts.

**Phase 3 — Plan setup (three paths)**

The wizard takes one of three paths depending on what it found:

| Situation | What happens |
|---|---|
| You have a `PLAN.md` | It splits your plan into chunks automatically |
| You have no plan | It runs an interactive scaffolding wizard |
| You abort the split | It falls back to the scaffolding wizard |

The **split path** reads your `PLAN.md` and detects natural chunk boundaries (headers, sections). It shows you a preview and asks for confirmation.

The **scaffold path** asks you a few questions:
- Project name
- What are you building?
- Break it into phases (each phase becomes a chunk)

**Phase 4 — FILE_INDEX generation** (automatic)

`dev-sesssion` walks your codebase (respecting `.gitignore`), estimates which files belong to which chunks based on directory structure, and builds a starter `FILE_INDEX.md`. You'll refine this over time.

**Phase 5 — Final writes**

It writes `SESSION_STATE.md`, `NEXT_PROMPT.md`, `ROUTINES.md`, and patches `.gitignore` if needed.

```
✔ Init complete. 4 chunks, 47 indexed files. Paste NEXT_PROMPT.md to start your first session.
```

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

All commands accept these global flags:

| Flag | Description | Default |
|---|---|---|
| `--cwd <path>` | Run as if in a different directory | current dir |
| `-y, --yes` | Skip prompts, use defaults | false |
| `--dry-run` | Show what would change without writing | false |
| `-v, --verbose` | Show detailed output | false |
| `--strict` | Block (not just warn) on secret detection | false |
| `--adapter <name>` | Force a specific adapter (`claude`, `opencode`, `cursor`, `windsurf`) | auto-detect |

---

### `dev-sesssion init`

Initializes `dev-sesssion` in the current project. Runs the full wizard.

```bash
dev-sesssion init
dev-sesssion init --team          # skip team/personal prompt, go straight to team mode
dev-sesssion init --yes           # no prompts, use all defaults (personal mode)
dev-sesssion init --dry-run       # preview what would be written
dev-sesssion init --max-files 200 # cap the FILE_INDEX at 200 files (useful for large repos)
```

**When to use:** Once, when setting up a new project. Re-running it on an existing session will ask if you want to reinitialize.

> **Large repo tip:** On a monorepo or a project with many generated files, the codebase walk can
> pick up hundreds of files you don't need the AI to know about. Pass `--max-files <n>` to cap the
> index. Files are indexed in walk order (alphabetical, `.gitignore`-aware), so the most important
> source files — which tend to appear first — are prioritized.

---

### `dev-sesssion status`

Shows the current health of your session at a glance.

```bash
dev-sesssion status
dev-sesssion status --json        # machine-readable output (for scripts/CI)
dev-sesssion status --verbose     # show in-progress and todo counts separately
```

**Example output:**
```
● Active chunk: 3 — Billing integration
● Session: chunk-3-billing
● Last updated: 2026-04-07 (today)
● Tasks: [==========>         ] 55% (6/11 done)
● Files: 8 in context, 2 always-include, 54 indexed
● Budget: ~3,840 / 4,000 tokens (heuristic)
⚠ NEXT_PROMPT.md has 22 lines (max 20) — consider regenerating
```

**Warnings to pay attention to:**

| Warning | What it means | What to do |
|---|---|---|
| `NEXT_PROMPT.md has N lines (max 20)` | Prompt grew too long (the max shown is your configured `max_prompt_lines`) | Run `dev-sesssion update` to regenerate |
| `always-include list has N files` | Too many "always load" files | Tighten the list; move some to chunk tags |
| `Context budget exceeded` | Session will be token-heavy | Remove large files or split the chunk |
| `All tasks done` | Chunk is complete | Run `dev-sesssion advance` |

---

### `dev-sesssion update`

Interactively marks tasks done, adds notes, and regenerates `NEXT_PROMPT.md`.

```bash
dev-sesssion update
dev-sesssion update --yes         # auto-update from git status only, no prompts
dev-sesssion update --strict      # fail if secrets are detected in the prompt
```

**When to use:** At the end of every coding session, before closing your AI tool.

---

### `dev-sesssion advance`

Archives the current chunk and moves to the next one.

```bash
dev-sesssion advance
dev-sesssion advance --yes        # force-advance even if tasks are incomplete
```

> **Good to know:** `advance` warns you if tasks are still pending. It won't advance without your confirmation — unless you pass `--yes`.

**When to use:** When all tasks in the active chunk are done and you're ready to start the next leg.

---

### `dev-sesssion prompt`

Prints `NEXT_PROMPT.md` to stdout for piping or copying.

```bash
dev-sesssion prompt               # print to terminal
dev-sesssion prompt --copy        # copy to clipboard (uses pbcopy/xclip/clip.exe)
```

**When to use:** At the start of every AI session. Pipe it, copy it, or display it — then paste it into your AI tool.

---

### `dev-sesssion index add <filepath>`

Adds a file to `FILE_INDEX.md`.

```bash
dev-sesssion index add src/payments/stripe.ts
dev-sesssion index add src/payments/stripe.ts --yes   # auto-tag to active chunk
```

The interactive version asks:
- Which chunk(s) should this file belong to?
- What's the purpose of this file? (one line description)

**When to use:** Whenever you create a new file that the AI should know about. You can also do this at the end of a session during `update` — but `index add` is more precise.

---

### `dev-sesssion index audit`

Scans `FILE_INDEX.md` for stale entries (files that no longer exist).

```bash
dev-sesssion index audit          # report stale entries
dev-sesssion index audit --fix    # interactively remove stale entries
dev-sesssion index audit --fix --yes   # auto-remove without prompting
```

**When to use:** Periodically, or after a big refactor where files were renamed or deleted.

---

### `dev-sesssion migrate`

Initializes `dev-sesssion` in every package of a monorepo workspace.

```bash
dev-sesssion migrate              # detect workspace, pick packages interactively
dev-sesssion migrate --yes        # init all uninitialzed packages automatically
```

`migrate` detects pnpm workspaces, Nx, Turborepo, and npm/yarn workspaces. For each package that doesn't already have a `.session/` directory, it runs the full `init` wizard.

**When to use:** When adding `dev-sesssion` to a monorepo that has multiple packages.

---

### `dev-sesssion health`

Audits your `.session/` directory and reports anything that looks wrong — missing plan files,
stale index entries, an overgrown always-include list, an expired session, and more. Think of it
as a linter for your session state.

```bash
dev-sesssion health               # print a report of all issues
dev-sesssion health --fix         # auto-fix issues that can be fixed (stale entries)
dev-sesssion health --fix --yes   # fix without prompting for confirmation
dev-sesssion health --json        # machine-readable output for CI or scripts
```

**What it checks:**

| Check | Severity | What it means |
|---|---|---|
| `SESSION_STATE_INVALID` | Error | `SESSION_STATE.md` is missing or unparseable |
| `PLAN_MISSING` | Error | The active chunk's `PLAN_N.md` does not exist |
| `FILE_INDEX_INVALID` | Error | `FILE_INDEX.md` is missing or malformed |
| `STALE_INDEX_ENTRIES` | Warning | FILE_INDEX points to files that no longer exist on disk |
| `MISSING_CHUNK_FILES` | Warning | FILE_INDEX references chunk IDs with no matching plan file |
| `ALWAYS_INCLUDE_CREEP` | Warning | More than 4 files in the always-include list |
| `BUDGET_EXCEEDED` | Warning | Active chunk's files exceed the context token budget |
| `PROMPT_MISSING` | Warning | `NEXT_PROMPT.md` does not exist |
| `PROMPT_TOO_LONG` | Warning | `NEXT_PROMPT.md` exceeds the line cap (`max_prompt_lines`, default 20) |
| `ALL_TASKS_DONE` | Info | All chunk tasks are done — time to advance |
| `FILE_INDEX_LARGE` | Info | More than 500 indexed files — consider `--max-files` or splitting chunks |
| `SESSION_STALE` | Info | Session hasn't been updated in more than 7 days |

**When to use:** Run `dev-sesssion health` any time something feels off, or as part of your CI
pipeline to validate that the session structure is intact.

---

### `dev-sesssion verify`

`health` asks whether your session files are internally consistent. `verify` asks a harder
question: **are they true?** It reconciles what `SESSION_STATE.md` claims against what git
actually recorded. A task marked done with no commit behind it, or a `last_worked_files` entry
no diff ever touched, is state that has quietly drifted from reality — and every prompt
generated from it inherits the drift.

```bash
dev-sesssion verify                     # reconcile against git
dev-sesssion verify --lookback 40       # widen the window of commits treated as evidence
dev-sesssion verify --json              # machine-readable output for CI
```

**What it checks:**

| Code | Severity | What it means |
|---|---|---|
| `DONE_WITHOUT_EVIDENCE` | Error | Tasks are marked done, but nothing in the lookback window and nothing in the working tree supports them |
| `UNBACKED_WORKED_FILE` | Warning | `last_worked_files` names files with no commit or working-tree change behind them |
| `UNINDEXED_CHANGE` | Warning | You're modifying files that `FILE_INDEX.md` has never heard of |
| `UNCOMMITTED_SESSION` | Info | `.session/` files have uncommitted changes — a teammate cloning now gets stale state |
| `NOT_A_REPO` | Info | Not a git repository, so every history-backed check was skipped |

`--lookback <n>` (default 20) sets how many commits count as "this session's" history. The
command exits non-zero **only** on an error-severity finding, so it is safe to run in CI as a
drift gate.

Outside a git repository `verify` degrades to a single informational finding rather than
failing — the tool still works fine without git; it just cannot check your homework.

#### Replay scoring — measuring prompt quality

`verify --replay` goes one step further: instead of checking your session state, it grades your
**past prompts**.

The idea is simple. Every commit that rewrote `NEXT_PROMPT.md` marks a session boundary. The
prompt written at that boundary declares which files the next session should load. The commits
that follow, up to the next boundary, show which files it actually touched. Comparing the two
turns "was that a good prompt?" into a number.

```bash
dev-sesssion verify --replay              # summary across the last 10 boundaries
dev-sesssion verify --replay --limit 25   # score more history
dev-sesssion verify --replay --verbose    # per-boundary detail: what was missed, what went unused
```

```
Replay over 8 session boundaries:
  Recall     72%  (files the session needed that the prompt named)
  Precision  55%  (files the prompt named that the session used)
  Waste      45%  (declared context never touched)
```

| Metric | Formula | How to read it |
|---|---|---|
| **Recall** | hits ÷ files touched | The number that matters most. Every point below 100% is context the agent had to rediscover on its own — the exact failure the tool exists to prevent. Rising recall means your `FILE_INDEX.md` chunk tags are getting sharper. |
| **Precision** | hits ÷ files declared | How much of what you loaded was actually needed. Low precision is cheap noise, not a correctness problem. |
| **Waste** | unused ÷ declared, across all boundaries | The token cost of that noise. High waste with high recall means you're over-loading; trim the chunk or use `dev-sesssion trim`. |

**Interpreting the pair.** Low recall is the alarm — fix it by tagging the missed files to the
chunk. High waste with healthy recall is a tuning problem, not a bug: you're paying tokens for
context that never gets read. Chasing precision to 100% is counter-productive; a little
over-inclusion is much cheaper than an agent hunting for a file it was never told about.

`--verbose` lists each boundary with its `missed` and `unused` files by name, which is how you
find the specific files to add or drop.

Scoring runs **entirely on local git history** — no API key, no model call, nothing sent
anywhere. Files under `.session/`, `docs/`, and `CHANGELOG.md` are excluded from the maths, since
bookkeeping churn is not the work being measured.

> **Replay needs `NEXT_PROMPT.md` to be tracked by git.** It reads past prompts out of history,
> so a gitignored prompt can never be scored. Both the personal and team `.gitignore` patches
> written by `init` exclude it, so replay is unavailable by default — the command tells you so
> rather than reporting a silent zero. To turn it on, remove `.session/NEXT_PROMPT.md` from
> `.gitignore` and commit it; boundaries become scorable from that point forward.

**When to use:** `verify` at the end of a session (or in CI) to catch state that has drifted
from reality; `--replay` occasionally, to see whether your chunk tagging is actually improving.

---

### `dev-sesssion import`

Pulls context from your existing AI tool configuration files into `dev-sesssion` so you don't have
to re-enter information you've already written elsewhere.

**Import from `CLAUDE.md`:**

```bash
dev-sesssion import --from claude
```

Reads every `##` section heading in `CLAUDE.md` and adds a corresponding note to
`SESSION_STATE.md`. If you already have rules like "## HARD RULES" or "## Session workflow" in
your `CLAUDE.md`, they become session notes the AI can reference without loading the full file.
Duplicate notes are automatically deduplicated — safe to run multiple times.

**Import from Cursor rules:**

```bash
dev-sesssion import --from cursor
```

Reads every `.mdc` file in `.cursor/rules/`, extracts the `globs:` patterns from the frontmatter,
and adds any matching project files to `FILE_INDEX.md` tagged to the active chunk. This lets you
bootstrap your file index from rules you've already written for Cursor — no double-entry.

```bash
dev-sesssion import --from claude --dry-run    # preview without writing
dev-sesssion import --from cursor --verbose    # show each file being added
```

**When to use:** Once after init, if you're migrating from a project that already has `CLAUDE.md`
rules or Cursor rules. You can also re-run after adding new rules to pick up additions.

---

## Adapters — fitting different AI tools

Think of an **adapter** like a power plug adapter when you travel abroad. The electricity (your session data) is the same — only the shape of the connector changes. Each AI tool has its own conventions for how it reads context, and adapters translate dev-sesssion's output into the right format.

`dev-sesssion` includes four adapters, auto-detected from files in your project root. Detection is
ordered — the first match wins — and falls back to a plain-text formatter when nothing matches:

| Adapter | Detected by | Output file | What it does |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` or `.claude/` | `CLAUDE.md` | Uses `@file` mentions in NEXT_PROMPT; reads `.claude/MEMORY.md`; adds a session section to `CLAUDE.md` |
| **opencode** | `AGENTS.md` or `opencode.json` | `AGENTS.md` | Uses opencode's `Exclude` directive; generates AGENTS.md-aware output |
| **Cursor** | `.cursor/` or `.cursor/rules` | `.cursorrules` | Uses Cursor's `Ignore` directive for excluded files |
| **Windsurf** | `.windsurfrules` or `.windsurf/` | `.windsurfrules` | Same shape as Cursor — plain paths plus an `Ignore` directive |

### Auto-detection

When you run `dev-sesssion update` or `dev-sesssion advance`, the adapter is auto-detected from your project root. You can override it:

```bash
dev-sesssion update --adapter claude
dev-sesssion update --adapter cursor
dev-sesssion update --adapter opencode
dev-sesssion update --adapter windsurf
```

Programmatic consumers can add their own adapter with `registerAdapter()` from
`@dev-session/adapters`; `--adapter` accepts its name too. See
[authoring-adapters.md](authoring-adapters.md).

### Claude Code adapter deep-dive

The Claude Code adapter does three extra things beyond generating `NEXT_PROMPT.md`:

1. **Writes a session section into `CLAUDE.md`** during init — wrapped in `<!-- dev-sesssion:start -->` / `<!-- dev-sesssion:end -->` markers so it can be updated without clobbering your existing content.

2. **Reads `.claude/MEMORY.md`** and injects your memory summaries as session notes. This means Claude's long-term memory automatically surfaces in each session's context.

3. **Updates `CLAUDE.md` on session end** — keeps the session workflow section current as your project evolves.

---

## Team mode

When multiple developers use AI assistants on the same codebase, `dev-sesssion` can cause merge conflicts — each developer has their own `.session/` state.

Team mode solves this with two changes:

**1. `.gitignore` patch**

```gitignore
# dev-sesssion: personal session files
.session/SESSION_STATE.md
.session/NEXT_PROMPT.md
.session/DONE_LOG.md
```

These files are personal to each developer and shouldn't be committed. `FILE_INDEX.md` and `PLAN_N.md` *are* committed — they're the shared project structure.

**2. `.gitattributes` patch**

```gitattributes
.session/FILE_INDEX.md merge=ours
```

This tells git: when there's a conflict on `FILE_INDEX.md`, keep your version. It prevents needless merge conflicts when developers add different files to the index.

Enable team mode during init with:

```bash
dev-sesssion init --team
```

Or choose "Team" in the init wizard's mode prompt. Both patches are applied automatically — no manual editing required.

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

The full JSON schema:

```json
{
  "active_chunk": 3,
  "chunk_title": "Billing integration",
  "session_id": "chunk-3-billing",
  "last_updated": "2026-04-07",
  "tasks": { "total": 11, "done": 6, "in_progress": 2, "todo": 3, "percent_complete": 55 },
  "files": { "always_include": 2, "indexed": 54, "context": 8 },
  "budget": { "total_tokens": 3840, "budget_cap": 4000, "over_budget": false, "accurate": false },
  "warnings": [],
  "days_since_last_session": 0
}
```

`budget_cap` is the *bootstrap* budget (default 4,000 estimated tokens) — the cost of the
generated context, not of the source files the AI loads afterwards. A `memory` object with
session-log aggregates is included when `.session/CONTEXT_LOG.md` exists, and
`days_since_last_session` is `null` if `last_updated` cannot be parsed.

### CI integration

Use `--yes` and `--dry-run` in CI pipelines to validate that `dev-sesssion` is correctly configured without modifying files:

```yaml
# .github/workflows/ci.yml
- name: Validate dev-sesssion setup
  run: dev-sesssion status --json
```

### Forcing an adapter

If auto-detection picks the wrong tool, override it globally via the `--adapter` flag:

```bash
dev-sesssion update --adapter claude
```

Or set it per-project in a wrapper script.

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

*This guide covers dev-sesssion as of chunk 8 (import, health, pagination, team mode & enterprise
features). For the latest changes, see `CONTRIBUTING.md` and the session state in
`.session/SESSION_STATE.md`.*
