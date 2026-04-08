import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FileIndexEntry, PlanChunk } from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { PathValidator } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFinalWrites } from "../commands/final-writes.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	confirm: vi.fn(() => true),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	},
}));

let tmpDir: string;
let sessionDir: ValidatedPath;

const SAMPLE_CHUNKS: PlanChunk[] = [
	{
		chunk_id: 1,
		title: "Foundation",
		depends_on: [],
		tasks: [
			{ text: "Set up project", status: "todo" },
			{ text: "Configure tooling", status: "todo" },
		],
	},
	{
		chunk_id: 2,
		title: "Core logic",
		depends_on: [1],
		tasks: [{ text: "Build data model", status: "todo" }],
	},
];

const SAMPLE_ENTRIES: FileIndexEntry[] = [
	{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI instructions" },
	{ filepath: "src/index.ts", chunk_tags: [1], purpose: "Entry point", token_cost: 50 },
	{ filepath: "package.json", chunk_tags: [1], purpose: "Package manifest", token_cost: 30 },
];

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "final-writes-test-"));
	const sessionPath = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionPath);
	sessionDir = PathValidator.safeResolvePath(".session", tmpDir);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runFinalWrites", () => {
	it("writes SESSION_STATE.md, ROUTINES.md, and NEXT_PROMPT.md", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		expect(result.filesWritten).toBe(3);
		expect(fs.existsSync(path.join(sessionDir, "SESSION_STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionDir, "ROUTINES.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionDir, "NEXT_PROMPT.md"))).toBe(true);
	});

	it("SESSION_STATE.md contains active chunk 1", async () => {
		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		const content = fs.readFileSync(path.join(sessionDir, "SESSION_STATE.md"), "utf-8");
		expect(content).toContain("active_chunk: 1");
	});

	it("NEXT_PROMPT.md contains project name", async () => {
		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "my-awesome-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		const content = fs.readFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "utf-8");
		expect(content).toContain("my-awesome-project");
	});

	it("patches .gitignore in --yes mode", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		expect(result.gitignorePatched).toBe(true);
		const gitignoreContent = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
		expect(gitignoreContent).toContain(".session/SESSION_STATE.md");
		expect(gitignoreContent).toContain(".session/NEXT_PROMPT.md");
	});

	it("does not double-patch .gitignore", async () => {
		// First write
		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		// Second write
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		expect(result.gitignorePatched).toBe(false);
	});

	it("dry-run mode writes no files", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: true,
			verbose: false,
			strict: false,
		});

		expect(result.filesWritten).toBe(0);
		expect(fs.existsSync(path.join(sessionDir, "SESSION_STATE.md"))).toBe(false);
		expect(fs.existsSync(path.join(sessionDir, "ROUTINES.md"))).toBe(false);
		expect(fs.existsSync(path.join(sessionDir, "NEXT_PROMPT.md"))).toBe(false);
	});

	it("throws CliError when no chunks provided", async () => {
		await expect(
			runFinalWrites(sessionDir, [], SAMPLE_ENTRIES, "test-project", {
				cwd: tmpDir,
				yes: true,
				dryRun: false,
				verbose: false,
				strict: false,
			}),
		).rejects.toThrow("No plan chunks available");
	});

	it("returns zero secret warnings for clean content", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		expect(result.secretWarnings).toBe(0);
	});

	it("returns gitattributesPatched: false in personal mode", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: false,
			verbose: false,
			strict: false,
		});

		expect(result.gitattributesPatched).toBe(false);
		expect(fs.existsSync(path.join(tmpDir, ".gitattributes"))).toBe(false);
	});
});

describe("runFinalWrites — team mode", () => {
	it("auto-patches .gitignore without prompting in team mode", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: false, // no --yes, but teamMode should still auto-apply
			dryRun: false,
			verbose: false,
			strict: false,
			teamMode: true,
		});

		expect(result.gitignorePatched).toBe(true);
		const content = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
		expect(content).toContain(".session/SESSION_STATE.md");
	});

	it("patches .gitattributes with FILE_INDEX.md merge=ours in team mode", async () => {
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: false,
			dryRun: false,
			verbose: false,
			strict: false,
			teamMode: true,
		});

		expect(result.gitattributesPatched).toBe(true);
		const content = fs.readFileSync(path.join(tmpDir, ".gitattributes"), "utf-8");
		expect(content).toContain(".session/FILE_INDEX.md merge=ours");
	});

	it(".gitattributes patch is idempotent — second run does not double-append", async () => {
		const opts = {
			cwd: tmpDir,
			yes: false,
			dryRun: false,
			verbose: false,
			strict: false,
			teamMode: true,
		} as const;

		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", opts);
		const result = await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", opts);

		expect(result.gitattributesPatched).toBe(false);

		const content = fs.readFileSync(path.join(tmpDir, ".gitattributes"), "utf-8");
		const matchCount = (content.match(/FILE_INDEX\.md merge=ours/g) ?? []).length;
		expect(matchCount).toBe(1);
	});

	it("appends to existing .gitattributes content", async () => {
		const existingContent = "*.md linguist-documentation\n";
		fs.writeFileSync(path.join(tmpDir, ".gitattributes"), existingContent);

		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: false,
			dryRun: false,
			verbose: false,
			strict: false,
			teamMode: true,
		});

		const content = fs.readFileSync(path.join(tmpDir, ".gitattributes"), "utf-8");
		expect(content).toContain("*.md linguist-documentation");
		expect(content).toContain("FILE_INDEX.md merge=ours");
	});

	it("dry-run does not write .gitattributes", async () => {
		await runFinalWrites(sessionDir, SAMPLE_CHUNKS, SAMPLE_ENTRIES, "test-project", {
			cwd: tmpDir,
			yes: true,
			dryRun: true,
			verbose: false,
			strict: false,
			teamMode: true,
		});

		expect(fs.existsSync(path.join(tmpDir, ".gitattributes"))).toBe(false);
	});
});
