/**
 * Manages CONTEXT_LOG.md — the append-only session memory log.
 *
 * Records what files were loaded and modified in each dev-sesssion session.
 * Used for analytics (`memory stats`), staleness detection (`memory stale`),
 * and historical browsing (`memory show`).
 *
 * CONTEXT_LOG.md lives in `.session/` and is always gitignored (personal data).
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, ParseError } from "@dev-session/security";

import type { ContextLogEntry, ContextLogStats, StalenessReport } from "../schemas/context-log.js";
import { CONTEXT_LOG_FILENAME, ContextLogSchema } from "../schemas/context-log.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Manages reading, writing, and analyzing CONTEXT_LOG.md.
 */
export const SessionMemoryManager = {
	/**
	 * Loads all entries from CONTEXT_LOG.md.
	 *
	 * Returns an empty array if the file does not exist (first run).
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @returns Array of parsed context log entries, ordered oldest-first.
	 * @throws {ParseError} If the file exists but cannot be parsed.
	 */
	load(sessionDir: ValidatedPath): ContextLogEntry[] {
		const filePath = resolveLogPath(sessionDir);
		if (!fs.existsSync(filePath)) {
			return [];
		}
		const raw = readRaw(filePath);
		return parseLog(raw);
	},

	/**
	 * Appends a new entry to CONTEXT_LOG.md.
	 *
	 * Idempotent: if an entry with the same `session_id` and `timestamp` already
	 * exists, the call is a no-op. Entries are always appended at the end so the
	 * log is ordered oldest-first.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param entry - The new entry to append.
	 * @throws {ParseError} If the existing log is malformed.
	 */
	append(sessionDir: ValidatedPath, entry: ContextLogEntry): void {
		const existing = SessionMemoryManager.load(sessionDir);

		// Idempotency: skip if same session_id + timestamp already present
		const isDuplicate = existing.some(
			(e) => e.session_id === entry.session_id && e.timestamp === entry.timestamp,
		);
		if (isDuplicate) return;

		const updated = [...existing, entry];
		writeLog(sessionDir, updated);
	},

	/**
	 * Computes aggregate statistics from a set of log entries.
	 *
	 * @param entries - The entries to analyze (may be a filtered subset).
	 * @returns Aggregate statistics, with null date fields when entries is empty.
	 */
	summarizeStats(entries: readonly ContextLogEntry[]): ContextLogStats {
		if (entries.length === 0) {
			return {
				totalSessions: 0,
				firstDate: null,
				lastDate: null,
				avgTokens: 0,
				topFiles: [],
			};
		}

		const timestamps = entries.map((e) => e.timestamp).sort();
		const firstTimestamp = timestamps[0] as string;
		const lastTimestamp = timestamps[timestamps.length - 1] as string;

		const totalTokens = entries.reduce((sum, e) => sum + e.total_tokens, 0);
		const avgTokens = Math.round(totalTokens / entries.length);

		const fileCounts = new Map<string, number>();
		for (const entry of entries) {
			for (const f of entry.files_loaded) {
				fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
			}
		}

		const topFiles = [...fileCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([filePath, count]) => ({ path: filePath, count }));

		return {
			totalSessions: entries.length,
			firstDate: firstTimestamp.slice(0, 10),
			lastDate: lastTimestamp.slice(0, 10),
			avgTokens,
			topFiles,
		};
	},

	/**
	 * Identifies files that are loaded frequently but never modified.
	 *
	 * A file qualifies as a "passive load" if it appears in `files_loaded`
	 * across at least `threshold` sessions but never appears in any
	 * `modifications` list.
	 *
	 * @param entries - All log entries to analyze.
	 * @param alwaysIncludePaths - Paths tagged "always include" in FILE_INDEX.
	 * @param threshold - Minimum sessions a file must appear in to be reported (default 3).
	 * @returns Staleness reports for always-include files that are never modified.
	 */
	detectPassiveLoads(
		entries: readonly ContextLogEntry[],
		alwaysIncludePaths: readonly string[],
		threshold = 3,
	): StalenessReport[] {
		const loadCounts = new Map<string, number>();
		const modifiedFiles = new Set<string>();
		const lastModifiedMap = new Map<string, string>();

		for (const entry of entries) {
			for (const f of entry.files_loaded) {
				loadCounts.set(f, (loadCounts.get(f) ?? 0) + 1);
			}
			for (const f of entry.modifications) {
				modifiedFiles.add(f);
				// Track last modification timestamp
				const existing = lastModifiedMap.get(f);
				if (existing === undefined || entry.timestamp > existing) {
					lastModifiedMap.set(f, entry.timestamp);
				}
			}
		}

		const alwaysIncludeSet = new Set(alwaysIncludePaths);
		const reports: StalenessReport[] = [];

		for (const [filePath, count] of loadCounts) {
			if (count < threshold) continue;
			if (!alwaysIncludeSet.has(filePath)) continue;
			if (modifiedFiles.has(filePath)) continue;

			reports.push({
				path: filePath,
				sessionCount: count,
				lastModified: lastModifiedMap.get(filePath) ?? null,
				suggestion: "remove-from-always-include",
			});
		}

		return reports.sort((a, b) => b.sessionCount - a.sessionCount);
	},

	/**
	 * Identifies files in the index that appear stale across recent sessions.
	 *
	 * A file is stale if it was loaded in at least `threshold` sessions but
	 * never appears in `modifications`. Files in `alwaysIncludePaths` that
	 * pass this check get `"remove-from-always-include"`; others get
	 * `"remove-from-index"` or `"investigate"`.
	 *
	 * @param entries - All log entries to analyze.
	 * @param indexedPaths - All file paths currently in FILE_INDEX.
	 * @param alwaysIncludePaths - Paths tagged "always include" in FILE_INDEX.
	 * @param threshold - Minimum sessions for a file to be flagged (default 3).
	 * @returns Staleness reports sorted by session count descending.
	 */
	analyzeStaleness(
		entries: readonly ContextLogEntry[],
		indexedPaths: readonly string[],
		alwaysIncludePaths: readonly string[],
		threshold = 3,
	): StalenessReport[] {
		const loadCounts = new Map<string, number>();
		const modifiedFiles = new Set<string>();
		const lastModifiedMap = new Map<string, string>();

		for (const entry of entries) {
			for (const f of entry.files_loaded) {
				loadCounts.set(f, (loadCounts.get(f) ?? 0) + 1);
			}
			for (const f of entry.modifications) {
				modifiedFiles.add(f);
				const existing = lastModifiedMap.get(f);
				if (existing === undefined || entry.timestamp > existing) {
					lastModifiedMap.set(f, entry.timestamp);
				}
			}
		}

		const alwaysIncludeSet = new Set(alwaysIncludePaths);
		const indexedSet = new Set(indexedPaths);
		const reports: StalenessReport[] = [];

		for (const [filePath, count] of loadCounts) {
			if (count < threshold) continue;
			if (modifiedFiles.has(filePath)) continue;
			if (!indexedSet.has(filePath)) continue;

			let suggestion: StalenessReport["suggestion"];
			if (alwaysIncludeSet.has(filePath)) {
				suggestion = "remove-from-always-include";
			} else {
				// Loaded frequently but never touched — likely stale context weight
				suggestion = "remove-from-index";
			}

			reports.push({
				path: filePath,
				sessionCount: count,
				lastModified: lastModifiedMap.get(filePath) ?? null,
				suggestion,
			});
		}

		// Also flag indexed files that are never loaded at all (investigate)
		for (const filePath of indexedPaths) {
			if (!loadCounts.has(filePath) && entries.length >= threshold) {
				reports.push({
					path: filePath,
					sessionCount: 0,
					lastModified: null,
					suggestion: "investigate",
				});
			}
		}

		return reports.sort((a, b) => b.sessionCount - a.sessionCount);
	},

	/**
	 * Removes entries older than a given cutoff date.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param olderThan - ISO date string (entries with timestamp before this are removed).
	 * @returns The number of entries removed.
	 * @throws {ParseError} If the existing log is malformed.
	 */
	prune(sessionDir: ValidatedPath, olderThan: string): number {
		const existing = SessionMemoryManager.load(sessionDir);
		const kept = existing.filter((e) => e.timestamp >= olderThan);
		const removed = existing.length - kept.length;

		if (removed > 0) {
			writeLog(sessionDir, kept);
		}

		return removed;
	},

	/**
	 * Parses a duration string (e.g. `"30d"`, `"3mo"`, `"1y"`) into an ISO cutoff date.
	 *
	 * @param duration - A duration string: `<N>d` (days), `<N>mo` (months), `<N>y` (years).
	 * @param from - The reference date (defaults to today).
	 * @returns ISO date string for the cutoff.
	 * @throws {ParseError} If the duration string is invalid.
	 */
	parseDuration(duration: string, from?: Date): string {
		const ref = from ?? new Date();
		const date = new Date(ref);

		const match = /^(\d+)(d|mo|y)$/.exec(duration.trim());
		if (match === null) {
			throw new ParseError({
				message: `Invalid duration "${duration}" — expected format: <N>d, <N>mo, or <N>y`,
				file: CONTEXT_LOG_FILENAME,
			});
		}

		const amount = Number.parseInt(match[1] as string, 10);
		const unit = match[2] as "d" | "mo" | "y";

		switch (unit) {
			case "d":
				date.setDate(date.getDate() - amount);
				break;
			case "mo":
				date.setMonth(date.getMonth() - amount);
				break;
			case "y":
				date.setFullYear(date.getFullYear() - amount);
				break;
		}

		return date.toISOString().slice(0, 10);
	},
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to CONTEXT_LOG.md.
 *
 * @param sessionDir - Validated .session/ path.
 * @returns Absolute path string.
 */
function resolveLogPath(sessionDir: string): string {
	return path.join(sessionDir, CONTEXT_LOG_FILENAME);
}

/**
 * Reads raw file content from CONTEXT_LOG.md.
 *
 * @param filePath - Absolute path to the file.
 * @returns Raw file content.
 * @throws {ParseError} If the file cannot be read.
 */
function readRaw(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch (cause: unknown) {
		throw new ParseError({
			message: "Cannot read CONTEXT_LOG.md",
			file: CONTEXT_LOG_FILENAME,
			cause,
		});
	}
}

/**
 * Parses the YAML-formatted CONTEXT_LOG.md content into entries.
 *
 * The file stores entries as a YAML list under a `entries:` key,
 * written as a plain YAML document (no frontmatter delimiters needed).
 *
 * @param raw - Raw file content.
 * @returns Parsed entries array.
 * @throws {ParseError} If parsing or validation fails.
 */
function parseLog(raw: string): ContextLogEntry[] {
	// Support empty file
	const trimmed = raw.trim();
	if (trimmed === "" || trimmed === "entries: []") {
		return [];
	}

	try {
		// Parse as simple YAML manually — entries are stored as a JSON-compatible
		// structure serialized by writeLog() below, so we can use JSON.parse on
		// the embedded JSON block.
		const match = /^entries:\s*(\[[\s\S]*\])$/m.exec(trimmed);
		if (match === null) {
			// Try to parse as a full entries object
			const jsonMatch = /^\{[\s\S]*\}$/.exec(trimmed);
			if (jsonMatch !== null) {
				const parsed: unknown = JSON.parse(trimmed);
				const result = ContextLogSchema.safeParse(parsed);
				if (result.success) {
					return result.data.entries;
				}
			}
			// Try direct JSON array
			if (trimmed.startsWith("[")) {
				const parsed: unknown = JSON.parse(trimmed);
				const result = ContextLogSchema.safeParse({ entries: parsed });
				if (result.success) {
					return result.data.entries;
				}
			}
			throw new ParseError({
				message: "CONTEXT_LOG.md has unexpected format — expected `entries: [...]`",
				file: CONTEXT_LOG_FILENAME,
			});
		}

		const jsonStr = match[1] as string;
		const parsed: unknown = JSON.parse(jsonStr);
		const result = ContextLogSchema.safeParse({ entries: parsed });

		if (!result.success) {
			throw new ParseError({
				message: `CONTEXT_LOG.md schema validation failed: ${result.error.message}`,
				file: CONTEXT_LOG_FILENAME,
			});
		}

		return result.data.entries;
	} catch (cause: unknown) {
		if (cause instanceof ParseError) throw cause;
		throw new ParseError({
			message: "Failed to parse CONTEXT_LOG.md",
			file: CONTEXT_LOG_FILENAME,
			cause,
		});
	}
}

/**
 * Serializes entries and writes them atomically to CONTEXT_LOG.md.
 *
 * @param sessionDir - Validated .session/ path.
 * @param entries - The entries to persist.
 */
function writeLog(sessionDir: ValidatedPath, entries: readonly ContextLogEntry[]): void {
	const filePath = path.join(sessionDir, CONTEXT_LOG_FILENAME) as ValidatedPath;
	const json = JSON.stringify(entries, null, 2);
	const content = `entries: ${json}\n`;
	AtomicWriter.writeFile(filePath, content);
}
