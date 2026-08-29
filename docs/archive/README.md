# Archive

Historical record. Nothing here describes how the project works today — read
[`docs/`](../) for that, and [`docs/plan/`](../plan/HLD.md) for work in flight.

| File | What it is |
|---|---|
| [`PLAN.md`](./PLAN.md) | The v1 plan, chunks 1–16. How the project was planned when planning used `.session/` chunks. |
| [`PLANv2.md`](./PLANv2.md) | The v2 extension, chunks 12–17 — the context-intelligence layer. Superseded by `docs/plan/`. |
| [`session-notes.md`](./session-notes.md) | Running notes from chunks 1–19: what broke, why, and what the fix depended on. |

## Why these two plans are kept

They are the reason the code is shaped the way it is, and neither is reachable
from the current design docs. They are also **live test fixtures**: both are
long, hand-maintained, genuinely messy markdown, and
`tests/plan-dialects.integration.test.ts` parses them as the regression anchor
for the plan source registry. Deleting or reformatting them breaks that test —
which is the point. A synthetic fixture never caught the bugs these documents
did.

## What used to be in `.session/`

This repository planned itself through chunk 19 using its own `.session/`
format, then stopped — chunks schedule sessions, LLDs record design, and forcing
one into the other produced neither. See
[Why not .session/](../METHOD.md#why-not-session) in METHOD.md.

That directory was removed in the docs cleanup. Where its contents went:

| Was | Now |
|---|---|
| `SESSION_STATE.md` notes | [`session-notes.md`](./session-notes.md) — it was gitignored, so this is the only copy |
| `PLAN_17.md` / `PLAN_18.md` (deferred backlog) | "Deferred backlog" in [`session-notes.md`](./session-notes.md) |
| `FILE_INDEX.md` | `tests/fixtures/messy-file-index/FILE_INDEX.md` — byte-identical, and still used as an integration fixture |
| `PLAN_1.md` … `PLAN_18.md` | Git history only |
| `ROUTINES.md`, `DONE_LOG.md`, `NEXT_PROMPT.md` | Dropped |

To read the chunk files as they stood:

```bash
git show f4b3a7d:.session/PLAN_9.md
git ls-tree f4b3a7d .session/     # list them all
```
