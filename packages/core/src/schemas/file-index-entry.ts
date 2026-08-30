import { z } from "zod";

/**
 * Zod schema for a single entry in FILE_INDEX.md.
 *
 * Each entry maps a file path to the chunks it belongs to and its purpose.
 */
export const FileIndexEntrySchema = z
	.object({
		/** The relative file path from the project root. */
		filepath: z.string().min(1),
		/**
		 * The chunk IDs this file is tagged to (e.g., [1, 2]). Use `0` for "always include".
		 * Fractional ids (`3.5`) are permitted, matching `PlanChunkSchema.chunk_id`.
		 */
		chunk_tags: z.array(z.number().min(0)).min(1),
		/** A short description of the file's purpose. */
		purpose: z.string().min(1),
		/** Estimated token cost for loading this file into context. Populated by walker/scanner. */
		token_cost: z.number().int().min(0).optional(),
	})
	.strict();

/**
 * A single entry in the FILE_INDEX.md file.
 */
export type FileIndexEntry = z.infer<typeof FileIndexEntrySchema>;

/**
 * The result of auditing the file index against the filesystem.
 */
export interface AuditResult {
	/** Entries whose files no longer exist on disk. */
	readonly stale: readonly FileIndexEntry[];
	/** Chunk IDs referenced in the index that have no corresponding PLAN_N.md file. */
	readonly missingChunks: readonly number[];
	/** Whether the index is completely healthy (no stale entries or missing chunks). */
	readonly healthy: boolean;
}
