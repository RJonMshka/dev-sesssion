import { describe, expect, it } from "vitest";
import type { ResolvedFileLayer } from "../calculators/layer-resolver.js";
import {
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	formatLayeredContextLines,
	getPendingTasks,
	trimToMaxLines,
} from "../formatters/formatter-utils.js";
import type { ContextBudget, ContextBudgetBreakdown } from "../schemas/context-budget.js";
import type { PlanChunk, SessionState } from "../schemas/index.js";

function makeResolved(filepath: string, layer: 0 | 1 | 2, escalated = false): ResolvedFileLayer {
	return {
		filepath,
		role: layer === 1 ? "always-include" : "chunk",
		baseLayer: escalated ? 0 : layer,
		layer,
		escalated,
		fullTokenCost: 500,
		layeredTokenCost: layer === 2 ? 500 : 40,
	};
}

function makeState(overrides?: Partial<SessionState>): SessionState {
	return {
		active_chunk: 4,
		session_id: "test-session",
		last_updated: "2026-04-06",
		tasks: [],
		notes: [],
		last_worked_files: [],
		completed_chunks: { "1": "2026-03-25", "2": "2026-03-28", "3": "2026-04-01" },
		...overrides,
	};
}

function makeChunk(overrides?: Partial<PlanChunk>): PlanChunk {
	return {
		chunk_id: 4,
		title: "Test chunk",
		depends_on: [],
		tasks: [
			{ text: "Task A", status: "done", completed_at: "2026-04-06T10:00:00Z" },
			{ text: "Task B", status: "in-progress" },
			{ text: "Task C", status: "todo" },
		],
		...overrides,
	};
}

function makeBudget(overrides?: Partial<ContextBudget>): ContextBudget {
	const breakdown: ContextBudgetBreakdown = {
		sessionState: 150,
		planChunk: 200,
		files: new Map(),
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

describe("formatCompletedChunksSummary", () => {
	it("returns empty string for no completed chunks", () => {
		const state = makeState({ completed_chunks: {} });
		expect(formatCompletedChunksSummary(state)).toBe("");
	});

	it("returns 'Chunk N done.' for single chunk", () => {
		const state = makeState({ completed_chunks: { "1": "2026-03-25" } });
		expect(formatCompletedChunksSummary(state)).toBe("Chunk 1 done.");
	});

	it("returns 'Chunks 1-3 done.' for consecutive chunks", () => {
		const state = makeState();
		expect(formatCompletedChunksSummary(state)).toBe("Chunks 1-3 done.");
	});

	it("returns comma-separated list for non-consecutive chunks", () => {
		const state = makeState({ completed_chunks: { "1": "2026-03-25", "3": "2026-04-01" } });
		expect(formatCompletedChunksSummary(state)).toBe("Chunks 1, 3 done.");
	});

	it("ignores non-numeric keys", () => {
		const state = makeState({
			completed_chunks: { "1": "2026-03-25", abc: "2026-03-26", "2": "2026-03-28" },
		});
		expect(formatCompletedChunksSummary(state)).toBe("Chunks 1-2 done.");
	});
});

describe("formatChunkProgress", () => {
	it("shows done/total format", () => {
		const chunk = makeChunk();
		expect(formatChunkProgress(chunk)).toBe("1/3 tasks done, 1 in-progress");
	});

	it("omits in-progress when none", () => {
		const chunk = makeChunk({
			tasks: [
				{ text: "A", status: "done", completed_at: "2026-04-06" },
				{ text: "B", status: "todo" },
			],
		});
		expect(formatChunkProgress(chunk)).toBe("1/2 tasks done");
	});

	it("handles all tasks done", () => {
		const chunk = makeChunk({
			tasks: [
				{ text: "A", status: "done", completed_at: "2026-04-06" },
				{ text: "B", status: "done", completed_at: "2026-04-06" },
			],
		});
		expect(formatChunkProgress(chunk)).toBe("2/2 tasks done");
	});

	it("handles empty task list", () => {
		const chunk = makeChunk({ tasks: [] });
		expect(formatChunkProgress(chunk)).toBe("0/0 tasks done");
	});
});

describe("formatBudgetLine", () => {
	it("shows OK status when within budget", () => {
		const budget = makeBudget({ overBudget: false, totalTokens: 750, budgetCap: 4000 });
		expect(formatBudgetLine(budget)).toBe("Budget: ~750/4000 tokens [OK]");
	});

	it("shows OVER status when over budget", () => {
		const budget = makeBudget({ overBudget: true, totalTokens: 5000, budgetCap: 4000 });
		expect(formatBudgetLine(budget)).toBe("Budget: ~5000/4000 tokens [OVER]");
	});
});

describe("getPendingTasks", () => {
	it("returns todo and in-progress tasks", () => {
		const chunk = makeChunk();
		const pending = getPendingTasks(chunk);
		expect(pending).toHaveLength(2);
		expect(pending[0]?.text).toBe("Task B");
		expect(pending[1]?.text).toBe("Task C");
	});

	it("returns empty array when all done", () => {
		const chunk = makeChunk({
			tasks: [{ text: "A", status: "done", completed_at: "2026-04-06" }],
		});
		expect(getPendingTasks(chunk)).toHaveLength(0);
	});
});

describe("trimToMaxLines", () => {
	it("returns all lines when under cap", () => {
		const lines = ["a", "b", "c"];
		expect(trimToMaxLines(lines, 5)).toEqual(["a", "b", "c"]);
	});

	it("trims to max when over cap", () => {
		const lines = ["a", "b", "c", "d", "e"];
		expect(trimToMaxLines(lines, 3)).toEqual(["a", "b", "c"]);
	});

	it("returns exact cap when equal", () => {
		const lines = ["a", "b", "c"];
		expect(trimToMaxLines(lines, 3)).toEqual(["a", "b", "c"]);
	});
});

describe("formatLayeredContextLines", () => {
	it("splits full (layer 2) and summary (layer 0/1) files into separate lines", () => {
		const lines = formatLayeredContextLines(
			[
				makeResolved("src/full.ts", 2, true),
				makeResolved("src/sum.ts", 0),
				makeResolved("CLAUDE.md", 1),
			],
			(f) => f,
			6,
		);

		expect(lines[0]).toBe("Load full: src/full.ts");
		expect(lines[1]).toContain("Summaries (read_file_layer for detail):");
		expect(lines[1]).toContain("src/sum.ts·L0");
		expect(lines[1]).toContain("CLAUDE.md·L1");
	});

	it("applies the ref callback (e.g. @-mentions)", () => {
		const lines = formatLayeredContextLines(
			[makeResolved("src/full.ts", 2, true)],
			(f) => `@${f}`,
			6,
		);
		expect(lines[0]).toBe("Load full: @src/full.ts");
	});

	it("omits the full line when no files are escalated", () => {
		const lines = formatLayeredContextLines([makeResolved("src/a.ts", 0)], (f) => f, 6);
		expect(lines.some((l) => l.startsWith("Load full:"))).toBe(false);
		expect(lines[0]).toContain("Summaries");
	});

	it("truncates each line at maxFiles with a +N more suffix", () => {
		const summaries = Array.from({ length: 8 }, (_, i) => makeResolved(`src/f${String(i)}.ts`, 0));
		const lines = formatLayeredContextLines(summaries, (f) => f, 6);
		expect(lines[0]).toContain("+2 more");
	});

	it("falls back to an empty Load line when given no files", () => {
		const lines = formatLayeredContextLines([], (f) => f, 6);
		expect(lines).toEqual(["Load: (none)"]);
	});
});
