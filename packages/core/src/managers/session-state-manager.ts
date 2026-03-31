/**
 * Manages reading, writing, and updating SESSION_STATE.md.
 *
 * All I/O goes through {@link FrontmatterParser} (read) and {@link AtomicWriter} (write)
 * from `@dev-session/security`. Pure state-transition helpers are side-effect-free.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, FrontmatterParser, ParseError } from "@dev-session/security";

import type { SessionState, Task } from "../schemas/index.js";
import { SessionStateSchema, TaskStatus } from "../schemas/index.js";

/** The filename of the session state file within the `.session/` directory. */
const SESSION_STATE_FILENAME = "SESSION_STATE.md";

/**
 * Manages the lifecycle of SESSION_STATE.md: loading from disk,
 * saving to disk, and pure in-memory state transitions.
 */
export const SessionStateManager = {
	/**
	 * Loads and validates SESSION_STATE.md from the given session directory.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @returns The parsed and validated session state.
	 * @throws {ParseError} If the file cannot be read or its frontmatter is malformed.
	 */
	load(sessionDir: ValidatedPath): SessionState {
		const filePath = resolveStateFilePath(sessionDir);
		const raw = readFileContent(filePath);
		return parseFrontmatter(raw);
	},

	/**
	 * Serializes session state to YAML frontmatter and writes it atomically.
	 *
	 * Automatically updates `last_updated` to the current ISO date before writing.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @param state - The session state to persist.
	 * @returns void
	 * @throws {SecurityError} If the write guard detects secrets in the content.
	 */
	save(sessionDir: ValidatedPath, state: SessionState): void {
		const filePath = resolveStateFilePath(sessionDir);
		const updated: SessionState = {
			...state,
			last_updated: new Date().toISOString().slice(0, 10),
		};
		const content = serializeToMarkdown(updated);
		AtomicWriter.writeFile(filePath, content);
	},

	/**
	 * Marks a task as done by matching on its text.
	 *
	 * Pure function — performs no I/O. If no task matches, returns state unchanged.
	 *
	 * @param state - The current session state.
	 * @param taskText - The text of the task to mark done.
	 * @returns A new session state with the matching task marked done.
	 */
	markTaskDone(state: SessionState, taskText: string): SessionState {
		return updateTaskByText(state, taskText, (task) => ({
			...task,
			status: TaskStatus.DONE,
			completed_at: new Date().toISOString(),
		}));
	},

	/**
	 * Marks a task as in-progress by matching on its text.
	 *
	 * Pure function — performs no I/O. If no task matches, returns state unchanged.
	 *
	 * @param state - The current session state.
	 * @param taskText - The text of the task to mark in-progress.
	 * @returns A new session state with the matching task marked in-progress.
	 */
	markTaskInProgress(state: SessionState, taskText: string): SessionState {
		return updateTaskByText(state, taskText, (task) => ({
			...task,
			status: TaskStatus.IN_PROGRESS,
		}));
	},

	/**
	 * Appends a note to the session state.
	 *
	 * Pure function — performs no I/O.
	 *
	 * @param state - The current session state.
	 * @param note - The note string to append.
	 * @returns A new session state with the note appended.
	 */
	addNote(state: SessionState, note: string): SessionState {
		return {
			...state,
			notes: [...state.notes, note],
		};
	},

	/**
	 * Replaces the list of last-worked files.
	 *
	 * Pure function — performs no I/O.
	 *
	 * @param state - The current session state.
	 * @param files - The new list of file paths.
	 * @returns A new session state with the updated file list.
	 */
	updateLastWorked(state: SessionState, files: readonly string[]): SessionState {
		return {
			...state,
			last_worked_files: [...files],
		};
	},
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the full path to SESSION_STATE.md inside the session directory.
 *
 * Since `sessionDir` is already a {@link ValidatedPath}, joining a known-safe
 * filename is safe — no user input enters the filename.
 *
 * @param sessionDir - The validated session directory path.
 * @returns The resolved path cast to ValidatedPath.
 */
function resolveStateFilePath(sessionDir: ValidatedPath): ValidatedPath {
	return path.join(sessionDir, SESSION_STATE_FILENAME) as ValidatedPath;
}

/**
 * Reads the raw content of SESSION_STATE.md from disk.
 *
 * @param filePath - The validated path to the file.
 * @returns The file content as a UTF-8 string.
 * @throws {ParseError} If the file does not exist or cannot be read.
 */
function readFileContent(filePath: ValidatedPath): string {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch (cause: unknown) {
		throw new ParseError({
			message: `Cannot read ${SESSION_STATE_FILENAME}`,
			file: SESSION_STATE_FILENAME,
			cause,
		});
	}
}

/**
 * Parses and validates frontmatter from raw SESSION_STATE.md content.
 *
 * @param raw - The raw file content string.
 * @returns The validated session state.
 * @throws {ParseError} If frontmatter is missing or schema validation fails.
 * @throws {SecurityError} If malicious frontmatter is detected.
 */
function parseFrontmatter(raw: string): SessionState {
	return FrontmatterParser.parse(raw, SessionStateSchema, {
		file: SESSION_STATE_FILENAME,
	}).data;
}

/**
 * Applies an updater function to the first task whose text matches.
 *
 * Returns the original state if no task matches (idempotent).
 *
 * @param state - The current session state.
 * @param taskText - The text to match against task descriptions.
 * @param updater - A function that returns an updated task.
 * @returns A new session state with the updated tasks array.
 */
function updateTaskByText(
	state: SessionState,
	taskText: string,
	updater: (task: Task) => Task,
): SessionState {
	let found = false;
	const tasks = state.tasks.map((task) => {
		if (!found && task.text === taskText) {
			found = true;
			return updater(task);
		}
		return task;
	});

	if (!found) {
		return state;
	}

	return { ...state, tasks };
}

// ---------------------------------------------------------------------------
// YAML serialization (hand-rolled — no yaml library dependency)
// ---------------------------------------------------------------------------

/**
 * Serializes a {@link SessionState} into a complete markdown document
 * with YAML frontmatter and a human-readable body.
 *
 * @param state - The session state to serialize.
 * @returns A markdown string with YAML frontmatter.
 */
function serializeToMarkdown(state: SessionState): string {
	const yaml = serializeYaml(state);
	const body = buildMarkdownBody(state);
	return `---\n${yaml}---\n${body}`;
}

/**
 * Serializes session state fields into a YAML string.
 *
 * @param state - The session state.
 * @returns YAML content (without delimiters).
 */
function serializeYaml(state: SessionState): string {
	const lines: string[] = [];

	lines.push(`active_chunk: ${String(state.active_chunk)}`);
	lines.push(`session_id: ${yamlString(state.session_id)}`);
	lines.push(`last_updated: ${yamlString(state.last_updated)}`);

	lines.push(...serializeTasksYaml(state.tasks));
	lines.push(...serializeStringArrayYaml("notes", state.notes));
	lines.push(...serializeStringArrayYaml("last_worked_files", state.last_worked_files));
	lines.push(...serializeCompletedChunksYaml(state.completed_chunks));

	return `${lines.join("\n")}\n`;
}

/**
 * Serializes the tasks array into YAML lines.
 *
 * @param tasks - The tasks to serialize.
 * @returns An array of YAML lines.
 */
function serializeTasksYaml(tasks: readonly Task[]): string[] {
	if (tasks.length === 0) {
		return ["tasks: []"];
	}

	const lines: string[] = ["tasks:"];
	for (const task of tasks) {
		lines.push(`  - text: ${yamlString(task.text)}`);
		lines.push(`    status: ${yamlString(task.status)}`);
		if (task.added_at !== undefined) {
			lines.push(`    added_at: ${yamlString(task.added_at)}`);
		}
		if (task.completed_at !== undefined) {
			lines.push(`    completed_at: ${yamlString(task.completed_at)}`);
		}
	}
	return lines;
}

/**
 * Serializes a string array field (e.g., notes, last_worked_files) into YAML lines.
 *
 * @param key - The YAML key name.
 * @param values - The string values.
 * @returns An array of YAML lines.
 */
function serializeStringArrayYaml(key: string, values: readonly string[]): string[] {
	if (values.length === 0) {
		return [`${key}: []`];
	}

	const lines: string[] = [`${key}:`];
	for (const value of values) {
		lines.push(`  - ${yamlString(value)}`);
	}
	return lines;
}

/**
 * Serializes the completed_chunks record into YAML lines.
 *
 * @param chunks - Map of chunk IDs to completion date strings.
 * @returns An array of YAML lines.
 */
function serializeCompletedChunksYaml(chunks: Readonly<Record<string, string>>): string[] {
	const entries = Object.entries(chunks);
	if (entries.length === 0) {
		return ["completed_chunks: {}"];
	}

	const lines: string[] = ["completed_chunks:"];
	for (const [key, value] of entries) {
		lines.push(`  ${yamlString(key)}: ${yamlString(value)}`);
	}
	return lines;
}

/**
 * Wraps a value in double quotes for YAML output, escaping inner
 * double quotes and backslashes.
 *
 * @param value - The string to quote.
 * @returns The YAML-safe quoted string.
 */
function yamlString(value: string): string {
	const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return `"${escaped}"`;
}

/**
 * Builds the human-readable markdown body appended after frontmatter.
 *
 * @param state - The session state.
 * @returns Markdown content for the document body.
 */
function buildMarkdownBody(state: SessionState): string {
	return `\n# Session State\n\n## Active Chunk: ${String(state.active_chunk)}\n`;
}
