# Adapters

An adapter controls how `dev-sesssion` formats `NEXT_PROMPT.md` and how it integrates with your AI tool's config files.

---

## Auto-detection

`dev-sesssion` detects your adapter by looking for tool-specific files in your project root:

| File or directory present | Detected adapter |
|---|---|
| `CLAUDE.md` or `.claude/` | Claude Code |
| `AGENTS.md` or `opencode.json` | opencode |
| `.cursor/` or `.cursor/rules` | Cursor |
| `.windsurfrules` or `.windsurf/` | Windsurf |
| (none found) | Plain text (fallback) |

Markers are checked in that order and the first match wins, so a project with both
`CLAUDE.md` and `.cursor/` resolves to Claude Code. Note that `.cursorrules` is
Cursor's *output* file, not a detection marker — use `--adapter cursor` if that is
all your project has.

Override detection with `--adapter <name>` on any command:

```bash
dev-sesssion init --adapter cursor
dev-sesssion update --adapter opencode
```

---

## Claude Code

**Detected by:** `CLAUDE.md` or a `.claude/` directory

**NEXT_PROMPT.md format:**

Uses `@`-file mentions so Claude Code auto-loads files from disk:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~2180/4000 tokens [OK]
Load: @src/api/users.ts, @src/api/middleware.ts, @src/schemas/user.ts
Do NOT read: **/__tests__/**, **/dist/**
Resume: 1/3 tasks done Chunks 1-2 done.
Last touched: @src/api/users.ts
Next:
  [ ] Implement /users endpoint
  [ ] Add request validation
```

Excludes use "Do NOT read" rather than "load" to match Claude Code's terminology.
`Last touched` paths are `@`-mentioned too.

**Setup (on init):**

Writes a `# dev-sesssion` section in `CLAUDE.md` with the session configuration instructions for the Claude Code AI.

---

## opencode

**Detected by:** `AGENTS.md` or `opencode.json`

**NEXT_PROMPT.md format:**

Uses `Exclude:` directives, compatible with opencode's AGENTS.md format:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~2180/4000 tokens [OK]
Load: src/api/users.ts, src/api/middleware.ts, src/schemas/user.ts
Exclude: **/__tests__/**, **/dist/**
Resume: 1/3 tasks done Chunks 1-2 done.
Next:
  [ ] Implement /users endpoint
  [ ] Add request validation
```

**Setup (on init):**

Writes a `# dev-sesssion` section in `AGENTS.md`.

---

## Cursor

**Detected by:** a `.cursor/` directory (or `.cursor/rules`)

**NEXT_PROMPT.md format:**

Uses `Ignore:` directives, compatible with Cursor's rules format:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~2180/4000 tokens [OK]
Load: src/api/users.ts, src/api/middleware.ts, src/schemas/user.ts
Ignore: **/__tests__/**, **/dist/**
Resume: 1/3 tasks done Chunks 1-2 done.
Next:
  [ ] Implement /users endpoint
  [ ] Add request validation
```

**Setup (on init):**

Writes a `# dev-sesssion` section in `.cursorrules`.

---

## Windsurf

**Detected by:** `.windsurfrules` or a `.windsurf/` directory

**NEXT_PROMPT.md format:**

Same as Cursor — plain file paths with `Ignore:` directives:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~2180/4000 tokens [OK]
Load: src/api/users.ts, src/api/middleware.ts, src/schemas/user.ts
Ignore: **/__tests__/**, **/dist/**
Resume: 1/3 tasks done Chunks 1-2 done.
Next:
  [ ] Implement /users endpoint
  [ ] Add request validation
```

**Setup (on init):**

Writes a `# dev-sesssion:start` … `# dev-sesssion:end` section in `.windsurfrules`.

---

## What every adapter shares

Whatever the syntax, all four formatters emit the same sections in the same order —
header (`Project`, `Active chunk`, `Budget`), context (`Load` / `Load full` +
`Summaries` when an ai-index exists, then the exclude line), resume
(`Resume`, `Last touched`), `Next:` tasks, then `Note:` lines.

Two rules bind every formatter, built-in or custom:

- **Honour the line cap.** `BootstrapContext.maxPromptLines` carries the project's
  `max_prompt_lines` setting (default 20). Trim to it with `trimToMaxLines` — which
  spends the final line on a `[N more lines trimmed — see .session/SESSION_STATE.md]`
  marker rather than dropping content silently. Notes and the exclude line sit last,
  so they are the first things a trim removes.
- **Emit the required fields.** `NextPromptWriter.write()` validates before it
  persists: a prompt missing `Project:`, `Active chunk:`, or a file-load line, or
  one over the cap, throws `CliError` and is never written. This applies to
  adapters registered via `registerAdapter()` too — a third-party formatter cannot
  put malformed output on disk.
- **Use a known file-load prefix.** A file-load line is recognised by its prefix,
  and the accepted set is one shared list (`FILE_LOAD_PREFIXES`): `Load:`,
  `Files to load:` (legacy), `Load full:`, and
  `Summaries (read_file_layer for detail):`. The last two are the layered section
  and are best produced by `formatLayeredContextLines`, which also appends the
  `·L<n>` layer marker that replay scoring strips back off. See
  [authoring-adapters.md](authoring-adapters.md#your-file-load-line-must-carry-a-known-prefix).

---

## Custom adapters

Using a tool that isn't listed? Programmatic consumers can register their own
adapter at runtime:

```typescript
import { registerAdapter } from "@dev-session/adapters";

registerAdapter(MyToolAdapter);
```

Once registered, the adapter resolves by name everywhere, including
`--adapter <name>`. See [authoring-adapters.md](authoring-adapters.md) for the
full guide.

---

## Switching adapters

You can switch adapters at any time:

```bash
# Regenerate NEXT_PROMPT.md for a different adapter
dev-sesssion update --adapter cursor

# Or set it persistently by initializing with the flag
dev-sesssion init --adapter opencode
```

The adapter preference is not persisted in `SESSION_STATE.md` — it is re-detected (or overridden via `--adapter`) on each command.

---

## Export to adapter config

`dev-sesssion export` writes session state back to your adapter's config file, keeping it in sync with your current chunk:

```bash
dev-sesssion export --to claude    # writes/updates CLAUDE.md section
dev-sesssion export --to cursor    # writes .cursor/rules/dev-sesssion.mdc
```

Both operations are idempotent — running them again updates the existing section rather than appending.
