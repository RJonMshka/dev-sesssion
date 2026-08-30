import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileIndexManager } from "../managers/file-index-manager.js";
import type { FileIndexEntry } from "../schemas/index.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

function writeIndex(dir: string, content: string): void {
	fs.writeFileSync(path.join(dir, "FILE_INDEX.md"), content, "utf-8");
}

const VALID_INDEX = `---
version: 1
last_updated: "2026-03-29"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |
| docs/PLAN.md | Full project plan |

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| package.json | Root config |
| tsconfig.json | TS config |

## Chunk 2 — Security

| File | Purpose |
|---|---|
| packages/security/src/index.ts | Security exports |
`;

describe("FileIndexManager", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("load", () => {
		it("parses valid FILE_INDEX.md with always-include and chunk sections", () => {
			writeIndex(tmpDir, VALID_INDEX);
			const entries = FileIndexManager.load(tmpDir as ValidatedPath);

			expect(entries).toHaveLength(5);
			const always = entries.filter((e) => e.chunk_tags.includes(0));
			expect(always).toHaveLength(2);
			const chunk1 = entries.filter((e) => e.chunk_tags.includes(1));
			expect(chunk1).toHaveLength(2);
			const chunk2 = entries.filter((e) => e.chunk_tags.includes(2));
			expect(chunk2).toHaveLength(1);
		});

		it("throws ParseError if file is missing", () => {
			expect(() => FileIndexManager.load(tmpDir as ValidatedPath)).toThrow(ParseError);
		});

		it("parses filepaths and purposes correctly", () => {
			writeIndex(tmpDir, VALID_INDEX);
			const entries = FileIndexManager.load(tmpDir as ValidatedPath);
			const claude = entries.find((e) => e.filepath === "CLAUDE.md");
			expect(claude).toBeDefined();
			expect(claude?.purpose).toBe("AI session instructions");
		});
	});

	// A heading the parser cannot map to a chunk tag must END the current section.
	// Previously `currentChunkTag` was left untouched, so every row under an
	// unrecognized heading was silently attributed to the PRECEDING chunk —
	// mis-filing, which is strictly worse than dropping the row, because the load
	// list is capped and a wrong entry evicts a real file.
	//
	// REQ-IDX-1  When a section heading names no chunk the index can represent,
	//            the parser shall end the current section.
	// REQ-IDX-2  The parser shall tag rows under a fractional heading to that
	//            fractional chunk.
	// REQ-IDX-3  If a row falls under no mappable section, then the parser shall
	//            drop it rather than attribute it to the preceding chunk.
	describe("load — section attribution", () => {
		it("tags rows under a fractional heading to the fractional chunk, not its floor (REQ-IDX-2)", () => {
			writeIndex(
				tmpDir,
				`# File Index

## Chunk 3 — Core

| File | Purpose |
|---|---|
| core.ts | Core |

## Chunk 3.5 — Token counting

| File | Purpose |
|---|---|
| counter.ts | Counter |
`,
			);

			const entries = FileIndexManager.load(tmpDir as ValidatedPath);
			const counter = entries.find((e) => e.filepath === "counter.ts");

			expect(counter?.chunk_tags).toEqual([3.5]);
			expect(counter?.chunk_tags).not.toContain(3);
		});

		it("drops rows under a chunk heading whose id cannot be mapped to a tag (REQ-IDX-1)", () => {
			writeIndex(
				tmpDir,
				`# File Index

## Chunk 12 — Annotation schema

| File | Purpose |
|---|---|
| annotate.ts | Annotations |

## Chunk 13A — Auto-extract ai-index

| File | Purpose |
|---|---|
| extract.ts | Extractor |
`,
			);

			const entries = FileIndexManager.load(tmpDir as ValidatedPath);

			expect(entries.find((e) => e.filepath === "extract.ts")).toBeUndefined();
			expect(entries.find((e) => e.filepath === "annotate.ts")?.chunk_tags).toEqual([12]);
		});

		it("drops rows under a non-chunk heading instead of bleeding them into the previous chunk (REQ-IDX-3)", () => {
			writeIndex(
				tmpDir,
				`# File Index

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| real.ts | Real entry |

## Design notes

| File | Purpose |
|---|---|
| stray.ts | Not a chunk file |
`,
			);

			const entries = FileIndexManager.load(tmpDir as ValidatedPath);

			expect(entries.find((e) => e.filepath === "stray.ts")).toBeUndefined();
			expect(entries.find((e) => e.filepath === "real.ts")?.chunk_tags).toEqual([1]);
		});
	});

	describe("save", () => {
		it("writes entries as markdown table format", () => {
			const entries: FileIndexEntry[] = [
				{ filepath: "a.ts", chunk_tags: [0], purpose: "Always" },
				{ filepath: "b.ts", chunk_tags: [1], purpose: "Foundation" },
			];

			FileIndexManager.save(tmpDir as ValidatedPath, entries);
			const content = fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");

			expect(content).toContain("## Always Include");
			expect(content).toContain("| a.ts | Always |");
			expect(content).toContain("## Chunk 1");
			expect(content).toContain("| b.ts | Foundation |");
		});

		it("round-trips: save then load returns equivalent entries", () => {
			const original: FileIndexEntry[] = [
				{ filepath: "x.ts", chunk_tags: [0], purpose: "Always" },
				{ filepath: "y.ts", chunk_tags: [2], purpose: "Security" },
				{ filepath: "z.ts", chunk_tags: [3], purpose: "Core" },
			];

			FileIndexManager.save(tmpDir as ValidatedPath, original);
			const loaded = FileIndexManager.load(tmpDir as ValidatedPath);

			expect(loaded).toHaveLength(3);
			expect(loaded.map((e) => e.filepath).sort()).toEqual(["x.ts", "y.ts", "z.ts"]);
		});
	});

	// FILE_INDEX.md is hand-edited in practice — this repo's own index carries
	// section titles, a deliberate non-numeric section order, and ~35KB of design
	// prose between tables. `save()` used to emit only `| path | purpose |` rows
	// in ascending tag order, so a single `dev-sesssion update` destroyed all of it.
	//
	// REQ-IDX-4  Where a FILE_INDEX.md exists, save shall preserve each section's heading text.
	// REQ-IDX-5  Where a FILE_INDEX.md exists, save shall preserve the existing section order.
	// REQ-IDX-6  Where a FILE_INDEX.md exists, save shall preserve non-table prose.
	// REQ-IDX-7  Where a section's chunk id maps to no tag, save shall emit that section verbatim.
	// REQ-IDX-8  If an entry carries a tag with no existing section, save shall append a new section.
	// REQ-IDX-9  Where no FILE_INDEX.md exists, save shall emit the canonical ascending format.
	describe("save — layout preservation", () => {
		const HAND_EDITED = `---
version: 1
last_updated: "2026-06-16"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI session instructions |

## Chunk 2 — Security utilities

| File | Purpose |
|---|---|
| sec.ts | Security exports |

**Design note:** the prefixes have ONE source of truth in formatter-utils.ts.

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| package.json | Root config |

## Chunk 13A — Auto-extract ai-index [COMPLETE]

| File | Purpose |
|---|---|
| extract.ts | Extractor |
`;

		function saveOver(entries: FileIndexEntry[]): string {
			writeIndex(tmpDir, HAND_EDITED);
			FileIndexManager.save(tmpDir as ValidatedPath, entries);
			return fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");
		}

		const EXISTING: FileIndexEntry[] = [
			{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI session instructions" },
			{ filepath: "sec.ts", chunk_tags: [2], purpose: "Security exports" },
			{ filepath: "package.json", chunk_tags: [1], purpose: "Root config" },
		];

		it("preserves section heading titles (REQ-IDX-4)", () => {
			const content = saveOver(EXISTING);

			expect(content).toContain("## Chunk 2 — Security utilities");
			expect(content).toContain("## Chunk 1 — Foundation");
		});

		it("preserves the existing section order (REQ-IDX-5)", () => {
			const content = saveOver(EXISTING);

			expect(content.indexOf("## Chunk 2")).toBeLessThan(content.indexOf("## Chunk 1"));
		});

		it("preserves prose between tables (REQ-IDX-6)", () => {
			const content = saveOver(EXISTING);

			expect(content).toContain(
				"**Design note:** the prefixes have ONE source of truth in formatter-utils.ts.",
			);
		});

		it("preserves a section whose chunk id maps to no tag (REQ-IDX-7)", () => {
			const content = saveOver(EXISTING);

			expect(content).toContain("## Chunk 13A — Auto-extract ai-index [COMPLETE]");
			expect(content).toContain("| extract.ts | Extractor |");
		});

		it("appends a section for a tag the existing layout does not have (REQ-IDX-8)", () => {
			const content = saveOver([
				...EXISTING,
				{ filepath: "new.ts", chunk_tags: [7], purpose: "Brand new" },
			]);

			expect(content).toContain("## Chunk 7");
			expect(content).toContain("| new.ts | Brand new |");
		});

		it("drops an entry that is no longer present from its section", () => {
			const content = saveOver([
				{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI session instructions" },
				{ filepath: "package.json", chunk_tags: [1], purpose: "Root config" },
			]);

			expect(content).not.toContain("| sec.ts |");
			// The section heading and its prose survive even when emptied.
			expect(content).toContain("## Chunk 2 — Security utilities");
		});

		it("emits the canonical ascending format when no index exists (REQ-IDX-9)", () => {
			FileIndexManager.save(tmpDir as ValidatedPath, [
				{ filepath: "b.ts", chunk_tags: [2], purpose: "Two" },
				{ filepath: "a.ts", chunk_tags: [1], purpose: "One" },
			]);
			const content = fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");

			expect(content.indexOf("## Chunk 1")).toBeLessThan(content.indexOf("## Chunk 2"));
		});

		// A file may appear in several sections with a DIFFERENT purpose in each
		// ("CLI build config" in chunk 1, "Updated: noExternal bundles …" in chunk 9).
		// FileIndexEntry.purpose is a single string, so load() collapses them to the
		// first-seen value. Writing that value back into every section destroyed the
		// others — 64 rows of hand-written history in this repo's own index.
		//
		// REQ-IDX-10  Where an entry's purpose is unchanged, save shall keep each section's own purpose.
		// REQ-IDX-11  If a caller changes an entry's purpose, save shall write the new purpose.
		const MULTI_SECTION = `---
version: 1
last_updated: "2026-06-16"
---

# File Index

## Chunk 1 — Foundation

| File | Purpose |
|---|---|
| tsup.config.ts | Build config |

## Chunk 9 — Polish

| File | Purpose |
|---|---|
| tsup.config.ts | Updated: noExternal bundles workspace deps |
`;

		it("keeps each section's own purpose when the caller changed nothing (REQ-IDX-10)", () => {
			writeIndex(tmpDir, MULTI_SECTION);
			const loaded = FileIndexManager.load(tmpDir as ValidatedPath);
			FileIndexManager.save(tmpDir as ValidatedPath, loaded);
			const after = fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");

			expect(after).toContain("| tsup.config.ts | Build config |");
			expect(after).toContain("| tsup.config.ts | Updated: noExternal bundles workspace deps |");
		});

		it("writes the new purpose into every section when the caller changed it (REQ-IDX-11)", () => {
			writeIndex(tmpDir, MULTI_SECTION);
			const loaded = FileIndexManager.load(tmpDir as ValidatedPath);
			const edited = loaded.map((e) =>
				e.filepath === "tsup.config.ts" ? { ...e, purpose: "Bundler config" } : e,
			);
			FileIndexManager.save(tmpDir as ValidatedPath, edited);
			const after = fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");

			expect(after.match(/\| tsup\.config\.ts \| Bundler config \|/g)).toHaveLength(2);
			expect(after).not.toContain("Updated: noExternal");
		});

		it("round-trips the full hand-edited document without losing content", () => {
			writeIndex(tmpDir, HAND_EDITED);
			const loaded = FileIndexManager.load(tmpDir as ValidatedPath);
			FileIndexManager.save(tmpDir as ValidatedPath, loaded);
			const after = fs.readFileSync(path.join(tmpDir, "FILE_INDEX.md"), "utf-8");

			for (const fragment of [
				"## Chunk 2 — Security utilities",
				"## Chunk 1 — Foundation",
				"## Chunk 13A — Auto-extract ai-index [COMPLETE]",
				"**Design note:**",
				"| sec.ts | Security exports |",
				"| extract.ts | Extractor |",
			]) {
				expect(after).toContain(fragment);
			}
		});
	});

	describe("queryByChunk", () => {
		it("returns entries matching the chunk ID", () => {
			const entries: FileIndexEntry[] = [
				{ filepath: "a.ts", chunk_tags: [1, 2], purpose: "p" },
				{ filepath: "b.ts", chunk_tags: [2], purpose: "p" },
				{ filepath: "c.ts", chunk_tags: [3], purpose: "p" },
			];

			const result = FileIndexManager.queryByChunk(entries, 2);
			expect(result).toHaveLength(2);
			expect(result.map((e) => e.filepath).sort()).toEqual(["a.ts", "b.ts"]);
		});

		it("returns empty array for nonexistent chunk", () => {
			const result = FileIndexManager.queryByChunk([], 99);
			expect(result).toEqual([]);
		});
	});

	describe("alwaysInclude", () => {
		it("returns entries with chunk_tag 0", () => {
			const entries: FileIndexEntry[] = [
				{ filepath: "a.ts", chunk_tags: [0], purpose: "p" },
				{ filepath: "b.ts", chunk_tags: [1], purpose: "p" },
				{ filepath: "c.ts", chunk_tags: [0, 1], purpose: "p" },
			];

			const result = FileIndexManager.alwaysInclude(entries);
			expect(result).toHaveLength(2);
		});
	});

	describe("add", () => {
		it("adds a new entry", () => {
			const entries: FileIndexEntry[] = [{ filepath: "a.ts", chunk_tags: [1], purpose: "p" }];
			const result = FileIndexManager.add(entries, {
				filepath: "b.ts",
				chunk_tags: [2],
				purpose: "new",
			});
			expect(result).toHaveLength(2);
		});

		it("merges chunk_tags for duplicate filepath", () => {
			const entries: FileIndexEntry[] = [{ filepath: "a.ts", chunk_tags: [1], purpose: "old" }];
			const result = FileIndexManager.add(entries, {
				filepath: "a.ts",
				chunk_tags: [2, 3],
				purpose: "updated",
			});
			expect(result).toHaveLength(1);
			expect(result[0]?.chunk_tags).toEqual([1, 2, 3]);
			expect(result[0]?.purpose).toBe("updated");
		});
	});

	describe("audit", () => {
		it("detects stale entries (files not on disk)", () => {
			writeIndex(tmpDir, VALID_INDEX);
			const entries = FileIndexManager.load(tmpDir as ValidatedPath);

			const result = FileIndexManager.audit(entries, tmpDir as ValidatedPath);
			// All files referenced in VALID_INDEX won't exist on disk
			expect(result.stale.length).toBeGreaterThan(0);
		});

		it("detects missing chunk PLAN files", () => {
			const entries: FileIndexEntry[] = [{ filepath: "a.ts", chunk_tags: [5], purpose: "p" }];

			const result = FileIndexManager.audit(entries, tmpDir as ValidatedPath);
			expect(result.missingChunks).toContain(5);
		});

		it("reports healthy when no issues", () => {
			// Write a PLAN_1.md and a file that exists
			fs.writeFileSync(path.join(tmpDir, "PLAN_1.md"), "---\nchunk_id: 1\ntitle: test\n---\n");
			const testFile = path.join(path.dirname(tmpDir), "test.txt");
			fs.writeFileSync(testFile, "test");

			const entries: FileIndexEntry[] = [
				{
					filepath: path.relative(path.dirname(tmpDir), testFile),
					chunk_tags: [1],
					purpose: "test",
				},
			];

			const result = FileIndexManager.audit(entries, tmpDir as ValidatedPath);
			expect(result.missingChunks).toEqual([]);
			expect(result.stale).toEqual([]);
			expect(result.healthy).toBe(true);

			fs.unlinkSync(testFile);
		});
	});
});
