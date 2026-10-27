import { z } from "zod";

import { TaskSchema } from "./task.js";

/**
 * Zod schema for a plan chunk's frontmatter (PLAN_N.md).
 *
 * Each chunk represents a phase of work with its own tasks and metadata.
 */
export const PlanChunkSchema = z
	.object({
		/**
		 * The numeric chunk ID. Usually the integer N in PLAN_N.md, but fractional
		 * IDs (e.g. `3.5`) are allowed so an interstitial chunk can be inserted
		 * between two existing chunks without renumbering the whole plan.
		 */
		chunk_id: z.number().min(1),
		/** The human-readable title of this chunk (e.g., "Security utilities"). */
		title: z.string().min(1),
		/** Chunk IDs that must be completed before this one can start (may be fractional). */
		depends_on: z.array(z.number().min(1)).default([]),
		/** Estimated number of sessions to complete this chunk. */
		est_sessions: z.number().int().min(1).optional(),
		/** The list of tasks within this chunk. */
		tasks: z.array(TaskSchema).default([]),
		/**
		 * Repository paths the chunk's plan section names outside its tasks, such
		 * as a "Key Files" block (LLD-file-index.md, REQ-IDX-12). Optional:
		 * absent means the plan named none, and older files stay valid.
		 */
		files: z.array(z.string().min(1)).optional(),
		/**
		 * The chunk's plan section without its task lines — goal, steps, file
		 * list — as the plan wrote it (LLD-prompt-context.md, REQ-PCX-1).
		 */
		brief: z.string().min(1).optional(),
	})
	.strict();

/**
 * A plan chunk — one phase of work in the project plan.
 */
export type PlanChunk = z.infer<typeof PlanChunkSchema>;
