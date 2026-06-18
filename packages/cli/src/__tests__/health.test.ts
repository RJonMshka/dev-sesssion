/**
 * Tests for the `dev-sesssion health` command and `HealthChecker` core logic.
 *
 * Uses a real temp directory with SESSION_STATE.md, FILE_INDEX.md, and PLAN_1.md
 * to verify audit checks and --fix behaviour.
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
	confirm: vi.fn().mockResolvedValue(true),
	isCancel: vi.fn(() => false),
}));

import { HealthChecker, HealthSeverity } from "@dev-session/core";
import { runHealth } from "../commands/health.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "health-test-"));
}

function makeSessionDir(root: string): string {
	const sessionDir = path.join(root, ".session");
	fs.mkdirSync(sessionDir, { recursive: true });
	return sessionDir;
}

const VALID_STATE = `---
active_chunk: 1
session_id: "test-session"
last_updated: "${new Date().toISOString().slice(0, 10)}"
tasks:
  - text: "Do something"
    status: todo
notes: []
last_worked_files: []
completed_chunks: {}
---

# Session State
`;

const VALID_PLAN = `---
chunk_id: 1
title: "Test Chunk"
status: active
---

# Plan 1
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

// ---------------------------------------------------------------------------
// HealthChecker unit tests
// ---------------------------------------------------------------------------

describe("HealthChecker.audit", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns healthy=false and SESSION_STATE_INVALID when SESSION_STATE.md is missing", () => {
		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		expect(report.healthy).toBe(false);
		expect(report.errorCount).toBe(1);
		expect(report.issues[0]?.code).toBe("SESSION_STATE_INVALID");
		expect(report.issues[0]?.fixable).toBe(false);
	});

	it("returns healthy=false and PLAN_MISSING when active PLAN_N.md is absent", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const planIssue = report.issues.find((i) => i.code === "PLAN_MISSING");
		expect(planIssue).toBeDefined();
		expect(planIssue?.severity).toBe(HealthSeverity.ERROR);
		expect(planIssue?.fixable).toBe(false);
	});

	it("returns healthy=false and FILE_INDEX_INVALID when FILE_INDEX.md is missing", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const indexIssue = report.issues.find((i) => i.code === "FILE_INDEX_INVALID");
		expect(indexIssue).toBeDefined();
		expect(indexIssue?.severity).toBe(HealthSeverity.ERROR);
	});

	it("returns healthy=true when session is fully healthy", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);
		fs.writeFileSync(
			path.join(sessionDir, "NEXT_PROMPT.md"),
			"# Prompt\n\nProject: test\nActive chunk: 1\n",
		);
		// CLAUDE.md is listed in VALID_INDEX — create it so it isn't stale
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# CLAUDE.md\n");

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		expect(report.healthy).toBe(true);
		expect(report.errorCount).toBe(0);
		expect(report.warningCount).toBe(0);
		expect(report.checksRun).toBeGreaterThan(0);
	});

	it("reports STALE_INDEX_ENTRIES for non-existent files in FILE_INDEX", () => {
		const indexWithStale = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Chunk 1

| File | Purpose |
|---|---|
| non-existent-file.ts | Ghost file |
`;
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), indexWithStale);
		fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Project: test\nActive chunk: 1\n");

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const staleIssue = report.issues.find((i) => i.code === "STALE_INDEX_ENTRIES");
		expect(staleIssue).toBeDefined();
		expect(staleIssue?.fixable).toBe(true);
		expect(report.staleEntries.length).toBe(1);
		expect(report.staleEntries[0]?.filepath).toBe("non-existent-file.ts");
	});

	it("reports PROMPT_MISSING when NEXT_PROMPT.md does not exist", () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const promptIssue = report.issues.find((i) => i.code === "PROMPT_MISSING");
		expect(promptIssue).toBeDefined();
		expect(promptIssue?.severity).toBe(HealthSeverity.WARNING);
	});

	it("reports SESSION_STALE when last_updated is over 7 days ago", () => {
		const oldDate = new Date();
		oldDate.setDate(oldDate.getDate() - 10);
		const staleState = VALID_STATE.replace(
			`last_updated: "${new Date().toISOString().slice(0, 10)}"`,
			`last_updated: "${oldDate.toISOString().slice(0, 10)}"`,
		);
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), staleState);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);
		fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Project: test\nActive chunk: 1\n");
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# CLAUDE.md\n");

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const staleIssue = report.issues.find((i) => i.code === "SESSION_STALE");
		expect(staleIssue).toBeDefined();
		expect(staleIssue?.severity).toBe(HealthSeverity.INFO);
	});

	it("reports ALWAYS_INCLUDE_CREEP when always-include has more than 4 entries", () => {
		const creepIndex = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Always Include

| File | Purpose |
|---|---|
| file1.ts | File 1 |
| file2.ts | File 2 |
| file3.ts | File 3 |
| file4.ts | File 4 |
| file5.ts | File 5 |
`;
		// Create the files so they don't appear stale
		for (let i = 1; i <= 5; i++) {
			fs.writeFileSync(path.join(tmpDir, `file${String(i)}.ts`), "");
		}

		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), creepIndex);
		fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Project: test\nActive chunk: 1\n");

		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		const creepIssue = report.issues.find((i) => i.code === "ALWAYS_INCLUDE_CREEP");
		expect(creepIssue).toBeDefined();
		expect(creepIssue?.severity).toBe(HealthSeverity.WARNING);
	});

	it("counts errors, warnings, and infos correctly", () => {
		// No SESSION_STATE → 1 error, no other checks
		const report = HealthChecker.audit(sessionDir as Parameters<typeof HealthChecker.audit>[0]);

		expect(report.errorCount).toBe(
			report.issues.filter((i) => i.severity === HealthSeverity.ERROR).length,
		);
		expect(report.warningCount).toBe(
			report.issues.filter((i) => i.severity === HealthSeverity.WARNING).length,
		);
		expect(report.infoCount).toBe(
			report.issues.filter((i) => i.severity === HealthSeverity.INFO).length,
		);
	});
});

// ---------------------------------------------------------------------------
// runHealth command tests
// ---------------------------------------------------------------------------

describe("runHealth", () => {
	let tmpDir: string;
	let sessionDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
		sessionDir = makeSessionDir(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("throws CliError when .session/ does not exist", async () => {
		const noSessionDir = path.join(tmpDir, "no-session");
		fs.mkdirSync(noSessionDir);

		await expect(
			runHealth({ cwd: noSessionDir, fix: false, yes: true, verbose: false, json: false }),
		).rejects.toThrow("No .session/ directory found");
	});

	it("outputs JSON when --json flag is set", async () => {
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), VALID_INDEX);
		fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Project: test\nActive chunk: 1\n");

		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runHealth({ cwd: tmpDir, fix: false, yes: true, verbose: false, json: true });

		expect(writeSpy).toHaveBeenCalledOnce();
		const output = JSON.parse(writeSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
		expect(output).toHaveProperty("healthy");
		expect(output).toHaveProperty("checks_run");
		expect(output).toHaveProperty("issues");

		writeSpy.mockRestore();
	});

	it("auto-fixes stale entries when --fix and --yes are set", async () => {
		const indexWithStale = `---
version: 1
last_updated: "2026-04-08"
---

# File Index

## Chunk 1

| File | Purpose |
|---|---|
| ghost-file.ts | Non-existent |
`;
		fs.writeFileSync(path.join(sessionDir, "SESSION_STATE.md"), VALID_STATE);
		fs.writeFileSync(path.join(sessionDir, "PLAN_1.md"), VALID_PLAN);
		fs.writeFileSync(path.join(sessionDir, "FILE_INDEX.md"), indexWithStale);
		fs.writeFileSync(path.join(sessionDir, "NEXT_PROMPT.md"), "Project: test\nActive chunk: 1\n");

		await runHealth({ cwd: tmpDir, fix: true, yes: true, verbose: false, json: false });

		// FILE_INDEX should no longer contain the ghost file
		const updated = fs.readFileSync(path.join(sessionDir, "FILE_INDEX.md"), "utf-8");
		expect(updated).not.toContain("ghost-file.ts");
	});
});
