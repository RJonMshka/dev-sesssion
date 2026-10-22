/**
 * Starting mid-plan with `init --chunk` (LLD-first-run.md, REQ-RUN-27..30).
 *
 * DevNexus is at phase 8 of 9; `init` could only start at phase 1.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileIndexManager } from "../../packages/core/src/managers/file-index-manager.js";
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

## Chunk 2 — Arithmetic

- [ ] Make add reject NaN in src/utils.ts

## Chunk 3 — Release

- [ ] Publish
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-start-chunk-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sessionDir = (): ValidatedPath => path.join(tmpDir, ".session") as ValidatedPath;

describe("init --chunk", () => {
	it("makes the named chunk active (REQ-RUN-27)", async () => {
		const r = await runCli(["init", "--yes", "--chunk", "2", "--cwd", tmpDir]);
		expect(r.exitCode).toBe(0);

		const state = SessionStateManager.load(sessionDir());
		expect(state.active_chunk).toBe(2);
		expect(state.tasks.map((t) => t.text)).toEqual(["Make add reject NaN in src/utils.ts"]);
		const prompt = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
		expect(prompt).toContain("Active chunk: 2");
	});

	it("records earlier chunks as completed today, tasks untouched (REQ-RUN-28)", async () => {
		await runCli(["init", "--yes", "--chunk", "3", "--cwd", tmpDir]);

		const state = SessionStateManager.load(sessionDir());
		const today = new Date().toISOString().slice(0, 10);
		expect(state.completed_chunks).toEqual({ "1": today, "2": today });
		const plan1 = fs.readFileSync(path.join(tmpDir, ".session", "PLAN_1.md"), "utf-8");
		expect(plan1).toContain("status: todo");
	});

	it("tags no files to a chunk it recorded as completed (REQ-RUN-29)", async () => {
		await runCli(["init", "--yes", "--chunk", "2", "--cwd", tmpDir]);

		const entries = FileIndexManager.load(sessionDir());
		expect(FileIndexManager.queryByChunk(entries, 1)).toEqual([]);
		expect(FileIndexManager.queryByChunk(entries, 2).map((e) => e.filepath)).toEqual([
			"src/utils.ts",
		]);
	});

	it("rejects an id the plan does not define, writing no state (REQ-RUN-30)", async () => {
		const r = await runCli(["init", "--yes", "--chunk", "7", "--cwd", tmpDir]);

		expect(r.exitCode).not.toBe(0);
		expect(r.stdout + r.stderr).toMatch(/1, 2, 3/);
		expect(fs.existsSync(path.join(tmpDir, ".session", "SESSION_STATE.md"))).toBe(false);
	});
});
