# Routines

## Bootstrap Routine

At the start of every session, paste this prompt:

```
Read .session/SESSION_STATE.md to find the active chunk.
Read .session/FILE_INDEX.md to identify files tagged to the active chunk.
Read the active chunk file (e.g., .session/PLAN_N.md).
Load only the tagged files into context.
Summarize: active chunk goal, today's tasks, files in context.
Ask for confirmation before writing any code.
```

## Self-Update Routine

At the end of every session, run this:

```
Session ending. Execute in order:
1. Update .session/SESSION_STATE.md — mark completed tasks [x], note stopping point, update last-worked files
2. Update .session/FILE_INDEX.md — add new files created, update chunk tags if scope changed
3. Rewrite .session/NEXT_PROMPT.md from scratch — project name, active chunk, files to load,
   exact resume point, any prerequisite context. Must be <=15 lines, fully self-contained.
4. If all tasks in active chunk are done: advance to next chunk in SESSION_STATE.md
Show me each file's new content before writing. I will confirm.
```
