/**
 * Shared test helpers for adapter formatter tests.
 *
 * Provides factory functions for creating test context objects
 * that are consistent across all formatter test suites.
 *
 * @module
 */

import type {
	BootstrapContext,
	ContextBudget,
	ContextBudgetBreakdown,
	FileIndexEntry,
	PlanChunk,
	SessionState,
} from "@dev-session/core";

/**
 * Creates a test SessionState with sensible defaults.
 *
 * @param overrides - Partial overrides to apply.
 * @returns A complete SessionState for testing.
 */
export function makeState(overrides?: Partial<SessionState>): SessionState {
	return {
		active_chunk: 4,
		session_id: "test-session",
		last_updated: "2026-04-06",
		tasks: [
			{ text: "Task A", status: "done", completed_at: "2026-04-06T10:00:00Z" },
			{ text: "Task B", status: "in-progress" },
			{ text: "Task C", status: "todo" },
		],
		notes: ["Important decision made"],
		last_worked_files: ["packages/cli/src/index.ts"],
		completed_chunks: { "1": "2026-03-25", "2": "2026-03-28", "3": "2026-04-01" },
		...overrides,
	};
}

/**
 * Creates a test PlanChunk with sensible defaults.
 *
 * @param overrides - Partial overrides to apply.
 * @returns A complete PlanChunk for testing.
 */
export function makeChunk(overrides?: Partial<PlanChunk>): PlanChunk {
	return {
		chunk_id: 4,
		title: "CLI: init command",
		depends_on: [2, 3],
		tasks: [
			{ text: "Set up commander", status: "done", completed_at: "2026-04-06T10:00:00Z" },
			{ text: "Add wizard flow", status: "in-progress" },
			{ text: "Write tests", status: "todo" },
		],
		...overrides,
	};
}

/**
 * Creates an array of test FileIndexEntry objects.
 *
 * @param count - Number of entries to create.
 * @returns Array of FileIndexEntry objects.
 */
export function makeFiles(count: number): FileIndexEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		filepath: `packages/cli/src/file-${String(i)}.ts`,
		chunk_tags: [4],
		purpose: `File ${String(i)}`,
		token_cost: 100,
	}));
}

/**
 * Creates a test ContextBudget with sensible defaults.
 *
 * @param overrides - Partial overrides to apply.
 * @returns A complete ContextBudget for testing.
 */
export function makeBudget(overrides?: Partial<ContextBudget>): ContextBudget {
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

/**
 * Creates a test BootstrapContext with sensible defaults.
 *
 * @param overrides - Partial overrides to apply.
 * @returns A complete BootstrapContext for testing.
 */
export function makeContext(overrides?: Partial<BootstrapContext>): BootstrapContext {
	return {
		state: makeState(),
		chunk: makeChunk(),
		chunkFiles: makeFiles(2),
		alwaysIncludeFiles: [
			{ filepath: "CLAUDE.md", chunk_tags: [0], purpose: "AI instructions", token_cost: 50 },
		],
		budget: makeBudget(),
		excludePatterns: ["packages/security/**", "**/__tests__/**"],
		projectName: "dev-sesssion",
		...overrides,
	};
}
