import { z } from "zod";

import { TaskSchema } from "./task.js";

/**
 * Zod schema for a plan chunk's frontmatter (PLAN_N.md).
 *
 * Each chunk represents a phase of work with its own tasks and metadata.
 */
export const PlanChunkSchema = z
	.object({
		/** The numeric chunk ID (matches the N in PLAN_N.md). */
		chunk_id: z.number().int().min(1),
		/** The human-readable title of this chunk (e.g., "Security utilities"). */
		title: z.string().min(1),
		/** Chunk IDs that must be completed before this one can start. */
		depends_on: z.array(z.number().int().min(1)).default([]),
		/** Estimated number of sessions to complete this chunk. */
		est_sessions: z.number().int().min(1).optional(),
		/** The list of tasks within this chunk. */
		tasks: z.array(TaskSchema).default([]),
	})
	.strict();

/**
 * A plan chunk — one phase of work in the project plan.
 */
export type PlanChunk = z.infer<typeof PlanChunkSchema>;
