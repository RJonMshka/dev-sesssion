/**
 * Manual markdown parser for PLAN.md files.
 *
 * Splits a monolithic plan on `## ` headings into {@link PlanChunk} objects,
 * detects chunk boundaries with confidence scores, and serializes chunks
 * back to markdown.
 *
 * No external markdown AST library is used — parsing is done line-by-line.
 *
 * @packageDocumentation
 */

import { ParseError } from "@dev-session/security";
import type { BoundaryResult, PlanChunk, Task } from "../schemas/index.js";
import { TaskStatus } from "../schemas/index.js";

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** Matches a `## ` (h2) heading line and captures the heading text. */
const H2_RE = /^## \s*(.+)$/;

/** Matches a `# ` (h1) heading line and captures the heading text. */
const H1_RE = /^# \s*(.+)$/;

/** Matches a `### ` (h3+) heading line and captures the heading text. */
const H3_PLUS_RE = /^###+ \s*(.+)$/;

/** Matches a horizontal rule (`---`, `***`, `___`) on its own line. */
const HR_RE = /^(?:---+|\*\*\*+|___+)\s*$/;

/** Matches `- [ ] text` (todo task). */
const TASK_TODO_RE = /^[-*]\s+\[ \]\s+(.+)$/;

/** Matches `- [x] text` (done task, case-insensitive x). */
const TASK_DONE_RE = /^[-*]\s+\[[xX]\]\s+(.+)$/;

/** Matches `- [-] text` (in-progress task). */
const TASK_IN_PROGRESS_RE = /^[-*]\s+\[-\]\s+(.+)$/;

/** Matches "Chunk N" in a heading and captures N. */
const CHUNK_ID_RE = /\bChunk\s+(\d+)\b/i;

/** Matches dependency declarations like "Depends on: Chunk 1" or "Chunks 1, 2, 3". */
const DEPENDS_RE = /depends\s+on:\s*chunks?\s+([\d,\s]+)/i;

/** Matches estimated sessions like "Est. sessions: 2-3" or "Est. sessions: 4". */
const EST_SESSIONS_RE = /est\.?\s*sessions?:\s*(\d+)/i;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a chunk_id from heading text if it contains "Chunk N".
 *
 * @param heading - The heading text to inspect.
 * @returns The parsed chunk ID, or `undefined` if the pattern is not found.
 */
function extractChunkIdFromHeading(heading: string): number | undefined {
	const match = CHUNK_ID_RE.exec(heading);
	if (match?.[1] === undefined) {
		return undefined;
	}
	const id = Number.parseInt(match[1], 10);
	return Number.isFinite(id) && id >= 1 ? id : undefined;
}

/**
 * Extract the display title from a heading, stripping "Chunk N — " prefix if present.
 *
 * @param heading - The raw heading text.
 * @returns The cleaned title string.
 */
function extractTitle(heading: string): string {
	// Strip patterns like "Chunk 2 — Security utilities" → "Security utilities"
	// Also handles "Chunk 2 - Security utilities" (plain dash)
	const stripped = heading.replace(/^Chunk\s+\d+\s*[—–\-:]\s*/i, "");
	return stripped.trim() || heading.trim();
}

/**
 * Parse a single line for dependency information.
 *
 * @param line - The trimmed line to inspect.
 * @returns Array of dependency chunk IDs, or empty array if none found.
 */
function parseDependencies(line: string): readonly number[] {
	const match = DEPENDS_RE.exec(line);
	if (match?.[1] === undefined) {
		return [];
	}
	return match[1]
		.split(",")
		.map((s) => Number.parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n >= 1);
}

/**
 * Parse a single line for estimated sessions.
 *
 * @param line - The trimmed line to inspect.
 * @returns The first number found, or `undefined` if the pattern is not matched.
 */
function parseEstSessions(line: string): number | undefined {
	const match = EST_SESSIONS_RE.exec(line);
	if (match?.[1] === undefined) {
		return undefined;
	}
	const n = Number.parseInt(match[1], 10);
	return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * Try to parse a line as a task checkbox.
 *
 * @param line - The trimmed line content.
 * @returns A {@link Task} if the line is a checkbox, or `undefined` otherwise.
 */
function parseTaskLine(line: string): Task | undefined {
	const doneMatch = TASK_DONE_RE.exec(line);
	if (doneMatch?.[1] !== undefined) {
		return { text: doneMatch[1].trim(), status: TaskStatus.DONE };
	}

	const inProgressMatch = TASK_IN_PROGRESS_RE.exec(line);
	if (inProgressMatch?.[1] !== undefined) {
		return { text: inProgressMatch[1].trim(), status: TaskStatus.IN_PROGRESS };
	}

	const todoMatch = TASK_TODO_RE.exec(line);
	if (todoMatch?.[1] !== undefined) {
		return { text: todoMatch[1].trim(), status: TaskStatus.TODO };
	}

	return undefined;
}

/**
 * Determine whether a line is inside a YAML frontmatter block.
 *
 * Frontmatter is delimited by `---` on the very first line of the file
 * and a subsequent `---` line. Horizontal rules elsewhere are not frontmatter.
 *
 * @param lineIndex - The 0-based index of the current line.
 * @param frontmatterEnd - The 0-based index where frontmatter ends (-1 if no frontmatter).
 * @returns `true` if the line is inside the frontmatter block.
 */
function isInsideFrontmatter(lineIndex: number, frontmatterEnd: number): boolean {
	return frontmatterEnd >= 0 && lineIndex <= frontmatterEnd;
}

/**
 * Find the line index where YAML frontmatter ends.
 *
 * Frontmatter must start on line 0 with `---` and end with a subsequent `---`.
 *
 * @param lines - All lines of the document.
 * @returns The 0-based line index of the closing `---`, or -1 if no frontmatter.
 */
function findFrontmatterEnd(lines: readonly string[]): number {
	if (lines[0]?.trim() !== "---") {
		return -1;
	}
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			return i;
		}
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Accumulator for building chunks from sequential line scanning
// ---------------------------------------------------------------------------

interface ChunkAccumulator {
	heading: string;
	tasks: Task[];
	dependsOn: number[];
	estSessions: number | undefined;
}

/**
 * Finalize a {@link ChunkAccumulator} into a {@link PlanChunk}.
 *
 * @param acc - The accumulated chunk data.
 * @param chunkId - The chunk_id to assign.
 * @returns A fully formed {@link PlanChunk}.
 */
function finalizeChunk(acc: ChunkAccumulator, chunkId: number): PlanChunk {
	const base: PlanChunk = {
		chunk_id: chunkId,
		title: extractTitle(acc.heading),
		depends_on: [...acc.dependsOn],
		tasks: [...acc.tasks],
	};

	if (acc.estSessions !== undefined) {
		return { ...base, est_sessions: acc.estSessions };
	}

	return base;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses PLAN.md markdown into structured {@link PlanChunk} objects,
 * detects chunk boundaries, and serializes chunks back to markdown.
 */
export const PlanParser = {
	/**
	 * Parse a monolithic PLAN.md into an array of {@link PlanChunk} objects.
	 *
	 * Splits on `## ` (h2) headings. Each h2 section becomes one chunk.
	 * Content before the first h2 is ignored (typically the document title).
	 *
	 * @param content - The raw markdown content of PLAN.md.
	 * @returns An array of parsed plan chunks.
	 * @throws {ParseError} If the content is empty.
	 */
	fromMarkdown(content: string): PlanChunk[] {
		if (content.trim().length === 0) {
			throw new ParseError({
				message: "Plan content is empty",
				file: "PLAN.md",
			});
		}

		const lines = content.split("\n");
		const chunks: PlanChunk[] = [];
		let current: ChunkAccumulator | undefined;
		let sequentialId = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			const h2Match = H2_RE.exec(trimmed);

			if (h2Match?.[1] !== undefined) {
				// Finalize previous chunk if one exists
				if (current !== undefined) {
					const id = extractChunkIdFromHeading(current.heading) ?? sequentialId;
					chunks.push(finalizeChunk(current, id));
				}

				sequentialId++;
				current = {
					heading: h2Match[1],
					tasks: [],
					dependsOn: [],
					estSessions: undefined,
				};
				continue;
			}

			// Only process lines if we're inside a chunk
			if (current === undefined) {
				continue;
			}

			processChunkLine(trimmed, current);
		}

		// Finalize the last chunk
		if (current !== undefined) {
			const id = extractChunkIdFromHeading(current.heading) ?? sequentialId;
			chunks.push(finalizeChunk(current, id));
		}

		return chunks;
	},

	/**
	 * Detect potential chunk boundaries in a PLAN.md file.
	 *
	 * Returns suggested split points with confidence scores:
	 * - `## ` heading → confidence 1.0
	 * - `# ` heading → confidence 0.7
	 * - `---` horizontal rule (outside frontmatter) → confidence 0.5
	 * - `### ` or deeper heading → confidence 0.3
	 *
	 * @param content - The raw markdown content to analyze.
	 * @returns An array of boundary results sorted by line number.
	 * @throws {ParseError} If the content is empty.
	 */
	detectBoundaries(content: string): BoundaryResult[] {
		if (content.trim().length === 0) {
			throw new ParseError({
				message: "Plan content is empty",
				file: "PLAN.md",
			});
		}

		const lines = content.split("\n");
		const frontmatterEnd = findFrontmatterEnd(lines);
		const boundaries: BoundaryResult[] = [];
		let suggestedChunkId = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) {
				continue;
			}
			const trimmed = line.trim();

			if (isInsideFrontmatter(i, frontmatterEnd)) {
				continue;
			}

			const boundary = classifyBoundaryLine(trimmed, i + 1);
			if (boundary !== undefined) {
				suggestedChunkId++;
				boundaries.push({ ...boundary, suggestedChunkId });
			}
		}

		return boundaries;
	},

	/**
	 * Serialize a {@link PlanChunk} back to markdown format.
	 *
	 * @param chunk - The plan chunk to serialize.
	 * @returns A markdown string representing the chunk.
	 */
	toMarkdown(chunk: PlanChunk): string {
		const lines: string[] = [];

		lines.push(`## Chunk ${chunk.chunk_id} — ${chunk.title}`);
		lines.push("");

		if (chunk.depends_on.length > 0 || chunk.est_sessions !== undefined) {
			if (chunk.depends_on.length > 0) {
				const label = chunk.depends_on.length === 1 ? "Chunk" : "Chunks";
				lines.push(`> Depends on: ${label} ${chunk.depends_on.join(", ")}`);
			}
			if (chunk.est_sessions !== undefined) {
				lines.push(`> Est. sessions: ${chunk.est_sessions}`);
			}
			lines.push("");
		}

		if (chunk.tasks.length > 0) {
			lines.push("### Tasks");
			lines.push("");
			for (const task of chunk.tasks) {
				lines.push(formatTask(task));
			}
			lines.push("");
		}

		return lines.join("\n");
	},
} as const;

// ---------------------------------------------------------------------------
// Private helpers used by the public API
// ---------------------------------------------------------------------------

/**
 * Process a single non-heading line within the current chunk accumulator.
 *
 * Looks for tasks, dependencies, and session estimates.
 *
 * @param trimmed - The trimmed line content.
 * @param acc - The current chunk accumulator to mutate.
 */
function processChunkLine(trimmed: string, acc: ChunkAccumulator): void {
	const task = parseTaskLine(trimmed);
	if (task !== undefined) {
		acc.tasks.push(task);
		return;
	}

	// Only look for metadata if we haven't found it yet
	if (acc.dependsOn.length === 0) {
		const deps = parseDependencies(trimmed);
		if (deps.length > 0) {
			acc.dependsOn = [...deps];
		}
	}

	if (acc.estSessions === undefined) {
		acc.estSessions = parseEstSessions(trimmed);
	}
}

/**
 * Classify a line as a potential chunk boundary.
 *
 * @param trimmed - The trimmed line content.
 * @param lineNumber - The 1-indexed line number.
 * @returns A partial {@link BoundaryResult} without `suggestedChunkId`, or `undefined`.
 */
function classifyBoundaryLine(
	trimmed: string,
	lineNumber: number,
): Omit<BoundaryResult, "suggestedChunkId"> | undefined {
	const h2Match = H2_RE.exec(trimmed);
	if (h2Match?.[1] !== undefined) {
		return { lineNumber, heading: h2Match[1], confidence: 1.0 };
	}

	const h1Match = H1_RE.exec(trimmed);
	if (h1Match?.[1] !== undefined) {
		return { lineNumber, heading: h1Match[1], confidence: 0.7 };
	}

	if (HR_RE.test(trimmed)) {
		return { lineNumber, heading: "", confidence: 0.5 };
	}

	const h3Match = H3_PLUS_RE.exec(trimmed);
	if (h3Match?.[1] !== undefined) {
		return { lineNumber, heading: h3Match[1], confidence: 0.3 };
	}

	return undefined;
}

/**
 * Format a single {@link Task} as a markdown checkbox line.
 *
 * @param task - The task to format.
 * @returns A markdown line like `- [ ] Task text`.
 */
function formatTask(task: Task): string {
	switch (task.status) {
		case TaskStatus.DONE:
			return `- [x] ${task.text}`;
		case TaskStatus.IN_PROGRESS:
			return `- [-] ${task.text}`;
		case TaskStatus.TODO:
			return `- [ ] ${task.text}`;
	}
}
