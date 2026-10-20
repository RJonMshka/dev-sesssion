# First-run fixtures

Inputs for `docs/plan/LLD-first-run.md` (area `RUN`). Keep them byte-for-byte as
they are. Never run `dev-sesssion` against this directory.

| File | What it is | Requirements |
|---|---|---|
| `CLAUDE.md` | A one-section `CLAUDE.md` after a real `dev-sesssion@2.4.1 --adapter claude init --yes`, which appended the managed block. Captured 2026-10-19 | REQ-RUN-7, -8, -9, -18 |

`import --from claude` run by 2.4.1 on that file wrote these two notes, which
`packages/core/src/__tests__/claude-md-notes.test.ts` carries verbatim:

```
Quoted from CLAUDE.md § "Conventions": "Use tabs. <!-- dev-sesssion:start -->"
Quoted from CLAUDE.md § "dev-sesssion": "This project uses [dev-sesssion](https://github.com/RJonMshka/dev-sesssion) to manage AI coding sessions. **Start:** Rea"
```
