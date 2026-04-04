import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { PathValidator } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitPlan } from "../commands/split-plan.js";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
	confirm: vi.fn(() => true),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
	},
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
	})),
}));

let tmpDir: string;
let sessionDir: ValidatedPath;

const SAMPLE_PLAN = `# My Plan

## Chunk 1 -- Foundation

- [ ] Set up project
- [ ] Configure tooling

## Chunk 2 -- Core logic

- [ ] Build data model
- [ ] Write tests

## Chunk 3 -- CLI

- [ ] Add commands
`;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "split-plan-test-"));
	const sessionPath = path.join(tmpDir, ".session");
	fs.mkdirSync(sessionPath);
	sessionDir = PathValidator.safeResolvePath(".session", tmpDir);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("splitPlan", () => {
	it("splits a plan into chunk files with --yes", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, SAMPLE_PLAN);

		const result = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.chunks.length).toBe(3);
		expect(result.filesWritten).toBe(3);

		// Verify files were written
		expect(fs.existsSync(path.join(sessionDir, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_2.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_3.md"))).toBe(true);
	});

	it("produces correct chunk content", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, SAMPLE_PLAN);

		const result = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		const chunk1Content = fs.readFileSync(path.join(sessionDir, "PLAN_1.md"), "utf-8");
		expect(chunk1Content).toContain("Foundation");
		expect(chunk1Content).toContain("Set up project");

		// Chunk IDs should be sequential
		expect(result.chunks[0]?.chunk_id).toBe(1);
		expect(result.chunks[1]?.chunk_id).toBe(2);
		expect(result.chunks[2]?.chunk_id).toBe(3);
	});

	it("dry-run mode writes no files", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, SAMPLE_PLAN);

		const result = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: true,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.chunks.length).toBe(3);
		expect(result.filesWritten).toBe(0);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_1.md"))).toBe(false);
	});

	it("throws CliError for unreadable plan file", async () => {
		await expect(
			splitPlan("/nonexistent/PLAN.md", sessionDir, {
				yes: true,
				dryRun: false,
				verbose: false,
				cwd: tmpDir,
			}),
		).rejects.toThrow("Cannot read plan file");
	});

	it("throws CliError for plan with no h2 headings", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, "# Just a title\n\nNo h2 headings here.\n");

		await expect(
			splitPlan(planPath, sessionDir, {
				yes: true,
				dryRun: false,
				verbose: false,
				cwd: tmpDir,
			}),
		).rejects.toThrow("No chunks found");
	});

	it("verbose mode logs boundaries", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, SAMPLE_PLAN);

		const result = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: true,
			cwd: tmpDir,
		});

		expect(result.chunks.length).toBe(3);
	});
});
