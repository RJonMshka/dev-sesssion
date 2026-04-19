/**
 * Unit tests for AiIndexManager.
 *
 * Tests:
 * - renderLayer0: module summary + public symbol names
 * - renderLayer1: signatures (no implementation)
 * - queryByChunk: cross-references FILE_INDEX chunk tags
 * - queryByLayer: filters by layer_default
 * - queryByTag: filters by @ai-* tag
 * - stats: file/symbol/token counts
 */

import { describe, expect, it } from "vitest";
import { AiIndexManager } from "../annotation/ai-index-manager.js";
import type { AiIndex, FileEntry } from "../annotation/types.js";
import type { FileIndexEntry } from "../schemas/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = "/home/user/project";

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
	return {
		module_summary: "",
		layer_default: 1,
		token_cost: 100,
		token_cost_accurate: false,
		exports: {},
		...overrides,
	};
}

function makeIndex(files: Record<string, FileEntry>): AiIndex {
	return {
		version: "2",
		generated_at: "2026-04-14T00:00:00.000Z",
		project_root: PROJECT_ROOT,
		files,
	};
}

// ---------------------------------------------------------------------------
// renderLayer0
// ---------------------------------------------------------------------------

describe("AiIndexManager.renderLayer0", () => {
	it("renders module summary and public symbol names", () => {
		const entry = makeFileEntry({
			module_summary: "Core utilities",
			exports: {
				Alpha: {
					surface: "public",
					summary: "Alpha fn",
					signature: "function Alpha()",
					line: 1,
					tags: [],
				},
				Beta: {
					surface: "public",
					summary: "Beta fn",
					signature: "function Beta()",
					line: 10,
					tags: [],
				},
			},
		});

		const output = AiIndexManager.renderLayer0("src/utils.ts", entry);
		expect(output).toContain("src/utils.ts");
		expect(output).toContain("Core utilities");
		expect(output).toContain("Alpha");
		expect(output).toContain("Beta");
		// Should NOT include signatures
		expect(output).not.toContain("function Alpha()");
	});

	it("omits private symbols from Layer 0 output", () => {
		const entry = makeFileEntry({
			exports: {
				PublicFn: {
					surface: "public",
					summary: "",
					signature: "function PublicFn()",
					line: 1,
					tags: [],
				},
				_internal: {
					surface: "private",
					summary: "",
					signature: "function _internal()",
					line: 5,
					tags: [],
				},
			},
		});

		const output = AiIndexManager.renderLayer0("src/file.ts", entry);
		expect(output).toContain("PublicFn");
		expect(output).not.toContain("_internal");
	});

	it("renders without module summary when empty", () => {
		const entry = makeFileEntry({
			module_summary: "",
			exports: {
				Foo: { surface: "public", summary: "A foo", signature: "const Foo = 1", line: 1, tags: [] },
			},
		});

		const output = AiIndexManager.renderLayer0("src/foo.ts", entry);
		expect(output).toContain("Foo");
		// No empty summary line
		expect(output.split("\n").filter((l) => l.trim() === "")).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// renderLayer1
// ---------------------------------------------------------------------------

describe("AiIndexManager.renderLayer1", () => {
	it("includes signatures for public symbols", () => {
		const entry = makeFileEntry({
			module_summary: "API module",
			exports: {
				createFoo: {
					surface: "public",
					summary: "Creates a Foo",
					signature: "function createFoo(options: FooOptions): Foo",
					line: 1,
					tags: [],
				},
			},
		});

		const output = AiIndexManager.renderLayer1("src/api.ts", entry);
		expect(output).toContain("function createFoo(options: FooOptions): Foo");
		expect(output).toContain("Creates a Foo");
	});

	it("omits private symbols from Layer 1 output", () => {
		const entry = makeFileEntry({
			exports: {
				pub: { surface: "public", summary: "", signature: "function pub()", line: 1, tags: [] },
				priv: { surface: "private", summary: "", signature: "function priv()", line: 5, tags: [] },
			},
		});

		const output = AiIndexManager.renderLayer1("src/m.ts", entry);
		expect(output).toContain("pub");
		expect(output).not.toContain("priv");
	});
});

// ---------------------------------------------------------------------------
// queryByChunk
// ---------------------------------------------------------------------------

describe("AiIndexManager.queryByChunk", () => {
	it("returns file entries tagged to the given chunk", () => {
		const index = makeIndex({
			"src/a.ts": makeFileEntry({ token_cost: 50 }),
			"src/b.ts": makeFileEntry({ token_cost: 60 }),
			"src/c.ts": makeFileEntry({ token_cost: 70 }),
		});

		const fileIndex: FileIndexEntry[] = [
			{ filepath: "src/a.ts", chunk_tags: [13], purpose: "AutoExtractor" },
			{ filepath: "src/b.ts", chunk_tags: [14], purpose: "MCP server" },
			{ filepath: "src/c.ts", chunk_tags: [13, 14], purpose: "Shared" },
		];

		const result = AiIndexManager.queryByChunk(index, 13, fileIndex);
		expect(Object.keys(result)).toContain("src/a.ts");
		expect(Object.keys(result)).toContain("src/c.ts");
		expect(Object.keys(result)).not.toContain("src/b.ts");
	});

	it("returns empty object when no files are tagged to chunk", () => {
		const index = makeIndex({ "src/a.ts": makeFileEntry() });
		const fileIndex: FileIndexEntry[] = [
			{ filepath: "src/a.ts", chunk_tags: [99], purpose: "Other" },
		];

		const result = AiIndexManager.queryByChunk(index, 13, fileIndex);
		expect(Object.keys(result)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// queryByLayer
// ---------------------------------------------------------------------------

describe("AiIndexManager.queryByLayer", () => {
	it("filters by layer_default", () => {
		const index = makeIndex({
			"a.ts": makeFileEntry({ layer_default: 0 }),
			"b.ts": makeFileEntry({ layer_default: 1 }),
			"c.ts": makeFileEntry({ layer_default: 2 }),
		});

		const layer0 = AiIndexManager.queryByLayer(index, 0);
		expect(Object.keys(layer0)).toEqual(["a.ts"]);

		const layer1 = AiIndexManager.queryByLayer(index, 1);
		expect(Object.keys(layer1)).toEqual(["b.ts"]);
	});
});

// ---------------------------------------------------------------------------
// queryByTag
// ---------------------------------------------------------------------------

describe("AiIndexManager.queryByTag", () => {
	it("returns files containing a symbol with the given tag", () => {
		const index = makeIndex({
			"a.ts": makeFileEntry({
				exports: {
					Foo: {
						surface: "public",
						summary: "",
						signature: "",
						line: 1,
						tags: ["@ai-surface=private"],
					},
				},
			}),
			"b.ts": makeFileEntry({
				exports: {
					Bar: { surface: "public", summary: "", signature: "", line: 1, tags: [] },
				},
			}),
		});

		const result = AiIndexManager.queryByTag(index, "@ai-surface=private");
		expect(Object.keys(result)).toEqual(["a.ts"]);
	});
});

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

describe("AiIndexManager.stats", () => {
	it("counts files, public symbols, and total tokens", () => {
		const index = makeIndex({
			"a.ts": makeFileEntry({
				token_cost: 100,
				exports: {
					PubA: { surface: "public", summary: "", signature: "", line: 1, tags: [] },
					PrivA: { surface: "private", summary: "", signature: "", line: 2, tags: [] },
				},
			}),
			"b.ts": makeFileEntry({
				token_cost: 200,
				exports: {
					PubB: { surface: "public", summary: "", signature: "", line: 1, tags: [] },
				},
			}),
		});

		const { fileCount, symbolCount, totalTokenCost } = AiIndexManager.stats(index);
		expect(fileCount).toBe(2);
		expect(symbolCount).toBe(2); // only public symbols counted
		expect(totalTokenCost).toBe(300);
	});

	it("returns zeros for empty index", () => {
		const index = makeIndex({});
		const stats = AiIndexManager.stats(index);
		expect(stats.fileCount).toBe(0);
		expect(stats.symbolCount).toBe(0);
		expect(stats.totalTokenCost).toBe(0);
	});
});
