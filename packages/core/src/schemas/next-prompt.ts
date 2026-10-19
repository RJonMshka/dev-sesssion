import { z } from "zod";

/**
 * Default maximum number of lines allowed in NEXT_PROMPT.md.
 *
 * Projects may override this via `max_prompt_lines` in SESSION_STATE.md
 * frontmatter; this is the value used when none is configured.
 */
export const MAX_PROMPT_LINES = 20;

/** Lowest configurable value for `max_prompt_lines`. */
export const MIN_CONFIGURABLE_PROMPT_LINES = 5;

/** Highest configurable value for `max_prompt_lines`. */
export const MAX_CONFIGURABLE_PROMPT_LINES = 50;

/**
 * Counts the lines in a NEXT_PROMPT.md body.
 *
 * This is the single definition of "a prompt line" — blank lines are not
 * counted, so a trailing newline never inflates the total. Every consumer
 * (validation, health checks, trimming) must use this rather than a raw
 * `split("\n").length`, which counts the trailing newline as a line and
 * false-positives on a prompt sitting exactly at the cap.
 *
 * @param content - The raw NEXT_PROMPT.md content string.
 * @returns The number of non-empty lines.
 */
export function countPromptLines(content: string): number {
	return content.split("\n").filter((line) => line.length > 0).length;
}

/**
 * Most characters a NEXT_PROMPT.md may hold, whatever its line count
 * (REQ-PROV-5).
 *
 * The line cap alone does not bound size: one 8,000-character note is one
 * line. This is the configurable line maximum (50) times the note cap (240),
 * a backstop for third-party formatters and hand-edited state rather than a
 * target. Not configurable, because nothing legitimate comes near it.
 */
export const MAX_PROMPT_CHARS = 12_000;

/**
 * Counts the characters in a NEXT_PROMPT.md body.
 *
 * The single definition of a prompt's size in characters, the sibling of
 * {@link countPromptLines}. The writer's validation and the health check both
 * use it, so they cannot disagree about where the cap falls.
 *
 * @param content - The raw NEXT_PROMPT.md content string.
 * @returns The number of UTF-16 code units, newlines included.
 */
export function countPromptChars(content: string): number {
	return content.length;
}

/**
 * Zod schema for the content of NEXT_PROMPT.md.
 *
 * The next prompt is a self-contained bootstrap for the next AI session.
 * It must be concise (<= {@link MAX_PROMPT_LINES} lines) and include
 * everything needed to resume.
 */
export const NextPromptSchema = z
	.object({
		/** The project name (e.g., "dev-sesssion"). */
		project_name: z.string().min(1),
		/** Description of the active chunk (e.g., "3 — Core data model"). */
		active_chunk: z.string().min(1),
		/** File paths or patterns to load into context. */
		files_to_load: z.array(z.string().min(1)).min(1),
		/** A multi-line resume context string — what happened and what's next. */
		resume_context: z.string().min(1),
	})
	.strict();

/**
 * The structured content of NEXT_PROMPT.md.
 */
export type NextPrompt = z.infer<typeof NextPromptSchema>;

/**
 * Result of validating a NEXT_PROMPT.md string.
 */
export interface ValidationResult {
	/** Whether the prompt passes all validation checks. */
	readonly valid: boolean;
	/** The number of lines in the prompt. */
	readonly lineCount: number;
	/** The number of characters in the prompt (see {@link countPromptChars}). */
	readonly charCount: number;
	/** List of validation errors (empty if valid). */
	readonly errors: readonly string[];
}
