# dev-session

**Keep your AI coding assistant oriented across sessions — a `.session/` directory tracks tasks and state, and generates a ≤15-line prompt for every new conversation.**

```bash
npx dev-session@latest init
```

---

## Installation

```bash
# No global install needed
npx dev-session@latest init

# Or install globally
npm install -g dev-sesssion
dev-session init
```

**Requires:** Node.js ≥ 20.

---

## Quick start

```bash
# 1. Initialize — wizard splits your plan into chunks and indexes your codebase
npx dev-session@latest init

# 2. Start each coding session by pasting the generated prompt
dev-session prompt          # print NEXT_PROMPT.md
# paste into Claude, Cursor, opencode, or any AI chat

# 3. After the session — mark tasks done and regenerate the prompt
dev-session update

# 4. When a chunk is fully done — archive it and move to the next
dev-session advance

# Check progress anytime
dev-session status          # task %, token budget, health warnings
```

---

## Core concepts

### Context snapshot

Every session starts with `NEXT_PROMPT.md` — a ≤15-line file that tells the AI exactly what chunk is active, which files to load, which tasks are pending, and how much context budget is available. `dev-session prompt` prints it; you paste it. The AI is fully oriented in under a minute.

The underlying data lives in `SESSION_STATE.md`: task statuses, notes from the session, and the last-touched files. `dev-session update` writes back to it interactively. Nothing accumulates in your AI tool's global config — the session brain is entirely in `.session/`.

### File registry

`FILE_INDEX.md` is an annotated table of every file the AI should know about, tagged by plan chunk. It tracks each file's purpose and a token-cost estimate. `dev-session index add <files>` appends entries; `dev-session index audit` flags stale ones when files are deleted or moved.

The registry keeps context budgets honest. `dev-session status` shows a per-file breakdown so you know exactly how many tokens you're handing to the AI before the session starts — not mid-conversation when it's too late.

### Plan chunks

Your project plan lives in numbered `PLAN_*.md` files — one chunk per meaningful slice of work. Chunking is what keeps context permanently lean: the AI loads only the active chunk's plan, files, and state. Everything prior is archived.

`dev-session advance` closes the current chunk automatically: marks it complete, rotates the FILE_INDEX to the next chunk's files, and regenerates `NEXT_PROMPT.md` for chunk N+1. The session brain resets with zero manual intervention.

---

## Toy example

You're building a payments service. After `init`, your `.session/` looks like:

```
.session/
├── SESSION_STATE.md   ← active chunk, task list, notes
├── FILE_INDEX.md      ← 12 files tagged to chunks 1-3
├── NEXT_PROMPT.md     ← ≤15 lines to paste at session start
├── PLAN_1.md          ← "Stripe integration" — 5 tasks
├── PLAN_2.md          ← "Webhooks" — not started yet
└── ROUTINES.md        ← session start/end checklist
```

Paste `NEXT_PROMPT.md` into Claude. It loads `src/payments/stripe-client.ts` and `src/payments/types.ts` — nothing else. After the session:

```bash
dev-session update    # ✓ mark 3 of 5 tasks done, add a note
dev-session status    # 3/5 tasks · 14,200/200,000 tokens (7%)
```

When chunk 1 is fully done:

```bash
dev-session advance   # archives chunk 1 → activates chunk 2 → new NEXT_PROMPT.md written
```

The next session opens on the Webhooks chunk. No manual file wrangling, no stale context.

---

## Commands

| Command | Description |
|---|---|
| `dev-session init` | Initialize `.session/` — wizard: plan, mode, file index |
| `dev-session status` | Task progress, context budget, health warnings |
| `dev-session update` | Mark tasks done interactively, add notes |
| `dev-session advance` | Archive current chunk, move to next, regenerate prompt |
| `dev-session prompt` | Print `NEXT_PROMPT.md` to stdout |
| `dev-session index add <files>` | Add files to `FILE_INDEX.md` |
| `dev-session index audit` | Detect stale or missing FILE_INDEX entries |
| `dev-session health` | Full session audit — staleness, budget, missing files |
| `dev-session health --fix` | Auto-remove stale FILE_INDEX entries |
| `dev-session import --from claude` | Pull CLAUDE.md sections into session notes |
| `dev-session import --from cursor` | Pull `.cursor/rules` globs into FILE_INDEX |
| `dev-session export --to claude` | Sync session state back to CLAUDE.md |
| `dev-session export --to cursor` | Sync FILE_INDEX tags to `.cursor/rules` |
| `dev-session migrate` | Initialize dev-session in each monorepo package |

**Global flags:**

| Flag | Description |
|---|---|
| `--cwd <path>` | Run in a different directory |
| `-y, --yes` | Skip prompts, use defaults |
| `--dry-run` | Preview writes without writing |
| `-v, --verbose` | Detailed output |
| `--strict` | Block on secret detection instead of warning |
| `--adapter <name>` | Override adapter detection (`claude`, `opencode`, `cursor`) |

---

## Adapters

`dev-session` auto-detects your AI tool and generates output in the format it expects:

| Tool | Detected by | Output |
|---|---|---|
| **Claude Code** | `CLAUDE.md` present | `@`-file mentions in `NEXT_PROMPT.md` |
| **opencode** | `AGENTS.md` present | `Exclude:` directives |
| **Cursor** | `.cursorrules` present | `Ignore:` directives |

Override detection with `--adapter <name>`.

---

## Team mode

```bash
dev-session init --team
```

In team mode:

- `SESSION_STATE.md` and `NEXT_PROMPT.md` → `.gitignore` (per-developer, ephemeral)
- `FILE_INDEX.md` → `.gitattributes` with `merge=ours` (no merge conflicts)
- `PLAN_*.md` and `ROUTINES.md` → committed and shared

Everyone runs `init` once. The shared plan keeps the team on the same chunk; each developer maintains their own session state.

---

## Monorepo support

```bash
dev-session migrate          # interactive package selection
dev-session migrate --yes    # initialize all packages with defaults
```

Detects pnpm, npm, Yarn, Nx, and Turborepo workspaces.

---

## Security

`dev-session` is built with defense-in-depth:

- **Secret scanning** — 10 regex patterns (AWS keys, GitHub tokens, private keys, etc.) on every file write. Warns by default; blocks in `--strict` mode.
- **Atomic writes** — all writes go `.tmp` → `rename()`. No partial files ever reach disk.
- **Path validation** — every external file path goes through `PathValidator.safeResolvePath()`. Path traversal attacks are rejected at the boundary.
- **Safe YAML** — uses `@11ty/gray-matter` with the JS engine disabled. No `eval()` RCE possible.

---

## Documentation

| Doc | What's in it |
|---|---|
| [docs/getting-started.md](./docs/getting-started.md) | Installation, `.session/` structure, first-session walkthrough |
| [docs/commands.md](./docs/commands.md) | Full command reference + global flags |
| [docs/adapters.md](./docs/adapters.md) | Using the Claude Code / opencode / Cursor / Windsurf adapters |
| [docs/authoring-adapters.md](./docs/authoring-adapters.md) | How to write a new adapter |
| [docs/team-mode.md](./docs/team-mode.md) | Shared vs personal files, gitattributes, monorepos |
| [PROTOCOL.md](./PROTOCOL.md) | The Session Protocol v1.0 spec (the `.session/` format) |
| [SECURITY.md](./SECURITY.md) | Threat model and vulnerability disclosure |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, conventions, and the pull request process.

```bash
pnpm install && pnpm build && pnpm test
```

The project is a pnpm monorepo:

| Package | Role |
|---|---|
| `packages/security` | Path validation, secret scanning, atomic writes, error types |
| `packages/core` | Session managers, plan parser, formatters, project detector |
| `packages/cli` | Commander commands, `@clack/prompts` wizard flows |
| `packages/adapters` | Claude Code, opencode, Cursor, and Windsurf adapter implementations |

---

## License

MIT
