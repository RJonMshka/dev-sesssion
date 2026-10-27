/**
 * Tagging on touch through the built CLI (LLD-tagging.md, REQ-IDX-24, -36..41,
 * REQ-DRY-7).
 *
 * Each test builds a real git repository from simple-node-app, runs `init`,
 * commits, edits, and runs `update` or `advance`. FILE_INDEX.md is read back
 * through core's own loader and the prompt from the file the run wrote.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FILE_LOAD_PREFIXES } from "../../packages/core/src/formatters/formatter-utils.js";
import { FileIndexManager } from "../../packages/core/src/managers/file-index-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/simple-node-app",
);

let tmpDir: string;
let configDir: string;
let env: Record<string, string>;

// The user's ~/.gitconfig must not leak into the repositories under test.
beforeAll(() => {
	configDir = fs.mkdtempSync(path.join(os.tmpdir(), "touch-gitconfig-"));
	const empty = path.join(configDir, "gitconfig");
	fs.writeFileSync(empty, "");
	env = { GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: "1" };
});

afterAll(() => {
	fs.rmSync(configDir, { recursive: true, force: true });
});

beforeEach(() => {
	tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-touch-e2e-")));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.rmSync(path.join(tmpDir, ".session"), { recursive: true, force: true });
	git("init", "-q", "--initial-branch=main");
	git("config", "user.email", "me@example.com");
	git("config", "user.name", "Me");
	git("config", "commit.gpgsign", "false");
	commitAll("initial");
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs git in the project. */
function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: tmpDir,
		encoding: "utf-8",
		env: { ...process.env, ...env },
	});
}

/** Commits every change. */
function commitAll(message: string): void {
	git("add", "-A");
	git("commit", "-q", "--allow-empty", "-m", message);
}

/** Runs the CLI in the project, failing loudly on a non-zero exit. */
async function cli(...args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir], { env });
	if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
}

/** Reads a .session file. */
function session(name: string): string {
	return fs.readFileSync(path.join(tmpDir, ".session", name), "utf-8");
}

/** FILE_INDEX.md as core loads it, by path. */
function tags(): Record<string, readonly number[]> {
	const entries = FileIndexManager.load(path.join(tmpDir, ".session") as ValidatedPath);
	return Object.fromEntries(entries.map((e) => [e.filepath, e.chunk_tags]));
}

/** The prompt's file-load lines. */
function loadLines(): string {
	return session("NEXT_PROMPT.md")
		.split("\n")
		.filter((l) => FILE_LOAD_PREFIXES.some((p) => l.startsWith(p)))
		.join("\n");
}

/** init, then commit what init wrote, so the session starts clean. */
async function start(): Promise<void> {
	await cli("init", "--yes");
	commitAll("dev-sesssion init");
}

describe("update tags what the session touched", () => {
	it("tags an edited file to the active chunk and loads it in the same run (REQ-IDX-36)", async () => {
		await start();
		expect(tags()["src/feature.ts"]).toBeUndefined();
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");

		await cli("update", "--yes");

		expect(tags()["src/feature.ts"]).toEqual([1]);
		expect(loadLines()).toContain("src/feature.ts");
		// init wrote the plan skill; it is the tool's file, not session work (REQ-IDX-25).
		expect(fs.existsSync(path.join(tmpDir, ".claude/skills/dev-sesssion/SKILL.md"))).toBe(true);
		expect(tags()[".claude/skills/dev-sesssion/SKILL.md"]).toBeUndefined();
		const preview = JSON.parse(await cli("preview", "--format", "json")) as { prompt_text: string };
		expect(preview.prompt_text).toBe(session("NEXT_PROMPT.md"));
	});

	it("reports what it tagged and why it left the rest (REQ-IDX-37)", async () => {
		await start();
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");
		fs.writeFileSync(path.join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

		const out = await cli("update", "--yes");

		expect(out).toMatch(/src\/feature\.ts → chunk 1/);
		expect(out).toMatch(/lockfile: 1/);
	});

	it("tags nothing with --no-tag, and still moves the base (REQ-IDX-39)", async () => {
		await start();
		const index = session("FILE_INDEX.md");
		const baseBefore = session("SESSION_STATE.md").match(/commit: "([0-9a-f]+)"/)?.[1];
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");
		commitAll("feature");

		await cli("update", "--yes", "--no-tag");

		expect(session("FILE_INDEX.md")).toBe(index);
		const baseAfter = session("SESSION_STATE.md").match(/commit: "([0-9a-f]+)"/)?.[1];
		expect(baseAfter).toBe(git("rev-parse", "HEAD").trim());
		expect(baseAfter).not.toBe(baseBefore);
	});

	it("reports the would-be tag under dry-run and writes nothing (REQ-IDX-40, REQ-DRY-7)", async () => {
		await start();
		const index = session("FILE_INDEX.md");
		const state = session("SESSION_STATE.md");
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");

		const out = await cli("--dry-run", "update", "--yes");

		expect(out).toMatch(/src\/feature\.ts → chunk 1/);
		expect(session("FILE_INDEX.md")).toBe(index);
		expect(session("SESSION_STATE.md")).toBe(state);
	});

	it("tags nothing on the first update after upgrading, then tags on the next (REQ-IDX-24)", async () => {
		await start();
		const statePath = path.join(tmpDir, ".session", "SESSION_STATE.md");
		const withoutBase = session("SESSION_STATE.md").replace(/session_base:\n(?: {2}.*\n)+/, "");
		expect(withoutBase).not.toContain("session_base");
		fs.writeFileSync(statePath, withoutBase);
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");

		const first = await cli("update", "--yes");
		expect(first).toMatch(/no-base/);
		expect(tags()["src/feature.ts"]).toBeUndefined();

		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 2;\n");
		await cli("update", "--yes");
		expect(tags()["src/feature.ts"]).toEqual([1]);
	});
});

describe("advance records a base and tags nothing", () => {
	it("leaves FILE_INDEX.md alone and records the new HEAD (REQ-IDX-41)", async () => {
		fs.appendFileSync(
			path.join(tmpDir, "PLAN.md"),
			"\n## Chunk 2 — Next\n\n### Tasks\n\n- [ ] Do the next thing\n",
		);
		commitAll("two chunks");
		await start();
		const index = session("FILE_INDEX.md");
		fs.writeFileSync(path.join(tmpDir, "src/feature.ts"), "export const feature = 1;\n");
		commitAll("feature");

		await cli("advance", "--yes");

		expect(session("FILE_INDEX.md")).toBe(index);
		expect(session("SESSION_STATE.md")).toContain(`commit: "${git("rev-parse", "HEAD").trim()}"`);
	});
});
