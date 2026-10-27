/**
 * The workflow-shaped prompt through the built CLI (LLD-workflow-prompt.md
 * Part C). State is changed with core's own writers, never hand-written YAML.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../packages/core/src/managers/session-manager.js";
import { SessionStateManager } from "../../packages/core/src/managers/session-state-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

const PLAN = `# Plan

## Chunk 1 — Client

- [ ] Add retries to src/client.ts
- [ ] Add a timeout to src/client.ts

## Chunk 2 — Arithmetic

- [ ] Make add reject NaN in src/utils.ts
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-workflow-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sessionDir = (): ValidatedPath => path.join(tmpDir, ".session") as ValidatedPath;
const readPrompt = (): string =>
	fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
const cli = async (...args: string[]): Promise<void> => {
	const r = await runCli([...args, "--cwd", tmpDir]);
	expect(r.exitCode, r.stderr).toBe(0);
};

describe("the prompt after a task is recorded done", () => {
	it("moves the position and counts what is left (REQ-WF-7, REQ-WF-12, REQ-WF-14)", async () => {
		await cli("init", "--yes");
		expect(readPrompt()).toContain("Next (task 1 of 2):");

		SessionManager.create(tmpDir).markTaskDone("Add retries to src/client.ts");
		await cli("index");

		const prompt = readPrompt();
		expect(prompt).toContain("Next (task 2 of 2):");
		expect(prompt).toMatch(/^Done when: all 2 tasks are done \(1 left\)/m);
	});

	it("says the chunk is done and names advance once every task is (REQ-WF-15)", async () => {
		await cli("init", "--yes");
		const session = SessionManager.create(tmpDir);
		session.markTaskDone("Add retries to src/client.ts");
		session.markTaskDone("Add a timeout to src/client.ts");
		await cli("index");

		const prompt = readPrompt();
		expect(prompt).toMatch(/^Chunk done: .*`dev-sesssion advance`/m);
		expect(prompt).not.toMatch(/^Next|^Done when:/m);
	});
});

describe("a workflow in SESSION_STATE.md", () => {
	it("reaches the prompt as one Each task line (REQ-WF-16, REQ-WF-18)", async () => {
		await cli("init", "--yes");
		const state = SessionStateManager.load(sessionDir());
		SessionStateManager.save(sessionDir(), {
			...state,
			workflow: ["Write a failing test", "Make it pass"],
		});
		await cli("index");

		const prompt = readPrompt();
		expect(prompt).toMatch(/^Each task: 1\. Write a failing test 2\. Make it pass$/m);
		expect(prompt.trimEnd().split("\n").length).toBeLessThanOrEqual(20);

		const health = await runCli(["health", "--cwd", tmpDir]);
		expect(health.stdout + health.stderr).not.toMatch(/workflow/i);
	});
});
