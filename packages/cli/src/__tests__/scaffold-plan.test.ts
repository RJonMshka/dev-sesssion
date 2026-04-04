import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { PathValidator } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scaffoldPlan } from "../commands/scaffold-plan.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	text: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
	},
}));

let tmpDir: string;
let sessionDir: ValidatedPath;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-test-"));
	const sessionPath = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionPath);
	sessionDir = PathValidator.safeResolvePath(".session", tmpDir);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scaffoldPlan", () => {
	it("creates a single chunk in --yes mode", async () => {
		const result = await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: false, verbose: false, cwd: tmpDir },
			"test-project",
		);

		expect(result.chunks.length).toBe(1);
		expect(result.filesWritten).toBe(1);
		expect(result.projectName).toBe("test-project");

		// Verify chunk file was written
		expect(fs.existsSync(path.join(sessionDir, "PLAN_1.md"))).toBe(true);
	});

	it("uses directory name when no project name given in --yes mode", async () => {
		const result = await scaffoldPlan(sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.projectName).toBe(path.basename(tmpDir));
	});

	it("first chunk has starter tasks", async () => {
		const result = await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: false, verbose: false, cwd: tmpDir },
			"my-project",
		);

		const firstChunk = result.chunks[0];
		expect(firstChunk).toBeDefined();
		expect(firstChunk?.tasks.length).toBe(3);
		expect(firstChunk?.tasks[0]?.status).toBe("todo");
	});

	it("dry-run mode writes no files", async () => {
		const result = await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: true, verbose: false, cwd: tmpDir },
			"test-project",
		);

		expect(result.chunks.length).toBe(1);
		expect(result.filesWritten).toBe(0);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_1.md"))).toBe(false);
	});

	it("verbose mode logs chunk details", async () => {
		const result = await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: false, verbose: true, cwd: tmpDir },
			"test-project",
		);

		expect(result.chunks.length).toBe(1);
	});

	it("chunk content contains valid markdown with tasks", async () => {
		await scaffoldPlan(
			sessionDir,
			{ yes: true, dryRun: false, verbose: false, cwd: tmpDir },
			"test-project",
		);

		const content = fs.readFileSync(path.join(sessionDir, "PLAN_1.md"), "utf-8");
		expect(content).toContain("Initial setup");
		expect(content).toContain("- [ ]");
		expect(content).toContain("Tasks");
	});
});
