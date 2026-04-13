/**
 * Manager for reading and writing `.session/trim-overrides.json`.
 *
 * Trim overrides record files the user has excluded from the bootstrap
 * context for the current session. They are cleared on `dev-session advance`.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, ParseError } from "@dev-session/security";
import type { TrimOverrideEntry, TrimOverrides } from "../schemas/trim-overrides.js";
import { TRIM_OVERRIDES_FILENAME, TrimOverridesSchema } from "../schemas/trim-overrides.js";

// ---------------------------------------------------------------------------
// TrimOverridesManager
// ---------------------------------------------------------------------------

/**
 * Reads, writes, and manages `.session/trim-overrides.json`.
 */
export const TrimOverridesManager = {
	/**
	 * Loads trim overrides from disk.
	 *
	 * Returns `null` if the file does not exist (i.e., no overrides set yet).
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @returns Parsed {@link TrimOverrides} or `null` if not found.
	 * @throws {ParseError} If the file exists but is malformed.
	 */
	load(sessionDir: ValidatedPath): TrimOverrides | null {
		const filePath = path.join(sessionDir, TRIM_OVERRIDES_FILENAME);

		if (!fs.existsSync(filePath)) {
			return null;
		}

		let raw: string;
		try {
			raw = fs.readFileSync(filePath, "utf-8");
		} catch (cause: unknown) {
			throw new CliError({
				message: "Failed to read trim-overrides.json",
				suggestion: "Check that .session/trim-overrides.json has read permissions.",
				cause,
			});
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new ParseError({
				message: "trim-overrides.json is not valid JSON — delete it to reset",
				file: "trim-overrides.json",
			});
		}

		const result = TrimOverridesSchema.safeParse(parsed);
		if (!result.success) {
			throw new ParseError({
				message: "trim-overrides.json has an unexpected structure — delete it to reset",
				file: "trim-overrides.json",
				cause: result.error,
			});
		}

		return result.data;
	},

	/**
	 * Saves trim overrides to disk atomically.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param overrides - The overrides to write.
	 */
	save(sessionDir: ValidatedPath, overrides: TrimOverrides): void {
		const filePath = path.join(sessionDir, TRIM_OVERRIDES_FILENAME) as ValidatedPath;
		AtomicWriter.writeFile(filePath, JSON.stringify(overrides, null, 2));
	},

	/**
	 * Deletes the trim-overrides.json file if it exists.
	 *
	 * Called by `dev-session advance` to reset overrides for the new chunk.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 */
	clear(sessionDir: ValidatedPath): void {
		const filePath = path.join(sessionDir, TRIM_OVERRIDES_FILENAME);
		if (fs.existsSync(filePath)) {
			fs.unlinkSync(filePath);
		}
	},

	/**
	 * Adds a file exclusion to the overrides, creating the file if needed.
	 *
	 * Idempotent — adding the same filepath twice does not create a duplicate.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param sessionId - The current session ID.
	 * @param filepath - The file path (relative to project root) to exclude.
	 * @param reason - Optional human-readable reason for the exclusion.
	 * @returns The updated {@link TrimOverrides}.
	 */
	addExclusion(
		sessionDir: ValidatedPath,
		sessionId: string,
		filepath: string,
		reason?: string,
	): TrimOverrides {
		const existing = this.load(sessionDir);
		const now = new Date().toISOString();

		let overrides: TrimOverrides;
		if (existing === null) {
			overrides = {
				session_id: sessionId,
				created_at: now,
				updated_at: now,
				excluded_files: [],
			};
		} else {
			overrides = { ...existing, updated_at: now };
		}

		const alreadyExcluded = overrides.excluded_files.some((e) => e.filepath === filepath);
		if (alreadyExcluded) {
			return overrides;
		}

		const entry: TrimOverrideEntry = {
			filepath,
			excluded_at: now,
			...(reason !== undefined ? { reason } : {}),
		};

		overrides = {
			...overrides,
			excluded_files: [...overrides.excluded_files, entry],
		};

		this.save(sessionDir, overrides);
		return overrides;
	},

	/**
	 * Removes a file exclusion from the overrides.
	 *
	 * @param sessionDir - Validated path to the `.session/` directory.
	 * @param filepath - The file path to re-include.
	 * @returns The updated {@link TrimOverrides}, or `null` if no overrides existed.
	 */
	removeExclusion(sessionDir: ValidatedPath, filepath: string): TrimOverrides | null {
		const existing = this.load(sessionDir);
		if (existing === null) {
			return null;
		}

		const updated: TrimOverrides = {
			...existing,
			updated_at: new Date().toISOString(),
			excluded_files: existing.excluded_files.filter((e) => e.filepath !== filepath),
		};

		this.save(sessionDir, updated);
		return updated;
	},

	/**
	 * Checks whether a given filepath is currently excluded.
	 *
	 * @param overrides - The loaded overrides (or `null` if none exist).
	 * @param filepath - The file path to check.
	 * @returns `true` if the file is excluded.
	 */
	isExcluded(overrides: TrimOverrides | null, filepath: string): boolean {
		if (overrides === null) {
			return false;
		}
		return overrides.excluded_files.some((e) => e.filepath === filepath);
	},

	/**
	 * Returns all currently excluded file paths as a plain string array.
	 *
	 * @param overrides - The loaded overrides (or `null`).
	 * @returns Array of excluded file paths.
	 */
	getExcludedPaths(overrides: TrimOverrides | null): readonly string[] {
		if (overrides === null) {
			return [];
		}
		return overrides.excluded_files.map((e) => e.filepath);
	},
} as const;
