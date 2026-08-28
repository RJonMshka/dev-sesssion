import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionStateManager } from "@dev-session/core";
import { PathValidator } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdvance } from "../commands/advance.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "advance-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Set up a valid .session/ with two chunks.
 * Chunk 1 tasks can be overridden for testing complete/incomplete states.
 */
function setupSession(overrides?: { chunk1Tasks?: Array<{ text: string; status: string }> }): void {
	const sessionDir = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });

	const tasks = overrides?.chunk1Tasks ?? [
		{ text: "Task A", status: "done" },
		{ text: "Task B", status: "done" },
	];

	const taskYaml = tasks.map((t) => `  - text: "${t.text}"\n    status: "${t.status}"`).join("\n");

	// SESSION_STATE.md
	fs.writeFileSync(
		path.join(sessionDir, "SESSION_STATE.md"),
		[
			"---",
			"active_chunk: 1",
			'session_id: "test-session"',
			'last_updated: "2026-04-03"',
			`tasks:\n${taskYaml}`,
			"last_worked_files: []",
			"notes: []",
			"completed_chunks: {}",
			"---",
			"",
			"# Session State",
		].join("\n"),
	);

	// PLAN_1.md (current chunk)
	fs.writeFileSync(
		path.join(sessionDir, "PLAN_1.md"),
		[
			"---",
			"chunk_id: 1",
			'title: "Foundation"',
			"depends_on: []",
			`tasks:\n${taskYaml}`,
			"---",
			"",
			"# Chunk 1 — Foundation",
		].join("\n"),
	);

	// PLAN_2.md (next chunk)
	fs.writeFileSync(
		path.join(sessionDir, "PLAN_2.md"),
		[
			"---",
			"chunk_id: 2",
			'title: "Core features"',
			"depends_on:",
			"  - 1",
			"tasks:",
			'  - text: "Build core module"',
			'    status: "todo"',
			'  - text: "Write core tests"',
			'    status: "todo"',
			"---",
			"",
			"# Chunk 2 — Core features",
		].join("\n"),
	);

	// FILE_INDEX.md
	fs.writeFileSync(
		path.join(sessionDir, "FILE_INDEX.md"),
		[
			"---",
			"version: 1",
			'last_updated: "2026-04-03"',
			"---",
			"",
			"# File Index",
			"",
			"## Always Include",
			"",
			"| File | Purpose |",
			"|---|---|",
			"| CLAUDE.md | AI instructions |",
			"",
			"## Chunk 1 — Foundation",
			"",
			"| File | Purpose |",
			"|---|---|",
			"| src/index.ts | Entry point |",
			"",
			"## Chunk 2 — Core features",
			"",
			"| File | Purpose |",
			"|---|---|",
			"| src/core.ts | Core module |",
		].join("\n"),
	);
}

describe("runAdvance", () => {
	it("advances when all tasks are done", async () => {
		setupSession();

		const result = await runAdvance({
			cwd: tmpDir,
			yes: false,
			verbose: false,
		});

		expect(result.archivedChunkId).toBe(1);
		expect(result.newChunkId).toBe(2);
		expect(result.newChunkTitle).toBe("Core features");
		expect(result.tasksRemaining).toBe(2);
		expect(result.forceAdvanced).toBe(false);

		// Verify SESSION_STATE.md was updated
		const stateContent = fs.readFileSync(
			path.join(tmpDir, ".session", "SESSION_STATE.md"),
			"utf-8",
		);
		expect(stateContent).toContain("active_chunk: 2");

		// Verify DONE_LOG.md was created
		const doneLogPath = path.join(tmpDir, ".session", "DONE_LOG.md");
		expect(fs.existsSync(doneLogPath)).toBe(true);
		const doneLog = fs.readFileSync(doneLogPath, "utf-8");
		expect(doneLog).toContain("Foundation");

		// Verify NEXT_PROMPT.md was regenerated for chunk 2
		const promptContent = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
		expect(promptContent.length).toBeGreaterThan(0);
	});

	it("force-advances with incomplete tasks in --yes mode", async () => {
		setupSession({
			chunk1Tasks: [
				{ text: "Task A", status: "done" },
				{ text: "Task B", status: "todo" },
			],
		});

		const result = await runAdvance({
			cwd: tmpDir,
			yes: true,
			verbose: false,
		});

		expect(result.forceAdvanced).toBe(true);
		expect(result.newChunkId).toBe(2);
	});

	it("warns about incomplete tasks in --yes force-advance", async () => {
		setupSession({
			chunk1Tasks: [
				{ text: "Task A", status: "done" },
				{ text: "Task B", status: "in-progress" },
				{ text: "Task C", status: "todo" },
			],
		});

		const result = await runAdvance({
			cwd: tmpDir,
			yes: true,
			verbose: true,
		});

		// Should force-advance and report incomplete state
		expect(result.forceAdvanced).toBe(true);
		expect(result.archivedChunkId).toBe(1);
		expect(result.newChunkId).toBe(2);
	});

	it("reports a clean terminal state (no throw) when no next chunk exists", async () => {
		setupSession();

		// Remove PLAN_2.md so there's no next chunk
		fs.unlinkSync(path.join(tmpDir, ".session", "PLAN_2.md"));

		const result = await runAdvance({
			cwd: tmpDir,
			yes: true,
			verbose: false,
		});

		// "All chunks complete" must not look like an error to scripts/CI: it
		// returns normally (exit 0) and leaves the active chunk untouched.
		expect(result.allChunksComplete).toBe(true);
		expect(result.newChunkId).toBe(1);
		expect(result.archivedChunkId).toBe(1);

		// State is not advanced past the last chunk.
		const state = SessionStateManager.load(PathValidator.safeResolvePath(".session", tmpDir));
		expect(state.active_chunk).toBe(1);
	});

	it("throws when no .session/ exists", async () => {
		await expect(runAdvance({ cwd: tmpDir, yes: true, verbose: false })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("shows verbose output during advance", async () => {
		setupSession();

		const result = await runAdvance({
			cwd: tmpDir,
			yes: false,
			verbose: true,
		});

		expect(result.newChunkId).toBe(2);
	});

	it("creates DONE_LOG.md with archived chunk details", async () => {
		setupSession();

		await runAdvance({
			cwd: tmpDir,
			yes: false,
			verbose: false,
		});

		const doneLogPath = path.join(tmpDir, ".session", "DONE_LOG.md");
		expect(fs.existsSync(doneLogPath)).toBe(true);

		const content = fs.readFileSync(doneLogPath, "utf-8");
		expect(content).toContain("Chunk 1");
		expect(content).toContain("Foundation");
	});

	// advance never read the global --dry-run flag either, and it is the more
	// destructive of the two: it archives the chunk to DONE_LOG.md and moves
	// active_chunk forward, neither of which the tool can undo.
	//
	// REQ-S0.4.4  Where dry-run is set, advance shall not modify SESSION_STATE.md.
	// REQ-S0.4.5  Where dry-run is set, advance shall not append to DONE_LOG.md.
	// REQ-S0.4.6  Where dry-run is set, advance shall not modify NEXT_PROMPT.md.
	describe("dry-run", () => {
		const DRY = { yes: true, verbose: false, dryRun: true } as const;

		function read(name: string): string {
			return fs.readFileSync(path.join(tmpDir, ".session", name), "utf-8");
		}

		it("leaves SESSION_STATE.md untouched (REQ-S0.4.4)", async () => {
			setupSession();
			const before = read("SESSION_STATE.md");

			await runAdvance({ cwd: tmpDir, ...DRY });

			expect(read("SESSION_STATE.md")).toBe(before);
		});

		it("does not archive to DONE_LOG.md (REQ-S0.4.5)", async () => {
			setupSession();

			await runAdvance({ cwd: tmpDir, ...DRY });

			expect(fs.existsSync(path.join(tmpDir, ".session", "DONE_LOG.md"))).toBe(false);
		});

		it("does not write NEXT_PROMPT.md (REQ-S0.4.6)", async () => {
			setupSession();

			await runAdvance({ cwd: tmpDir, ...DRY });

			expect(fs.existsSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"))).toBe(false);
		});

		it("still reports the chunk it would have advanced to", async () => {
			setupSession();

			const result = await runAdvance({ cwd: tmpDir, ...DRY });

			expect(result.archivedChunkId).toBe(1);
			expect(result.newChunkId).toBe(2);
		});
	});
});
