/**
 * Code units end to end through the built CLI (LLD-code-units.md).
 *
 * init → index → a plan whose tasks name units → update. Asserts on the files
 * the CLI actually writes: NEXT_PROMPT.md, context-manifest.json, and what
 * `verify --json` reports once the code moves on.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-units-e2e-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Rewrites PLAN_1.md's task list. */
function setTasks(dir: string, tasks: readonly string[]): void {
	const planPath = path.join(dir, ".session", "PLAN_1.md");
	const plan = fs.readFileSync(planPath, "utf-8");
	const yaml = tasks.map((t) => `  - text: ${JSON.stringify(t)}\n    status: todo`).join("\n");
	fs.writeFileSync(planPath, plan.replace(/tasks:\n(?: {2}.*\n)+/, `tasks:\n${yaml}\n`));
}

/** init + index + tasks naming units, then update. */
async function setUp(): Promise<string> {
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	for (const args of [
		["init", "--yes", "--cwd", tmpDir],
		["index", "--cwd", tmpDir],
	]) {
		const r = await runCli(args);
		if (r.exitCode !== 0) throw new Error(`${args[0]} failed: ${r.stdout}\n${r.stderr}`);
	}
	setTasks(tmpDir, ["Make `add` reject NaN", "Client.fetch should retry on failure"]);
	return tmpDir;
}

/** Reads a .session file. */
function session(dir: string, name: string): string {
	return fs.readFileSync(path.join(dir, ".session", name), "utf-8");
}

describe("update with code units", () => {
	it("writes a Focus line naming the units the tasks name (REQ-UNIT-13)", async () => {
		const dir = await setUp();
		const r = await runCli(["update", "--yes", "--cwd", dir]);
		expect(r.exitCode).toBe(0);

		const focus = session(dir, "NEXT_PROMPT.md")
			.split("\n")
			.find((l) => l.startsWith("Focus (read_unit):"));
		expect(focus).toMatch(/src\/utils\.ts#add:\d+-\d+/);
		expect(focus).toMatch(/src\/client\.ts#Client\.fetch:\d+-\d+/);
	});

	it("writes a manifest describing exactly the prompt it sits beside (REQ-UNIT-16, REQ-UNIT-18)", async () => {
		const dir = await setUp();
		await runCli(["update", "--yes", "--cwd", dir]);

		const prompt = session(dir, "NEXT_PROMPT.md");
		const manifest = JSON.parse(session(dir, "context-manifest.json")) as {
			prompt_hash: string;
			entries: { ref: string; granularity: string; tokens: number; file_tokens: number }[];
			totals: { tokens: number; file_tokens: number };
		};
		const hash = createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);
		expect(manifest.prompt_hash).toBe(hash);

		const unit = manifest.entries.find((e) => e.ref === "src/client.ts#Client.fetch");
		expect(unit?.granularity).toBe("unit");
		expect(unit?.tokens).toBeLessThan(unit?.file_tokens ?? 0);
		expect(manifest.totals.tokens).toBeLessThan(manifest.totals.file_tokens);
	});

	it("leaves the manifest untouched under --dry-run (REQ-UNIT-19)", async () => {
		const dir = await setUp();
		// init already wrote one, for the scaffolded tasks.
		const before = session(dir, "context-manifest.json");
		expect(before).not.toContain("#add");

		const r = await runCli(["update", "--yes", "--dry-run", "--cwd", dir]);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toContain("context-manifest.json");
		expect(session(dir, "context-manifest.json")).toBe(before);
	});
});

describe("verify against the manifest", () => {
	/** Codes reported by `verify --json`. */
	async function verifyCodes(dir: string): Promise<string[]> {
		const r = await runCli(["verify", "--json", "--cwd", dir]);
		const report = JSON.parse(r.stdout) as { findings: { code: string }[] };
		return report.findings.map((f) => f.code);
	}

	it("reports STALE_CONTEXT once a focused unit is edited (REQ-UNIT-20)", async () => {
		const dir = await setUp();
		await runCli(["update", "--yes", "--cwd", dir]);
		expect(await verifyCodes(dir)).not.toContain("STALE_CONTEXT");

		const utils = path.join(dir, "src", "utils.ts");
		fs.writeFileSync(utils, fs.readFileSync(utils, "utf-8").replace("a + b", "b + a"));
		expect(await verifyCodes(dir)).toContain("STALE_CONTEXT");
	});

	it("reports MOVED_CONTEXT when lines shift above a focused unit (REQ-UNIT-21)", async () => {
		const dir = await setUp();
		await runCli(["update", "--yes", "--cwd", dir]);

		const utils = path.join(dir, "src", "utils.ts");
		fs.writeFileSync(utils, `// shifted\n${fs.readFileSync(utils, "utf-8")}`);
		const codes = await verifyCodes(dir);
		expect(codes).toContain("MOVED_CONTEXT");
		expect(codes).not.toContain("STALE_CONTEXT");
	});
});
