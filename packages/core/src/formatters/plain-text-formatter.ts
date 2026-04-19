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

import { AiIndexManager } from "../annotation/ai-index-manager.js";
import type { AiIndex } from "../annotation/types.js";
import type { FileIndexEntry } from "../schemas/index.js";
import type { BootstrapContext, BootstrapFormatter } from "./bootstrap-formatter.js";
import {
	DEFAULT_MAX_NEXT_TASKS,
	DEFAULT_MAX_NOTES,
	DEFAULT_MAX_PROMPT_LINES,
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	getPendingTasks,
	trimToMaxLines,
} from "./formatter-utils.js";

/** Maximum files to show in the "Load" section before truncating. */
const MAX_FILES_TO_SHOW = 6;

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
			const shown = pending.slice(0, DEFAULT_MAX_NEXT_TASKS);
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
			const notesToShow = state.notes.slice(0, DEFAULT_MAX_NOTES);
			for (const note of notesToShow) {
				lines.push(`Note: ${note}`);
			}
		}

		// Trim to max lines
		const trimmed = trimToMaxLines(lines, DEFAULT_MAX_PROMPT_LINES);
		return `${trimmed.join("\n")}\n`;
	},

	/**
	 * Formats ai-index content at the specified layer as plain text.
	 *
	 * @param index - The ai-index.
	 * @param layer - Context layer (0, 1, or 2).
	 * @returns Formatted plain-text block.
	 */
	formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string {
		const entries = Object.entries(index.files).sort(([a], [b]) => a.localeCompare(b));
		if (entries.length === 0) return "";

		if (layer === 2) {
			// Layer 2: just list the files (full source not inlined in prompts)
			return `Files (full source):\n${entries.map(([p]) => `  ${p}`).join("\n")}`;
		}

		const blocks = entries.map(([relPath, entry]) =>
			layer === 0
				? AiIndexManager.renderLayer0(relPath, entry)
				: AiIndexManager.renderLayer1(relPath, entry),
		);
		return blocks.join("\n\n");
	},
} as const;
