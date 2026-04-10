/**
 * E2E tests for the dev-session CLI.
 *
 * Each test runs the compiled CLI binary via `execa` — no imports of
 * CLI internals. Tests create isolated temp directories and assert on
 * exit codes, stdout, and filesystem state.
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-session-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a minimal package.json so ProjectDetector can identify the project root. */
function writePackageJson(dir: string, name = "e2e-test-project"): void {
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
}

/** Write a minimal two-chunk PLAN.md. */
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

// ---------------------------------------------------------------------------
// Meta commands
// ---------------------------------------------------------------------------

describe("dev-session --help", () => {
	it("exits 0 and prints usage", async () => {
		const result = await runCli(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("dev-session");
		expect(result.stdout).toContain("init");
	});
});

describe("dev-session --version", () => {
	it("exits 0 and prints a version string", async () => {
		const result = await runCli(["--version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
	});
});

describe("unknown command", () => {
	it("exits non-zero for an unrecognised subcommand", async () => {
		const result = await runCli(["does-not-exist"]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("dev-session init", () => {
	it("creates .session/ and core files from a PLAN.md (migration path A)", async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);

		const result = await runCli(["init", "--yes", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);

		const session = path.join(tmpDir, ".session");
		expect(fs.existsSync(session)).toBe(true);
		expect(fs.existsSync(path.join(session, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "PLAN_2.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "SESSION_STATE.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "FILE_INDEX.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "NEXT_PROMPT.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "ROUTINES.md"))).toBe(true);
	});

	it("SESSION_STATE.md has correct active_chunk and task text", async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);

		await runCli(["init", "--yes", "--cwd", tmpDir]);

		const state = fs.readFileSync(path.join(tmpDir, ".session", "SESSION_STATE.md"), "utf-8");
		expect(state).toContain("active_chunk: 1");
		expect(state).toContain("Initialize project");
	});

	it("produces no filesystem changes with --dry-run", async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);

		const result = await runCli(["init", "--yes", "--dry-run", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(tmpDir, ".session"))).toBe(false);
	});

	it("scaffolds a plan when no PLAN.md exists (migration path B)", async () => {
		writePackageJson(tmpDir);
		// No PLAN.md — scaffold mode

		const result = await runCli(["init", "--yes", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);
		const session = path.join(tmpDir, ".session");
		expect(fs.existsSync(path.join(session, "PLAN_1.md"))).toBe(true);
		expect(fs.existsSync(path.join(session, "SESSION_STATE.md"))).toBe(true);
	});

	it("is idempotent — re-running init on an existing session exits cleanly", async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);

		await runCli(["init", "--yes", "--cwd", tmpDir]);
		const result = await runCli(["init", "--yes", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// status (requires an initialised session)
// ---------------------------------------------------------------------------

describe("dev-session status", () => {
	beforeEach(async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);
		await runCli(["init", "--yes", "--cwd", tmpDir]);
	});

	it("exits 0 and shows task percentage", async () => {
		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/\d+(\.\d+)?%|0 of \d+/);
	});

	it("--json outputs valid JSON with required fields", async () => {
		const result = await runCli(["status", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);

		const json = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(json).toHaveProperty("active_chunk");
		expect(json).toHaveProperty("session_id");
		expect(json).toHaveProperty("tasks");
		expect(json).toHaveProperty("budget");
	});
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("dev-session health", () => {
	beforeEach(async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);
		await runCli(["init", "--yes", "--cwd", tmpDir]);
	});

	it("exits 0 on a freshly initialised session", async () => {
		const result = await runCli(["health", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("--json outputs valid JSON with expected fields", async () => {
		const result = await runCli(["health", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);

		const json = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(json).toHaveProperty("healthy");
		expect(json).toHaveProperty("issues");
		expect(Array.isArray(json.issues)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// prompt
// ---------------------------------------------------------------------------

describe("dev-session prompt", () => {
	beforeEach(async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);
		await runCli(["init", "--yes", "--cwd", tmpDir]);
	});

	it("exits 0 and prints NEXT_PROMPT content to stdout", async () => {
		const result = await runCli(["prompt", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		// The prompt includes the project name or chunk marker
		expect(result.stdout.length).toBeGreaterThan(0);
	});

	it("stdout matches the contents of NEXT_PROMPT.md", async () => {
		const result = await runCli(["prompt", "--cwd", tmpDir]);
		const promptFile = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
		// stdout should contain at least the first meaningful line
		const firstLine = promptFile.split("\n").find((l) => l.trim().length > 0) ?? "";
		expect(result.stdout).toContain(firstLine.trim());
	});
});

// ---------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------

describe("dev-session index audit", () => {
	beforeEach(async () => {
		writePackageJson(tmpDir);
		writePlan(tmpDir);
		await runCli(["init", "--yes", "--cwd", tmpDir]);
	});

	it("exits 0 on a fresh session with no stale entries", async () => {
		const result = await runCli(["index", "audit", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});
});
