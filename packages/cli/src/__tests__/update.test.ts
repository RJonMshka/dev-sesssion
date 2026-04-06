import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGitModifiedFiles, runUpdate } from "../commands/update.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Set up a valid .session/ directory with SESSION_STATE.md,
 * PLAN_1.md, FILE_INDEX.md, and NEXT_PROMPT.md.
 */
function setupSession(overrides?: { tasks?: Array<{ text: string; status: string }> }): void {
	const sessionDir = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });

	const tasks = overrides?.tasks ?? [
		{ text: "Task A", status: "done" },
		{ text: "Task B", status: "todo" },
		{ text: "Task C", status: "in-progress" },
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

	// PLAN_1.md
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
			"# Chunk 1",
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
		].join("\n"),
	);

	// NEXT_PROMPT.md (existing — will be regenerated)
	fs.writeFileSync(
		path.join(sessionDir, "NEXT_PROMPT.md"),
		"Project: test\nActive chunk: 1 — Foundation\nLoad: src/index.ts\nResume: Starting.\nNext:\n  [ ] Task B\n",
	);
}

describe("getGitModifiedFiles", () => {
	it("returns empty array when not a git repo", async () => {
		const files = await getGitModifiedFiles(tmpDir);
		expect(files).toEqual([]);
	});

	it("returns modified files from a git repo", async () => {
		// Init a real git repo
		const { execFileSync } = await import("node:child_process");
		execFileSync("git", ["init"], { cwd: tmpDir });
		execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });

		// Create and commit a file, then modify it
		fs.writeFileSync(path.join(tmpDir, "hello.ts"), "export const x = 1;");
		execFileSync("git", ["add", "hello.ts"], { cwd: tmpDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
		fs.writeFileSync(path.join(tmpDir, "hello.ts"), "export const x = 2;");

		const files = await getGitModifiedFiles(tmpDir);
		expect(files).toContain("hello.ts");
	});
});

describe("runUpdate --yes mode", () => {
	it("regenerates NEXT_PROMPT.md in --yes mode", async () => {
		setupSession();

		const before = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");

		const result = await runUpdate({
			cwd: tmpDir,
			yes: true,
			verbose: false,
			strict: false,
		});

		const after = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");

		expect(result.promptRegenerated).toBe(true);
		// The regenerated prompt should differ from the hand-written one
		expect(after).not.toBe(before);
		expect(after.length).toBeGreaterThan(0);
	});

	it("returns zero tasks updated in --yes mode (no interactive marking)", async () => {
		setupSession();

		const result = await runUpdate({
			cwd: tmpDir,
			yes: true,
			verbose: false,
			strict: false,
		});

		expect(result.tasksUpdated).toBe(0);
		expect(result.notesAdded).toBe(0);
	});

	it("throws CliError when no .session/ exists", async () => {
		await expect(
			runUpdate({ cwd: tmpDir, yes: true, verbose: false, strict: false }),
		).rejects.toThrow("No .session/ directory found");
	});

	it("shows verbose output without errors", async () => {
		setupSession();

		const result = await runUpdate({
			cwd: tmpDir,
			yes: true,
			verbose: true,
			strict: false,
		});

		expect(result.promptRegenerated).toBe(true);
	});

	it("blocks write in strict mode when secrets detected", async () => {
		setupSession({
			tasks: [{ text: "Task with secret AKIAIOSFODNN7EXAMPLE", status: "todo" }],
		});

		// The AWS key pattern makes it into the regenerated prompt via task text
		await expect(
			runUpdate({
				cwd: tmpDir,
				yes: true,
				verbose: false,
				strict: true,
			}),
		).rejects.toThrow("blocking write in strict mode");
	});

	it("preserves session state after update", async () => {
		setupSession();

		await runUpdate({
			cwd: tmpDir,
			yes: true,
			verbose: false,
			strict: false,
		});

		// Verify SESSION_STATE.md was updated (last_updated should change)
		const stateContent = fs.readFileSync(
			path.join(tmpDir, ".session", "SESSION_STATE.md"),
			"utf-8",
		);
		expect(stateContent).toContain("active_chunk: 1");
		expect(stateContent).toContain("session_id:");
	});
});
