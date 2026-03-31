import * as fs from "node:fs";
import * as path from "node:path";
import { CliError } from "@dev-session/security";
import type { ProjectInfo, ProjectTypeValue } from "../schemas/index.js";
import { DetectedTool, ProjectType } from "../schemas/index.js";

/** Files and directories that indicate a specific AI tool is in use. */
const TOOL_INDICATORS = {
	claude: ["CLAUDE.md", ".claude"],
	opencode: ["AGENTS.md", "opencode.json"],
	cursor: [".cursor", ".cursor/rules"],
} as const;

/** Notable files to scan for in the project root. */
const NOTABLE_FILES = [
	"PLAN.md",
	"docs/PLAN.md",
	"CLAUDE.md",
	"AGENTS.md",
	"package.json",
	".git",
	".session",
] as const;

/** Vite config file names. */
const VITE_CONFIGS = ["vite.config.ts", "vite.config.js"] as const;

/** Next.js config file names. */
const NEXT_CONFIGS = ["next.config.ts", "next.config.js", "next.config.mjs"] as const;

/**
 * Checks whether a file or directory exists at the given path.
 *
 * @param fullPath - Absolute path to check.
 * @returns `true` if the path exists on disk.
 */
function exists(fullPath: string): boolean {
	return fs.existsSync(fullPath);
}

/**
 * Checks whether any of the given file names exist in the target directory.
 *
 * @param cwd - The directory to scan.
 * @param fileNames - An array of relative file/directory names to look for.
 * @returns `true` if at least one of the file names exists.
 */
function anyExists(cwd: string, fileNames: readonly string[]): boolean {
	return fileNames.some((name) => exists(path.join(cwd, name)));
}

/**
 * Detects which AI coding tool is configured in the project directory.
 *
 * @param cwd - The directory to scan for tool indicators.
 * @returns The detected tool identifier.
 */
function detectTool(cwd: string): "claude" | "opencode" | "cursor" | "unknown" {
	if (anyExists(cwd, TOOL_INDICATORS.claude)) {
		return DetectedTool.CLAUDE;
	}
	if (anyExists(cwd, TOOL_INDICATORS.opencode)) {
		return DetectedTool.OPENCODE;
	}
	if (anyExists(cwd, TOOL_INDICATORS.cursor)) {
		return DetectedTool.CURSOR;
	}
	return DetectedTool.UNKNOWN;
}

/**
 * Collects a list of notable files that exist in the project root.
 *
 * @param cwd - The directory to scan.
 * @returns An array of relative paths for files that were found.
 */
function collectExistingFiles(cwd: string): string[] {
	const found: string[] = [];
	for (const file of NOTABLE_FILES) {
		if (exists(path.join(cwd, file))) {
			found.push(file);
		}
	}
	return found;
}

/**
 * Safely reads and parses the project name from `package.json`.
 *
 * @param cwd - The directory containing the `package.json`.
 * @returns The project name string, or `undefined` if not readable or not present.
 */
function readProjectName(cwd: string): string | undefined {
	const pkgPath = path.join(cwd, "package.json");
	if (!exists(pkgPath)) {
		return undefined;
	}

	try {
		const raw: unknown = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
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
 * Detects the project environment — AI tool, framework type, notable files,
 * and session state — for a given working directory.
 *
 * Designed as a one-time synchronous scan at startup. All filesystem access
 * uses `fs.existsSync` / `fs.readFileSync` because detection is not on the
 * hot path.
 */
export const ProjectDetector = {
	/**
	 * Scans the given directory and returns a complete {@link ProjectInfo} snapshot.
	 *
	 * @param cwd - Absolute path to the project root directory.
	 * @returns A {@link ProjectInfo} object describing the detected environment.
	 * @throws {CliError} If `cwd` does not exist or is not a directory.
	 */
	detect(cwd: string): ProjectInfo {
		assertDirectory(cwd);

		const tool = detectTool(cwd);
		const projectType = ProjectDetector.getProjectType(cwd);
		const existingFiles = collectExistingFiles(cwd);
		const hasSession = ProjectDetector.hasExistingSession(cwd);
		const projectName = readProjectName(cwd);

		const info: ProjectInfo = {
			tool,
			project_type: projectType,
			existing_files: existingFiles,
			project_root: cwd,
			has_existing_session: hasSession,
		};

		if (projectName !== undefined) {
			info.project_name = projectName;
		}

		return info;
	},

	/**
	 * Checks whether a `.session/` directory already exists in the project.
	 *
	 * @param cwd - Absolute path to the project root directory.
	 * @returns `true` if a `.session/` directory exists.
	 */
	hasExistingSession(cwd: string): boolean {
		return exists(path.join(cwd, ".session"));
	},

	/**
	 * Determines the project framework type by checking for known config files.
	 *
	 * Detection order: Vite > Next.js > Node (package.json) > unknown.
	 *
	 * @param cwd - Absolute path to the project root directory.
	 * @returns The detected {@link ProjectTypeValue}.
	 */
	getProjectType(cwd: string): ProjectTypeValue {
		if (anyExists(cwd, VITE_CONFIGS)) {
			return ProjectType.VITE;
		}
		if (anyExists(cwd, NEXT_CONFIGS)) {
			return ProjectType.NEXT;
		}
		if (exists(path.join(cwd, "package.json"))) {
			return ProjectType.NODE;
		}
		return ProjectType.UNKNOWN;
	},
} as const;

/**
 * Validates that the given path is an existing directory.
 *
 * @param cwd - The path to validate.
 * @throws {CliError} If the path does not exist or is not a directory.
 */
function assertDirectory(cwd: string): void {
	if (!exists(cwd)) {
		throw new CliError({
			message: `Directory does not exist: ${path.relative(process.cwd(), cwd) || "."}`,
			suggestion: "Check the path and try again.",
		});
	}

	try {
		const stat = fs.statSync(cwd);
		if (!stat.isDirectory()) {
			throw new CliError({
				message: `Path is not a directory: ${path.relative(process.cwd(), cwd) || "."}`,
				suggestion: "Provide a directory path, not a file.",
			});
		}
	} catch (error: unknown) {
		if (error instanceof CliError) {
			throw error;
		}
		throw new CliError({
			message: `Unable to read path: ${path.relative(process.cwd(), cwd) || "."}`,
			suggestion: "Check file permissions and try again.",
			cause: error,
		});
	}
}
