# Test Plan — `dev-sesssion` (post-publish, via npm)

Goal: after `dev-sesssion` is published, install it the way a real user would and
exercise **every command** end-to-end. This validates the published artifact, not
the source tree.

## 0. Install & sanity

```bash
# In a throwaway dir, on a fresh shell (clean PATH, no repo checkout):
npm install -g dev-sesssion          # or: npx dev-sesssion@latest <cmd>
which dev-sesssion                   # resolves to the global shim
dev-sesssion --help                  # usage line reads "dev-sesssion"
dev-sesssion --version               # reports the published version (read from package.json), not 0.0.0
```

Pass criteria: command resolves, help shows the `dev-sesssion` name and the full
command list below, exit code 0.

> Important: run these **outside** the project checkout. The repo directory is
> itself named `dev-sesssion`, which is exactly the substring the CLI's auto-run
> heuristic matches — testing inside it can mask path-detection bugs.

## 1. Per-command coverage

Set up a scratch project first:

```bash
mkdir /tmp/ds-smoke && cd /tmp/ds-smoke && git init && npm init -y
```

| # | Command | What to run | Expected |
|---|---------|-------------|----------|
| 1 | `init` | `dev-sesssion init --yes` | `.session/` created with `SESSION_STATE.md`, `FILE_INDEX.md`, `NEXT_PROMPT.md`; adapter auto-detected |
| 2 | `init --adapter` | `dev-sesssion init --yes --adapter cursor` (fresh dir) | Cursor adapter wired instead of auto-detect |
| 3 | `migrate` | run in a monorepo fixture with workspace packages | `.session/` initialized per workspace package |
| 4 | `status` | `dev-sesssion status` / `--json` | task progress, context budget, health warnings; `--json` is **valid parseable JSON** (no extra trailing output) |
| 5 | `update` | `dev-sesssion update` | interactive: mark task done, add note → `SESSION_STATE.md` + `NEXT_PROMPT.md` updated |
| 6 | `advance` | `dev-sesssion advance --yes` | current chunk archived, advanced to next; exit 0 |
| 7 | `prompt` | `dev-sesssion prompt` | prints `NEXT_PROMPT.md` to stdout (pipeable) |
| 8 | `index` | `dev-sesssion index` / `--update` / `--dry-run` | generates/updates `ai-index.yaml`; `--update` skips unchanged (mtime); `--dry-run` writes nothing |
| 9 | `health` | `dev-sesssion health` / `--json` / `--fix` | audits session health, auto-fix repairs issues |
| 10 | `import` | `dev-sesssion import` from an external rules file | external rules pulled into `.session/` |
| 11 | `export` | `dev-sesssion export` | session state written back to AI tool config files |
| 12 | `preview` | `dev-sesssion preview` / `--format json` / `--no-content` | token breakdown + assembled bootstrap; JSON form parses |
| 13 | `trim` | `dev-sesssion trim` | interactively exclude files → context budget drops |
| 14 | `lint-context` | `dev-sesssion lint-context` / `--json` | reports duplicate blocks, soft language, dead `@mentions`; JSON parses |
| 15 | `compact` | `ANTHROPIC_API_KEY=… dev-sesssion compact <file>` | AI-compacts a context file (needs API key); without key → clear error |
| 16 | `memory` | `dev-sesssion memory show -n` / `stats --json` / `stale` / `prune` | history, stats, staleness, pruning all emit cleanly |
| 17 | `mcp` | `dev-sesssion mcp` | starts stdio MCP server serving `.session/` state; responds to an MCP client handshake |

## 2. Cross-cutting checks

- **JSON commands** (`status`, `health`, `preview`, `lint-context`, `memory … --json`):
  pipe to `| jq .` — must parse with zero trailing/duplicate output. (This is the
  exact failure mode the auto-run double-execution bug produced; confirm it's gone
  on the published artifact.)
- **Adapters**: repeat `init` in projects set up for claude, opencode, cursor,
  windsurf; confirm correct adapter files are written.
- **Security invariants** (smoke level): try a traversal-y path / a file with a
  fake secret and confirm the CLI refuses / warns rather than writing.
- **Exit codes**: success = 0; user/validation errors = non-zero with a readable
  message and **no absolute paths** leaked.
- **Idempotency**: re-running `init` on an initialized project does not clobber state.

## 3. Adapter / matrix notes

- OS: at minimum macOS + Linux; ideally one Windows run (the auto-run heuristic
  uses a full-path match specifically so the Windows `.cmd` shim
  `…\node_modules\dev-sesssion\dist\index.cjs` is detected — worth a real check).
- Node: matches `engines` (`>=20`); CI uses Node 24.

## 4. Sign-off

Release is good when: install resolves as `dev-sesssion`, all 17 commands behave
as above, every `--json` output parses, and `--version` reports the real version.
