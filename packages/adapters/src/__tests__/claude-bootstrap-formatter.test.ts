import { describe, expect, it } from "vitest";
import { ClaudeBootstrapFormatter } from "../claude-bootstrap-formatter.js";
import { makeBudget, makeChunk, makeContext, makeFiles, makeState } from "./test-helpers.js";

describe("ClaudeBootstrapFormatter", () => {
	it("has the name 'claude'", () => {
		expect(ClaudeBootstrapFormatter.name).toBe("claude");
	});

	describe("formatFilesToLoad", () => {
		it("returns '(none)' for empty files", () => {
			expect(ClaudeBootstrapFormatter.formatFilesToLoad([])).toBe("(none)");
		});

		it("prefixes file paths with @ for Claude Code mentions", () => {
			const files = makeFiles(3);
			const result = ClaudeBootstrapFormatter.formatFilesToLoad(files);
			expect(result).toContain("@packages/cli/src/file-0.ts");
			expect(result).toContain("@packages/cli/src/file-1.ts");
			expect(result).toContain("@packages/cli/src/file-2.ts");
		});

		it("does not double-prefix with @@", () => {
			const files = makeFiles(1);
			const result = ClaudeBootstrapFormatter.formatFilesToLoad(files);
			expect(result).not.toContain("@@");
		});

		it("truncates long file lists with count", () => {
			const files = makeFiles(10);
			const result = ClaudeBootstrapFormatter.formatFilesToLoad(files);
			expect(result).toContain("+4 more");
		});
	});

	describe("formatExcludes", () => {
		it("returns empty string for no patterns", () => {
			expect(ClaudeBootstrapFormatter.formatExcludes([])).toBe("");
		});

		it("uses 'Do NOT read' directive", () => {
			const result = ClaudeBootstrapFormatter.formatExcludes([
				"packages/security/**",
				"**/__tests__/**",
			]);
			expect(result).toContain("Do NOT read");
			expect(result).toContain("packages/security/**");
			expect(result).toContain("**/__tests__/**");
		});

		it("does NOT use 'Do NOT load'", () => {
			const result = ClaudeBootstrapFormatter.formatExcludes(["some/pattern"]);
			expect(result).not.toContain("Do NOT load");
		});
	});

	describe("generatePrompt", () => {
		it("produces content with required fields", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Project: dev-sesssion");
			expect(content).toContain("Active chunk: 4");
			expect(content).toContain("CLI: init command");
			expect(content).toContain("Budget:");
			expect(content).toContain("Load:");
		});

		it("stays within 20 line cap", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBeLessThanOrEqual(20);
		});

		it("uses @ prefix for files in Load line", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("@CLAUDE.md");
			expect(content).toContain("@packages/cli/src/file-0.ts");
		});

		it("uses @ prefix for last touched files", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("@packages/cli/src/index.ts");
		});

		it("uses 'Do NOT read' for excludes", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Do NOT read:");
		});

		it("includes completed chunks summary", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Chunks 1-3 done");
		});

		it("includes chunk progress", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("1/3 tasks done");
		});

		it("includes pending tasks with status markers", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("[WIP] Add wizard flow");
			expect(content).toContain("[ ] Write tests");
		});

		it("includes notes", () => {
			const content = ClaudeBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Note: Important decision made");
		});

		it("handles state with no completed chunks", () => {
			const state = makeState({ completed_chunks: {} });
			const ctx = makeContext({ state });
			const content = ClaudeBootstrapFormatter.generatePrompt(ctx);
			expect(content).not.toContain("Chunks");
		});

		it("handles state with no last_worked_files", () => {
			const state = makeState({ last_worked_files: [] });
			const ctx = makeContext({ state });
			const content = ClaudeBootstrapFormatter.generatePrompt(ctx);
			expect(content).not.toContain("Last touched:");
		});

		it("shows over-budget status", () => {
			const budget = makeBudget({ overBudget: true, totalTokens: 5000, budgetCap: 4000 });
			const ctx = makeContext({ budget });
			const content = ClaudeBootstrapFormatter.generatePrompt(ctx);
			expect(content).toContain("[OVER]");
		});

		it("handles many pending tasks with truncation", () => {
			const chunk = makeChunk({
				tasks: Array.from({ length: 10 }, (_, i) => ({
					text: `Task ${String(i)}`,
					status: "todo" as const,
				})),
			});
			const ctx = makeContext({ chunk });
			const content = ClaudeBootstrapFormatter.generatePrompt(ctx);
			expect(content).toContain("+6 more tasks");
		});
	});
});
