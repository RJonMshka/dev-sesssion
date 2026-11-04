/**
 * The session instructions adapters write (LLD-task-done.md, REQ-TASK-9..14).
 *
 * They told the agent to confirm before writing code and to rewrite
 * NEXT_PROMPT.md by hand, while the CLI regenerates it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionLoopLines } from "../../packages/core/src/adapters/session-loop.js";
import { runCli } from "../helpers/run-cli.js";

const PLAN = "# Plan\n\n## Chunk 1 — Setup\n\n- [ ] Initialize project\n";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-loop-e2e-"));
	fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "loop-e2e" }));
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ADAPTERS = [
	{ name: "claude", file: "CLAUDE.md", style: "markdown" },
	{ name: "opencode", file: "AGENTS.md", style: "markdown" },
	{ name: "cursor", file: ".cursorrules", style: "plain" },
	{ name: "windsurf", file: ".windsurfrules", style: "plain" },
] as const;

/** The managed block's text, between the markers. */
function block(file: string): string {
	const text = fs.readFileSync(path.join(tmpDir, file), "utf-8");
	const start = text.indexOf("dev-sesssion:start");
	const end = text.indexOf("dev-sesssion:end");
	expect(start, `${file} has a managed block`).toBeGreaterThanOrEqual(0);
	return text.slice(start, end);
}

describe.each(ADAPTERS)("init --adapter $name", ({ name, file, style }) => {
	it("tells the agent the CLI loop, from the one core source (REQ-TASK-9, -13, -14)", async () => {
		const r = await runCli(["init", "--yes", "--adapter", name, "--cwd", tmpDir]);
		expect(r.exitCode, r.stdout + r.stderr).toBe(0);

		const text = block(file);
		for (const line of sessionLoopLines(".session", style)) expect(text).toContain(line);
		expect(text).toContain("NEXT_PROMPT.md");
		expect(text).toContain("npx dev-sesssion task done");
		expect(text).toContain("npx dev-sesssion update --yes");
	});

	it("does not tell the agent to confirm, or to keep .session/ by hand (REQ-TASK-10, -11, -12)", async () => {
		await runCli(["init", "--yes", "--adapter", name, "--cwd", tmpDir]);

		const text = block(file);
		expect(text).not.toMatch(/confirm/i);
		expect(text).not.toMatch(/rewrite/i);
		expect(text).not.toMatch(/update `?SESSION_STATE/i);
		expect(text).toMatch(/cannot run commands/i);
	});
});

describe("ROUTINES.md", () => {
	it("carries the same instructions and asks for no confirmation (REQ-TASK-14, -11)", async () => {
		await runCli(["init", "--yes", "--cwd", tmpDir]);

		const routines = fs.readFileSync(path.join(tmpDir, ".session", "ROUTINES.md"), "utf-8");
		for (const line of sessionLoopLines(".session", "markdown")) expect(routines).toContain(line);
		expect(routines).not.toMatch(/confirm/i);
	});
});
