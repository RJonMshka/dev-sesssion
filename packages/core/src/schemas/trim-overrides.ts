/**
 * Schema for `.session/trim-overrides.json`.
 *
 * Trim overrides record which files the user has chosen to exclude
 * from the bootstrap context. They are session-scoped — cleared on
 * `dev-session advance`.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * A single file exclusion entry in trim overrides.
 */
export const TrimOverrideEntrySchema = z.object({
	/** Relative path from project root (as stored in FILE_INDEX). */
	filepath: z.string().min(1),
	/** ISO datetime when the exclusion was added. */
	excluded_at: z.string(),
	/** Optional note about why it was excluded. */
	reason: z.string().optional(),
});

export type TrimOverrideEntry = z.infer<typeof TrimOverrideEntrySchema>;

/**
 * Full trim-overrides.json structure.
 */
export const TrimOverridesSchema = z.object({
	/** Session ID this override set belongs to (cleared on advance). */
	session_id: z.string(),
	/** ISO datetime when this file was created. */
	created_at: z.string(),
	/** ISO datetime when this file was last modified. */
	updated_at: z.string(),
	/** Files excluded from bootstrap context. */
	excluded_files: z.array(TrimOverrideEntrySchema),
});

export type TrimOverrides = z.infer<typeof TrimOverridesSchema>;

/** Filename for the trim overrides file inside .session/. */
export const TRIM_OVERRIDES_FILENAME = "trim-overrides.json";
