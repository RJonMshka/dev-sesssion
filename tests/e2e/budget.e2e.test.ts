/**
 * One context budget across commands (LLD-budget.md, REQ-BUD-2, REQ-BUD-3).
 *
 * On DevNexus the prompt said ~326, `preview` ~511, and after `index` the
 * prompt said ~872 while `status` still said ~326. The prompt's figure is the
 * one the agent is told; every other command must report it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

const PLAN = `# Plan

## Chunk 1 — Client retries

- [ ] Make Client.fetch retry from src/utils.ts
- [ ] Add a timeout option to client.ts
- [ ] Restyle theme.css for dark mode
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-budget-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
	// A large file the ai-index does not cover, as DevNexus's tokens.css: its
	// cost can only come from FILE_INDEX, which stores none (REQ-BUD-4).
	fs.writeFileSync(
		path.join(tmpDir, "src", "theme.css"),
		`:root { --accent: cyan; }\n`.repeat(160),
	);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs the CLI and fails loudly on a non-zero exit. */
async function cli(...args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir]);
	if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout;
}

/** The number on the prompt's `Budget: ~N/cap` line. */
function promptBudget(): number {
	const prompt = fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8");
	const m = /Budget: ~(\d+)\//.exec(prompt);
	if (m?.[1] === undefined) throw new Error(`no Budget line in:\n${prompt}`);
	return Number(m[1]);
}

async function statusTotal(): Promise<number> {
	return (JSON.parse(await cli("status", "--json")) as { budget: { total_tokens: number } }).budget
		.total_tokens;
}

async function previewTotal(): Promise<number> {
	return (JSON.parse(await cli("preview", "--format", "json")) as { total_tokens: number })
		.total_tokens;
}

describe("every command reports the prompt's budget", () => {
	it("status agrees with the prompt after init and after index (REQ-BUD-2)", async () => {
		await cli("init", "--yes");
		expect(await statusTotal()).toBe(promptBudget());

		await cli("index");
		expect(await statusTotal()).toBe(promptBudget());
	});

	it("preview agrees with the prompt after init and after index (REQ-BUD-3)", async () => {
		await cli("init", "--yes");
		expect(await previewTotal()).toBe(promptBudget());

		await cli("index");
		expect(await previewTotal()).toBe(promptBudget());
	});
});

describe("files the ai-index does not cover", () => {
	it("are charged their size after a reload, as init charged them (REQ-BUD-4)", async () => {
		await cli("init", "--yes");
		const atInit = promptBudget();

		expect(await statusTotal()).toBe(atInit);
		// Regenerating from disk must not shrink the large CSS file to a default.
		await cli("update", "--yes");
		expect(promptBudget()).toBe(atInit);
	});
});

describe("health", () => {
	it("judges the budget the prompt was charged (REQ-BUD-5)", async () => {
		// 20 KB the ai-index does not cover: over the 4,000-token default.
		fs.writeFileSync(path.join(tmpDir, "src", "theme.css"), `.a { color: red; }\n`.repeat(1100));
		await cli("init", "--yes");
		expect(fs.readFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), "utf-8")).toContain(
			"[OVER]",
		);

		const r = await runCli(["health", "--cwd", tmpDir]);
		const out = r.stdout + r.stderr;

		expect(out).toContain("BUDGET_EXCEEDED");
		expect(out).toContain(`~${String(promptBudget())} /`);
	});
});
