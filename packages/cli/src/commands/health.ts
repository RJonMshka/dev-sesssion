/**
 * `dev-session health` command.
 *
 * Audits the full `.session/` directory and reports issues at three
 * severity levels: ERROR, WARNING, INFO. With `--fix`, automatically
 * remediates fixable issues (currently: removing stale FILE_INDEX entries).
 *
 * Business logic (HealthChecker) lives in `@dev-session/core`.
 * This module handles CLI display and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { confirm, intro, isCancel, log, outro, spinner } from "@clack/prompts";
import {
	type FileIndexEntry,
	FileIndexManager,
	HealthChecker,
	type HealthReport,
	HealthSeverity,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";

import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the health command. */
export interface HealthOptions {
	/** Working directory (project root). */
	readonly cwd: string;
	/** Automatically fix fixable issues. */
	readonly fix: boolean;
	/** Skip confirmation prompts. */
	readonly yes: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Output machine-readable JSON. */
	readonly json: boolean;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

/**
 * Execute the health command.
 *
 * @param options - Resolved CLI options
 * @throws {CliError} if .session/ is not found
 */
export async function runHealth(options: HealthOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	if (!options.json) {
		intro("dev-session health");
	}

	const s = spinner();
	if (!options.json) s.start("Auditing session...");

	const report = HealthChecker.audit(sessionDir);

	if (!options.json) {
		s.stop(
			report.healthy
				? `All ${String(report.checksRun)} checks passed.`
				: `Audit complete — ${String(report.errorCount)} error${report.errorCount === 1 ? "" : "s"}, ${String(report.warningCount)} warning${report.warningCount === 1 ? "" : "s"}.`,
		);
	}

	if (options.json) {
		const jsonOutput = buildJsonOutput(report);
		process.stdout.write(`${JSON.stringify(jsonOutput, null, 2)}\n`);
		return;
	}

	displayReport(report, options.verbose);

	if (options.fix && report.issues.some((i) => i.fixable)) {
		await applyFixes(sessionDir, report, options);
	} else if (!report.healthy) {
		if (report.issues.some((i) => i.fixable)) {
			log.info("Run `dev-session health --fix` to auto-remediate fixable issues.");
		}
		outro("Health check complete.");
		throw new CliError({
			message: `Session unhealthy: ${String(report.errorCount)} error${report.errorCount === 1 ? "" : "s"}, ${String(report.warningCount)} warning${report.warningCount === 1 ? "" : "s"}`,
		});
	} else {
		outro("Session is healthy.");
	}
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Display the health report to the terminal.
 *
 * @param report - The health report to display
 * @param verbose - Whether to show verbose output
 */
function displayReport(report: HealthReport, verbose: boolean): void {
	if (report.healthy) {
		log.success(`Session is healthy. ${String(report.checksRun)} checks passed, no issues found.`);
		return;
	}

	for (const issue of report.issues) {
		const prefix = `[${issue.code}]${issue.fixable ? " (fixable)" : ""}`;
		switch (issue.severity) {
			case HealthSeverity.ERROR:
				log.error(`${prefix} ${issue.message}`);
				break;
			case HealthSeverity.WARNING:
				log.warn(`${prefix} ${issue.message}`);
				break;
			case HealthSeverity.INFO:
				log.info(`${prefix} ${issue.message}`);
				break;
		}
	}

	if (verbose) {
		log.info(
			`Checks run: ${String(report.checksRun)} | Errors: ${String(report.errorCount)} | Warnings: ${String(report.warningCount)} | Info: ${String(report.infoCount)}`,
		);
	}
}

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

/**
 * Apply auto-fixes for fixable issues.
 *
 * Currently handles:
 * - `STALE_INDEX_ENTRIES`: removes stale FILE_INDEX entries after confirmation
 *
 * @param sessionDir - Validated path to .session/
 * @param report - The health report
 * @param options - CLI options (for --yes and verbosity)
 */
async function applyFixes(
	sessionDir: ValidatedPath,
	report: HealthReport,
	options: HealthOptions,
): Promise<void> {
	let fixCount = 0;

	if (report.staleEntries.length > 0) {
		fixCount += await fixStaleEntries(sessionDir, report.staleEntries, options);
	}

	if (fixCount > 0) {
		outro(`Fixed ${String(fixCount)} issue${fixCount === 1 ? "" : "s"}.`);
	} else {
		outro("No fixes applied.");
	}
}

/**
 * Remove stale FILE_INDEX entries with optional confirmation.
 *
 * @param sessionDir - Validated path to .session/
 * @param staleEntries - The stale entries to remove
 * @param options - CLI options
 * @returns Number of fixes applied (0 or 1)
 */
async function fixStaleEntries(
	sessionDir: ValidatedPath,
	staleEntries: readonly FileIndexEntry[],
	options: HealthOptions,
): Promise<number> {
	let shouldFix: boolean;

	if (options.yes) {
		shouldFix = true;
	} else {
		const result = await confirm({
			message: `Remove ${String(staleEntries.length)} stale FILE_INDEX entr${staleEntries.length === 1 ? "y" : "ies"}?`,
		});
		shouldFix = !isCancel(result) && result === true;
	}

	if (!shouldFix) return 0;

	const allEntries = FileIndexManager.load(sessionDir);
	const staleSet = new Set(staleEntries.map((e) => e.filepath));
	const cleaned = allEntries.filter((e) => !staleSet.has(e.filepath));
	FileIndexManager.save(sessionDir, cleaned);

	log.success(
		`Removed ${String(staleEntries.length)} stale entr${staleEntries.length === 1 ? "y" : "ies"} from FILE_INDEX.md.`,
	);
	return 1;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

/**
 * Build a JSON-serializable health output object.
 *
 * @param report - The health report
 * @returns Plain object suitable for JSON.stringify
 */
function buildJsonOutput(report: HealthReport): Record<string, unknown> {
	return {
		healthy: report.healthy,
		checks_run: report.checksRun,
		error_count: report.errorCount,
		warning_count: report.warningCount,
		info_count: report.infoCount,
		issues: report.issues.map((i) => ({
			severity: i.severity,
			code: i.code,
			message: i.message,
			fixable: i.fixable,
		})),
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the .session/ directory path.
 *
 * @param cwd - Working directory
 * @returns ValidatedPath to .session/
 * @throws {CliError} if .session/ does not exist
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	const sessionDir = path.join(cwd, ".session");

	if (!fs.existsSync(sessionDir)) {
		throw new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `dev-session init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// ---------------------------------------------------------------------------
// Commander registration
// ---------------------------------------------------------------------------

/**
 * Register the `health` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerHealthCommand(program: Command): void {
	program
		.command("health")
		.description("Audit session health and optionally auto-fix issues")
		.option("--fix", "Auto-remediate fixable issues (stale index entries, etc.)", false)
		.option("--json", "Output machine-readable JSON", false)
		.action(async (cmdOptions: { fix?: boolean; json?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
			}>();

			const healthOptions: HealthOptions = {
				cwd: opts.cwd,
				fix: cmdOptions.fix ?? false,
				yes: opts.yes,
				verbose: opts.verbose,
				json: cmdOptions.json ?? false,
			};

			try {
				await runHealth(healthOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
