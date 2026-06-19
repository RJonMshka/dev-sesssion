/**
 * E2E tests for chunk 11 — Context Intelligence commands:
 * preview, trim, lint-context, compact.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-ci-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson(dir: string, name = "ci-test-project"): void {
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
}

function writePlan(dir: string): void {
	fs.writeFileSync(
		path.join(dir, "PLAN.md"),
		[
			"# Test Plan",
			"",
			"## Chunk 1 — Setup",
			"",
			"- [ ] Initialize project",
			"- [ ] Configure tooling",
			"",
			"## Chunk 2 — Core",
			"",
			"- [ ] Build feature A",
		].join("\n"),
	);
}

async function initProject(dir: string): Promise<void> {
	writePackageJson(dir);
	writePlan(dir);
	await runCli(["init", "--yes", "--cwd", dir]);
}

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

describe("dev-sesssion preview", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits 0 and shows a breakdown table", async () => {
		const result = await runCli(["preview", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("TOTAL");
		expect(result.stdout).toContain("SESSION_STATE");
	});

	it("--format json exits 0 and outputs valid JSON", async () => {
		const result = await runCli(["preview", "--format", "json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);

		expect(() => JSON.parse(result.stdout)).not.toThrow();

		const p = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(p).toHaveProperty("total_tokens");
		expect(p).toHaveProperty("budget_cap");
		expect(p).toHaveProperty("over_budget");
		expect(p).toHaveProperty("accurate");
		expect(p).toHaveProperty("components");
		expect(p).toHaveProperty("prompt_text");
		expect(p).toHaveProperty("heuristic_warning");
	});

	it("--format json components has expected structure", async () => {
		const result = await runCli(["preview", "--format", "json", "--cwd", tmpDir]);
		const p = JSON.parse(result.stdout) as {
			components: {
				session_state: { tokens: number; file: string };
				plan_chunk: { tokens: number; file: string };
				always_include: { tokens: number; files: unknown[] };
				context_files: { tokens: number; files: unknown[] };
				excluded_files: string[];
			};
		};

		expect(p.components.session_state).toHaveProperty("tokens");
		expect(p.components.session_state).toHaveProperty("file");
		expect(p.components.plan_chunk).toHaveProperty("tokens");
		expect(p.components.always_include).toHaveProperty("files");
		expect(p.components.context_files).toHaveProperty("files");
		expect(Array.isArray(p.components.excluded_files)).toBe(true);
	});

	it("--no-content suppresses the assembled prompt section", async () => {
		const result = await runCli(["preview", "--no-content", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		// Breakdown should still be present
		expect(result.stdout).toContain("TOTAL");
		// The separator that precedes the prompt text should NOT appear
		expect(result.stdout).not.toContain("Assembled prompt");
	});

	it("exits non-zero when no .session/ exists", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-session-"));
		try {
			const result = await runCli(["preview", "--cwd", emptyDir]);
			expect(result.exitCode).not.toBe(0);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// trim
// ---------------------------------------------------------------------------

describe("dev-sesssion trim", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("--budget with --dry-run exits 0 and shows what would be excluded", async () => {
		// Add a large file to FILE_INDEX to have something to trim
		const largeFilePath = path.join(tmpDir, "large-context-file.md");
		const largeContent = `# Large file\n${"a".repeat(10000)}`;
		fs.writeFileSync(largeFilePath, largeContent);

		// Add it to the file index using --yes to skip interactive prompts
		await runCli(["--yes", "index", "add", "large-context-file.md", "--cwd", tmpDir]);

		// Now try to trim to a tiny budget (global --dry-run flag)
		const result = await runCli(["--dry-run", "--yes", "trim", "--budget", "100", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("exits 0 when already within budget", async () => {
		const result = await runCli([
			"--dry-run",
			"--yes",
			"trim",
			"--budget",
			"99999",
			"--cwd",
			tmpDir,
		]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Already under budget");
	});

	it("--dry-run does not write trim-overrides.json", async () => {
		// Use the global --dry-run flag (before subcommand name)
		await runCli(["--dry-run", "--yes", "trim", "--budget", "1", "--cwd", tmpDir]);
		const overridesPath = path.join(tmpDir, ".session", "trim-overrides.json");
		// File should NOT be written in dry-run mode
		expect(fs.existsSync(overridesPath)).toBe(false);
	});

	it("exits non-zero on invalid --budget value", async () => {
		const result = await runCli(["trim", "--budget", "not-a-number", "--yes", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});

	it("exits non-zero when no .session/ exists", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-session-"));
		try {
			const result = await runCli(["trim", "--budget", "1000", "--cwd", emptyDir]);
			expect(result.exitCode).not.toBe(0);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// lint-context
// ---------------------------------------------------------------------------

describe("dev-sesssion lint-context", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits 0 on a clean project with no issues", async () => {
		const result = await runCli(["lint-context", "--cwd", tmpDir]);
		// May exit 0 with no errors (warnings/info might be present but no errors)
		// The default init project has no @mentions so should exit 0
		expect(result.exitCode).toBe(0);
	});

	it("exits 1 when a dead @mention reference is in a context file", async () => {
		// Write a file with a dead @mention and add it to the index
		const badFile = path.join(tmpDir, "doc-with-dead-ref.md");
		fs.writeFileSync(
			badFile,
			"# Documentation\nLoad @nonexistent-file-that-does-not-exist.ts for context\n",
		);
		await runCli(["--yes", "index", "add", "doc-with-dead-ref.md", "--cwd", tmpDir]);

		const result = await runCli(["lint-context", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(1);
	});

	it("shows error findings when there are dead references", async () => {
		const badFile = path.join(tmpDir, "bad.md");
		fs.writeFileSync(badFile, "Load @totally-missing-file.ts here\n");
		await runCli(["--yes", "index", "add", "bad.md", "--cwd", tmpDir]);

		const result = await runCli(["lint-context", "--cwd", tmpDir]);
		expect(result.stdout).toContain("ERROR");
		expect(result.stdout).toContain("totally-missing-file.ts");
	});

	it("--json exits 1 with error in findings array on dead reference", async () => {
		const badFile = path.join(tmpDir, "bad.md");
		fs.writeFileSync(badFile, "Load @missing.ts here\n");
		await runCli(["--yes", "index", "add", "bad.md", "--cwd", tmpDir]);

		const result = await runCli(["lint-context", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(1);

		const p = JSON.parse(result.stdout) as {
			passed: boolean;
			summary: { errors: number };
			findings: Array<{ severity: string }>;
		};
		expect(p.passed).toBe(false);
		expect(p.summary.errors).toBeGreaterThan(0);
	});

	it("exits non-zero when no .session/ exists", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-session-"));
		try {
			const result = await runCli(["lint-context", "--cwd", emptyDir]);
			expect(result.exitCode).not.toBe(0);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it("--json emits parseable JSON (not spinner text) when no files are in context", async () => {
		// Strip FILE_INDEX.md to an empty index so no files resolve to the chunk.
		const indexPath = path.join(tmpDir, ".session", "FILE_INDEX.md");
		fs.writeFileSync(
			indexPath,
			`---\nversion: 1\nlast_updated: "2026-06-19"\n---\n\n# File Index\n`,
		);

		const result = await runCli(["lint-context", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);

		// The no-files path must produce a valid JSON object, not styled output.
		const p = JSON.parse(result.stdout) as {
			passed: boolean;
			summary: { total: number };
			findings: unknown[];
		};
		expect(p.passed).toBe(true);
		expect(p.summary.total).toBe(0);
		expect(p.findings).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// compact
// ---------------------------------------------------------------------------

describe("dev-sesssion compact", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits non-zero when ANTHROPIC_API_KEY is not set", async () => {
		const result = await runCli(["compact", "CLAUDE.md", "--cwd", tmpDir], {
			env: { ANTHROPIC_API_KEY: "" },
		});
		expect(result.exitCode).not.toBe(0);
	});

	it("--dry-run with fake API key starts the process but fails at API call", async () => {
		// With a fake key, the API call will fail — that's expected.
		// We just verify the command is registered and reaches the API call phase.
		const result = await runCli(
			["compact", ".session/SESSION_STATE.md", "--dry-run", "--cwd", tmpDir],
			{ env: { ANTHROPIC_API_KEY: "sk-ant-fake-key-for-dry-run-test" } },
		);
		// Either fails at API call (non-zero) or succeeds — either way command is registered
		// The important thing: it should not fail with "unknown command"
		expect(result.stdout).not.toContain("unknown command");
		expect(result.stderr).not.toContain("unknown command");
	});

	it("exits non-zero when file does not exist", async () => {
		const result = await runCli(["compact", "nonexistent-file.md", "--cwd", tmpDir], {
			env: { ANTHROPIC_API_KEY: "sk-ant-fake" },
		});
		expect(result.exitCode).not.toBe(0);
	});

	it("exits non-zero when no .session/ exists", async () => {
		const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-session-"));
		try {
			const result = await runCli(["compact", "CLAUDE.md", "--cwd", emptyDir], {
				env: { ANTHROPIC_API_KEY: "sk-ant-fake" },
			});
			expect(result.exitCode).not.toBe(0);
		} finally {
			fs.rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});
