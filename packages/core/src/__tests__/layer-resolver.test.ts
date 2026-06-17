import { describe, expect, it } from "vitest";
import type { AiIndex, FileEntry } from "../annotation/types.js";
import { LayerResolver } from "../calculators/layer-resolver.js";
import type { FileIndexEntry, Task } from "../schemas/index.js";

function makeEntry(filepath: string, chunkTags: number[], tokenCost?: number): FileIndexEntry {
	return {
		filepath,
		chunk_tags: chunkTags,
		purpose: `purpose of ${filepath}`,
		...(tokenCost !== undefined ? { token_cost: tokenCost } : {}),
	};
}

function makeFileEntry(overrides?: Partial<FileEntry>): FileEntry {
	return {
		module_summary: "A module.",
		layer_default: 0,
		token_cost: 1000,
		token_cost_accurate: false,
		exports: {
			doThing: {
				surface: "public",
				summary: "Does a thing.",
				signature: "export function doThing(): void",
				line: 1,
				tags: [],
			},
		},
		...overrides,
	};
}

function makeIndex(files: Record<string, FileEntry>): AiIndex {
	return {
		version: "2",
		generated_at: "2026-06-17T00:00:00Z",
		project_root: "/project",
		files,
	};
}

const NO_TASKS: readonly Task[] = [];

describe("LayerResolver.resolve", () => {
	it("defaults chunk-tagged files to layer 0 and always-include to layer 1", () => {
		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4])],
			alwaysIncludeFiles: [makeEntry("CLAUDE.md", [0])],
			tasks: NO_TASKS,
			index: null,
		});

		const a = resolved.find((r) => r.filepath === "src/a.ts");
		const claude = resolved.find((r) => r.filepath === "CLAUDE.md");

		expect(a?.role).toBe("chunk");
		expect(a?.baseLayer).toBe(0);
		expect(a?.layer).toBe(0);
		expect(claude?.role).toBe("always-include");
		expect(claude?.baseLayer).toBe(1);
		expect(claude?.layer).toBe(1);
	});

	it("lets @ai-layer-default raise the floor but never lower it", () => {
		const index = makeIndex({
			"src/raised.ts": makeFileEntry({ layer_default: 1 }),
			"src/low.ts": makeFileEntry({ layer_default: 0 }),
			"CLAUDE.md": makeFileEntry({ layer_default: 0 }),
		});

		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/raised.ts", [4]), makeEntry("src/low.ts", [4])],
			alwaysIncludeFiles: [makeEntry("CLAUDE.md", [0])],
			tasks: NO_TASKS,
			index,
		});

		// chunk base 0, annotation 1 -> 1 (raised)
		expect(resolved.find((r) => r.filepath === "src/raised.ts")?.baseLayer).toBe(1);
		// chunk base 0, annotation 0 -> 0
		expect(resolved.find((r) => r.filepath === "src/low.ts")?.baseLayer).toBe(0);
		// always-include base 1, annotation 0 -> 1 (not lowered)
		expect(resolved.find((r) => r.filepath === "CLAUDE.md")?.baseLayer).toBe(1);
	});

	it("escalates a file referenced by an active task to layer 2", () => {
		const tasks: Task[] = [
			{ text: "Refactor src/a.ts to use the new API", status: "in-progress" },
			{ text: "Unrelated todo", status: "todo" },
		];

		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4]), makeEntry("src/b.ts", [4])],
			alwaysIncludeFiles: [],
			tasks,
			index: null,
		});

		const a = resolved.find((r) => r.filepath === "src/a.ts");
		const b = resolved.find((r) => r.filepath === "src/b.ts");

		expect(a?.escalated).toBe(true);
		expect(a?.layer).toBe(2);
		expect(a?.escalatedBy).toBe("Refactor src/a.ts to use the new API");
		expect(b?.escalated).toBe(false);
		expect(b?.layer).toBe(0);
	});

	it("matches a task referencing a file by basename only", () => {
		const tasks: Task[] = [{ text: "Fix the bug in layer-resolver.ts", status: "todo" }];

		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("packages/core/src/calculators/layer-resolver.ts", [4])],
			alwaysIncludeFiles: [],
			tasks,
			index: null,
		});

		expect(resolved[0]?.escalated).toBe(true);
		expect(resolved[0]?.layer).toBe(2);
	});

	it("does not escalate for a done task that references the file", () => {
		const tasks: Task[] = [
			{ text: "Refactor src/a.ts", status: "done", completed_at: "2026-06-17T00:00:00Z" },
		];

		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4])],
			alwaysIncludeFiles: [],
			tasks,
			index: null,
		});

		expect(resolved[0]?.escalated).toBe(false);
		expect(resolved[0]?.layer).toBe(0);
	});

	it("uses the full token cost at layer 2 and a smaller layered cost otherwise", () => {
		const index = makeIndex({ "src/a.ts": makeFileEntry({ token_cost: 5000 }) });
		const tasks: Task[] = [{ text: "work on src/a.ts", status: "in-progress" }];

		const escalated = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4])],
			alwaysIncludeFiles: [],
			tasks,
			index,
		})[0];

		const notEscalated = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4])],
			alwaysIncludeFiles: [],
			tasks: NO_TASKS,
			index,
		})[0];

		expect(escalated?.layer).toBe(2);
		expect(escalated?.layeredTokenCost).toBe(5000);
		expect(escalated?.fullTokenCost).toBe(5000);

		expect(notEscalated?.layer).toBe(0);
		expect(notEscalated?.layeredTokenCost).toBeGreaterThan(0);
		expect(notEscalated?.layeredTokenCost).toBeLessThan(5000);
		expect(notEscalated?.fullTokenCost).toBe(5000);
	});

	it("resolves a file present in both lists only once, as always-include", () => {
		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("CLAUDE.md", [0, 4])],
			alwaysIncludeFiles: [makeEntry("CLAUDE.md", [0, 4])],
			tasks: NO_TASKS,
			index: null,
		});

		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.role).toBe("always-include");
	});

	it("falls back to the entry token cost when no ai-index entry exists", () => {
		const resolved = LayerResolver.resolve({
			chunkFiles: [makeEntry("src/a.ts", [4], 777)],
			alwaysIncludeFiles: [],
			tasks: NO_TASKS,
			index: null,
		});

		expect(resolved[0]?.fullTokenCost).toBe(777);
		expect(resolved[0]?.layeredTokenCost).toBe(777);
	});
});
