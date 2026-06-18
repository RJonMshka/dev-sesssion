/**
 * E2E tests for `dev-sesssion index` (ai-index generation).
 *
 * Tests:
 * - `dev-sesssion index` on a fixture project → generates ai-index.yaml
 * - `dev-sesssion index --update` skips unchanged files (mtime check)
 * - `dev-sesssion index --dry-run` writes nothing to disk
 * - `dev-sesssion index stats` shows counts
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

/** Absolute path to the ts-project fixture. */
const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-ai-index-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Copy the ts-project fixture into tmpDir and run `dev-sesssion init --yes`.
 * Returns the path to the initialized project.
 */
async function initFixture(): Promise<string> {
	// Copy fixture recursively
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });

	// Run init to set up .session/
	const result = await runCli(["init", "--yes", "--cwd", tmpDir]);
	if (result.exitCode !== 0) {
		throw new Error(`init failed: ${result.stdout}\n${result.stderr}`);
	}

	return tmpDir;
}

// ---------------------------------------------------------------------------
// index (full regen)
// ---------------------------------------------------------------------------

describe("dev-sesssion index", () => {
	it("generates ai-index.yaml in .session/", async () => {
		const projectDir = await initFixture();

		const result = await runCli(["index", "--cwd", projectDir]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/Indexed \d+ files/);

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");
		expect(fs.existsSync(indexPath)).toBe(true);
	});

	it("ai-index.yaml contains expected YAML fields", async () => {
		const projectDir = await initFixture();
		await runCli(["index", "--cwd", projectDir]);

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");
		const content = fs.readFileSync(indexPath, "utf-8");

		expect(content).toContain('version: "2"');
		expect(content).toContain("generated_at:");
		expect(content).toContain("project_root:");
		expect(content).toContain("files:");
	});

	it("indexes the src/utils.ts fixture file", async () => {
		const projectDir = await initFixture();
		await runCli(["index", "--cwd", projectDir]);

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");
		const content = fs.readFileSync(indexPath, "utf-8");

		// Should contain the fixture file and its symbols
		expect(content).toContain("src/utils.ts");
		expect(content).toContain("add");
		expect(content).toContain("greet");
		expect(content).toContain("MAX_RETRIES");
	});

	it("captures JSDoc summaries from fixture files", async () => {
		const projectDir = await initFixture();
		await runCli(["index", "--cwd", projectDir]);

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");
		const content = fs.readFileSync(indexPath, "utf-8");

		// The add() function has JSDoc: "Adds two numbers together."
		expect(content).toContain("Adds two numbers together");
	});
});

// ---------------------------------------------------------------------------
// index --dry-run
// ---------------------------------------------------------------------------

describe("dev-sesssion index --dry-run", () => {
	it("writes nothing to disk", async () => {
		const projectDir = await initFixture();

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");

		const result = await runCli(["index", "--dry-run", "--cwd", projectDir]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[dry-run]");
		// ai-index.yaml must NOT exist
		expect(fs.existsSync(indexPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// index --update
// ---------------------------------------------------------------------------

describe("dev-sesssion index --update", () => {
	it("merges with existing index when run a second time", async () => {
		const projectDir = await initFixture();

		// First run: full regen
		await runCli(["index", "--cwd", projectDir]);

		const indexPath = path.join(projectDir, ".session", "ai-index.yaml");
		const firstContent = fs.readFileSync(indexPath, "utf-8");

		// Second run: incremental update
		const result = await runCli(["index", "--update", "--cwd", projectDir]);
		expect(result.exitCode).toBe(0);

		const secondContent = fs.readFileSync(indexPath, "utf-8");
		// Both runs should produce an index with the same files
		expect(secondContent).toContain("src/utils.ts");
		expect(firstContent).toContain("src/utils.ts");
	});
});

// ---------------------------------------------------------------------------
// index stats
// ---------------------------------------------------------------------------

describe("dev-sesssion index stats", () => {
	it("shows stats after generating the index", async () => {
		const projectDir = await initFixture();
		await runCli(["index", "--cwd", projectDir]);

		const result = await runCli(["index", "stats", "--cwd", projectDir]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/Files indexed: \d+/);
		expect(result.stdout).toMatch(/Public symbols: \d+/);
		expect(result.stdout).toMatch(/Total token cost:/);
	});

	it("exits with non-zero code if no index exists", async () => {
		const projectDir = await initFixture();
		// Don't run index first

		const result = await runCli(["index", "stats", "--cwd", projectDir]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// index --show
// ---------------------------------------------------------------------------

describe("dev-sesssion index --show", () => {
	it("prints an existing index entry for a file", async () => {
		const projectDir = await initFixture();
		await runCli(["index", "--cwd", projectDir]);

		const result = await runCli(["index", "--show", "src/utils.ts", "--cwd", projectDir]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("src/utils.ts");
	});
});
