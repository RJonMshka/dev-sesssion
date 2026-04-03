import { describe, expect, it } from "vitest";
import type { BootstrapContext } from "../formatters/bootstrap-formatter.js";
import { PlainTextFormatter } from "../formatters/plain-text-formatter.js";
import type { ContextBudget, ContextBudgetBreakdown } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";

function makeState(overrides?: Partial<SessionState>): SessionState {
	return {
		active_chunk: 4,
		session_id: "test-session",
		last_updated: "2026-03-30",
		tasks: [
			{ text: "Task A", status: "done", completed_at: "2026-03-30T10:00:00Z" },
			{ text: "Task B", status: "in-progress" },
			{ text: "Task C", status: "todo" },
		],
		notes: ["Important decision made"],
		last_worked_files: ["packages/cli/src/index.ts"],
		completed_chunks: { "1": "2026-03-25", "2": "2026-03-28", "3": "2026-03-30" },
		...overrides,
	};
}

function makeChunk(overrides?: Partial<PlanChunk>): PlanChunk {
	return {
		chunk_id: 4,
		title: "CLI: init command",
		depends_on: [2, 3],
		tasks: [
			{ text: "Set up commander", status: "done", completed_at: "2026-03-30T10:00:00Z" },
			{ text: "Add wizard flow", status: "in-progress" },
			{ text: "Write tests", status: "todo" },
		],
		...overrides,
	};
}

function makeFiles(count: number): FileIndexEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		filepath: `packages/cli/src/file-${String(i)}.ts`,
		chunk_tags: [4],
		purpose: `File ${String(i)}`,
		token_cost: 100,
	}));
}

function makeBudget(overrides?: Partial<ContextBudget>): ContextBudget {
	const filesMap = new Map<string, number>();
	filesMap.set("packages/cli/src/index.ts", 100);
	filesMap.set("packages/cli/src/commands.ts", 200);

	const breakdown: ContextBudgetBreakdown = {
		sessionState: 150,
		planChunk: 200,
		files: filesMap,
		alwaysInclude: 100,
	};

	return {
		totalTokens: 750,
		breakdown,
		overBudget: false,
		budgetCap: 4000,
		accurate: false,
		...overrides,
	};
}

function makeContext(overrides?: Partial<BootstrapContext>): BootstrapContext {
	return {
		state: makeState(),
		chunk: makeChunk(),
		chunkFiles: makeFiles(2),
		alwaysIncludeFiles: [
			{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI instructions", token_cost: 50 },
		],
		budget: makeBudget(),
		excludePatterns: ["packages/security/**", "**/__tests__/**"],
		projectName: "dev-session",
		...overrides,
	};
}

describe("PlainTextFormatter", () => {
	it("has the name 'plain'", () => {
		expect(PlainTextFormatter.name).toBe("plain");
	});

	describe("formatFilesToLoad", () => {
		it("returns '(none)' for empty files", () => {
			expect(PlainTextFormatter.formatFilesToLoad([])).toBe("(none)");
		});

		it("formats a small list of files as comma-separated", () => {
			const files = makeFiles(3);
			const result = PlainTextFormatter.formatFilesToLoad(files);
			expect(result).toContain("packages/cli/src/file-0.ts");
			expect(result).toContain("packages/cli/src/file-1.ts");
			expect(result).toContain("packages/cli/src/file-2.ts");
		});

		it("truncates long file lists with count", () => {
			const files = makeFiles(10);
			const result = PlainTextFormatter.formatFilesToLoad(files);
			expect(result).toContain("+4 more");
		});
	});

	describe("formatExcludes", () => {
		it("returns empty string for no patterns", () => {
			expect(PlainTextFormatter.formatExcludes([])).toBe("");
		});

		it("formats patterns as a Do NOT load instruction", () => {
			const result = PlainTextFormatter.formatExcludes(["packages/security/**", "**/__tests__/**"]);
			expect(result).toContain("Do NOT load");
			expect(result).toContain("packages/security/**");
			expect(result).toContain("**/__tests__/**");
		});
	});

	describe("generatePrompt", () => {
		it("produces content with required fields", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());

			expect(content).toContain("Project: dev-session");
			expect(content).toContain("Active chunk: 4");
			expect(content).toContain("CLI: init command");
			expect(content).toContain("Budget:");
			expect(content).toContain("Load:");
		});

		it("stays within 20 line cap", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			const lines = content.split("\n").filter((l) => l.length > 0);
			expect(lines.length).toBeLessThanOrEqual(20);
		});

		it("includes exclude patterns when provided", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("Do NOT load");
			expect(content).toContain("packages/security/**");
		});

		it("omits excludes when none provided", () => {
			const ctx = makeContext({ excludePatterns: [] });
			const content = PlainTextFormatter.generatePrompt(ctx);
			expect(content).not.toContain("Do NOT load");
		});

		it("includes completed chunks summary", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("Chunks 1-3 done");
		});

		it("includes chunk progress", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("1/3 tasks done");
		});

		it("includes last touched files", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("Last touched:");
			expect(content).toContain("packages/cli/src/index.ts");
		});

		it("includes pending tasks with status markers", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("[WIP] Add wizard flow");
			expect(content).toContain("[ ] Write tests");
		});

		it("includes notes", () => {
			const content = PlainTextFormatter.generatePrompt(makeContext());
			expect(content).toContain("Note: Important decision made");
		});

		it("handles state with no completed chunks", () => {
			const state = makeState({ completed_chunks: {} });
			const ctx = makeContext({ state });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).not.toContain("Chunks");
			expect(content).toContain("1/3 tasks done");
		});

		it("handles single completed chunk", () => {
			const state = makeState({ completed_chunks: { "1": "2026-03-25" } });
			const ctx = makeContext({ state });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).toContain("Chunk 1 done");
		});

		it("handles non-consecutive completed chunks", () => {
			const state = makeState({ completed_chunks: { "1": "2026-03-25", "3": "2026-03-30" } });
			const ctx = makeContext({ state });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).toContain("Chunks 1, 3 done");
		});

		it("handles state with no notes", () => {
			const state = makeState({ notes: [] });
			const ctx = makeContext({ state });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).not.toContain("Note:");
		});

		it("handles state with no last_worked_files", () => {
			const state = makeState({ last_worked_files: [] });
			const ctx = makeContext({ state });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).not.toContain("Last touched:");
		});

		it("shows over-budget status", () => {
			const budget = makeBudget({ overBudget: true, totalTokens: 5000, budgetCap: 4000 });
			const ctx = makeContext({ budget });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).toContain("[OVER]");
		});

		it("shows within-budget status", () => {
			const budget = makeBudget({ overBudget: false });
			const ctx = makeContext({ budget });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).toContain("[OK]");
		});

		it("handles many pending tasks with truncation", () => {
			const chunk = makeChunk({
				tasks: Array.from({ length: 10 }, (_, i) => ({
					text: `Task ${String(i)}`,
					status: "todo" as const,
				})),
			});
			const ctx = makeContext({ chunk });
			const content = PlainTextFormatter.generatePrompt(ctx);

			expect(content).toContain("+6 more tasks");
		});
	});
});
