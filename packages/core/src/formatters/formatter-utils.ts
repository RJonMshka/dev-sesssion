/**
 * Shared utility functions for bootstrap formatters.
 *
 * Pure functions used across all formatter implementations (plain, Claude,
 * opencode, Cursor) to build common prompt sections: completed-chunk
 * summaries, chunk progress, budget status, and pending task lists.
 *
 * @packageDocumentation
 */

import type { ResolvedFileLayer } from "../calculators/layer-resolver.js";
import type { ContextBudget } from "../schemas/context-budget.js";
import type { PlanChunk, SessionState, Task } from "../schemas/index.js";

/** Maximum pending tasks to show in the "Next" section by default. */
export const DEFAULT_MAX_NEXT_TASKS = 4;

/** Maximum notes to include by default. */
export const DEFAULT_MAX_NOTES = 2;

/** Maximum lines in a generated prompt by default. */
export const DEFAULT_MAX_PROMPT_LINES = 20;

/**
 * Summarizes completed chunks as a compact one-liner.
 *
 * @param state - The session state with completed_chunks record.
 * @returns A compact summary string like "Chunks 1-3 done", or empty string if none.
 */
export function formatCompletedChunksSummary(state: SessionState): string {
	const keys = Object.keys(state.completed_chunks)
		.map((k) => Number.parseInt(k, 10))
		.filter((n) => !Number.isNaN(n))
		.sort((a, b) => a - b);

	if (keys.length === 0) {
		return "";
	}

	if (keys.length === 1) {
		return `Chunk ${String(keys[0])} done.`;
	}

	// Check if consecutive
	const first = keys[0] as number;
	const last = keys[keys.length - 1] as number;
	const isConsecutive = last - first === keys.length - 1;

	if (isConsecutive) {
		return `Chunks ${String(first)}-${String(last)} done.`;
	}

	return `Chunks ${keys.map(String).join(", ")} done.`;
}

/**
 * Builds the progress line for the active chunk.
 *
 * @param chunk - The active plan chunk.
 * @returns A string like "3/8 tasks done, 1 in-progress".
 */
export function formatChunkProgress(chunk: PlanChunk): string {
	const total = chunk.tasks.length;
	const done = chunk.tasks.filter((t) => t.status === "done").length;
	const inProgress = chunk.tasks.filter((t) => t.status === "in-progress").length;

	const parts: string[] = [`${String(done)}/${String(total)} tasks done`];

	if (inProgress > 0) {
		parts.push(`${String(inProgress)} in-progress`);
	}

	return parts.join(", ");
}

/**
 * Formats the budget status line.
 *
 * @param budget - The calculated context budget.
 * @returns A compact budget status string like "Budget: ~750/4000 tokens [OK]".
 */
export function formatBudgetLine(budget: ContextBudget): string {
	const status = budget.overBudget ? "OVER" : "OK";
	return `Budget: ~${String(budget.totalTokens)}/${String(budget.budgetCap)} tokens [${status}]`;
}

/**
 * Gets pending tasks from a chunk (todo + in-progress).
 *
 * @param chunk - The plan chunk.
 * @returns Array of pending task objects.
 */
export function getPendingTasks(chunk: PlanChunk): readonly Task[] {
	return chunk.tasks.filter((t) => t.status === "todo" || t.status === "in-progress");
}

/**
 * Trims a lines array to the maximum allowed line count.
 *
 * @param lines - The full set of prompt lines.
 * @param maxLines - Maximum number of lines to keep.
 * @returns Lines trimmed to the specified cap.
 */
export function trimToMaxLines(lines: readonly string[], maxLines: number): readonly string[] {
	if (lines.length <= maxLines) {
		return lines;
	}
	return lines.slice(0, maxLines);
}

/**
 * Caps a list of rendered file references and appends a "+N more" suffix.
 *
 * @param refs - The already-formatted file references.
 * @param maxFiles - Maximum references to show before truncating.
 * @returns A comma-separated string, or `"(none)"` when empty.
 */
function capRefList(refs: readonly string[], maxFiles: number): string {
	if (refs.length === 0) {
		return "(none)";
	}
	const shown = refs.slice(0, maxFiles);
	const remaining = refs.length - shown.length;
	const suffix = remaining > 0 ? `, +${String(remaining)} more` : "";
	return shown.join(", ") + suffix;
}

/**
 * Builds the layered "Load" section lines from resolved per-file layers.
 *
 * Files escalated to layer 2 (full source, referenced by an active task) are
 * listed on a `Load full:` line; the remaining summary-only files (layers 0–1)
 * are listed on a `Summaries:` line annotated with their layer. The `ref`
 * callback applies the formatter's native file-reference syntax (e.g. an
 * `@`-mention for Claude Code).
 *
 * @param resolved - Per-file resolved layers from `LayerResolver.resolve`.
 * @param ref - Renders a single filepath in the formatter's reference syntax.
 * @param maxFiles - Maximum files to list per line before truncating.
 * @returns One or two prompt lines describing what to load and at which layer.
 */
export function formatLayeredContextLines(
	resolved: readonly ResolvedFileLayer[],
	ref: (filepath: string) => string,
	maxFiles: number,
): readonly string[] {
	const full: string[] = [];
	const summary: string[] = [];
	for (const r of resolved) {
		if (r.layer === 2) {
			full.push(ref(r.filepath));
		} else {
			summary.push(`${ref(r.filepath)}·L${String(r.layer)}`);
		}
	}

	const lines: string[] = [];
	if (full.length > 0) {
		lines.push(`Load full: ${capRefList(full, maxFiles)}`);
	}
	if (summary.length > 0) {
		lines.push(`Summaries (read_file_layer for detail): ${capRefList(summary, maxFiles)}`);
	}
	if (lines.length === 0) {
		lines.push("Load: (none)");
	}
	return lines;
}
