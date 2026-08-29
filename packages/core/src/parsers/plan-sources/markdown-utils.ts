/**
 * Line-level markdown helpers shared by every plan source.
 *
 * This module exists so task parsing, heading recognition, and fence tracking
 * have exactly one implementation. Two shipped bugs in this repo were private
 * copies of a shared rule drifting apart; see `formatter-utils.ts` for the same
 * pattern on the output side.
 *
 * No markdown AST library is used — `core` takes no new runtime dependencies.
 *
 * @packageDocumentation
 */

import type { Task } from "../../schemas/index.js";
import { TaskStatus } from "../../schemas/index.js";

/** Matches any ATX heading, capturing its `#`s and its text. */
export const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Matches the opening or closing line of a fenced code block. */
const FENCE_RE = /^(?:```|~~~)/;

/** Position nouns recognized in headings and dependency declarations. */
export const POSITION_NOUNS = [
	"chunk",
	"phase",
	"step",
	"milestone",
	"part",
	"stage",
	"sprint",
] as const;

/**
 * Matches a position declaration at the start of a heading: an optional
 * position noun followed by a number, or a bare leading number.
 *
 * Built from {@link POSITION_NOUNS} so the heading grammar and the dependency
 * grammar cannot drift apart.
 *
 * Captures the noun (group 1, may be undefined) and the number (group 2).
 */
export const POSITION_RE = new RegExp(
	`^(?:(${POSITION_NOUNS.join("|")})\\s+)?(\\d+(?:\\.\\d+)?)\\b`,
	"i",
);

/** Matches `- [ ] text` (todo task). */
const TASK_TODO_RE = /^[-*]\s+\[ \]\s+(.+)$/;

/** Matches `- [x] text` (done task, case-insensitive x). */
const TASK_DONE_RE = /^[-*]\s+\[[xX]\]\s+(.+)$/;

/** Matches `- [-] text` (in-progress task). */
const TASK_IN_PROGRESS_RE = /^[-*]\s+\[-\]\s+(.+)$/;

/** Matches estimated sessions like "Est. sessions: 2-3" or "Est. sessions: 4". */
const EST_SESSIONS_RE = /est\.?\s*sessions?:\s*(\d+)/i;

/** The lowest `chunk_id` {@link PlanChunkSchema} accepts. */
export const MIN_CHUNK_ID = 1;

/** One scanned line of a document. */
export interface ScannedLine {
	/** The line with surrounding whitespace removed. */
	readonly trimmed: string;
	/** 1-indexed line number. */
	readonly lineNumber: number;
	/** `true` if the line sits inside a fenced code block. */
	readonly inFence: boolean;
}

/**
 * Scan a document into trimmed lines, flagging which sit inside fenced code
 * blocks.
 *
 * Fence tracking is what stops YAML comments (`# .session/ai-index.yaml`) and
 * illustrative markdown inside examples from being counted as headings.
 *
 * @param content - The raw document.
 * @returns One {@link ScannedLine} per line, in order.
 */
export function scanLines(content: string): ScannedLine[] {
	const scanned: ScannedLine[] = [];
	let inFence = false;

	const rawLines = content.split("\n");
	for (let i = 0; i < rawLines.length; i++) {
		const trimmed = (rawLines[i] ?? "").trim();

		if (FENCE_RE.test(trimmed)) {
			// The fence delimiter itself is inside the block for our purposes:
			// it is never a heading or a task either way.
			scanned.push({ trimmed, lineNumber: i + 1, inFence: true });
			inFence = !inFence;
			continue;
		}

		scanned.push({ trimmed, lineNumber: i + 1, inFence });
	}

	return scanned;
}

/**
 * Parse a heading line into its depth and text.
 *
 * @param trimmed - The trimmed line content.
 * @returns The depth (1–6) and heading text, or `undefined` if not a heading.
 */
export function parseHeading(trimmed: string): { depth: number; text: string } | undefined {
	const match = HEADING_RE.exec(trimmed);
	if (match?.[1] === undefined || match[2] === undefined) {
		return undefined;
	}
	return { depth: match[1].length, text: match[2].trim() };
}

/** A position number declared by a heading, with the noun that introduced it. */
export interface DeclaredPosition {
	/** The declared number; may be fractional. */
	readonly value: number;
	/** The noun used, lowercased, or `undefined` for a bare leading number. */
	readonly noun: string | undefined;
	/** The title with the position prefix and its separator removed. */
	readonly title: string;
}

/**
 * Read a position declaration from heading text.
 *
 * @param heading - The heading text, without leading `#`s.
 * @returns The declared position, or `undefined` if the heading declares none.
 */
export function parseDeclaredPosition(heading: string): DeclaredPosition | undefined {
	const match = POSITION_RE.exec(heading);
	if (match?.[2] === undefined) {
		return undefined;
	}

	const value = Number.parseFloat(match[2]);
	if (!Number.isFinite(value)) {
		return undefined;
	}

	// At most one separator character, so a title that is itself punctuation
	// ("Chunk 1 — -") keeps its text instead of being stripped to nothing.
	const rest = heading.slice(match[0].length).replace(/^\s*[—–\-:.]?\s*/, "");

	return {
		value,
		noun: match[1]?.toLowerCase(),
		title: rest.trim() || heading.trim(),
	};
}

/**
 * Try to parse a line as a task checkbox.
 *
 * @param trimmed - The trimmed line content.
 * @returns A {@link Task} if the line is a checkbox, or `undefined` otherwise.
 */
export function parseTaskLine(trimmed: string): Task | undefined {
	const doneMatch = TASK_DONE_RE.exec(trimmed);
	if (doneMatch?.[1] !== undefined) {
		return { text: doneMatch[1].trim(), status: TaskStatus.DONE };
	}

	const inProgressMatch = TASK_IN_PROGRESS_RE.exec(trimmed);
	if (inProgressMatch?.[1] !== undefined) {
		return { text: inProgressMatch[1].trim(), status: TaskStatus.IN_PROGRESS };
	}

	const todoMatch = TASK_TODO_RE.exec(trimmed);
	if (todoMatch?.[1] !== undefined) {
		return { text: todoMatch[1].trim(), status: TaskStatus.TODO };
	}

	return undefined;
}

/**
 * Parse an estimated-sessions declaration from a line.
 *
 * @param trimmed - The trimmed line content.
 * @returns The first number found, or `undefined` if the pattern is absent.
 */
export function parseEstSessions(trimmed: string): number | undefined {
	const match = EST_SESSIONS_RE.exec(trimmed);
	if (match?.[1] === undefined) {
		return undefined;
	}
	const n = Number.parseInt(match[1], 10);
	return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * Build a dependency matcher that accepts the position nouns a document uses.
 *
 * The noun is optional so `Depends on: 1, 2` parses; `Depends on: nothing`
 * still does not, because the id group requires at least one digit.
 *
 * @param nouns - Position nouns observed in the document's headings.
 * @returns A regex capturing the comma-separated dependency ids.
 */
export function buildDependsPattern(nouns: readonly string[]): RegExp {
	// "chunk" is always accepted so documents written in the original dialect
	// keep parsing regardless of what noun their headings use.
	const alternatives = [...new Set(["chunk", ...nouns])].join("|");
	return new RegExp(`depends\\s+on:\\s*(?:(?:${alternatives})s?\\s+)?([\\d.,\\s]+)`, "i");
}

/**
 * Parse dependency ids from a line using a document-specific matcher.
 *
 * @param trimmed - The trimmed line content.
 * @param pattern - A matcher from {@link buildDependsPattern}.
 * @returns The declared dependency ids, or an empty array if none are found.
 */
export function parseDependencies(trimmed: string, pattern: RegExp): number[] {
	const match = pattern.exec(trimmed);
	if (match?.[1] === undefined) {
		return [];
	}
	return match[1]
		.split(",")
		.map((s) => Number.parseFloat(s.trim()))
		.filter((n) => Number.isFinite(n) && n >= MIN_CHUNK_ID);
}

/**
 * Whether a declared position can be stored as a `chunk_id`.
 *
 * @param value - The declared position number.
 * @returns `true` if {@link PlanChunkSchema} would accept it.
 */
export function isRepresentableChunkId(value: number): boolean {
	return Number.isFinite(value) && value >= MIN_CHUNK_ID;
}
