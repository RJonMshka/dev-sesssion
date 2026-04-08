/**
 * `dev-session import` command.
 *
 * Imports context from external rule files into the dev-session session:
 *
 * - `--from claude`  Parses `CLAUDE.md` H2 sections into SESSION_STATE notes.
 * - `--from cursor`  Parses `.cursor/rules/*.mdc` glob patterns into FILE_INDEX entries.
 *
 * Business logic for index/state management lives in `@dev-session/core`.
 * This module handles I/O, frontmatter parsing, and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { intro, log, outro, spinner } from "@clack/prompts";
import {
	type FileIndexEntry,
	FileIndexManager,
	GitignoreAwareWalker,
	SessionStateManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";

import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported import source identifiers. */
export type ImportSource = "claude" | "cursor";

/** Options for the import command. */
export interface ImportOptions {
	/** Working directory (project root). */
	readonly cwd: string;
	/** Source to import from. */
	readonly from: ImportSource;
	/** Skip prompts and use defaults. */
	readonly yes: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Log writes without touching the filesystem. */
	readonly dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

/**
 * Execute the import command.
 *
 * @param options - Resolved CLI options
 * @throws {CliError} if .session/ is not found or source is unsupported
 */
export async function runImport(options: ImportOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);
	intro(`dev-session import --from ${options.from}`);

	switch (options.from) {
		case "claude":
			await importFromClaude(sessionDir, options);
			break;
		case "cursor":
			await importFromCursor(sessionDir, options);
			break;
		default: {
			const _exhaustive: never = options.from;
			throw new CliError({
				message: `Unsupported import source: ${String(_exhaustive)}`,
				suggestion: "Use --from claude or --from cursor",
			});
		}
	}
}

// ---------------------------------------------------------------------------
// --from claude
// ---------------------------------------------------------------------------

/**
 * Parse CLAUDE.md H2 sections and add them as notes in SESSION_STATE.md.
 *
 * Each H2 section title + first 120 chars of its content becomes a note.
 * Already-imported notes (same prefix) are deduplicated.
 *
 * @param sessionDir - Validated path to .session/
 * @param options - CLI options
 */
async function importFromClaude(sessionDir: ValidatedPath, options: ImportOptions): Promise<void> {
	const claudePath = path.join(options.cwd, "CLAUDE.md");

	if (!fs.existsSync(claudePath)) {
		throw new CliError({
			message: "CLAUDE.md not found in project root",
			suggestion: "Ensure CLAUDE.md exists before running import --from claude",
		});
	}

	const s = spinner();
	s.start("Parsing CLAUDE.md...");

	const content = fs.readFileSync(claudePath, "utf-8");
	const sections = extractH2Sections(content);

	s.stop(
		`Found ${String(sections.length)} section${sections.length === 1 ? "" : "s"} in CLAUDE.md.`,
	);

	if (sections.length === 0) {
		log.warn("No H2 sections found in CLAUDE.md — nothing to import.");
		outro("Import complete (nothing added).");
		return;
	}

	const state = SessionStateManager.load(sessionDir);
	const notes = buildClaudeNotes(sections);

	// Deduplicate against existing notes
	const existingNoteTexts = new Set(state.notes);
	const newNotes = notes.filter((n) => !existingNoteTexts.has(n));

	if (newNotes.length === 0) {
		log.info("All sections already imported — no new notes added.");
		outro("Import complete (no changes).");
		return;
	}

	if (options.verbose) {
		for (const note of newNotes) {
			log.message(`  + ${note}`);
		}
	}

	if (!options.dryRun) {
		const updated = { ...state, notes: [...state.notes, ...newNotes] };
		SessionStateManager.save(sessionDir, updated);
	}

	log.success(
		`Added ${String(newNotes.length)} note${newNotes.length === 1 ? "" : "s"} to SESSION_STATE.md${options.dryRun ? " (dry run)" : ""}.`,
	);
	outro("Import from CLAUDE.md complete.");
}

/**
 * Extract H2 sections from markdown content.
 *
 * @param content - Raw markdown string
 * @returns Array of `{ title, excerpt }` objects
 */
function extractH2Sections(content: string): Array<{ title: string; excerpt: string }> {
	const lines = content.split("\n");
	const sections: Array<{ title: string; excerpt: string }> = [];
	let currentTitle: string | null = null;
	const currentBody: string[] = [];

	const flush = (): void => {
		if (currentTitle === null) return;
		const excerpt = currentBody.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
		sections.push({ title: currentTitle, excerpt });
		currentBody.length = 0;
	};

	for (const line of lines) {
		if (line.startsWith("## ")) {
			flush();
			currentTitle = line.replace(/^##\s+/, "").trim();
		} else if (currentTitle !== null && line.trim() !== "" && !line.startsWith("#")) {
			currentBody.push(line.trim());
		}
	}
	flush();

	return sections;
}

/**
 * Build note strings from CLAUDE.md sections.
 *
 * @param sections - Parsed H2 sections
 * @returns Array of note strings to add to SESSION_STATE
 */
function buildClaudeNotes(sections: ReadonlyArray<{ title: string; excerpt: string }>): string[] {
	return sections.map(({ title, excerpt }) => {
		const base = `CLAUDE.md: ${title}`;
		return excerpt.length > 0 ? `${base} — ${excerpt}` : base;
	});
}

// ---------------------------------------------------------------------------
// --from cursor
// ---------------------------------------------------------------------------

/**
 * Parse `.cursor/rules/*.mdc` glob patterns and add matching files
 * to FILE_INDEX tagged to the active chunk.
 *
 * @param sessionDir - Validated path to .session/
 * @param options - CLI options
 */
async function importFromCursor(sessionDir: ValidatedPath, options: ImportOptions): Promise<void> {
	const rulesDir = path.join(options.cwd, ".cursor", "rules");

	if (!fs.existsSync(rulesDir)) {
		throw new CliError({
			message: ".cursor/rules/ directory not found",
			suggestion: "Ensure Cursor rules exist before running import --from cursor",
		});
	}

	const s = spinner();
	s.start("Reading Cursor rules...");

	const mdcFiles = fs
		.readdirSync(rulesDir)
		.filter((f) => f.endsWith(".mdc"))
		.map((f) => path.join(rulesDir, f));

	s.stop(`Found ${String(mdcFiles.length)} rule file${mdcFiles.length === 1 ? "" : "s"}.`);

	if (mdcFiles.length === 0) {
		log.warn("No .mdc files found in .cursor/rules/ — nothing to import.");
		outro("Import complete (nothing added).");
		return;
	}

	// Pre-walk all project files once for efficiency
	s.start("Scanning codebase...");
	const walkedFiles = GitignoreAwareWalker.walk(options.cwd).map((f) => f.relativePath);
	s.stop(`Scanned ${String(walkedFiles.length)} files.`);

	const state = SessionStateManager.load(sessionDir);
	const activeChunk = state.active_chunk;
	const entries = FileIndexManager.load(sessionDir);
	let addedCount = 0;
	let updatedEntries = [...entries];

	for (const mdcPath of mdcFiles) {
		const result = processMdcFile(
			mdcPath,
			activeChunk,
			updatedEntries,
			walkedFiles,
			options.verbose,
		);
		updatedEntries = result.entries;
		addedCount += result.added;
	}

	if (addedCount === 0) {
		log.info("All matched files already in FILE_INDEX — no new entries added.");
		outro("Import complete (no changes).");
		return;
	}

	if (!options.dryRun) {
		FileIndexManager.save(sessionDir, updatedEntries);
	}

	log.success(
		`Added ${String(addedCount)} file${addedCount === 1 ? "" : "s"} to FILE_INDEX.md (chunk ${String(activeChunk)})${options.dryRun ? " (dry run)" : ""}.`,
	);
	outro("Import from Cursor rules complete.");
}

/**
 * Process a single .mdc file: expand its globs and merge into the entries list.
 *
 * Uses {@link GitignoreAwareWalker} to enumerate files, then filters by
 * the glob patterns from the .mdc frontmatter.
 *
 * @param mdcPath - Absolute path to the .mdc file
 * @param activeChunk - Chunk to tag new entries to
 * @param entries - Current FILE_INDEX entries
 * @param allFiles - All codebase files (pre-walked for efficiency)
 * @param verbose - Whether to log per-file additions
 * @returns Updated entries and count of new additions
 */
function processMdcFile(
	mdcPath: string,
	activeChunk: number,
	entries: FileIndexEntry[],
	allFiles: readonly string[],
	verbose: boolean,
): { entries: FileIndexEntry[]; added: number } {
	const raw = fs.readFileSync(mdcPath, "utf-8");
	const parsed = parseMdcFrontmatter(raw, path.basename(mdcPath));

	if (parsed === null || parsed.globs === undefined) {
		return { entries, added: 0 };
	}

	const patterns = Array.isArray(parsed.globs) ? parsed.globs : [parsed.globs];
	const ruleDescription = parsed.description ?? path.basename(mdcPath, ".mdc");
	let added = 0;
	let updatedEntries = entries;

	for (const pattern of patterns) {
		const regex = globToRegex(pattern);
		for (const relPath of allFiles) {
			if (!regex.test(relPath)) continue;

			const existingIdx = updatedEntries.findIndex((e) => e.filepath === relPath);
			if (existingIdx !== -1) continue;

			const newEntry: FileIndexEntry = {
				filepath: relPath,
				chunk_tags: [activeChunk],
				purpose: `Cursor rule: ${ruleDescription}`,
			};
			updatedEntries = [...updatedEntries, newEntry];
			if (verbose) log.message(`  + ${relPath}`);
			added++;
		}
	}

	return { entries: updatedEntries, added };
}

/**
 * Convert a glob pattern string to a RegExp.
 *
 * Handles the key cases for cursor rule globs:
 * - `src/**\/\*.ts` → matches `src/index.ts` AND `src/foo/index.ts`
 * - `**\/\*.ts`      → matches `*.ts` anywhere
 * - `*`              → matches any non-slash segment
 *
 * Uses string placeholders so that regex `?` quantifiers we introduce
 * are not accidentally overwritten by glob `?` expansion.
 *
 * @param pattern - Glob pattern (e.g. `src/**\/*.ts`)
 * @returns Compiled RegExp
 */
function globToRegex(pattern: string): RegExp {
	// Normalize path separators to forward slash
	const normalized = pattern.replace(/\\/g, "/");
	// Escape regex special chars except * (do NOT escape ?)
	const escaped = normalized.replace(/[.+^${}()|[\]]/g, "\\$&");
	// Use opaque string placeholders (not control chars) to preserve
	// regex quantifiers we introduce — these strings can't appear in globs.
	const withGlobs = escaped
		.split("/**/")
		.join("__GLOB_MID__") // /**/  → placeholder
		.replace(/^\*\*\//, "__GLOB_PRE__") // **/ at start → placeholder
		.replace(/\/\*\*$/, "__GLOB_SFX__") // /** at end  → placeholder
		.replace(/\*\*/g, ".*") // remaining ** → .*
		.replace(/\*/g, "[^/]*") // * → [^/]*
		.replace(/\?/g, "[^/]") // ? → any single non-slash char
		.split("__GLOB_MID__")
		.join("/(?:.*/)?") // restore mid → optional segments
		.replace(/__GLOB_PRE__/g, "(?:.*/)?") // restore leading → optional prefix
		.replace(/__GLOB_SFX__/g, "/.*"); // restore trailing → match rest
	return new RegExp(`^${withGlobs}$`);
}

/**
 * Parse the frontmatter from a .mdc file content string.
 *
 * Extracts `description` and `globs` fields using lightweight line-by-line
 * parsing. Does not use a full YAML parser — cursor rule files use simple
 * string and array values that do not require one.
 *
 * @param content - Raw file content
 * @param _filename - Unused; kept for call-site readability
 * @returns Parsed frontmatter or null if frontmatter is absent/malformed
 */
function parseMdcFrontmatter(
	content: string,
	_filename: string,
): { description?: string; globs?: string | string[] } | null {
	if (!content.startsWith("---")) return null;

	const endIdx = content.indexOf("\n---", 3);
	if (endIdx === -1) return null;

	const yamlBlock = content.slice(4, endIdx);
	return extractMdcFields(yamlBlock);
}

/**
 * Extract `description` and `globs` from raw YAML frontmatter text.
 *
 * @param yaml - Raw YAML block (no delimiters)
 * @returns Extracted fields or null if none found
 */
function extractMdcFields(
	yaml: string,
): { description?: string; globs?: string | string[] } | null {
	const result: { description?: string; globs?: string | string[] } = {};

	for (const line of yaml.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		if (key === "description") {
			result.description = stripQuotes(rawValue);
		} else if (key === "globs") {
			result.globs = parseGlobsValue(rawValue);
		}
	}

	return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse a YAML globs value, which may be a single string or inline array.
 *
 * @param inline - The value portion of the `globs:` line
 * @returns A string or array of strings
 */
function parseGlobsValue(inline: string): string | string[] {
	if (inline.startsWith("[")) {
		// Inline array: ["*.ts", "*.tsx"]
		return inline
			.slice(1, inline.lastIndexOf("]"))
			.split(",")
			.map((s) => stripQuotes(s.trim()))
			.filter((s) => s.length > 0);
	}
	return stripQuotes(inline);
}

/**
 * Remove surrounding single or double quotes from a YAML scalar value.
 *
 * @param value - The raw scalar string
 * @returns The unquoted string
 */
function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
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
 * Register the `import` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerImportCommand(program: Command): void {
	program
		.command("import")
		.description("Import context from external rule files into the session")
		.requiredOption("--from <source>", "Source to import from: claude | cursor")
		.action(async (cmdOptions: { from: string }) => {
			try {
				const opts = program.opts<{
					cwd: string;
					yes: boolean;
					verbose: boolean;
					dryRun: boolean;
				}>();

				const source = cmdOptions.from;
				if (source !== "claude" && source !== "cursor") {
					throw new CliError({
						message: `Unknown import source: ${source}`,
						suggestion: "Use --from claude or --from cursor",
					});
				}

				const importOptions: ImportOptions = {
					cwd: opts.cwd,
					from: source as ImportSource,
					yes: opts.yes,
					verbose: opts.verbose,
					dryRun: opts.dryRun,
				};

				await runImport(importOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
