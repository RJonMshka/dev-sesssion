/**
 * Claude Code bootstrap formatter.
 *
 * Produces NEXT_PROMPT.md content optimized for Claude Code's context model:
 * - File references use `@path/to/file` mention syntax
 * - Excludes are phrased as "Do NOT read" (Claude Code terminology)
 * - References CLAUDE.md as the session instructions file
 *
 * Shares structural sections with {@link PlainTextFormatter} via
 * shared formatter utilities from `@dev-session/core`.
 *
 * @packageDocumentation
 */

import type { BootstrapContext, BootstrapFormatter, FileIndexEntry } from "@dev-session/core";
import {
	DEFAULT_MAX_NEXT_TASKS,
	DEFAULT_MAX_NOTES,
	DEFAULT_MAX_PROMPT_LINES,
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	getPendingTasks,
	trimToMaxLines,
} from "@dev-session/core";

/** Maximum files to show before truncating. */
const MAX_FILES_TO_SHOW = 6;

/**
 * Claude Code bootstrap formatter.
 *
 * Uses `@` file mention syntax that Claude Code understands natively.
 * When Claude Code processes `@path/to/file`, it automatically loads
 * that file into context.
 */
export const ClaudeBootstrapFormatter: BootstrapFormatter = {
	name: "claude",

	/**
	 * Formats file paths with Claude Code's `@`-mention syntax.
	 *
	 * @param files - The file index entries to format.
	 * @returns Formatted string with `@`-prefixed file references.
	 */
	formatFilesToLoad(files: readonly FileIndexEntry[]): string {
		if (files.length === 0) {
			return "(none)";
		}

		const shown = files.slice(0, MAX_FILES_TO_SHOW).map((f) => `@${f.filepath}`);
		const remaining = files.length - shown.length;
		const suffix = remaining > 0 ? `, +${String(remaining)} more` : "";
		return shown.join(", ") + suffix;
	},

	/**
	 * Formats exclude patterns as a "Do NOT read" instruction.
	 *
	 * Uses "read" rather than "load" to match Claude Code's terminology.
	 *
	 * @param patterns - The glob patterns or paths to exclude.
	 * @returns Formatted exclude instruction string.
	 */
	formatExcludes(patterns: readonly string[]): string {
		if (patterns.length === 0) {
			return "";
		}
		return `Do NOT read: ${patterns.join(", ")}`;
	},

	/**
	 * Generates the full Claude Code-optimized bootstrap prompt.
	 *
	 * @param context - The full bootstrap context data.
	 * @returns The NEXT_PROMPT.md content string with `@`-mentions.
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
			const lastFiles = state.last_worked_files.slice(0, 3).map((f) => `@${f}`);
			lines.push(`Last touched: ${lastFiles.join(", ")}`);
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
} as const;
