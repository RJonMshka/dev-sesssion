# Team mode

Team mode is designed for shared repositories where multiple developers each run their own AI coding sessions against the same codebase.

---

## The problem

In a shared repo, `.session/` contains two kinds of files:

- **Shared** — the plan (`PLAN_*.md`) and file index (`FILE_INDEX.md`) should be committed so everyone starts from the same plan and file map.
- **Personal** — `SESSION_STATE.md` and `NEXT_PROMPT.md` are per-developer state and should stay local.

Without team mode, `git status` will show these personal files as untracked on every developer's machine.

---

## Enabling team mode

Pass `--team` to `init`:

```bash
dev-sesssion init --team
```

Or select "Team" in the interactive wizard when prompted.

---

## What team mode does

### 1. Patches `.gitignore`

Adds personal session files to `.gitignore`:

```gitignore
# dev-sesssion (ephemeral session state)
.session/SESSION_STATE.md
.session/NEXT_PROMPT.md
.session/DONE_LOG.md
```

These files are generated locally on each developer's machine. They are never committed.

This is one entry shorter than the personal-mode patch, which also ignores
`.session/ai-index.yaml`. In team mode the extracted symbol index is treated as
shared project structure and committed, so every developer's session starts from
the same layered context instead of re-extracting it.

### 2. Patches `.gitattributes`

Adds a merge strategy for the shared file index:

```gitattributes
# dev-sesssion (team merge strategy)
.session/FILE_INDEX.md merge=ours
```

`merge=ours` means that if two developers edit `FILE_INDEX.md` on different branches, Git will always keep the current branch's version. This avoids merge conflicts on the index — the developer advancing the chunk owns the authoritative version.

### 3. Auto-applies without prompts

In team mode, the `.gitignore` patch is applied automatically (no confirmation prompt). This matches the expected behavior in CI and automated setup scripts.

---

## Shared vs personal files

| File | Committed | Notes |
|---|---|---|
| `.session/PLAN_*.md` | Yes | Shared plan — everyone works from the same chunks |
| `.session/FILE_INDEX.md` | Yes | Shared index — updated when advancing chunks |
| `.session/ROUTINES.md` | Yes | Shared session checklist |
| `.session/SESSION_STATE.md` | No | Per-developer task state |
| `.session/NEXT_PROMPT.md` | No | Per-developer generated prompt |
| `.session/ai-index.yaml` | Yes | Shared symbol index (gitignored in personal mode) |
| `.session/DONE_LOG.md` | No | Per-developer archive |

---

## Team workflow

1. **One developer** runs `dev-sesssion init --team` and commits the shared files:
   ```bash
   dev-sesssion init --team
   git add .session/PLAN_*.md .session/FILE_INDEX.md .session/ROUTINES.md
   git add .gitignore .gitattributes
   git commit -m "chore: add dev-sesssion"
   ```

2. **Other developers** pull and run `dev-sesssion init` to generate their local session state:
   ```bash
   git pull
   dev-sesssion init        # detects existing .session/, asks to reinitialize
   ```

3. **Everyone** uses the same commands to manage their sessions:
   ```bash
   dev-sesssion status
   dev-sesssion update
   dev-sesssion advance
   ```

4. **When a chunk is completed**, the developer who advances commits the updated shared files:
   ```bash
   dev-sesssion advance
   git add .session/FILE_INDEX.md .session/PLAN_*.md
   git commit -m "chore: advance to chunk 4"
   ```

---

## Measuring prompt quality across the team

`dev-sesssion verify --replay` scores past bootstrap prompts against the commits
that followed them — recall (files the session needed that the prompt named),
precision, and waste. It reads those prompts **out of git history**, which means
it only works where `.session/NEXT_PROMPT.md` is tracked.

Team mode does *not* enable this on its own: the team `.gitignore` patch still
excludes `NEXT_PROMPT.md`, on the reasoning that the prompt is per-developer
output. If your team wants replay scoring, make it a deliberate opt-in:

1. Remove `.session/NEXT_PROMPT.md` from `.gitignore`.
2. Add a merge strategy for it, since every developer rewrites it:
   ```gitattributes
   .session/NEXT_PROMPT.md merge=ours
   ```
3. Commit the prompt alongside the shared plan whenever a chunk advances.

```bash
dev-sesssion verify --replay --verbose
```

From then on, every commit that rewrites the prompt becomes a scorable session
boundary, and the team gets a trend line on whether its `FILE_INDEX.md` chunk
tagging is actually improving. Until then the command reports why scoring is
unavailable rather than showing a misleading zero.

The trade-off is real: a committed `NEXT_PROMPT.md` churns on every session and
will show up in diffs. Teams that care more about a quiet history than about the
metric should leave it ignored.

---

## Monorepo teams

For monorepos with multiple packages, use `dev-sesssion migrate` to initialize each package:

```bash
dev-sesssion migrate
```

Each package gets its own `.session/` with its own plan and file index.

`migrate` has no `--team` flag — it initializes packages in personal mode. To put
a monorepo on team mode, run `dev-sesssion init --team` inside each package you
want shared, or add the `.gitignore` / `.gitattributes` entries above by hand and
commit them once at the repo root.
