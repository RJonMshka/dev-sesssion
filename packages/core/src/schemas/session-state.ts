import { z } from "zod";

import {
	MAX_CONFIGURABLE_PROMPT_LINES,
	MAX_PROMPT_LINES,
	MIN_CONFIGURABLE_PROMPT_LINES,
} from "./next-prompt.js";
import { TaskSchema } from "./task.js";

/**
 * Zod schema for SESSION_STATE.md frontmatter.
 *
 * Represents the current state of a dev-sesssion: which chunk is active,
 * what tasks exist, which files were last worked on, and session metadata.
 */
export const SessionStateSchema = z
	.object({
		/**
		 * The numeric ID of the currently active chunk (e.g., 1, 2, 3).
		 * Fractional ids (`3.5`) are permitted, matching `PlanChunkSchema.chunk_id`,
		 * so an interstitial chunk can be made active without renumbering the plan.
		 */
		active_chunk: z.number().min(1),
		/** A unique identifier for this session (typically UUID v4). */
		session_id: z.string().min(1),
		/** ISO 8601 date string of the last update to this state file. */
		last_updated: z.string().min(1),
		/** The list of tasks in the active chunk. */
		tasks: z.array(TaskSchema).default([]),
		/** Relative file paths that were last worked on. */
		last_worked_files: z.array(z.string().min(1)).default([]),
		/** Free-form session notes (e.g., decisions, blockers, reminders). */
		notes: z.array(z.string()).default([]),
		/** Map of completed chunk IDs to completion dates. */
		completed_chunks: z.record(z.string(), z.string()).default({}),
		/**
		 * Maximum lines allowed in the generated NEXT_PROMPT.md.
		 *
		 * Omit to accept the {@link MAX_PROMPT_LINES} default. Lowering it
		 * tightens the discipline the prompt enforces; the bounds keep a
		 * bootstrap prompt both usable and genuinely compact.
		 */
		max_prompt_lines: z
			.number()
			.int()
			.min(MIN_CONFIGURABLE_PROMPT_LINES)
			.max(MAX_CONFIGURABLE_PROMPT_LINES)
			.default(MAX_PROMPT_LINES),
	})
	.strict();

/**
 * The session state stored in SESSION_STATE.md frontmatter.
 */
export type SessionState = z.infer<typeof SessionStateSchema>;
