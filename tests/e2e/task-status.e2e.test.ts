/**
 * One task status (LLD-workflow-prompt.md Part B, REQ-WF-7, -9).
 *
 * `update` and MCP `mark_task_done` record status in SESSION_STATE.md; the
 * prompt and `status` read PLAN_N.md. Marking a task done changed nothing a
 * user could see, and `advance` left the previous chunk's tasks in state.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanChunkManager } from "../../packages/core/src/managers/plan-chunk-manager.js";
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
- [ ] Document add
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-task-status-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sessionDir = (): ValidatedPath => path.join(tmpDir, ".session") as ValidatedPath;
const readPrompt = (): string =>
	fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");

describe("a task marked done in SESSION_STATE.md", () => {
	it("is counted done by the prompt and by status (REQ-WF-7)", async () => {
		expect((await runCli(["init", "--yes", "--cwd", tmpDir])).exitCode).toBe(0);
		expect(readPrompt()).toContain("0/2");

		expect(SessionManager.create(tmpDir).markTaskDone("Add retries to src/client.ts").matched).toBe(
			true,
		);
		expect((await runCli(["index", "--cwd", tmpDir])).exitCode).toBe(0);

		const prompt = readPrompt();
		expect(prompt).toContain("1/2");
		expect(prompt).not.toContain("[ ] Add retries to src/client.ts");

		const status = await runCli(["status", "--json", "--cwd", tmpDir]);
		const json = JSON.parse(status.stdout) as { tasks: { done: number; total: number } };
		expect(json.tasks).toMatchObject({ done: 1, total: 2 });
	});
});

describe("advance", () => {
	it("leaves SESSION_STATE.md holding the new chunk's tasks (REQ-WF-9)", async () => {
		await runCli(["init", "--yes", "--cwd", tmpDir]);
		SessionManager.create(tmpDir).markTaskDone("Add retries to src/client.ts");

		expect((await runCli(["advance", "--yes", "--cwd", tmpDir])).exitCode).toBe(0);

		const state = SessionStateManager.load(sessionDir());
		expect(state.active_chunk).toBe(2);
		const plan2 = PlanChunkManager.loadAll(sessionDir()).find((c) => c.chunk_id === 2);
		expect(state.tasks.map((t) => t.text)).toEqual(plan2?.tasks.map((t) => t.text));
		expect(state.tasks.every((t) => t.status === "todo")).toBe(true);
	});
});
