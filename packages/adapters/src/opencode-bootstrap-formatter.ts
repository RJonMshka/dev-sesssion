/**
 * opencode bootstrap formatter.
 *
 * Produces NEXT_PROMPT.md content optimized for opencode's context model:
 * - File references use plain paths (opencode loads via AGENTS.md context)
 * - Excludes are phrased as "Exclude" (opencode convention)
 * - References AGENTS.md as the session instructions file
 * - Includes a "Config: AGENTS.md" line so the tool knows where rules live
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
 * opencode bootstrap formatter.
 *
 * Produces structured prompts that align with opencode's AGENTS.md
 * context loading conventions. File references are plain paths since
 * opencode reads AGENTS.md for context directives.
 */
export const OpencodeBootstrapFormatter: BootstrapFormatter = {
	name: "opencode",

	/**
	 * Formats file paths as plain comma-separated paths.
	 *
	 * opencode uses AGENTS.md for context loading — file references
	 * are plain paths that the tool resolves from the workspace root.
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
	 * Formats exclude patterns using "Exclude" directive.
	 *
	 * Uses "Exclude" phrasing to align with opencode's AGENTS.md conventions.
	 *
	 * @param patterns - The glob patterns or paths to exclude.
	 * @returns Formatted exclude instruction string.
	 */
	formatExcludes(patterns: readonly string[]): string {
		if (patterns.length === 0) {
			return "";
		}
		return `Exclude: ${patterns.join(", ")}`;
	},

	/**
	 * Generates the full opencode-optimized bootstrap prompt.
	 *
	 * Includes a "Config: AGENTS.md" line so the tool can locate
	 * session rules and instructions.
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
		const resolvedLayers = context.resolvedLayers;
		if (resolvedLayers !== undefined && resolvedLayers.length > 0) {
			for (const line of formatLayeredContextLines(resolvedLayers, (f) => f, MAX_FILES_TO_SHOW)) {
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
		const trimmed = trimToMaxLines(lines, context.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES);
		return `${trimmed.join("\n")}\n`;
	},

	/**
	 * Formats ai-index content for opencode bootstrap prompts.
	 *
	 * @param index - The ai-index.
	 * @param layer - Context layer (0, 1, or 2).
	 * @returns Formatted string for the opencode prompt.
	 */
	formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string {
		const entries = Object.entries(index.files).sort(([a], [b]) => a.localeCompare(b));
		if (entries.length === 0) return "";
		if (layer === 2) {
			return `Exclude: ${entries.map(([p]) => p).join(", ")}`;
		}
		const blocks = entries.map(([relPath, entry]) =>
			layer === 0
				? AiIndexManager.renderLayer0(relPath, entry)
				: AiIndexManager.renderLayer1(relPath, entry),
		);
		return blocks.join("\n\n");
	},
} as const;
