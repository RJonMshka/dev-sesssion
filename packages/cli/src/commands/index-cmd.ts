/**
 * `dev-session index` commands: `add` and `audit`.
 *
 * - `add <filepath>` — validate and append a file to FILE_INDEX.md
 * - `audit` — detect stale entries and optionally auto-remove them
 *
 * Business logic lives in @dev-session/core — this module handles CLI
 * prompts, formatting, and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, isCancel, log, multiselect, text } from "@clack/prompts";
import {
	type AuditResult,
	type FileIndexEntry,
	FileIndexManager,
	PlanChunkManager,
	SessionStateManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the index add subcommand. */
export interface IndexAddOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** The file path to add. */
	readonly filepath: string;
	/** Skip prompts and use defaults. */
	readonly yes: boolean;
	/** Show detailed output. */
	readonly verbose: boolean;
}

/** Options for the index audit subcommand. */
export interface IndexAuditOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Automatically remove stale entries after confirmation. */
	readonly fix: boolean;
	/** Skip prompts (auto-confirm removals). */
	readonly yes: boolean;
	/** Show detailed output. */
	readonly verbose: boolean;
}

// ---------------------------------------------------------------------------
// Public API: add
// ---------------------------------------------------------------------------

/**
 * Add a file to FILE_INDEX.md.
 *
 * @param options - Resolved CLI options
 * @throws CliError if no session, file not found, or user cancels
 */
export async function runIndexAdd(options: IndexAddOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	// Validate the file path
	const absPath = path.resolve(options.cwd, options.filepath);
	if (!fs.existsSync(absPath)) {
		throw new CliError({
			message: `File not found: ${options.filepath}`,
			suggestion: "Check the path and try again.",
		});
	}

	// Validate it's within the project root
	PathValidator.safeResolvePath(options.filepath, options.cwd);

	const relativePath = path.relative(options.cwd, absPath);

	// Load current index
	const entries = FileIndexManager.load(sessionDir);

	// Check for duplicate
	const existing = entries.find((e) => e.filepath === relativePath);
	if (existing) {
		log.warn(`File already in index: ${relativePath}`);
		if (options.verbose) {
			log.info(`  Chunk tags: [${existing.chunk_tags.join(", ")}]`);
			log.info(`  Purpose: ${existing.purpose}`);
		}
		return;
	}

	// Prompt for chunk tags and purpose
	let chunkTags: number[];
	let purpose: string;

	if (options.yes) {
		// Default: tag to active chunk
		const state = SessionStateManager.load(sessionDir);
		chunkTags = [state.active_chunk];
		purpose = `Added via dev-session index add`;
	} else {
		// Load available chunks for selection
		const allChunks = PlanChunkManager.loadAll(sessionDir);
		const state = SessionStateManager.load(sessionDir);

		const chunkOptions = [
			{ value: "0", label: "Always include (chunk 0)" },
			...allChunks.map((c) => ({
				value: String(c.chunk_id),
				label: `Chunk ${String(c.chunk_id)} — ${c.title}`,
			})),
		];

		const chunkResult = await multiselect({
			message: `Which chunk(s) should ${relativePath} belong to?`,
			options: chunkOptions,
			required: true,
			initialValues: [String(state.active_chunk)],
		});

		if (isCancel(chunkResult)) {
			cancel("Index add cancelled.");
			throw new CliError({ message: "Index add cancelled by user." });
		}

		chunkTags = (chunkResult as string[]).map((v) => Number.parseInt(v, 10));

		const purposeResult = await text({
			message: "Purpose description:",
			validate: (v) => (!v || v.trim().length === 0 ? "Purpose is required" : undefined),
		});

		if (isCancel(purposeResult)) {
			cancel("Index add cancelled.");
			throw new CliError({ message: "Index add cancelled by user." });
		}

		purpose = purposeResult as string;
	}

	// Build entry and add
	const newEntry: FileIndexEntry = {
		filepath: relativePath,
		chunk_tags: chunkTags,
		purpose,
	};

	const updatedEntries = FileIndexManager.add(entries, newEntry);
	FileIndexManager.save(sessionDir, updatedEntries);

	log.success(`Added ${relativePath} to FILE_INDEX.md (chunks: [${chunkTags.join(", ")}])`);
}

// ---------------------------------------------------------------------------
// Public API: audit
// ---------------------------------------------------------------------------

/**
 * Audit FILE_INDEX.md for stale entries.
 *
 * @param options - Resolved CLI options
 * @returns The audit result
 * @throws CliError if no session found
 */
export async function runIndexAudit(options: IndexAuditOptions): Promise<AuditResult> {
	const sessionDir = resolveSessionDir(options.cwd);

	const entries = FileIndexManager.load(sessionDir);
	const audit = FileIndexManager.audit(entries, sessionDir);

	if (audit.healthy) {
		log.success(`FILE_INDEX.md is healthy: ${String(entries.length)} entries, no issues found.`);
		return audit;
	}

	// Display stale entries
	if (audit.stale.length > 0) {
		log.warn(
			`Found ${String(audit.stale.length)} stale entr${audit.stale.length === 1 ? "y" : "ies"} (files deleted/moved):`,
		);
		for (const entry of audit.stale) {
			log.message(`  ${entry.filepath} (chunks: [${entry.chunk_tags.join(", ")}])`);
		}
	}

	// Display missing chunks
	if (audit.missingChunks.length > 0) {
		log.warn(
			`Missing chunk files: ${audit.missingChunks.map((id) => `PLAN_${String(id)}.md`).join(", ")}`,
		);
	}

	// Auto-fix stale entries
	if (options.fix && audit.stale.length > 0) {
		let shouldFix: boolean;

		if (options.yes) {
			shouldFix = true;
		} else {
			const { confirm, isCancel: isCancelled } = await import("@clack/prompts");
			const fixResult = await confirm({
				message: `Remove ${String(audit.stale.length)} stale entr${audit.stale.length === 1 ? "y" : "ies"}?`,
			});

			if (isCancelled(fixResult)) {
				shouldFix = false;
			} else {
				shouldFix = fixResult as boolean;
			}
		}

		if (shouldFix) {
			const staleSet = new Set(audit.stale.map((e) => e.filepath));
			const cleaned = entries.filter((e) => !staleSet.has(e.filepath));
			FileIndexManager.save(sessionDir, cleaned);
			log.success(
				`Removed ${String(audit.stale.length)} stale entr${audit.stale.length === 1 ? "y" : "ies"}.`,
			);
		}
	}

	return audit;
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
			suggestion: "Run `dev-session init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

/**
 * Register the `index` command group on a Commander program.
 *
 * Creates the `index` parent command with `add` and `audit` subcommands.
 *
 * @param program - The root Commander program
 */
export function registerIndexCommand(program: Command): void {
	const indexCmd = program
		.command("index")
		.description("Manage the file index (add files, audit for stale entries)");

	indexCmd
		.command("add <filepath>")
		.description("Add a file to FILE_INDEX.md")
		.action(async (filepath: string) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
			}>();

			try {
				await runIndexAdd({
					cwd: opts.cwd,
					filepath,
					yes: opts.yes,
					verbose: opts.verbose,
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});

	indexCmd
		.command("audit")
		.description("Audit FILE_INDEX.md for stale or missing entries")
		.option("--fix", "Auto-remove stale entries after confirmation", false)
		.action(async (cmdOptions: { fix?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
			}>();

			try {
				await runIndexAudit({
					cwd: opts.cwd,
					fix: cmdOptions.fix ?? false,
					yes: opts.yes,
					verbose: opts.verbose,
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
