import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { ParseError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStateManager } from "../managers/session-state-manager.js";
import type { SessionState } from "../schemas/index.js";
import { TaskStatus } from "../schemas/index.js";

/** Creates a tmp directory for each test. */
function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

function writeState(dir: string, content: string): void {
	fs.writeFileSync(path.join(dir, "SESSION_STATE.md"), content, "utf-8");
}

const VALID_STATE = `---
active_chunk: 3
session_id: "chunk-3-core"
last_updated: "2026-03-29"
tasks:
  - text: "Build schemas"
    status: "done"
    completed_at: "2026-03-29T10:00:00.000Z"
  - text: "Build managers"
    status: "todo"
notes:
  - "Some note"
last_worked_files:
  - "packages/core/src/index.ts"
completed_chunks:
  "1": "2026-03-25"
  "2": "2026-03-28"
---

# Session State
`;

describe("SessionStateManager", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("load", () => {
		it("loads and validates a valid SESSION_STATE.md", () => {
			writeState(tmpDir, VALID_STATE);
			const state = SessionStateManager.load(tmpDir as ValidatedPath);

			expect(state.active_chunk).toBe(3);
			expect(state.session_id).toBe("chunk-3-core");
			expect(state.tasks).toHaveLength(2);
			expect(state.notes).toEqual(["Some note"]);
			expect(state.last_worked_files).toEqual(["packages/core/src/index.ts"]);
			expect(state.completed_chunks).toEqual({ "1": "2026-03-25", "2": "2026-03-28" });
		});

		it("throws ParseError if file is missing", () => {
			expect(() => SessionStateManager.load(tmpDir as ValidatedPath)).toThrow(ParseError);
		});

		it("throws ParseError if frontmatter is malformed", () => {
			writeState(tmpDir, "no frontmatter here");
			expect(() => SessionStateManager.load(tmpDir as ValidatedPath)).toThrow(ParseError);
		});

		it("throws ParseError if required fields are missing", () => {
			writeState(
				tmpDir,
				`---
active_chunk: 1
---
`,
			);
			expect(() => SessionStateManager.load(tmpDir as ValidatedPath)).toThrow(ParseError);
		});
	});

	describe("save", () => {
		it("writes state as YAML frontmatter + markdown body", () => {
			const state: SessionState = {
				active_chunk: 2,
				session_id: "test-session",
				last_updated: "2026-03-28",
				tasks: [{ text: "Task 1", status: "todo" }],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			SessionStateManager.save(tmpDir as ValidatedPath, state);

			const content = fs.readFileSync(path.join(tmpDir, "SESSION_STATE.md"), "utf-8");
			expect(content).toContain("active_chunk: 2");
			expect(content).toContain('session_id: "test-session"');
			expect(content).toContain("# Session State");
		});

		it("updates last_updated to today", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s1",
				last_updated: "2020-01-01",
				tasks: [],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			SessionStateManager.save(tmpDir as ValidatedPath, state);
			const content = fs.readFileSync(path.join(tmpDir, "SESSION_STATE.md"), "utf-8");
			const today = new Date().toISOString().slice(0, 10);
			expect(content).toContain(`last_updated: "${today}"`);
		});

		it("round-trips: save then load returns equivalent state", () => {
			const original: SessionState = {
				active_chunk: 5,
				session_id: "round-trip",
				last_updated: "2026-03-29",
				tasks: [
					{ text: "A", status: "done", completed_at: "2026-03-29T10:00:00.000Z" },
					{ text: "B", status: "in-progress" },
					{ text: "C", status: "todo" },
				],
				notes: ["note 1", "note 2"],
				last_worked_files: ["a.ts", "b.ts"],
				completed_chunks: { "1": "2026-03-25" },
			};

			SessionStateManager.save(tmpDir as ValidatedPath, original);
			const loaded = SessionStateManager.load(tmpDir as ValidatedPath);

			expect(loaded.active_chunk).toBe(original.active_chunk);
			expect(loaded.session_id).toBe(original.session_id);
			expect(loaded.tasks).toHaveLength(3);
			expect(loaded.notes).toEqual(original.notes);
			expect(loaded.last_worked_files).toEqual(original.last_worked_files);
		});
	});

	describe("markTaskDone", () => {
		it("marks matching task as done with timestamp", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-01-01",
				tasks: [{ text: "Build X", status: "todo" }],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			const updated = SessionStateManager.markTaskDone(state, "Build X");
			expect(updated.tasks[0]?.status).toBe(TaskStatus.DONE);
			expect(updated.tasks[0]?.completed_at).toBeDefined();
		});

		it("returns state unchanged if task not found (idempotent)", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-01-01",
				tasks: [{ text: "Build X", status: "todo" }],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			const updated = SessionStateManager.markTaskDone(state, "Nonexistent");
			expect(updated).toBe(state);
		});
	});

	describe("markTaskInProgress", () => {
		it("marks matching task as in-progress", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-01-01",
				tasks: [{ text: "Build X", status: "todo" }],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			const updated = SessionStateManager.markTaskInProgress(state, "Build X");
			expect(updated.tasks[0]?.status).toBe(TaskStatus.IN_PROGRESS);
		});
	});

	describe("addNote", () => {
		it("appends note to notes array", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-01-01",
				tasks: [],
				notes: ["existing"],
				last_worked_files: [],
				completed_chunks: {},
			};

			const updated = SessionStateManager.addNote(state, "new note");
			expect(updated.notes).toEqual(["existing", "new note"]);
		});
	});

	describe("updateLastWorked", () => {
		it("replaces last_worked_files", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-01-01",
				tasks: [],
				notes: [],
				last_worked_files: ["old.ts"],
				completed_chunks: {},
			};

			const updated = SessionStateManager.updateLastWorked(state, ["new.ts", "other.ts"]);
			expect(updated.last_worked_files).toEqual(["new.ts", "other.ts"]);
		});
	});

	describe("compact", () => {
		it("adds a completed chunks summary note", () => {
			const state: SessionState = {
				active_chunk: 4,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [{ text: "Task A", status: "todo" }],
				notes: [],
				last_worked_files: ["old.ts"],
				completed_chunks: { "1": "2026-03-25", "2": "2026-03-28", "3": "2026-03-30" },
			};

			const compacted = SessionStateManager.compact(state);
			expect(compacted.notes.some((n) => n.startsWith("Completed:"))).toBe(true);
			expect(compacted.notes[0]).toContain("Chunks 1-3");
			expect(compacted.notes[0]).toContain("DONE_LOG.md");
		});

		it("does not add duplicate summary if one already exists", () => {
			const state: SessionState = {
				active_chunk: 4,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [],
				notes: ["Completed: Chunks 1-3. See DONE_LOG.md for details."],
				last_worked_files: [],
				completed_chunks: { "1": "2026-03-25", "2": "2026-03-28", "3": "2026-03-30" },
			};

			const compacted = SessionStateManager.compact(state);
			const summaryNotes = compacted.notes.filter((n) => n.startsWith("Completed:"));
			expect(summaryNotes).toHaveLength(1);
		});

		it("handles non-consecutive completed chunks", () => {
			const state: SessionState = {
				active_chunk: 5,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [],
				notes: [],
				last_worked_files: [],
				completed_chunks: { "1": "2026-03-25", "3": "2026-03-30" },
			};

			const compacted = SessionStateManager.compact(state);
			expect(compacted.notes[0]).toContain("Chunks 1, 3");
		});

		it("handles single completed chunk", () => {
			const state: SessionState = {
				active_chunk: 2,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [],
				notes: [],
				last_worked_files: [],
				completed_chunks: { "1": "2026-03-25" },
			};

			const compacted = SessionStateManager.compact(state);
			expect(compacted.notes[0]).toContain("Chunks 1");
		});

		it("does not add summary when no chunks are completed", () => {
			const state: SessionState = {
				active_chunk: 1,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [],
				notes: [],
				last_worked_files: [],
				completed_chunks: {},
			};

			const compacted = SessionStateManager.compact(state);
			expect(compacted.notes).toHaveLength(0);
		});

		it("preserves existing notes after the summary", () => {
			const state: SessionState = {
				active_chunk: 4,
				session_id: "s",
				last_updated: "2026-03-30",
				tasks: [],
				notes: ["Existing note 1", "Existing note 2"],
				last_worked_files: [],
				completed_chunks: { "1": "2026-03-25", "2": "2026-03-28" },
			};

			const compacted = SessionStateManager.compact(state);
			expect(compacted.notes[0]).toContain("Completed:");
			expect(compacted.notes).toContain("Existing note 1");
			expect(compacted.notes).toContain("Existing note 2");
		});
	});
});
