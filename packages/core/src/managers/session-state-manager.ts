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

import { isDerivedNote, isProgressNote } from "../formatters/formatter-utils.js";
import type { SessionState, Task } from "../schemas/index.js";
import { MAX_PROMPT_LINES, SessionStateSchema, TaskStatus } from "../schemas/index.js";

/** The filename of the session state file within the `.session/` directory. */
const SESSION_STATE_FILENAME = "SESSION_STATE.md";

/**
 * Manages the lifecycle of SESSION_STATE.md: loading from disk,
 * saving to disk, and pure in-memory state transitions.
 */
export const SessionStateManager = {
	/**
	 * Serializes a state exactly as {@link SessionStateManager.save} writes it.
	 * Pure; the budget counts this text (LLD-budget.md, REQ-BUD-1).
	 *
	 * @param state - The session state.
	 * @returns The `SESSION_STATE.md` content.
	 */
	toMarkdown(state: SessionState): string {
		return serializeToMarkdown(state);
	},

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
	 * Adds a task, as todo, when the state lists none with that exact text.
	 *
	 * Pure function — performs no I/O. Used before marking a task of the active
	 * chunk that state does not hold yet (REQ-WF-10).
	 *
	 * @param state - The current session state.
	 * @param taskText - The exact text of the task.
	 * @returns The state unchanged if it already lists the task, else with it appended.
	 */
	adoptTask(state: SessionState, taskText: string): SessionState {
		if (state.tasks.some((task) => task.text === taskText)) {
			return state;
		}
		return { ...state, tasks: [...state.tasks, { text: taskText, status: TaskStatus.TODO }] };
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

	/**
	 * Removes the notes the tool wrote to record progress (REQ-WF-6). Earlier
	 * versions added a `Completed: Chunks …` note here; it repeated the
	 * prompt's `Resume:` line and went stale, so nothing adds one now (REQ-WF-4).
	 *
	 * Pure function — performs no I/O. Call `save()` separately to persist.
	 *
	 * @param state - The current session state.
	 * @returns The state without progress-shaped notes.
	 */
	compact(state: SessionState): SessionState {
		return { ...state, notes: state.notes.filter((n) => !isProgressNote(n)) };
	},

	/**
	 * Splits the notes when a chunk is archived (REQ-WF-5, 6): the owner's
	 * notes leave the state for the chunk's `DONE_LOG.md` entry, notes derived
	 * from a file stay, and progress notes are dropped.
	 *
	 * Pure function — performs no I/O.
	 *
	 * @param state - The current session state.
	 * @returns The state keeping only derived notes, and the owner's notes in the order added.
	 */
	takeChunkNotes(state: SessionState): {
		readonly state: SessionState;
		readonly archived: readonly string[];
	} {
		const kept = state.notes.filter((n) => !isProgressNote(n));
		return {
			state: { ...state, notes: kept.filter(isDerivedNote) },
			archived: kept.filter((n) => !isDerivedNote(n)),
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

	// Only persisted when overridden, so existing state files are left untouched
	// by an ordinary save.
	// Guarded on the type, not just the value: states built by hand (rather than
	// parsed through the schema) can omit the field entirely, and serializing
	// `undefined` would write a literal "undefined" that fails to parse back.
	if (typeof state.max_prompt_lines === "number" && state.max_prompt_lines !== MAX_PROMPT_LINES) {
		lines.push(`max_prompt_lines: ${String(state.max_prompt_lines)}`);
	}
	if (state.project_name !== undefined) {
		lines.push(`project_name: ${yamlString(state.project_name)}`);
	}
	// Guarded on the type, as above: a hand-built state may omit it (REQ-WF-18).
	if (Array.isArray(state.workflow)) {
		lines.push(...serializeStringArrayYaml("workflow", state.workflow));
	}
	lines.push(...serializeSessionBaseYaml(state.session_base));

	return `${lines.join("\n")}\n`;
}

/**
 * Serializes the session base (REQ-IDX-19). Written only when present, like
 * `project_name`, so state from before tagging on touch saves unchanged.
 *
 * @param base - The recorded base, if any.
 * @returns YAML lines; none when there is no base.
 */
export function serializeSessionBaseYaml(base: SessionState["session_base"]): string[] {
	if (base === undefined) return [];
	const lines = ["session_base:"];
	if (base.commit !== undefined) lines.push(`  commit: ${yamlString(base.commit)}`);
	if (base.dirty.length === 0) {
		lines.push("  dirty: []");
		return lines;
	}
	lines.push("  dirty:");
	for (const d of base.dirty) {
		lines.push(`    - path: ${yamlString(d.path)}`);
		lines.push(`      hash: ${yamlString(d.hash)}`);
	}
	return lines;
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
