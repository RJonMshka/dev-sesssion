import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanChunkManager } from "../managers/plan-chunk-manager.js";
import type { PlanChunk, SessionState } from "../schemas/index.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

function writeChunk(dir: string, id: number, title: string, tasks: string[] = []): void {
	const taskYaml =
		tasks.length > 0
			? `tasks:\n${tasks.map((t) => `  - text: "${t}"\n    status: "todo"`).join("\n")}`
			: "tasks: []";

	fs.writeFileSync(
		path.join(dir, `PLAN_${id}.md`),
		`---
chunk_id: ${id}
title: "${title}"
depends_on: []
${taskYaml}
---

# Chunk ${id} — ${title}
`,
	);
}

function makeState(activeChunk: number): SessionState {
	return {
		active_chunk: activeChunk,
		session_id: "test",
		last_updated: "2026-01-01",
		tasks: [],
		notes: [],
		last_worked_files: [],
		completed_chunks: {},
	};
}

describe("PlanChunkManager", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("loadAll", () => {
		it("loads and sorts all PLAN_N.md files by chunk_id", () => {
			writeChunk(tmpDir, 3, "Core");
			writeChunk(tmpDir, 1, "Foundation");
			writeChunk(tmpDir, 2, "Security");

			const chunks = PlanChunkManager.loadAll(tmpDir as ValidatedPath);

			expect(chunks).toHaveLength(3);
			expect(chunks[0]?.chunk_id).toBe(1);
			expect(chunks[1]?.chunk_id).toBe(2);
			expect(chunks[2]?.chunk_id).toBe(3);
		});

		it("returns empty array if no chunk files exist", () => {
			const chunks = PlanChunkManager.loadAll(tmpDir as ValidatedPath);
			expect(chunks).toEqual([]);
		});

		it("parses tasks from frontmatter", () => {
			writeChunk(tmpDir, 1, "Foundation", ["Build schemas", "Build managers"]);
			const chunks = PlanChunkManager.loadAll(tmpDir as ValidatedPath);

			expect(chunks[0]?.tasks).toHaveLength(2);
			expect(chunks[0]?.tasks[0]?.text).toBe("Build schemas");
		});
	});

	describe("loadActive", () => {
		it("loads the chunk matching state.active_chunk", () => {
			writeChunk(tmpDir, 1, "Foundation");
			writeChunk(tmpDir, 2, "Security");

			const chunk = PlanChunkManager.loadActive(tmpDir as ValidatedPath, makeState(2));
			expect(chunk.chunk_id).toBe(2);
			expect(chunk.title).toBe("Security");
		});

		it("throws ParseError if active chunk file is missing", () => {
			writeChunk(tmpDir, 1, "Foundation");

			expect(() => PlanChunkManager.loadActive(tmpDir as ValidatedPath, makeState(99))).toThrow(
				ParseError,
			);
		});
	});

	describe("advance", () => {
		it("increments active_chunk by 1", () => {
			const state = makeState(2);
			const advanced = PlanChunkManager.advance(state);
			expect(advanced.active_chunk).toBe(3);
		});

		it("adds current chunk to completed_chunks", () => {
			const state = makeState(2);
			const advanced = PlanChunkManager.advance(state);
			expect(advanced.completed_chunks["2"]).toBeDefined();
		});

		it("preserves existing completed_chunks", () => {
			const state: SessionState = {
				...makeState(3),
				completed_chunks: { "1": "2026-03-01", "2": "2026-03-15" },
			};
			const advanced = PlanChunkManager.advance(state);
			expect(advanced.completed_chunks["1"]).toBe("2026-03-01");
			expect(advanced.completed_chunks["2"]).toBe("2026-03-15");
			expect(advanced.completed_chunks["3"]).toBeDefined();
		});
	});

	describe("isComplete", () => {
		it("returns true when all tasks are done", () => {
			const chunk: PlanChunk = {
				chunk_id: 1,
				title: "Test",
				depends_on: [],
				tasks: [
					{ text: "A", status: "done", completed_at: "2026-01-01T00:00:00.000Z" },
					{ text: "B", status: "done", completed_at: "2026-01-01T00:00:00.000Z" },
				],
			};
			expect(PlanChunkManager.isComplete(chunk)).toBe(true);
		});

		it("returns true when tasks array is empty", () => {
			const chunk: PlanChunk = { chunk_id: 1, title: "Test", depends_on: [], tasks: [] };
			expect(PlanChunkManager.isComplete(chunk)).toBe(true);
		});

		it("returns false when any task is not done", () => {
			const chunk: PlanChunk = {
				chunk_id: 1,
				title: "Test",
				depends_on: [],
				tasks: [
					{ text: "A", status: "done" },
					{ text: "B", status: "todo" },
				],
			};
			expect(PlanChunkManager.isComplete(chunk)).toBe(false);
		});
	});

	describe("archive", () => {
		it("creates DONE_LOG.md with chunk summary", () => {
			const chunk: PlanChunk = {
				chunk_id: 1,
				title: "Foundation",
				depends_on: [],
				tasks: [{ text: "A", status: "done" }],
			};

			PlanChunkManager.archive(tmpDir as ValidatedPath, chunk);

			const content = fs.readFileSync(path.join(tmpDir, "DONE_LOG.md"), "utf-8");
			expect(content).toContain("## Chunk 1 — Foundation");
			expect(content).toContain("Tasks: 1");
		});

		it("appends to existing DONE_LOG.md", () => {
			fs.writeFileSync(path.join(tmpDir, "DONE_LOG.md"), "# Done Log\n\n");

			const chunk: PlanChunk = {
				chunk_id: 2,
				title: "Security",
				depends_on: [1],
				tasks: [],
			};

			PlanChunkManager.archive(tmpDir as ValidatedPath, chunk);

			const content = fs.readFileSync(path.join(tmpDir, "DONE_LOG.md"), "utf-8");
			expect(content).toContain("# Done Log");
			expect(content).toContain("## Chunk 2 — Security");
		});
	});
});
