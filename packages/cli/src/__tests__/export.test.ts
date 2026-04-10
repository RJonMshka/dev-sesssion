/**
 * Tests for the `dev-session export` command.
 *
 * Tests --to claude (SESSION_STATE → CLAUDE.md section) and
 * --to cursor (FILE_INDEX active chunk → .cursor/rules/dev-session.mdc).
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

import { runExport } from "../commands/export.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "export-test-"));
}

function makeSessionDir(root: string): string {
	const sessionDir = path.join(root, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}

const VALID_STATE_NO_TASKS = `---
active_chunk: 2
session_id: "test-session"
last_updated: "2026-04-08"
tasks: []
notes: []
last_worked_files: []
completed_chunks: {}
---

# Session State
`;

const VALID_STATE_WITH_TASKS = `---
active_chunk: 2
session_id: "test-session"
last_updated: "2026-04-08"
tasks:
  - text: "Implement feature X"
    status: "done"
    added_at: "2026-04-08T10:00:00.000Z"
  - text: "Write tests"
    status: "todo"
    added_at: "2026-04-08T10:00:00.000Z"
notes:
  - "CLAUDE.md: HARD RULES — Never use exec()"
  - "Design decision: use AtomicWriter everywhere"
last_worked_files: []
completed_chunks: {}
---

# Session State
`;

const VALID_INDEX_CHUNK2 = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI instructions |

## Chunk 2 — Feature work

| File | Purpose |
|---|---|
| src/feature.ts | Main feature implementation |
| src/feature.test.ts | Feature tests |
`;

const BASE_OPTS = {
	verbose: false,
	dryRun: false,
} as const;

// ---------------------------------------------------------------------------
// --to claude tests
// ---------------------------------------------------------------------------

describe("runExport --to claude", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE_WITH_TASKS);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX_CHUNK2);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("throws CliError when .session/ does not exist", async () => {
		const noSession = path.join(tmpDir, "no-session");
		fs.mkdirSync(noSession);

		await expect(runExport({ ...BASE_OPTS, cwd: noSession, to: "claude" })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("creates CLAUDE.md with dev-session section when it does not exist", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("<!-- dev-session:start -->");
		expect(content).toContain("<!-- dev-session:end -->");
		expect(content).toContain("## Active Chunk: 2");
	});

	it("includes task checklist in exported section", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("[x] Implement feature X");
		expect(content).toContain("[ ] Write tests");
	});

	it("includes notes in exported section", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("CLAUDE.md: HARD RULES");
		expect(content).toContain("Design decision: use AtomicWriter everywhere");
	});

	it("includes FILE_INDEX files for active chunk", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("`src/feature.ts`");
		expect(content).toContain("`src/feature.test.ts`");
	});

	it("includes always-include files in export", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("`CLAUDE.md`");
	});

	it("updates existing dev-session section in CLAUDE.md", async () => {
		const existing = [
			"# My Project",
			"",
			"Some existing content.",
			"",
			"<!-- dev-session:start -->",
			"",
			"## Active Chunk: 1",
			"",
			"<!-- dev-session:end -->",
			"",
			"More content after.",
		].join("\n");

		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), existing);

		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("## Active Chunk: 2"); // updated
		expect(content).toContain("Some existing content.");
		expect(content).toContain("More content after.");
		// Only one set of markers
		expect((content.match(/<!-- dev-session:start -->/g) ?? []).length).toBe(1);
	});

	it("does not write anything in dry-run mode", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude", dryRun: true });

		// CLAUDE.md should not have been created
		expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
	});

	it("shows progress summary with task count", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("**Progress:** 1/2 tasks complete");
	});
});

// ---------------------------------------------------------------------------
// --to claude with no tasks/notes
// ---------------------------------------------------------------------------

describe("runExport --to claude (no tasks or notes)", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE_NO_TASKS);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX_CHUNK2);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("exports without task or notes sections", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "claude" });

		const content = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(content).toContain("## Active Chunk: 2");
		expect(content).not.toContain("### Tasks");
		expect(content).not.toContain("### Notes");
	});
});

// ---------------------------------------------------------------------------
// --to cursor tests
// ---------------------------------------------------------------------------

describe("runExport --to cursor", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE_WITH_TASKS);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX_CHUNK2);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("throws CliError when .session/ does not exist", async () => {
		const noSession = path.join(tmpDir, "no-session");
		fs.mkdirSync(noSession);

		await expect(runExport({ ...BASE_OPTS, cwd: noSession, to: "cursor" })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("creates .cursor/rules/dev-session.mdc with frontmatter globs", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" });

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		expect(fs.existsSync(mdcPath)).toBe(true);

		const content = fs.readFileSync(mdcPath, "utf-8");
		expect(content).toContain("---");
		expect(content).toContain("globs:");
		expect(content).toContain('"src/feature.ts"');
		expect(content).toContain('"src/feature.test.ts"');
		expect(content).toContain('"CLAUDE.md"');
	});

	it("includes active chunk number in mdc description", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" });

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		const content = fs.readFileSync(mdcPath, "utf-8");
		expect(content).toContain("active chunk 2");
	});

	it("creates .cursor/rules/ directory if it does not exist", async () => {
		const rulesDir = path.join(tmpDir, ".cursor", "rules");
		expect(fs.existsSync(rulesDir)).toBe(false);

		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" });

		expect(fs.existsSync(rulesDir)).toBe(true);
	});

	it("does not write anything in dry-run mode", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor", dryRun: true });

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		expect(fs.existsSync(mdcPath)).toBe(false);
	});

	it("lists always-include and chunk files separately in body", async () => {
		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" });

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		const content = fs.readFileSync(mdcPath, "utf-8");
		expect(content).toContain("## Always include");
		expect(content).toContain("## Chunk 2 files");
	});

	it("deduplicates files that appear in both always-include and active chunk", async () => {
		// FILE_INDEX where CLAUDE.md is in both always-include and chunk 2
		const indexWithOverlap = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| CLAUDE.md | AI instructions |

## Chunk 2 — Feature

| File | Purpose |
|---|---|
| CLAUDE.md | AI instructions (also in chunk 2) |
| src/feature.ts | Feature |
`;
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), indexWithOverlap);

		await runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" });

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		const content = fs.readFileSync(mdcPath, "utf-8");
		// CLAUDE.md should appear only once in the globs list
		const globOccurrences = (content.match(/"CLAUDE\.md"/g) ?? []).length;
		expect(globOccurrences).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// --to cursor with empty index
// ---------------------------------------------------------------------------

describe("runExport --to cursor (empty active chunk)", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
		// Active chunk is 2 but FILE_INDEX only has chunk 1 entries
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE_WITH_TASKS);
		const emptyForChunk2 = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Chunk 1 — Something else

| File | Purpose |
|---|---|
| src/other.ts | Other file |
`;
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), emptyForChunk2);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("completes without writing when no files match active chunk", async () => {
		await expect(runExport({ ...BASE_OPTS, cwd: tmpDir, to: "cursor" })).resolves.toBeUndefined();

		const mdcPath = path.join(tmpDir, ".cursor", "rules", "dev-session.mdc");
		expect(fs.existsSync(mdcPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Unsupported target
// ---------------------------------------------------------------------------

describe("runExport unsupported target", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		makeSessionDir(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("throws CliError for unknown --to value", async () => {
		await expect(
			runExport({
				...BASE_OPTS,
				cwd: tmpDir,
				to: "unknown" as Parameters<typeof runExport>[0]["to"],
			}),
		).rejects.toThrow();
	});
});
