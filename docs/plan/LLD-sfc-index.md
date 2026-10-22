# LLD — single-file components in the ai-index

**Area:** `SFC` — indexing `.vue` and `.svelte` files.

---

## Problem

Found on DevNexus (2026-10-21): `index` reported *"Scanned 95 files"* in a
repository with 7 `.svelte` and 9 `.vue` files, none of which reached
`ai-index.yaml`. Two of its six apps — the Svelte metrics dashboard and the Vue
incident timeline — had no symbols, no units, and no summaries, so a prompt for
either chunk could load their files only whole.

The skip is explicit. `SUPPORTED_EXTENSIONS`
(`packages/core/src/annotation/auto-extractor.ts:36`) lists the six TS/JS
extensions; `extractDirectory` (`:123`) walks only those, and `extractFile`
(`:79`) returns an empty result for anything else. The module comment says it
outright: *"Skips `.vue`, `.svelte`."*

A component's logic lives in its `<script>` blocks, which are TypeScript or
JavaScript. The parser the extractor already uses can read them; nothing
extracts them.

---

## Requirements

**REQ-SFC-1** — When the extractor reads a `.vue` or `.svelte` file, it shall
parse the content of every `<script>` block in that file as one program.

**REQ-SFC-2** — The extractor shall report a component's units and exports at
the line numbers they occupy in the component file, so a unit's hash, computed
over those lines of the file per `PROTOCOL.md`, matches the unit.

**REQ-SFC-3** — Where a `<script>` block declares `lang="tsx"` or `lang="jsx"`,
the extractor shall parse that program with JSX enabled.

**REQ-SFC-4** — If a component has no `<script>` block, then the extractor shall
return a result with no exports and no units, and the file's hash and token
cost, rather than skipping the file.

**REQ-SFC-5** — When `index` walks a directory, it shall include `.vue` and
`.svelte` files.

---

## Design

**Position-preserving blanking**, in a new `annotation/sfc-script.ts`:

```ts
/** Component source with every character outside <script> content blanked. */
export function scriptProgram(source: string): { program: string; jsx: boolean };
```

Every character that is not inside a `<script …>` … `</script>` body is
replaced with a space, except `\n`, which is kept. The result has the same
length and the same line and column of every script character as the original.
The existing pipeline — `parse` → `extractExports` → `extractUnits` →
`extractUsage` — then runs on `program` unchanged, and every position it
reports is already a position in the component file. That is what makes
REQ-SFC-2 hold by construction rather than by an offset table: a unit's lines in
`program` *are* its lines in the file, since script lines are untouched.

The file hash stays `contentHash(source)` over the real file. Template markup
never reaches the parser, so a `<` in a template cannot fail the parse.

Block detection is a scan for `<script` followed by whitespace or `>`, then the
first `>` that closes the tag, then the next `</script>`. An unterminated block
runs to end of file. Vue's `<script>` + `<script setup>` and Svelte's
`<script module>` / `<script context="module">` + instance script are all just
two blocks.

`extractFile` routes `.vue`/`.svelte` through `scriptProgram` before `parse`;
`SUPPORTED_EXTENSIONS` gains both, so `extractDirectory` walks them
(REQ-SFC-5).

**What a component exports.** Only what its script says. `<script setup>` and
Svelte instance scripts have no `export` statements (Svelte 4's `export let`
props are `ExportNamedDeclaration`s and are reported as such); their top-level
declarations still become units. No synthetic "the component is the default
export" symbol is invented — "wrong is worse than absent".

**No new dependency.** `@vue/compiler-sfc` and `svelte/compiler` would parse
these properly, but `core` takes no new runtime dependencies (HLD), and both are
heavy.

---

## Test plan

| Requirement | Level | Test |
|---|---|---|
| REQ-SFC-1 | unit | Vue file with `<script>` + `<script setup lang="ts">`: units from both blocks |
| REQ-SFC-2 | unit | Each unit's `start..end` lines of the *real file* hash to the unit's `hash`; a Svelte `<script module>` export reported at its file line |
| REQ-SFC-3 | unit | `lang="tsx"` block containing JSX parses; the same block without JSX enabled would not |
| REQ-SFC-4 | unit | Svelte component with only markup → empty exports/units, non-empty hash |
| REQ-SFC-5 | unit | `extractDirectory` over a temp tree returns the `.vue` and `.svelte` files |
| REQ-SFC-5 | eval | `pnpm eval --local --target` on DevNexus: `index` file count includes the 16 components |

### What actually happened

| Requirement | Outcome |
|---|---|
| REQ-SFC-1, 2, 3, 5 | **Failed first** — extractor returned nothing for a component |
| REQ-SFC-4 | **Passed before the change**: the old skip path already returned a hash and token cost. Kept as a regression lock |

One test expectation was wrong, not the code: it expected a unit for Svelte's
`let { values } = $props()`. Destructuring yields no unit in a `.ts` file either
(`unit-extractor.ts:281`); the test now says so.

DevNexus, local build: `index` went from 95 to 111 files — all 16 components.
15 carry units (66 in all; the 16th has no script); hash fidelity 66/66 against
the real files. No parse errors.

---

## Out of scope

- **Template-only references.** A component used only in another component's
  template (`<IncidentCard />`) is not seen as a use of `IncidentCard.vue`;
  usage comes from `import` statements only.
- **Other single-file formats** (`.astro`, `.mdx`). Same technique would apply;
  no repository in hand needs them.
- **Vue `defineProps` / Svelte `$props()` as a component signature.** They are
  units like any other declaration, not surfaced as the component's API.
