/**
 * Generates and writes NEXT_PROMPT.md — a self-contained bootstrap for the next AI session.
 *
 * The prompt is capped at {@link MAX_PROMPT_LINES} lines and includes project name,
 * active chunk, files to load, resume context, and next steps.
 *
 * @packageDocumentation
 */

import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError } from "@dev-session/security";
import type {
	FileIndexEntry,
	PlanChunk,
	SessionState,
	ValidationResult,
} from "../schemas/index.js";
import { MAX_PROMPT_LINES } from "../schemas/index.js";

/** Maximum number of file paths to include in the "Files to load" line. */
const MAX_FILES_TO_SHOW = 5;

/** Maximum number of "Next" task lines to include. */
const MAX_NEXT_LINES = 3;

/** The filename for the next prompt file. */
const NEXT_PROMPT_FILENAME = "NEXT_PROMPT.md";

/** Required field prefixes that must appear in a valid next prompt. */
const REQUIRED_FIELDS: readonly string[] = ["Project:", "Active chunk:", "Files to load:"];

/**
 * Extracts a project name from the session ID.
 *
 * Falls back to `"dev-session"` if the session ID does not contain a recognizable name.
 *
 * @param sessionId - The session's unique identifier string.
 * @returns A human-readable project name.
 */
function extractProjectName(sessionId: string): string {
	return sessionId.length > 0 ? sessionId : "dev-session";
}

/**
 * Formats the "Files to load" value from file index entries.
 *
 * @param files - The file index entries tagged to the active chunk.
 * @returns A comma-separated string of file paths, capped at {@link MAX_FILES_TO_SHOW}.
 */
function formatFilePaths(files: readonly FileIndexEntry[]): string {
	if (files.length === 0) {
		return "(none)";
	}

	const shown = files.slice(0, MAX_FILES_TO_SHOW).map((f) => f.filepath);
	const remaining = files.length - shown.length;
	const suffix = remaining > 0 ? `, +${String(remaining)} more` : "";

	return shown.join(", ") + suffix;
}

/**
 * Builds the "Resume" line summarizing completed vs remaining tasks.
 *
 * @param state - The current session state.
 * @param chunk - The active plan chunk.
 * @returns A one-line summary of progress.
 */
function buildResumeLine(state: SessionState, chunk: PlanChunk): string {
	const allTasks = chunk.tasks;
	const doneTasks = allTasks.filter((t) => t.status === "done");
	const inProgress = allTasks.filter((t) => t.status === "in-progress");

	const parts: string[] = [];
	parts.push(`${String(doneTasks.length)}/${String(allTasks.length)} tasks done`);

	if (inProgress.length > 0) {
		const ipNames = inProgress.map((t) => t.text).join(", ");
		parts.push(`in-progress: ${ipNames}`);
	}

	if (state.last_worked_files.length > 0) {
		parts.push(`last touched: ${state.last_worked_files.slice(0, 3).join(", ")}`);
	}

	return parts.join("; ");
}

/**
 * Builds the "Next" lines listing remaining todo tasks.
 *
 * @param chunk - The active plan chunk.
 * @returns An array of strings, each describing one pending task (max {@link MAX_NEXT_LINES}).
 */
function buildNextLines(chunk: PlanChunk): readonly string[] {
	const todoTasks = chunk.tasks.filter((t) => t.status === "todo");
	return todoTasks.slice(0, MAX_NEXT_LINES).map((t) => `- ${t.text}`);
}

/**
 * Trims a prompt to the maximum allowed line count.
 *
 * @param lines - The full set of prompt lines.
 * @returns Lines trimmed to {@link MAX_PROMPT_LINES}.
 */
function trimToMaxLines(lines: readonly string[]): readonly string[] {
	if (lines.length <= MAX_PROMPT_LINES) {
		return lines;
	}
	return lines.slice(0, MAX_PROMPT_LINES);
}

/**
 * Generates and writes NEXT_PROMPT.md for the next AI coding session.
 *
 * Exports a pure `generate` function, an `AtomicWriter`-based `write` function,
 * and a `validate` function for checking prompt correctness.
 */
export const NextPromptWriter = {
	/**
	 * Generates the content string for NEXT_PROMPT.md.
	 *
	 * Pure function — no side effects. The output is capped at {@link MAX_PROMPT_LINES} lines.
	 *
	 * @param state - The current session state (active chunk, tasks, notes).
	 * @param chunk - The active plan chunk with its tasks and title.
	 * @param files - File index entries tagged to the active chunk.
	 * @returns A string suitable for writing to NEXT_PROMPT.md.
	 */
	generate(state: SessionState, chunk: PlanChunk, files: readonly FileIndexEntry[]): string {
		const projectName = extractProjectName(state.session_id);
		const chunkLabel = `${String(chunk.chunk_id)} — ${chunk.title}`;
		const filePaths = formatFilePaths(files);
		const resumeText = buildResumeLine(state, chunk);
		const nextLines = buildNextLines(chunk);

		const lines: string[] = [
			`Project: ${projectName}`,
			`Active chunk: ${chunkLabel}`,
			`Files to load: ${filePaths}`,
			`Resume: ${resumeText}`,
		];

		if (nextLines.length > 0) {
			lines.push("Next:");
			for (const line of nextLines) {
				lines.push(line);
			}
		}

		if (state.notes.length > 0) {
			const firstNote = state.notes[0];
			if (firstNote !== undefined) {
				lines.push(`Note: ${firstNote}`);
			}
		}

		const trimmed = trimToMaxLines(lines);
		return `${trimmed.join("\n")}\n`;
	},

	/**
	 * Writes the generated prompt content to NEXT_PROMPT.md inside the session directory.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @param content - The prompt content string to write.
	 * @throws {CliError} If the content is empty.
	 */
	write(sessionDir: ValidatedPath, content: string): void {
		if (content.trim().length === 0) {
			throw new CliError({
				message: "Cannot write empty NEXT_PROMPT.md",
				suggestion: "Generate content with NextPromptWriter.generate() first",
			});
		}

		const filePath = path.join(sessionDir, NEXT_PROMPT_FILENAME) as ValidatedPath;
		AtomicWriter.writeFile(filePath, content);
	},

	/**
	 * Validates a NEXT_PROMPT.md content string.
	 *
	 * Checks that the content is non-empty, within the line limit, and contains
	 * all required field prefixes.
	 *
	 * @param content - The prompt content string to validate.
	 * @returns A {@link ValidationResult} with validity status, line count, and any errors.
	 */
	validate(content: string): ValidationResult {
		const errors: string[] = [];
		const lines = content.split("\n").filter((line) => line.length > 0);
		const lineCount = lines.length;

		if (content.trim().length === 0) {
			errors.push("Content is empty");
		}

		if (lineCount > MAX_PROMPT_LINES) {
			errors.push(`Line count ${String(lineCount)} exceeds maximum of ${String(MAX_PROMPT_LINES)}`);
		}

		for (const field of REQUIRED_FIELDS) {
			const found = lines.some((line) => line.startsWith(field));
			if (!found) {
				errors.push(`Missing required field: "${field}"`);
			}
		}

		return {
			valid: errors.length === 0,
			lineCount,
			errors,
		};
	},
} as const;
