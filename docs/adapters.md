# Adapters

An adapter controls how `dev-sesssion` formats `NEXT_PROMPT.md` and how it integrates with your AI tool's config files.

---

## Auto-detection

`dev-sesssion` detects your adapter by looking for tool-specific files in your project root:

| File present | Detected adapter |
|---|---|
| `CLAUDE.md` | Claude Code |
| `AGENTS.md` | opencode |
| `.cursorrules` | Cursor |
| (none found) | Claude Code (fallback) |

Override detection with `--adapter <name>` on any command:

```bash
dev-sesssion init --adapter cursor
dev-sesssion update --adapter opencode
```

---

## Claude Code

**Detected by:** `CLAUDE.md`

**NEXT_PROMPT.md format:**

Uses `@`-file mentions so Claude Code auto-loads files from disk:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~8,400 / 200,000 tokens (4%)

Tasks:
- [ ] Implement /users endpoint
- [ ] Add request validation
- [x] Design schema

Load:
@src/api/users.ts @src/api/middleware.ts @src/schemas/user.ts

Do NOT read: **/__tests__/** **/dist/**
```

**Setup (on init):**

Writes a `# dev-sesssion` section in `CLAUDE.md` with the session configuration instructions for the Claude Code AI.

---

## opencode

**Detected by:** `AGENTS.md`

**NEXT_PROMPT.md format:**

Uses `Exclude:` directives, compatible with opencode's AGENTS.md format:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~8,400 / 200,000 tokens (4%)

Tasks:
- [ ] Implement /users endpoint
- [ ] Add request validation

Load: src/api/users.ts, src/api/middleware.ts, src/schemas/user.ts

Exclude: **/__tests__/**, **/dist/**
```

**Setup (on init):**

Writes a `# dev-sesssion` section in `AGENTS.md`.

---

## Cursor

**Detected by:** `.cursorrules`

**NEXT_PROMPT.md format:**

Uses `Ignore:` directives, compatible with Cursor's rules format:

```
Project: my-app
Active chunk: 3 — API layer
Budget: ~8,400 / 200,000 tokens (4%)

Tasks:
- [ ] Implement /users endpoint
- [ ] Add request validation

Load: src/api/users.ts, src/api/middleware.ts, src/schemas/user.ts

Ignore: **/__tests__/**, **/dist/**
```

**Setup (on init):**

Writes a `# dev-sesssion` section in `.cursorrules`.

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
