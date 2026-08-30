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

	// Previously "throws CliError for plan with no h2 headings", asserting the
	// message "No chunks found". h2 is no longer required, and an unrecognized
	// document now reports what was tried instead of naming one dialect.
	it("reports every candidate source and its score when none matches (REQ-PS-3)", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, "# Just a title\n\nNo structure here at all.\n");

		const run = splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		await expect(run).rejects.toThrow(/headings/);
		await expect(run).rejects.toThrow(/task-list/);
		// Scores are shown, not just names.
		await expect(run).rejects.toThrow(/0\.00/);
	});

	it("names every source tried when a recognized plan yields no chunks (REQ-PS-15)", async () => {
		// The headings source recognizes this with high confidence — it declares a
		// position — but chunk 0 has no representation, so nothing survives.
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(planPath, "## Chunk 0 -- Setup\n\n- [ ] init\n");

		const run = splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		await expect(run).rejects.toThrow(/No chunks found/);
		await expect(run).rejects.toThrow(/headings/);
		await expect(run).rejects.toThrow(/task-list/);
	});

	it("warns when a skipped section carries tasks (REQ-PS-11)", async () => {
		const { log } = await import("@clack/prompts");
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(
			planPath,
			["## Chunk 1 -- Auth", "- [ ] login", "", "## Notes", "- [ ] do not lose me"].join("\n"),
		);

		await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		const warnings = vi.mocked(log.warn).mock.calls.map((c) => String(c[0]));
		expect(warnings.some((w) => w.includes("Notes") && w.includes("1 task"))).toBe(true);
	});

	it("does not warn about a skipped section with no tasks (REQ-PS-11)", async () => {
		const { log } = await import("@clack/prompts");
		vi.mocked(log.warn).mockClear();
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(
			planPath,
			["## Chunk 1 -- Auth", "- [ ] login", "", "## Overview", "Just prose."].join("\n"),
		);

		await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		const warnings = vi.mocked(log.warn).mock.calls.map((c) => String(c[0]));
		expect(warnings.some((w) => w.includes("Overview"))).toBe(false);
	});

	it("splits an h3-structured plan that yielded nothing before (REQ-PS-5)", async () => {
		const planPath = path.join(tmpDir, "PLAN.md");
		fs.writeFileSync(
			planPath,
			["# Roadmap", "", "### Auth", "- [ ] login", "", "### Billing", "- [ ] stripe"].join("\n"),
		);

		const result = await splitPlan(planPath, sessionDir, {
			yes: true,
			dryRun: false,
			verbose: false,
			cwd: tmpDir,
		});

		expect(result.chunks.map((c) => c.title)).toEqual(["Auth", "Billing"]);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(sessionDir, "PLAN_2.md"))).toBe(true);
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
