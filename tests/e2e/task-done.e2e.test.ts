/**
 * `task done` (LLD-task-done.md, REQ-TASK-1..8).
 *
 * Every handoff agent in the 2026-11-03 eval hand-edited three state files to
 * say it had finished a task.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStateManager } from "../../packages/core/src/managers/session-state-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const PLAN = `# Plan

## Chunk 1 — Setup

- [ ] Initialize project
- [ ] Configure tooling in package.json

## Chunk 2 — Core

- [ ] Build feature A
`;

let tmpDir: string;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-task-done-e2e-"));
	fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "task-e2e" }));
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
	const r = await runCli(["init", "--yes", "--cwd", tmpDir]);
	expect(r.exitCode, r.stdout + r.stderr).toBe(0);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const session = (...p: string[]): string => path.join(tmpDir, ".session", ...p);
const statusOf = (text: string): string | undefined =>
	SessionStateManager.load(session() as ValidatedPath).tasks.find((t) => t.text === text)?.status;

/** Every file in `.session/`, name → bytes. */
function snapshot(): Record<string, string> {
	return Object.fromEntries(
		fs
			.readdirSync(session())
			.filter((f) => fs.statSync(session(f)).isFile())
			.map((f) => [f, fs.readFileSync(session(f), "utf-8")]),
	);
}

describe("task done", () => {
	it("marks the n-th task done and regenerates the prompt (REQ-TASK-1, -4)", async () => {
		const r = await runCli(["task", "done", "1", "--cwd", tmpDir]);

		expect(r.exitCode, r.stdout + r.stderr).toBe(0);
		expect(statusOf("Initialize project")).toBe("done");
		expect(statusOf("Configure tooling in package.json")).not.toBe("done");
		const printed = await runCli(["prompt", "--cwd", tmpDir]);
		expect(fs.readFileSync(session("NEXT_PROMPT.md"), "utf-8").trim()).toBe(printed.stdout.trim());
		expect(printed.stdout).toContain("Configure tooling");
	});

	it("marks the one task containing the text (REQ-TASK-2)", async () => {
		const r = await runCli(["task", "done", "tooling", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(statusOf("Configure tooling in package.json")).toBe("done");
	});

	it("refuses a selector that matches nothing, lists the tasks, changes nothing (REQ-TASK-3)", async () => {
		const before = snapshot();

		const r = await runCli(["task", "done", "9", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(1);
		const out = r.stdout + r.stderr;
		expect(out).toContain("1. Initialize project");
		expect(out).toContain("2. Configure tooling in package.json");
		expect(snapshot()).toEqual(before);
	});

	it("says a done task is already done and changes nothing (REQ-TASK-5)", async () => {
		await runCli(["task", "done", "1", "--cwd", tmpDir]);
		const before = snapshot();

		const r = await runCli(["task", "done", "1", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/already done/i);
		expect(snapshot()).toEqual(before);
	});

	it("writes one JSON document, marking or refusing (REQ-TASK-6)", async () => {
		const ok = await runCli(["task", "done", "1", "--json", "--cwd", tmpDir]);
		expect(ok.exitCode).toBe(0);
		expect(JSON.parse(ok.stdout)).toEqual({
			ok: true,
			number: 1,
			task: "Initialize project",
			alreadyDone: false,
			done: 1,
			total: 2,
			chunkComplete: false,
		});

		const bad = await runCli(["task", "done", "nothing like it", "--json", "--cwd", tmpDir]);
		expect(bad.exitCode).toBe(1);
		const refused = JSON.parse(bad.stdout) as { ok: boolean; error: string; tasks: unknown[] };
		expect(refused.ok).toBe(false);
		expect(refused.tasks).toEqual([
			{ number: 1, text: "Initialize project", status: "done" },
			{ number: 2, text: "Configure tooling in package.json", status: "todo" },
		]);
	});

	it("--dry-run names the task and writes nothing (REQ-TASK-7)", async () => {
		const before = snapshot();

		const r = await runCli(["--dry-run", "task", "done", "1", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("Initialize project");
		expect(snapshot()).toEqual(before);
	});

	it("names advance when the last open task is done (REQ-TASK-8)", async () => {
		await runCli(["task", "done", "1", "--cwd", tmpDir]);

		const r = await runCli(["task", "done", "2", "--cwd", tmpDir]);
		expect(r.stdout).toContain("dev-sesssion advance");

		const json = await runCli(["task", "done", "2", "--json", "--cwd", tmpDir]);
		expect(JSON.parse(json.stdout)).toMatchObject({ chunkComplete: true, alreadyDone: true });
	});
});
