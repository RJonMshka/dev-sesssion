/**
 * Calculates the estimated token budget for a session's context window.
 *
 * Aggregates token costs from:
 * 1. SESSION_STATE.md (counted from its serialized text)
 * 2. The active plan chunk (counted from its serialized text)
 * 3. Chunk-tagged files (from {@link FileIndexEntry.token_cost} or live estimation)
 * 4. Always-include files (from {@link FileIndexEntry.token_cost} or live estimation)
 *
 * Uses the heuristic of ~4 bytes per token for English text / code.
 *
 * @packageDocumentation
 */

import { SessionStateManager } from "../managers/session-state-manager.js";
import { PlanParser } from "../parsers/plan-parser.js";
import type { ContextBudget, ContextBudgetBreakdown } from "../schemas/context-budget.js";
import { DEFAULT_CONTEXT_BUDGET } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";
import type { ResolvedFileLayer } from "./layer-resolver.js";
import type { FocusedUnit } from "./unit-focus.js";

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
 * Counts SESSION_STATE.md from the text the tool writes for it (REQ-BUD-1).
 *
 * @param state - The current session state.
 * @returns Estimated token count.
 */
function estimateSessionStateTokens(state: SessionState): number {
	return estimateTokensFromString(SessionStateManager.toMarkdown(state));
}

/**
 * Counts the active plan chunk from the text the tool writes for it (REQ-BUD-1).
 *
 * A fixed per-task allowance used to stand in for the serialized YAML, and came
 * in ~40% under the bytes on disk — enough to print [OK] for an over-budget
 * session.
 *
 * @param chunk - The active plan chunk.
 * @returns Estimated token count.
 */
function estimatePlanChunkTokens(chunk: PlanChunk): number {
	return estimateTokensFromString(PlanParser.toMarkdown(chunk));
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
 * Judges a budget against its cap. Always-include files are charged in the
 * total but not against the cap: they load in every chunk, so they cannot make
 * a chunk too heavy, and no trim or split can earn them back (REQ-BUD-6).
 *
 * @param totalTokens - Everything the session loads.
 * @param breakdown - The per-category costs summing to `totalTokens`.
 * @param cap - The budget cap.
 * @returns The budget, with `cappedTokens` and `overBudget` set.
 */
function judge(totalTokens: number, breakdown: ContextBudgetBreakdown, cap: number): ContextBudget {
	const cappedTokens = totalTokens - breakdown.alwaysInclude;
	return {
		totalTokens,
		cappedTokens,
		breakdown,
		overBudget: cappedTokens > cap,
		budgetCap: cap,
		accurate: false,
	};
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

		return judge(totalTokens, breakdown, cap);
	},

	/**
	 * Estimates the total token budget using *layered* file costs.
	 *
	 * Unlike {@link estimate}, which charges the whole-file cost for every file,
	 * this charges each file at its resolved layer (see {@link ResolvedFileLayer}).
	 * Chunk-tagged files contribute to the per-file breakdown; always-include
	 * files are summed into `breakdown.alwaysInclude`. SESSION_STATE and the plan
	 * chunk are estimated exactly as in {@link estimate}.
	 *
	 * @param state - The current session state.
	 * @param chunk - The active plan chunk.
	 * @param resolved - Per-file resolved layers from `LayerResolver.resolve`.
	 * @param budgetCap - The maximum token budget (defaults to {@link DEFAULT_CONTEXT_BUDGET}).
	 * @param focus - Focused code units, each charged at its own cost under its
	 *   `path#id` key in the per-file breakdown (REQ-UNIT-17).
	 * @returns A {@link ContextBudget} computed from layered file costs.
	 */
	estimateLayered(
		state: SessionState,
		chunk: PlanChunk,
		resolved: readonly ResolvedFileLayer[],
		budgetCap?: number,
		focus: readonly FocusedUnit[] = [],
	): ContextBudget {
		const cap = budgetCap ?? DEFAULT_CONTEXT_BUDGET;

		const sessionStateTokens = estimateSessionStateTokens(state);
		const planChunkTokens = estimatePlanChunkTokens(chunk);

		const fileBreakdown = new Map<string, number>();
		let filesTotal = 0;
		let alwaysIncludeTotal = 0;

		for (const file of resolved) {
			if (file.role === "always-include") {
				alwaysIncludeTotal += file.layeredTokenCost;
			} else {
				fileBreakdown.set(file.filepath, file.layeredTokenCost);
				filesTotal += file.layeredTokenCost;
			}
		}
		for (const unit of focus) {
			fileBreakdown.set(unit.ref, unit.tokens);
			filesTotal += unit.tokens;
		}

		const totalTokens = sessionStateTokens + planChunkTokens + filesTotal + alwaysIncludeTotal;

		const breakdown: ContextBudgetBreakdown = {
			sessionState: sessionStateTokens,
			planChunk: planChunkTokens,
			files: fileBreakdown,
			alwaysInclude: alwaysIncludeTotal,
		};

		return judge(totalTokens, breakdown, cap);
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
			`Context budget: ${prefix}${String(budget.cappedTokens)} / ${String(budget.budgetCap)} tokens (${status})`,
		];

		if (!budget.accurate) {
			lines.push("  (approximate — using heuristic token estimates)");
		}

		lines.push(`  SESSION_STATE  ${prefix}${String(budget.breakdown.sessionState)} tokens`);
		lines.push(`  Plan chunk     ${prefix}${String(budget.breakdown.planChunk)} tokens`);
		lines.push(
			`  Always-include ${prefix}${String(budget.breakdown.alwaysInclude)} tokens (loaded every chunk, not capped)`,
		);

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
