---
version: 1
---

# Routines

## Bootstrap (start of session)

```
Starting session. Execute in order:
1. Read .session/SESSION_STATE.md — note active chunk and open tasks
2. Read .session/FILE_INDEX.md — identify files tagged to active chunk
3. Read the active chunk section from docs/PLAN.md
4. Load only the tagged files into context
5. Summarize: active chunk goal, today's tasks, files in context
6. Ask for confirmation before writing any code
```

## Self-update (end of session)

```
Session ending. Execute in order:
1. Update .session/SESSION_STATE.md — mark completed tasks [x], note stopping point, update last-worked files
2. Update .session/FILE_INDEX.md — add new files created, update chunk tags if scope changed
3. Rewrite .session/NEXT_PROMPT.md from scratch — project name, active chunk, files to load,
   exact resume point, any prerequisite context. Must be ≤15 lines, fully self-contained.
4. If all tasks in active chunk are done: advance to next chunk in SESSION_STATE.md
Show me each file's new content before writing. I will confirm.
```
