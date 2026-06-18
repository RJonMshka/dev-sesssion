/**
 * E2E tests for chunk 12 — Session memory & analytics commands:
 * memory show, memory stats, memory stale, memory prune.
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-mem-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson(dir: string, name = "mem-test-project"): void {
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
		].join("\n"),
	);
}

async function initProject(dir: string): Promise<void> {
	writePackageJson(dir);
	writePlan(dir);
	await runCli(["init", "--yes", "--cwd", dir]);
}

interface LogEntry {
	session_id: string;
	timestamp: string;
	active_chunk: number;
	files_loaded: string[];
	total_tokens: number;
	modifications: string[];
}

/** Write CONTEXT_LOG.md directly (without importing core). */
function seedLog(dir: string, entries: LogEntry[]): void {
	const logPath = path.join(dir, ".session", "CONTEXT_LOG.md");
	const json = JSON.stringify(entries, null, 2);
	fs.writeFileSync(logPath, `entries: ${json}\n`);
}

function readLog(dir: string): LogEntry[] {
	const logPath = path.join(dir, ".session", "CONTEXT_LOG.md");
	if (!fs.existsSync(logPath)) return [];
	const content = fs.readFileSync(logPath, "utf8").trim();
	if (content === "" || content === "entries: []") return [];
	const match = /^entries:\s*(\[[\s\S]*\])$/m.exec(content);
	if (!match) return [];
	return JSON.parse(match[1] as string) as LogEntry[];
}

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		session_id: "chunk-1-setup",
		timestamp: "2026-04-01T10:00:00.000Z",
		active_chunk: 1,
		files_loaded: ["CLAUDE.md", ".session/SESSION_STATE.md"],
		total_tokens: 1200,
		modifications: ["src/index.ts"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// memory show
// ---------------------------------------------------------------------------

describe("dev-sesssion memory show", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits 0 with no entries and shows helpful message", async () => {
		const result = await runCli(["memory", "show", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("no session memory entries");
	});

	it("exits 0 and displays entries when log has data", async () => {
		seedLog(tmpDir, [
			makeEntry({
				timestamp: "2026-04-01T10:00:00.000Z",
				total_tokens: 800,
				modifications: ["src/a.ts"],
			}),
		]);

		const result = await runCli(["memory", "show", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("chunk=1");
		expect(result.stdout).toContain("tokens=800");
	});

	it("respects --limit flag", async () => {
		seedLog(tmpDir, [
			makeEntry({ timestamp: "2026-04-01T10:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-02T10:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-03T10:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-04T10:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-05T10:00:00.000Z" }),
		]);

		const result = await runCli(["memory", "show", "--limit", "2", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Showing 2 most recent");
	});
});

// ---------------------------------------------------------------------------
// memory stats
// ---------------------------------------------------------------------------

describe("dev-sesssion memory stats", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits 0 with no entries and shows helpful message", async () => {
		const result = await runCli(["memory", "stats", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("no session memory entries");
	});

	it("--json exits 0 and outputs valid JSON on a fixture log file", async () => {
		seedLog(tmpDir, [
			makeEntry({ timestamp: "2026-04-01T10:00:00.000Z", total_tokens: 1000 }),
			makeEntry({ timestamp: "2026-04-02T10:00:00.000Z", total_tokens: 2000 }),
			makeEntry({ timestamp: "2026-04-03T10:00:00.000Z", total_tokens: 3000 }),
		]);

		const result = await runCli(["memory", "stats", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(() => JSON.parse(result.stdout)).not.toThrow();

		const stats = JSON.parse(result.stdout) as Record<string, unknown>;
		expect(stats).toHaveProperty("totalSessions", 3);
		expect(stats).toHaveProperty("avgTokens", 2000);
		expect(stats).toHaveProperty("firstDate", "2026-04-01");
		expect(stats).toHaveProperty("lastDate", "2026-04-03");
		expect(stats).toHaveProperty("topFiles");
	});

	it("shows human-readable output with correct session count", async () => {
		seedLog(tmpDir, [makeEntry({ timestamp: "2026-04-01T10:00:00.000Z", total_tokens: 1500 })]);

		const result = await runCli(["memory", "stats", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Total sessions");
	});
});

// ---------------------------------------------------------------------------
// memory stale
// ---------------------------------------------------------------------------

describe("dev-sesssion memory stale", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("exits 0 with no entries and shows helpful message", async () => {
		const result = await runCli(["memory", "stale", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("No session memory entries");
	});

	it("exits 0 and shows no stale files when always-include files are modified", async () => {
		// Use the exact always-include paths that init creates (CLAUDE.md + SESSION_STATE.md)
		seedLog(tmpDir, [
			makeEntry({
				timestamp: "2026-04-01T10:00:00.000Z",
				files_loaded: ["CLAUDE.md"],
				modifications: ["CLAUDE.md"],
			}),
			makeEntry({
				timestamp: "2026-04-02T10:00:00.000Z",
				files_loaded: ["CLAUDE.md"],
				modifications: ["CLAUDE.md"],
			}),
			makeEntry({
				timestamp: "2026-04-03T10:00:00.000Z",
				files_loaded: ["CLAUDE.md"],
				modifications: ["CLAUDE.md"],
			}),
		]);

		const result = await runCli(["memory", "stale", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		// CLAUDE.md is modified → not stale
		expect(result.stdout).not.toContain("CLAUDE.md");
	});

	it("--threshold 2 flags files loaded but never modified in fixture", async () => {
		// CLAUDE.md is in always-include but never modified
		seedLog(tmpDir, [
			makeEntry({
				timestamp: "2026-04-01T10:00:00.000Z",
				files_loaded: ["CLAUDE.md", ".session/SESSION_STATE.md"],
				modifications: [],
			}),
			makeEntry({
				timestamp: "2026-04-02T10:00:00.000Z",
				files_loaded: ["CLAUDE.md", ".session/SESSION_STATE.md"],
				modifications: [],
			}),
		]);

		const result = await runCli(["memory", "stale", "--threshold", "2", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		// Should have flagged something
		expect(result.stdout).toMatch(/flagged|remove|stale/i);
	});
});

// ---------------------------------------------------------------------------
// memory prune
// ---------------------------------------------------------------------------

describe("dev-sesssion memory prune", () => {
	beforeEach(async () => {
		await initProject(tmpDir);
	});

	it("--dry-run exits 0 and does not modify the log", async () => {
		seedLog(tmpDir, [
			makeEntry({ timestamp: "2025-01-01T00:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-01T00:00:00.000Z" }),
		]);

		// --dry-run is a global flag (before the subcommand)
		const result = await runCli([
			"--dry-run",
			"--cwd",
			tmpDir,
			"memory",
			"prune",
			"--older-than",
			"30d",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("dry-run");

		// Log should be unchanged
		const entries = readLog(tmpDir);
		expect(entries).toHaveLength(2);
	});

	it("removes entries older than duration", async () => {
		seedLog(tmpDir, [
			makeEntry({ timestamp: "2025-01-01T00:00:00.000Z" }),
			makeEntry({ timestamp: "2026-04-01T00:00:00.000Z" }),
		]);

		const result = await runCli(["memory", "prune", "--older-than", "30d", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Removed");

		// 2025 entry is older than 30d from 2026-04-13
		const entries = readLog(tmpDir);
		expect(entries.every((e) => e.timestamp >= "2026")).toBe(true);
	});

	it("exits with error when --older-than is missing", async () => {
		const result = await runCli(["memory", "prune", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});
});
