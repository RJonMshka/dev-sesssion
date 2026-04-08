# dev-session: the complete guide

## What problem does this solve?

AI coding assistants like Claude, Cursor, and opencode are powerful — but they suffer from a fundamental limitation: **they forget everything when the conversation ends**. Start a new session tomorrow, and the AI has no idea what you built yesterday, which files matter, what decisions you made, or where you left off. You spend the first 10 minutes of every session just re-explaining your project.

This gets worse as projects grow. A large codebase has hundreds of files, but the AI's **context window** (think of it as a whiteboard that gets fully erased after each meeting) can only hold a fraction of them. Load too many files and you waste tokens on irrelevant code. Load too few and the AI makes assumptions that break things.

`dev-session` solves both problems. It gives your project a **persistent brain** — a `.session/` directory that survives between conversations. At the start of each session, you paste one short prompt and the AI knows exactly where it left off, which files to load, and what to do next. No re-explaining. No wasted context.

---

## 🗂️ The analogy: a hospital shift handoff

Imagine a hospital where nurses work 8-hour shifts. When Nurse A's shift ends and Nurse B arrives, A doesn't just say "good luck!" and leave. She writes a **handoff note**: which patients are critical, what medications were given, what tests are pending, and what needs to happen next.

Nurse B reads that note, walks the ward, and picks up exactly where A left off — without interviewing every patient from scratch.

`dev-session` is that handoff system for AI coding sessions. The `.session/` directory is the nurses' station. `SESSION_STATE.md` is the handoff note. `NEXT_PROMPT.md` is the exact text Nurse B reads first thing in the morning. And you, the developer, are the charge nurse who decides what gets written down.

---

## Core concepts

### 1. The `.session/` directory — the brain 🧠

Running `dev-session init` creates a `.session/` folder at your project root. This folder is the source of truth for everything the AI needs to resume work. It contains:

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

None of these files are magic — they're plain Markdown. You can read and edit them directly. `dev-session` just manages them so you don't have to.

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
| File | Chunk tags | Purpose |
|---|---|---|
| src/auth/jwt.ts | 2 | JWT generation and validation |
| src/auth/middleware.ts | 2 | Auth middleware for Express routes |
| src/users/user.model.ts | 1, 2 | User schema — needed for auth too |
| CLAUDE.md | always | AI session instructions |
```

Files tagged `0` or `always` are loaded in every session regardless of the active chunk. Use this for your `CLAUDE.md`, key config files, or anything the AI should always know about.

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

This is a short (≤15 lines), self-contained prompt that you paste at the start of every AI session. It tells the AI:
- What project this is
- Which chunk is active and what the goal is
- Exactly which files to load
- What was done last time and where to pick up

`dev-session update` regenerates this file automatically after you mark tasks done. Think of it as the ignition key — one paste and the engine starts.

**Example `NEXT_PROMPT.md`:**

```
Project: my-saas-app
Active chunk: 3 — Billing integration
Load: src/billing/**, src/users/subscription.ts, CLAUDE.md
Do NOT read: src/auth/** (complete), dist/
Resume: Stripe webhook handler is done. Next: implement subscription upgrade flow.
Tasks remaining:
  - [ ] POST /billing/upgrade endpoint
  - [ ] Prorate calculation logic
  - [ ] Tests for upgrade/downgrade
```

---

### 6. Context budget — the word count limit

Every AI session has a **token budget** — like a word count limit on an essay. Load too many files and you blow the budget; load too few and the AI is working blind.

`dev-session` tracks a context budget estimate for each session, calculated from the files tagged to the active chunk. When you run `dev-session status`, it shows you how much budget you're using and warns you if you're over the limit.

> **Rule of thumb:** if you're consistently over budget, split the chunk in two. If you're well under, you might be able to merge two small chunks.

---

## Getting started

### Installation

```bash
# In any project directory:
npx dev-session init
```

No global install needed. You can also install globally if you prefer:

```bash
npm install -g @dev-session/cli
dev-session init
```

### The init wizard

When you run `dev-session init`, a wizard walks you through setup in five phases:

**Phase 1 — Detection** (automatic)

`dev-session` scans your project and detects:
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

`dev-session` walks your codebase (respecting `.gitignore`), estimates which files belong to which chunks based on directory structure, and builds a starter `FILE_INDEX.md`. You'll refine this over time.

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
dev-session prompt

# Or copy it to clipboard:
dev-session prompt --copy
```

The AI reads the prompt, loads only the files listed, confirms the plan, and waits for you to say "go."

### During the session — code normally

Work as you normally would. The AI builds features, fixes bugs, writes tests. `dev-session` doesn't interfere during the session.

### End of session — update and regenerate

When you're done (or taking a break), run:

```bash
dev-session update
```

This launches an interactive wizard that:

1. **Marks tasks done** — shows you the pending tasks as a checklist; pick the ones you completed.
2. **Adds session notes** — optionally type a note ("decided to use Zod instead of Yup for validation").
3. **Detects last-worked files** — reads `git status` and suggests which modified files to track.
4. **Regenerates `NEXT_PROMPT.md`** — writes a fresh, up-to-date handoff prompt for next time.
5. **Secret scan** — checks the prompt content for accidentally included API keys or tokens.

After `dev-session update`, your `.session/` is up to date and `NEXT_PROMPT.md` is ready for the next session.

### When a chunk is complete — advance

When all tasks in the active chunk are done, `dev-session status` will tell you:

```
⚠ All tasks in active chunk are done — run `dev-session advance` to move to the next chunk
```

Run:

```bash
dev-session advance
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
| `--adapter <name>` | Force a specific adapter (`claude`, `opencode`, `cursor`) | auto-detect |

---

### `dev-session init`

Initializes `dev-session` in the current project. Runs the full wizard.

```bash
dev-session init
dev-session init --team          # skip team/personal prompt, go straight to team mode
dev-session init --yes           # no prompts, use all defaults (personal mode)
dev-session init --dry-run       # preview what would be written
```

**When to use:** Once, when setting up a new project. Re-running it on an existing session will ask if you want to reinitialize.

---

### `dev-session status`

Shows the current health of your session at a glance.

```bash
dev-session status
dev-session status --json        # machine-readable output (for scripts/CI)
dev-session status --verbose     # show in-progress and todo counts separately
```

**Example output:**
```
● Active chunk: 3 — Billing integration
● Session: chunk-3-billing
● Last updated: 2026-04-07 (today)
● Tasks: [==========>         ] 55% (6/11 done)
● Files: 8 in context, 2 always-include, 54 indexed
● Budget: ~18,400 / 80,000 tokens (heuristic)
⚠ NEXT_PROMPT.md has 18 lines (max 15) — consider regenerating
```

**Warnings to pay attention to:**

| Warning | What it means | What to do |
|---|---|---|
| `NEXT_PROMPT.md has N lines (max 15)` | Prompt grew too long | Run `dev-session update` to regenerate |
| `always-include list has N files` | Too many "always load" files | Tighten the list; move some to chunk tags |
| `Context budget exceeded` | Session will be token-heavy | Remove large files or split the chunk |
| `All tasks done` | Chunk is complete | Run `dev-session advance` |

---

### `dev-session update`

Interactively marks tasks done, adds notes, and regenerates `NEXT_PROMPT.md`.

```bash
dev-session update
dev-session update --yes         # auto-update from git status only, no prompts
dev-session update --strict      # fail if secrets are detected in the prompt
```

**When to use:** At the end of every coding session, before closing your AI tool.

---

### `dev-session advance`

Archives the current chunk and moves to the next one.

```bash
dev-session advance
dev-session advance --yes        # force-advance even if tasks are incomplete
```

> **Good to know:** `advance` warns you if tasks are still pending. It won't advance without your confirmation — unless you pass `--yes`.

**When to use:** When all tasks in the active chunk are done and you're ready to start the next leg.

---

### `dev-session prompt`

Prints `NEXT_PROMPT.md` to stdout for piping or copying.

```bash
dev-session prompt               # print to terminal
dev-session prompt --copy        # copy to clipboard (uses pbcopy/xclip/clip.exe)
```

**When to use:** At the start of every AI session. Pipe it, copy it, or display it — then paste it into your AI tool.

---

### `dev-session index add <filepath>`

Adds a file to `FILE_INDEX.md`.

```bash
dev-session index add src/payments/stripe.ts
dev-session index add src/payments/stripe.ts --yes   # auto-tag to active chunk
```

The interactive version asks:
- Which chunk(s) should this file belong to?
- What's the purpose of this file? (one line description)

**When to use:** Whenever you create a new file that the AI should know about. You can also do this at the end of a session during `update` — but `index add` is more precise.

---

### `dev-session index audit`

Scans `FILE_INDEX.md` for stale entries (files that no longer exist).

```bash
dev-session index audit          # report stale entries
dev-session index audit --fix    # interactively remove stale entries
dev-session index audit --fix --yes   # auto-remove without prompting
```

**When to use:** Periodically, or after a big refactor where files were renamed or deleted.

---

### `dev-session migrate`

Initializes `dev-session` in every package of a monorepo workspace.

```bash
dev-session migrate              # detect workspace, pick packages interactively
dev-session migrate --yes        # init all uninitialzed packages automatically
```

`migrate` detects pnpm workspaces, Nx, Turborepo, and npm/yarn workspaces. For each package that doesn't already have a `.session/` directory, it runs the full `init` wizard.

**When to use:** When adding `dev-session` to a monorepo that has multiple packages.

---

## Adapters — fitting different AI tools

Think of an **adapter** like a power plug adapter when you travel abroad. The electricity (your session data) is the same — only the shape of the connector changes. Each AI tool has its own conventions for how it reads context, and adapters translate dev-session's output into the right format.

`dev-session` includes three adapters, auto-detected from files in your project root:

| Adapter | Detected by | Output file | What it does |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` or `.claude/` | `CLAUDE.md` | Uses `@file` mentions in NEXT_PROMPT; reads `.claude/MEMORY.md`; adds a session section to `CLAUDE.md` |
| **Cursor** | `.cursorrules` or `.cursor/` | `.cursorrules` | Uses Cursor's `Ignore` directive for excluded files |
| **opencode** | `AGENTS.md` or `.opencode/` | `AGENTS.md` | Uses opencode's `Exclude` directive; generates AGENTS.md-aware output |

### Auto-detection

When you run `dev-session update` or `dev-session advance`, the adapter is auto-detected from your project root. You can override it:

```bash
dev-session update --adapter claude
dev-session update --adapter cursor
dev-session update --adapter opencode
```

### Claude Code adapter deep-dive

The Claude Code adapter does three extra things beyond generating `NEXT_PROMPT.md`:

1. **Writes a session section into `CLAUDE.md`** during init — wrapped in `<!-- dev-session:start -->` / `<!-- dev-session:end -->` markers so it can be updated without clobbering your existing content.

2. **Reads `.claude/MEMORY.md`** and injects your memory summaries as session notes. This means Claude's long-term memory automatically surfaces in each session's context.

3. **Updates `CLAUDE.md` on session end** — keeps the session workflow section current as your project evolves.

---

## Team mode

When multiple developers use AI assistants on the same codebase, `dev-session` can cause merge conflicts — each developer has their own `.session/` state.

Team mode solves this with two changes:

**1. `.gitignore` patch**

```gitignore
# dev-session: personal session files
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
dev-session init --team
```

Or choose "Team" in the init wizard's mode prompt. Both patches are applied automatically — no manual editing required.

---

## Advanced usage

### Dry-run everything before committing

Not sure what a command will do? Run it with `--dry-run` first:

```bash
dev-session init --dry-run
dev-session advance --dry-run
```

Dry-run logs every file that would be written without touching the filesystem.

### Scriptable JSON output

Pipe `dev-session status --json` into `jq` or other tools:

```bash
# Is the session over budget?
dev-session status --json | jq '.budget.over_budget'

# How many tasks are done?
dev-session status --json | jq '.tasks.percent_complete'
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
  "budget": { "total_tokens": 18400, "budget_cap": 80000, "over_budget": false, "accurate": false },
  "warnings": [],
  "days_since_last_session": 0
}
```

### CI integration

Use `--yes` and `--dry-run` in CI pipelines to validate that `dev-session` is correctly configured without modifying files:

```yaml
# .github/workflows/ci.yml
- name: Validate dev-session setup
  run: dev-session status --json
```

### Forcing an adapter

If auto-detection picks the wrong tool, override it globally via the `--adapter` flag:

```bash
dev-session update --adapter claude
```

Or set it per-project in a wrapper script.

---

## FAQ / Troubleshooting

**Q: I ran `dev-session update` but `NEXT_PROMPT.md` didn't change.**

The prompt is regenerated from `SESSION_STATE.md`. If you didn't mark any tasks done or add notes, the output will be nearly identical to the previous prompt. That's expected.

---

**Q: My context budget shows "heuristic" — is that inaccurate?**

The heuristic estimates ~4 characters per token. It's accurate within ±20% for typical source code. The budget shows `accurate: true` only when an exact token counter is wired in via the external token counter interface. For daily use, the heuristic is good enough to catch over-budget situations.

---

**Q: I deleted a file and now `dev-session index audit` is complaining.**

That's expected. Run:

```bash
dev-session index audit --fix
```

It will show you the stale entries and ask if you want to remove them. Answer yes.

---

**Q: `dev-session advance` says "No PLAN_4.md found — cannot advance beyond the last chunk."**

You've completed all your planned chunks. This is a good problem to have! You have two options:
- Create a new `PLAN_N.md` manually for the next phase of work
- Run `dev-session init` again to scaffold a new plan (it will ask before overwriting)

---

**Q: How do I add notes without marking tasks done?**

Run `dev-session update`, press Enter through the task checklist (select nothing), and type your note in the notes prompt. The note will be saved to `SESSION_STATE.md` and included in the next `NEXT_PROMPT.md`.

---

**Q: Someone else on my team committed `FILE_INDEX.md` with different entries. I have a merge conflict.**

If you enabled team mode, this shouldn't happen — the `.gitattributes` rule uses `merge=ours`. If you didn't enable team mode, either:
- Re-run `dev-session init --team` to apply the patches, then resolve the conflict manually this once
- Manually add `.session/FILE_INDEX.md merge=ours` to your `.gitattributes`

---

**Q: Can I use dev-session without a `PLAN.md`?**

Yes. The `init` wizard's scaffold path handles this case. It walks you through creating chunks from scratch via prompts. You don't need a pre-existing plan.

---

**Q: My `NEXT_PROMPT.md` is longer than 15 lines. Does that break anything?**

Nothing breaks — but `dev-session status` will warn you. The 15-line limit is a discipline enforcer: a prompt that grows beyond 15 lines usually means you're trying to cram too much context into the prompt itself rather than letting `FILE_INDEX.md` do the work. Run `dev-session update` to regenerate a clean, compact prompt.

---

**Q: How do I handle a monorepo where only some packages use AI?**

Run `dev-session migrate` from the monorepo root. It detects all workspace packages and lets you select which ones to initialize. Packages you skip won't be touched. You can always run `migrate` again later to initialize additional packages.

---

*This guide covers dev-session as of chunk 8 (team mode & enterprise features). For the latest changes, see `CONTRIBUTING.md` and the session state in `.session/SESSION_STATE.md`.*
