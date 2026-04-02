import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { CliError } from "@dev-session/security";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BootstrapContext } from "../formatters/bootstrap-formatter.js";
import { PlainTextFormatter } from "../formatters/plain-text-formatter.js";
import { NextPromptWriter } from "../managers/next-prompt-writer.js";
import type { ContextBudget, ContextBudgetBreakdown } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";
import { MAX_PROMPT_LINES } from "../schemas/index.js";

function makeTmpDir(): string {
	return fs.mkdtempSync(path.join(import.meta.dirname ?? __dirname, ".tmp-"));
}

function makeState(overrides?: Partial<SessionState>): SessionState {
	return {
		active_chunk: 3,
		session_id: "chunk-3-core",
		last_updated: "2026-03-29",
		tasks: [
			{ text: "Build schemas", status: "done", completed_at: "2026-03-29T10:00:00.000Z" },
			{ text: "Build managers", status: "in-progress" },
			{ text: "Write tests", status: "todo" },
		],
		notes: ["Some note here"],
		last_worked_files: ["packages/core/src/index.ts"],
		completed_chunks: { "1": "2026-03-25", "2": "2026-03-28" },
		...overrides,
	};
}

function makeChunk(): PlanChunk {
	return {
		chunk_id: 3,
		title: "Core data model",
		depends_on: [2],
		tasks: [
			{ text: "Build schemas", status: "done", completed_at: "2026-03-29T10:00:00.000Z" },
			{ text: "Build managers", status: "in-progress" },
			{ text: "Write tests", status: "todo" },
		],
	};
}

function makeFiles(): FileIndexEntry[] {
	return [
		{ filepath: "packages/core/src/index.ts", chunk_tags: [3], purpose: "Core entry" },
		{ filepath: "packages/core/src/schemas/index.ts", chunk_tags: [3], purpose: "Schemas" },
	];
}

describe("NextPromptWriter", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("generate", () => {
		it("produces content with required fields", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());

			expect(content).toContain("Project:");
			expect(content).toContain("Active chunk:");
			expect(content).toContain("Files to load:");
			expect(content).toContain("Resume:");
		});

		it("stays within MAX_PROMPT_LINES", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBeLessThanOrEqual(MAX_PROMPT_LINES);
		});

		it("includes chunk title", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());
			expect(content).toContain("Core data model");
		});

		it("includes file paths", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());
			expect(content).toContain("packages/core/src/index.ts");
		});

		it("includes notes when present", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());
			expect(content).toContain("Some note here");
		});

		it("handles empty files list", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), []);
			expect(content).toContain("(none)");
		});
	});

	describe("write", () => {
		it("writes content to NEXT_PROMPT.md", () => {
			NextPromptWriter.write(tmpDir as ValidatedPath, "Project: test\nActive chunk: 1\n");
			const content = fs.readFileSync(path.join(tmpDir, "NEXT_PROMPT.md"), "utf-8");
			expect(content).toContain("Project: test");
		});

		it("throws CliError if content is empty", () => {
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, "")).toThrow(CliError);
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, "   ")).toThrow(CliError);
		});
	});

	describe("validate", () => {
		it("validates correct content", () => {
			const content = NextPromptWriter.generate(makeState(), makeChunk(), makeFiles());
			const result = NextPromptWriter.validate(content);

			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.lineCount).toBeLessThanOrEqual(MAX_PROMPT_LINES);
		});

		it("rejects empty content", () => {
			const result = NextPromptWriter.validate("");
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Content is empty");
		});

		it("rejects content exceeding line limit", () => {
			const lines = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`);
			const content = lines.join("\n");
			const result = NextPromptWriter.validate(content);

			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("exceeds maximum"))).toBe(true);
		});

		it("detects missing required fields", () => {
			const result = NextPromptWriter.validate("Just some text\n");
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("Project:"))).toBe(true);
		});

		it("detects missing file load field", () => {
			const content = "Project: test\nActive chunk: 1\nResume: something\n";
			const result = NextPromptWriter.validate(content);
			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes("file load field"))).toBe(true);
		});

		it("accepts new 'Load:' field name", () => {
			const content = "Project: test\nActive chunk: 1\nLoad: file.ts\nResume: something\n";
			const result = NextPromptWriter.validate(content);
			// Should find Project, Active chunk, and Load: — valid for field checks
			const fieldErrors = result.errors.filter(
				(e) => e.includes("Missing required field") || e.includes("file load field"),
			);
			expect(fieldErrors).toHaveLength(0);
		});

		it("accepts legacy 'Files to load:' field name", () => {
			const content = "Project: test\nActive chunk: 1\nFiles to load: file.ts\nResume: something\n";
			const result = NextPromptWriter.validate(content);
			const fieldErrors = result.errors.filter(
				(e) => e.includes("Missing required field") || e.includes("file load field"),
			);
			expect(fieldErrors).toHaveLength(0);
		});
	});

	describe("generateWithFormatter", () => {
		function makeBudget(): ContextBudget {
			const filesMap = new Map<string, number>();
			filesMap.set("packages/core/src/index.ts", 100);

			const breakdown: ContextBudgetBreakdown = {
				sessionState: 100,
				planChunk: 150,
				files: filesMap,
				alwaysInclude: 50,
			};

			return {
				totalTokens: 400,
				breakdown,
				overBudget: false,
				budgetCap: 4000,
			};
		}

		function makeBootstrapContext(): BootstrapContext {
			return {
				state: makeState(),
				chunk: makeChunk(),
				chunkFiles: makeFiles(),
				alwaysIncludeFiles: [
					{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI", token_cost: 50 },
				],
				budget: makeBudget(),
				excludePatterns: ["**/__tests__/**"],
				projectName: "dev-session",
			};
		}

		it("delegates to the provided formatter", () => {
			const ctx = makeBootstrapContext();
			const content = NextPromptWriter.generateWithFormatter(PlainTextFormatter, ctx);

			expect(content).toContain("Project: dev-session");
			expect(content).toContain("Active chunk: 3");
			expect(content).toContain("Budget:");
		});

		it("produces content that passes validation", () => {
			const ctx = makeBootstrapContext();
			const content = NextPromptWriter.generateWithFormatter(PlainTextFormatter, ctx);
			const result = NextPromptWriter.validate(content);

			expect(result.valid).toBe(true);
		});
	});
});
