# LLD — code units

**Area:** `UNIT` — extracting functions, methods, and other declarations as
addressable units; loading them into context individually; recording what was
loaded as session state; and checking that record later.

---

## Problem

The context ladder has three rungs, and the step from the second to the third is
the whole file.

**1. Escalation is file-sized.** `LayerResolver.resolve`
(`layer-resolver.ts:214`) escalates a file to layer 2 when an active task names
its path or basename (`taskReferencesFile`, `layer-resolver.ts:93`). A task that
says *"make `parseBody` list every issue"* names a function, not a file, so it
escalates nothing. A task that says *"fix `parseBody` in validate.ts"* escalates
all of `validate.ts`. Nothing between "signatures" and "everything" exists.

**2. The index cannot address anything smaller than an export.**
`AutoExtractor.extractExports` (`auto-extractor.ts:170`) walks top-level
`export` statements only and records `{ signature, summary, line, surface, tags }`
(`types.ts:58`). It records a start line but no end line, no size, and no
content hash. Non-exported functions and class/object methods are not recorded
at all. You cannot load a function you cannot locate.

**3. Nothing records what went into context.** `NextPromptWriter.write` persists
the prompt and the budget is printed (`final-writes.ts:241`) and discarded.
`CONTEXT_LOG.md` stores `files_loaded` and one `total_tokens` integer
(`context-log.ts:27-31`). Nothing records which items a prompt named, at what
granularity, at what cost, or why. So a prompt cannot be traced back to the plan
text that caused each reference. A reference cannot be checked against the
source it pointed at once that source changes.

### Measured

The extractor's own parser, run over this repository's `packages/*/src`
(tests and `.d.ts` excluded), on 2026-10-18:

| | |
|---|---|
| Files | 107 · 173,007 tokens · median 1,468 / p90 3,173 per file |
| Exported symbols (indexed today) | 336 |
| Top-level declarations, exported or not | 720 |
| Methods of top-level classes and object literals | 147 |
| **Units** | **867** — about 8 per file |
| Unit size | median 82 tokens · p90 346 · max 2,183 |
| Unit as a share of its file | median **3.5%** · p90 23.7% |
| Share of file bytes inside a top-level unit | 65.8% (rest is imports, module docs, blank lines) |

Loading the one unit a task names instead of its file costs ~28× less at the
median and ~4× less at p90. The small fixtures (`tests/fixtures/*`, 30 files)
show the floor: median unit 19% of its file, so ~5×.

---

## Granularity — what is stored, what is loaded

Storage and context are different budgets and get different granularities.

| Rung | Granularity | Stored in | Loaded how | Typical cost |
|---|---|---|---|---|
| 0 | Module summary + export names | `ai-index.yaml` (exists) | `Summaries … ·L0` | ~20–60 tok/file |
| 1 | Public signatures | `ai-index.yaml` (exists) | `Summaries … ·L1` | ~100–300 tok/file |
| **U** | **One unit's source** | **`ai-index.yaml` `units` (new)** | **`Focus (read_unit):` line** | **median 82 tok** |
| 2 | Whole file | the file | `Load full:` | median 1,468 tok |

**Stored: every unit.** Every top-level declaration plus every top-level
class or object-literal method, exported or not. That is about 8 per file. Each
unit stores structure only: kind, line range, tokens, hash, and whether it is
exported. Signatures and summaries stay exports-only. A unit row is about 120
bytes, so this repo's 867 units add roughly 100 KB to `ai-index.yaml`. No index
is ever loaded whole, so storage is not the constraint. Locating a unit later
is, which is why every unit is stored and not just the exported ones.

**Not stored: anything below a method.** Statements and blocks have no stable
name, so a prompt could not cite them and a later session could not find them
again. A unit you cannot name is not addressable.

**Loaded: at most 5 units per prompt.** They go on one line, which costs one of
the 20 prompt lines (`MAX_FILES_TO_SHOW`, `next-prompt-writer.ts:32`). The
prompt carries references, never source. The agent pulls source with
`read_unit`, or with a plain ranged read when no MCP server is connected. That
is why each reference carries its line range.

---

## Requirements

### Extraction

**REQ-UNIT-1** — When the extractor indexes a supported source file, it shall
record one unit per top-level declaration, exported or not, and one per method
of a top-level class or object literal.

**REQ-UNIT-2** — The extractor shall give each unit a line range beginning at its
attached leading JSDoc block when one exists, otherwise at the declaration, and
ending at the declaration's last line.

**REQ-UNIT-3** — The extractor shall give each unit a content hash computed from
exactly the source lines of its range, as specified in `PROTOCOL.md`.

**REQ-UNIT-4** — The extractor shall give each unit an id unique within its file:
the declared name for a top-level unit, `Parent.member` for a member, and `~n`
appended to the second and later declarations of the same id.

**REQ-UNIT-5** — When an ai-index carrying units is serialized and read back, the
ai-index reader shall return the same units.

**REQ-UNIT-6** — Where an ai-index file entry carries no units, the ai-index
reader shall load it without error.

### Focus

**REQ-UNIT-7** — When an active task names a unit by a code-shaped identifier,
the unit focus resolver shall focus that unit. An identifier is code-shaped
when it has an uppercase letter after its first character, or contains `_`,
`$`, or a digit.

**REQ-UNIT-8** — When an active task names a unit by a word that is not
code-shaped, the unit focus resolver shall focus it only if the word appears in
backticks.

~~**REQ-UNIT-9**~~ withdrawn — superseded by REQ-UNIT-30..33. Refusing every
name declared twice turned out to give up on real, resolvable cases.
`trimToMaxLines` in core has a shared export and a private copy, and both are
in use. A name declared in several places is now resolved by proof of use.
The siblings rule moves to REQ-UNIT-30: overloads and merged declarations
(`pick`, `pick~2`) count as one declaration and are focused together.

**REQ-UNIT-10** — When a task names `Parent.member`, the unit focus resolver
shall focus the member and not the parent.

**REQ-UNIT-11** — While a task is done, the unit focus resolver shall focus
nothing on its account.

**REQ-UNIT-12** — When a task focuses a unit in a file, the layer resolver shall
not escalate that file to full source on account of the same task.

### Prompt

**REQ-UNIT-13** — Where units are focused, every built-in formatter shall emit
one Focus line listing each unit as `path#id:start-end`.

**REQ-UNIT-14** — When the replay scorer reads a Focus line, it shall attribute
each reference to its file path.

**REQ-UNIT-15** — The prompt validator shall accept a Focus line as a file-load
line.

### State — the context manifest

**REQ-UNIT-16** — When `init`, `update` or `advance` writes `NEXT_PROMPT.md`,
the CLI shall write `.session/context-manifest.json` with one entry per item
the prompt references.

**REQ-UNIT-17** — The context manifest shall record, per entry, its granularity,
its token cost, the token cost of its whole file, a content hash, and the reason
it was included.

**REQ-UNIT-18** — The context manifest shall record the hash of the prompt it
describes.

**REQ-UNIT-19** — While dry-run is active, the CLI shall not write the context
manifest.

### Verification

**REQ-UNIT-20** — When `verify` runs and a manifest unit's current source differs
from its recorded hash, the verifier shall report `STALE_CONTEXT`.

**REQ-UNIT-21** — When a manifest unit's source is unchanged but its line range
has moved, the verifier shall report `MOVED_CONTEXT`.

**REQ-UNIT-22** — If a manifest unit no longer exists in its file, then the
verifier shall report `STALE_CONTEXT` naming it as removed.

### On-demand loading

**REQ-UNIT-23** — When `read_unit` is given `path#id`, the session manager shall
return that unit's source as the file stands now, not as the index recorded it.

**REQ-UNIT-24** — If the id names no unit in the file, then `read_unit` shall
fail with an error listing the file's unit ids.

**REQ-UNIT-25** — If the path resolves outside the project root, then
`read_unit` shall refuse it.

### Eval

**REQ-UNIT-26** — The units eval shall check, for every unit in a generated
index, that the hash recomputed from the stored range equals the stored hash.

**REQ-UNIT-27** — The units eval shall check that every Focus reference in a
generated prompt names a unit in the index with the same line range.

**REQ-UNIT-28** — The units eval shall report, per scenario, the manifest's total
tokens against the whole-file equivalent.

**REQ-UNIT-29** — If any units-eval check fails, then the units eval shall exit
non-zero.

### Disambiguation by proof of use

Added after review: *"we should not be wrong, instead more accurate."* When a
name is declared in several places, the resolver no longer refuses outright.
It keeps each declaration it can prove the code uses.

**REQ-UNIT-30** — If a name in a task matches more than one declaration, then
the unit focus resolver shall focus every matching declaration that has usage
evidence, and none that lacks it. Siblings that share an id apart from a `~n`
suffix count as one declaration.

**REQ-UNIT-31** — The extractor shall count a reference as usage evidence only
when it certainly binds to the declaration. That means one of:

- an import or re-export in another file, whose relative specifier resolves to
  the declaration's file;
- an access of a member through such an import;
- a reference in the declaration's own file that no inner binding of the same
  name could capture.

**REQ-UNIT-32** — If no matching declaration has usage evidence, or more than
three do, then the unit focus resolver shall focus none of them and shall
report the name as ambiguous.

**REQ-UNIT-33** — When the unit focus resolver chooses among several
declarations, the context manifest shall record the usage evidence for each
unit it focused.

**REQ-UNIT-34** — The extractor shall mark a declaration exported when its file
exports it through a local `export { name }` specifier.

The units eval runs against the workspace build packed as a tarball:
**REQ-EVAL-9**, in [LLD-eval-harness.md](LLD-eval-harness.md).

---

## Design

### Unit model — `annotation/types.ts`

```ts
type UnitKind = "function" | "class" | "method" | "variable" | "type" | "interface" | "enum";

interface ParsedUnit {          // in-memory, from the extractor
  readonly id: string;          // "parseBody", "SessionManager.refresh", "default"
  readonly kind: UnitKind;
  readonly start: number;       // 1-based, inclusive, JSDoc included
  readonly end: number;         // 1-based, inclusive
  readonly tokens: number;
  readonly hash: string;        // 16 hex chars
  readonly exported: boolean;
}

interface UnitEntry {           // serialized, keyed by id under FileEntry.units
  readonly kind; readonly start; readonly end;
  readonly tokens; readonly hash; readonly exported;
}
```

`ParsedFile` gains `units` and `hash`. `FileEntry` gains optional `units` and
`hash`. They are optional so a v2 index written before this feature still loads
(REQ-UNIT-6). The version stays `"2"`, because the change is additive.

**Hash contract.** Split the file on `\n`, take lines `start..end` inclusive,
join with `\n`, SHA-256, first 16 hex characters. A `\r` stays part of its
line. This is written into `PROTOCOL.md` because the eval and any third-party
tool must recompute it independently (REQ-UNIT-26). Token cost is
`TokenCounter.heuristicCount` of the same text.

### Extraction — new `annotation/unit-extractor.ts`

`extractUnits(ast, source): ParsedUnit[]` is a pure function over the AST that
`AutoExtractor.extractFile` already parses, so there is no second parse. It
walks `ast.body`, unwraps `Export*Declaration`, `TSAsExpression` and
`TSSatisfiesExpression`, and reads the start of the JSDoc range with the same
whitespace-gap rule as `findLeadingJsdoc` (`auto-extractor.ts:290`). That rule
moves into the new module and both callers share it. `export { a, b }`
specifiers produce no units, since the declaration they re-export already
produced one. Overloads (`TSDeclareFunction`) become `~n` siblings, which keeps
REQ-UNIT-4's uniqueness without guessing which overload is the target.

### Focus — new `calculators/unit-focus.ts`

```ts
interface FocusedUnit {
  readonly filepath: string; readonly id: string; readonly ref: string; // "path#id"
  readonly start: number; readonly end: number;
  readonly tokens: number; readonly fileTokens: number; readonly hash: string;
  readonly task: string;        // the task text that caused it
}

UnitFocusResolver.resolve({ tasks, index }): { focused: FocusedUnit[]; ambiguous: string[] }
```

1. Collect candidate names from each non-done task (REQ-UNIT-11). These are
   backticked spans, plus code-shaped identifiers matched on word boundaries
   (REQ-UNIT-7, -8). A qualified `A.b` is taken as one candidate, and `A` is
   not counted separately for that mention (REQ-UNIT-10).
2. Look each candidate up against a name table built once from the index. Every
   unit is keyed by its full id and by its leaf name. The search covers the
   whole index, not only chunk-tagged files. Tagging is the weakest link in the
   chain (HLD feature 3), and a unique code-shaped name is stronger evidence
   than a tag.
3. More than one hit is resolved by proof of use (REQ-UNIT-30..32). Each
   declaration's evidence is computed from facts in the index, described under
   *Usage facts* below. Only declarations with evidence survive. If none
   survive, or more than `MAX_LIVE_MATCHES = 3` do, the name is dropped and
   reported. *Wrong is worse than absent*, and an unprovable guess counts as
   wrong.
4. Order by first mention, dedupe by ref, and cap at `MAX_FOCUS_UNITS = 5`.

`LayerResolverInput` gains optional `focus?: readonly FocusedUnit[]`.
`findEscalatingTask` skips a task that focuses any unit in the file being
resolved (REQ-UNIT-12). Without `focus`, nothing changes.

### Usage facts — new `annotation/usage-extractor.ts`

Usage evidence is computed when a query runs, from facts recorded per file. It
is never stored as cross-file totals. `index --update` re-extracts only the
files that changed, so a count of other files' importers would go stale on
every file that didn't. The per-file facts are:

| Fact | Where | What |
|---|---|---|
| `refs` | per unit | References in the unit's own file that certainly bind to it. For a top-level unit, that means an identifier reference to its name, unless any inner scope declares the same name, in which case the count is 0 because shadowing makes it uncertain. For a member, `Parent.member` anywhere in the file, or `this.member` inside the parent's own methods |
| `imports` | per file | `{ from, name, local }` for named imports and re-exports whose relative specifier resolves to an existing file (`.js`→`.ts`, `.mjs`→`.mts`, `/index`). Namespace imports are recorded with `name: "*"`. Package and alias specifiers such as `@dev-session/core` are not recorded, because they cannot be resolved to a file without a package map, and an unresolved import proves nothing |
| `member_refs` | per file | `local.prop` for every member access whose object is an imported binding, so `Parent.member` used across files can be proven |

A declaration has evidence when its `refs` is above 0, or when another file's
`imports` names it from its file. For a member, the other file must import the
parent and also access `local.member`. A namespace import counts only together
with a matching `ns.name` access.

`FocusedUnit` gains an optional `evidence` string, such as `imported by 2
files` or `referenced 1× in its file`. It is set only when several declarations
were in play, and the manifest records it (REQ-UNIT-33).

### Prompt — `formatter-utils.ts`

`FOCUS_PREFIX = "Focus (read_unit):"` joins `FILE_LOAD_PREFIXES` (REQ-UNIT-15).
`formatLayeredContextLines` takes optional `focus` and emits the Focus line
first, as `path#id:start-end`. It does not use the formatter's `ref` callback,
because an `@path#id` mention is not a valid Claude Code reference.
`BootstrapContext` gains optional `focusUnits`, and the five formatters pass it
through: four in `packages/adapters`, plus `plain-text-formatter.ts`
(REQ-UNIT-13). `normalizeRef` in the replay scorer cuts at `#`
(REQ-UNIT-14).

### Manifest — new `schemas/context-manifest.ts`, `managers/context-manifest.ts`

```ts
ContextManifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  active_chunk: z.number(),
  prompt_hash: z.string(),                     // REQ-UNIT-18
  entries: z.array(z.object({
    ref: z.string(),                           // "path" or "path#id"
    path: z.string(),
    granularity: z.enum(["summary", "signature", "unit", "file"]),
    tokens: z.number().int().nonnegative(),
    file_tokens: z.number().int().nonnegative(),
    hash: z.string(),                          // unit hash, or file hash
    start: z.number().int().positive().optional(),
    end: z.number().int().positive().optional(),
    reason: z.enum(["always-include", "chunk", "task"]),
    task: z.string().optional(),
    listed: z.boolean(),                       // named, or only counted in "+N more"
  }).strict()),
  totals: z.object({ tokens: z.number(), file_tokens: z.number() }).strict(),
}).strict();
```

`ContextManifest.build({ plan, index, prompt, activeChunk })` is pure.
`plan` is a `ContextPlan`, the output of `LayerResolver.plan`, which resolves
focus and file layers together. That way focus and escalation are always
decided together. Without an ai-index, every entry is recorded at `file`
granularity, because that is what the flat `Load:` line actually loads. `ContextManifest.write(sessionDir, manifest)` goes through `AtomicWriter`.
The output is JSON with sorted keys, since core has no YAML library and the
existing YAML writer is purpose-built for the ai-index.

The CLI calls build and write next to `NextPromptWriter.write` at the three
write sites (`final-writes.ts`, `update.ts`, `advance.ts`), inside the existing
dry-run branches (REQ-UNIT-19). Those three sites already duplicate the
resolve → budget → generate sequence, and this design does not fold them
together; see Out of scope. `context-manifest.json` joins the gitignore
entries, next to `NEXT_PROMPT.md`.

`task` text is plan content, so it counts as untrusted under the provenance
rule. It is stored in the manifest as a data field and never emitted into the
prompt. That keeps it on the right side of the PROV boundary.

### Verification — `verifiers/context-manifest-checker.ts`

`ContextManifestChecker.check(manifest, projectRoot): VerifyFinding[]`
re-extracts each referenced file, compares hashes, and classifies each unit
entry:

- the hash differs → `STALE_CONTEXT`, warning (REQ-UNIT-20)
- the hash matches but the range moved → `MOVED_CONTEXT`, info (REQ-UNIT-21)
- the id is gone → `STALE_CONTEXT`, removed (REQ-UNIT-22)

File-granularity entries compare file hashes.

`VerifyInput` gains optional `manifest`. These checks need no git, so they run
before the not-a-repo early return, and their findings are merged into that
report.

### On-demand — `SessionManager.readUnit(ref)` and MCP `read_unit`

The path part goes through `PathValidator.safeResolvePath` (REQ-UNIT-25). The
file is extracted live (REQ-UNIT-23) and the source is sliced to the unit's
range. The output starts with a one-line header,
`// path#id L12-48 · 210 tokens · hash …`, so whatever the agent quotes later
can be traced to its source. An unknown id raises `CliError`, listing up to 20
of the file's ids (REQ-UNIT-24).

### Eval — `evals/units.ts`, `pnpm eval:units`

The eval drives the packed workspace build as a black box (REQ-EVAL-9). It runs
two targets.

| Target | Source | Why |
|---|---|---|
| `simple-node-app` | `tests/fixtures/simple-node-app` | Small files: the reduction floor |
| `core-src` | a copy of `packages/core/src` into a temp dir | Real, messy, ~60 files: fidelity at scale |

Each target runs `init --yes`, `index`, writes a plan whose tasks name units,
runs `update --yes`, and reads `ai-index.yaml`, `NEXT_PROMPT.md` and
`context-manifest.json`. Copying `core/src` into a temp dir does not run the
tool against this repository: the copy has no `.session/` of ours and never
writes back.

| Check | Gate | Requirement |
|---|---|---|
| Hash fidelity over every unit in the index | fail on any mismatch | REQ-UNIT-26 |
| Focus refs ground to index units with equal ranges | fail on any miss | REQ-UNIT-27 |
| Expected focus per scenario, incl. ambiguous and lowercase-unbackticked negatives | fail on mismatch | REQ-UNIT-7..10 at black-box level |
| Edit a focused unit → `verify --json` reports `STALE_CONTEXT`; prepend a line → `MOVED_CONTEXT` | fail if absent | REQ-UNIT-20, -21 |
| Manifest tokens vs whole-file equivalent | reported, not gated | REQ-UNIT-28 |

The scenario tasks are inputs. The expected focus sets name units that exist in
the real source, and the comparison runs against what the CLI actually
generated.

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-UNIT-1 | unit | Fixture source with exported/non-exported fns, class + methods, `as const` object methods → expected ids |
| REQ-UNIT-2 | unit | JSDoc-led unit starts at `/**`; a unit with a non-adjacent comment starts at the declaration |
| REQ-UNIT-3 | unit | Hash equals an independent recomputation from the range |
| REQ-UNIT-4 | unit | Overloads and a duplicate name produce `~2` |
| REQ-UNIT-1..4 | integration | Run over this repo's real `packages/core/src` — every unit's slice contains its leaf name and re-hashes equal |
| REQ-UNIT-5, -6 | unit | Serialize → deserialize round trip; a pre-feature YAML entry loads |
| REQ-UNIT-7..11 | unit | Resolver against a built index: code-shaped, backticked, plain lowercase, ambiguous, qualified, done task |
| REQ-UNIT-12 | unit | Task naming file + unit → file stays at base layer; naming only file → escalates (unchanged) |
| REQ-UNIT-13 | unit | Every registered adapter's formatter emits the Focus line (asserted against generator output) |
| REQ-UNIT-14 | unit | `extractDeclaredFiles` on a generated prompt with a Focus line yields the paths |
| REQ-UNIT-15 | unit | `validate` accepts a generated prompt whose only load line is Focus |
| REQ-UNIT-16..18 | unit + e2e | `build` fields; `update` in a temp project writes a manifest whose `prompt_hash` matches the prompt |
| REQ-UNIT-19 | e2e | `update --dry-run` leaves no manifest |
| REQ-UNIT-20..22 | unit | Checker over a temp project: edit, shift, delete |
| REQ-UNIT-23..25 | unit | `readUnit` after an edit returns current text; unknown id lists ids; `../` refused |
| REQ-UNIT-26..29 | eval | `pnpm eval:units` |

---

## Out of scope

- **Below-method granularity.** Statements and blocks have no stable name.
- **Call graph and import edges.** "Load `parseBody` and its callers" would be
  the next rung, as neighbourhood expansion. It needs a resolver across modules
  that core cannot get without a type checker. Not attempted.
- **Unit-level replay scoring.** Scoring a prompt's Focus refs against the units
  that the next commits actually touched would turn this into a correctness
  measure. That needs diff hunks from `GitReader`, which today returns only
  file names. This is the next LLD in this area.
- **Non-TS/JS languages.** The extractor's language set is unchanged.
- **The `symbols` command** (HLD feature 2). It will read the same `units`.
- **Usage through package or alias specifiers** (`@dev-session/core`). These
  need a package map to resolve to a file. Without one they are not counted as
  evidence, so a declaration used only that way looks unused, and the resolver
  refuses rather than guesses.
- **Calls through values** (`const f = helper; f()`, `new Store().refresh()`).
  These are not proof of a named binding, so they are not counted.
- **Folding the three prompt-write sites into one core entry point.** The
  duplication is real and pre-dates this work. The manifest adds one call at
  each site rather than widening the change.
- **Logging what the agent pulled through `read_unit`.** The manifest records
  what the prompt offered. What the agent actually read is a separate
  question, and the MCP server is stateless.
- **History.** The manifest is overwritten with each prompt, like
  `NEXT_PROMPT.md`. Appending entries to `CONTEXT_LOG.md` is a follow-up.

---

## What actually happened

Built 2026-10-18 on `feat/code-units`. Every requirement has a test that names
it. Each was watched failing first, except where noted below.

**Additions during the build.**

- **`listed` on manifest entries.** The prompt caps each line at six refs. An
  item behind a `+N more` is loaded in principle but never named, and the
  manifest has to tell those apart to be traceable.
- **Focused units are charged to the budget.** `estimateLayered` gained an
  optional `focus` parameter. Each unit is charged at its own cost, under its
  `path#id` key. Without this, the budget line undercounted what the prompt
  points at.
- **`LayerResolver.plan`** is the one entry point the four prompt-writing
  commands now call (`init`, `update`, `advance`, `preview`). Focus logic stays
  out of `cli`.
- **REQ-UNIT-9 was reworded before its test was written.** Overloads
  (`pick`, `pick~2`) are one declaration, and calling them ambiguous would make
  every overloaded function unfocusable.

**What the tests caught in the tests.** The manifest test first expected an
indexed chunk file at `summary`. The real pipeline says `signature`, because
`AiIndexBuilder` defaults every file to `layer_default: 1`. The test was wrong.
That is the case for asserting against real output, made again.

**What the eval caught on its first run.** Scenario `core-src/qualified-member`
expected `trimToMaxLines` to be focused. The CLI focused nothing for it.
`trimToMaxLines` is declared twice in core: exported at
`formatter-utils.ts:182`, and as a private copy at `next-prompt-writer.ts:124`.
REQ-UNIT-9 held, and the scenario expectation was corrected.

That raised a question: which declaration should win? It was settled in
review: *be more accurate, not wrong*. The answer is not "prefer the export".
It is "keep every declaration the code provably uses". REQ-UNIT-9 was
withdrawn, and REQ-UNIT-30..34 replace it (see *Disambiguation by proof of
use*). On real core, `trimToMaxLines` now resolves to both copies:

- the shared one, imported by 3 files (counting the barrel's re-export);
- the private one, called once in `next-prompt-writer.ts`.

Each copy carries its evidence into the manifest.

Building the usage pass surfaced a bug in REQ-UNIT-1's own test: a function
exported through `export { helper }` was recorded as not exported. REQ-UNIT-34
fixes that, and the old assertion was corrected. It also surfaced a duplicate
of my own: `unwrap` had been copied into the new module. It is now one shared
helper. Three rules were added so evidence errs toward absent:

- An `export { x }` does not count as a use.
- A self-reference such as recursion does not count. Mutation-checked: removing
  that rule turns the recursion test red.
- A class type parameter counts as shadowing a module-level type of the same
  name.

Every duplicated name in real core, 11 of them, turns out to be used. So the
eval plants two unused twins in its temp copy to exercise the refusal path.

**The integration test passed on its first run.** REQ-UNIT-1..4 over the real
`packages/core/src` were implemented before that test was written. To show it
can fail, the slice was mutated to `end + 1`: the hash test went red, and was
then restored.

**Measured** (`pnpm eval:units`, packed workspace build, 2026-10-18):

| Target | Files | Units (exported) | Hash fidelity | Stale / moved detected |
|---|---|---|---|---|
| `simple-node-app` | 10 | 19 (16) | 19/19 | yes / yes |
| `core-src` | 53 | 569 (305) | 569/569 | yes / yes |

| Scenario | Focused | Unit tokens vs its file |
|---|---|---|
| `core-src/function` | `extractDeclaredFiles` | 159 / 2,247 (7.1%) |
| `core-src/qualified-member` | `LayerResolver.plan` | 152 / 2,155 (7.1%) |
| `core-src/backticked` | `contentHash` | 77 / 2,915 (2.6%) |
| `core-src/ambiguous` | — (correctly none) | — |
| `simple-node-app/schema-const` | `UpdateUserSchema` | 15 / 157 (9.6%) |
| `simple-node-app/camel-case` | `requireAuth` | 94 / 144 (65%) |
| `simple-node-app/two-units` | `parseBody`, `AppError` | 121 / 141 (86%) |
| `simple-node-app/prose-only` | — (correctly none) | — |

On real code, a focused unit costs 3–7% of its file, roughly 14–38× less. On
the toy fixture, where most files hold one function, it costs 10–86%. The
manifest-level ratio sits near 6.6% in `core-src` whether or not anything is
focused, so it mostly measures the existing layer 0/1 summaries, not units.

**What this does not show.** These are tokens *offered*. They are not tokens an
agent actually read, and they say nothing about whether the focused unit was
the right context. The agent tier, and the unit-level replay scoring under Out
of scope, are where that gets answered.
