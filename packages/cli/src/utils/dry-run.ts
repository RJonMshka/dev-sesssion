/**
 * Dry-run file write proxy.
 *
 * When `--dry-run` is active, replaces actual file writes with log output
 * showing what would be written. All methods mirror the AtomicWriter API
 * but only log — no filesystem changes.
 *
 * @module
 */

import path from "node:path";
import { log } from "@clack/prompts";

/** Prefix every dry-run line shares, so the output is greppable and uniform. */
const DRY_RUN_PREFIX = "[dry-run] Would write:";

/**
 * Log what a file write would produce without actually writing.
 *
 * @param filePath - The target file path
 * @param content - The content that would be written
 * @param cwd - The working directory (for relative path display)
 */
export function dryRunWrite(filePath: string, content: string, cwd: string): void {
	const relative = path.relative(cwd, filePath);
	const lines = content.split("\n").length;
	const bytes = Buffer.byteLength(content, "utf-8");

	log.info(`${DRY_RUN_PREFIX} ${relative} (${lines} lines, ${bytes} bytes)`);
}

/**
 * Log a write that will be skipped, for callers that never materialize the
 * content — a manager that serializes internally, or an append-only log.
 *
 * @param filePath - The target file path
 * @param cwd - The working directory (for relative path display)
 * @param detail - Optional parenthetical describing the change
 */
export function dryRunSkipWrite(filePath: string, cwd: string, detail?: string): void {
	const relative = path.relative(cwd, filePath);
	const suffix = detail === undefined ? "" : ` (${detail})`;

	log.info(`${DRY_RUN_PREFIX} ${relative}${suffix}`);
}

/**
 * Log what a directory creation would produce without actually creating.
 *
 * @param dirPath - The target directory path
 * @param cwd - The working directory (for relative path display)
 */
export function dryRunMkdir(dirPath: string, cwd: string): void {
	const relative = path.relative(cwd, dirPath);
	log.info(`[dry-run] Would create directory: ${relative}`);
}

/**
 * Log what a .gitignore patch would produce without actually patching.
 *
 * @param filePath - The .gitignore file path
 * @param entries - Lines that would be appended
 * @param cwd - The working directory (for relative path display)
 */
export function dryRunGitignorePatch(
	filePath: string,
	entries: readonly string[],
	cwd: string,
): void {
	const relative = path.relative(cwd, filePath);
	log.info(`[dry-run] Would append to ${relative}:`);
	for (const entry of entries) {
		log.message(`  ${entry}`);
	}
}
