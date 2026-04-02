import { z } from "zod";

/** Maximum number of lines allowed in NEXT_PROMPT.md. */
export const MAX_PROMPT_LINES = 20;

/**
 * Zod schema for the content of NEXT_PROMPT.md.
 *
 * The next prompt is a self-contained bootstrap for the next AI session.
 * It must be concise (<=15 lines) and include everything needed to resume.
 */
export const NextPromptSchema = z
	.object({
		/** The project name (e.g., "dev-session"). */
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
	/** List of validation errors (empty if valid). */
	readonly errors: readonly string[];
}
