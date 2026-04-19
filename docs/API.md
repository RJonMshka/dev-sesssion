# API Reference — dev-sesssion/core v1.0.0

`dev-sesssion` exposes a `core` library you can use to build custom integrations, companion tools, or alternative UIs on top of the session state model.

```bash
npm install dev-sesssion
```

```ts
import {
  SessionStateManager,
  FileIndexManager,
  NextPromptWriter,
  PlainTextFormatter,
} from "dev-sesssion";
```

---

## Four core operations

| Concept | Export | What it does |
|---|---|---|
| **createSession** | `SessionStateManager` | Load or persist session state from `SESSION_STATE.md` |
| **captureContext** | `PlainTextFormatter` | Format session state into a structured AI prompt |
| **indexFiles** | `FileIndexManager` | Load, query, and update the `FILE_INDEX.md` registry |
| **exportState** | `NextPromptWriter` | Generate and write `NEXT_PROMPT.md` |

---

## SessionStateManager

Manages `SESSION_STATE.md`. All I/O uses `AtomicWriter` and `FrontmatterParser` from `dev-sesssion/security`. State-transition helpers are pure functions with no side effects.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `load` | `(sessionDir: ValidatedPath) => SessionState` | `SessionState` | Parse and validate `SESSION_STATE.md` |
| `save` | `(sessionDir: ValidatedPath, state: SessionState) => void` | `void` | Atomic write; auto-updates `last_updated` |
| `markTaskDone` | `(state, taskText: string) => SessionState` | `SessionState` | Pure — mark matching task as done |
| `markTaskInProgress` | `(state, taskText: string) => SessionState` | `SessionState` | Pure — mark matching task as in-progress |
| `addNote` | `(state, note: string) => SessionState` | `SessionState` | Pure — append a note |
| `updateLastWorked` | `(state, files: string[]) => SessionState` | `SessionState` | Pure — replace last-worked file list |
| `compact` | `(state) => SessionState` | `SessionState` | Pure — trim completed-chunk detail, add summary note |

```ts
import { PathValidator, SessionStateManager } from "@dev-sesssion/core";

const sessionDir = PathValidator.safeResolvePath(root, ".session");
const state = SessionStateManager.load(sessionDir);
const updated = SessionStateManager.markTaskDone(state, "Add Stripe webhook handler");
SessionStateManager.save(sessionDir, updated);
```

---

## PlainTextFormatter

Formats a `BootstrapContext` into a structured prompt string. Implements `BootstrapFormatter`. For tool-specific formatting (Claude Code `@`-mentions, opencode directives) use the adapter formatters from `dev-sesssion/adapters`.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `generatePrompt` | `(ctx: BootstrapContext) => string` | `string` | Full structured prompt — header, files, resume, tasks, notes |
| `formatFilesToLoad` | `(files: FileIndexEntry[]) => string` | `string` | Comma-separated list with overflow count |
| `formatExcludes` | `(patterns: string[]) => string` | `string` | "Do NOT load: …" line, or empty string |
| `formatAiIndex` | `(index: AiIndex, layer: 0\|1\|2) => string` | `string` | AI index content at the given context layer |

```ts
interface BootstrapContext {
  state: SessionState;
  chunk: PlanChunk;
  chunkFiles: FileIndexEntry[];
  alwaysIncludeFiles: FileIndexEntry[];
  budget: ContextBudget;
  excludePatterns: string[];
  projectName: string;
}
```

```ts
import { PlainTextFormatter } from "@dev-sesssion/core";

const prompt = PlainTextFormatter.generatePrompt({
  state,
  chunk,
  chunkFiles,
  alwaysIncludeFiles: [],
  budget,
  excludePatterns: [],
  projectName: "payments-service",
});
```

---

## FileIndexManager

Manages `FILE_INDEX.md`. Parses the markdown table format and provides query helpers.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `load` | `(sessionDir: ValidatedPath) => FileIndexEntry[]` | `FileIndexEntry[]` | Parse `FILE_INDEX.md` |
| `save` | `(sessionDir: ValidatedPath, entries: FileIndexEntry[]) => void` | `void` | Atomic write |
| `add` | `(entries, entry: FileIndexEntry) => FileIndexEntry[]` | `FileIndexEntry[]` | Pure — append entry, deduplicates by path |
| `queryByChunk` | `(entries, chunkId: number) => FileIndexEntry[]` | `FileIndexEntry[]` | Filter to a specific chunk |
| `alwaysInclude` | `(entries) => FileIndexEntry[]` | `FileIndexEntry[]` | Return entries tagged "Always Include" |
| `audit` | `(entries, sessionDir: ValidatedPath) => AuditResult` | `AuditResult` | Detect stale (deleted) and ok files |

```ts
interface FileIndexEntry {
  filepath: string;
  purpose: string;
  chunk?: number;
  token_cost?: number;
}

interface AuditResult {
  stale: FileIndexEntry[];   // file no longer exists on disk
  ok: FileIndexEntry[];      // file present
}
```

```ts
import { FileIndexManager } from "@dev-sesssion/core";

const entries = FileIndexManager.load(sessionDir);
const chunkFiles = FileIndexManager.queryByChunk(entries, 3);
const { stale } = FileIndexManager.audit(entries, sessionDir);
```

---

## NextPromptWriter

Generates `NEXT_PROMPT.md` content. Use `generateWithFormatter` for adapter-aware output; `generate` for the plain fallback.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `generate` | `(state, chunk, files) => string` | `string` | Plain-text prompt (no adapter formatting) |
| `generateWithFormatter` | `(ctx: BootstrapContext, formatter: BootstrapFormatter) => string` | `string` | Prompt via formatter — recommended |
| `write` | `(sessionDir, content: string) => void` | `void` | Atomic write to `NEXT_PROMPT.md` |
| `validate` | `(content: string) => ValidationResult` | `ValidationResult` | Check line count against the 15-line cap |

```ts
interface ValidationResult {
  valid: boolean;
  lineCount: number;
  maxLines: number;
}
```

```ts
import { NextPromptWriter, PlainTextFormatter } from "@dev-sesssion/core";

const content = NextPromptWriter.generateWithFormatter(ctx, PlainTextFormatter);
const result = NextPromptWriter.validate(content);
NextPromptWriter.write(sessionDir, content);
```

---

## Error types

All errors thrown by `@dev-sesssion/core` are typed:

| Class | When thrown |
|---|---|
| `CliError` | Recoverable user-facing errors (missing files, bad configuration) |
| `ParseError` | Malformed YAML frontmatter or schema validation failure |
| `SecurityError` | Path traversal, secret detected in output, or JS frontmatter engine invoked |

```ts
import { CliError, ParseError, SecurityError } from "@dev-sesssion/core";

try {
  const state = SessionStateManager.load(sessionDir);
} catch (err) {
  if (err instanceof ParseError) {
    console.error("SESSION_STATE.md is malformed:", err.message);
  } else if (err instanceof SecurityError) {
    console.error("Security violation:", err.message);
  }
}
```

---

## Path safety

All file paths from external sources must go through `PathValidator` before being passed to any manager. Managers accept `ValidatedPath` (a branded string type), not raw `string`.

```ts
import { PathValidator } from "@dev-sesssion/core";

// Throws SecurityError if path escapes the project root
const safe = PathValidator.safeResolvePath(projectRoot, userProvidedPath);
```

See `packages/security` for the full security surface (`AtomicWriter`, `SecretScanner`, `WriteGuard`, `FrontmatterParser`).
