---
chunk_id: 4
title: "CLI: `init` command"
depends_on: []
tasks:
  - text: "Set up `commander` v14 with global options: `--cwd`, `--dry-run`, `--yes`, `--verbose`, `--strict`"
    status: todo
  - text: "Set up `@clack/prompts` wizard pattern with `group()` for multi-step flows"
    status: todo
  - text: "Global error handler — catches `CliError | ParseError | SecurityError`, formats for terminal, exits with correct code"
    status: todo
  - text: "`--dry-run` mode — all file writes replaced with log output showing what would be written"
    status: todo
  - text: "Signal handler — cleans up partial writes on SIGINT during init"
    status: todo
  - text: "Detect existing `PLAN.md` — report line count, heading count, estimated chunks"
    status: todo
  - text: "Detect existing `CLAUDE.md` / `AGENTS.md` — note for adapter setup"
    status: todo
  - text: "Detect `package.json` — show project name in wizard header"
    status: todo
  - text: "Detect `.session/` — if exists, prompt to reinitialize or exit"
    status: todo
  - text: "Parse `PLAN.md` with `PlanParser.detectBoundaries()`"
    status: todo
  - text: "Display detected boundaries with confidence scores"
    status: todo
  - text: "Prompt: confirm boundaries OR adjust manually (enter custom heading names)"
    status: todo
  - text: "Write `PLAN_N.md` chunk files to `.session/`"
    status: todo
  - text: "Report: \"Split into N chunks. Active chunk: PLAN_1.md\""
    status: todo
  - text: "Prompt: project name, one-sentence goal, estimated number of phases"
    status: todo
  - text: "For each phase: name, goal, estimated sessions"
    status: todo
  - text: "Generate `PLAN_1.md` with starter task template for phase 1"
    status: todo
  - text: "Write remaining chunks as empty templates"
    status: todo
  - text: "Walk codebase with `GitignoreAwareWalker`"
    status: todo
  - text: "Display: \"Found N files across M directories\""
    status: todo
  - text: "For each directory group: prompt to tag to a chunk (or skip, or always-include)"
    status: todo
  - text: "Display estimated token cost per tagged group"
    status: todo
  - text: "Write `FILE_INDEX.md`"
    status: todo
  - text: "Report: \"Indexed N files. Always-include: 3 files.\""
    status: todo
  - text: "Write `SESSION_STATE.md` — chunk 1 active, all tasks as `[ ]`, session ID (UUID v4)"
    status: todo
  - text: "Write `ROUTINES.md` — bootstrap + self-update prompts"
    status: todo
  - text: "Write `NEXT_PROMPT.md` — first-ever bootstrap, self-contained"
    status: todo
  - text: "Run `SecretScanner` on all written files before finalizing"
    status: todo
  - text: "Offer to add `.session/SESSION_STATE.md` and `.session/NEXT_PROMPT.md` to `.gitignore`"
    status: todo
  - text: "Display: success summary + \"Paste NEXT_PROMPT.md to start your first session\""
    status: todo
  - text: "E2e: `npx dev-sesssion init --yes` on a fixture project with `PLAN.md`"
    status: todo
  - text: "E2e: `npx dev-sesssion init --yes` on a bare `package.json` project"
    status: todo
  - text: "E2e: `--dry-run` produces no filesystem changes"
    status: todo
  - text: "Integration: migration path A correctly splits 3-phase PLAN.md"
    status: todo
  - text: "Integration: FILE_INDEX generation respects `.gitignore`"
    status: todo
  - text: "Unit: signal handler cleans up `.tmp` files"
    status: todo
---

## Chunk 4 — CLI: `init` command

### Tasks

- [ ] Set up `commander` v14 with global options: `--cwd`, `--dry-run`, `--yes`, `--verbose`, `--strict`
- [ ] Set up `@clack/prompts` wizard pattern with `group()` for multi-step flows
- [ ] Global error handler — catches `CliError | ParseError | SecurityError`, formats for terminal, exits with correct code
- [ ] `--dry-run` mode — all file writes replaced with log output showing what would be written
- [ ] Signal handler — cleans up partial writes on SIGINT during init
- [ ] Detect existing `PLAN.md` — report line count, heading count, estimated chunks
- [ ] Detect existing `CLAUDE.md` / `AGENTS.md` — note for adapter setup
- [ ] Detect `package.json` — show project name in wizard header
- [ ] Detect `.session/` — if exists, prompt to reinitialize or exit
- [ ] Parse `PLAN.md` with `PlanParser.detectBoundaries()`
- [ ] Display detected boundaries with confidence scores
- [ ] Prompt: confirm boundaries OR adjust manually (enter custom heading names)
- [ ] Write `PLAN_N.md` chunk files to `.session/`
- [ ] Report: "Split into N chunks. Active chunk: PLAN_1.md"
- [ ] Prompt: project name, one-sentence goal, estimated number of phases
- [ ] For each phase: name, goal, estimated sessions
- [ ] Generate `PLAN_1.md` with starter task template for phase 1
- [ ] Write remaining chunks as empty templates
- [ ] Walk codebase with `GitignoreAwareWalker`
- [ ] Display: "Found N files across M directories"
- [ ] For each directory group: prompt to tag to a chunk (or skip, or always-include)
- [ ] Display estimated token cost per tagged group
- [ ] Write `FILE_INDEX.md`
- [ ] Report: "Indexed N files. Always-include: 3 files."
- [ ] Write `SESSION_STATE.md` — chunk 1 active, all tasks as `[ ]`, session ID (UUID v4)
- [ ] Write `ROUTINES.md` — bootstrap + self-update prompts
- [ ] Write `NEXT_PROMPT.md` — first-ever bootstrap, self-contained
- [ ] Run `SecretScanner` on all written files before finalizing
- [ ] Offer to add `.session/SESSION_STATE.md` and `.session/NEXT_PROMPT.md` to `.gitignore`
- [ ] Display: success summary + "Paste NEXT_PROMPT.md to start your first session"
- [ ] E2e: `npx dev-sesssion init --yes` on a fixture project with `PLAN.md`
- [ ] E2e: `npx dev-sesssion init --yes` on a bare `package.json` project
- [ ] E2e: `--dry-run` produces no filesystem changes
- [ ] Integration: migration path A correctly splits 3-phase PLAN.md
- [ ] Integration: FILE_INDEX generation respects `.gitignore`
- [ ] Unit: signal handler cleans up `.tmp` files
