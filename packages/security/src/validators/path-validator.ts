import * as fs from "node:fs";
import * as path from "node:path";

import { SecurityError } from "../errors/security-error.js";
import { SecurityThreat } from "../errors/security-threat.js";

/**
 * A branded type representing a filesystem path that has been validated
 * to be within the allowed project root boundary.
 *
 * Functions that perform filesystem operations should accept `ValidatedPath`
 * instead of `string` to enforce that all paths have been security-checked.
 */
export type ValidatedPath = string & { readonly __brand: unique symbol };

/** Characters that are never allowed in user-supplied paths. */
const NULL_BYTE = "\0";

/** Prototype pollution keys that should never appear as path segments. */
const DANGEROUS_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validates and resolves user-supplied file paths against a project root boundary.
 *
 * All external path inputs (CLI args, frontmatter, FILE_INDEX.md entries) must pass
 * through this validator before any filesystem operation.
 */
export const PathValidator = {
	/**
	 * Resolves a user-supplied path relative to `projectRoot` and verifies it
	 * stays within the root boundary.
	 *
	 * @param userPath - The untrusted path to validate (from CLI, config, or parsed files).
	 * @param projectRoot - The absolute path to the project root directory.
	 * @returns A `ValidatedPath` that is guaranteed to be within `projectRoot`.
	 * @throws {SecurityError} With `PATH_TRAVERSAL` threat if:
	 *   - The path contains null bytes
	 *   - The path is absolute (must be relative to projectRoot)
	 *   - The path contains dangerous prototype pollution segments
	 *   - The resolved path escapes the projectRoot boundary
	 */
	safeResolvePath(userPath: string, projectRoot: string): ValidatedPath {
		assertNoNullBytes(userPath);
		assertRelativePath(userPath);
		assertNoDangerousSegments(userPath);

		const resolvedRoot = resolveAndNormalizeRoot(projectRoot);
		const resolvedPath = path.resolve(resolvedRoot, userPath);

		assertWithinBoundary(resolvedPath, resolvedRoot, userPath);

		return resolvedPath as ValidatedPath;
	},

	/**
	 * Resolves a user-supplied path and additionally verifies it exists on
	 * the filesystem by resolving symlinks via `fs.realpathSync`.
	 *
	 * This catches symlink-based traversal attacks where a symlink inside the
	 * project root points to a location outside of it.
	 *
	 * @param userPath - The untrusted path to validate.
	 * @param projectRoot - The absolute path to the project root directory.
	 * @returns A `ValidatedPath` with all symlinks resolved, guaranteed within `projectRoot`.
	 * @throws {SecurityError} With `PATH_TRAVERSAL` threat if validation fails or symlink escapes boundary.
	 */
	safeResolveRealPath(userPath: string, projectRoot: string): ValidatedPath {
		// First do the basic validation
		const validated = PathValidator.safeResolvePath(userPath, projectRoot);

		// Then resolve symlinks and re-check boundary
		const resolvedRoot = resolveAndNormalizeRoot(projectRoot);
		let realPath: string;
		try {
			realPath = fs.realpathSync(validated);
		} catch {
			throw new SecurityError({
				threat: SecurityThreat.PATH_TRAVERSAL,
				message: `Path "${userPath}" does not exist or is not accessible`,
			});
		}

		assertWithinBoundary(realPath, resolvedRoot, userPath);

		return realPath as ValidatedPath;
	},
} as const;

/**
 * Asserts that a path contains no null bytes.
 *
 * @param userPath - The path to check.
 * @throws {SecurityError} If null bytes are found.
 */
function assertNoNullBytes(userPath: string): void {
	if (userPath.includes(NULL_BYTE)) {
		throw new SecurityError({
			threat: SecurityThreat.PATH_TRAVERSAL,
			message: "Path contains null bytes",
		});
	}
}

/**
 * Asserts that a path is relative (not absolute).
 *
 * @param userPath - The path to check.
 * @throws {SecurityError} If the path is absolute.
 */
function assertRelativePath(userPath: string): void {
	if (path.isAbsolute(userPath)) {
		throw new SecurityError({
			threat: SecurityThreat.PATH_TRAVERSAL,
			message: "Absolute paths are not allowed — use a path relative to the project root",
		});
	}
}

/**
 * Asserts that no path segment is a prototype pollution key.
 *
 * @param userPath - The path to check.
 * @throws {SecurityError} If a dangerous segment is found.
 */
function assertNoDangerousSegments(userPath: string): void {
	const segments = userPath.split(path.sep);
	for (const segment of segments) {
		if (DANGEROUS_SEGMENTS.has(segment)) {
			throw new SecurityError({
				threat: SecurityThreat.PATH_TRAVERSAL,
				message: `Path contains dangerous segment "${segment}"`,
			});
		}
	}
}

/**
 * Resolves the project root to an absolute, normalized path with a trailing separator.
 * The trailing separator prevents prefix attacks (e.g., `/project-evil` matching `/project`).
 *
 * @param projectRoot - The project root to normalize.
 * @returns The resolved root path (without trailing separator for `path.resolve` compat).
 */
function resolveAndNormalizeRoot(projectRoot: string): string {
	return path.resolve(projectRoot);
}

/**
 * Asserts that a resolved path is within the project root boundary.
 * Uses trailing separator to prevent prefix attacks.
 *
 * @param resolvedPath - The fully resolved path.
 * @param resolvedRoot - The resolved project root.
 * @param userPath - The original user-supplied path (for error messages).
 * @throws {SecurityError} If the path is outside the boundary.
 */
function assertWithinBoundary(resolvedPath: string, resolvedRoot: string, userPath: string): void {
	// The resolved path must either be exactly the root, or start with root + separator.
	// Appending separator to root prevents prefix attacks: /project vs /project-evil
	const rootWithSep = resolvedRoot + path.sep;
	if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSep)) {
		throw new SecurityError({
			threat: SecurityThreat.PATH_TRAVERSAL,
			message: `Path "${userPath}" resolves outside the project root`,
		});
	}
}
