import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ContextBudget, FileIndexEntry, PlanChunk, SessionState } from "@dev-session/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildStatusJson,
	computeWarnings,
	countTasks,
	daysSinceLastSession,
	renderProgressBar,
	runStatus,
} from "../commands/status.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "status-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Build a minimal SessionState for testing. */
function makeState(overrides: Partial<SessionState> = {}): SessionState {
	return {
		active_chunk: 1,
		session_id: "test-session-id",
		last_updated: "2026-04-03",
		tasks: [],
		last_worked_files: [],
		notes: [],
		completed_chunks: {},
		...overrides,
	};
}

/** Build a minimal PlanChunk for testing. */
function makeChunk(overrides: Partial<PlanChunk> = {}): PlanChunk {
	return {
		chunk_id: 1,
		title: "Test chunk",
		depends_on: [],
		tasks: [
			{ text: "Task A", status: "done" },
			{ text: "Task B", status: "in-progress" },
			{ text: "Task C", status: "todo" },
			{ text: "Task D", status: "todo" },
		],
		...overrides,
	};
}

/** Build a minimal ContextBudget for testing. */
function makeBudget(overrides: Partial<ContextBudget> = {}): ContextBudget {
	return {
		totalTokens: 2000,
		budgetCap: 4000,
		overBudget: false,
		accurate: false,
		breakdown: {
			sessionState: 100,
			planChunk: 200,
			alwaysInclude: 300,
			files: new Map<string, number>(),
		},
		...overrides,
	};
}

/** Build a minimal FileIndexEntry for testing. */
function makeEntry(filepath: string, chunkTags: number[] = [1]): FileIndexEntry {
	return {
		filepath,
		chunk_tags: chunkTags,
		purpose: `Purpose of ${filepath}`,
	};
}

describe("countTasks", () => {
	it("counts tasks by status", () => {
		const result = countTasks(makeChunk().tasks);
		expect(result.total).toBe(4);
		expect(result.done).toBe(1);
		expect(result.inProgress).toBe(1);
		expect(result.todo).toBe(2);
		expect(result.percentComplete).toBe(25);
	});

	it("returns 0% for empty task list", () => {
		const result = countTasks([]);
		expect(result.total).toBe(0);
		expect(result.percentComplete).toBe(0);
	});

	it("returns 100% when all done", () => {
		const tasks = [
			{ text: "A", status: "done" as const },
			{ text: "B", status: "done" as const },
		];
		const result = countTasks(tasks);
		expect(result.percentComplete).toBe(100);
	});
});

describe("daysSinceLastSession", () => {
	it("returns 0 for today", () => {
		const today = new Date().toISOString().split("T")[0] ?? "";
		const result = daysSinceLastSession(today);
		expect(result).toBe(0);
	});

	it("returns null for unparseable date", () => {
		expect(daysSinceLastSession("not-a-date")).toBeNull();
	});

	it("returns positive number for past dates", () => {
		// 10 days ago
		const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		const result = daysSinceLastSession(past.toISOString().split("T")[0] ?? "");
		expect(result).toBeGreaterThanOrEqual(9);
		expect(result).toBeLessThanOrEqual(11);
	});
});

describe("renderProgressBar", () => {
	it("renders 0%", () => {
		const bar = renderProgressBar(0, 10);
		expect(bar).toBe("[          ]");
	});

	it("renders 50%", () => {
		const bar = renderProgressBar(50, 10);
		expect(bar).toBe("[====>     ]");
	});

	it("renders 100%", () => {
		const bar = renderProgressBar(100, 10);
		expect(bar).toBe("[=========>]");
	});
});

describe("computeWarnings", () => {
	it("warns when NEXT_PROMPT exceeds max lines", () => {
		const warnings = computeWarnings(makeState(), makeChunk(), [], 25, makeBudget());
		expect(warnings.some((w) => w.includes("NEXT_PROMPT"))).toBe(true);
	});

	it("warns when always-include exceeds 4", () => {
		const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`file${String(i)}.ts`, [0]));
		const warnings = computeWarnings(makeState(), makeChunk(), entries, undefined, makeBudget());
		expect(warnings.some((w) => w.includes("creep detected"))).toBe(true);
	});

	it("warns when over budget", () => {
		const budget = makeBudget({ overBudget: true, totalTokens: 5000, budgetCap: 4000 });
		const warnings = computeWarnings(makeState(), makeChunk(), [], undefined, budget);
		expect(warnings.some((w) => w.includes("exceeded"))).toBe(true);
	});

	it("warns when all tasks are done", () => {
		const chunk = makeChunk({
			tasks: [
				{ text: "A", status: "done" },
				{ text: "B", status: "done" },
			],
		});
		const warnings = computeWarnings(makeState(), chunk, [], undefined, makeBudget());
		expect(warnings.some((w) => w.includes("advance"))).toBe(true);
	});

	it("returns empty array when healthy", () => {
		const warnings = computeWarnings(makeState(), makeChunk(), [], 10, makeBudget());
		expect(warnings).toHaveLength(0);
	});
});

describe("buildStatusJson", () => {
	it("builds correct JSON structure", () => {
		const state = makeState();
		const chunk = makeChunk();
		const allEntries = [makeEntry("a.ts"), makeEntry("b.ts", [0])];
		const alwaysInclude = [makeEntry("b.ts", [0])];
		const chunkFiles = [makeEntry("a.ts")];
		const budget = makeBudget();
		const warnings = ["some warning"];

		const json = buildStatusJson(
			state,
			chunk,
			allEntries,
			alwaysInclude,
			chunkFiles,
			budget,
			warnings,
		);

		expect(json.active_chunk).toBe(1);
		expect(json.chunk_title).toBe("Test chunk");
		expect(json.session_id).toBe("test-session-id");
		expect(json.tasks.total).toBe(4);
		expect(json.tasks.done).toBe(1);
		expect(json.tasks.percent_complete).toBe(25);
		expect(json.files.always_include).toBe(1);
		expect(json.files.indexed).toBe(2);
		expect(json.files.context).toBe(1);
		expect(json.budget.total_tokens).toBe(2000);
		expect(json.budget.over_budget).toBe(false);
		expect(json.warnings).toEqual(["some warning"]);
	});
});

describe("runStatus", () => {
	/**
	 * Set up a valid .session/ directory with SESSION_STATE.md,
	 * PLAN_1.md, and FILE_INDEX.md.
	 */
	function setupSession(): void {
		const sessionDir = path.join(tmpDir, ".session");
		fs.mkdirSync(sessionDir, { recursive: true });

		// SESSION_STATE.md
		fs.writeFileSync(
			path.join(sessionDir, "SESSION_STATE.md"),
			[
				"---",
				"active_chunk: 1",
				'session_id: "test-session"',
				'last_updated: "2026-04-03"',
				"tasks:",
				'  - text: "Task A"',
				'    status: "done"',
				'  - text: "Task B"',
				'    status: "todo"',
				"last_worked_files: []",
				"notes: []",
				"completed_chunks: {}",
				"---",
				"",
				"# Session State",
			].join("\n"),
		);

		// PLAN_1.md
		fs.writeFileSync(
			path.join(sessionDir, "PLAN_1.md"),
			[
				"---",
				"chunk_id: 1",
				'title: "Foundation"',
				"depends_on: []",
				"tasks:",
				'  - text: "Task A"',
				'    status: "done"',
				'  - text: "Task B"',
				'    status: "todo"',
				"---",
				"",
				"# Chunk 1",
			].join("\n"),
		);

		// FILE_INDEX.md
		fs.writeFileSync(
			path.join(sessionDir, "FILE_INDEX.md"),
			[
				"---",
				"version: 1",
				'last_updated: "2026-04-03"',
				"---",
				"",
				"# File Index",
				"",
				"## Always Include",
				"",
				"| File | Purpose |",
				"|---|---|",
				"| CLAUDE.md | AI instructions |",
				"",
				"## Chunk 1 — Foundation",
				"",
				"| File | Purpose |",
				"|---|---|",
				"| src/index.ts | Entry point |",
			].join("\n"),
		);
	}

	it("outputs valid JSON with --json", async () => {
		setupSession();

		const chunks: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
			const chunk = args[0];
			if (typeof chunk === "string") {
				chunks.push(chunk);
			}
			return true;
		});

		try {
			await runStatus({ cwd: tmpDir, json: true, verbose: false });
		} finally {
			writeSpy.mockRestore();
		}

		const output = chunks.join("");
		const parsed = JSON.parse(output);

		expect(parsed.active_chunk).toBe(1);
		expect(parsed.chunk_title).toBe("Foundation");
		expect(parsed.tasks.total).toBe(2);
		expect(parsed.tasks.done).toBe(1);
		expect(parsed.tasks.percent_complete).toBe(50);
		expect(parsed.budget).toBeDefined();
		expect(typeof parsed.budget.total_tokens).toBe("number");
		expect(Array.isArray(parsed.warnings)).toBe(true);
	});

	it("throws CliError when no .session/ exists", async () => {
		await expect(runStatus({ cwd: tmpDir, json: false, verbose: false })).rejects.toThrow(
			"No .session/ directory found",
		);
	});

	it("includes warnings in JSON output", async () => {
		setupSession();

		// Write an oversized NEXT_PROMPT.md to trigger warning
		const lines = Array.from({ length: 25 }, (_, i) => `Line ${String(i + 1)}`);
		fs.writeFileSync(path.join(tmpDir, ".session", "NEXT_PROMPT.md"), lines.join("\n"));

		const chunks: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
			const chunk = args[0];
			if (typeof chunk === "string") {
				chunks.push(chunk);
			}
			return true;
		});

		try {
			await runStatus({ cwd: tmpDir, json: true, verbose: false });
		} finally {
			writeSpy.mockRestore();
		}

		const output = chunks.join("");
		const parsed = JSON.parse(output);
		expect(parsed.warnings.some((w: string) => w.includes("NEXT_PROMPT"))).toBe(true);
	});

	it("displays human-readable output without --json", async () => {
		setupSession();

		// Just verify it doesn't throw — human output goes through @clack/prompts
		await runStatus({ cwd: tmpDir, json: false, verbose: false });
	});

	it("displays verbose output", async () => {
		setupSession();

		// Verbose mode should not throw
		await runStatus({ cwd: tmpDir, json: false, verbose: true });
	});
});
