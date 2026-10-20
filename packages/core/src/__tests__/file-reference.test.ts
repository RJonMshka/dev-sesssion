/**
 * Which files a task names (LLD-first-run.md, REQ-RUN-2, -3).
 */

import { describe, expect, it } from "vitest";
import { mentionsFile, referencedFiles } from "../calculators/file-reference.js";
import type { PlanChunk } from "../schemas/index.js";

const FU = "packages/core/src/formatters/formatter-utils.ts";

/** A chunk whose tasks are all todo. */
function chunk(chunkId: number, ...texts: string[]): PlanChunk {
	return {
		chunk_id: chunkId,
		title: `Chunk ${String(chunkId)}`,
		depends_on: [],
		tasks: texts.map((text) => ({ text, status: "todo" as const })),
	};
}

describe("mentionsFile", () => {
	it("matches the repository-relative path (REQ-RUN-2)", () => {
		expect(mentionsFile(`Refactor ${FU} to drop the alias`, FU)).toBe(true);
	});

	it("matches the basename as a whole token (REQ-RUN-2)", () => {
		expect(mentionsFile("Tidy formatter-utils.ts", FU)).toBe(true);
		expect(mentionsFile("Tidy `formatter-utils.ts`", FU)).toBe(true);
		expect(mentionsFile('Tidy "formatter-utils.ts"', FU)).toBe(true);
		expect(mentionsFile("(see formatter-utils.ts)", FU)).toBe(true);
		expect(mentionsFile("Tidy formatters/formatter-utils.ts", FU)).toBe(true);
	});

	it("matches a basename that ends a sentence (REQ-RUN-2)", () => {
		expect(mentionsFile("The prefix lives in formatter-utils.ts.", FU)).toBe(true);
		expect(mentionsFile("Is it in formatter-utils.ts?", FU)).toBe(true);
	});

	it("does not match a basename that is the tail of a longer name (REQ-RUN-2)", () => {
		expect(mentionsFile("Tidy formatter-utils.ts", "src/utils.ts")).toBe(false);
		expect(mentionsFile("Tidy my_utils.ts", "src/utils.ts")).toBe(false);
		expect(mentionsFile("Tidy .utils.ts", "src/utils.ts")).toBe(false);
	});

	it("does not match a basename followed by a further extension (REQ-RUN-2)", () => {
		expect(mentionsFile("Regenerate index.ts.map", "src/index.ts")).toBe(false);
		expect(mentionsFile("Rename utils.tsx", "src/utils.ts")).toBe(false);
		expect(mentionsFile("Rename utils.ts-old", "src/utils.ts")).toBe(false);
	});

	it("does not match a path that is a suffix of a longer path (REQ-RUN-2)", () => {
		expect(mentionsFile("Fix lib/src/a.ts", "src/a.ts")).toBe(true);
		expect(mentionsFile("Fix mysrc/a.ts", "src/a.ts")).toBe(false);
	});
});

describe("referencedFiles", () => {
	const files = [FU, "src/a/index.ts", "src/b/index.ts", "src/client.ts", "package.json"];

	it("maps each referenced file to every chunk that names it (REQ-RUN-2)", () => {
		const refs = referencedFiles(
			[chunk(1, "Fix client.ts", "Update formatter-utils.ts"), chunk(2, "Retry in client.ts")],
			files,
		);

		expect(refs.get("src/client.ts")).toEqual([1, 2]);
		expect(refs.get(FU)).toEqual([1]);
		expect(refs.has("package.json")).toBe(false);
	});

	it("tags no file for a basename two files share (REQ-RUN-3)", () => {
		const refs = referencedFiles([chunk(1, "Export the new type from index.ts")], files);

		expect(refs.has("src/a/index.ts")).toBe(false);
		expect(refs.has("src/b/index.ts")).toBe(false);
	});

	it("still tags a shared-basename file named by its path (REQ-RUN-3)", () => {
		const refs = referencedFiles([chunk(1, "Export the new type from src/a/index.ts")], files);

		expect(refs.get("src/a/index.ts")).toEqual([1]);
		expect(refs.has("src/b/index.ts")).toBe(false);
	});

	it("ignores done tasks (REQ-RUN-1)", () => {
		const done = chunk(1, "Fix client.ts");
		const tasks = done.tasks.map((t) => ({
			...t,
			status: "done" as const,
			completed_at: "2026-10-19T00:00:00Z",
		}));

		const refs = referencedFiles([{ ...done, tasks }], files);

		expect(refs.size).toBe(0);
	});
});
