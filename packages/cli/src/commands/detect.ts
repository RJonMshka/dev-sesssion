/**
 * Detection phase for `dev-session init`.
 *
 * Runs automatic, prompt-free detection of the project environment:
 * existing PLAN.md (with line/heading/chunk stats), CLAUDE.md / AGENTS.md
 * for adapter setup, package.json for the project name, and .session/
 * for reinitialize detection.
 *
 * All functions are synchronous (filesystem reads on startup are not
 * performance-critical). Business logic lives in @dev-session/core —
 * this module adds CLI-specific reporting on top.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectInfo } from "@dev-session/core";
import { PlanParser } from "@dev-session/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Statistics about an existing PLAN.md file. */
export interface PlanDetectionResult {
	/** Whether a PLAN.md file was found (root or docs/). */
	readonly found: boolean;
	/** Relative path from project root (e.g. "PLAN.md" or "docs/PLAN.md"). */
	readonly relativePath: string | undefined;
	/** Total line count of the file. */
	readonly lineCount: number;
	/** Number of h2 headings (potential chunk boundaries). */
	readonly headingCount: number;
	/** Estimated number of chunks based on boundary detection. */
	readonly estimatedChunks: number;
}

/** Information about detected tool-specific files (CLAUDE.md, AGENTS.md). */
export interface ToolFileDetectionResult {
	/** Whether CLAUDE.md exists. */
	readonly hasClaude: boolean;
	/** Whether AGENTS.md exists. */
	readonly hasAgents: boolean;
	/** The detected tool from ProjectDetector (claude | opencode | cursor | unknown). */
	readonly detectedTool: string;
}

/** Information from package.json (if present). */
export interface PackageDetectionResult {
	/** Whether package.json exists. */
	readonly found: boolean;
	/** The project name from package.json, or undefined. */
	readonly projectName: string | undefined;
}

/** Information about an existing .session/ directory. */
export interface SessionDetectionResult {
	/** Whether .session/ already exists. */
	readonly exists: boolean;
}

/** Aggregated detection results for the entire project. */
export interface DetectionResult {
	/** PLAN.md detection. */
	readonly plan: PlanDetectionResult;
	/** Tool file detection (CLAUDE.md, AGENTS.md). */
	readonly toolFiles: ToolFileDetectionResult;
	/** package.json detection. */
	readonly packageJson: PackageDetectionResult;
	/** Existing .session/ detection. */
	readonly session: SessionDetectionResult;
}

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

/** Possible PLAN.md locations, checked in order. */
const PLAN_PATHS = ["PLAN.md", "docs/PLAN.md"] as const;

/**
 * Detect an existing PLAN.md file and compute statistics.
 *
 * Checks both `PLAN.md` (root) and `docs/PLAN.md`. If found, reads
 * the file and uses {@link PlanParser.detectBoundaries} to count
 * h2 headings and estimate chunk count.
 *
 * @param cwd - Absolute path to the project root.
 * @returns Plan detection result with line count, heading count, and estimated chunks.
 */
export function detectPlanFile(cwd: string): PlanDetectionResult {
	for (const relativePath of PLAN_PATHS) {
		const fullPath = path.join(cwd, relativePath);

		if (!fs.existsSync(fullPath)) {
			continue;
		}

		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf-8");
		} catch {
			// Unreadable — treat as not found
			continue;
		}

		const lineCount = content.split("\n").length;

		let headingCount = 0;
		let estimatedChunks = 0;

		try {
			const boundaries = PlanParser.detectBoundaries(content);
			// Count only high-confidence boundaries (h2 headings, confidence >= 1.0)
			headingCount = boundaries.filter((b) => b.confidence >= 1.0).length;
			// Estimated chunks = number of h2 boundaries (each becomes a chunk)
			estimatedChunks = headingCount;
		} catch {
			// ParseError (empty file, etc.) — report what we can
		}

		return {
			found: true,
			relativePath,
			lineCount,
			headingCount,
			estimatedChunks,
		};
	}

	return {
		found: false,
		relativePath: undefined,
		lineCount: 0,
		headingCount: 0,
		estimatedChunks: 0,
	};
}

/**
 * Detect tool-specific files (CLAUDE.md, AGENTS.md).
 *
 * Uses the already-detected tool from {@link ProjectInfo} and supplements
 * it with explicit file existence checks for adapter setup notes.
 *
 * @param cwd - Absolute path to the project root.
 * @param projectInfo - The already-detected project info from ProjectDetector.
 * @returns Tool file detection result.
 */
export function detectToolFiles(cwd: string, projectInfo: ProjectInfo): ToolFileDetectionResult {
	return {
		hasClaude: fs.existsSync(path.join(cwd, "CLAUDE.md")),
		hasAgents: fs.existsSync(path.join(cwd, "AGENTS.md")),
		detectedTool: projectInfo.tool,
	};
}

/**
 * Detect package.json and extract the project name.
 *
 * @param projectInfo - The already-detected project info (contains project_name).
 * @returns Package detection result.
 */
export function detectPackageJson(projectInfo: ProjectInfo): PackageDetectionResult {
	const hasPackageJson = projectInfo.existing_files.includes("package.json");

	return {
		found: hasPackageJson,
		projectName: projectInfo.project_name,
	};
}

/**
 * Detect whether a .session/ directory already exists.
 *
 * @param projectInfo - The already-detected project info.
 * @returns Session detection result.
 */
export function detectExistingSession(projectInfo: ProjectInfo): SessionDetectionResult {
	return {
		exists: projectInfo.has_existing_session,
	};
}

/**
 * Run the full detection phase.
 *
 * Aggregates results from all detection functions into a single
 * {@link DetectionResult}. This is the main entry point called by
 * the init command.
 *
 * @param cwd - Absolute path to the project root.
 * @param projectInfo - The already-detected project info from ProjectDetector.
 * @returns Aggregated detection results.
 */
export function runDetection(cwd: string, projectInfo: ProjectInfo): DetectionResult {
	return {
		plan: detectPlanFile(cwd),
		toolFiles: detectToolFiles(cwd, projectInfo),
		packageJson: detectPackageJson(projectInfo),
		session: detectExistingSession(projectInfo),
	};
}
