## Chunk 8 — Team mode & enterprise features

### Tasks

- [ ] `dev-session init --team` — prompts for team vs personal mode
- [ ] Generates `.gitignore` patch: adds `SESSION_STATE.md`, `NEXT_PROMPT.md`, `DONE_LOG.md`
- [ ] Generates `.gitattributes` entry: mark `FILE_INDEX.md` as merge=ours to reduce conflicts
- [ ] `dev-session migrate` — handles monorepos: auto-detect `pnpm-workspace.yaml` / `nx.json` / `turborepo`
- [ ] `dev-session import --from claude` — parse existing `CLAUDE.md` content into chunk notes
- [ ] `dev-session import --from cursor` — parse `.cursor/rules/*.mdc` frontmatter into FILE_INDEX tags
- [ ] `dev-session health` — full audit command:
- [ ] `dev-session health --fix` — auto-remediate where safe (remove stale index entries)
- [ ] FILE_INDEX pagination for repos with 500+ files — split into `FILE_INDEX_1.md`, `FILE_INDEX_2.md`
- [ ] `--max-files` flag on `init` to limit initial index size
- [ ] Token budget display: show estimated context window cost for current chunk's files
- [ ] Integration: team mode `.gitignore` patch is idempotent
- [ ] Integration: monorepo detection for pnpm, nx, turborepo workspace files
- [ ] E2e: `dev-session import --from claude` on fixture `CLAUDE.md`
- [ ] E2e: `dev-session health` on intentionally degraded `.session/`
