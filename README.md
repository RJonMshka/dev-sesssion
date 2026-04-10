# dev-session

**Self-managing context architecture for AI-assisted coding sessions.**

AI assistants forget everything between conversations. `dev-session` fixes that by maintaining a structured `.session/` directory — a living document set that keeps the AI oriented, tracks task progress, and generates a ready-to-paste prompt for each new session.

```
npx dev-session@latest init
```

---

## How it works

`dev-session init` sets up a `.session/` directory in your project root:

```
.session/
├── SESSION_STATE.md   # Active chunk, tasks, notes, last-worked files
├── FILE_INDEX.md      # Annotated list of files the AI should read
├── NEXT_PROMPT.md     # ≤15-line prompt to paste at session start
├── PLAN_1.md          # Chunk 1 of your project plan
├── PLAN_2.md          # Chunk 2 ...
└── ROUTINES.md        # Session start/end checklist
```

At the start of each coding session, paste `NEXT_PROMPT.md` into Claude, Cursor, or opencode. It tells the AI exactly what chunk you're on, which files to load, and what tasks are in progress — nothing more.

After the session, run `dev-session update` to mark tasks done and regenerate the prompt for next time.

---

## Installation

**One-time setup (no global install):**

```bash
npx dev-session@latest init
```

**Global install:**

```bash
npm install -g dev-session
dev-session init
```

**Requirements:** Node.js ≥ 20, any package manager.

---

## Quick start

```bash
# 1. Initialize in your project root
npx dev-session@latest init

# 2. Follow the wizard:
#    - Name your project and define phases (or split an existing PLAN.md)
#    - Choose personal or team mode
#    - The AI index is auto-generated from your codebase

# 3. Paste .session/NEXT_PROMPT.md into your AI chat to begin

# 4. After the session — mark tasks done
dev-session update

# 5. When all tasks in a chunk are done — move to the next chunk
dev-session advance
```

---

## Commands

| Command | Description |
|---|---|
| `dev-session init` | Initialize `.session/` in the current project |
| `dev-session status` | Show task progress, context budget, and health warnings |
| `dev-session update` | Interactively mark tasks done and add notes |
| `dev-session advance` | Archive the current chunk and move to the next |
| `dev-session prompt` | Print `NEXT_PROMPT.md` to stdout (pipe or copy) |
| `dev-session index add <files>` | Add files to `FILE_INDEX.md` |
| `dev-session index audit` | Find stale or missing FILE_INDEX entries |
| `dev-session health` | Full session audit — staleness, budget, missing files |
| `dev-session health --fix` | Auto-remediate stale FILE_INDEX entries |
| `dev-session import --from claude` | Import CLAUDE.md sections as session notes |
| `dev-session import --from cursor` | Import .cursor/rules globs into FILE_INDEX |
| `dev-session export --to claude` | Sync session state back to CLAUDE.md |
| `dev-session export --to cursor` | Sync FILE_INDEX tags to .cursor/rules |
| `dev-session migrate` | Initialize dev-session in each package of a monorepo |

**Global flags** (available on every command):

| Flag | Description |
|---|---|
| `--cwd <path>` | Run in a different directory |
| `-y, --yes` | Skip prompts, use defaults |
| `--dry-run` | Show what would be written without writing |
| `-v, --verbose` | Detailed output |
| `--strict` | Block on secret detection instead of warning |
| `--adapter <name>` | Override adapter detection (`claude`, `opencode`, `cursor`) |

---

## Adapters

`dev-session` generates adapter-specific output so the AI gets context in the format it expects:

| Adapter | Detection | Output |
|---|---|---|
| **Claude Code** | `CLAUDE.md` present | `@`-file mentions in `NEXT_PROMPT.md` |
| **opencode** | `AGENTS.md` present | `Exclude:` directives |
| **Cursor** | `.cursorrules` present | `Ignore:` directives |

The adapter is auto-detected from your project root. Override with `--adapter <name>`.

---

## Team mode

Run `dev-session init --team` to enable team mode:

- `SESSION_STATE.md` and `NEXT_PROMPT.md` are added to `.gitignore` (ephemeral, per-developer)
- `FILE_INDEX.md` gets `merge=ours` in `.gitattributes` (no merge conflicts on the index)
- `PLAN_*.md` and `ROUTINES.md` are committed and shared

Team members each run `dev-session init` once. The shared plan files keep everyone on the same chunk; each developer has their own session state.

---

## Monorepo support

`dev-session migrate` detects pnpm, npm, Yarn, Nx, and Turborepo workspaces and runs `init` in each selected package:

```bash
dev-session migrate          # interactive package selection
dev-session migrate --yes    # initialize all packages with defaults
```

---

## Security

`dev-session` is built with defense-in-depth:

- **Secret scanning** — 10 regex patterns (AWS keys, GitHub tokens, private keys, etc.) on every file write. Warns by default; blocks in `--strict` mode.
- **Atomic writes** — all file writes go through a `.tmp` → `rename()` pipeline. No partial writes.
- **Path validation** — every file path from external sources is validated with `PathValidator.safeResolvePath()`. Path traversal attacks are rejected.
- **Safe frontmatter** — YAML parsing uses `@11ty/gray-matter` (not `gray-matter`) with the JS engine disabled. No `eval()` RCE.
- **No `exec()` with user data** — all subprocess calls use `execFile()` or `spawn()` with argument arrays.

---

## Context budget

`dev-session status` shows a context budget estimate for your current chunk:

```
Context budget: 12,400 / 200,000 tokens (6%)
  SESSION_STATE.md   1,200 tok
  FILE_INDEX.md      4,800 tok
  PLAN_3.md            900 tok
  src/core/...       5,500 tok
```

The budget helps you decide when to advance to the next chunk or trim the FILE_INDEX.

---

## Health checks

`dev-session health` audits your session and reports:

- Stale FILE_INDEX entries (file deleted or moved)
- SESSION_STATE last updated more than 7 days ago
- NEXT_PROMPT.md exceeding the 15-line limit
- Missing PLAN files for the active chunk
- Context budget over 80% of the limit

```bash
dev-session health        # view report
dev-session health --fix  # auto-remove stale FILE_INDEX entries
dev-session health --json # machine-readable output
```

---

## Import from existing tools

Already using CLAUDE.md or Cursor rules? Import them:

```bash
# Pull CLAUDE.md H2 sections into SESSION_STATE notes
dev-session import --from claude

# Pull .cursor/rules/*.mdc file globs into FILE_INDEX
dev-session import --from cursor
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, conventions, and the pull request process.

The project uses a pnpm monorepo with four packages:

| Package | Role |
|---|---|
| `packages/security` | Path validation, secret scanning, atomic writes, error types |
| `packages/core` | Session managers, plan parser, project detector, formatters |
| `packages/cli` | Commander commands, `@clack/prompts` wizard flows |
| `packages/adapters` | Claude Code, opencode, and Cursor adapter implementations |

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm test             # run all tests (769 passing)
pnpm typecheck        # TypeScript strict mode check
pnpm lint             # Biome linter
```

---

## License

MIT
