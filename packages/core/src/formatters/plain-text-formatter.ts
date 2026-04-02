/**
 * Default bootstrap formatter that produces plain-text NEXT_PROMPT.md content.
 *
 * Uses structured sections with per-section line budgets to maximize
 * information density within the prompt's line cap.
 *
 * Section budget (20 lines total):
 * - Header:   3 lines (project, chunk, budget)
 * - Context:  4 lines (files to load, excludes)
 * - Resume:   5 lines (progress, completed chunks, last touched)
 * - Next:     5 lines (pending tasks)
 * - Notes:    3 lines (first relevant notes)
 *
 * @packageDocumentation
 */

import type { ContextBudget } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState, Task } from "../schemas/index.js";
import type { BootstrapContext, BootstrapFormatter } from "./bootstrap-formatter.js";

/** Maximum files to show in the "Load" section before truncating. */
const MAX_FILES_TO_SHOW = 6;

/** Maximum pending tasks to show in the "Next" section. */
const MAX_NEXT_TASKS = 4;

/** Maximum notes to include. */
const MAX_NOTES = 2;

/** Maximum lines in the generated prompt. */
const MAX_PROMPT_LINES = 20;

/**
 * Summarizes completed chunks as a compact one-liner.
 *
 * @param state - The session state with completed_chunks record.
 * @returns A compact summary string like "Chunks 1-3 done".
 */
function formatCompletedChunksSummary(state: SessionState): string {
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
function formatChunkProgress(chunk: PlanChunk): string {
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
 * @returns A compact budget status string.
 */
function formatBudgetLine(budget: ContextBudget): string {
	const status = budget.overBudget ? "OVER" : "OK";
	return `Budget: ~${String(budget.totalTokens)}/${String(budget.budgetCap)} tokens [${status}]`;
}

/**
 * Gets pending tasks from a chunk.
 *
 * @param chunk - The plan chunk.
 * @returns Array of pending task objects.
 */
function getPendingTasks(chunk: PlanChunk): readonly Task[] {
	return chunk.tasks.filter((t) => t.status === "todo" || t.status === "in-progress");
}

/**
 * Default bootstrap formatter using plain text.
 *
 * Suitable for any tool that reads NEXT_PROMPT.md as plain text.
 * Produces structured, information-dense output within a 20-line cap.
 */
export const PlainTextFormatter: BootstrapFormatter = {
	name: "plain",

	/**
	 * Formats file paths as a comma-separated list.
	 *
	 * @param files - The file index entries to format.
	 * @returns Formatted string of file paths.
	 */
	formatFilesToLoad(files: readonly FileIndexEntry[]): string {
		if (files.length === 0) {
			return "(none)";
		}

		const shown = files.slice(0, MAX_FILES_TO_SHOW).map((f) => f.filepath);
		const remaining = files.length - shown.length;
		const suffix = remaining > 0 ? `, +${String(remaining)} more` : "";
		return shown.join(", ") + suffix;
	},

	/**
	 * Formats exclude patterns as a "Do NOT load" instruction.
	 *
	 * @param patterns - The glob patterns or paths to exclude.
	 * @returns Formatted exclude instruction string.
	 */
	formatExcludes(patterns: readonly string[]): string {
		if (patterns.length === 0) {
			return "";
		}
		return `Do NOT load: ${patterns.join(", ")}`;
	},

	/**
	 * Generates the full bootstrap prompt with structured sections.
	 *
	 * @param context - The full bootstrap context data.
	 * @returns The NEXT_PROMPT.md content string.
	 */
	generatePrompt(context: BootstrapContext): string {
		const { state, chunk, chunkFiles, alwaysIncludeFiles, budget, excludePatterns, projectName } =
			context;

		const lines: string[] = [];

		// -- Header section (3 lines) --
		lines.push(`Project: ${projectName}`);
		lines.push(`Active chunk: ${String(chunk.chunk_id)} — ${chunk.title}`);
		lines.push(formatBudgetLine(budget));

		// -- Context section (up to 4 lines) --
		const allFiles = [...alwaysIncludeFiles, ...chunkFiles];
		lines.push(`Load: ${this.formatFilesToLoad(allFiles)}`);

		const excludeStr = this.formatExcludes(excludePatterns);
		if (excludeStr.length > 0) {
			lines.push(excludeStr);
		}

		// -- Resume section (up to 5 lines) --
		const completedSummary = formatCompletedChunksSummary(state);
		const progress = formatChunkProgress(chunk);
		const resumeParts: string[] = [progress];
		if (completedSummary.length > 0) {
			resumeParts.push(completedSummary);
		}
		lines.push(`Resume: ${resumeParts.join(" ")}`);

		if (state.last_worked_files.length > 0) {
			const lastFiles = state.last_worked_files.slice(0, 3).join(", ");
			lines.push(`Last touched: ${lastFiles}`);
		}

		// -- Next tasks section (up to 5 lines) --
		const pending = getPendingTasks(chunk);
		if (pending.length > 0) {
			lines.push("Next:");
			const shown = pending.slice(0, MAX_NEXT_TASKS);
			for (const task of shown) {
				const prefix = task.status === "in-progress" ? "[WIP]" : "[ ]";
				lines.push(`  ${prefix} ${task.text}`);
			}
			const remaining = pending.length - shown.length;
			if (remaining > 0) {
				lines.push(`  (+${String(remaining)} more tasks)`);
			}
		}

		// -- Notes section (up to 3 lines) --
		if (state.notes.length > 0) {
			const notesToShow = state.notes.slice(0, MAX_NOTES);
			for (const note of notesToShow) {
				lines.push(`Note: ${note}`);
			}
		}

		// Trim to max lines
		const trimmed = lines.length > MAX_PROMPT_LINES ? lines.slice(0, MAX_PROMPT_LINES) : lines;
		return `${trimmed.join("\n")}\n`;
	},
} as const;
