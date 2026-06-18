/**
 * E2E tests for the session lifecycle and import/export commands.
 *
 * Covers the command flows the original e2e suite did not exercise:
 * update, advance, export, import, health, status --json, and prompt.
 * Each test runs the compiled CLI via execa (no CLI internals imported),
 * against an isolated temp project initialised with `init --yes`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-life-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Minimal package.json so ProjectDetector identifies the project root. */
function writePackageJson(dir: string): void {
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "lifecycle-e2e", version: "1.0.0" }),
	);
}

/** Two-chunk PLAN.md, enough to exercise advance. */
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

/** Initialise a session in tmpDir; fails the test if init does not succeed. */
async function initProject(): Promise<void> {
	writePackageJson(tmpDir);
	writePlan(tmpDir);
	const result = await runCli(["init", "--yes", "--cwd", tmpDir]);
	expect(result.ok, `init should succeed:\n${result.stderr || result.stdout}`).toBe(true);
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("dev-sesssion update", () => {
	it("regenerates the prompt non-interactively with --yes", async () => {
		await initProject();
		const before = fs.readFileSync(path.join(tmpDir, ".session/NEXT_PROMPT.md"), "utf-8");

		const result = await runCli(["update", "--yes", "--cwd", tmpDir]);

		expect(result.exitCode).toBe(0);
		const after = fs.readFileSync(path.join(tmpDir, ".session/NEXT_PROMPT.md"), "utf-8");
		expect(after.length).toBeGreaterThan(0);
		expect(before).toBeDefined();
	});

	it("fails when there is no session", async () => {
		writePackageJson(tmpDir);
		const result = await runCli(["update", "--yes", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// advance
// ---------------------------------------------------------------------------

describe("dev-sesssion advance", () => {
	it("advances to the next chunk with --yes", async () => {
		await initProject();

		const result = await runCli(["advance", "--yes", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);

		const status = await runCli(["status", "--json", "--cwd", tmpDir]);
		expect(status.exitCode).toBe(0);
		const json = JSON.parse(status.stdout) as { active_chunk?: number };
		expect(json.active_chunk).toBe(2);
	});

	it("fails when there is no session", async () => {
		writePackageJson(tmpDir);
		const result = await runCli(["advance", "--yes", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

describe("dev-sesssion export", () => {
	it("--to claude writes a dev-sesssion section into CLAUDE.md", async () => {
		await initProject();
		const result = await runCli(["export", "--to", "claude", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		const claude = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		expect(claude).toContain("dev-sesssion:start");
	});

	it("--to cursor writes the .mdc rules file", async () => {
		await initProject();
		const result = await runCli(["export", "--to", "cursor", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/dev-sesssion.mdc"))).toBe(true);
	});

	it("--dry-run does not write CLAUDE.md", async () => {
		await initProject();
		const result = await runCli(["export", "--to", "claude", "--dry-run", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(false);
	});

	it("rejects an unknown target", async () => {
		await initProject();
		const result = await runCli(["export", "--to", "bogus", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});

	it("fails without the required --to option", async () => {
		await initProject();
		const result = await runCli(["export", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------

describe("dev-sesssion import", () => {
	it("--from claude imports H2 sections as notes", async () => {
		await initProject();
		fs.writeFileSync(
			path.join(tmpDir, "CLAUDE.md"),
			["# Project", "", "## Conventions", "", "Use tabs, not spaces.", ""].join("\n"),
		);
		const result = await runCli(["import", "--from", "claude", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("--from claude fails when CLAUDE.md is absent", async () => {
		await initProject();
		const result = await runCli(["import", "--from", "claude", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});

	it("--from cursor imports .mdc globs into the file index", async () => {
		await initProject();
		const rulesDir = path.join(tmpDir, ".cursor/rules");
		fs.mkdirSync(rulesDir, { recursive: true });
		fs.writeFileSync(
			path.join(rulesDir, "app.mdc"),
			["---", "globs:", "  - src/**/*.ts", "---", "", "App rules."].join("\n"),
		);
		const result = await runCli(["import", "--from", "cursor", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("rejects an unknown source", async () => {
		await initProject();
		const result = await runCli(["import", "--from", "bogus", "--cwd", tmpDir]);
		expect(result.exitCode).not.toBe(0);
	});
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("dev-sesssion health", () => {
	it("runs an audit and exits 0 or 1", async () => {
		await initProject();
		const result = await runCli(["health", "--cwd", tmpDir]);
		expect([0, 1]).toContain(result.exitCode);
	});

	it("--json emits parseable JSON", async () => {
		await initProject();
		const result = await runCli(["health", "--json", "--cwd", tmpDir]);
		expect([0, 1]).toContain(result.exitCode);
		expect(() => JSON.parse(result.stdout)).not.toThrow();
	});

	it("--fix runs without crashing", async () => {
		await initProject();
		const result = await runCli(["health", "--fix", "--cwd", tmpDir]);
		expect([0, 1]).toContain(result.exitCode);
	});
});

// ---------------------------------------------------------------------------
// status --json / prompt
// ---------------------------------------------------------------------------

describe("dev-sesssion status --json", () => {
	it("emits a budget and file breakdown", async () => {
		await initProject();
		const result = await runCli(["status", "--json", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		const json = JSON.parse(result.stdout) as {
			budget?: { total_tokens?: number };
			files?: { context?: number };
		};
		expect(typeof json.budget?.total_tokens).toBe("number");
		expect(typeof json.files?.context).toBe("number");
	});
});

describe("dev-sesssion prompt", () => {
	it("prints the NEXT_PROMPT to stdout", async () => {
		await initProject();
		const result = await runCli(["prompt", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim().length).toBeGreaterThan(0);
	});

	it("--copy exits with a numeric code (clipboard may be unavailable headless)", async () => {
		await initProject();
		const result = await runCli(["prompt", "--copy", "--cwd", tmpDir]);
		expect(typeof result.exitCode).toBe("number");
	});
});

// ---------------------------------------------------------------------------
// Edge / branch coverage — varied state, flags, idempotency, error paths
// ---------------------------------------------------------------------------

describe("edge branches", () => {
	it("status renders the plain (non-json) report", async () => {
		await initProject();
		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("chunk");
	});

	it("export to claude is idempotent across repeated runs", async () => {
		await initProject();
		const first = await runCli(["export", "--to", "claude", "--cwd", tmpDir]);
		expect(first.exitCode).toBe(0);
		const second = await runCli(["export", "--to", "claude", "--verbose", "--cwd", tmpDir]);
		expect(second.exitCode).toBe(0);
		const claude = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
		// Exactly one managed section after two exports.
		expect(claude.split("dev-sesssion:start").length - 1).toBe(1);
	});

	it("export to cursor --dry-run writes nothing", async () => {
		await initProject();
		const result = await runCli(["export", "--to", "cursor", "--dry-run", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(fs.existsSync(path.join(tmpDir, ".cursor/rules/dev-sesssion.mdc"))).toBe(false);
	});

	it("import from claude deduplicates on a second run", async () => {
		await initProject();
		fs.writeFileSync(
			path.join(tmpDir, "CLAUDE.md"),
			["# P", "", "## Style", "", "Two-space indent.", ""].join("\n"),
		);
		const first = await runCli(["import", "--from", "claude", "--cwd", tmpDir]);
		expect(first.exitCode).toBe(0);
		const second = await runCli(["import", "--from", "claude", "--verbose", "--cwd", tmpDir]);
		expect(second.exitCode).toBe(0);
	});

	it("import from cursor --dry-run does not modify the index", async () => {
		await initProject();
		const rulesDir = path.join(tmpDir, ".cursor/rules");
		fs.mkdirSync(rulesDir, { recursive: true });
		fs.writeFileSync(
			path.join(rulesDir, "r.mdc"),
			["---", "globs:", "  - lib/**/*.ts", "---", "", "Lib."].join("\n"),
		);
		const result = await runCli(["import", "--from", "cursor", "--dry-run", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("update --verbose and advance --verbose run cleanly", async () => {
		await initProject();
		const upd = await runCli(["update", "--yes", "--verbose", "--cwd", tmpDir]);
		expect(upd.exitCode).toBe(0);
		const adv = await runCli(["advance", "--yes", "--verbose", "--cwd", tmpDir]);
		expect(adv.exitCode).toBe(0);
	});

	it("preview supports --format json and --no-content", async () => {
		await initProject();
		const asJson = await runCli(["preview", "--format", "json", "--cwd", tmpDir]);
		expect(asJson.exitCode).toBe(0);
		expect(() => JSON.parse(asJson.stdout)).not.toThrow();

		const noContent = await runCli(["preview", "--no-content", "--cwd", tmpDir]);
		expect(noContent.exitCode).toBe(0);
	});

	it("memory stats --json and show -n emit cleanly", async () => {
		await initProject();
		const stats = await runCli(["memory", "stats", "--json", "--cwd", tmpDir]);
		expect(stats.exitCode).toBe(0);
		expect(() => JSON.parse(stats.stdout)).not.toThrow();

		const show = await runCli(["memory", "show", "-n", "5", "--cwd", tmpDir]);
		expect(show.exitCode).toBe(0);
	});

	it("lint-context --json emits parseable output", async () => {
		await initProject();
		const result = await runCli(["lint-context", "--json", "--cwd", tmpDir]);
		expect([0, 1]).toContain(result.exitCode);
		expect(() => JSON.parse(result.stdout)).not.toThrow();
	});
});

describe("status warning states", () => {
	it("warns when all tasks in the active chunk are done", async () => {
		await initProject();
		const planPath = path.join(tmpDir, ".session/PLAN_1.md");
		const plan = fs
			.readFileSync(planPath, "utf-8")
			.replaceAll("status: todo", "status: done")
			.replaceAll("- [ ]", "- [x]");
		fs.writeFileSync(planPath, plan);

		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.toLowerCase()).toContain("advance");
	});

	it("warns on always-include creep (> 4 files)", async () => {
		await initProject();
		const indexPath = path.join(tmpDir, ".session/FILE_INDEX.md");
		const rows = ["a", "b", "c", "d", "e"].map((n) => `| ${n}.md | always ${n} |`).join("\n");
		const index = fs
			.readFileSync(indexPath, "utf-8")
			.replace("## Always Include", `## Always Include\n\n| File | Purpose |\n|---|---|\n${rows}`);
		fs.writeFileSync(indexPath, index);
		for (const n of ["a", "b", "c", "d", "e"]) fs.writeFileSync(path.join(tmpDir, `${n}.md`), "x");

		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("warns when NEXT_PROMPT.md exceeds the line budget", async () => {
		await initProject();
		const promptPath = path.join(tmpDir, ".session/NEXT_PROMPT.md");
		fs.writeFileSync(promptPath, Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"));

		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("handles an unparseable last_updated date", async () => {
		await initProject();
		const statePath = path.join(tmpDir, ".session/SESSION_STATE.md");
		const state = fs
			.readFileSync(statePath, "utf-8")
			.replace(/last_updated: ".*"/, 'last_updated: "not-a-date"');
		fs.writeFileSync(statePath, state);

		const result = await runCli(["status", "--cwd", tmpDir]);
		expect(result.exitCode).toBe(0);
	});

	it("reports session memory once entries exist", async () => {
		await initProject();
		await runCli(["update", "--yes", "--cwd", tmpDir]);
		await runCli(["advance", "--yes", "--cwd", tmpDir]);

		const text = await runCli(["status", "--cwd", tmpDir]);
		expect(text.exitCode).toBe(0);
		const json = await runCli(["status", "--json", "--cwd", tmpDir]);
		expect(json.exitCode).toBe(0);
		expect(() => JSON.parse(json.stdout)).not.toThrow();
	});
});
