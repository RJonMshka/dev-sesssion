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

import type {
	AiIndex,
	BootstrapContext,
	BootstrapFormatter,
	FileIndexEntry,
} from "@dev-session/core";
import {
	AiIndexManager,
	DEFAULT_MAX_NEXT_TASKS,
	DEFAULT_MAX_NOTES,
	DEFAULT_MAX_PROMPT_LINES,
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	formatLayeredContextLines,
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
		const resolvedLayers = context.resolvedLayers;
		if (resolvedLayers !== undefined && resolvedLayers.length > 0) {
			for (const line of formatLayeredContextLines(
				resolvedLayers,
				(f) => `@${f}`,
				MAX_FILES_TO_SHOW,
			)) {
				lines.push(line);
			}
		} else {
			const allFiles = [...alwaysIncludeFiles, ...chunkFiles];
			lines.push(`Load: ${this.formatFilesToLoad(allFiles)}`);
		}

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
		const trimmed = trimToMaxLines(lines, context.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES);
		return `${trimmed.join("\n")}\n`;
	},

	/**
	 * Formats ai-index content for Claude Code bootstrap prompts.
	 *
	 * Layer 0 renders a prose instruction block followed by symbol-level
	 * summaries — replacing the manual file list in NEXT_PROMPT.md when
	 * an index exists.
	 *
	 * @param index - The ai-index.
	 * @param layer - Context layer (0, 1, or 2).
	 * @returns Formatted string for the Claude Code prompt.
	 */
	formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string {
		const entries = Object.entries(index.files).sort(([a], [b]) => a.localeCompare(b));
		if (entries.length === 0) return "";

		if (layer === 2) {
			// Layer 2: reference files by @-mention (Claude Code loads them)
			const mentions = entries.map(([p]) => `@${p}`).join(", ");
			return `Full source: ${mentions}`;
		}

		// Layer 0 and 1: render a prose header + symbol blocks
		const header =
			layer === 0
				? "## AI Index (Layer 0 — symbol names)\nDo NOT read these files unless instructed; use the index below:\n"
				: "## AI Index (Layer 1 — signatures)\nDo NOT read these files unless instructed; use the index below:\n";

		const blocks = entries.map(([relPath, entry]) =>
			layer === 0
				? AiIndexManager.renderLayer0(relPath, entry)
				: AiIndexManager.renderLayer1(relPath, entry),
		);

		return `${header}\n${blocks.join("\n\n")}`;
	},
} as const;
