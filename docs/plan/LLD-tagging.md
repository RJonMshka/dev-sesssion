# LLD — tagging on touch

**Area:** `IDX` — file index parsing, layout, and auto-tagging. REQ-IDX-1..11
live in [LLD-session-integrity.md](LLD-session-integrity.md) and REQ-IDX-12..18
in [LLD-file-index.md](LLD-file-index.md); this document continues at 19. One
dry-run requirement, REQ-DRY-7, is recorded here and cross-listed (as REQ-PS-20
was in LLD-file-index.md). HLD feature 3, second half.

LLD-first-run.md took over `init --yes`, and LLD-file-index.md tagged the files
a plan names. This document covers what is left of feature 3: the interactive
tagging prompts at `init`, and tagging a file when a session touches it.

The HLD's framing holds: *"Feature 3 does not add a smarter guesser — it removes
the demand that tagging be complete at init, and defers it to the moment a file
is actually touched."* The ruling constraint is the HLD's "wrong is worse than
absent" and the product rule behind it, accurate, never wrong. The load list is
capped, so a wrong tag pushes out a right one. Every rule below that has to
choose between tagging and not tagging chooses not tagging.

---

## Problem

Read from the code on `docs/lld-remaining-features` (`ef40841`) on 2026-10-24.

**1. The 30-prompt flow is still there, and it is worse than `--yes`.** The
first-run and file-index slices changed only the `--yes` branch
(`packages/cli/src/commands/generate-index.ts:115-124`). The interactive branch
(`:125-194`) has not changed:

- It asks one `select` per directory (`:136-154`), capped at
  `MAX_INTERACTIVE_GROUPS = 30` (`:50`).
- A chosen chunk is written onto **every file in the directory** (`:165-175`).
  The tag comes from where a file sits, not from anything that names it.
- Past 30 directories it warns *"Remaining files will be tagged to chunk 1"*
  (`:130-133`) and does so (`:178-193`). This is the blanket fallback that
  REQ-RUN-1..4 removed from `--yes`, still running on the interactive side.
- It never calls `referencedFiles`. So a user who answers the questions gets
  none of REQ-RUN-1 or REQ-IDX-17. A plan whose Key Files name 47 files tags
  them for `init -y` and tags none of them for plain `init`, unless the user
  happens to pick the right chunk for each directory.

`docs/commands.md:44` describes this as *"Without `--yes`, it asks per
directory"*. No test covers the branch: `packages/cli/src/__tests__/generate-index.test.ts`
exercises only `--yes`, and e2e runs have no TTY.

**2. Nothing tags a file after `init`.** The only code paths that write
`FILE_INDEX.md` are `init` (`generate-index.ts:202`), `index add`
(`index-cmd.ts:393-394`), and the clean-ups in `index audit`, `health`,
`compact` and `import`, which remove or rewrite rows. Three consequences:

- `update` reads `git status` (`update.ts:118-134`) and stores the result as
  `last_worked_files` (`session-state-manager.ts:129-134`). That list feeds
  only the prompt's `Last touched:` line (`claude-bootstrap-formatter.ts:133-135`,
  `next-prompt-writer.ts:93-94`), three files at most, and the context log. It
  never reaches the index. `docs/commands.md:177` says otherwise: *"Detects
  git-modified files and suggests adding them to the index"*.
- A chunk whose plan names no paths starts with nothing loaded, and stays
  that way however many sessions it takes. Files the agent edited in session 1
  are not loaded in session 2 of the same chunk.
- A file the plan names that does not exist at `init` is never tagged once it
  is created. `LLD-new-files.md:91` justifies REQ-NEW-6 with *"once the new
  file exists, `index` tags the real one"*. It does not: `runIndex` builds
  `ai-index.yaml` and refreshes the prompt (`index-cmd.ts:158`), and nothing
  in it calls `referencedFiles` or writes `FILE_INDEX.md`.

`verify` already reports the gap: `UNINDEXED_CHANGE`
(`session-verifier.ts:216-227`) warns about modified files that
`FILE_INDEX.md` does not list. Nothing acts on the warning.

**3. The session has no starting point to diff against.** "Touched in this
session" needs a baseline, and none is recorded. `SessionStateSchema`
(`schemas/session-state.ts:19-64`) holds `session_id` and a date. The context
manifest (`schemas/context-manifest.ts:57-76`) holds `generated_at`, but it is
overwritten whenever `index`, `import` or `trim` refresh the prompt mid-session
(`import.ts:167`, `index-cmd.ts:158`, `trim.ts:318`), so anything stored in it
would move partway through a session. Today's git readers also have no notion
of "since": `git status` sees only uncommitted work, so a file the agent
committed during the session is invisible to `update`.

**4. The git status parsers lose paths.** There are two private copies:
`update.ts:343-356` and `GitReader.dirtyFiles` (`git-reader.ts:139-157`). Both
run `status --porcelain --short` without `-z` or `--untracked-files=all`, which
causes three losses:

- A new directory is reported as `dir/`, not as its files.
- A path with a space or a non-ASCII character comes back in quotes.
- `update.ts:350` keeps a rename as `old -> new`. `GitReader` strips the
  arrow; `update.ts` does not, so `last_worked_files` can hold
  `src/a.ts -> src/b.ts` and the Claude prompt renders it as an `@` reference.

**5. Merging an entry overwrites it.** `FileIndexManager.add`
(`file-index-manager.ts:171-195`) unions the tags but replaces `purpose` and
drops `token_cost`. Under REQ-IDX-11, a changed purpose is written to every
section the file appears in. A tagger that reuses `add` therefore rewrites rows
it had no reason to touch.

**6. `FILE_INDEX.md` has no room for provenance.** On disk a row is a
two-column `| File | Purpose |` table row. The header and separator patterns
are fixed at two columns (`file-index-manager.ts:53`, `:56`), and
`parseTableRow` reads `cells[0]` and `cells[1]` (`:337-375`). If a third column
were added, every older reader would fail to recognise the new header and parse
it as a data row: an entry for a file named `File`.

---

## Requirements

### The session base

**REQ-IDX-19** — When `init`, `update` or `advance` writes `SESSION_STATE.md`
in a git work tree, it shall record a session base, made of two parts: the
commit `HEAD` names, if there is one, and the content hash of every file that
`git status` then reports as modified, added or untracked.

The base marks where the next session starts. `update` records it *after*
tagging (see Design, `update`), so each `update` covers the work done since the previous
`update`, `advance` or `init`. `index`, `import` and `trim` do not move it.

**REQ-IDX-20** — If more than 200 files are modified or untracked when the base
is recorded, then the command shall record no session base.

A working tree that dirty, such as a repository with no `.gitignore`, cannot
tell session work from what was already lying there. REQ-IDX-24 then turns the
next `update` into a no-op for tagging.

### What "touched" means

**REQ-IDX-21** — When `update` runs, the touch detector shall treat a file as
touched if a commit since the base added, modified or renamed it to its present
path, provided that commit:

- is on `HEAD`'s first-parent line,
- is not a merge, and
- has the same author email as the repository's configured `user.email`.

The three conditions keep out other people's work arriving through a
fast-forward `git pull` or a merge. A plain `pull` advances `HEAD` past the base
just as the user's own commits do, and without the author condition a
teammate's three files would be tagged to this chunk. If `user.email` is unset,
the detector counts no commits, and says so in the report (REQ-IDX-35).

**REQ-IDX-22** — When `update` runs, the touch detector shall also treat as
touched every file that the working tree adds, modifies or renames relative to
`HEAD`, whether staged, unstaged or untracked. An untracked directory counts as
the files inside it.

**REQ-IDX-23** — If a file was modified or untracked at the base, and its
content hash is the same now, then the touch detector shall not treat it as
touched.

That file is work in progress the session did not change. If the session did
change it, its hash differs and it counts.

**REQ-IDX-24** — If there is no session base, or its commit no longer exists,
or its commit is not an ancestor of `HEAD`, then `update` shall tag no file on
account of touch, and shall state which of the three it was.

`HEAD` loses the base as an ancestor after a branch switch, a rebase, or an
amended commit. Diffing across any of these would report the difference
between two branches as "touched". The first `update` after upgrading to this
feature has no base, tags nothing, and records one.

### What is not tagged

These filters run in the order listed, and each file that is not tagged is
counted under the first reason that applies.

**REQ-IDX-25** — The touch tagger shall not tag a file that no longer exists,
nor any of these:

- a file under `.session/`;
- a file under a directory the walker always ignores (`node_modules`, `.git`,
  `dist`, `build`);
- an always-include file (tag `0`);
- a file the tool writes itself outside `.session/`: `.gitignore`,
  `.gitattributes`, and the instruction file of each registered adapter.

That last group is the first-run Out-of-scope item *"the tool's own edits count
as the user's"*, closed for tagging.

**REQ-IDX-26** — If a path contains a character outside
`A–Z a–z 0–9 . _ - + @ /`, then the touch tagger shall not tag it.

Paths reported by git are repository content (CLAUDE.md, trust boundary). A
path is written into a `|`-delimited table row and later rendered as a prompt
reference, so it has to be path-shaped by construction. This is the same
character set as REQ-NEW-2.

**REQ-IDX-27** — The touch tagger shall not tag a dependency lockfile. A file
counts as a lockfile when its basename is in the list in core (`pnpm-lock.yaml`,
`package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, `poetry.lock`, …).

**REQ-IDX-28** — If git reports a touched file as binary, or the repository's
git attributes mark it `linguist-generated`, then the touch tagger shall not tag
it.

The `linguist-generated` attribute is the user's own statement in
`.gitattributes` that a file is machine-written. The detector reads that
statement and does not try to guess which files are generated.

**REQ-IDX-29** — If a touched file's content differs from the base only in
whitespace and blank lines, or does not differ at all, then the touch tagger
shall not tag it.

The second case covers a file edited and then reverted within the session.

**REQ-IDX-30** — If more than 20 files remain after REQ-IDX-25..29, then the
touch tagger shall tag none of them, and `update` shall report how many there
were.

A session that touches that many files is a sweep: a rename across the
codebase, a formatter run, or a dependency bump. Tagging all of them would push
the chunk's real files out of the load list. Tagging a subset would mean
guessing which ones matter.

**REQ-IDX-31** — If every task in the active chunk is done, then the touch
tagger shall tag nothing. This mirrors REQ-IDX-18: finished work loads nothing.

### Which chunk

**REQ-IDX-32** — When the touch tagger tags a file, it shall tag it to the
active chunk.

During `update` the active chunk is the one the session worked on. `update`
never changes `active_chunk`.

**REQ-IDX-33** — When the touch tagger tags a file, and an unfinished task or
the `files` of an unfinished, uncompleted chunk names that file (by the matcher
of REQ-RUN-2 and the ambiguity rule of REQ-RUN-3), it shall also tag the file
to that chunk.

This is the tag REQ-IDX-17 would have given the file at `init` if the file had
existed then. It applies only to touched files, so a row the user removed by
hand is not re-added on every `update`.

### Writing the tags

**REQ-IDX-34** — When the touch tagger tags a file that `FILE_INDEX.md` already
lists, it shall add the chunk to that file's tags and keep its existing tags,
purpose and token cost.

**REQ-IDX-35** — When `update` writes tags from touch, the lines of
`FILE_INDEX.md` it does not change shall stay exactly as they were, in the same
order. The only change shall be the rows added for the new tags. `update` shall
remove no tag on account of touch.

**REQ-IDX-36** — When `update` adds tags, the `NEXT_PROMPT.md` written by the
same run shall load the newly tagged files.

### Reporting and control

**REQ-IDX-37** — When `update` runs in a git work tree, it shall report the
files it tagged, each with its chunks, and for each reason in
REQ-IDX-21..31 the number of touched files it left untagged for that reason.

**REQ-IDX-38** — Where `update` runs without `--yes` and there are files to
tag, `update` shall ask once, with every file preselected, and shall tag only
the files the user keeps.

**REQ-IDX-39** — Where `--no-tag` is given, `update` shall tag no file on
account of touch.

**REQ-IDX-40** — While dry-run is active, `update` shall report the files it
would tag, with their chunks.

**REQ-DRY-7** — While dry-run is active, `update` shall not modify
`FILE_INDEX.md`.

(REQ-DRY-1 already keeps `SESSION_STATE.md`, and the base in it, unchanged
under dry-run.)

**REQ-IDX-41** — `advance` shall tag no file on account of touch.

Once a chunk is completed it loads nothing (REQ-RUN-29), so a tag on it is
dead weight. Tagging the *next* chunk would mean guessing that work carries
over. `advance` records a fresh base under REQ-IDX-19 and stops there.

### Interactive init

**REQ-IDX-42** — When `init` runs without `--yes`, the file index generator
shall tag the same files to the same chunks as it does with `--yes`, and shall
ask no tagging question.

**REQ-IDX-43** — The file index generator shall not tag a file to a chunk
because of the directory the file is in.

---

## Design

### The base: `SessionStateSchema.session_base` (optional)

```ts
/** Where the next session starts (REQ-IDX-19). Absent: no git, or REQ-IDX-20. */
session_base: z
	.object({
		/** HEAD at the base; absent when the repository had no commits. */
		commit: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/).optional(),
		/** Files modified or untracked at the base, with their content hashes. */
		dirty: z
			.array(z.object({ path: z.string().min(1), hash: z.string().min(1) }).strict())
			.max(200),
	})
	.strict()
	.optional(),
```

The field is optional and additive, as the HLD requires. `PROTOCOL.md`'s
`SESSION_STATE.md` table gains the row in the same commit. The hash is the
`contentHash` already defined in `PROTOCOL.md` (SHA-256 over the file, first 16
hex characters), so the base needs no second hashing scheme and no extra git
call per file.

The base goes in `SESSION_STATE.md` for three reasons:

- Exactly the three commands that open a session (`init`, `update`, `advance`)
  write it.
- `index`, `import` and `trim` refresh only the prompt and manifest, so they do
  not move the base. A base in the manifest would move whenever they ran.
- `SESSION_STATE.md` is gitignored in both personal and team mode
  (`final-writes.ts:69-87`), which suits a value that belongs to one working
  copy.

`SessionStateManager`'s hand-written serializer
(`session-state-manager.ts:294-319`) gains a `serializeSessionBaseYaml`. Like
`project_name`, it writes the field only when it is present. `final-writes.ts`'s
`serializeSessionState`, the copy that is only scanned for secrets, gains the
same lines.

### Git access: `GitReader` (extend, `core`)

Every new method uses `execFile` with an argument array and `-z` output, and
every revision passes `assertSafeRev`.

```ts
head(cwd): Promise<string | null>;                       // rev-parse --verify -q HEAD
userEmail(cwd): Promise<string | null>;                  // config user.email — compared, never stored
commitExists(cwd, sha): Promise<boolean>;                // cat-file -e <sha>^{commit}
isAncestor(cwd, a, b): Promise<boolean>;                 // merge-base --is-ancestor
statusEntries(cwd): Promise<StatusEntry[]>;              // status --porcelain=v1 -z --untracked-files=all
committedBy(cwd, base, email): Promise<string[]>;        // log --first-parent --no-merges -M
                                                         //   --diff-filter=ACMR --name-only -z --format=%x00%ae base..HEAD
substantive(cwd, base | EMPTY_TREE, paths): Promise<Map<string, "changed" | "blank" | "binary">>;
                                                         // diff --numstat -z -w --ignore-blank-lines <base> -- paths
attribute(cwd, paths, "linguist-generated"): Promise<Set<string>>;   // check-attr -z, argv chunked
```

`statusEntries` parses `-z` records, so renames, spaces and new directories
come out right (Problem 4). When the base has no commit, `substantive` diffs
against the empty tree; its id comes from `git hash-object -t tree /dev/null`,
so SHA-256 repositories work as well as SHA-1 ones.

`update.ts`'s private `getGitModifiedFiles` stays as it is for
`last_worked_files` (see Out of scope). The touch detector does not use it.

### Detection and decision: `core/src/calculators/touch-tags.ts` (new)

The work is split into an I/O step and a pure step, in the same way
`NewFiles.absent` and `neighbours` are split.

```ts
/** Records the base (REQ-IDX-19, -20). `null` outside git or past 200 dirty files. */
SessionBase.capture(cwd: string): Promise<SessionBase | null>;

/** Touched candidates since the base, with git's facts about each (REQ-IDX-21..24). */
TouchDetector.detect(cwd: string, base: SessionBase | undefined): Promise<TouchObservation>;

export type SkipReason =
	| "no-base" | "base-missing" | "base-not-ancestor" | "no-user-email"
	| "unchanged-since-base" | "excluded-path" | "unsafe-path" | "lockfile"
	| "binary-or-generated" | "whitespace-only" | "too-many" | "chunk-done";

/** Pure. Which files get which chunks, and why the rest do not (REQ-IDX-25..33). */
TouchTagger.decide(input: {
	observation: TouchObservation;
	entries: readonly FileIndexEntry[];
	chunks: readonly PlanChunk[];
	activeChunk: number;
	completed: readonly number[];
	toolOwned: ReadonlySet<string>;      // from the CLI: adapter instruction files
	walked: readonly string[];           // for REQ-IDX-33's uniqueness rule
}): { tags: ReadonlyMap<string, number[]>; skipped: ReadonlyMap<SkipReason, number> };
```

`detect` gets the touched set as follows:

1. Take the union of `committedBy(base, userEmail)` and the `statusEntries`
   that are not deletions.
2. Drop each path whose hash in `base.dirty` matches its hash now
   (REQ-IDX-23).
3. Ask `substantive` and `attribute` about what is left.

If any of the three checks in REQ-IDX-24 fails, `detect` returns the reason and
no candidates, and stops before running anything else.

`decide` applies REQ-IDX-25..31 in order. The walker's always-ignored
directories come from a predicate exported from `gitignore-aware-walker.ts`,
the module that owns them (it is private at `:116-119` today); the lockfile
list is a constant beside it. `decide` tags the survivors to `activeChunk`
(REQ-IDX-32), and then to each chunk that `referencedFiles(chunks, walked)`
gives for the same path (REQ-IDX-33). `referencedFiles` already leaves out done
tasks and done chunks, and the caller passes in only chunks that are not
completed, as `init` does (`init.ts:187`).

### Applying tags: `FileIndexManager.tag` (new)

```ts
/** Adds chunk tags to a file, keeping purpose, cost and other tags (REQ-IDX-34). */
tag(entries, filepath, chunks: readonly number[], purpose: string): FileIndexEntry[];
```

`tag` is a separate method from `add`. `add`'s replace-the-purpose behaviour is
what `index add` wants, and it is wrong here (Problem 5). For a new file the
purpose comes from `inferPurpose`, which moves from `generate-index.ts:264-298`
into core (below). REQ-IDX-35 follows from the existing `save` layout
preservation (REQ-IDX-4..8): rows for an existing section are appended after
its last row, and a tag with no section yet gets a new section.

### Provenance: none in `FILE_INDEX.md`

A tag learned from touch looks the same in `FILE_INDEX.md` as a tag from the
plan or from a person. The reasons:

- **The format has no room for it.** A third column breaks every older reader
  (Problem 6). A `## Chunk 3 — touched` section would parse in older readers,
  but `FileIndexEntry` has no field that records which section a row came from,
  so the distinction would be lost on the first `save`.
- **Nothing would read the marker.** A tag means "load this file when chunk N
  is active", whoever wrote it. To remove one, the user deletes the row, which
  already works.
- **The record lives elsewhere.** The `update` report (REQ-IDX-37) shows what
  was learned, and when.

`FileIndexEntrySchema` does not change.

### Moving tagging into core: `core/src/calculators/plan-tags.ts` (new)

`tagFromTasks` and `inferPurpose` (`generate-index.ts:235-298`) are business
logic, and `CLAUDE.md` does not allow that in `packages/cli`. They move to core
unchanged, as `PlanTags.fromPlan(files, chunks, alwaysInclude)` and
`inferPurpose(path)`. `generate-index.ts` keeps the walk, the spinner, the
dry-run log and the call to `save`.

### Interactive init: the per-directory prompts are cut

The branch at `generate-index.ts:125-194` is deleted, along with
`MAX_INTERACTIVE_GROUPS` and the chunk-1 fallback. Both modes call
`PlanTags.fromPlan`, so they produce the same `FILE_INDEX.md` (REQ-IDX-42), and
REQ-RUN-6's tagged/left report prints in both. The prompts are removed, not
made smaller or optional, because each answer tags a whole directory: the
question itself is what produces wrong tags (REQ-IDX-43), however few times it
is asked. The interactive session keeps its two other uses through existing
paths:

- tagging a file by hand: `index add <file>`, which offers every chunk plus
  "Always include";
- skipping a directory: no longer needed, because untagged is now the default.

`generateIndex`'s `yes` option no longer affects tagging. It stays in the
signature only if something else still reads it.

### `update` and `advance` (CLI)

`update`, after the task and note steps:

1. `detect` (core), then `decide` (core).
2. If `--no-tag` was given, skip the rest of this list (REQ-IDX-39).
3. Without `--yes`, show one `multiselect` with every file preselected
   (REQ-IDX-38). With `--yes`, take them all.
4. Compute the new entries with `FileIndexManager.tag`. Under dry-run, print
   them and do not write (REQ-IDX-40, REQ-DRY-7); otherwise `save`.
5. Pass the *new* entries to `regeneratePrompt` (REQ-IDX-36). Today it is
   handed `allEntries` loaded at `update.ts:88`.
6. `SessionBase.capture` goes into the state before `SessionStateManager.save`,
   which dry-run already skips.

The base is captured after tagging. `--no-tag` and a declined prompt still move
it, so a file the user deselected is not offered again next time.

The CLI only renders the report (REQ-IDX-37) from `decide`'s `tags` and
`skipped`. The CLI also supplies `toolOwned`, because core cannot import the
adapter registry. It builds the set from each registered adapter's instruction
file plus `.gitignore` and `.gitattributes`.

`advance` and `init` call `SessionBase.capture` and nothing else from this
module (REQ-IDX-19, -41).

### What this changes elsewhere

- `verify`'s `UNINDEXED_CHANGE` fires less often: the files it reports are the
  ones this feature tags. The check itself does not change.
- REQ-NEW-6 still holds. Neighbours are never written to the index. A neighbour
  the session then *touches* is tagged on that evidence, the same as any other
  file.
- `docs/commands.md:44` and `:177` are corrected in the same commit. The `init`
  entry loses "asks per directory", and the `update` entry describes tagging,
  `--no-tag`, and the 20-file rule.

---

## Test plan

Unit tests run against real temp dirs. Integration and e2e tests create **real
git repositories**: `git init --initial-branch=main`, with a fixed
`user.email`, in the pattern of `tests/e2e/verify.e2e.test.ts:68-72`. Every
CLI-level test is an execa subprocess against the built CLI. Assertions read
`FILE_INDEX.md` back through `FileIndexManager.load` and the prompt from the
file the run wrote. They never compare against hand-written rows or prompt
lines.

| Requirement | Level | Test |
|---|---|---|
| REQ-IDX-19 | integration | `SessionBase.capture` on a repo with one commit, one modified and one untracked file: `commit` = `HEAD`, both paths listed with their `contentHash`; on a repo with no commits, `commit` absent; outside git, `null` |
| REQ-IDX-19 | unit | `session-state-manager.test.ts`: `session_base` round-trips; a state without it saves without the key; a 39-char commit fails the schema |
| REQ-IDX-20 | integration | 201 untracked files → `null` |
| REQ-IDX-21 | integration | Commit by the configured email after the base → touched; a commit by another email (`--author`), and a file arriving through a merge → not; `user.email` unset → no commit counted, reason `no-user-email` |
| REQ-IDX-21 | integration | A fast-forward from a second clone's commit (other author) → not touched. This is the `git pull` case |
| REQ-IDX-22 | integration | Staged, unstaged and untracked changes are touched; a new directory's files are reported one by one; a rename reports the new path; `a b.ts` comes back unquoted (and REQ-IDX-26 then drops it) |
| REQ-IDX-23 | integration | Modified at base and unchanged → not touched; modified at base and edited again → touched |
| REQ-IDX-24 | integration | No base; base commit removed by `reset --hard` + `reflog expire` + `gc --prune=now`; base not an ancestor after `checkout -b other <older>` → no tags, each with its reason |
| REQ-IDX-25..31 | unit | `TouchTagger.decide` over observations built by `TouchDetector.detect` from a temp repo: `.session/x`, `dist/a.js`, `CLAUDE.md`, `.gitignore`, a deleted file, `pnpm-lock.yaml`, a binary, a `linguist-generated` file, a whitespace-only edit, an edit-then-revert are each skipped under the right reason; 21 survivors → none tagged, `too-many` = 21; 20 → all tagged; all tasks done → `chunk-done` |
| REQ-IDX-26 | unit | `` a`b.ts ``, `a|b.ts`, `a b.ts` skipped as `unsafe-path` |
| REQ-IDX-32, -33 | unit | Touched `src/a.ts` → `[active]`; touched `src/b.ts` that chunk 5's `files` names → `[active, 5]`; named by a completed chunk or a done chunk → `[active]` only; a basename two walked files share → `[active]` only |
| REQ-IDX-34 | unit | `FileIndexManager.tag` on an existing entry keeps purpose, cost and other tags; a new entry gets `inferPurpose` |
| REQ-IDX-35 | integration | Copy `tests/fixtures/messy-file-index/FILE_INDEX.md` (verbatim, a live fixture) into a temp `.session/`; tag a new file to chunk 9 and an existing row's file to chunk 3.5; every original line is still present, in order; the two new rows sit inside their sections; `load` gives the union |
| REQ-IDX-36 | e2e | `init -y`; commit; edit `src/feature.ts` (named by no task); `update -y` → `FILE_INDEX.md` tags it to the active chunk and `NEXT_PROMPT.md`'s load line names it; `preview --format json` matches the file (REQ-RUN-19) |
| REQ-IDX-37 | e2e | Same run plus a lockfile edit: stripped stdout names `src/feature.ts` with its chunk and counts `lockfile: 1` |
| REQ-IDX-38 | — | Interactive; no TTY in e2e, so no automated test (as REQ-RUN-31). Covered by a manual check |
| REQ-IDX-39 | e2e | `update -y --no-tag` → `FILE_INDEX.md` bytes unchanged; base moved |
| REQ-IDX-40, REQ-DRY-7 | e2e | `--dry-run update -y` → stdout names the would-be tag; `FILE_INDEX.md` and `SESSION_STATE.md` bytes unchanged |
| REQ-IDX-41 | e2e | Edit a file, `advance -y` → `FILE_INDEX.md` bytes unchanged; `SESSION_STATE.md` has a new `session_base.commit` |
| REQ-IDX-24 | e2e | State from before this feature (no `session_base`): first `update -y` tags nothing and reports `no-base`; the second, after another edit, tags it |
| REQ-IDX-42 | unit | `PlanTags.fromPlan` on a plan with tasks and Key Files gives the entries `generate-index`'s `--yes` gave before the move. The existing REQ-RUN-1/-4 and REQ-IDX-17/-18 tests pass unchanged against it |
| REQ-IDX-42, -43 | unit | `generate-index.test.ts`: `yes: false` produces the same entries as `yes: true` and never calls `select` (mocked, as that file already does) |
| all | eval | `pnpm eval` stays green; DevNexus `--target` tag recall and prompt recall unchanged (touch tagging only runs in `update`) |

Each test must be seen to **fail first**. The exception is REQ-IDX-42's
equivalence test: it passes as soon as the move is done, because it is a lock
on the refactor. The plan is to record it under "What actually happened", as
LLD-file-index.md does for REQ-IDX-18.

---

## Out of scope

- **`last_worked_files` parsing** (Problem 4). The rename arrow, quoted paths
  and collapsed directories in `update.ts:343-356` are a real bug, and
  switching to `GitReader.statusEntries` would fix it. But it changes what the
  `Last touched:` line shows, and it is not tagging. Recommended as a follow-up
  `fix:`.
- **Reads.** A file the agent read but did not edit is not observable from the
  CLI. The context manifest records what the prompt *loaded*, and tagging that
  would be circular. MCP `read_file_layer` calls could be observed for MCP
  users only. Not attempted.
- **Decay within a chunk.** A file tagged in session 1 stays tagged for the
  rest of the chunk. The 20-file cap bounds what one session adds, and
  completion ends the effect (REQ-RUN-29). There is no untagging of files that
  went untouched.
- **Re-running plan tagging on `index`.** REQ-IDX-33 tags a plan-named file
  when it is touched. Re-matching every walked file on `index` would re-add
  rows people removed by hand. `LLD-new-files.md:91`'s claim is corrected in
  that document separately.
- **Touch tagging outside git.** Without a repository there is no base and
  nothing is tagged.
- **Measuring touch recall.** The share of touched files that the prompt had
  already loaded would be the honest measure of prompt recall on real work.
  It belongs in the eval harness, where an agent tier runs real sessions, not
  in this feature.
- **`init` re-runs.** Reinitializing rebuilds `FILE_INDEX.md` from the plan.
  Tags learned from touch are lost, as hand tags are today.
