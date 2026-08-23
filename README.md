# dev-sesssion

**Keep your AI coding assistant oriented across sessions — a `.session/` directory tracks tasks and state, and generates a ≤20-line prompt for every new conversation.**

```bash
npx dev-sesssion@latest init
```

---

## Installation

```bash
# No global install needed
npx dev-sesssion@latest init

# Or install globally
npm install -g dev-sesssion
dev-sesssion init
```

**Requires:** Node.js ≥ 20.

---

## Quick start

```bash
# 1. Initialize — wizard splits your plan into chunks and indexes your codebase
npx dev-sesssion@latest init

# 2. Start each coding session by pasting the generated prompt
dev-sesssion prompt          # print NEXT_PROMPT.md
# paste into Claude, Cursor, opencode, or any AI chat

# 3. After the session — mark tasks done and regenerate the prompt
dev-sesssion update

# 4. When a chunk is fully done — archive it and move to the next
dev-sesssion advance

# Check progress anytime
dev-sesssion status          # task %, token budget, health warnings
```

---

## Core concepts

### Context snapshot

Every session starts with `NEXT_PROMPT.md` — a ≤20-line file that tells the AI exactly what chunk is active, which files to load, which tasks are pending, and how much context budget is available. `dev-sesssion prompt` prints it; you paste it. The AI is fully oriented in under a minute.

The underlying data lives in `SESSION_STATE.md`: task statuses, notes from the session, and the last-touched files. `dev-sesssion update` writes back to it interactively. Nothing accumulates in your AI tool's global config — the session brain is entirely in `.session/`.

### File registry

`FILE_INDEX.md` is an annotated table of every file the AI should know about, tagged by plan chunk. It tracks each file's purpose and a token-cost estimate. `dev-sesssion index add <filepath>` appends an entry; `dev-sesssion index audit` flags stale ones when files are deleted or moved.

The registry keeps context budgets honest. `dev-sesssion status` shows a per-file breakdown so you know exactly how many tokens you're handing to the AI before the session starts — not mid-conversation when it's too late.

### Plan chunks

Your project plan lives in numbered `PLAN_*.md` files — one chunk per meaningful slice of work. Chunking is what keeps context permanently lean: the AI loads only the active chunk's plan, files, and state. Everything prior is archived.

`dev-sesssion advance` closes the current chunk automatically: marks it complete, rotates the FILE_INDEX to the next chunk's files, and regenerates `NEXT_PROMPT.md` for chunk N+1. The session brain resets with zero manual intervention.

---

## Toy example

You're building a payments service. After `init`, your `.session/` looks like:

```
.session/
├── SESSION_STATE.md   ← active chunk, task list, notes
├── FILE_INDEX.md      ← 12 files tagged to chunks 1-3
├── NEXT_PROMPT.md     ← ≤20 lines to paste at session start
├── PLAN_1.md          ← "Stripe integration" — 5 tasks
├── PLAN_2.md          ← "Webhooks" — not started yet
└── ROUTINES.md        ← session start/end checklist
```

Paste `NEXT_PROMPT.md` into Claude. It loads `src/payments/stripe-client.ts` and `src/payments/types.ts` — nothing else. After the session:

```bash
dev-sesssion update    # ✓ mark 3 of 5 tasks done, add a note
dev-sesssion status    # 3/5 tasks · ~1,420/4,000 bootstrap tokens (36%)
```

When chunk 1 is fully done:

```bash
dev-sesssion advance   # archives chunk 1 → activates chunk 2 → new NEXT_PROMPT.md written
```

The next session opens on the Webhooks chunk. No manual file wrangling, no stale context.

---

## Commands

| Command | Description |
|---|---|
| `dev-sesssion init` | Initialize `.session/` — wizard: plan, mode, file index |
| `dev-sesssion status` | Task progress, context budget, health warnings |
| `dev-sesssion update` | Mark tasks done interactively, add notes |
| `dev-sesssion advance` | Archive current chunk, move to next, regenerate prompt |
| `dev-sesssion prompt` | Print `NEXT_PROMPT.md` to stdout |
| `dev-sesssion index add <filepath>` | Add a file to `FILE_INDEX.md` |
| `dev-sesssion index audit` | Detect stale or missing FILE_INDEX entries |
| `dev-sesssion health` | Full session audit — staleness, budget, missing files |
| `dev-sesssion health --fix` | Auto-remove stale FILE_INDEX entries |
| `dev-sesssion verify` | Reconcile session claims against git history |
| `dev-sesssion verify --replay` | Score past prompts on recall, precision, and wasted context |
| `dev-sesssion import --from claude` | Pull CLAUDE.md sections into session notes |
| `dev-sesssion import --from cursor` | Pull `.cursor/rules` globs into FILE_INDEX |
| `dev-sesssion export --to claude` | Sync session state back to CLAUDE.md |
| `dev-sesssion export --to cursor` | Sync FILE_INDEX tags to `.cursor/rules` |
| `dev-sesssion migrate` | Initialize dev-sesssion in each monorepo package |

**Global flags:**

| Flag | Description |
|---|---|
| `--cwd <path>` | Run in a different directory |
| `-y, --yes` | Skip prompts, use defaults |
| `--dry-run` | Preview writes without writing |
| `-v, --verbose` | Detailed output |
| `--strict` | Block on secret detection instead of warning |
| `--adapter <name>` | Override adapter detection (`claude`, `opencode`, `cursor`, `windsurf`) |

Full command reference: [docs/commands.md](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/commands.md).

---

## Adapters

`dev-sesssion` auto-detects your AI tool and generates output in the format it expects:

| Tool | Detected by | Output |
|---|---|---|
| **Claude Code** | `CLAUDE.md` or `.claude/` | `@`-file mentions in `NEXT_PROMPT.md` |
| **opencode** | `AGENTS.md` or `opencode.json` | `Exclude:` directives |
| **Cursor** | `.cursor/` or `.cursor/rules` | `Ignore:` directives |
| **Windsurf** | `.windsurfrules` or `.windsurf/` | `Ignore:` directives |

Detection is ordered: Claude Code, opencode, Cursor, Windsurf. When none match,
the plain-text formatter is used.

Override detection with `--adapter <name>`. Using a tool that isn't listed?
Programmatic consumers can plug in their own adapter with `registerAdapter()`
from `@dev-session/adapters` — see
[Authoring adapters](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/authoring-adapters.md).

---

## Team mode

```bash
dev-sesssion init --team
```

In team mode:

- `SESSION_STATE.md` and `NEXT_PROMPT.md` → `.gitignore` (per-developer, ephemeral)
- `FILE_INDEX.md` → `.gitattributes` with `merge=ours` (no merge conflicts)
- `PLAN_*.md` and `ROUTINES.md` → committed and shared

Everyone runs `init` once. The shared plan keeps the team on the same chunk; each developer maintains their own session state.

---

## Monorepo support

```bash
dev-sesssion migrate          # interactive package selection
dev-sesssion migrate --yes    # initialize all packages with defaults
```

Detects pnpm, npm, Yarn, Nx, and Turborepo workspaces.

---

## Security

`dev-sesssion` is built with defense-in-depth:

- **Secret scanning** — 10 regex patterns (AWS keys, GitHub tokens, private keys, etc.) on every file write. Warns by default; blocks in `--strict` mode.
- **Atomic writes** — all writes go `.tmp` → `rename()`. No partial files ever reach disk.
- **Path validation** — every external file path goes through `PathValidator.safeResolvePath()`. Path traversal attacks are rejected at the boundary.
- **Safe YAML** — uses `@11ty/gray-matter` with the JS engine disabled. No `eval()` RCE possible.
- **Egress scanning** — `compact` is the only command that sends data over the network, and it scans the file for secrets *before* the API call. It refuses to send on a match, printing only redacted values.

---

## Documentation

| Doc | What's in it |
|---|---|
| [Getting started](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/getting-started.md) | Installation, `.session/` structure, first-session walkthrough |
| [Complete guide](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/GUIDE.md) | Concepts, daily workflow, command walkthroughs, FAQ |
| [Command reference](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/commands.md) | Every command, flag, and exit code |
| [Adapters](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/adapters.md) | Detection, per-tool prompt formats, switching adapters |
| [Authoring adapters](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/authoring-adapters.md) | How to write a new adapter |
| [Team mode](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/team-mode.md) | Shared repos: what is committed, what stays local |
| [API reference](https://github.com/RJonMshka/dev-sesssion/blob/main/docs/API.md) | `@dev-session/core` exports for programmatic use |
| [PROTOCOL.md](https://github.com/RJonMshka/dev-sesssion/blob/main/PROTOCOL.md) | The Session Protocol v1.0 spec (the `.session/` format) |
| [SECURITY.md](https://github.com/RJonMshka/dev-sesssion/blob/main/SECURITY.md) | Threat model and vulnerability disclosure |

---

## Contributing

See [CONTRIBUTING.md](https://github.com/RJonMshka/dev-sesssion/blob/main/CONTRIBUTING.md) for development setup, conventions, and the pull request process.

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
