/**
 * Walks a directory tree while respecting `.gitignore` patterns.
 *
 * Uses Node's built-in `fs.readdirSync` with `{ recursive: true }` (Node 20+)
 * instead of external glob libraries to minimize dependencies.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { CliError } from "@dev-session/security";
import type { TokenCounterInstance } from "../counters/token-counter.js";
import { TokenCounter } from "../counters/token-counter.js";
import type {
	DirectoryGroup,
	TokenCountResult,
	WalkedFile,
	WalkOptions,
} from "../schemas/index.js";

/** Directories that are always ignored regardless of .gitignore. */
const ALWAYS_IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".session"]);

/**
 * Reads and parses a `.gitignore` file into an array of non-empty, non-comment patterns.
 *
 * @param root - The project root directory containing the `.gitignore`.
 * @returns An array of gitignore pattern strings.
 */
function readGitignorePatterns(root: string): readonly string[] {
	const gitignorePath = path.join(root, ".gitignore");
	try {
		const content = fs.readFileSync(gitignorePath, "utf-8");
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
	} catch {
		return [];
	}
}

/**
 * Checks whether a relative file path matches any of the gitignore patterns.
 *
 * Uses simple string matching for common patterns:
 * - `dir/` → path starts with `dir/` or contains `/dir/`
 * - `*.ext` → path ends with `.ext`
 * - Literal names → exact segment match
 *
 * @param relativePath - The relative file path to check.
 * @param patterns - The gitignore patterns to match against.
 * @returns `true` if the path should be ignored.
 */
function matchesGitignore(relativePath: string, patterns: readonly string[]): boolean {
	for (const pattern of patterns) {
		if (matchesSinglePattern(relativePath, pattern)) {
			return true;
		}
	}
	return false;
}

/**
 * Checks whether a relative path matches a single gitignore pattern.
 *
 * @param relativePath - The relative file path.
 * @param pattern - A single gitignore pattern.
 * @returns `true` if the path matches the pattern.
 */
function matchesSinglePattern(relativePath: string, pattern: string): boolean {
	// Negation patterns — skip them in v1
	if (pattern.startsWith("!")) {
		return false;
	}

	// Directory pattern (ends with /)
	if (pattern.endsWith("/")) {
		const dir = pattern.slice(0, -1);
		return (
			relativePath.startsWith(`${dir}/`) ||
			relativePath.includes(`/${dir}/`) ||
			relativePath === dir
		);
	}

	// Extension wildcard (e.g., *.log)
	if (pattern.startsWith("*.")) {
		const ext = pattern.slice(1); // includes the dot
		return relativePath.endsWith(ext);
	}

	// Wildcard prefix with extension (e.g., **/*.ext)
	if (pattern.startsWith("**/")) {
		const subPattern = pattern.slice(3);
		if (subPattern.startsWith("*.")) {
			const ext = subPattern.slice(1);
			return relativePath.endsWith(ext);
		}
		return relativePath === subPattern || relativePath.endsWith(`/${subPattern}`);
	}

	// Literal match — could be a file or directory name
	const segments = relativePath.split("/");
	return segments.includes(pattern);
}

/**
 * Checks whether a relative path has any segment in the always-ignored set.
 *
 * @param relativePath - The relative path to check.
 * @returns `true` if any segment is in the always-ignored list.
 */
function isAlwaysIgnored(relativePath: string): boolean {
	const segments = relativePath.split(path.sep);
	return segments.some((seg) => ALWAYS_IGNORED_DIRS.has(seg));
}

/**
 * Checks whether a file path has a depth within the allowed max.
 *
 * @param relativePath - The relative file path.
 * @param maxDepth - The maximum allowed depth (undefined = no limit).
 * @returns `true` if the path is within the depth limit.
 */
function isWithinDepth(relativePath: string, maxDepth: number | undefined): boolean {
	if (maxDepth === undefined) {
		return true;
	}
	const depth = relativePath.split(path.sep).length;
	return depth <= maxDepth;
}

/**
 * Checks whether a file has an allowed extension.
 *
 * @param relativePath - The relative file path.
 * @param extensions - Allowed extensions (empty = all allowed).
 * @returns `true` if the file extension is allowed.
 */
function hasAllowedExtension(
	relativePath: string,
	extensions: readonly string[] | undefined,
): boolean {
	if (extensions === undefined || extensions.length === 0) {
		return true;
	}
	const ext = path.extname(relativePath);
	return extensions.includes(ext);
}

/**
 * Walks a directory tree respecting `.gitignore` and built-in ignore rules.
 *
 * Groups files by directory, estimates token costs, and supports filtering
 * by depth, extension, and custom ignore patterns.
 */
export const GitignoreAwareWalker = {
	/**
	 * Walks the directory tree starting from `root`.
	 *
	 * @param root - The absolute path to the project root.
	 * @param options - Optional walk configuration.
	 * @returns An array of discovered files, sorted by relative path.
	 * @throws {CliError} If the root directory does not exist.
	 */
	walk(root: string, options?: WalkOptions): WalkedFile[] {
		assertDirectoryExists(root);

		const gitignorePatterns = readGitignorePatterns(root);
		const extraIgnore = options?.ignore ?? [];
		const allIgnorePatterns = [...gitignorePatterns, ...extraIgnore];

		const entries = readDirectoryEntries(root);
		const files: WalkedFile[] = [];

		for (const entry of entries) {
			const parentDir = getDirentParentPath(entry);
			const entryPath = path.join(parentDir, entry.name);
			const relativePath = path.relative(root, entryPath).split(path.sep).join("/");

			if (!entry.isFile()) {
				continue;
			}

			if (isAlwaysIgnored(relativePath)) {
				continue;
			}

			if (matchesGitignore(relativePath, allIgnorePatterns)) {
				continue;
			}

			if (!isWithinDepth(relativePath, options?.maxDepth)) {
				continue;
			}

			if (!hasAllowedExtension(relativePath, options?.extensions)) {
				continue;
			}

			const sizeBytes = getFileSize(entryPath);
			files.push({
				relativePath,
				absolutePath: entryPath,
				sizeBytes,
			});
		}

		files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
		return files;
	},

	/**
	 * Groups files by their parent directory.
	 *
	 * @param files - The files to group.
	 * @returns An array of directory groups, sorted by directory path.
	 */
	groupByDirectory(files: readonly WalkedFile[]): DirectoryGroup[] {
		const groupMap = new Map<string, WalkedFile[]>();

		for (const file of files) {
			const dir = path.dirname(file.relativePath);
			let group = groupMap.get(dir);
			if (group === undefined) {
				group = [];
				groupMap.set(dir, group);
			}
			group.push(file);
		}

		const groups: DirectoryGroup[] = [];
		for (const [directory, dirFiles] of groupMap) {
			const totalSizeBytes = dirFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
			groups.push({ directory, files: dirFiles, totalSizeBytes });
		}

		groups.sort((a, b) => a.directory.localeCompare(b.directory));
		return groups;
	},

	/**
	 * Estimates the token cost for a file based on its size.
	 *
	 * Uses the heuristic of ~1 token per 4 bytes (for English text / code).
	 * Delegates to {@link TokenCounter.heuristicCountFromBytes} for the actual
	 * calculation so the heuristic constant is defined in one place.
	 *
	 * @param file - The file to estimate.
	 * @returns The estimated number of tokens.
	 */
	estimateTokenCost(file: WalkedFile): number {
		return TokenCounter.heuristicCountFromBytes(file.sizeBytes);
	},

	/**
	 * Measures token cost for a file using a {@link TokenCounterInstance}.
	 *
	 * When an external (accurate) counter is configured on the instance,
	 * this returns real tokenizer counts. Otherwise falls back to the
	 * character-based heuristic. The result includes an `accurate` flag
	 * so consumers know whether to trust the number.
	 *
	 * @param file - The walked file to measure.
	 * @param counter - A token counter instance (from {@link TokenCounter.create}).
	 * @returns A promise resolving to a {@link TokenCountResult}.
	 */
	async measureTokenCost(
		file: WalkedFile,
		counter: TokenCounterInstance,
	): Promise<TokenCountResult> {
		if (!counter.hasExternalCounter) {
			// Fast path: skip file read, use byte-based heuristic
			return {
				tokens: TokenCounter.heuristicCountFromBytes(file.sizeBytes),
				accurate: false,
			};
		}
		// External counter needs the file content — delegate to countFile
		// We cast absolutePath since walker already resolved it from the filesystem
		const filePath = file.absolutePath as import("@dev-session/security").ValidatedPath;
		return counter.countFile(filePath);
	},
} as const;

/**
 * Extracts the parent directory path from a Dirent entry.
 *
 * Node 21+ uses `parentPath`, older Node 20 uses `path`.
 *
 * @param entry - The directory entry.
 * @returns The parent directory path.
 */
function getDirentParentPath(entry: fs.Dirent): string {
	// Node 21+ has parentPath, Node 20 has path on Dirent
	const dirent = entry as unknown as Record<string, unknown>;
	const parentPath = dirent.parentPath ?? dirent.path;
	if (typeof parentPath === "string") {
		return parentPath;
	}
	return "";
}

/**
 * Asserts that the root directory exists.
 *
 * @param root - The directory path to check.
 * @throws {CliError} If the directory does not exist.
 */
function assertDirectoryExists(root: string): void {
	if (!fs.existsSync(root)) {
		throw new CliError({
			message: `Directory does not exist: ${path.relative(process.cwd(), root) || "."}`,
			suggestion: "Check the path and try again.",
		});
	}
}

/**
 * Reads all entries from a directory recursively.
 *
 * @param root - The directory to read.
 * @returns An array of directory entries.
 */
function readDirectoryEntries(root: string): fs.Dirent[] {
	try {
		return fs.readdirSync(root, {
			withFileTypes: true,
			recursive: true,
		});
	} catch (cause: unknown) {
		throw new CliError({
			message: `Failed to read directory: ${path.relative(process.cwd(), root) || "."}`,
			suggestion: "Check file permissions.",
			cause,
		});
	}
}

/**
 * Gets the size of a file in bytes, returning 0 if the stat fails.
 *
 * @param filePath - The absolute path to the file.
 * @returns The file size in bytes.
 */
function getFileSize(filePath: string): number {
	try {
		const stat = fs.statSync(filePath);
		return stat.size;
	} catch {
		return 0;
	}
}
