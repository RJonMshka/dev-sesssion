import { describe, expect, it } from "vitest";
import { WindsurfBootstrapFormatter } from "../windsurf-bootstrap-formatter.js";
import { makeBudget, makeChunk, makeContext, makeFiles, makeState } from "./test-helpers.js";

describe("WindsurfBootstrapFormatter", () => {
	it("has the name 'windsurf'", () => {
		expect(WindsurfBootstrapFormatter.name).toBe("windsurf");
	});

	describe("formatFilesToLoad", () => {
		it("returns '(none)' for empty files", () => {
			expect(WindsurfBootstrapFormatter.formatFilesToLoad([])).toBe("(none)");
		});

		it("formats file paths as plain comma-separated list", () => {
			const files = makeFiles(3);
			const result = WindsurfBootstrapFormatter.formatFilesToLoad(files);
			expect(result).toContain("packages/cli/src/file-0.ts");
			expect(result).toContain("packages/cli/src/file-1.ts");
			expect(result).toContain("packages/cli/src/file-2.ts");
		});

		it("does not prefix with @", () => {
			const files = makeFiles(1);
			const result = WindsurfBootstrapFormatter.formatFilesToLoad(files);
			expect(result).not.toContain("@");
		});

		it("truncates long file lists with count", () => {
			const files = makeFiles(10);
			const result = WindsurfBootstrapFormatter.formatFilesToLoad(files);
			expect(result).toContain("+4 more");
		});
	});

	describe("formatExcludes", () => {
		it("returns empty string for no patterns", () => {
			expect(WindsurfBootstrapFormatter.formatExcludes([])).toBe("");
		});

		it("uses 'Ignore' directive", () => {
			const result = WindsurfBootstrapFormatter.formatExcludes([
				"packages/security/**",
				"**/__tests__/**",
			]);
			expect(result).toContain("Ignore:");
			expect(result).toContain("packages/security/**");
			expect(result).toContain("**/__tests__/**");
		});

		it("does NOT use 'Do NOT load' or 'Exclude'", () => {
			const result = WindsurfBootstrapFormatter.formatExcludes(["some/pattern"]);
			expect(result).not.toContain("Do NOT load");
			expect(result).not.toContain("Exclude:");
		});
	});

	describe("generatePrompt", () => {
		it("produces content with required fields", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Project: dev-session");
			expect(content).toContain("Active chunk: 4");
			expect(content).toContain("CLI: init command");
			expect(content).toContain("Budget:");
			expect(content).toContain("Load:");
		});

		it("stays within 20 line cap", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBeLessThanOrEqual(20);
		});

		it("uses plain paths (no @ prefix) in Load line", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Load: CLAUDE.md");
			expect(content).not.toContain("@CLAUDE.md");
		});

		it("uses 'Ignore' for excludes", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Ignore:");
		});

		it("includes completed chunks summary", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Chunks 1-3 done");
		});

		it("includes chunk progress", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("1/3 tasks done");
		});

		it("includes pending tasks with status markers", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("[WIP] Add wizard flow");
			expect(content).toContain("[ ] Write tests");
		});

		it("includes notes", () => {
			const content = WindsurfBootstrapFormatter.generatePrompt(makeContext());
			expect(content).toContain("Note: Important decision made");
		});

		it("handles state with no completed chunks", () => {
			const state = makeState({ completed_chunks: {} });
			const ctx = makeContext({ state });
			const content = WindsurfBootstrapFormatter.generatePrompt(ctx);
			expect(content).not.toContain("Chunks");
		});

		it("handles state with no last_worked_files", () => {
			const state = makeState({ last_worked_files: [] });
			const ctx = makeContext({ state });
			const content = WindsurfBootstrapFormatter.generatePrompt(ctx);
			expect(content).not.toContain("Last touched:");
		});

		it("shows over-budget status", () => {
			const budget = makeBudget({ overBudget: true, totalTokens: 5000, budgetCap: 4000 });
			const ctx = makeContext({ budget });
			const content = WindsurfBootstrapFormatter.generatePrompt(ctx);
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
			const content = WindsurfBootstrapFormatter.generatePrompt(ctx);
			expect(content).toContain("+6 more tasks");
		});
	});
});
