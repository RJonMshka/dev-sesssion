/**
 * Monorepo detection for `dev-session migrate`.
 *
 * Detects workspace configuration files (pnpm-workspace.yaml, nx.json,
 * turbo.json, package.json workspaces) and resolves the list of workspace
 * packages in the project.
 *
 * Only handles simple glob patterns of the form `dir/*` — this covers the
 * vast majority of real-world monorepo layouts without adding a glob library
 * dependency.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported monorepo tool types. */
export type MonorepoType = "pnpm" | "nx" | "turborepo" | "npm" | "yarn" | "none";

/** A resolved workspace package directory. */
export interface WorkspacePackage {
	/** Relative path from project root (e.g. "packages/core"). */
	readonly relativePath: string;
	/** Absolute path to the package directory. */
	readonly absolutePath: string;
	/** Package name from package.json, or undefined if absent. */
	readonly name: string | undefined;
}

/** Result of monorepo detection. */
export interface MonorepoInfo {
	/** Whether this directory is the root of a monorepo. */
	readonly isMonorepo: boolean;
	/** The primary monorepo tooling detected. */
	readonly type: MonorepoType;
	/** Resolved workspace package directories. */
	readonly packages: readonly WorkspacePackage[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects monorepo workspace configuration and resolves member packages.
 */
export const MonorepoDetector = {
	/**
	 * Scan a directory for monorepo workspace configuration.
	 *
	 * Detection order: pnpm-workspace.yaml → nx.json → turbo.json →
	 * package.json (npm/yarn workspaces) → none.
	 *
	 * @param cwd - Absolute path to the project root.
	 * @returns MonorepoInfo describing the detected workspace layout.
	 */
	detect(cwd: string): MonorepoInfo {
		// pnpm
		const pnpmWorkspace = path.join(cwd, "pnpm-workspace.yaml");
		if (fs.existsSync(pnpmWorkspace)) {
			const { include, exclude } = parsePnpmWorkspaceYaml(readFile(pnpmWorkspace));
			const packages = resolvePackages(cwd, include, exclude);
			return { isMonorepo: true, type: "pnpm", packages };
		}

		// nx (may still use package.json workspaces for the actual packages)
		if (fs.existsSync(path.join(cwd, "nx.json"))) {
			const patterns = readPackageJsonWorkspaces(cwd) ?? [];
			const packages = resolvePackages(cwd, patterns, []);
			return { isMonorepo: true, type: "nx", packages };
		}

		// turborepo
		if (
			fs.existsSync(path.join(cwd, "turbo.json")) ||
			fs.existsSync(path.join(cwd, "turbo.config.js")) ||
			fs.existsSync(path.join(cwd, "turbo.config.ts"))
		) {
			const patterns = readPackageJsonWorkspaces(cwd) ?? [];
			const packages = resolvePackages(cwd, patterns, []);
			return { isMonorepo: true, type: "turborepo", packages };
		}

		// npm / yarn — package.json workspaces field
		const wsPatterns = readPackageJsonWorkspaces(cwd);
		if (wsPatterns !== undefined && wsPatterns.length > 0) {
			const type = detectNpmYarn(cwd);
			const packages = resolvePackages(cwd, wsPatterns, []);
			return { isMonorepo: true, type, packages };
		}

		return { isMonorepo: false, type: "none", packages: [] };
	},

	/**
	 * Returns true if the directory contains any supported workspace config.
	 *
	 * This is a lightweight check — it only tests for file existence, without
	 * parsing contents or resolving packages.
	 *
	 * @param cwd - Absolute path to the project root.
	 * @returns true if a monorepo workspace file is present.
	 */
	isMonorepoRoot(cwd: string): boolean {
		if (fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))) {
			return true;
		}
		if (fs.existsSync(path.join(cwd, "nx.json"))) {
			return true;
		}
		if (
			fs.existsSync(path.join(cwd, "turbo.json")) ||
			fs.existsSync(path.join(cwd, "turbo.config.js")) ||
			fs.existsSync(path.join(cwd, "turbo.config.ts"))
		) {
			return true;
		}
		return (readPackageJsonWorkspaces(cwd)?.length ?? 0) > 0;
	},
} as const;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parsed result from pnpm-workspace.yaml. */
interface PnpmWorkspacePatterns {
	/** Positive glob patterns (directories to include). */
	readonly include: string[];
	/** Negation patterns (directories to exclude), with the leading `!` stripped. */
	readonly exclude: string[];
}

/**
 * Parse workspace glob patterns from a pnpm-workspace.yaml file.
 *
 * Handles the standard YAML list format under a top-level `packages:` key.
 * Negation patterns (starting with `!`) are returned separately so the
 * resolver can filter them out after expansion.
 *
 * @param content - Raw file content.
 * @returns Include and exclude pattern lists.
 */
function parsePnpmWorkspaceYaml(content: string): PnpmWorkspacePatterns {
	const include: string[] = [];
	const exclude: string[] = [];
	let inPackages = false;

	for (const line of content.split("\n")) {
		const trimmed = line.trimEnd();

		if (/^packages\s*:/.test(trimmed)) {
			inPackages = true;
			continue;
		}

		if (inPackages) {
			// List item under packages:
			if (/^\s+-\s/.test(trimmed)) {
				let value = trimmed.replace(/^\s+-\s+/, "").trim();
				// Strip surrounding quotes
				if (
					(value.startsWith("'") && value.endsWith("'")) ||
					(value.startsWith('"') && value.endsWith('"'))
				) {
					value = value.slice(1, -1);
				}
				if (value.startsWith("!")) {
					exclude.push(value.slice(1));
				} else {
					include.push(value);
				}
			} else if (trimmed && !/^\s/.test(trimmed) && !trimmed.startsWith("#")) {
				// New top-level YAML key — leave the packages section
				inPackages = false;
			}
		}
	}

	return { include, exclude };
}

/**
 * Read workspace glob patterns from package.json's `workspaces` field.
 *
 * Supports both the plain array format (npm) and the `{ packages: [...] }`
 * nested format (Yarn 1).
 *
 * @param cwd - Project root directory.
 * @returns Array of glob patterns, or undefined if none found.
 */
function readPackageJsonWorkspaces(cwd: string): string[] | undefined {
	const pkgPath = path.join(cwd, "package.json");
	if (!fs.existsSync(pkgPath)) {
		return undefined;
	}

	try {
		const raw: unknown = JSON.parse(readFile(pkgPath));
		if (typeof raw !== "object" || raw === null) {
			return undefined;
		}
		const record = raw as Record<string, unknown>;
		const workspaces: unknown = record.workspaces;

		if (Array.isArray(workspaces)) {
			return workspaces.filter((w): w is string => typeof w === "string");
		}

		// Yarn 1 nested: { packages: [...], nohoist: [...] }
		if (typeof workspaces === "object" && workspaces !== null) {
			const ws = workspaces as Record<string, unknown>;
			const packages: unknown = ws.packages;
			if (Array.isArray(packages)) {
				return packages.filter((p): p is string => typeof p === "string");
			}
		}
	} catch {
		// Malformed package.json — treat as no workspaces
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Package resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a list of glob patterns to concrete workspace package directories.
 *
 * Only handles simple `dir/*` and literal directory patterns. Complex
 * patterns with `**` or multiple wildcards are skipped.
 *
 * @param cwd - Project root directory.
 * @param patterns - Workspace glob patterns (positive).
 * @param excludePatterns - Negation patterns to filter out after expansion.
 * @returns Array of resolved workspace packages.
 */
function resolvePackages(
	cwd: string,
	patterns: string[],
	excludePatterns: string[],
): WorkspacePackage[] {
	// Expand exclusions to concrete relative paths for fast lookup
	const excluded = new Set<string>();
	for (const pattern of excludePatterns) {
		for (const rel of expandPattern(cwd, pattern)) {
			excluded.add(rel);
		}
	}

	const seen = new Set<string>();
	const packages: WorkspacePackage[] = [];

	for (const pattern of patterns) {
		for (const rel of expandPattern(cwd, pattern)) {
			if (seen.has(rel) || excluded.has(rel)) {
				continue;
			}
			seen.add(rel);

			const absolutePath = path.join(cwd, rel);
			packages.push({
				relativePath: rel,
				absolutePath,
				name: readPackageName(absolutePath),
			});
		}
	}

	return packages;
}

/**
 * Expand a single workspace glob pattern to relative directory paths.
 *
 * Supports:
 * - Literal directories: `packages/core` → `["packages/core"]`
 * - Single-level wildcard: `packages/*` → lists all subdirs of `packages/`
 *
 * @param cwd - Project root directory.
 * @param pattern - Glob pattern to expand.
 * @returns Array of matching relative paths (forward-slash separated).
 */
function expandPattern(cwd: string, pattern: string): string[] {
	if (!pattern.includes("*") && !pattern.includes("?")) {
		// Literal path
		const abs = path.join(cwd, pattern);
		if (isDirectory(abs)) {
			return [normalizeSlashes(pattern)];
		}
		return [];
	}

	const parts = pattern.split("/");
	const wildcardIdx = parts.findIndex((p) => p.includes("*") || p.includes("?"));

	// Only handle the simple `dir/*` case (wildcard is the last segment and is `*`)
	if (wildcardIdx !== parts.length - 1 || parts[wildcardIdx] !== "*") {
		return [];
	}

	const parentRel = parts.slice(0, wildcardIdx).join("/");
	const parentAbs = parentRel ? path.join(cwd, parentRel) : cwd;

	if (!isDirectory(parentAbs)) {
		return [];
	}

	try {
		const entries = fs.readdirSync(parentAbs, { withFileTypes: true });
		return entries
			.filter((e) => e.isDirectory() && !e.name.startsWith("."))
			.map((e) => normalizeSlashes(parentRel ? `${parentRel}/${e.name}` : e.name));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Detect whether npm or yarn is used based on lockfile presence.
 *
 * @param cwd - Project root.
 * @returns "yarn" if yarn.lock exists, otherwise "npm".
 */
function detectNpmYarn(cwd: string): "npm" | "yarn" {
	return fs.existsSync(path.join(cwd, "yarn.lock")) ? "yarn" : "npm";
}

/**
 * Read the `name` field from a package's package.json.
 *
 * @param packageDir - Absolute path to the package directory.
 * @returns Package name string or undefined.
 */
function readPackageName(packageDir: string): string | undefined {
	const pkgPath = path.join(packageDir, "package.json");
	if (!fs.existsSync(pkgPath)) {
		return undefined;
	}
	try {
		const raw: unknown = JSON.parse(readFile(pkgPath));
		if (typeof raw !== "object" || raw === null) {
			return undefined;
		}
		const record = raw as Record<string, unknown>;
		const name: unknown = record.name;
		return typeof name === "string" ? name : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read a file's content as UTF-8 string. Returns empty string on error.
 *
 * @param filePath - Absolute path to the file.
 * @returns File content string.
 */
function readFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Return true if the path exists and is a directory.
 *
 * @param absPath - Absolute path to check.
 * @returns true if the path is a directory.
 */
function isDirectory(absPath: string): boolean {
	try {
		return fs.statSync(absPath).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Normalize path separators to forward slashes.
 *
 * @param p - Path string.
 * @returns Path with backslashes replaced by forward slashes.
 */
function normalizeSlashes(p: string): string {
	return p.replace(/\\/g, "/");
}
