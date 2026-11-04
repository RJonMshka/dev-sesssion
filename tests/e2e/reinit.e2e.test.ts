/**
 * Re-running `init` on an existing session (LLD-first-run.md, REQ-RUN-32..37).
 *
 * The overnight eval of 2026-11-03 found `init -y` reset a session at chunk 2
 * back to chunk 1, with nothing kept.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-reinit-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const session = (...p: string[]): string => path.join(tmpDir, ".session", ...p);
const sessionDir = (): ValidatedPath => session() as ValidatedPath;

/** Every file under `.session/`, relative path → bytes. */
function snapshot(): Map<string, string> {
	const out = new Map<string, string>();
	for (const rel of fs.readdirSync(session(), { recursive: true }) as string[]) {
		const abs = session(rel);
		if (fs.statSync(abs).isFile()) out.set(rel, fs.readFileSync(abs, "utf-8"));
	}
	return out;
}

/** The backup directories init made, relative to `.session/`. */
function backups(): string[] {
	if (!fs.existsSync(session("backups"))) return [];
	return fs
		.readdirSync(session("backups"))
		.filter((n) => n !== ".gitignore")
		.map((n) => `backups/${n}`);
}

describe("init on an existing session", () => {
	it("--yes changes nothing, exits 0 and points at --fresh (REQ-RUN-32)", async () => {
		await runCli(["init", "--yes", "--chunk", "2", "--cwd", tmpDir]);
		const before = snapshot();

		const r = await runCli(["init", "--yes", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(snapshot()).toEqual(before);
		expect(r.stdout).toMatch(/already set up/i);
		expect(r.stdout).toMatch(/chunk 2/i);
		expect(r.stdout).toContain("--fresh");
	});

	it("--fresh moves the old state into a backup and starts over (REQ-RUN-33)", async () => {
		await runCli(["init", "--yes", "--chunk", "2", "--cwd", tmpDir]);
		const oldState = fs.readFileSync(session("SESSION_STATE.md"), "utf-8");

		const r = await runCli(["init", "--yes", "--fresh", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		const [backup, ...more] = backups();
		expect(more).toEqual([]);
		expect(backup).toMatch(/^backups\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
		expect(fs.readFileSync(session(backup ?? "", "SESSION_STATE.md"), "utf-8")).toBe(oldState);
		expect(r.stdout).toContain(`.session/${backup ?? ""}`);
		expect(SessionStateManager.load(sessionDir()).active_chunk).toBe(1);
	});

	it("--fresh leaves no chunk file from the old, longer plan (REQ-RUN-33)", async () => {
		await runCli(["init", "--yes", "--cwd", tmpDir]);
		fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN.replace(/## Chunk 3[\s\S]*$/, ""));

		await runCli(["init", "--yes", "--fresh", "--cwd", tmpDir]);

		expect(fs.existsSync(session("PLAN_2.md"))).toBe(true);
		expect(fs.existsSync(session("PLAN_3.md"))).toBe(false);
		expect(fs.existsSync(session(backups()[0] ?? "", "PLAN_3.md"))).toBe(true);
	});

	it("keeps the backup out of git, whatever .gitignore says (REQ-RUN-34)", async () => {
		await runCli(["init", "--yes", "--cwd", tmpDir]);
		await runCli(["init", "--yes", "--fresh", "--cwd", tmpDir]);

		const ignore = fs.readFileSync(session("backups", ".gitignore"), "utf-8");
		expect(ignore.split("\n")).toContain("*");
	});

	it("--dry-run --fresh reports the backup and moves nothing (REQ-RUN-37)", async () => {
		await runCli(["init", "--yes", "--chunk", "2", "--cwd", tmpDir]);
		const before = snapshot();

		const r = await runCli(["--dry-run", "init", "--yes", "--fresh", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(snapshot()).toEqual(before);
		expect(backups()).toEqual([]);
		expect(r.stdout).toMatch(/would move .*\.session\/backups\//i);
	});

	it("treats a .session/ without SESSION_STATE.md as new (REQ-RUN-32)", async () => {
		fs.mkdirSync(session());

		const r = await runCli(["init", "--yes", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(fs.existsSync(session("SESSION_STATE.md"))).toBe(true);
		expect(backups()).toEqual([]);
	});
});
