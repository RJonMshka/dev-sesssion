import { describe, expect, it } from "vitest";
import { ContextBudgetCalculator } from "../calculators/context-budget-calculator.js";
import { DEFAULT_CONTEXT_BUDGET } from "../schemas/context-budget.js";
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
		notes: ["Some important note"],
		last_worked_files: ["packages/cli/src/index.ts", "packages/core/src/index.ts"],
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

function makeFiles(count: number, tokenCost?: number): FileIndexEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		filepath: `packages/cli/src/file-${String(i)}.ts`,
		chunk_tags: [4],
		purpose: `File ${String(i)}`,
		token_cost: tokenCost,
	}));
}

function makeAlwaysInclude(): FileIndexEntry[] {
	return [
		{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI instructions", token_cost: 200 },
		{
			filepath: ".session/SESSION_STATE.md",
			chunk_tags: [0],
			purpose: "Session state",
			token_cost: 100,
		},
	];
}

describe("ContextBudgetCalculator", () => {
	describe("estimate", () => {
		it("returns a valid ContextBudget with breakdown", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(3, 150),
				makeAlwaysInclude(),
			);

			expect(budget.totalTokens).toBeGreaterThan(0);
			expect(budget.budgetCap).toBe(DEFAULT_CONTEXT_BUDGET);
			expect(typeof budget.overBudget).toBe("boolean");
			expect(budget.breakdown.sessionState).toBeGreaterThan(0);
			expect(budget.breakdown.planChunk).toBeGreaterThan(0);
			expect(budget.breakdown.files.size).toBe(3);
			expect(budget.breakdown.alwaysInclude).toBe(300); // 200 + 100
		});

		it("uses token_cost from FileIndexEntry when available", () => {
			const files = makeFiles(2, 500);
			const budget = ContextBudgetCalculator.estimate(makeState(), makeChunk(), files, []);

			let filesTotal = 0;
			for (const cost of budget.breakdown.files.values()) {
				filesTotal += cost;
			}

			expect(filesTotal).toBe(1000); // 2 * 500
		});

		it("uses default token cost when token_cost is not set", () => {
			const files = makeFiles(3); // no token_cost
			const budget = ContextBudgetCalculator.estimate(makeState(), makeChunk(), files, []);

			let filesTotal = 0;
			for (const cost of budget.breakdown.files.values()) {
				filesTotal += cost;
			}

			// Default is 50 tokens per file
			expect(filesTotal).toBe(150); // 3 * 50
		});

		it("reports overBudget when total exceeds cap", () => {
			const files = makeFiles(10, 1000); // 10 * 1000 = 10000 tokens
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				files,
				makeAlwaysInclude(),
				2000, // small cap
			);

			expect(budget.overBudget).toBe(true);
			expect(budget.totalTokens).toBeGreaterThan(2000);
		});

		it("reports within budget when total is under cap", () => {
			const files = makeFiles(2, 100);
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				files,
				[],
				10000, // generous cap
			);

			expect(budget.overBudget).toBe(false);
		});

		it("uses DEFAULT_CONTEXT_BUDGET when no cap is specified", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(1, 10),
				[],
			);

			expect(budget.budgetCap).toBe(DEFAULT_CONTEXT_BUDGET);
		});

		it("handles empty file lists", () => {
			const budget = ContextBudgetCalculator.estimate(makeState(), makeChunk(), [], []);

			expect(budget.breakdown.files.size).toBe(0);
			expect(budget.breakdown.alwaysInclude).toBe(0);
			// Should still have session state + plan chunk tokens
			expect(budget.totalTokens).toBeGreaterThan(0);
		});

		it("handles state with many notes and tasks", () => {
			const bigState = makeState({
				tasks: Array.from({ length: 50 }, (_, i) => ({
					text: `Task number ${String(i)} with a reasonably long description`,
					status: "todo" as const,
				})),
				notes: Array.from({ length: 20 }, (_, i) => `Note ${String(i)}: important detail`),
			});

			const budget = ContextBudgetCalculator.estimate(bigState, makeChunk(), makeFiles(1, 10), []);

			// More tasks + notes = higher session state token estimate
			expect(budget.breakdown.sessionState).toBeGreaterThan(100);
		});

		it("accepts custom budget cap", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(1, 10),
				[],
				8000,
			);

			expect(budget.budgetCap).toBe(8000);
		});
	});

	describe("estimateLayered", () => {
		it("charges layered file costs, splitting chunk vs always-include", () => {
			const resolved = [
				{
					filepath: "src/a.ts",
					role: "chunk" as const,
					baseLayer: 0 as const,
					layer: 0 as const,
					escalated: false,
					fullTokenCost: 1000,
					layeredTokenCost: 80,
				},
				{
					filepath: "CLAUDE.md",
					role: "always-include" as const,
					baseLayer: 1 as const,
					layer: 1 as const,
					escalated: false,
					fullTokenCost: 400,
					layeredTokenCost: 120,
				},
			];

			const budget = ContextBudgetCalculator.estimateLayered(makeState(), makeChunk(), resolved);

			expect(budget.breakdown.files.size).toBe(1);
			expect(budget.breakdown.files.get("src/a.ts")).toBe(80);
			expect(budget.breakdown.alwaysInclude).toBe(120);
		});

		it("costs less than the whole-file estimate when files are not escalated", () => {
			const resolved = [
				{
					filepath: "src/a.ts",
					role: "chunk" as const,
					baseLayer: 0 as const,
					layer: 0 as const,
					escalated: false,
					fullTokenCost: 5000,
					layeredTokenCost: 90,
				},
			];

			const layered = ContextBudgetCalculator.estimateLayered(makeState(), makeChunk(), resolved);
			const whole = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				[makeFiles(1, 5000)[0] as FileIndexEntry],
				[],
			);

			expect(layered.totalTokens).toBeLessThan(whole.totalTokens);
		});

		it("honors a custom budget cap and reports overBudget", () => {
			const resolved = [
				{
					filepath: "src/a.ts",
					role: "chunk" as const,
					baseLayer: 2 as const,
					layer: 2 as const,
					escalated: true,
					escalatedBy: "work on src/a.ts",
					fullTokenCost: 9000,
					layeredTokenCost: 9000,
				},
			];

			const budget = ContextBudgetCalculator.estimateLayered(
				makeState(),
				makeChunk(),
				resolved,
				1000,
			);

			expect(budget.budgetCap).toBe(1000);
			expect(budget.overBudget).toBe(true);
		});

		it("handles an empty resolved list", () => {
			const budget = ContextBudgetCalculator.estimateLayered(makeState(), makeChunk(), []);
			expect(budget.breakdown.files.size).toBe(0);
			expect(budget.breakdown.alwaysInclude).toBe(0);
			expect(budget.totalTokens).toBeGreaterThan(0);
		});
	});

	describe("estimateFromString", () => {
		it("estimates tokens from a string", () => {
			// ~100 chars ≈ 25 tokens (1 token per 4 bytes)
			const content = "a".repeat(100);
			const tokens = ContextBudgetCalculator.estimateFromString(content);
			expect(tokens).toBe(25);
		});

		it("returns 0 for empty string", () => {
			expect(ContextBudgetCalculator.estimateFromString("")).toBe(0);
		});

		it("handles multi-byte characters", () => {
			// Multi-byte chars should produce higher token estimate
			const ascii = "aaaa"; // 4 bytes → 1 token
			const emoji = "😀😀😀😀"; // 16 bytes → 4 tokens
			expect(ContextBudgetCalculator.estimateFromString(emoji)).toBeGreaterThan(
				ContextBudgetCalculator.estimateFromString(ascii),
			);
		});
	});

	describe("accurate flag", () => {
		it("estimate() always returns accurate: false (heuristic-only)", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(3, 150),
				makeAlwaysInclude(),
			);

			expect(budget.accurate).toBe(false);
		});

		it("estimate() returns accurate: false even with token_cost populated", () => {
			// token_cost in FileIndexEntry was populated by a prior run — but
			// the calculator itself still uses heuristic for session state / plan chunk
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(5, 500),
				makeAlwaysInclude(),
			);

			expect(budget.accurate).toBe(false);
		});

		it("estimate() returns accurate: false for empty file lists", () => {
			const budget = ContextBudgetCalculator.estimate(makeState(), makeChunk(), [], []);
			expect(budget.accurate).toBe(false);
		});
	});

	describe("formatSummary", () => {
		it("formats a within-budget summary", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(3, 100),
				makeAlwaysInclude(),
			);

			const summary = ContextBudgetCalculator.formatSummary(budget);
			expect(summary).toContain("within budget");
			expect(summary).toContain("SESSION_STATE");
			expect(summary).toContain("Plan chunk");
			expect(summary).toContain("Always-include");
			expect(summary).toContain("Context files");
			expect(summary).toContain("3 files");
		});

		it("formats an over-budget summary", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(10, 1000),
				makeAlwaysInclude(),
				2000,
			);

			const summary = ContextBudgetCalculator.formatSummary(budget);
			expect(summary).toContain("OVER BUDGET");
		});

		it("shows approximate qualifier when not accurate", () => {
			const budget = ContextBudgetCalculator.estimate(
				makeState(),
				makeChunk(),
				makeFiles(2, 100),
				makeAlwaysInclude(),
			);

			const summary = ContextBudgetCalculator.formatSummary(budget);
			expect(summary).toContain("approximate");
			expect(summary).toContain("heuristic");
		});

		it("omits approximate qualifier when accurate", () => {
			const filesMap = new Map<string, number>();
			filesMap.set("src/index.ts", 150);

			const accurateBudget = {
				totalTokens: 500,
				breakdown: {
					sessionState: 100,
					planChunk: 100,
					files: filesMap,
					alwaysInclude: 150,
				},
				overBudget: false,
				budgetCap: 4000,
				accurate: true,
			};

			const summary = ContextBudgetCalculator.formatSummary(accurateBudget);
			expect(summary).not.toContain("approximate");
			expect(summary).not.toContain("~");
		});
	});
});
