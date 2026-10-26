/**
 * `FileIndexManager.tag` — adding chunk tags without rewriting the rest of an
 * entry (LLD-tagging.md, REQ-IDX-34).
 */

import { describe, expect, it } from "vitest";
import { inferPurpose } from "../calculators/plan-tags.js";
import { FileIndexManager } from "../managers/file-index-manager.js";
import type { FileIndexEntry } from "../schemas/index.js";

const ENTRIES: FileIndexEntry[] = [
	{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "Rules" },
	{ filepath: "src/a.ts", chunk_tags: [3], purpose: "Hand-written purpose", token_cost: 42 },
];

describe("FileIndexManager.tag (REQ-IDX-34)", () => {
	it("adds the chunks to an existing entry and keeps its purpose, cost and tags", () => {
		const out = FileIndexManager.tag(ENTRIES, "src/a.ts", [1, 5], inferPurpose("src/a.ts"));
		expect(out.find((e) => e.filepath === "src/a.ts")).toEqual({
			filepath: "src/a.ts",
			chunk_tags: [1, 3, 5],
			purpose: "Hand-written purpose",
			token_cost: 42,
		});
		expect(out[0]).toBe(ENTRIES[0]);
		expect(ENTRIES[1]?.chunk_tags).toEqual([3]);
	});

	it("adds a new entry with the given purpose", () => {
		const out = FileIndexManager.tag(ENTRIES, "src/new.ts", [2], inferPurpose("src/new.ts"));
		expect(out).toHaveLength(3);
		expect(out[2]).toEqual({ filepath: "src/new.ts", chunk_tags: [2], purpose: "new module" });
	});

	it("returns the same entries when the file already has every chunk", () => {
		const out = FileIndexManager.tag(ENTRIES, "src/a.ts", [3], "x");
		expect(out[1]).toBe(ENTRIES[1]);
	});
});
