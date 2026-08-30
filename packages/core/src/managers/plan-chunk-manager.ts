/**
 * Manages plan chunk files (PLAN_N.md) within a dev-sesssion directory.
 *
 * Handles loading, querying, advancing, and archiving plan chunks.
 * All file reads use {@link FrontmatterParser} for safe parsing;
 * all writes use {@link AtomicWriter} for atomic, secret-scanned output.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, FrontmatterParser, ParseError } from "@dev-session/security";
import type { PlanChunk, SessionState } from "../schemas/index.js";
import { PlanChunkSchema, TaskStatus } from "../schemas/index.js";

/**
 * Pattern that matches plan chunk filenames like PLAN_1.md, PLAN_2.md, PLAN_3.5.md.
 *
 * Fractional ids are accepted because `PlanChunkSchema` and PROTOCOL.md both
 * allow them, so that an interstitial chunk can be inserted between two existing
 * ones without renumbering the plan.
 */
const PLAN_CHUNK_PATTERN = /^PLAN_(\d+(?:\.\d+)?)\.md$/;

/** The filename used for the done/archive log. */
export const DONE_LOG_FILENAME = "DONE_LOG.md";

/**
 * Reads and validates a single plan chunk file.
 *
 * @param filePath - Absolute path to the PLAN_N.md file.
 * @param relativeName - The filename (e.g. "PLAN_3.md") used in error messages.
 * @returns The validated plan chunk data.
 * @throws {ParseError} If the file cannot be read or frontmatter is invalid.
 */
function readChunkFile(filePath: string, relativeName: string): PlanChunk {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch (cause: unknown) {
		throw new ParseError({
			message: `Failed to read plan chunk file "${relativeName}"`,
			file: relativeName,
			cause,
		});
	}

	const { data } = FrontmatterParser.parse(raw, PlanChunkSchema, {
		file: relativeName,
	});

	return data;
}

/**
 * Lists plan chunk filenames in a session directory, sorted by chunk ID.
 *
 * @param sessionDir - A validated path to the session directory.
 * @returns An array of `{ name, chunkId }` entries sorted by `chunkId`.
 */
function listChunkFiles(sessionDir: ValidatedPath): readonly { name: string; chunkId: number }[] {
	let entries: readonly string[];
	try {
		entries = fs.readdirSync(sessionDir);
	} catch {
		return [];
	}

	const chunks: { name: string; chunkId: number }[] = [];

	for (const entry of entries) {
		const match = PLAN_CHUNK_PATTERN.exec(entry);
		if (match !== null) {
			const idStr = match[1];
			if (idStr !== undefined) {
				const chunkId = Number.parseFloat(idStr);
				if (Number.isFinite(chunkId)) {
					chunks.push({ name: entry, chunkId });
				}
			}
		}
	}

	chunks.sort((a, b) => a.chunkId - b.chunkId);
	return chunks;
}

/**
 * Builds the archive summary text for a completed chunk.
 *
 * @param chunk - The plan chunk to summarize.
 * @param completionDate - ISO 8601 date string for the completion timestamp.
 * @returns The formatted summary string.
 */
function buildArchiveSummary(chunk: PlanChunk, completionDate: string): string {
	const taskCount = chunk.tasks.length;
	return `## Chunk ${String(chunk.chunk_id)} — ${chunk.title}\nCompleted: ${completionDate}\nTasks: ${String(taskCount)}\n\n`;
}

/**
 * Reads existing content from DONE_LOG.md, returning an empty string if the file does not exist.
 *
 * @param logPath - Absolute path to DONE_LOG.md.
 * @returns The existing file content, or an empty string.
 */
function readExistingLog(logPath: string): string {
	try {
		return fs.readFileSync(logPath, "utf8");
	} catch {
		return "";
	}
}

/**
 * Manages plan chunk files (PLAN_N.md) in a dev-sesssion directory.
 *
 * Provides methods to load, query, advance, and archive plan chunks.
 * Pure functions (`advance`, `isComplete`) perform no I/O; I/O functions
 * (`loadAll`, `loadActive`, `archive`) use security-safe readers and writers.
 */
export const PlanChunkManager = {
	/**
	 * Loads all plan chunk files from the session directory.
	 *
	 * Reads every file matching `PLAN_N.md`, parses and validates its
	 * frontmatter via {@link FrontmatterParser}, and returns them sorted
	 * by `chunk_id` in ascending order.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @returns An array of validated plan chunks, sorted by `chunk_id`. Empty if none found.
	 * @throws {ParseError} If any chunk file has invalid frontmatter.
	 */
	loadAll(sessionDir: ValidatedPath): PlanChunk[] {
		const files = listChunkFiles(sessionDir);

		if (files.length === 0) {
			return [];
		}

		return files.map(({ name }) => {
			const filePath = path.join(sessionDir, name);
			return readChunkFile(filePath, name);
		});
	},

	/**
	 * Loads the plan chunk that matches the active chunk in the session state.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @param state - The current session state containing `active_chunk`.
	 * @returns The validated plan chunk for the active chunk.
	 * @throws {ParseError} If the chunk file does not exist or has invalid frontmatter.
	 */
	loadActive(sessionDir: ValidatedPath, state: SessionState): PlanChunk {
		const filename = `PLAN_${String(state.active_chunk)}.md`;
		const filePath = path.join(sessionDir, filename);

		if (!fs.existsSync(filePath)) {
			throw new ParseError({
				message: `Plan chunk file "${filename}" not found — expected for active chunk ${String(state.active_chunk)}`,
				file: filename,
			});
		}

		return readChunkFile(filePath, filename);
	},

	/**
	 * Advances the session state to the next chunk.
	 *
	 * Pure function — performs no I/O. Returns a new `SessionState` with
	 * `active_chunk` incremented by 1 and the current chunk added to
	 * `completed_chunks` with today's ISO date.
	 *
	 * @param state - The current session state.
	 * @returns A new session state with the chunk advanced.
	 */
	advance(state: SessionState): SessionState {
		const today = new Date().toISOString().slice(0, 10);
		const currentChunkKey = String(state.active_chunk);

		return {
			...state,
			active_chunk: state.active_chunk + 1,
			completed_chunks: {
				...state.completed_chunks,
				[currentChunkKey]: today,
			},
		};
	},

	/**
	 * Checks whether all tasks in a plan chunk are complete.
	 *
	 * Returns `true` if every task has status `"done"`, or if the
	 * tasks array is empty.
	 *
	 * @param chunk - The plan chunk to check.
	 * @returns `true` if the chunk is fully complete.
	 */
	isComplete(chunk: PlanChunk): boolean {
		return chunk.tasks.every((task) => task.status === TaskStatus.DONE);
	},

	/**
	 * Archives a completed chunk by appending a summary to DONE_LOG.md.
	 *
	 * Creates the file if it does not exist. Appends a formatted summary
	 * block containing the chunk ID, title, completion date, and task count.
	 * Writes via {@link AtomicWriter} for atomic, secret-scanned output.
	 *
	 * @param sessionDir - A validated path to the `.session/` directory.
	 * @param chunk - The completed plan chunk to archive.
	 * @throws {CliError} If the write operation fails.
	 */
	archive(sessionDir: ValidatedPath, chunk: PlanChunk): void {
		const logPath = path.join(sessionDir, DONE_LOG_FILENAME) as ValidatedPath;
		const existing = readExistingLog(logPath);
		const completionDate = new Date().toISOString().slice(0, 10);
		const summary = buildArchiveSummary(chunk, completionDate);
		const content = existing + summary;

		try {
			AtomicWriter.writeFile(logPath, content);
		} catch (cause: unknown) {
			throw new CliError({
				message: `Failed to write archive log "${DONE_LOG_FILENAME}"`,
				suggestion: `Check that the session directory is writable`,
				cause,
			});
		}
	},
} as const;
