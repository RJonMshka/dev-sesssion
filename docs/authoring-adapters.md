# Authoring an adapter

An **adapter** teaches `dev-sesssion` how to integrate with a specific AI coding
tool: how to detect it, how to format the resume prompt for it, and how to wire
the session into the tool's native config files.

This guide is for adding a *new* adapter. For using the adapters that already
ship (Claude Code, opencode, Cursor, Windsurf), see [adapters.md](adapters.md).

> **Two ways to ship an adapter.**
>
> 1. **Built-in** — add it to the registry in
>    `packages/adapters/src/registry.ts` via a pull request. This is the path
>    for adapters that should auto-detect and ship with the CLI.
> 2. **Custom, in-process** — call `registerAdapter(myAdapter)` from
>    `@dev-session/adapters` before invoking the CLI programmatically. The
>    adapter then resolves by name everywhere, including the `--adapter` flag.
>    Registration lives for the current process only; a published
>    `dev-sesssion-adapter-*` discovery mechanism is still on the roadmap.

---

## What an adapter is

An adapter is a plain object implementing the `Adapter` interface from
`@dev-session/core`. It bundles three things:

1. **`config`** — static metadata: name, detection files, output files.
2. **`formatter`** — a `BootstrapFormatter` that renders `NEXT_PROMPT.md` in the
   tool's preferred style.
3. **Lifecycle hooks** (all optional) — `setup`, `transformState`,
   `onSessionStart`, `onSessionEnd`.

A minimal adapter only needs `config` and `formatter`.

```typescript
import type { Adapter } from "@dev-session/core";

export const MyToolAdapter: Adapter = {
  config: {
    name: "mytool",
    display_name: "My Tool",
    detect_files: [".mytoolrc", ".mytool"],
    output_files: [".mytoolrc"],
    config_version: 1,
  },
  formatter: MyToolBootstrapFormatter,
};
```

---

## Step 1 — Register the tool

Detection and the adapter map key off a `DetectedTool` value.

1. Add your tool to the `DetectedTool` enum **and** the Zod schema in
   `packages/core/src/schemas/project-info.ts`.
2. Teach `ProjectDetector` (`packages/core/src/detectors/project-detector.ts`)
   to recognize your `detect_files` markers.

Detection should look only for cheap, unambiguous markers in the project root
(a dotfile or a directory), never read file contents.

---

## Step 2 — Write the formatter

Implement `BootstrapFormatter` (from `@dev-session/core`). The contract:

| Member | Responsibility |
|---|---|
| `name` | Short id, e.g. `"mytool"`. |
| `formatFilesToLoad(files)` | Render file references in the tool's syntax (plain path, `@mention`, etc.). |
| `formatExcludes(patterns)` | Render the "don't load these" instruction. |
| `generatePrompt(context)` | Produce the full `NEXT_PROMPT.md` string. |
| `formatAiIndex(index, layer)` | Render the ai-index at layer 0/1/2 (may return `""`). |

If your tool reads a plain rules file (like Cursor's `.cursorrules` or Windsurf's
`.windsurfrules`), the simplest path is to mirror `CursorBootstrapFormatter`:
plain file paths and an `Ignore` directive. Tools with richer context loading
(e.g. Claude Code's `@file` mentions) get their own formatting.

`generatePrompt` receives a `BootstrapContext` with the session state, active
chunk, chunk + always-include files, the context budget, exclude patterns, and
(when available) `resolvedLayers` for layered loading. Honour `resolvedLayers`
when present: emit full-source references for layer-2 files and summary
references for layers 0–1; fall back to a flat load list when it is absent.

Keep the output **within `context.maxPromptLines` (default 20) and
self-contained** — that is a protocol requirement (see PROTOCOL.md), not a style
preference.

### The write-time contract

`NextPromptWriter.write()` validates content **before** it persists it, so a
formatter cannot put malformed output on disk. This applies to adapters
registered through `registerAdapter()` exactly as it does to the built-ins —
a third-party formatter is not trusted. `write()` throws `CliError` when the
prompt:

- is empty;
- exceeds the line cap (non-empty lines only — a trailing newline is not counted); or
- is missing `Project:`, `Active chunk:`, or a file-load line.

So `generatePrompt` must emit, at minimum:

```
Project: <name>
Active chunk: <id> — <title>
Load: <references>
```

#### Your file-load line must carry a known prefix

`validate()` recognises a file-load line by its prefix, and the accepted set is a
single list, `FILE_LOAD_PREFIXES`. **Import the constant — never retype the
string:**

```typescript
import { LOAD_PREFIX } from "@dev-session/core";

lines.push(`${LOAD_PREFIX} ${this.formatFilesToLoad(allFiles)}`);
```

| Constant | Use it for |
|---|---|
| `LOAD_PREFIX` | Your flat load line — the right default |
| `LEGACY_LOAD_PREFIX` | Legacy only; don't emit it in a new formatter |
| `LOAD_FULL_PREFIX` | Layer-2 (full source) files, when honouring `resolvedLayers` |
| `SUMMARIES_PREFIX` | Layer 0–1 files, when honouring `resolvedLayers` |

(`FILE_LOAD_PREFIXES` holds all four, and `LAYER_SUFFIX_RE` matches the `·L<n>`
marker the summary line appends. The literal values are in
[API.md](API.md#file-load-line-prefixes) if you need to recognise one by eye.)

Why import rather than hardcode: a literal in your formatter is a second source
of truth for a string the validator also owns. That is not hypothetical — a
formatter and a validator each carrying their own copy is precisely how this
project once shipped prompts that its own `write()` refused, and that replay
scoring could not parse. Import the constant and a future change to the wording
reaches your adapter for free.

Invent your own wording — `Context:`, `Files:`, `Read these:` — and `write()` will
reject the prompt as malformed even though it looks fine. If you emit the layered
section, build both lines with `formatLayeredContextLines`, which derives them
from these constants and appends the `·L<n>` layer marker (`LAYER_SUFFIX_RE`) that
`ReplayScorer` knows to strip:

```typescript
import { formatLayeredContextLines } from "@dev-session/core";

for (const line of formatLayeredContextLines(resolvedLayers, (f) => `@${f}`, MAX_FILES)) {
  lines.push(line);
}
```

Hand-rolling those lines instead is how the emitter and the validator drift apart:
a formatter that wrote its own `Load full:` line once produced prompts that
`write()` refused and that replay scoring could not parse.

All six prefix constants, `LAYER_SUFFIX_RE`, and `formatLayeredContextLines` are
exported from `@dev-session/core`, so an out-of-tree adapter has everything it
needs without copying a string.

Honour the cap by trimming through the shared helper rather than slicing
yourself — it is what leaves the truncation marker:

```typescript
import { DEFAULT_MAX_PROMPT_LINES, trimToMaxLines } from "@dev-session/core";

const trimmed = trimToMaxLines(lines, context.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES);
return `${trimmed.join("\n")}\n`;
```

When lines are dropped, `trimToMaxLines` spends the last slot on
`[N more lines trimmed — see .session/SESSION_STATE.md]` so the next session is
told its bootstrap is incomplete instead of reading one that merely looks whole.
Order your sections so the least critical lines (notes, excludes) come last —
those are what a trim removes first.

---

## Step 3 — Implement lifecycle hooks (optional)

Hooks run in this order:

1. `setup(ctx)` — during `dev-sesssion init`, once per project. Create or update
   the tool's config file (e.g. add a managed `dev-sesssion` section to
   `.mytoolrc`). Return `{ filesWritten, summary }`.
2. `onSessionStart(ctx)` — read tool context at session start.
3. `transformState(state, ctx)` — **pure, synchronous** transform of session
   state before the prompt is rendered. No side effects, no file writes.
4. `onSessionEnd(ctx)` — write tool updates at session end.

### Use the injected IO — never touch the filesystem directly

Hooks receive `writeFile` and `readFile` from the context. These are backed by
`AtomicWriter` + `PathValidator` + the secret-scanning `WriteGuard` in the CLI
layer. **Always** use them:

```typescript
async setup(ctx) {
  const existing = ctx.readFile(".mytoolrc") ?? "";
  const next = upsertManagedSection(existing); // your logic
  ctx.writeFile(".mytoolrc", next);            // atomic + scanned
  return { filesWritten: [".mytoolrc"], summary: "Added dev-sesssion section to .mytoolrc" };
}
```

Adapters depend on `core` only — they must not import `cli` or `security`. The
IO functions are how `core`-only adapters stay safe without a `security`
dependency.

Use a stable, idempotent section marker (e.g. `# dev-sesssion:start` …
`# dev-sesssion:end`) so re-running `init` updates in place rather than appending
duplicates.

---

## Step 4 — Register the adapter

**Built-in adapter:** in `packages/adapters/src/registry.ts`, add your adapter
to `BUILTIN_ADAPTERS`:

```typescript
[DetectedTool.MYTOOL]: MyToolAdapter,
```

Export it from `packages/adapters/src/index.ts` and update the CLI help text.
The `--adapter mytool` override works automatically — valid flag values are
derived from the registry, so there is no second list to maintain.

**Custom adapter (no fork needed):** register it at runtime instead:

```typescript
import { registerAdapter } from "@dev-session/adapters";

registerAdapter(MyToolAdapter); // name must be lowercase kebab-case and unique
```

---

## Step 5 — Test it

Follow the existing adapter test suites:

- **Detector**: `ProjectDetector` finds the tool from its markers.
- **Formatter**: `generatePrompt` output (strip ANSI; never snapshot color).
- **Adapter lifecycle**: `setup` writes the expected section; re-running is
  idempotent; dry-run writes nothing.
- **Registry**: `getAdapterForTool` / `getFormatterForTool` resolve your tool;
  `getRegisteredTools` includes it.
- **E2e**: `init --adapter mytool` writes the config file and the override beats
  auto-detection. (Note: `CliError` renders to **stdout** via `@clack/prompts`.)

`packages/adapters/src/windsurf-adapter.ts` and its tests are the smallest
complete example to copy.

---

## Checklist

- [ ] `DetectedTool` enum + Zod schema updated
- [ ] `ProjectDetector` recognizes the markers
- [ ] `BootstrapFormatter` implemented (honours `resolvedLayers`)
- [ ] `generatePrompt` emits `Project:`, `Active chunk:`, and a `Load:` line, and trims via `trimToMaxLines(lines, context.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES)`
- [ ] Output round-trips through `NextPromptWriter.write()` without throwing
- [ ] Adapter object with `config` (+ hooks as needed)
- [ ] Hooks use injected `readFile`/`writeFile` only; idempotent section markers
- [ ] Registered (built-in: `BUILTIN_ADAPTERS` + export; custom: `registerAdapter()`)
- [ ] Detector / formatter / adapter / registry / e2e tests pass
