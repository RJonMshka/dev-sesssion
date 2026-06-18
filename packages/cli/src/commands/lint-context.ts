/**
 * `dev-sesssion lint-context` command.
 *
 * Static analysis of session context files — finds duplicate blocks,
 * soft/hedging language, and dead `@mention` references.
 *
 * Exits with code 1 if any `error`-severity findings are produced.
 * No `ANTHROPIC_API_KEY` required — fully local analysis.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import {
	ContextLinter,
	FileIndexManager,
	type LintResult,
	SessionStateManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the lint-context action. */
export interface LintContextOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Show verbose output (include info-severity findings). */
	readonly verbose: boolean;
	/** Output machine-readable JSON. */
	readonly json: boolean;
}

/** JSON output structure for --json flag. */
export interface LintContextJson {
	readonly findings: ReadonlyArray<{
		severity: string;
		rule: string;
		file: string;
		line?: number;
		message: string;
	}>;
	readonly summary: {
		errors: number;
		warnings: number;
		infos: number;
		total: number;
	};
	readonly passed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads file content safely, returning empty string on error.
 *
 * @param filePath - Absolute path to read.
 * @returns File content or empty string.
 */
function safeReadFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Returns a terminal color code for a severity level (for text output).
 *
 * @param severity - The lint severity.
 * @returns ANSI escape string.
 */
function severityLabel(severity: "error" | "warning" | "info"): string {
	switch (severity) {
		case "error":
			return "ERROR  ";
		case "warning":
			return "WARN   ";
		case "info":
			return "INFO   ";
	}
}

/**
 * Formats a single lint result as a human-readable line.
 *
 * @param result - The lint finding.
 * @returns Formatted string.
 */
function formatLintResult(result: LintResult): string {
	const loc = result.line !== undefined ? `:${String(result.line)}` : "";
	return `[${severityLabel(result.severity)}] ${result.file}${loc}  ${result.message}`;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Executes the lint-context command.
 *
 * @param options - Resolved CLI options.
 * @throws CliError if no session is found.
 */
export async function runLintContext(options: LintContextOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	const state = SessionStateManager.load(sessionDir);
	const allEntries = FileIndexManager.load(sessionDir);
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	const chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	// Collect all files to analyze
	const targetFiles = [...alwaysInclude, ...chunkFiles];

	if (targetFiles.length === 0) {
		log.info("No files in context to lint.");
		return;
	}

	// Read all file contents
	const fileContents: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const entry of targetFiles) {
		const absolutePath = path.join(options.cwd, entry.filepath);
		const content = safeReadFile(absolutePath);
		if (content.length > 0) {
			fileContents[entry.filepath] = content;
		}
	}

	const allResults: LintResult[] = [];

	// Pass 1: duplicate detection across all files
	const duplicates = ContextLinter.detectDuplicates(fileContents);
	allResults.push(...duplicates);

	// Pass 2 & 3: per-file soft language + dead references
	for (const [filepath, content] of Object.entries(fileContents)) {
		const softLanguage = ContextLinter.detectSoftLanguage(filepath, content);
		allResults.push(...softLanguage);

		const deadRefs = ContextLinter.detectDeadReferences(filepath, content, options.cwd);
		allResults.push(...deadRefs);
	}

	// Count by severity
	const errors = allResults.filter((r) => r.severity === "error").length;
	const warnings = allResults.filter((r) => r.severity === "warning").length;
	const infos = allResults.filter((r) => r.severity === "info").length;
	const passed = errors === 0;

	// ------------------------------------------------------------------
	// JSON output
	// ------------------------------------------------------------------
	if (options.json) {
		const output: LintContextJson = {
			findings: allResults,
			summary: { errors, warnings, infos, total: allResults.length },
			passed,
		};
		process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
		if (!passed) {
			process.exit(1);
		}
		return;
	}

	// ------------------------------------------------------------------
	// Text output
	// ------------------------------------------------------------------
	log.info(`Linting ${String(Object.keys(fileContents).length)} context file(s)…`);

	// Filter based on verbosity
	const toShow = options.verbose
		? allResults
		: allResults.filter((r) => r.severity === "error" || r.severity === "warning");

	if (toShow.length === 0) {
		if (errors === 0 && warnings === 0) {
			log.success("No issues found.");
		} else {
			log.success(`No errors or warnings. (${String(infos)} info findings hidden — use --verbose)`);
		}
	} else {
		for (const result of toShow) {
			if (result.severity === "error") {
				log.error(formatLintResult(result));
			} else if (result.severity === "warning") {
				log.warn(formatLintResult(result));
			} else {
				log.info(formatLintResult(result));
			}
		}
	}

	// Summary
	const parts: string[] = [];
	if (errors > 0) {
		parts.push(`${String(errors)} error(s)`);
	}
	if (warnings > 0) {
		parts.push(`${String(warnings)} warning(s)`);
	}
	if (infos > 0) {
		parts.push(`${String(infos)} info`);
	}
	if (parts.length > 0) {
		log.info(`Summary: ${parts.join(", ")}`);
	}

	if (!passed) {
		process.exit(1);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the .session/ directory path.
 *
 * @param cwd - Working directory
 * @returns ValidatedPath to .session/
 * @throws CliError if .session/ does not exist
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	const sessionDir = path.join(cwd, ".session");

	if (!fs.existsSync(sessionDir)) {
		throw new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `dev-sesssion init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `lint-context` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerLintContextCommand(program: Command): void {
	program
		.command("lint-context")
		.description(
			"Static analysis of context files: duplicate blocks, soft language, dead @mentions",
		)
		.option("--json", "Output machine-readable JSON", false)
		.action(async (cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				verbose: boolean;
			}>();

			const lintOptions: LintContextOptions = {
				cwd: opts.cwd,
				verbose: opts.verbose,
				json: cmdOptions.json ?? false,
			};

			try {
				await runLintContext(lintOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
