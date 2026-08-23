# Getting started

## What is dev-sesssion?

AI coding assistants lose all context when a conversation ends. `dev-sesssion` solves this by maintaining a structured `.session/` directory in your project root — a living document set that:

- Tracks which chunk of your plan you're on and which tasks are done
- Keeps an annotated index of which files the AI needs to read
- Generates a ≤20-line prompt to paste at the start of each new session

The AI never has to re-read your entire codebase. It picks up exactly where you left off.

---

## Installation

```bash
# One-time, no global install required
npx dev-sesssion@latest init

# Or install globally
npm install -g dev-sesssion
```

**Requirements:** Node.js ≥ 20.

---

## Initializing a project

Run `dev-sesssion init` in your project root:

```bash
cd my-project
npx dev-sesssion@latest init
```

The wizard walks you through:

1. **Detection** — finds an existing `PLAN.md` and the markers of your AI tool (`CLAUDE.md`, `.claude/`, `AGENTS.md`, `opencode.json`, `.cursor/`, `.windsurfrules`)
2. **Team vs personal** — personal keeps session files local; team patches `.gitignore` and `.gitattributes`
3. **Plan setup** — either splits an existing `PLAN.md` into chunks, or guides you through creating one
4. **File index** — walks your codebase and builds an annotated `FILE_INDEX.md`
5. **Final writes** — creates `SESSION_STATE.md`, `NEXT_PROMPT.md`, and `ROUTINES.md`

---

## The .session/ directory

After init, your project contains:

```
.session/
├── SESSION_STATE.md   # What chunk you're on, which tasks are done, notes
├── FILE_INDEX.md      # Annotated index of files per chunk
├── NEXT_PROMPT.md     # The prompt to paste at the start of each session
├── PLAN_1.md          # Plan chunk 1
├── PLAN_2.md          # Plan chunk 2 (and so on)
└── ROUTINES.md        # Session start/end checklist for the AI
```

`DONE_LOG.md` joins them after your first `dev-sesssion advance`.

### SESSION_STATE.md

Tracks your active chunk, task statuses, last-worked files, and notes. Updated by `dev-sesssion update` and `dev-sesssion advance`.

### FILE_INDEX.md

Maps files to the chunk where they're needed. At session start, the AI loads only the files tagged to the active chunk — not the whole codebase.

### NEXT_PROMPT.md

A compact, self-contained prompt (≤20 lines by default) that re-orients the AI in seconds. It includes the active chunk title, task list, budget summary, and file mentions in the adapter's format.

To use a different cap, set `max_prompt_lines` (an integer from 5 to 50) in the `SESSION_STATE.md` frontmatter.

---

## Your first session

1. **Start the session:** paste `.session/NEXT_PROMPT.md` into your AI chat
2. **Work:** the AI knows exactly what to build and which files to read
3. **End the session:** run `dev-sesssion update` to mark tasks done and regenerate the prompt

```bash
dev-sesssion update
```

The prompt for your next session is ready in `.session/NEXT_PROMPT.md`.

---

## Moving to the next chunk

When all tasks in the active chunk are complete, advance to the next one:

```bash
dev-sesssion advance
```

This archives the completed chunk, updates `SESSION_STATE.md`, and writes a fresh `NEXT_PROMPT.md` for the next chunk.

---

## Non-interactive mode

Skip all prompts and use defaults with `--yes`:

```bash
npx dev-sesssion@latest init --yes
```

Useful in CI or scripted setups. Combines with `--dry-run` to preview what would be written:

```bash
npx dev-sesssion@latest init --yes --dry-run
```
