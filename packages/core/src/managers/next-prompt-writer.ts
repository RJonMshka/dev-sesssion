/**
 * Generates and writes NEXT_PROMPT.md — a self-contained bootstrap for the next AI session.
 *
 * The prompt is capped at {@link MAX_PROMPT_LINES} lines and includes project name,
 * active chunk, files to load, resume context, and next steps.
 *
 * Supports two generation modes:
 * 1. Legacy `generate()` — backward-compatible simple generation
 * 2. `generateWithFormatter()` — uses a {@link BootstrapFormatter} for tool-specific output
 *
 * @packageDocumentation
 */

import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError } from "@dev-session/security";
import type { BootstrapContext, BootstrapFormatter } from "../formatters/bootstrap-formatter.js";
import {
	FILE_LOAD_PREFIXES,
	formatRefList,
	LEGACY_LOAD_PREFIX,
	trimToMaxLines as trimLines,
} from "../formatters/formatter-utils.js";
import type {
	FileIndexEntry,
	PlanChunk,
	SessionState,
	ValidationResult,
} from "../schemas/index.js";
import {
	countPromptChars,
	countPromptLines,
	MAX_PROMPT_CHARS,
	MAX_PROMPT_LINES,
} from "../schemas/index.js";

/** Maximum number of "Next" task lines to include. */
const MAX_NEXT_LINES = 4;

/** The filename for the next prompt file. */
const NEXT_PROMPT_FILENAME = "NEXT_PROMPT.md";

/**
 * Required field prefixes that must appear in a valid next prompt.
 *
 * File-load lines are validated separately against {@link FILE_LOAD_PREFIXES}.
 */
const REQUIRED_FIELDS: readonly string[] = ["Project:", "Active chunk:"];

/**
 * Extracts a project name from the session ID.
 *
 * Falls back to `"dev-sesssion"` if the session ID does not contain a recognizable name.
 *
 * @param sessionId - The session's unique identifier string.
 * @returns A human-readable project name.
 */
function extractProjectName(sessionId: string): string {
	return sessionId.length > 0 ? sessionId : "dev-sesssion";
}

/**
 * Formats the "Files to load" value from file index entries.
 *
 * @param files - The file index entries tagged to the active chunk.
 * @returns A comma-separated string of file paths, capped by {@link formatRefList}.
 */
function formatFilePaths(files: readonly FileIndexEntry[]): string {
	// The same renderer every formatter uses (REQ-PCX-6).
	return formatRefList(files.map((f) => f.filepath));
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
 * Delegates to the shared {@link trimLines} so the legacy generator and the
 * formatter path truncate identically, marker included.
 *
 * @param lines - The full set of prompt lines.
 * @returns Lines trimmed to {@link MAX_PROMPT_LINES}.
 */
function trimToMaxLines(lines: readonly string[]): readonly string[] {
	return trimLines(lines, MAX_PROMPT_LINES);
}

/**
 * Generates and writes NEXT_PROMPT.md for the next AI coding session.
 *
 * Exports:
 * - `generate()` — legacy simple generation (backward-compatible)
 * - `generateWithFormatter()` — formatter-aware generation with context budget support
 * - `write()` — writes content to NEXT_PROMPT.md via AtomicWriter
 * - `validate()` — validates prompt content structure
 */
export const NextPromptWriter = {
	/**
	 * Generates the content string for NEXT_PROMPT.md (legacy mode).
	 *
	 * Pure function — no side effects. The output is capped at {@link MAX_PROMPT_LINES} lines.
	 * For tool-specific output, use {@link generateWithFormatter} instead.
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
			`${LEGACY_LOAD_PREFIX} ${filePaths}`,
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
	 * Generates NEXT_PROMPT.md content using a {@link BootstrapFormatter}.
	 *
	 * This is the recommended generation method. It delegates formatting to
	 * the provided formatter, which can produce tool-specific output
	 * (e.g., Claude Code `@`-mentions, opencode format, etc.).
	 *
	 * @param formatter - The bootstrap formatter to use for rendering.
	 * @param context - The full bootstrap context data.
	 * @returns A string suitable for writing to NEXT_PROMPT.md.
	 */
	generateWithFormatter(formatter: BootstrapFormatter, context: BootstrapContext): string {
		return formatter.generatePrompt(context);
	},

	/**
	 * Writes the generated prompt content to NEXT_PROMPT.md inside the session directory.
	 *
	 * Content is validated before it is persisted, so a malformed prompt can
	 * never reach disk — including one produced by a third-party formatter
	 * registered through `registerAdapter()`, which is otherwise untrusted.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @param content - The prompt content string to write.
	 * @param maxLines - Line cap to enforce. Defaults to {@link MAX_PROMPT_LINES}.
	 * @throws {CliError} If the content is empty or fails {@link validate}.
	 */
	write(sessionDir: ValidatedPath, content: string, maxLines: number = MAX_PROMPT_LINES): void {
		if (content.trim().length === 0) {
			throw new CliError({
				message: "Cannot write empty NEXT_PROMPT.md",
				suggestion: "Generate content with NextPromptWriter.generate() first",
			});
		}

		const validation = this.validate(content, maxLines);
		if (!validation.valid) {
			// Name the cause the developer can act on (REQ-PROV-6): an over-long
			// note is fixed in SESSION_STATE.md, not in the formatter.
			const suggestion =
				validation.charCount > MAX_PROMPT_CHARS
					? `Shorten long notes or task text in SESSION_STATE.md — the prompt may hold at most ${String(MAX_PROMPT_CHARS)} characters.`
					: "The bootstrap formatter produced invalid output. If this is a custom adapter, " +
						"ensure generatePrompt() emits the required fields and stays within the line cap.";
			throw new CliError({
				message: `Refusing to write a malformed NEXT_PROMPT.md: ${validation.errors.join("; ")}`,
				suggestion,
			});
		}

		const filePath = path.join(sessionDir, NEXT_PROMPT_FILENAME) as ValidatedPath;
		AtomicWriter.writeFile(filePath, content);
	},

	/**
	 * Validates a NEXT_PROMPT.md content string.
	 *
	 * Checks that the content is non-empty, within the line limit and
	 * {@link MAX_PROMPT_CHARS}, and contains all required field prefixes.
	 * Accepts every prefix in {@link FILE_LOAD_PREFIXES}, which covers the
	 * legacy field name, the flat `Load:` line, and both layered lines.
	 *
	 * @param content - The prompt content string to validate.
	 * @param maxLines - Line cap to enforce. Defaults to {@link MAX_PROMPT_LINES}.
	 * @returns A {@link ValidationResult} with validity status, line count, and any errors.
	 */
	validate(content: string, maxLines: number = MAX_PROMPT_LINES): ValidationResult {
		const errors: string[] = [];
		const lines = content.split("\n").filter((line) => line.length > 0);
		const lineCount = countPromptLines(content);

		if (content.trim().length === 0) {
			errors.push("Content is empty");
		}

		if (lineCount > maxLines) {
			errors.push(`Line count ${String(lineCount)} exceeds maximum of ${String(maxLines)}`);
		}

		// The line cap does not bound size: one long note is one line (REQ-PROV-5).
		const charCount = countPromptChars(content);
		if (charCount > MAX_PROMPT_CHARS) {
			errors.push(
				`Character count ${String(charCount)} exceeds maximum of ${String(MAX_PROMPT_CHARS)} characters`,
			);
		}

		for (const field of REQUIRED_FIELDS) {
			const found = lines.some((line) => line.startsWith(field));
			if (!found) {
				errors.push(`Missing required field: "${field}"`);
			}
		}

		// Check for at least one file load field (supports both old and new format)
		const hasFileLoadField = lines.some((line) =>
			FILE_LOAD_PREFIXES.some((field) => line.startsWith(field)),
		);
		if (!hasFileLoadField) {
			errors.push(
				`Missing file load field: expected one of ${FILE_LOAD_PREFIXES.map((f) => `"${f}"`).join(" or ")}`,
			);
		}

		return {
			valid: errors.length === 0,
			lineCount,
			charCount,
			errors,
		};
	},
} as const;
