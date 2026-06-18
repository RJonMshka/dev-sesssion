/**
 * Tests for the `dev-sesssion import` command.
 *
 * Tests --from claude (CLAUDE.md → SESSION_STATE notes) and
 * --from cursor (.cursor/rules/*.mdc globs → FILE_INDEX entries).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	},
}));

import { runImport } from "../commands/import.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "import-test-"));
}

function makeSessionDir(root: string): string {
	const sessionDir = path.join(root, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}

const VALID_STATE = `---
active_chunk: 1
session_id: "test-session"
last_updated: "2026-04-08"
tasks: []
notes: []
last_worked_files: []
completed_chunks: {}
---

# Session State
`;

const VALID_INDEX = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI instructions |
`;

const BASE_OPTS = {
	yes: true,
	verbose: false,
	dryRun: false,
} as const;

// ---------------------------------------------------------------------------
// --from claude tests
// ---------------------------------------------------------------------------

describe("runImport --from claude", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("throws CliError when CLAUDE.md does not exist", async () => {
		await expect(runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude" })).rejects.toThrow(
			"CLAUDE.md not found",
		);
	});

	it("throws CliError when .session/ does not exist", async () => {
		const noSessionDir = path.join(tmpDir, "no-session");
		fs.mkdirSync(noSessionDir);
		fs.writeFileSync(path.join(noSessionDir, "CLAUDE.md"), "# Claude\n\n## Rules\n\nDo stuff.\n");

		await expect(runImport({ ...BASE_OPTS, cwd: noSessionDir, from: "claude" })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("adds H2 sections as notes to SESSION_STATE.md", async () => {
		const claudeMd = [
			"# CLAUDE.md",
			"",
			"## HARD RULES",
			"",
			"Never use exec().",
			"",
			"## Session workflow",
			"",
			"Read SESSION_STATE.md first.",
		].join("\n");

		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), claudeMd);

		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude" });

		const updated = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");
		expect(updated).toContain("CLAUDE.md: HARD RULES");
		expect(updated).toContain("CLAUDE.md: Session workflow");
	});

	it("deduplicates notes that were already imported", async () => {
		const claudeMd = "# CLAUDE.md\n\n## HARD RULES\n\nNever use exec().\n";
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), claudeMd);

		// Import twice
		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude" });
		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude" });

		const updated = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");
		const occurrences = (updated.match(/CLAUDE\.md: HARD RULES/g) ?? []).length;
		expect(occurrences).toBe(1);
	});

	it("does not write anything in dry-run mode", async () => {
		const claudeMd = "# CLAUDE.md\n\n## HARD RULES\n\nNever use exec().\n";
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), claudeMd);

		const originalContent = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");

		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude", dryRun: true });

		const afterContent = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");
		// dry-run: SESSION_STATE should not have changed
		expect(afterContent).toBe(originalContent);
	});

	it("completes without adding notes when CLAUDE.md has no H2 sections", async () => {
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Just a title\n\nSome content.\n");

		// Should not throw
		await expect(runImport({ ...BASE_OPTS, cwd: tmpDir, from: "claude" })).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// --from cursor tests
// ---------------------------------------------------------------------------

describe("runImport --from cursor", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("throws CliError when .cursor/rules/ does not exist", async () => {
		await expect(runImport({ ...BASE_OPTS, cwd: tmpDir, from: "cursor" })).rejects.toThrow(
			".cursor/rules/ directory not found",
		);
	});

	it("adds matched files to FILE_INDEX when globs match project files", async () => {
		// Create cursor rules dir and a .mdc file
		const rulesDir = path.join(tmpDir, ".cursor", "rules");
		fs.mkdirSync(rulesDir, { recursive: true });
		fs.writeFileSync(
			path.join(rulesDir, "typescript.mdc"),
			`---\ndescription: TypeScript files\nglobs: "src/**/*.ts"\n---\n\nFollow TypeScript best practices.\n`,
		);

		// Create a matching file
		const srcDir = path.join(tmpDir, "src");
		fs.mkdirSync(srcDir, { recursive: true });
		fs.writeFileSync(path.join(srcDir, "index.ts"), "export {};\n");

		// Create a .gitignore so walker doesn't include node_modules
		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules\n");

		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "cursor" });

		const updated = fs.readFileSync(path.join(sessionDir, "FILE_INDEX.md"), "utf-8");
		expect(updated).toContain("src/index.ts");
		expect(updated).toContain("Cursor rule: TypeScript files");
	});

	it("ignores .mdc files without frontmatter", async () => {
		const rulesDir = path.join(tmpDir, ".cursor", "rules");
		fs.mkdirSync(rulesDir, { recursive: true });
		fs.writeFileSync(
			path.join(rulesDir, "no-frontmatter.mdc"),
			"Just some content with no frontmatter.\n",
		);

		await expect(runImport({ ...BASE_OPTS, cwd: tmpDir, from: "cursor" })).resolves.toBeUndefined();

		// FILE_INDEX should be unchanged (no new entries from this file)
		const updated = fs.readFileSync(path.join(sessionDir, "FILE_INDEX.md"), "utf-8");
		expect(updated).not.toContain("Cursor rule");
	});

	it("handles array globs in .mdc frontmatter", async () => {
		const rulesDir = path.join(tmpDir, ".cursor", "rules");
		fs.mkdirSync(rulesDir, { recursive: true });
		fs.writeFileSync(
			path.join(rulesDir, "multi.mdc"),
			`---\ndescription: Multi-glob rule\nglobs: ["src/*.ts", "lib/*.ts"]\n---\n\nContent.\n`,
		);

		const srcDir = path.join(tmpDir, "src");
		fs.mkdirSync(srcDir);
		fs.writeFileSync(path.join(srcDir, "main.ts"), "");

		const libDir = path.join(tmpDir, "lib");
		fs.mkdirSync(libDir);
		fs.writeFileSync(path.join(libDir, "util.ts"), "");

		fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules\n");

		await runImport({ ...BASE_OPTS, cwd: tmpDir, from: "cursor" });

		const updated = fs.readFileSync(path.join(sessionDir, "FILE_INDEX.md"), "utf-8");
		expect(updated).toContain("src/main.ts");
		expect(updated).toContain("lib/util.ts");
	});
});

// ---------------------------------------------------------------------------
// Unsupported source
// ---------------------------------------------------------------------------

describe("runImport unsupported source", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		makeSessionDir(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("throws CliError for unknown --from value", async () => {
		await expect(
			runImport({
				...BASE_OPTS,
				cwd: tmpDir,
				from: "unknown" as Parameters<typeof runImport>[0]["from"],
			}),
		).rejects.toThrow();
	});
});
