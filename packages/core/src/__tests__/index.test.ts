/**
 * Barrel contract tests for @dev-session/core.
 *
 * Everything here goes through `../index.js` on purpose: the point is to
 * prove the public entry point exposes a *working* API surface, not merely
 * that names exist. Deep behavior lives in the per-module suites.
 */

import { describe, expect, it } from "vitest";
import type { FileIndexEntry } from "../index.js";
import {
	ContextBudgetCalculator,
	DEFAULT_CONTEXT_BUDGET,
	ParseError,
	PlainTextFormatter,
	PlanParser,
	SessionStateSchema,
	TaskStatus,
	TokenCounter,
} from "../index.js";

describe("@dev-session/core public surface", () => {
	it("round-trips a plan chunk through PlanParser", () => {
		const chunk = {
			chunk_id: 3,
			title: "Security utilities",
			depends_on: [1, 2],
			est_sessions: 2,
			tasks: [
				{ text: "Write PathValidator", status: TaskStatus.DONE },
				{ text: "Write AtomicWriter", status: TaskStatus.TODO },
			],
		};

		const parsed = PlanParser.fromMarkdown(PlanParser.toMarkdown(chunk));

		expect(parsed).toHaveLength(1);
		expect(parsed[0]).toMatchObject({
			chunk_id: 3,
			title: "Security utilities",
			depends_on: [1, 2],
			est_sessions: 2,
		});
		expect(parsed[0]?.tasks.map((t) => t.status)).toEqual([TaskStatus.DONE, TaskStatus.TODO]);
	});

	it("PlanParser rejects empty plans with ParseError", () => {
		expect(() => PlanParser.fromMarkdown("  \n ")).toThrow(ParseError);
	});

	it("TaskStatus values match the SESSION_STATE.md frontmatter contract", () => {
		expect(TaskStatus).toEqual({
			TODO: "todo",
			IN_PROGRESS: "in-progress",
			DONE: "done",
		});
	});

	it("SessionStateSchema accepts a minimal state and applies defaults", () => {
		const state = SessionStateSchema.parse({
			active_chunk: 1,
			session_id: "abc",
			last_updated: "2026-07-05",
		});

		expect(state.tasks).toEqual([]);
		expect(state.last_worked_files).toEqual([]);
		expect(state.completed_chunks).toEqual({});
	});

	it("SessionStateSchema rejects unknown keys and invalid chunk ids", () => {
		expect(() =>
			SessionStateSchema.parse({
				active_chunk: 0,
				session_id: "abc",
				last_updated: "2026-07-05",
			}),
		).toThrow();

		expect(() =>
			SessionStateSchema.parse({
				active_chunk: 1,
				session_id: "abc",
				last_updated: "2026-07-05",
				injected: true,
			}),
		).toThrow();
	});

	it("PlainTextFormatter formats and truncates file lists", () => {
		const entry = (filepath: string): FileIndexEntry => ({
			filepath,
			chunk_tags: [1],
			purpose: "test fixture",
		});

		expect(PlainTextFormatter.formatFilesToLoad([])).toBe("(none)");
		expect(PlainTextFormatter.formatFilesToLoad([entry("a.ts"), entry("b.ts")])).toBe("a.ts, b.ts");

		const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => entry(`${n}.ts`));
		expect(PlainTextFormatter.formatFilesToLoad(many)).toBe(
			"a.ts, b.ts, c.ts, d.ts, e.ts, f.ts, +2 more",
		);
	});

	it("PlainTextFormatter renders excludes as a Do-NOT-load instruction", () => {
		expect(PlainTextFormatter.formatExcludes([])).toBe("");
		expect(PlainTextFormatter.formatExcludes(["dist/**", "*.lock"])).toBe(
			"Do NOT load: dist/**, *.lock",
		);
	});

	it("TokenCounter heuristic grows with input size and is never negative", () => {
		const short = TokenCounter.heuristicCount("hello");
		const long = TokenCounter.heuristicCount("hello ".repeat(500));

		expect(short).toBeGreaterThan(0);
		expect(long).toBeGreaterThan(short);
		expect(TokenCounter.heuristicCount("")).toBeGreaterThanOrEqual(0);
	});

	it("ContextBudgetCalculator estimates raw strings proportionally to size", () => {
		const small = ContextBudgetCalculator.estimateFromString("word ".repeat(10));
		const large = ContextBudgetCalculator.estimateFromString("word ".repeat(1000));

		expect(DEFAULT_CONTEXT_BUDGET).toBe(4000);
		expect(small).toBeGreaterThan(0);
		expect(large).toBeGreaterThan(small);
	});
});
