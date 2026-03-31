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
