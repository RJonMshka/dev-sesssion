import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runIndexAdd, runIndexAudit } from "../commands/index-cmd.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "index-cmd-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupSession(): void {
	const sessionDir = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });

	// SESSION_STATE.md
	fs.writeFileSync(
		path.join(sessionDir, "SESSION_STATE.md"),
		[
			"---",
			"active_chunk: 1",
			'session_id: "test-session"',
			'last_updated: "2026-04-03"',
			"tasks:",
			'  - text: "Task A"',
			'    status: "todo"',
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
			"tasks:",
			'  - text: "Task A"',
			'    status: "todo"',
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
}

describe("runIndexAdd", () => {
	it("adds a file in --yes mode", async () => {
		setupSession();

		// Create the file to add
		fs.writeFileSync(path.join(tmpDir, "new-file.ts"), "export const x = 1;");

		await runIndexAdd({
			cwd: tmpDir,
			filepath: "new-file.ts",
			yes: true,
			verbose: false,
		});

		// Verify FILE_INDEX.md was updated
		const content = fs.readFileSync(path.join(tmpDir, ".session", "FILE_INDEX.md"), "utf-8");
		expect(content).toContain("new-file.ts");
	});

	it("throws when file not found", async () => {
		setupSession();

		await expect(
			runIndexAdd({
				cwd: tmpDir,
				filepath: "nonexistent.ts",
				yes: true,
				verbose: false,
			}),
		).rejects.toThrow("File not found");
	});

	it("warns on duplicate file", async () => {
		setupSession();

		// Create a file that matches an existing entry
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export const x = 1;");

		// Should not throw, just warn
		await runIndexAdd({
			cwd: tmpDir,
			filepath: "src/index.ts",
			yes: true,
			verbose: true,
		});
	});

	it("throws when no .session/ exists", async () => {
		await expect(
			runIndexAdd({
				cwd: tmpDir,
				filepath: "file.ts",
				yes: true,
				verbose: false,
			}),
		).rejects.toThrow("No .session/ directory found");
	});
});

describe("runIndexAudit", () => {
	it("reports healthy index when all files exist", async () => {
		setupSession();

		// Create the files referenced in the index
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");
		fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export const x = 1;");

		const result = await runIndexAudit({
			cwd: tmpDir,
			fix: false,
			yes: false,
			verbose: false,
		});

		expect(result.healthy).toBe(true);
		expect(result.stale).toHaveLength(0);
	});

	it("detects stale entries for deleted files", async () => {
		setupSession();

		// Don't create the files — they'll be stale
		const result = await runIndexAudit({
			cwd: tmpDir,
			fix: false,
			yes: false,
			verbose: false,
		});

		expect(result.healthy).toBe(false);
		expect(result.stale.length).toBeGreaterThan(0);
	});

	it("auto-removes stale entries with --fix --yes", async () => {
		setupSession();

		// Create only CLAUDE.md, not src/index.ts — so src/index.ts is stale
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");

		const result = await runIndexAudit({
			cwd: tmpDir,
			fix: true,
			yes: true,
			verbose: false,
		});

		expect(result.stale.length).toBeGreaterThan(0);

		// Verify the stale entry was removed
		const content = fs.readFileSync(path.join(tmpDir, ".session", "FILE_INDEX.md"), "utf-8");
		expect(content).not.toContain("src/index.ts");
		// CLAUDE.md should still be there
		expect(content).toContain("CLAUDE.md");
	});

	it("throws when no .session/ exists", async () => {
		await expect(
			runIndexAudit({ cwd: tmpDir, fix: false, yes: false, verbose: false }),
		).rejects.toThrow("No .session/ directory found");
	});
});
