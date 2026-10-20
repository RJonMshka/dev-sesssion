/**
 * PromptAssembler — the one function every command builds the prompt with
 * (LLD-first-run.md).
 *
 * Built from the real pipeline: extractor → index → assemble. Assertions read
 * the generated prompt and manifest, never hand-written prompt lines.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiIndexBuilder } from "../annotation/ai-index-builder.js";
import { AutoExtractor } from "../annotation/auto-extractor.js";
import type { AiIndex } from "../annotation/types.js";
import { FILE_LOAD_PREFIXES } from "../formatters/formatter-utils.js";
import { PlainTextFormatter } from "../formatters/plain-text-formatter.js";
import { type AssembleInput, PromptAssembler } from "../managers/prompt-assembler.js";
import type { FileIndexEntry, PlanChunk, SessionState, Task } from "../schemas/index.js";

const SOURCES: Record<string, string> = {
	"src/app.ts": "export function createApp(): void {}\n",
	"src/server.ts": "export function listen(): void {}\n",
};

const tasks: Task[] = [{ text: "Wire app.ts into server.ts", status: "todo" }];
const chunk: PlanChunk = { chunk_id: 1, title: "MVP", depends_on: [], tasks };
const state: SessionState = {
	active_chunk: 1,
	session_id: "s",
	last_updated: "2026-10-20",
	tasks,
	last_worked_files: [],
	notes: [],
	completed_chunks: {},
	max_prompt_lines: 20,
};
const entries: FileIndexEntry[] = [
	{ filepath: "src/app.ts", chunk_tags: [1], purpose: "app" },
	{ filepath: "src/server.ts", chunk_tags: [1], purpose: "server" },
];

let root: string;
let index: AiIndex;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-assembler-"));
	const extractor = new AutoExtractor();
	const parsed = Object.entries(SOURCES).map(([rel, content]) => {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content, "utf-8");
		return extractor.extractFile(abs as ValidatedPath);
	});
	index = AiIndexBuilder.build(parsed, root);
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

/** The input every test starts from. */
function input(overrides: Partial<AssembleInput> = {}): AssembleInput {
	return {
		state,
		chunk,
		allChunks: [chunk],
		entries,
		index,
		formatter: PlainTextFormatter,
		projectName: "demo",
		...overrides,
	};
}

/** The prompt's file-load lines. */
function loadLines(prompt: string): string[] {
	return prompt.split("\n").filter((l) => FILE_LOAD_PREFIXES.some((p) => l.startsWith(p)));
}

describe("PromptAssembler.assemble — trim exclusions (REQ-RUN-20)", () => {
	it("loads both chunk files when nothing is excluded", () => {
		const { prompt, manifest } = PromptAssembler.assemble(input());
		expect(loadLines(prompt).join("\n")).toContain("src/server.ts");
		expect(manifest.entries.map((e) => e.path)).toContain("src/server.ts");
	});

	it("leaves an excluded file out of the load lines, manifest, budget and chunk files", () => {
		const full = PromptAssembler.assemble(input());
		const trimmed = PromptAssembler.assemble(input({ excluded: ["src/server.ts"] }));

		expect(loadLines(trimmed.prompt).join("\n")).not.toContain("src/server.ts");
		expect(loadLines(trimmed.prompt).join("\n")).toContain("src/app.ts");
		expect(trimmed.manifest.entries.map((e) => e.path)).not.toContain("src/server.ts");
		expect(trimmed.chunkFiles.map((e) => e.filepath)).toEqual(["src/app.ts"]);
		expect(trimmed.plan.layers.map((l) => l.filepath)).not.toContain("src/server.ts");
		expect(trimmed.budget.totalTokens).toBeLessThan(full.budget.totalTokens);
	});

	it("adds an excluded file to the exclude patterns", () => {
		const { prompt } = PromptAssembler.assemble(input({ excluded: ["src/server.ts"] }));
		const excludeLine = prompt.split("\n").find((l) => l.includes("**/node_modules/**"));
		expect(excludeLine).toContain("src/server.ts");
	});
});
