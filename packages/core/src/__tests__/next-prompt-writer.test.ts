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
import { countPromptLines, MAX_PROMPT_LINES } from "../schemas/index.js";

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
		const VALID_PROMPT = "Project: test\nActive chunk: 1\nLoad: src/index.ts\n";

		it("writes content to NEXT_PROMPT.md", () => {
			NextPromptWriter.write(tmpDir as ValidatedPath, VALID_PROMPT);
			const content = fs.readFileSync(path.join(tmpDir, "NEXT_PROMPT.md"), "utf-8");
			expect(content).toContain("Project: test");
		});

		it("throws CliError if content is empty", () => {
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, "")).toThrow(CliError);
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, "   ")).toThrow(CliError);
		});

		it("refuses to write a prompt missing required fields", () => {
			expect(() =>
				NextPromptWriter.write(tmpDir as ValidatedPath, "Project: test\nActive chunk: 1\n"),
			).toThrow(CliError);
			expect(fs.existsSync(path.join(tmpDir, "NEXT_PROMPT.md"))).toBe(false);
		});

		it("refuses to write a prompt over the line cap", () => {
			const tooLong = `${VALID_PROMPT}${Array.from({ length: MAX_PROMPT_LINES }, (_, i) => `note ${String(i)}`).join("\n")}\n`;
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, tooLong)).toThrow(CliError);
		});

		it("accepts a prompt sitting exactly at the line cap", () => {
			const filler = Array.from({ length: MAX_PROMPT_LINES - 3 }, (_, i) => `note ${String(i)}`);
			const exact = `Project: test\nActive chunk: 1\nLoad: src/index.ts\n${filler.join("\n")}\n`;
			expect(NextPromptWriter.validate(exact).lineCount).toBe(MAX_PROMPT_LINES);
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, exact)).not.toThrow();
		});
	});

	describe("configurable line cap", () => {
		it("enforces a lowered cap on write", () => {
			const filler = Array.from({ length: 8 }, (_, i) => `note ${String(i)}`);
			const prompt = `Project: test\nActive chunk: 1\nLoad: src/index.ts\n${filler.join("\n")}\n`;

			expect(NextPromptWriter.validate(prompt).valid).toBe(true);
			expect(NextPromptWriter.validate(prompt, 5).valid).toBe(false);
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, prompt, 5)).toThrow(CliError);
		});

		it("defaults to MAX_PROMPT_LINES when no cap is given", () => {
			const filler = Array.from({ length: MAX_PROMPT_LINES }, (_, i) => `note ${String(i)}`);
			const prompt = `Project: t\nActive chunk: 1\nLoad: a.ts\n${filler.join("\n")}\n`;
			expect(NextPromptWriter.validate(prompt).errors.join(" ")).toContain(
				String(MAX_PROMPT_LINES),
			);
		});
	});

	describe("countPromptLines", () => {
		it("does not count a trailing newline as a line", () => {
			expect(countPromptLines("a\nb\nc\n")).toBe(3);
			expect(countPromptLines("a\nb\nc")).toBe(3);
		});

		it("ignores blank lines so validate and health agree", () => {
			expect(countPromptLines("a\n\n\nb\n")).toBe(2);
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
				accurate: false,
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
				projectName: "dev-sesssion",
			};
		}

		it("writes layered formatter output without rejecting it", () => {
			// The layered path emits "Load full:" / "Summaries (...):" instead of a
			// flat "Load:" line. Validation must recognise those as file-load
			// fields, or every project with an ai-index.yaml fails to write.
			const ctx: BootstrapContext = {
				...makeBootstrapContext(),
				resolvedLayers: [
					{ filepath: "src/full.ts", layer: 2, escalated: true, tokens: 100, fullTokens: 100 },
					{ filepath: "src/summary.ts", layer: 1, escalated: false, tokens: 20, fullTokens: 80 },
				] as BootstrapContext["resolvedLayers"],
			};

			const content = NextPromptWriter.generateWithFormatter(PlainTextFormatter, ctx);
			expect(content).toContain("Load full:");
			expect(NextPromptWriter.validate(content).valid).toBe(true);
			expect(() => NextPromptWriter.write(tmpDir as ValidatedPath, content)).not.toThrow();
		});

		it("delegates to the provided formatter", () => {
			const ctx = makeBootstrapContext();
			const content = NextPromptWriter.generateWithFormatter(PlainTextFormatter, ctx);

			expect(content).toContain("Project: dev-sesssion");
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
