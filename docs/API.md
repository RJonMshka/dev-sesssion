# API Reference — @dev-session/core v1.0.0

`@dev-session/core` is the library package underlying the `dev-sesssion` CLI. Use it to build custom integrations, companion tools, or alternative UIs on top of the session state model.

```bash
npm install @dev-session/core
```

```ts
import {
  SessionStateManager,
  FileIndexManager,
  NextPromptWriter,
  PlainTextFormatter,
} from "@dev-session/core";
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

Manages `SESSION_STATE.md`. All I/O uses `AtomicWriter` and `FrontmatterParser` from `@dev-session/security`. State-transition helpers are pure functions with no side effects.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `load` | `(sessionDir: ValidatedPath) => SessionState` | `SessionState` | Parse and validate `SESSION_STATE.md` |
| `save` | `(sessionDir: ValidatedPath, state: SessionState) => void` | `void` | Atomic write; auto-updates `last_updated` |
| `toMarkdown` | `(state: SessionState) => string` | `string` | Pure — the exact text `save` writes. The budget counts it |
| `markTaskDone` | `(state, taskText: string) => SessionState` | `SessionState` | Pure — mark matching task as done |
| `markTaskInProgress` | `(state, taskText: string) => SessionState` | `SessionState` | Pure — mark matching task as in-progress |
| `adoptTask` | `(state, taskText: string) => SessionState` | `SessionState` | Pure — append the task as `todo` unless state already lists that exact text |
| `addNote` | `(state, note: string) => SessionState` | `SessionState` | Pure — append a note |
| `updateLastWorked` | `(state, files: string[]) => SessionState` | `SessionState` | Pure — replace last-worked file list |
| `compact` | `(state) => SessionState` | `SessionState` | Pure — trim completed-chunk detail, add summary note |

```ts
import { SessionStateManager } from "@dev-session/core";
import { PathValidator } from "@dev-session/security";

const sessionDir = PathValidator.safeResolvePath(".session", projectRoot);
const state = SessionStateManager.load(sessionDir);
const updated = SessionStateManager.markTaskDone(state, "Add Stripe webhook handler");
SessionStateManager.save(sessionDir, updated);
```

---

## PlainTextFormatter

Formats a `BootstrapContext` into a structured prompt string. Implements `BootstrapFormatter`. For tool-specific formatting (Claude Code `@`-mentions, opencode directives) use the adapter formatters from `@dev-session/adapters`.

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
  resolvedLayers?: ResolvedFileLayer[];  // layered loading, when an ai-index exists
  maxPromptLines?: number;               // line cap; defaults to DEFAULT_MAX_PROMPT_LINES (20)
}
```

Formatters must honour `maxPromptLines` — pass it to `trimToMaxLines`. Output that
exceeds the cap, or omits a required field, is rejected by `NextPromptWriter.write()`.

```ts
import { PlainTextFormatter } from "@dev-session/core";

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
| `load` | `(sessionDir: ValidatedPath) => FileIndexEntry[]` | `FileIndexEntry[]` | Parse `FILE_INDEX.md`. The file stores no token costs, so entries come back without `token_cost` |
| `withMeasuredCosts` | `(entries, projectRoot: string) => FileIndexEntry[]` | `FileIndexEntry[]` | Fill a missing `token_cost` from each file's size. Paths outside `projectRoot` or unreadable are left as they are |
| `save` | `(sessionDir: ValidatedPath, entries: FileIndexEntry[]) => void` | `void` | Atomic write |
| `add` | `(entries, entry: FileIndexEntry) => FileIndexEntry[]` | `FileIndexEntry[]` | Pure — append entry (deduplicates by path) |
| `queryByChunk` | `(entries, chunkId: number) => FileIndexEntry[]` | `FileIndexEntry[]` | Filter to a specific chunk |
| `alwaysInclude` | `(entries) => FileIndexEntry[]` | `FileIndexEntry[]` | Return entries tagged "Always Include" |
| `audit` | `(entries, sessionDir: ValidatedPath) => AuditResult` | `AuditResult` | Detect stale (deleted) and missing (unindexed) files |

```ts
interface FileIndexEntry {
  filepath: string;
  chunk_tags: number[];      // chunk ids; `0` means "Always Include"
  purpose: string;
  token_cost?: number;
}

interface AuditResult {
  stale: FileIndexEntry[];   // file no longer exists on disk
  missingChunks: number[];   // chunk ids in the index with no PLAN_N.md
  healthy: boolean;          // no stale entries and no missing chunks
}
```

```ts
import { FileIndexManager } from "@dev-session/core";

const entries = FileIndexManager.load(sessionDir);
const chunkFiles = FileIndexManager.queryByChunk(entries, 3);
const { stale } = FileIndexManager.audit(entries, sessionDir);
```

---

## NextPromptWriter

Generates `NEXT_PROMPT.md` content. Use `generateWithFormatter` for adapter-aware output; `generate` for the plain fallback.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `generate` | `(state, chunk, files) => string` | `string` | Plain-text prompt (legacy; no adapter formatting) |
| `generateWithFormatter` | `(formatter: BootstrapFormatter, ctx: BootstrapContext) => string` | `string` | Prompt via formatter — recommended path |
| `write` | `(sessionDir, content: string, maxLines?: number) => void` | `void` | Validate, then atomically write `NEXT_PROMPT.md` |
| `validate` | `(content: string, maxLines?: number) => ValidationResult` | `ValidationResult` | Check required fields, the line cap, and `MAX_PROMPT_CHARS` |

`maxLines` defaults to `MAX_PROMPT_LINES` (20) on both methods. Pass
`state.max_prompt_lines` to honour a project-level override.

`write()` validates before it persists, so a malformed prompt never reaches disk
— including one produced by a third-party formatter registered through
`registerAdapter()`. It throws `CliError` when the content is empty, is over the
cap, or is missing `Project:`, `Active chunk:`, or a file-load line. A file-load
line is any line starting with one of the `FILE_LOAD_PREFIXES` below, so both the
flat and the layered context sections satisfy it.

```ts
interface ValidationResult {
  valid: boolean;
  lineCount: number;      // non-empty lines only — see countPromptLines
  charCount: number;      // see countPromptChars; capped at MAX_PROMPT_CHARS
  errors: string[];       // empty when valid
}
```

```ts
import { NextPromptWriter, PlainTextFormatter } from "@dev-session/core";

const content = NextPromptWriter.generateWithFormatter(PlainTextFormatter, ctx);
const result = NextPromptWriter.validate(content, state.max_prompt_lines);
if (!result.valid) {
  console.warn(`Prompt is ${result.lineCount} lines: ${result.errors.join("; ")}`);
}
NextPromptWriter.write(sessionDir, content, state.max_prompt_lines);
```

### Prompt line counting and the cap

| Export | Kind | What it is |
|---|---|---|
| `countPromptLines` | `(content: string) => number` | The single definition of "a prompt line" — counts non-empty lines, so a trailing newline never inflates the total. Used by `validate` and by `HealthChecker`. |
| `countPromptChars` | `(content: string) => number` | The single definition of a prompt's size in characters. `validate` refuses, and `HealthChecker` warns, above `MAX_PROMPT_CHARS` (12,000), whatever the line count. |
| `MAX_PROMPT_CHARS` | `12000` | Character cap, fixed. One long note is one line, so the line cap alone does not bound size. |
| `MAX_PROMPT_LINES` | `20` | Default cap when a project sets no override. |
| `MIN_CONFIGURABLE_PROMPT_LINES` | `5` | Lower bound for `max_prompt_lines`. |
| `MAX_CONFIGURABLE_PROMPT_LINES` | `50` | Upper bound for `max_prompt_lines`. |
| `DEFAULT_MAX_PROMPT_LINES` | `20` | Fallback used by formatters when `ctx.maxPromptLines` is absent. |
| `trimToMaxLines` | `(lines: readonly string[], maxLines: number) => readonly string[]` | Trims to the cap. Truncation is never silent: when lines are dropped the final slot carries `[N more lines trimmed — see .session/SESSION_STATE.md]`. |

`max_prompt_lines` is an optional `SESSION_STATE.md` frontmatter field
(integer, 5–50). `SessionStateManager.save` serializes it only when it differs
from the default, so existing state files are left untouched.

### Quoting repository text

Text the tool did not write — a `CLAUDE.md` section, a doc comment — is rendered
as an attributed quotation, never as the tool's own words. A formatter or
importer that lifts such text must use these rather than its own format:

| Export | Kind | What it is |
|---|---|---|
| `quoteText` | `(text: string) => string` | JSON-escaped, double-quoted, one line. Only the tool's closing quote can end it. |
| `formatQuotedNote` | `({ sourceFile, section?, text }) => string` | `Quoted from CLAUDE.md § "Setup step": "…"`, capped at `MAX_NOTE_CHARS`. |
| `MAX_NOTE_CHARS` | `240` | Cap on one quoted note, attribution included. |
| `QUOTED_LABEL` | `"quoted:"` | Precedes each summary `renderLayer0` / `renderLayer1` quote from a doc comment. |
| `formatQuotedSummary` | `(summary: string) => string` | `quoted: "…"` — a doc-comment summary as the layer renderer and `index --show` / `--file` print it. |
| `ClaudeMdNotes` | `{ build, merge }` | Turns `CLAUDE.md` `##` sections into quoted notes. `merge` swaps an earlier unquoted note for the quoted one. |

### File-load line prefixes

A prompt must carry at least one file-load line, and every component that writes,
validates, or reads one derives its prefixes from a single exported list. Import
them rather than hard-coding the literals:

```ts
import {
  FILE_LOAD_PREFIXES,
  LAYER_SUFFIX_RE,
  LOAD_FULL_PREFIX,
  LOAD_PREFIX,
  SUMMARIES_PREFIX,
} from "@dev-session/core";
```

A private copy of one of these strings is exactly how a prompt once came to be
emitted in a shape its own validator rejected. The values are listed below so you
can recognise them in a prompt — not so you can retype them into a formatter.

| Constant | Value | Emitted by |
|---|---|---|
| `LOAD_PREFIX` | `Load:` | The flat context line, and the `Load: (none)` fallback |
| `LEGACY_LOAD_PREFIX` | `Files to load:` | The legacy `NextPromptWriter.generate()` path; still accepted when validating older prompts |
| `LOAD_FULL_PREFIX` | `Load full:` | The layered section — layer-2 files, escalated by an active task |
| `SUMMARIES_PREFIX` | `Summaries (read_file_layer for detail):` | The layered section — layer 0–1 files |
| `FOCUS_PREFIX` | `Focus (read_unit):` | The layered section — code units the active tasks name, each as `path#id:start-end` |
| `PLAN_PREFIX` | `Plan:` | The active chunk's `.session/PLAN_<id>.md`, when the chunk has a `brief` |

| Constant | Type | What it is |
|---|---|---|
| `FILE_LOAD_PREFIXES` | `readonly string[]` | All six, ordered most-specific-first so a prefix search cannot match a shorter entry by accident. `NextPromptWriter.validate()` accepts a line starting with any of them; `ReplayScorer` parses from the same list. |
| `LAYER_SUFFIX_RE` | `RegExp` | Matches the `·L<n>` marker `formatLayeredContextLines` appends to each summary-line path. Strip it before treating a reference as a path. |

The layered lines are built from these constants by
`formatLayeredContextLines(resolved, ref, maxFiles, focus?)`. It returns a
`Focus (read_unit):` line when units are focused, then a `Load full:` line, a
`Summaries (…):` line, or both. When there is nothing to load it falls back to
`Load: (none)`. Pass `context.focusUnits` as `focus`; a formatter that omits it
still produces valid output, just without the Focus line. A unit reference is
attributed to its file wherever paths are parsed, so cut at `#`.

Three helpers render the rest, and every shipped formatter uses them:

| Export | Signature | What it does |
|---|---|---|
| `formatRefList` | `(refs: readonly string[], maxCount?: number) => string` | Names every ref that fits in `MAX_REF_LINE_CHARS` (1,200), then `, +N more`; `(none)` when empty |
| `formatPlanLine` | `(chunk: PlanChunk, ref: (p) => string) => string \| undefined` | `Plan: <ref>` for the chunk's file, or `undefined` without a brief |
| `formatNewFilesLine` | `(paths: readonly string[] \| undefined) => string \| undefined` | `Not on disk yet: <paths>` (`NEW_FILES_PREFIX`) from `context.newFiles`, as plain paths — never through `ref`, since they do not exist; `undefined` when there are none. Not a file-load prefix, so the validator and `ReplayScorer` ignore it |

`formatLayeredContextLines`'s `maxFiles` is now an optional count cap on top of
the character cap; omit it.

All these constants are exported from `@dev-session/core`, as is
`formatLayeredContextLines`. An out-of-tree formatter should import them: a
hardcoded literal is a second source of truth, and the emitter and the validator
drifting apart is the exact failure this list was introduced to end.

---

## PromptAssembler

Builds `NEXT_PROMPT.md`, its manifest and its budget from a loaded session.

| Method | Signature | Description |
|---|---|---|
| `assemble` | `(input: AssembleInput) => AssembledPrompt` | The prompt, manifest, budget and plan, using the adapter's formatter |
| `charge` | `(input: ChargeInput) => ChargedContext` | The plan and budget alone — no formatter. `assemble` is built on it and `health` judges the budget by it, so they agree |

`PlanChunkManager.loadActive(sessionDir, state)` returns the active chunk with
each task's status merged from `state.tasks` by
`PlanChunkManager.withSessionStatus(chunk, stateTasks)`: tasks match by exact
text, and the higher status wins (`done` > `in-progress` > `todo`). Pure; it
never rewrites `PLAN_<n>.md`.

`PlanChunkManager.startAt(chunks, chunkId?)` returns `{ active, completedIds }`
for a session starting at `chunkId` (the lowest-numbered when omitted), and
throws `CliError` naming the defined ids when `chunkId` is not one.

`PlanChunkManager.nextAfter(chunks, chunkId)` returns the chunk with the lowest
id above `chunkId` — fractional ids and gaps included — or `undefined` from the
highest. `PlanChunkManager.advance(state, nextChunkId)` takes that id; it no
longer adds 1 itself.

---

## SessionVerifier

Reconciles what `SESSION_STATE.md` claims against what git history shows. Where
`HealthChecker` asks whether the session files are internally consistent,
`SessionVerifier` asks whether they are *true*.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `verify` | `(input: VerifyInput, reader: typeof GitReader) => Promise<VerifyReport>` | `Promise<VerifyReport>` | Reconcile session claims against history |

```ts
interface VerifyInput {
  cwd: string;                        // project root
  state: SessionState;
  chunk: PlanChunk;
  entries: readonly FileIndexEntry[];
  lookback?: number;                  // commits treated as evidence (default 20)
}

interface VerifyFinding {
  severity: "error" | "warning" | "info";   // VerifySeverity
  code: string;
  message: string;
}

interface VerifyReport {
  findings: readonly VerifyFinding[];  // most severe first
  errorCount: number;
  warningCount: number;
  infoCount: number;
  checksRun: number;
  gitAvailable: boolean;               // false ⇒ only NOT_A_REPO was reported
}
```

| Code | Severity | Raised when |
|---|---|---|
| `DONE_WITHOUT_EVIDENCE` | error | Tasks are marked done but no commit in the lookback window and no working-tree change supports them |
| `UNBACKED_WORKED_FILE` | warning | `last_worked_files` entries with no commit or working-tree change behind them |
| `UNINDEXED_CHANGE` | warning | Modified files absent from `FILE_INDEX.md` |
| `UNCOMMITTED_SESSION` | info | `.session/` files have uncommitted changes |
| `NOT_A_REPO` | info | `cwd` is not inside a git work tree — every history-backed check was skipped |

```ts
import { GitReader, SessionVerifier } from "@dev-session/core";

const report = await SessionVerifier.verify(
  { cwd: projectRoot, state, chunk, entries },
  GitReader,
);
if (report.errorCount > 0) process.exitCode = 1;
```

The `reader` argument is injected so tests can supply a fake.

---

## ReplayScorer

Scores past bootstrap prompts against the work that followed them. Every commit
that rewrote `.session/NEXT_PROMPT.md` marks a session boundary: the prompt
declares which files the next session should load, and the commits up to the
next boundary show which it really touched. Scoring uses local git history only
— no API key, no model call.

| Method | Signature | Returns | Description |
|---|---|---|---|
| `run` | `(cwd: string, reader: typeof GitReader, limit?: number) => Promise<ReplayReport>` | `Promise<ReplayReport>` | Score up to `limit` boundaries, newest first (default 10) |
| `extractDeclaredFiles` | `(prompt: string) => string[]` | `string[]` | Unique paths a prompt declares, across every line starting with a `FILE_LOAD_PREFIXES` entry. Strips `@`-mentions, backticks, and the `·L<n>` layer suffix, so summary-layer files are counted alongside full-source ones |

```ts
interface ReplayScore {
  sha: string;
  date: string;
  declared: readonly string[];   // files the prompt named
  touched: readonly string[];    // files the following commits changed
  hits: readonly string[];
  missed: readonly string[];     // touched but never declared
  unused: readonly string[];     // declared but never touched
  precision: number | null;      // hits / declared — null when nothing declared
  recall: number | null;         // hits / touched  — null when nothing changed
}

interface ReplayReport {
  scores: readonly ReplayScore[];
  meanPrecision: number | null;
  meanRecall: number | null;
  wasteRatio: number | null;     // total unused / total declared
  boundariesFound: number;
  boundariesScored: number;
  unavailableReason?: string;    // set when boundariesScored is 0
}
```

Paths under `.session/`, `docs/`, and `CHANGELOG.md` are excluded from scoring —
bookkeeping, not the work itself.

Replay reads prompts out of history, so it requires `.session/NEXT_PROMPT.md` to
be **tracked by git**. When it is not, `run` returns a report with
`boundariesScored: 0` and an `unavailableReason` explaining why, rather than a
silent zero.

---

## GitReader

Read-only git access underpinning `SessionVerifier` and `ReplayScorer`. Every
command runs through `execFile` with an argument array — never a shell string —
and revisions are shape-checked before use.

| Method | Signature | Description |
|---|---|---|
| `isRepo` | `(cwd) => Promise<boolean>` | Whether `cwd` is inside a git work tree |
| `dirtyFiles` | `(cwd) => Promise<string[]>` | Repo-relative paths with uncommitted modifications, staged or not |
| `commitsTouching` | `(cwd, filepath, limit?) => Promise<GitCommit[]>` | Commits touching a path, newest first (default limit 100) |
| `fileAtRev` | `(cwd, rev, filepath) => Promise<string \| null>` | File contents at a revision, or `null` if absent |
| `isTracked` | `(cwd, filepath) => Promise<boolean>` | Whether git tracks the path |
| `changedBetween` | `(cwd, from, to) => Promise<string[]>` | Paths changed in `from..to` |

```ts
interface GitCommit {
  sha: string;      // full SHA
  date: string;     // committer date, ISO 8601
  subject: string;
}
```

`fileAtRev` and `changedBetween` throw `CliError` if a revision contains
characters outside `[A-Za-z0-9._/^~@{}-]`.

---

## Plan sources

A plan source turns a plan document into `PlanChunk[]`. Sources are held in a
registry, each scores a document, and the highest scorer parses it — so the tool
is not limited to one markdown dialect.

Two ship built in: `headings` (any heading depth; sections titled `Chunk N`,
`Phase N`, `Step N`, `1.`, or nothing at all) and `task-list` (a checklist with
no headings, which becomes a single chunk).

```ts
import { parsePlan } from "@dev-session/core";

const { source, result, candidates } = parsePlan(planMarkdown);

result.chunks;    // PlanChunk[] — the seam; unchanged by which source parsed
result.excluded;  // sections recognized but not emitted, with line + task count
result.warnings;  // e.g. dependencies on chunk ids this document does not define
```

`parsePlan` throws `ParseError` if the document is empty, or if no source reaches
`PLAN_SOURCE_MIN_CONFIDENCE` — the message names every candidate and its score
rather than silently picking one. `PlanParser.fromMarkdown` remains available and
returns just the chunks.

Inspect `result.excluded` before treating a parse as complete: a section is
skipped when it declares no chunk number, which is right for prose scaffolding
and worth surfacing when the section contains tasks.

To check a plan without ingesting it, `checkPlan` returns the same facts as one
report that never throws for plan content — `ok` is false when the plan yields
no chunks, no source recognizes it, or a skipped section holds tasks. It backs
`dev-sesssion plan check`.

```ts
import { checkPlan } from "@dev-session/core";

const report = checkPlan(planMarkdown);
report.ok;          // false → init would get nothing, or drop tasks
report.source;      // { name, confidence } | null
report.chunks;      // [{ id, title, taskCount, hasBrief, namedPaths }]
```

When there is no plan at all, `noPlanDirection({ placeholder })` is the text
`init` prints: where it looked (`DEFAULT_PLAN_PATHS`) and how to write, check
and pass a plan. `placeholder: true` adds that the session holds a stand-in
chunk. The commands it names are exported as `PLAN_CHECK_COMMAND` and
`INIT_WITH_PLAN_COMMAND`, and the heading shape as `CHUNK_HEADING_SHAPE`, so
other agent-facing text names the same ones.

### Registering your own

```ts
import { registerPlanSource, type PlanSource } from "@dev-session/core";

const linearSource: PlanSource = {
  name: "linear",                       // lowercase kebab-case, must be unique
  displayName: "Linear export",
  detect: (content) => ({
    confidence: content.startsWith("{") ? 0.9 : 0,
    reason: "JSON payload",
  }),
  parse: (content) => ({ chunks: toChunks(content), excluded: [], warnings: [] }),
};

registerPlanSource(linearSource);
```

Registration is in-process only and throws `CliError` on a duplicate or
malformed name. `detectPlanSource`, `getRegisteredPlanSources`, and
`unregisterPlanSource` round out the surface.

---

## Error types

All errors thrown by `@dev-session/core` are typed. Import them from the same package:

| Class | When thrown |
|---|---|
| `CliError` | Recoverable user-facing errors (missing files, bad configuration) |
| `ParseError` | Malformed YAML frontmatter or schema validation failure |
| `SecurityError` | Path traversal, secret detected in output, or JS frontmatter engine invoked |

```ts
import { CliError, ParseError, SecurityError } from "@dev-session/core";

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
import { PathValidator } from "@dev-session/security";

// Throws SecurityError if path escapes the project root
const safe = PathValidator.safeResolvePath(userProvidedPath, projectRoot);
```

`PathValidator` is exported by `@dev-session/security`, not by `@dev-session/core`
— core re-exports only the error classes.

See `packages/security` for the full security API (`AtomicWriter`, `SecretScanner`, `WriteGuard`, `FrontmatterParser`).
