/**
 * Schema and types for CONTEXT_LOG.md — the append-only session memory log.
 *
 * Each entry records what was loaded and modified during a dev-sesssion session.
 * The log is stored in `.session/CONTEXT_LOG.md` as a YAML frontmatter list
 * and is always gitignored (personal session data, not team-shared).
 *
 * @packageDocumentation
 */

import { z } from "zod";

/** Filename for the context log within the `.session/` directory. */
export const CONTEXT_LOG_FILENAME = "CONTEXT_LOG.md";

/**
 * A single entry in the context log.
 *
 * Appended by `dev-sesssion update` and `dev-sesssion advance` after each session.
 */
export const ContextLogEntrySchema = z.object({
	/** Unique session identifier — matches `session_id` in SESSION_STATE. */
	session_id: z.string().min(1),
	/** ISO 8601 datetime when this entry was recorded. */
	timestamp: z.string().min(1),
	/** The active chunk ID at the time of the entry. */
	active_chunk: z.number().int().nonnegative(),
	/** Relative paths of files loaded into context for this session. */
	files_loaded: z.array(z.string()),
	/** Approximate total token cost of the context at the time of logging. */
	total_tokens: z.number().int().nonnegative(),
	/** Relative paths of files that were modified during this session. */
	modifications: z.array(z.string()),
});

/** A single parsed context log entry. */
export type ContextLogEntry = z.infer<typeof ContextLogEntrySchema>;

/** The top-level schema wrapping the list of log entries in CONTEXT_LOG.md. */
export const ContextLogSchema = z.object({
	entries: z.array(ContextLogEntrySchema),
});

/** The parsed CONTEXT_LOG.md document. */
export type ContextLog = z.infer<typeof ContextLogSchema>;

/**
 * Aggregate statistics derived from a set of context log entries.
 */
export interface ContextLogStats {
	/** Total number of sessions recorded. */
	readonly totalSessions: number;
	/** ISO date of the earliest session, or null if no entries. */
	readonly firstDate: string | null;
	/** ISO date of the most recent session, or null if no entries. */
	readonly lastDate: string | null;
	/** Average token count across all sessions, rounded to integer. */
	readonly avgTokens: number;
	/** Top 5 most frequently loaded files, sorted by load count descending. */
	readonly topFiles: readonly { path: string; count: number }[];
}

/**
 * A staleness report entry for a single file in the index or always-include list.
 */
export interface StalenessReport {
	/** Relative file path. */
	readonly path: string;
	/** Number of sessions in which this file was loaded. */
	readonly sessionCount: number;
	/** ISO date of last recorded modification, or null if never modified. */
	readonly lastModified: string | null;
	/** Recommended action. */
	readonly suggestion: "remove-from-always-include" | "remove-from-index" | "investigate";
}
