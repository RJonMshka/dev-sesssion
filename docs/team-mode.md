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
dev-session init --team
```

Or select "Team" in the interactive wizard when prompted.

---

## What team mode does

### 1. Patches `.gitignore`

Adds personal session files to `.gitignore`:

```gitignore
# dev-session (ephemeral session state)
.session/SESSION_STATE.md
.session/NEXT_PROMPT.md
.session/DONE_LOG.md
```

These files are generated locally on each developer's machine. They are never committed.

### 2. Patches `.gitattributes`

Adds a merge strategy for the shared file index:

```gitattributes
# dev-session (team merge strategy)
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
| `.session/DONE_LOG.md` | No | Per-developer archive |

---

## Team workflow

1. **One developer** runs `dev-session init --team` and commits the shared files:
   ```bash
   dev-session init --team
   git add .session/PLAN_*.md .session/FILE_INDEX.md .session/ROUTINES.md
   git add .gitignore .gitattributes
   git commit -m "chore: add dev-session"
   ```

2. **Other developers** pull and run `dev-session init` to generate their local session state:
   ```bash
   git pull
   dev-session init        # detects existing .session/, asks to reinitialize
   ```

3. **Everyone** uses the same commands to manage their sessions:
   ```bash
   dev-session status
   dev-session update
   dev-session advance
   ```

4. **When a chunk is completed**, the developer who advances commits the updated shared files:
   ```bash
   dev-session advance
   git add .session/FILE_INDEX.md .session/PLAN_*.md
   git commit -m "chore: advance to chunk 4"
   ```

---

## Monorepo teams

For monorepos with multiple packages, use `dev-session migrate` to set up team mode in each package:

```bash
dev-session migrate --team
```

Each package gets its own `.session/` with its own plan and file index. Personal state files are kept out of git per-package.
