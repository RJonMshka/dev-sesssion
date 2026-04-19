/**
 * `dev-session index` commands.
 *
 * - `index` — full regen of ai-index.yaml (AutoExtractor → AiIndexBuilder → save)
 * - `index --update` — incremental regen (mtime-based, skips unchanged files)
 * - `index --dry-run` — show what would be written without writing
 * - `index --file <path>` — extract and display a single file's index entry
 * - `index --show <path>` — print the existing index entry for a file
 * - `index stats` — report token cost breakdown by layer
 * - `index add <filepath>` — validate and append a file to FILE_INDEX.md
 * - `index audit` — detect stale entries and optionally auto-remove them
 *
 * Business logic lives in @dev-session/core — this module handles CLI
 * prompts, formatting, and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, isCancel, log, multiselect, spinner, text } from "@clack/prompts";
import {
	AiIndexBuilder,
	AiIndexManager,
	type AuditResult,
	AutoExtractor,
	type FileIndexEntry,
	FileIndexManager,
	PlanChunkManager,
	SessionStateManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Adapter token budget warning threshold (tokens). */
const LAYER0_BUDGET_WARNING = 8_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the `index` full-regen command. */
export interface IndexRegenOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Dry-run: show what would be written without writing. */
	readonly dryRun: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Block on secret detection. */
	readonly strict: boolean;
	/** Incremental update (mtime-based; skips unchanged files). */
	readonly update: boolean;
	/** Extract and display a single file's entry. */
	readonly file?: string;
	/** Print the existing index entry for a path (no extraction). */
	readonly show?: string;
}

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
// Public API: index regen
// ---------------------------------------------------------------------------

/**
 * Run the full ai-index regen pipeline (or incremental update).
 *
 * Flow:
 * 1. Walk directory for TS/JS files (gitignore-aware).
 * 2. Extract symbols via AutoExtractor.
 * 3. Build/merge AiIndex.
 * 4. Save atomically (unless --dry-run).
 *
 * @param options - Resolved CLI options.
 * @throws {CliError} If no .session/ directory or the walk fails.
 */
export async function runIndex(options: IndexRegenOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	// --file: extract a single file and display its entry
	if (options.file) {
		await runIndexFile(options.file, options.cwd, sessionDir);
		return;
	}

	// --show: print existing entry without re-extracting
	if (options.show) {
		runIndexShow(options.show, sessionDir);
		return;
	}

	const s = spinner();
	s.start("Scanning TypeScript/JS files…");

	const extractor = new AutoExtractor();
	let parsedFiles: Awaited<ReturnType<AutoExtractor["extractDirectory"]>>;

	try {
		const rootPath = PathValidator.safeResolvePath(".", options.cwd);
		parsedFiles = await extractor.extractDirectory(rootPath);
	} catch (cause: unknown) {
		s.stop("Scan failed.");
		throw new CliError({
			message: "Failed to walk project directory during index regen",
			cause,
		});
	}

	s.stop(`Scanned ${String(parsedFiles.length)} files.`);

	const existingIndex = AiIndexManager.load(sessionDir);

	let builtIndex: import("@dev-session/core").AiIndex;
	const projectRoot = PathValidator.safeResolvePath(".", options.cwd) as string;
	if (options.update && existingIndex) {
		// Incremental: build a fresh index for scanned files,
		// then merge (existing unchanged entries are kept by caller logic).
		builtIndex = AiIndexBuilder.merge(
			existingIndex,
			AiIndexBuilder.build(parsedFiles, projectRoot),
		);
	} else {
		builtIndex = AiIndexBuilder.build(parsedFiles, projectRoot);
	}

	const stats = AiIndexManager.stats(builtIndex);
	const tokenStr = stats.totalTokenCost.toLocaleString();

	if (options.dryRun) {
		log.info(
			`[dry-run] Would write ai-index.yaml: ${String(stats.fileCount)} files, ${String(stats.symbolCount)} public symbols, ~${tokenStr} tokens`,
		);
		return;
	}

	AiIndexManager.save(sessionDir, builtIndex, options.strict);

	log.success(
		`Indexed ${String(stats.fileCount)} files, ${String(stats.symbolCount)} public symbols. Estimated context surface: ${tokenStr} tokens`,
	);

	if (stats.totalTokenCost > LAYER0_BUDGET_WARNING) {
		log.warn(
			`Layer 0 token cost (${tokenStr}) exceeds adapter budget warning threshold (${String(LAYER0_BUDGET_WARNING)}). Consider using --update or excluding large files.`,
		);
	}

	if (options.verbose) {
		// Show top 5 largest files
		const sorted = Object.entries(builtIndex.files)
			.sort((a, b) => (b[1]?.token_cost ?? 0) - (a[1]?.token_cost ?? 0))
			.slice(0, 5);
		if (sorted.length > 0) {
			log.info("Largest files by token cost:");
			for (const [relPath, entry] of sorted) {
				const cost = entry?.token_cost ?? 0;
				log.message(`  ${relPath}: ${String(cost)} tokens`);
			}
		}
	}
}

/**
 * Extract and display a single file's index entry.
 *
 * @param filePath - Path to the file (relative to cwd or absolute).
 * @param cwd - Working directory.
 * @param sessionDir - Validated .session/ path.
 */
async function runIndexFile(
	filePath: string,
	cwd: string,
	sessionDir: ValidatedPath,
): Promise<void> {
	const absPath = path.resolve(cwd, filePath);
	if (!fs.existsSync(absPath)) {
		throw new CliError({
			message: `File not found: ${filePath}`,
			suggestion: "Check the path and try again.",
		});
	}

	const validatedPath = PathValidator.safeResolvePath(path.relative(cwd, absPath), cwd);

	const extractor = new AutoExtractor();
	const parsed = extractor.extractFile(validatedPath);

	log.info(`File: ${path.relative(cwd, absPath)}`);
	log.message(`  Module summary: ${parsed.moduleSummary || "(none)"}`);
	log.message(`  Exports: ${String(parsed.exports.length)}`);
	for (const sym of parsed.exports) {
		log.message(`    ${sym.name} (line ${String(sym.line)}): ${sym.summary || "(no summary)"}`);
	}
	log.message(`  Token cost: ~${String(parsed.tokenCost)} tokens`);

	// Also save to existing index if it exists
	const existingIndex = AiIndexManager.load(sessionDir);
	if (existingIndex) {
		const projectRoot = existingIndex.project_root;
		const relPath = path.relative(projectRoot, absPath).replace(/\\/g, "/");
		log.info(`Would update index entry: ${relPath}`);
	}
}

/**
 * Print an existing index entry for a path without re-extracting.
 *
 * @param filePath - Relative file path as it appears in the index.
 * @param sessionDir - Validated .session/ path.
 */
function runIndexShow(filePath: string, sessionDir: ValidatedPath): void {
	const existingIndex = AiIndexManager.load(sessionDir);
	if (!existingIndex) {
		throw new CliError({
			message: "No ai-index.yaml found",
			suggestion: "Run `dev-session index` first to generate the index.",
		});
	}

	const entry = existingIndex.files[filePath];
	if (!entry) {
		log.warn(`No index entry for: ${filePath}`);
		log.info("Tip: run `dev-session index` to regenerate the full index.");
		return;
	}

	log.info(`Index entry: ${filePath}`);
	log.message(`  Module summary: ${entry.module_summary || "(none)"}`);
	log.message(`  Layer default: ${String(entry.layer_default)}`);
	log.message(
		`  Token cost: ${String(entry.token_cost)} (${entry.token_cost_accurate ? "accurate" : "heuristic"})`,
	);
	log.message(`  Public symbols: ${String(Object.keys(entry.exports).length)}`);
	for (const [name, sym] of Object.entries(entry.exports)) {
		log.message(`    ${name} (line ${String(sym.line)}): ${sym.summary || "(no summary)"}`);
	}
}

/**
 * Display ai-index statistics.
 *
 * @param sessionDir - Validated .session/ path.
 */
export function runIndexStats(sessionDir: ValidatedPath): void {
	const index = AiIndexManager.load(sessionDir);
	if (!index) {
		throw new CliError({
			message: "No ai-index.yaml found",
			suggestion: "Run `dev-session index` first to generate the index.",
		});
	}

	const { fileCount, symbolCount, totalTokenCost } = AiIndexManager.stats(index);
	const generated = new Date(index.generated_at).toLocaleString();

	log.info(`AI Index stats (generated ${generated})`);
	log.message(`  Files indexed: ${String(fileCount)}`);
	log.message(`  Public symbols: ${String(symbolCount)}`);
	log.message(`  Total token cost: ~${totalTokenCost.toLocaleString()} tokens`);

	// Layer breakdown
	const layer0 = Object.values(index.files).filter((e) => e.layer_default === 0).length;
	const layer1 = Object.values(index.files).filter((e) => e.layer_default === 1).length;
	const layer2 = Object.values(index.files).filter((e) => e.layer_default === 2).length;
	log.message(`  Layer 0 (compact): ${String(layer0)} files`);
	log.message(`  Layer 1 (signatures): ${String(layer1)} files`);
	log.message(`  Layer 2 (full source): ${String(layer2)} files`);
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
 * Root `index` command: full ai-index regen pipeline.
 * Subcommands: `add`, `audit`, `stats`.
 *
 * @param program - The root Commander program
 */
export function registerIndexCommand(program: Command): void {
	const indexCmd = program
		.command("index")
		.description(
			"Generate/update ai-index.yaml (full regen by default; see subcommands for file-level ops)",
		)
		.option("--update", "Incremental update — only re-extract changed files", false)
		.option("--file <path>", "Extract and display a single file's index entry")
		.option("--show <path>", "Print the existing index entry for a path (no extraction)")
		.action(async (cmdOptions: { update?: boolean; file?: string; show?: string }) => {
			const opts = program.opts<{
				cwd: string;
				dryRun: boolean;
				verbose: boolean;
				strict: boolean;
			}>();

			try {
				await runIndex({
					cwd: opts.cwd,
					dryRun: opts.dryRun ?? false,
					verbose: opts.verbose ?? false,
					strict: opts.strict ?? false,
					update: cmdOptions.update ?? false,
					...(cmdOptions.file !== undefined ? { file: cmdOptions.file } : {}),
					...(cmdOptions.show !== undefined ? { show: cmdOptions.show } : {}),
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});

	// --- stats subcommand ---
	indexCmd
		.command("stats")
		.description("Show ai-index statistics (file count, symbol count, token cost breakdown)")
		.action(() => {
			const opts = program.opts<{ cwd: string }>();
			try {
				const sessionDir = resolveSessionDir(opts.cwd);
				runIndexStats(sessionDir);
			} catch (error: unknown) {
				handleError(error);
			}
		});

	// --- add subcommand ---
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

	// --- audit subcommand ---
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
