/**
 * Manual markdown parser for PLAN.md files.
 *
 * Chunk extraction lives in `plan-sources/` behind a registry; this module
 * keeps the stable `PlanParser` facade over it, plus boundary detection and
 * chunk serialization.
 *
 * No external markdown AST library is used — parsing is done line-by-line.
 *
 * @packageDocumentation
 */

import { ParseError } from "@dev-session/security";
import type { BoundaryResult, PlanChunk, Task } from "../schemas/index.js";
import { TaskStatus } from "../schemas/index.js";
import { detectPlanSource, PLAN_SOURCE_MIN_CONFIDENCE } from "./plan-sources/index.js";

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses PLAN.md markdown into structured {@link PlanChunk} objects,
 * detects chunk boundaries, and serializes chunks back to markdown.
 */
export const PlanParser = {
	/**
	 * Parse a plan document into an array of {@link PlanChunk} objects.
	 *
	 * Delegates to the plan source registry: every registered source scores the
	 * document and the highest scorer parses it. The built-in sources handle
	 * heading-structured plans at any depth — `Chunk N`, `Phase N`, `Step N`, or
	 * plain prose headings — and heading-free task lists.
	 *
	 * Returns only the chunks. Callers that need to know which sections were
	 * excluded, or which declared dependencies were dropped, should use
	 * `parsePlan` instead; this entry point deliberately keeps its original
	 * signature.
	 *
	 * @param content - The raw markdown content of the plan.
	 * @returns An array of parsed plan chunks, empty if no source recognized it.
	 * @throws {ParseError} If the content is empty.
	 */
	fromMarkdown(content: string): PlanChunk[] {
		if (content.trim().length === 0) {
			throw new ParseError({
				message: "Plan content is empty",
				file: "PLAN.md",
			});
		}

		const candidates = detectPlanSource(content);
		const best = candidates[0];

		// Unlike `parsePlan`, this entry point returns an empty array rather than
		// throwing when nothing recognizes the document — that is its long-
		// standing contract and callers depend on it.
		if (best === undefined || best.detection.confidence < PLAN_SOURCE_MIN_CONFIDENCE) {
			return [];
		}

		return [...best.source.parse(content).chunks];
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
	 * Serialize a {@link PlanChunk} to a PLAN_N.md file format.
	 *
	 * Writes YAML frontmatter (required by {@link PlanChunkManager}) followed
	 * by a human-readable markdown body. The `---` delimiters are read back
	 * by `FrontmatterParser`; the body is for human reference only.
	 *
	 * @param chunk - The plan chunk to serialize.
	 * @returns A markdown string with frontmatter representing the chunk.
	 */
	toMarkdown(chunk: PlanChunk): string {
		const lines: string[] = [];

		// --- YAML frontmatter (required by PlanChunkManager / FrontmatterParser) ---
		lines.push("---");
		lines.push(`chunk_id: ${chunk.chunk_id}`);
		lines.push(`title: ${JSON.stringify(chunk.title)}`);
		lines.push(`depends_on: [${chunk.depends_on.join(", ")}]`);
		if (chunk.est_sessions !== undefined) {
			lines.push(`est_sessions: ${chunk.est_sessions}`);
		}
		if (chunk.tasks.length > 0) {
			lines.push("tasks:");
			for (const task of chunk.tasks) {
				lines.push(`  - text: ${JSON.stringify(task.text)}`);
				lines.push(`    status: ${task.status}`);
				if (task.added_at !== undefined) {
					lines.push(`    added_at: ${JSON.stringify(task.added_at)}`);
				}
				if (task.completed_at !== undefined) {
					lines.push(`    completed_at: ${JSON.stringify(task.completed_at)}`);
				}
			}
		} else {
			lines.push("tasks: []");
		}
		lines.push("---");
		lines.push("");

		// --- Human-readable body ---
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
