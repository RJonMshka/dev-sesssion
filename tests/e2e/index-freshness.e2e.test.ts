/**
 * Keeping `ai-index.yaml` fresh (LLD-symbols.md, REQ-SYM-20..25).
 *
 * The overnight eval of 2026-11-03 found chunk 2's prompt summarising a file
 * without the functions chunk 1 added, while `health` said "healthy".
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../../packages/core/src/annotation/ai-index-builder.js";
import type { AiIndex } from "../../packages/core/src/annotation/types.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

const PLAN = `# Plan

## Chunk 1 — Arithmetic

- [ ] Add subtract to src/utils.ts

## Chunk 2 — Client

- [ ] Add retries to src/client.ts
`;

const ADDED =
	"\n/** Subtracts b from a. */\nexport function subtract(a: number, b: number): number {\n\treturn a - b;\n}\n";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-index-fresh-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const indexPath = (): string => path.join(tmpDir, ".session", "ai-index.yaml");
const readIndex = (): AiIndex => AiIndexBuilder.deserialize(fs.readFileSync(indexPath(), "utf-8"));
const exportsOf = (rel: string): string[] => Object.keys(readIndex().files[rel]?.exports ?? {});
const addSubtract = (): void => fs.appendFileSync(path.join(tmpDir, "src", "utils.ts"), ADDED);

async function init(...extra: string[]): Promise<void> {
	const r = await runCli(["init", "--yes", ...extra, "--cwd", tmpDir]);
	expect(r.exitCode, r.stdout + r.stderr).toBe(0);
}

describe("ai-index freshness", () => {
	it("update refreshes a changed file's entry before the prompt (REQ-SYM-20)", async () => {
		await init();
		addSubtract();

		const r = await runCli(["update", "--yes", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(exportsOf("src/utils.ts")).toContain("subtract");
	});

	it("advance refreshes the index too (REQ-SYM-20)", async () => {
		await init();
		addSubtract();

		const r = await runCli(["advance", "--yes", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(exportsOf("src/utils.ts")).toContain("subtract");
	});

	it("leaves ai-index.yaml untouched when nothing changed (REQ-SYM-21)", async () => {
		await init();
		const before = fs.readFileSync(indexPath(), "utf-8");

		await runCli(["update", "--yes", "--cwd", tmpDir]);

		expect(fs.readFileSync(indexPath(), "utf-8")).toBe(before);
	});

	it("index --update re-reads only the changed file and says so (REQ-SYM-22)", async () => {
		await init();
		const kept = Object.keys(readIndex().files).length - 1;
		addSubtract();

		const r = await runCli(["index", "--update", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(r.stdout).toMatch(/re-read 1 changed file/i);
		expect(r.stdout).toContain(`kept ${String(kept)}`);
		expect(exportsOf("src/utils.ts")).toContain("subtract");
	});

	it("keeps an init --max-files cap through a refresh (REQ-SYM-23)", async () => {
		await init("--max-files", "1");
		expect(readIndex().max_files).toBe(1);
		fs.writeFileSync(path.join(tmpDir, "src", "a-new.ts"), "export const n = 1;\n");

		await runCli(["update", "--yes", "--cwd", tmpDir]);

		expect(Object.keys(readIndex().files)).toHaveLength(1);
	});

	it("health reports a stale index and names dev-sesssion index (REQ-SYM-24)", async () => {
		await init();
		addSubtract();

		const r = await runCli(["health", "--json", "--cwd", tmpDir]);

		const report = JSON.parse(r.stdout) as {
			healthy: boolean;
			issues: { code: string; message: string }[];
		};
		const issue = report.issues.find((i) => i.code === "AI_INDEX_STALE");
		expect(issue?.message).toContain("1 file");
		expect(issue?.message).toContain("dev-sesssion index");
		expect(report.healthy).toBe(false);
	});

	it("--dry-run update does not write ai-index.yaml (REQ-SYM-25)", async () => {
		await init();
		const before = fs.readFileSync(indexPath(), "utf-8");
		addSubtract();

		await runCli(["--dry-run", "update", "--yes", "--cwd", tmpDir]);

		expect(fs.readFileSync(indexPath(), "utf-8")).toBe(before);
	});
});
