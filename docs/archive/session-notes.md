# Session notes — chunks 1–19

Rescued from `.session/SESSION_STATE.md` before that directory was deleted.
That file was gitignored, so this is the only surviving copy.

These are the running notes kept while the first nineteen chunks were built:
what broke, why, and what the fix depended on. They are a record, not a spec —
where a note contradicts the code, the code is right. The still-live constraints
have been lifted into [`docs/plan/HLD.md`](../plan/HLD.md) and
[`CLAUDE.md`](../../CLAUDE.md); everything here is kept for the reasoning behind
them.

---

## Prompt correctness — 2026-08-22

**Doc-audit bugfixes.** Found by cross-checking every documented claim against
source. Both were real:

1. **A regression introduced by the fix itself.** Wiring `validate()` into
   `write()` broke the *layered* path. `formatLayeredContextLines` emits
   `Load full:` and `Summaries (read_file_layer for detail):`, but
   `FILE_LOAD_FIELDS` accepted only `Load:` / `Files to load:` — neither layered
   line matched, so **every project with an `ai-index.yaml` would throw
   `CliError` on init/update** (final-writes sets `resolvedLayers` whenever
   `aiIndex !== null`). e2e missed it because the fixture projects have no
   ai-index, so only the flat path was ever exercised.
2. **`ReplayScorer` had prefix `Summaries:`**, which never matches the real
   longer prefix, and `normalizeRef` did not strip the `·L<n>` marker the summary
   line appends — recall/precision silently counted layer-2 files only. Its unit
   test passed *only because it fed hand-written lines instead of real formatter
   output*.

**Root cause of both:** three separate private copies of the prompt line
prefixes. **Fix:** single source of truth in `formatters/formatter-utils.ts` —
`LOAD_PREFIX` / `LEGACY_LOAD_PREFIX` / `LOAD_FULL_PREFIX` / `SUMMARIES_PREFIX` /
`FILE_LOAD_PREFIXES` / `LAYER_SUFFIX_RE`, all exported from the core barrel so
out-of-tree formatters registered via `registerAdapter()` can import rather than
hardcode. Formatter, validator and scorer all derive from it; a fourth copy was
hiding in the legacy `generate()` path.

> **Lesson:** tests that feed hand-written fixtures instead of real generator
> output cannot catch emitter/parser drift. This is why
> [METHOD.md](../METHOD.md) makes it a rule.

Threading gaps fixed in the same pass: `advance.ts` never passed
`max_prompt_lines`; `status.ts` compared against a hardcoded `MAX_PROMPT_LINES`
while `health` used the configured value (status now uses
`state.max_prompt_lines ?? MAX_PROMPT_LINES` — the `??` matters, hand-built
states omit the field).

**Correction to the docs:** team mode does **not** commit `NEXT_PROMPT.md` —
`GITIGNORE_ENTRIES_TEAM` still lists it. Team mode's only gitignore difference is
omitting `ai-index.yaml`. Replay scoring is opt-in in *both* modes.

**Pre-existing doc rot found:** `API.md` had reversed arg orders
(`safeResolvePath`, `generateWithFormatter`) and three invented type shapes;
`commands.md` documented a nonexistent `--chunk` flag on `index add` and three
fabricated health checks; `team-mode.md` documented a nonexistent
`migrate --team`; `PROTOCOL.md` specified `in_progress` and a **string**
`active_chunk`, both of which the Zod schemas reject — a tool following the spec
would have failed validation.

**Verification pass** (1257 tests green):

- `NextPromptWriter.write()` now runs `validate()` before persisting. Previously
  `validate()` had exactly **one** caller (`status.ts:191`), so `update` and
  final-writes wrote unvalidated output. This also closes the custom-adapter
  bypass, since `registerAdapter` formatters were fully trusted.
- `health-checker` counted `content.split("\n").length` *including* the trailing
  newline while `validate()` filtered blanks — a maxed-out prompt **always**
  false-positived `PROMPT_TOO_LONG`. Both now call the single
  `countPromptLines()` in `schemas/next-prompt.ts`.
- `trimToMaxLines` no longer truncates silently — it spends the last slot on a
  `[N more lines trimmed]` marker. Formatters order Notes / Don't-load last, so
  those were exactly the lines being dropped.
- **Line cap is now configurable:** `max_prompt_lines` in `SESSION_STATE`
  frontmatter (5–50, default 20), threaded via `BootstrapContext.maxPromptLines`
  into all five formatters plus validate/write/health. Serialized **only when
  non-default** so existing state files are untouched.
  **Gotcha:** the serializer must guard on `typeof === "number"`, not just
  `!== default` — hand-built states omit the field, and `String(undefined)`
  writes a literal `"undefined"` that fails to parse back.
  Docs said 15 everywhere while code enforced 20; all aligned to 20.
- **Compact egress guard:** `compact` is the only network egress in the tool and
  it was uploading raw file content with no scan — `WriteGuard` covers writes,
  not uploads. `guardEgress()` runs `SecretScanner` before the API call; refuses
  with redacted findings, `--allow-secrets` overrides.
- **New `verify` command + git layer:** `GitReader` (`core/src/git`, `execFile` +
  arg arrays, rev shape-check, node builtins only so the no-deps rule holds),
  `SessionVerifier` (`DONE_WITHOUT_EVIDENCE` = error, `UNBACKED_WORKED_FILE`,
  `UNINDEXED_CHANGE`, `UNCOMMITTED_SESSION`), `ReplayScorer` (recall / precision
  / waste from git alone, no API key).
  **Gotcha:** git stdout must be *trailing*-trimmed only — a full `.trim()` eats
  the leading space of the first porcelain line and clips that path by one
  character. Found by running it, not by tests; regression covered in
  `tests/git-reader.integration.test.ts`.
  Replay needs `NEXT_PROMPT.md` **tracked**; this repo gitignored it (solo mode),
  so replay reported `unavailableReason` instead of a silent zero.

---

## Quality pass — 2026-07-05

1,206 tests green, typecheck + lint clean.

- **Pluggable registry** — `registerAdapter()` / `unregisterAdapter()` /
  `getAdapterByName()` in `packages/adapters/src/registry.ts`. `ADAPTER_MAP`
  renamed `BUILTIN_ADAPTERS`; custom adapters live in a `Map`; names validated
  lowercase-kebab, built-ins + `plain` reserved. `CliError` is imported from the
  `@dev-session/core` re-export, since adapters cannot depend on `security`.
- **`resolve-adapter.ts`: the `VALID_ADAPTER_NAMES` hand-list was removed** —
  `--adapter` names now derive from `getRegisteredTools()` minus `unknown`, which
  kills the windsurf-omission bug class (see below). Flag resolution goes through
  `getAdapterByName`, so custom adapters work with `--adapter`.
- Barrel `index.test.ts` (core + adapters) rewritten from `toBeDefined()`
  existence checks to behaviour tests (round-trip, schema defaults/rejects,
  registry-export consistency).
- Docs: Windsurf added to the README adapters table and `docs/adapters.md`
  (fallback is **plain**, not claude); custom-adapter registration documented.

> This partially un-defers the registry item from the chunk 18 backlog —
> in-process API only, no npm discovery.

---

## v2.0.1 smoke-test bugfixes — 2026-06-19

Three bugs from a manual test, all fixed; 1,093 unit green.

1. `lint-context --json` on the no-files path emitted clack spinner text, not
   JSON → now writes a valid passing JSON object before the early return. The
   text message now names the real sections (`## Always Include` / `## Chunk N`),
   since the tester had edited a nonexistent `## Context files` heading. The
   parser only knows `Always Include` → 0 and `Chunk N`; rows under other
   headings are silently dropped, by design.
2. MCP `serverInfo` version was hardcoded `1.0.0` → extracted `readVersion()`
   into shared `packages/cli/src/read-version.ts`.
   **Gotcha:** it must stay at `src` depth-1 so `../package.json` resolves in
   both source and the single dist bundle — do **not** move it under `utils/`,
   which is depth-2 and breaks source/test resolution.
3. `advance` with no next PLAN exited 1 (`CliError`) on a clean terminal state →
   the no-next-chunk branch now logs and returns
   `AdvanceResult { allChunksComplete: true, newChunkId = current }` with no
   archive/advance, exit 0.

---

## Property tests — 2026-06-17

`fast-check` 4.8.0 added to **root** devDeps, not `core` / `security` — that
respects the no-dependencies hard rule. It lives with vitest/execa/tmp-promise,
hoisted.

- `path-validator.property.test.ts` — central invariant: for **any** string,
  `safeResolvePath` either throws `SecurityError` or returns an in-boundary path
  (fuzzed with `fc.string` plus `fc.string({ unit: "binary" })` for lone
  surrogates). Reject-class properties (null bytes, absolute paths,
  proto-pollution segments, `../` climbs) all carry `PATH_TRAVERSAL`.
- `plan-parser.property.test.ts` — `toMarkdown` ↔ `fromMarkdown` round-trip
  preserves id/title/tasks/deps/est; empty → `ParseError`, non-empty → never
  throws; `detectBoundaries` invariants (in-range lines, confidence ∈
  {1, .7, .5, .3}, consecutive ids).

**Gotcha:** fast-check v4 removed `fc.fullUnicodeString` — use
`fc.string({ unit: "binary" })`. Round-trip generators must flatten control
characters to a space and trim (single-line markdown); titles need no
special-casing, since `extractTitle` strips only the leading `Chunk N — `.

---

## Coverage pipeline

vitest's v8 provider cannot instrument execa-spawned CLI subprocesses, so global
coverage read artificially low (70/60). Built a c8 + `NODE_V8_COVERAGE` pipeline
in `tests/coverage/`: `collect-e2e-coverage.mjs` dumps raw v8 from the CLI bundle
and c8 remaps via the tsup sourcemap (`--exclude-after-remap` drops bundled
`node_modules`); `merge-coverage.mjs` merges with the vitest json.

**Critical:** attribution must be **disjoint** — `cli/**` and
`core/src/checkers/**` go to c8, everything else to vitest. The two collectors
produce different statement maps for the same file, and overlap-merging corrupts
the percentage (adapters dropped 86 → 69 when this was tried).

Gap closed with +33 lifecycle e2e tests and 20 `formatAiIndex` unit tests. Final:
81.94% statements / 75.67% branches; gate raised to 80/75.

- **Gotcha:** the c8 report OOMs on ~187 CLI dumps — needs
  `--max-old-space-size=8192`, set in `collect-e2e-coverage.mjs`.
- **Gotcha:** the `status` all-done warning reads PLAN frontmatter
  `tasks[].status`, **not** the markdown checkboxes.

---

## Windsurf adapter — 2026-06-17

Chunk 16 complete; 1,111 tests passing.

- `WINDSURF` added to the `DetectedTool` enum and Zod schema
  (`project-info.ts`). Detects `.windsurfrules` and `.windsurf/` markers in
  `project-detector.ts`.
- `WindsurfBootstrapFormatter` mirrors `CursorBootstrapFormatter` (plain paths,
  Ignore directive). `WindsurfAdapter` manages `.windsurfrules` with
  `# dev-session:start/end` section markers.
- **Follow-up fix:** `--adapter windsurf` was initially broken —
  `VALID_ADAPTER_NAMES` in `resolve-adapter.ts` omitted windsurf, so the flag
  threw "Unknown adapter" despite auto-detect working. This is the bug class the
  2026-07-05 registry pass eliminated at the root.
- **Note:** `CliError` renders via `@clack/prompts` to **stdout**, not stderr —
  assert on stdout in e2e tests.

---

## Standing gotchas

- **`gitleaks detect` flags 14 fake fixtures** in
  `packages/security/src/__tests__/` — it is a secret scanner, the fixtures are
  by design. `.gitleaks.toml` allowlists that directory. gitleaks is not
  npx-runnable (Go binary; `brew install`).
- **`private: true` on core/security/adapters is deliberate.** They are bundled
  into the CLI via tsup `noExternal` and never published standalone. Only `cli`
  is publishable, under the npm name `dev-sesssion` (three s's).
- **`advance()` does `active_chunk + 1`** and the chunk file pattern is
  `/^PLAN_(\d+)\.md$/` — integer ids only. Decimal split/advance is unhandled.
  Carried as a known limitation; see "What this work does not do" in
  [`docs/plan/HLD.md`](../plan/HLD.md).

---

## Deferred backlog (never started)

Two chunks were written as deferrals rather than work. Both are recorded here
because the *reasoning for not building them* is the useful part; the full
designs are in [`PLANv2.md`](./PLANv2.md).

### Cross-session and cross-project intelligence

Deferred. The annotation quality feedback loop (`@ai-layer-hint` is wrong →
profile detects it → `--fix` corrects it) requires three gates before any value
lands: `@ai-*` annotations must exist on the project, there must be multiple
sessions of usage data, and the user must have opted into profiling.
`profile quality --fix` needs programmatic JSDoc modification that preserves
formatting — notoriously difficult, and a large bug surface for marginal value.
Cross-project aggregation adds no insight beyond a single project's
`CONTEXT_LOG.md` until the per-project data is mature.

*Revisit when* real users are adding `@ai-*` annotations and `CONTEXT_LOG.md` has
multiple sessions of layer expand/collapse data showing hints that are actually
wrong in practice.

### Open ecosystem — protocol spec, community adapters, registry

Deferred. Shipping a protocol spec before the protocol is stable locks in
decisions prematurely: the annotation schema, layer semantics and MCP tool
contracts *will* change once real users hit them, and versioning a spec too early
turns design debt into breaking changes. A community adapter registry is
overbuilt when there are zero community adapters — an npm naming convention
(`dev-sesssion-adapter-*`) plus a docs page is enough for discovery until there
are adapters to find.

*Revisit when* the annotation schema, `session.yaml` format and MCP tool
contracts have gone 4+ weeks without a breaking change, at least one community
adapter exists, and `PROTOCOL.md` can describe what exists rather than what was
planned.

> The in-process half of the registry item shipped early anyway, in the
> 2026-07-05 quality pass.
