/**
 * Calculates the estimated token budget for a session's context window.
 *
 * Aggregates token costs from:
 * 1. SESSION_STATE.md (estimated from state content size)
 * 2. The active plan chunk (estimated from markdown size)
 * 3. Chunk-tagged files (from {@link FileIndexEntry.token_cost} or live estimation)
 * 4. Always-include files (from {@link FileIndexEntry.token_cost} or live estimation)
 *
 * Uses the heuristic of ~4 bytes per token for English text / code.
 *
 * @packageDocumentation
 */

import type { ContextBudget, ContextBudgetBreakdown } from "../schemas/context-budget.js";
import { DEFAULT_CONTEXT_BUDGET } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";

/** Bytes-per-token heuristic for English text and code. */
const BYTES_PER_TOKEN = 4;

/**
 * Estimates token count from a string's byte length.
 *
 * @param content - The string to estimate.
 * @returns Estimated token count.
 */
function estimateTokensFromString(content: string): number {
	const byteLength = Buffer.byteLength(content, "utf-8");
	return Math.ceil(byteLength / BYTES_PER_TOKEN);
}

/**
 * Estimates token cost for session state by serializing it to a rough size estimate.
 *
 * Counts the string lengths of key fields rather than re-serializing to avoid
 * importing the YAML serializer.
 *
 * @param state - The current session state.
 * @returns Estimated token count.
 */
function estimateSessionStateTokens(state: SessionState): number {
	let charCount = 0;

	// Frontmatter overhead
	charCount += 50; // delimiters + fixed fields

	// Tasks
	for (const task of state.tasks) {
		charCount += task.text.length + 30; // status, dates, YAML syntax
	}

	// Notes
	for (const note of state.notes) {
		charCount += note.length + 10;
	}

	// Last worked files
	for (const file of state.last_worked_files) {
		charCount += file.length + 10;
	}

	// Completed chunks
	charCount += Object.keys(state.completed_chunks).length * 25;

	return Math.ceil(charCount / BYTES_PER_TOKEN);
}

/**
 * Estimates token cost for a plan chunk by measuring its content.
 *
 * @param chunk - The active plan chunk.
 * @returns Estimated token count.
 */
function estimatePlanChunkTokens(chunk: PlanChunk): number {
	let charCount = 0;

	// Frontmatter
	charCount += 80; // delimiters + chunk_id + title + depends_on

	charCount += chunk.title.length;

	// Tasks
	for (const task of chunk.tasks) {
		charCount += task.text.length + 30;
	}

	return Math.ceil(charCount / BYTES_PER_TOKEN);
}

/**
 * Builds the per-file token breakdown from file index entries.
 *
 * Uses the entry's `token_cost` field if populated, otherwise falls back
 * to a conservative estimate based on a default file size.
 *
 * @param files - The file index entries for context files.
 * @param defaultTokenCost - Fallback token cost when entry has no estimate.
 * @returns A map of filepath to estimated token cost.
 */
function buildFileBreakdown(
	files: readonly FileIndexEntry[],
	defaultTokenCost: number,
): ReadonlyMap<string, number> {
	const breakdown = new Map<string, number>();

	for (const entry of files) {
		const cost = entry.token_cost ?? defaultTokenCost;
		breakdown.set(entry.filepath, cost);
	}

	return breakdown;
}

/**
 * Calculates the context budget for a session.
 *
 * Produces a full breakdown of estimated token costs and determines
 * whether the total exceeds the configured budget cap.
 */
export const ContextBudgetCalculator = {
	/**
	 * Estimates the total token budget for the current session context.
	 *
	 * @param state - The current session state.
	 * @param chunk - The active plan chunk.
	 * @param chunkFiles - File index entries tagged to the active chunk.
	 * @param alwaysIncludeFiles - File index entries tagged as always-include.
	 * @param budgetCap - The maximum token budget (defaults to {@link DEFAULT_CONTEXT_BUDGET}).
	 * @returns A {@link ContextBudget} with total, breakdown, and over-budget status.
	 */
	estimate(
		state: SessionState,
		chunk: PlanChunk,
		chunkFiles: readonly FileIndexEntry[],
		alwaysIncludeFiles: readonly FileIndexEntry[],
		budgetCap?: number,
	): ContextBudget {
		const cap = budgetCap ?? DEFAULT_CONTEXT_BUDGET;

		const sessionStateTokens = estimateSessionStateTokens(state);
		const planChunkTokens = estimatePlanChunkTokens(chunk);

		// Default per-file cost when no token_cost is populated: ~50 tokens (200 bytes)
		const DEFAULT_FILE_TOKEN_COST = 50;

		const fileBreakdown = buildFileBreakdown(chunkFiles, DEFAULT_FILE_TOKEN_COST);
		const alwaysIncludeBreakdown = buildFileBreakdown(alwaysIncludeFiles, DEFAULT_FILE_TOKEN_COST);

		let filesTotal = 0;
		for (const cost of fileBreakdown.values()) {
			filesTotal += cost;
		}

		let alwaysIncludeTotal = 0;
		for (const cost of alwaysIncludeBreakdown.values()) {
			alwaysIncludeTotal += cost;
		}

		const totalTokens = sessionStateTokens + planChunkTokens + filesTotal + alwaysIncludeTotal;

		const breakdown: ContextBudgetBreakdown = {
			sessionState: sessionStateTokens,
			planChunk: planChunkTokens,
			files: fileBreakdown,
			alwaysInclude: alwaysIncludeTotal,
		};

		return {
			totalTokens,
			breakdown,
			overBudget: totalTokens > cap,
			budgetCap: cap,
			accurate: false,
		};
	},

	/**
	 * Estimates token cost for a raw string content.
	 *
	 * Useful for ad-hoc estimation of arbitrary content.
	 *
	 * @param content - The string to estimate.
	 * @returns Estimated token count.
	 */
	estimateFromString(content: string): number {
		return estimateTokensFromString(content);
	},

	/**
	 * Formats a context budget as a human-readable summary string.
	 *
	 * @param budget - The calculated context budget.
	 * @returns A multi-line summary suitable for status output or NEXT_PROMPT.
	 */
	formatSummary(budget: ContextBudget): string {
		const status = budget.overBudget ? "OVER BUDGET" : "within budget";
		const prefix = budget.accurate ? "" : "~";
		const lines: string[] = [
			`Context budget: ${prefix}${String(budget.totalTokens)} / ${String(budget.budgetCap)} tokens (${status})`,
		];

		if (!budget.accurate) {
			lines.push("  (approximate — using heuristic token estimates)");
		}

		lines.push(`  SESSION_STATE  ${prefix}${String(budget.breakdown.sessionState)} tokens`);
		lines.push(`  Plan chunk     ${prefix}${String(budget.breakdown.planChunk)} tokens`);
		lines.push(`  Always-include ${prefix}${String(budget.breakdown.alwaysInclude)} tokens`);

		let filesTotal = 0;
		for (const cost of budget.breakdown.files.values()) {
			filesTotal += cost;
		}
		lines.push(
			`  Context files  ${prefix}${String(filesTotal)} tokens (${String(budget.breakdown.files.size)} files)`,
		);

		return lines.join("\n");
	},
} as const;
