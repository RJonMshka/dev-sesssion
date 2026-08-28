# ARCHIVE — do not write to this directory

This is how `dev-sesssion` planned **itself** through chunk 19, using its own
`.session/` format. It is frozen.

Current planning lives in [`docs/plan/`](../docs/plan/HLD.md) as HLD/LLD/EARS
documents. The method is [`docs/METHOD.md`](../docs/METHOD.md).

## Do not run these against this repository

```
dev-sesssion update      # rewrites SESSION_STATE.md and NEXT_PROMPT.md
dev-sesssion advance     # archives to DONE_LOG.md, moves active_chunk
dev-sesssion index       # rewrites FILE_INDEX.md
```

They will overwrite the archive. `NEXT_PROMPT.md` is gitignored here, so
overwriting it is not recoverable from git — this already happened once.

Read-only commands (`status`, `preview`, `verify`, `health`, `prompt`) are safe.

## What is worth reading

| File | Why |
|---|---|
| `FILE_INDEX.md` | 21 sections, hand-maintained, with design notes between the tables. Captured as a test fixture at `tests/fixtures/messy-file-index/`. |
| `SESSION_STATE.md` | The `notes` block is ~20KB of accumulated gotchas — the richest record of what went wrong and why. |
| `PLAN_1.md` … `PLAN_18.md` | Chunk-by-chunk history. `PLAN_17`/`PLAN_18` are deferred backlog, not completed work. |
| `DONE_LOG.md` | Vestigial; nothing ever wrote to it meaningfully. |

## A note on the chunk ids

`PLAN_13.1.md` and `PLAN_13.2.md` were originally `PLAN_13.md` (`chunk_id: "13a"`)
and `PLAN_13b.md` (`chunk_id: "13b"`). String ids were rejected by
`PlanChunkSchema`, so `dev-sesssion update` could never run against this
directory. They were migrated to fractional ids, which the schema and
`PROTOCOL.md` both allow. See `docs/plan/LLD-session-integrity.md`.
