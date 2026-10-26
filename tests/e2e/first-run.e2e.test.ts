/**
 * The first run, end to end through the built CLI (LLD-first-run.md).
 *
 * A copy of the ts-project fixture gets a two-chunk PLAN.md whose tasks name
 * files and units, and the commands a new user runs: init, index, import.
 * Assertions read the files the CLI wrote, through core's own parsers.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexManager } from "../../packages/core/src/annotation/ai-index-manager.js";
import { FILE_LOAD_PREFIXES } from "../../packages/core/src/formatters/formatter-utils.js";
import { FileIndexManager } from "../../packages/core/src/managers/file-index-manager.js";
import { TrimOverridesManager } from "../../packages/core/src/managers/trim-overrides-manager.js";
import type { ValidatedPath } from "../../packages/security/src/validators/path-validator.js";
import { runCli } from "../helpers/run-cli.js";

const FIXTURE_DIR = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../fixtures/ts-project",
);

/**
 * Chunk 1 names `src/utils.ts` by path and `client.ts` by basename, and the
 * unit `Client.fetch`. Chunk 2 names `utils.ts` again. Nothing names
 * `package.json` or `PLAN.md`.
 */
const PLAN = `# Plan

## Chunk 1 — Client retries

- [ ] Make Client.fetch retry up to MAX_RETRIES from src/utils.ts
- [ ] Add a timeout option to client.ts

## Chunk 2 — Arithmetic

- [ ] Make \`add\` reject NaN in utils.ts
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-first-run-e2e-"));
	fs.cpSync(FIXTURE_DIR, tmpDir, { recursive: true });
	fs.writeFileSync(path.join(tmpDir, "PLAN.md"), PLAN);
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Runs the CLI against the temp project and fails loudly on a non-zero exit. */
async function cli(...args: string[]): Promise<string> {
	const r = await runCli([...args, "--cwd", tmpDir]);
	if (r.exitCode !== 0) throw new Error(`${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
	return r.stdout + r.stderr;
}

/** Reads a .session file. */
function session(name: string): string {
	return fs.readFileSync(path.join(tmpDir, ".session", name), "utf-8");
}

/** The `.session/` directory as a validated path, for core's loaders. */
function sessionDir(): ValidatedPath {
	return path.join(tmpDir, ".session") as ValidatedPath;
}

/** The prompt's Focus line, if it has one. */
function focusLine(): string | undefined {
	return session("NEXT_PROMPT.md")
		.split("\n")
		.find((l) => l.startsWith("Focus (read_unit):"));
}

/** Replaces chunk 1's tasks in PLAN_1.md. */
function setTasks(tasks: readonly string[]): void {
	const planPath = path.join(tmpDir, ".session", "PLAN_1.md");
	const plan = fs.readFileSync(planPath, "utf-8");
	const yaml = tasks.map((t) => `  - text: ${JSON.stringify(t)}\n    status: todo`).join("\n");
	fs.writeFileSync(planPath, plan.replace(/tasks:\n(?: {2}.*\n)+/, `tasks:\n${yaml}\n`));
}

/** Appends a function to the fixture's utils.ts. */
function addFunction(name: string): void {
	fs.appendFileSync(
		path.join(tmpDir, "src", "utils.ts"),
		`\n/** Clamps a value. */\nexport function ${name}(v: number): number {\n\treturn Math.max(0, v);\n}\n`,
	);
}

/** The bytes of the prompt and the manifest. */
function snapshot(): string {
	return `${session("NEXT_PROMPT.md")}\n---\n${session("context-manifest.json")}`;
}

describe("init --yes tags files from task text", () => {
	it("tags each file to the chunks whose tasks name it (REQ-RUN-1)", async () => {
		await cli("init", "--yes");

		const entries = FileIndexManager.load(sessionDir());
		const inChunk = (id: number): string[] =>
			FileIndexManager.queryByChunk(entries, id)
				.map((e) => e.filepath)
				.sort();

		expect(inChunk(1)).toEqual(["src/client.ts", "src/utils.ts"]);
		expect(inChunk(2)).toEqual(["src/utils.ts"]);
	});

	it("leaves files no task names out of FILE_INDEX.md (REQ-RUN-4)", async () => {
		await cli("init", "--yes");

		const paths = FileIndexManager.load(sessionDir()).map((e) => e.filepath);

		expect(paths).not.toContain("package.json");
		expect(paths).not.toContain("PLAN.md");
	});

	it("says how many files were tagged and how many were left to the ai-index (REQ-RUN-6)", async () => {
		const out = await cli("init", "--yes");

		expect(out).toMatch(/Tagged 2 files to chunks from the plan; 2 left to the ai-index\./);
	});
});

describe("import --from claude after init", () => {
	it("imports nothing from the block init wrote into CLAUDE.md (REQ-RUN-7, REQ-RUN-18)", async () => {
		fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Project\n\n## Conventions\nUse tabs.\n");
		await cli("init", "--yes", "--adapter", "claude");
		expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8")).toContain(
			"<!-- dev-sesssion:start -->",
		);

		await cli("import", "--from", "claude");

		const quoted = session("SESSION_STATE.md")
			.split("\n")
			.filter((l) => l.includes("Quoted from CLAUDE.md"));
		expect(quoted).toHaveLength(1);
		expect(quoted[0]).toContain('§ \\"Conventions\\": \\"Use tabs.\\""');
	});
});

describe("the first prompt", () => {
	it("is written from an ai-index built by the same init (REQ-RUN-10)", async () => {
		await cli("init", "--yes");

		expect(fs.existsSync(path.join(tmpDir, ".session", "ai-index.yaml"))).toBe(true);
		expect(focusLine()).toMatch(/src\/client\.ts#Client\.fetch:\d+-\d+/);
	});

	it("is still written when the ai-index cannot be saved (REQ-RUN-11)", async () => {
		// --strict refuses an index holding a secret. A doc comment's secret is
		// now redacted at extraction (REQ-PROV-14), so the secret is in a file
		// name, which the index keys on.
		fs.writeFileSync(
			path.join(tmpDir, "src", "AKIAIOSFODNN7EXAMPLE.ts"),
			"export function upload(): void {}\n",
		);

		const r = await runCli(["init", "--yes", "--strict", "--cwd", tmpDir]);

		expect(r.exitCode).toBe(0);
		expect(`${r.stdout}${r.stderr}`).toMatch(/ai-index/i);
		expect(fs.existsSync(path.join(tmpDir, ".session", "ai-index.yaml"))).toBe(false);
		expect(fs.existsSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"))).toBe(true);
		expect(focusLine()).toBeUndefined();
	});

	it("applies --max-files to the ai-index too (REQ-RUN-12)", async () => {
		await cli("init", "--yes", "--max-files", "1");

		const index = AiIndexManager.load(sessionDir());
		expect(index).not.toBeNull();
		expect(Object.keys(index?.files ?? {}).length).toBeLessThanOrEqual(1);
	});

	it("prints the budget label once (REQ-RUN-17)", async () => {
		const out = await cli("init", "--yes");

		expect(out.split("Context budget:").length - 1).toBe(1);
	});
});

describe("index and import keep the prompt current", () => {
	it("index regenerates the prompt and manifest (REQ-RUN-13)", async () => {
		await cli("init", "--yes");
		addFunction("clampValue");
		setTasks(["Make clampValue handle NaN"]);

		await cli("index");

		expect(focusLine()).toMatch(/src\/utils\.ts#clampValue:\d+-\d+/);
		expect(session("context-manifest.json")).toContain("src/utils.ts#clampValue");
	});

	it("import regenerates the prompt with the quoted note (REQ-RUN-14)", async () => {
		await cli("init", "--yes");
		fs.writeFileSync(
			path.join(tmpDir, "CLAUDE.md"),
			"# Project\n\n## Setup\nRun pnpm install first.\n",
		);

		await cli("import", "--from", "claude");

		expect(session("NEXT_PROMPT.md")).toContain(
			'Quoted from CLAUDE.md § "Setup": "Run pnpm install first."',
		);
	});

	it("writes neither prompt nor manifest under --dry-run (REQ-RUN-15)", async () => {
		await cli("init", "--yes");
		const before = snapshot();
		addFunction("clampValue");
		setTasks(["Make clampValue handle NaN"]);
		fs.writeFileSync(
			path.join(tmpDir, "CLAUDE.md"),
			"# Project\n\n## Setup\nRun pnpm install first.\n",
		);

		await cli("--dry-run", "index");
		await cli("--dry-run", "import", "--from", "claude");

		expect(snapshot()).toBe(before);
	});

	it("produces the same prompt from every command for the same state (REQ-RUN-16)", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "CLAUDE.md"),
			"# Project\n\n## Setup\nRun pnpm install first.\n",
		);
		await cli("init", "--yes");
		const afterInit = session("NEXT_PROMPT.md");

		await cli("index");
		expect(session("NEXT_PROMPT.md")).toBe(afterInit);

		await cli("update", "--yes");
		expect(session("NEXT_PROMPT.md")).toBe(afterInit);

		await cli("import", "--from", "claude");
		const afterImport = session("NEXT_PROMPT.md");
		expect(afterImport).not.toBe(afterInit);

		await cli("index");
		expect(session("NEXT_PROMPT.md")).toBe(afterImport);

		await cli("update", "--yes");
		expect(session("NEXT_PROMPT.md")).toBe(afterImport);
	});
});

/** The paths the prompt's file-load lines name. */
function loadedPaths(): string {
	return session("NEXT_PROMPT.md")
		.split("\n")
		.filter((l) => FILE_LOAD_PREFIXES.some((p) => l.startsWith(p)))
		.join("\n");
}

/** The prompt `preview --format json` shows. */
async function previewPrompt(): Promise<string> {
	const out = await runCli(["preview", "--format", "json", "--cwd", tmpDir]);
	const parsed: unknown = JSON.parse(out.stdout);
	if (typeof parsed !== "object" || parsed === null || !("prompt_text" in parsed)) {
		throw new Error(`preview printed no prompt_text:\n${out.stdout}`);
	}
	return String(parsed.prompt_text);
}

describe("preview and trim agree with the written prompt", () => {
	it("preview shows the prompt init wrote (REQ-RUN-19)", async () => {
		await cli("init", "--yes");
		expect(await previewPrompt()).toBe(session("NEXT_PROMPT.md"));
	});

	it("trim's exclusions reach the written prompt (REQ-RUN-20, REQ-RUN-22)", async () => {
		await cli("init", "--yes");
		expect(loadedPaths()).toContain("src/utils.ts");

		await cli("trim", "--budget", "1", "--yes");
		const overrides = TrimOverridesManager.load(sessionDir());
		const excluded = TrimOverridesManager.getExcludedPaths(overrides);
		expect(excluded).toContain("src/utils.ts");
		for (const file of excluded) expect(loadedPaths()).not.toContain(file);
		expect(await previewPrompt()).toBe(session("NEXT_PROMPT.md"));

		await cli("update", "--yes");
		for (const file of excluded) expect(loadedPaths()).not.toContain(file);
		expect(await previewPrompt()).toBe(session("NEXT_PROMPT.md"));
	});

	it("trim writes neither prompt nor manifest under --dry-run (REQ-RUN-22)", async () => {
		await cli("init", "--yes");
		const before = session("NEXT_PROMPT.md") + session("context-manifest.json");
		await cli("--dry-run", "trim", "--budget", "1", "--yes");
		expect(session("NEXT_PROMPT.md") + session("context-manifest.json")).toBe(before);
	});
});

describe("init --plan <file>", () => {
	/** A plan whose chunk titles appear nowhere in the fixture's PLAN.md. */
	const OTHER_PLAN = `# Agent plan

## Chunk 1 — Logging

- [ ] Add a logger to src/utils.ts

## Chunk 2 — Metrics

- [ ] Count retries in client.ts
`;

	it("ingests the named file instead of PLAN.md (REQ-PLA-7)", async () => {
		fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
		fs.writeFileSync(path.join(tmpDir, "docs", "agent-plan.md"), OTHER_PLAN);

		await cli("init", "--plan", "docs/agent-plan.md", "--yes");

		expect(session("PLAN_1.md")).toContain("Logging");
		expect(session("PLAN_2.md")).toContain("Metrics");
		// PLAN.md was there and was not read.
		expect(session("PLAN_1.md")).not.toContain("Client retries");
		// …nor rewritten.
		expect(fs.readFileSync(path.join(tmpDir, "PLAN.md"), "utf-8")).toBe(PLAN);
	});

	it("rejects a path outside the project root with a SecurityError (REQ-PLA-8)", async () => {
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sesssion-outside-"));
		try {
			fs.writeFileSync(path.join(outside, "plan.md"), OTHER_PLAN);
			const rel = path.relative(tmpDir, path.join(outside, "plan.md"));

			const r = await runCli(["init", "--plan", rel, "--yes", "--cwd", tmpDir]);

			// handleError maps SecurityError to exit 3.
			expect(r.exitCode).toBe(3);
			expect(r.stdout + r.stderr).toMatch(/security violation/i);
			expect(fs.existsSync(path.join(tmpDir, ".session"))).toBe(false);
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("init without a plan", () => {
	it("says no plan was found and names how to write, check and pass one (REQ-ORC-3)", async () => {
		fs.rmSync(path.join(tmpDir, "PLAN.md"));

		const out = await cli("init", "--yes"); // throws unless exit 0

		expect(out).toContain("No plan found (looked for PLAN.md, docs/PLAN.md)");
		expect(out).toContain("dev-sesssion plan check <file>");
		expect(out).toContain("dev-sesssion init --plan <file> -y");
		// Under --yes the session is not empty-handed, and says so.
		expect(out).toMatch(/placeholder chunk/i);
		expect(fs.existsSync(path.join(tmpDir, ".session", "PLAN_1.md"))).toBe(true);
	});
});
