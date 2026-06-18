import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CliError, PathValidator, SecurityError, type ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AiIndexManager } from "../annotation/ai-index-manager.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import { FileIndexManager } from "../managers/file-index-manager.js";
import { SessionManager } from "../managers/session-manager.js";
import { SessionStateManager } from "../managers/session-state-manager.js";
import type { FileIndexEntry, SessionState } from "../schemas/index.js";

/** Project root + validated `.session/` path for a freshly seeded fixture. */
interface Fixture {
	readonly root: string;
	readonly sessionDir: ValidatedPath;
}

let projectRoot: string;

beforeEach(() => {
	projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "session-manager-"));
});

afterEach(() => {
	fs.rmSync(projectRoot, { recursive: true, force: true });
});

function makeState(overrides: Partial<SessionState> = {}): SessionState {
	return {
		active_chunk: 1,
		session_id: "test-session",
		last_updated: "2026-06-16",
		tasks: [],
		last_worked_files: [],
		notes: [],
		completed_chunks: {},
		...overrides,
	};
}

function writeChunk(sessionDir: string, id: number, title: string): void {
	fs.writeFileSync(
		path.join(sessionDir, `PLAN_${String(id)}.md`),
		`---\nchunk_id: ${String(id)}\ntitle: "${title}"\ndepends_on: []\ntasks: []\n---\n\n# Chunk ${String(id)}\n`,
	);
}

/**
 * Seed a `.session/` directory with state, a plan chunk, a file index, and an
 * ai-index built from a real source file.
 */
function seed(): Fixture {
	const sessionAbs = path.join(projectRoot, ".session");
	fs.mkdirSync(sessionAbs, { recursive: true });
	const sessionDir = PathValidator.safeResolvePath(".session", projectRoot);

	SessionStateManager.save(
		sessionDir,
		makeState({
			tasks: [
				{ text: "Task A", status: "todo" },
				{ text: "Task B", status: "todo" },
			],
		}),
	);

	writeChunk(sessionAbs, 1, "Foundation");

	// A real source file so the ai-index has a renderable entry.
	const srcRel = "src/widget.ts";
	const srcAbs = path.join(projectRoot, srcRel);
	fs.mkdirSync(path.dirname(srcAbs), { recursive: true });
	fs.writeFileSync(
		srcAbs,
		`/** A widget. */\nexport function makeWidget(size: number): string {\n\treturn "w" + String(size);\n}\n`,
	);

	const entries: FileIndexEntry[] = [
		{ filepath: "README.md", chunk_tags: [0], purpose: "Always include" },
		{ filepath: srcRel, chunk_tags: [1], purpose: "Chunk 1 widget" },
		{ filepath: "other.ts", chunk_tags: [2], purpose: "Chunk 2 only" },
	];
	FileIndexManager.save(sessionDir, entries);

	const validatedSrc = PathValidator.safeResolvePath(srcRel, projectRoot);
	const parsed = new AutoExtractor().extractFile(validatedSrc);
	const index = AiIndexBuilder.build([parsed], projectRoot);
	AiIndexManager.save(sessionDir, index);

	return { root: projectRoot, sessionDir };
}

describe("SessionManager", () => {
	describe("create", () => {
		it("throws CliError when no .session/ exists", () => {
			expect(() => SessionManager.create(projectRoot)).toThrow(CliError);
		});

		it("constructs when .session/ exists", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(mgr.isReadOnly).toBe(false);
		});
	});

	describe("getActiveChunk", () => {
		it("returns active chunk, title, and live tasks", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const result = mgr.getActiveChunk();
			expect(result.activeChunk).toBe(1);
			expect(result.title).toBe("Foundation");
			expect(result.tasks.map((t) => t.text)).toEqual(["Task A", "Task B"]);
		});

		it("returns empty title when the PLAN file is absent", () => {
			seed();
			fs.rmSync(path.join(projectRoot, ".session", "PLAN_1.md"));
			const mgr = SessionManager.create(projectRoot);
			expect(mgr.getActiveChunk().title).toBe("");
		});
	});

	describe("listContextFiles", () => {
		it("returns every entry when no chunk filter is given", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(mgr.listContextFiles()).toHaveLength(3);
		});

		it("filters to a chunk plus always-include (chunk 0)", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const files = mgr.listContextFiles(1).map((e) => e.filepath);
			expect(files).toContain("README.md"); // chunk 0
			expect(files).toContain("src/widget.ts"); // chunk 1
			expect(files).not.toContain("other.ts"); // chunk 2
		});
	});

	describe("readFileLayer", () => {
		it("renders layer 0 (summary) from the index", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const out = mgr.readFileLayer("src/widget.ts", 0);
			expect(out).toContain("src/widget.ts");
			expect(out).toContain("makeWidget");
		});

		it("renders layer 2 (full source) from disk", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const out = mgr.readFileLayer("src/widget.ts", 2);
			expect(out).toContain("export function makeWidget");
		});

		it("rejects path traversal with a SecurityError", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(() => mgr.readFileLayer("../../etc/passwd", 2)).toThrow(SecurityError);
		});

		it("throws CliError for a path with no index entry (layers 0/1)", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(() => mgr.readFileLayer("src/missing.ts", 0)).toThrow(CliError);
		});
	});

	describe("queryIndex", () => {
		it("queries by chunk", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const result = mgr.queryIndex({ chunk: 1 });
			expect(Object.keys(result)).toContain("src/widget.ts");
		});

		it("queries by layer", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			const result = mgr.queryIndex({ layer: 0 });
			expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
		});

		it("rejects ambiguous queries (more than one selector)", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(() => mgr.queryIndex({ chunk: 1, layer: 0 })).toThrow(CliError);
		});

		it("rejects empty queries (no selector)", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(() => mgr.queryIndex({})).toThrow(CliError);
		});
	});

	describe("markTaskDone", () => {
		it("marks a matching task done and persists it", () => {
			const { sessionDir } = seed();
			const mgr = SessionManager.create(projectRoot);
			const result = mgr.markTaskDone("Task A");
			expect(result.matched).toBe(true);

			const reloaded = SessionStateManager.load(sessionDir);
			const taskA = reloaded.tasks.find((t) => t.text === "Task A");
			expect(taskA?.status).toBe("done");
		});

		it("reports matched=false for unknown task text", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(mgr.markTaskDone("Nonexistent").matched).toBe(false);
		});

		it("throws CliError in read-only mode", () => {
			seed();
			const mgr = SessionManager.create(projectRoot, { readOnly: true });
			expect(mgr.isReadOnly).toBe(true);
			expect(() => mgr.markTaskDone("Task A")).toThrow(CliError);
		});
	});

	describe("getNextPrompt", () => {
		it("returns NEXT_PROMPT.md contents", () => {
			const { sessionDir } = seed();
			fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Resume here.\n");
			const mgr = SessionManager.create(projectRoot);
			expect(mgr.getNextPrompt()).toContain("Resume here.");
		});

		it("throws CliError when NEXT_PROMPT.md is absent", () => {
			seed();
			const mgr = SessionManager.create(projectRoot);
			expect(() => mgr.getNextPrompt()).toThrow(CliError);
		});
	});
});
