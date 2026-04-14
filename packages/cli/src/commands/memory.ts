/**
 * `dev-session memory` subcommand group.
 *
 * Provides session history analytics: show recent sessions, aggregate stats,
 * staleness analysis, and log pruning.
 *
 * Subcommands:
 *   memory show   — formatted session history
 *   memory stats  — aggregate stats
 *   memory stale  — staleness analysis
 *   memory prune  — remove old entries
 *
 * Business logic lives in @dev-session/core — this module handles CLI output.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import { type ContextLogEntry, FileIndexManager, SessionMemoryManager } from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

/**
 * Options for `memory show`.
 */
export interface MemoryShowOptions {
	readonly cwd: string;
	readonly limit: number;
}

/**
 * Display recent context log entries.
 *
 * @param options - Resolved CLI options
 */
export async function runMemoryShow(options: MemoryShowOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);
	const entries = SessionMemoryManager.load(sessionDir);

	if (entries.length === 0) {
		log.info("No session memory entries yet. Run `dev-session update` to start recording.");
		return;
	}

	const recent = entries.slice(-options.limit).reverse();
	log.info(
		`Showing ${String(recent.length)} most recent session${recent.length === 1 ? "" : "s"} (${String(entries.length)} total)`,
	);

	for (const entry of recent) {
		const date = entry.timestamp.slice(0, 10);
		const time = entry.timestamp.slice(11, 16);
		const mods = entry.modifications.length;
		const files = entry.files_loaded.length;
		log.message(
			`  ${date} ${time}  chunk=${String(entry.active_chunk)}  tokens=${String(entry.total_tokens)}  files=${String(files)}  mods=${String(mods)}`,
		);
		if (entry.modifications.length > 0) {
			for (const f of entry.modifications.slice(0, 3)) {
				log.message(`    ✎ ${f}`);
			}
			if (entry.modifications.length > 3) {
				log.message(`    … ${String(entry.modifications.length - 3)} more`);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

/**
 * Options for `memory stats`.
 */
export interface MemoryStatsOptions {
	readonly cwd: string;
	readonly json: boolean;
}

/**
 * Display aggregate stats from the context log.
 *
 * @param options - Resolved CLI options
 */
export async function runMemoryStats(options: MemoryStatsOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);
	const entries = SessionMemoryManager.load(sessionDir);
	const stats = SessionMemoryManager.summarizeStats(entries);

	if (options.json) {
		process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
		return;
	}

	if (stats.totalSessions === 0) {
		log.info("No session memory entries yet. Run `dev-session update` to start recording.");
		return;
	}

	log.info(`Session memory stats`);
	log.message(`  Total sessions : ${String(stats.totalSessions)}`);
	log.message(`  Date range     : ${stats.firstDate ?? "?"} → ${stats.lastDate ?? "?"}`);
	log.message(`  Avg tokens     : ~${String(stats.avgTokens)}`);

	if (stats.topFiles.length > 0) {
		log.message("  Top loaded files:");
		for (const { path: filePath, count } of stats.topFiles) {
			log.message(`    ${String(count).padStart(3)}×  ${filePath}`);
		}
	}
}

// ---------------------------------------------------------------------------
// stale
// ---------------------------------------------------------------------------

/**
 * Options for `memory stale`.
 */
export interface MemoryStaleOptions {
	readonly cwd: string;
	readonly threshold: number;
}

/**
 * Display staleness report for indexed files.
 *
 * @param options - Resolved CLI options
 */
export async function runMemoryStale(options: MemoryStaleOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);
	const entries = SessionMemoryManager.load(sessionDir);

	if (entries.length === 0) {
		log.info("No session memory entries yet — staleness analysis requires recorded sessions.");
		return;
	}

	const allIndexEntries = FileIndexManager.load(sessionDir);
	const alwaysInclude = FileIndexManager.alwaysInclude(allIndexEntries);
	const indexedPaths = allIndexEntries.map((e) => e.filepath);
	const alwaysIncludePaths = alwaysInclude.map((e) => e.filepath);

	const reports = SessionMemoryManager.analyzeStaleness(
		entries,
		indexedPaths,
		alwaysIncludePaths,
		options.threshold,
	);

	const passive = SessionMemoryManager.detectPassiveLoads(
		entries,
		alwaysIncludePaths,
		options.threshold,
	);

	// Merge, deduplicate by path (analyzeStaleness takes precedence)
	const seen = new Set(reports.map((r) => r.path));
	const merged = [...reports, ...passive.filter((r) => !seen.has(r.path))];

	if (merged.length === 0) {
		log.success(
			`No stale files detected (threshold: ${String(options.threshold)} sessions, ${String(entries.length)} recorded).`,
		);
		return;
	}

	log.info(
		`Staleness report — ${String(merged.length)} file${merged.length === 1 ? "" : "s"} flagged (threshold: ${String(options.threshold)})`,
	);

	for (const report of merged) {
		const sessions =
			report.sessionCount === 0 ? "never loaded" : `${String(report.sessionCount)} sessions`;
		const mod =
			report.lastModified !== null ? `last modified ${report.lastModified}` : "never modified";
		log.message(`  [${report.suggestion}]  ${report.path}`);
		log.message(`    ${sessions}, ${mod}`);
	}
}

// ---------------------------------------------------------------------------
// prune
// ---------------------------------------------------------------------------

/**
 * Options for `memory prune`.
 */
export interface MemoryPruneOptions {
	readonly cwd: string;
	readonly olderThan: string;
	readonly dryRun: boolean;
}

/**
 * Remove context log entries older than a given duration.
 *
 * @param options - Resolved CLI options
 */
export async function runMemoryPrune(options: MemoryPruneOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	const cutoff = SessionMemoryManager.parseDuration(options.olderThan);

	if (options.dryRun) {
		const entries = SessionMemoryManager.load(sessionDir);
		const toRemove = entries.filter((e) => e.timestamp < cutoff);
		log.info(
			`[dry-run] Would remove ${String(toRemove.length)} entr${toRemove.length === 1 ? "y" : "ies"} older than ${options.olderThan} (before ${cutoff})`,
		);
		return;
	}

	const removed = SessionMemoryManager.prune(sessionDir, cutoff);
	log.success(
		`Removed ${String(removed)} entr${removed === 1 ? "y" : "ies"} older than ${options.olderThan} (before ${cutoff})`,
	);
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

/**
 * Register the `memory` command group on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerMemoryCommand(program: Command): void {
	const memory = program
		.command("memory")
		.description("Session memory analytics — show history, stats, staleness, and pruning");

	// memory show
	memory
		.command("show")
		.description("Display recent session history from CONTEXT_LOG.md")
		.option("-n, --limit <number>", "Number of recent entries to show", "10")
		.action(async (cmdOptions: { limit?: string }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				await runMemoryShow({
					cwd: opts.cwd,
					limit: Number.parseInt(cmdOptions.limit ?? "10", 10),
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});

	// memory stats
	memory
		.command("stats")
		.description("Show aggregate stats from session memory")
		.option("--json", "Output machine-readable JSON", false)
		.action(async (cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				await runMemoryStats({
					cwd: opts.cwd,
					json: cmdOptions.json ?? false,
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});

	// memory stale
	memory
		.command("stale")
		.description("Identify stale files that are loaded but never modified")
		.option("--threshold <number>", "Minimum sessions to flag a file as stale", "3")
		.action(async (cmdOptions: { threshold?: string }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				await runMemoryStale({
					cwd: opts.cwd,
					threshold: Number.parseInt(cmdOptions.threshold ?? "3", 10),
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});

	// memory prune
	memory
		.command("prune")
		.description("Remove log entries older than a given duration (e.g. 30d, 3mo, 1y)")
		.requiredOption("--older-than <duration>", "Remove entries older than this duration")
		.action(async (cmdOptions: { olderThan?: string }) => {
			// --dry-run is a global root flag; read from program.opts()
			const opts = program.opts<{ cwd: string; dryRun?: boolean }>();
			try {
				await runMemoryPrune({
					cwd: opts.cwd,
					olderThan: cmdOptions.olderThan ?? "30d",
					dryRun: opts.dryRun ?? false,
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});
}

// ---------------------------------------------------------------------------
// Internal helpers
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
			suggestion: "Run `dev-session init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// Re-export for test access
export type { ContextLogEntry };
