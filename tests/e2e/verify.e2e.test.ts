/**
 * E2E tests for `dev-sesssion verify`.
 *
 * Runs the compiled CLI against real temp projects — one plain directory and
 * one real git repository — so the git-backed paths are exercised end to end
 * rather than through an injected fake.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

let tmpDir: string;

/**
 * Runs a git command in the fixture project.
 *
 * @param args - Arguments passed to git.
 */
function git(args: string[]): void {
	execFileSync("git", args, { cwd: tmpDir, stdio: "ignore" });
}

/** Writes the minimal project files `init` expects. */
function writeProject(): void {
	fs.writeFileSync(
		path.join(tmpDir, "package.json"),
		JSON.stringify({ name: "verify-fixture", version: "1.0.0" }, null, 2),
	);
	fs.writeFileSync(
		path.join(tmpDir, "PLAN.md"),
		["# Plan", "", "## Chunk 1 — Setup", "", "- [ ] Initialize project", ""].join("\n"),
	);
	fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "src", "a.ts"), "export const a = 1;\n");
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-verify-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("dev-sesssion verify", () => {
	it("reports that history checks were skipped outside a git repo", async () => {
		writeProject();
		expect((await runCli(["init", "--yes", "--cwd", tmpDir])).ok).toBe(true);

		const result = await runCli(["verify", "--json", "--cwd", tmpDir]);
		const payload = JSON.parse(result.stdout) as {
			ok: boolean;
			gitAvailable: boolean;
			findings: Array<{ code: string }>;
		};

		expect(payload.gitAvailable).toBe(false);
		expect(payload.findings[0]?.code).toBe("NOT_A_REPO");
		expect(result.exitCode).toBe(0);
	});

	it("reconciles a real repository and emits valid JSON", async () => {
		writeProject();
		git(["init", "--initial-branch=main"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test"]);
		git(["add", "."]);
		git(["commit", "-m", "initial"]);

		expect((await runCli(["init", "--yes", "--cwd", tmpDir])).ok).toBe(true);

		const result = await runCli(["verify", "--json", "--cwd", tmpDir]);
		const payload = JSON.parse(result.stdout) as {
			gitAvailable: boolean;
			checksRun: number;
			findings: unknown[];
		};

		expect(payload.gitAvailable).toBe(true);
		expect(payload.checksRun).toBeGreaterThan(0);
		expect(Array.isArray(payload.findings)).toBe(true);
	});

	it("includes replay results when --replay is passed", async () => {
		writeProject();
		git(["init", "--initial-branch=main"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test"]);
		git(["add", "."]);
		git(["commit", "-m", "initial"]);

		expect((await runCli(["init", "--yes", "--cwd", tmpDir])).ok).toBe(true);

		const result = await runCli(["verify", "--replay", "--json", "--cwd", tmpDir]);
		const payload = JSON.parse(result.stdout) as {
			replay?: { boundariesScored: number };
		};

		expect(payload.replay).toBeDefined();
		expect(payload.replay?.boundariesScored).toBe(0);
	});

	it("omits replay results by default", async () => {
		writeProject();
		expect((await runCli(["init", "--yes", "--cwd", tmpDir])).ok).toBe(true);

		const result = await runCli(["verify", "--json", "--cwd", tmpDir]);
		expect(JSON.parse(result.stdout)).not.toHaveProperty("replay");
	});

	it("appears in the command list", async () => {
		const result = await runCli(["--help"]);
		expect(result.stdout).toContain("verify");
	});
});
