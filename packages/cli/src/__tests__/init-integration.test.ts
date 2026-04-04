/**
 * Integration tests for `dev-session init`.
 *
 * These tests exercise the full init flow by mocking @clack/prompts
 * and using real temp directories. They verify the end-to-end flow
 * from detection through final writes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts globally before any imports
vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	confirm: vi.fn(() => true),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		step: vi.fn(),
	},
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		cancel: vi.fn(),
		error: vi.fn(),
		message: vi.fn(),
		clear: vi.fn(),
	})),
	text: vi.fn(),
	select: vi.fn(),
	multiselect: vi.fn(),
	group: vi.fn(),
}));

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-integration-"));
	// Create a minimal project structure
	fs.writeFileSync(
		path.join(tmpDir, "package.json"),
		JSON.stringify({ name: "test-project", version: "1.0.0" }),
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("init integration — with PLAN.md (migration path A)", () => {
	const PLAN_CONTENT = `# Test Plan

## Phase 1 -- Setup

- [ ] Initialize project
- [ ] Configure tooling

## Phase 2 -- Core

- [ ] Build feature A
- [ ] Build feature B
`;

	it("creates .session/ with all expected files", async () => {
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN_CONTENT);

		// Dynamically import to get mocked version
		const { splitPlan } = await import("../commands/split-plan.js");
		const { generateIndex } = await import("../commands/generate-index.js");
		const { runFinalWrites } = await import("../commands/final-writes.js");
		const { runDetection } = await import("../commands/detect.js");
		const { ProjectDetector } = await import("@dev-session/core");
		const { PathValidator } = await import("@dev-session/security");

		// Run detection
		const projectInfo = ProjectDetector.detect(tmpDir);
		const detection = runDetection(tmpDir, projectInfo);

		expect(detection.plan.found).toBe(true);
		expect(detection.plan.estimatedChunks).toBe(2);

		// Ensure .session/ exists
		const sessionPath = path.join(tmpDir, ".session");
		fs.mkdirSync(sessionPath, { recursive: true });
		const sessionDir = PathValidator.safeResolvePath(".session", tmpDir);

		// Split plan
		const planRelPath = detection.plan.relativePath ?? "PLAN.md";
		const planPath = path.join(tmpDir, planRelPath);
		const splitResult = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(splitResult.chunks.length).toBe(2);
		expect(splitResult.filesWritten).toBe(2);

		// Generate index
		const indexResult = await generateIndex(sessionDir, splitResult.chunks, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(indexResult.entries.length).toBeGreaterThan(0);

		// Final writes
		const finalResult = await runFinalWrites(
			sessionDir,
			splitResult.chunks,
			indexResult.entries,
			"test-project",
			{ cwd: tmpDir, yes: true, dryRun: false, verbose: false, strict: false },
		);

		expect(finalResult.filesWritten).toBe(3);

		// Verify all expected files exist
		expect(fs.existsSync(path.join(sessionPath, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "PLAN_2.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "FILE_INDEX.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "SESSION_STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "ROUTINES.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "NEXT_PROMPT.md"))).toBe(true);

		// Verify content
		const stateContent = fs.readFileSync(path.join(sessionPath, "SESSION_STATE.md"), "utf-8");
		expect(stateContent).toContain("active_chunk: 1");
		expect(stateContent).toContain("Initialize project");

		const promptContent = fs.readFileSync(path.join(sessionPath, "NEXT_PROMPT.md"), "utf-8");
		expect(promptContent).toContain("test-project");
	});
});

describe("init integration — without PLAN.md (migration path B)", () => {
	it("scaffolds plan and creates .session/ with --yes", async () => {
		// No PLAN.md — scaffolding path

		const { scaffoldPlan } = await import("../commands/scaffold-plan.js");
		const { generateIndex } = await import("../commands/generate-index.js");
		const { runFinalWrites } = await import("../commands/final-writes.js");
		const { PathValidator } = await import("@dev-session/security");

		// Ensure .session/ exists
		const sessionPath = path.join(tmpDir, ".session");
		fs.mkdirSync(sessionPath, { recursive: true });
		const sessionDir = PathValidator.safeResolvePath(".session", tmpDir);

		// Scaffold
		const scaffoldResult = await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: false, verbose: false, cwd: tmpDir },
			"test-project",
		);

		expect(scaffoldResult.chunks.length).toBe(1);
		expect(scaffoldResult.filesWritten).toBe(1);

		// Generate index
		const indexResult = await generateIndex(sessionDir, scaffoldResult.chunks, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		// Final writes
		const finalResult = await runFinalWrites(
			sessionDir,
			scaffoldResult.chunks,
			indexResult.entries,
			scaffoldResult.projectName,
			{ cwd: tmpDir, yes: true, dryRun: false, verbose: false, strict: false },
		);

		expect(finalResult.filesWritten).toBe(3);

		// Verify files
		expect(fs.existsSync(path.join(sessionPath, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "SESSION_STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "ROUTINES.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionPath, "NEXT_PROMPT.md"))).toBe(true);
	});
});

describe("init integration — dry-run mode", () => {
	it("produces no filesystem changes with --dry-run", async () => {
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), "## Chunk 1\n\n- [ ] Task\n");

		const { splitPlan } = await import("../commands/split-plan.js");
		const { generateIndex } = await import("../commands/generate-index.js");
		const { runFinalWrites } = await import("../commands/final-writes.js");
		const { PathValidator } = await import("@dev-session/security");

		const sessionPath = path.join(tmpDir, ".session");
		fs.mkdirSync(sessionPath, { recursive: true });
		const sessionDir = PathValidator.safeResolvePath(".session", tmpDir);

		const planPath = path.join(tmpDir, "PLAN.md");
		const splitResult = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: true,
			verbose: false,
			cwd: tmpDir,
		});

		expect(splitResult.filesWritten).toBe(0);

		const indexResult = await generateIndex(sessionDir, splitResult.chunks, {
			yes: true,
			dryRun: true,
			verbose: false,
			cwd: tmpDir,
		});

		const finalResult = await runFinalWrites(
			sessionDir,
			splitResult.chunks,
			indexResult.entries,
			"test-project",
			{ cwd: tmpDir, yes: true, dryRun: true, verbose: false, strict: false },
		);

		expect(finalResult.filesWritten).toBe(0);

		// No session files should exist (only the empty .session/ dir we created)
		const sessionFiles = fs.readdirSync(sessionPath);
		expect(sessionFiles.length).toBe(0);
	});
});
