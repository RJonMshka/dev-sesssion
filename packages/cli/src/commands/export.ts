/**
 * `dev-session export` command.
 *
 * Exports the current session state back to external AI tool config files —
 * the inverse of `dev-session import`:
 *
 * - `--to claude`  Writes the active chunk's tasks, notes, and file list
 *                  into CLAUDE.md inside `<!-- dev-session:start/end -->` markers.
 * - `--to cursor`  Writes the active chunk's FILE_INDEX entries as glob patterns
 *                  into `.cursor/rules/dev-session.mdc`.
 *
 * Business logic for index/state management lives in `@dev-session/core`.
 * This module handles I/O and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { intro, log, outro, spinner } from "@clack/prompts";
import { type FileIndexEntry, FileIndexManager, SessionStateManager } from "@dev-session/core";
import { AtomicWriter, CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";

import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Marker comments that delimit the dev-session section in CLAUDE.md. */
const CLAUDE_SECTION_START = "<!-- dev-session:start -->";
const CLAUDE_SECTION_END = "<!-- dev-session:end -->";

/** Path where the cursor rule is written (relative to project root). */
const CURSOR_MDC_PATH = ".cursor/rules/dev-session.mdc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported export target identifiers. */
export type ExportTarget = "claude" | "cursor";

/** Options for the export command. */
export interface ExportOptions {
	/** Working directory (project root). */
	readonly cwd: string;
	/** Target to export to. */
	readonly to: ExportTarget;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Log writes without touching the filesystem. */
	readonly dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

/**
 * Execute the export command.
 *
 * @param options - Resolved CLI options
 * @throws {CliError} if .session/ is not found or target is unsupported
 */
export async function runExport(options: ExportOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);
	intro(`dev-session export --to ${options.to}`);

	switch (options.to) {
		case "claude":
			await exportToClaude(sessionDir, options);
			break;
		case "cursor":
			await exportToCursor(sessionDir, options);
			break;
		default: {
			const _exhaustive: never = options.to;
			throw new CliError({
				message: `Unsupported export target: ${String(_exhaustive)}`,
				suggestion: "Use --to claude or --to cursor",
			});
		}
	}
}

// ---------------------------------------------------------------------------
// --to claude
// ---------------------------------------------------------------------------

/**
 * Export current session state into CLAUDE.md.
 *
 * Reads SESSION_STATE.md (active chunk, tasks, notes) and FILE_INDEX.md
 * (files for the active chunk), builds a summary section, and upserts it
 * into CLAUDE.md between the `<!-- dev-session:start/end -->` markers.
 *
 * @param sessionDir - Validated path to .session/
 * @param options - CLI options
 */
async function exportToClaude(sessionDir: ValidatedPath, options: ExportOptions): Promise<void> {
	const claudePath = path.join(options.cwd, "CLAUDE.md");

	const s = spinner();
	s.start("Reading session state...");

	const state = SessionStateManager.load(sessionDir);
	const entries = FileIndexManager.load(sessionDir);

	const activeFiles = FileIndexManager.queryByChunk(entries, state.active_chunk);
	const alwaysFiles = FileIndexManager.alwaysInclude(entries);

	s.stop(
		`Chunk ${String(state.active_chunk)} — ${String(activeFiles.length)} files, ${String(state.notes.length)} notes.`,
	);

	const sectionContent = buildClaudeSection(state.active_chunk, state, activeFiles, alwaysFiles);

	const existing = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, "utf-8") : "";
	const updated = upsertClaudeSection(existing, sectionContent);

	if (options.verbose) {
		log.message("Section content:");
		log.message(sectionContent);
	}

	if (!options.dryRun) {
		const validatedPath = PathValidator.safeResolvePath("CLAUDE.md", options.cwd);
		AtomicWriter.writeFile(validatedPath, updated);
	}

	const verb = existing.length > 0 ? "Updated" : "Created";
	log.success(
		`${verb} CLAUDE.md with dev-session section (chunk ${String(state.active_chunk)})${options.dryRun ? " (dry run)" : ""}.`,
	);
	outro("Export to CLAUDE.md complete.");
}

/**
 * Build the dev-session section content for CLAUDE.md.
 *
 * @param chunkId - The active chunk number
 * @param state - Current session state
 * @param activeFiles - FILE_INDEX entries for the active chunk
 * @param alwaysFiles - FILE_INDEX entries always included
 * @returns The section content string (without markers)
 */
function buildClaudeSection(
	chunkId: number,
	state: { tasks: ReadonlyArray<{ text: string; status: string }>; notes: readonly string[] },
	activeFiles: readonly FileIndexEntry[],
	alwaysFiles: readonly FileIndexEntry[],
): string {
	const lines: string[] = ["", `## Active Chunk: ${String(chunkId)}`, ""];

	// Task progress
	const done = state.tasks.filter((t) => t.status === "done").length;
	const total = state.tasks.length;
	if (total > 0) {
		lines.push(`**Progress:** ${String(done)}/${String(total)} tasks complete`, "");
		lines.push("### Tasks", "");
		for (const task of state.tasks) {
			const checkbox = task.status === "done" ? "[x]" : "[ ]";
			lines.push(`- ${checkbox} ${task.text}`);
		}
		lines.push("");
	}

	// Notes
	if (state.notes.length > 0) {
		lines.push("### Notes", "");
		for (const note of state.notes) {
			lines.push(`- ${note}`);
		}
		lines.push("");
	}

	// Files to load
	const filesToLoad = [
		...alwaysFiles.map((e) => e.filepath),
		...activeFiles.map((e) => e.filepath),
	];
	// Deduplicate (always-include files may also appear in activeFiles)
	const uniqueFiles = [...new Set(filesToLoad)];

	if (uniqueFiles.length > 0) {
		lines.push("### Files to load for this chunk", "");
		for (const f of uniqueFiles) {
			lines.push(`- \`${f}\``);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Insert or replace the dev-session section in CLAUDE.md content.
 *
 * @param existing - Existing CLAUDE.md content (may be empty)
 * @param sectionContent - The new section content (without markers)
 * @returns Updated CLAUDE.md content
 */
function upsertClaudeSection(existing: string, sectionContent: string): string {
	const startIdx = existing.indexOf(CLAUDE_SECTION_START);
	const endIdx = existing.indexOf(CLAUDE_SECTION_END);

	const wrapped = `${CLAUDE_SECTION_START}\n${sectionContent}\n${CLAUDE_SECTION_END}`;

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const before = existing.slice(0, startIdx);
		const after = existing.slice(endIdx + CLAUDE_SECTION_END.length);
		return `${before}${wrapped}${after}`;
	}

	const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const extraNewline = existing.length > 0 ? "\n" : "";
	return `${existing}${separator}${extraNewline}${wrapped}\n`;
}

// ---------------------------------------------------------------------------
// --to cursor
// ---------------------------------------------------------------------------

/**
 * Export current session FILE_INDEX as a Cursor rule file.
 *
 * Reads FILE_INDEX entries for the active chunk and writes them as
 * glob patterns into `.cursor/rules/dev-session.mdc`.
 *
 * @param sessionDir - Validated path to .session/
 * @param options - CLI options
 */
async function exportToCursor(sessionDir: ValidatedPath, options: ExportOptions): Promise<void> {
	const s = spinner();
	s.start("Reading session state...");

	const state = SessionStateManager.load(sessionDir);
	const entries = FileIndexManager.load(sessionDir);
	const activeFiles = FileIndexManager.queryByChunk(entries, state.active_chunk);
	const alwaysFiles = FileIndexManager.alwaysInclude(entries);

	s.stop(`Chunk ${String(state.active_chunk)} — ${String(activeFiles.length)} files in index.`);

	if (activeFiles.length === 0 && alwaysFiles.length === 0) {
		log.warn("No files in FILE_INDEX for the active chunk — nothing to export.");
		outro("Export complete (nothing written).");
		return;
	}

	const mdcContent = buildMdcContent(state.active_chunk, activeFiles, alwaysFiles);

	if (options.verbose) {
		log.message("Generated .mdc content:");
		log.message(mdcContent);
	}

	if (!options.dryRun) {
		const rulesDir = path.join(options.cwd, ".cursor", "rules");
		if (!fs.existsSync(rulesDir)) {
			fs.mkdirSync(rulesDir, { recursive: true });
		}
		const validatedPath = PathValidator.safeResolvePath(CURSOR_MDC_PATH, options.cwd);
		AtomicWriter.writeFile(validatedPath, mdcContent);
	}

	const totalFiles = new Set([
		...alwaysFiles.map((e) => e.filepath),
		...activeFiles.map((e) => e.filepath),
	]).size;

	log.success(
		`Written ${String(totalFiles)} glob pattern${totalFiles === 1 ? "" : "s"} to ${CURSOR_MDC_PATH}${options.dryRun ? " (dry run)" : ""}.`,
	);
	outro("Export to Cursor rules complete.");
}

/**
 * Build the content for the `.cursor/rules/dev-session.mdc` file.
 *
 * Generates a Cursor rule file with frontmatter glob patterns for all
 * active chunk files and always-include files.
 *
 * @param chunkId - The active chunk number
 * @param activeFiles - FILE_INDEX entries for the active chunk
 * @param alwaysFiles - FILE_INDEX entries always included
 * @returns The .mdc file content string
 */
function buildMdcContent(
	chunkId: number,
	activeFiles: readonly FileIndexEntry[],
	alwaysFiles: readonly FileIndexEntry[],
): string {
	const allFiles = [...alwaysFiles.map((e) => e.filepath), ...activeFiles.map((e) => e.filepath)];
	const uniqueFiles = [...new Set(allFiles)];

	const globsInline = uniqueFiles.map((f) => `"${f}"`).join(", ");
	const frontmatter = [
		"---",
		`description: dev-session active chunk ${String(chunkId)} file index`,
		`globs: [${globsInline}]`,
		"alwaysApply: false",
		"---",
	].join("\n");

	const body = [
		"",
		`# dev-session — Chunk ${String(chunkId)} context`,
		"",
		"Load these files at the start of your session. They are the files",
		`tagged to active chunk ${String(chunkId)} in FILE_INDEX.md.`,
		"",
		"## Always include",
		"",
		...alwaysFiles.map((e) => `- \`${e.filepath}\` — ${e.purpose}`),
		"",
		`## Chunk ${String(chunkId)} files`,
		"",
		...activeFiles.map((e) => `- \`${e.filepath}\` — ${e.purpose}`),
		"",
	].join("\n");

	return `${frontmatter}\n${body}`;
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
 * Register the `export` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerExportCommand(program: Command): void {
	program
		.command("export")
		.description("Export session state back to external AI tool config files")
		.requiredOption("--to <target>", "Target to export to: claude | cursor")
		.action(async (cmdOptions: { to: string }) => {
			try {
				const opts = program.opts<{
					cwd: string;
					verbose: boolean;
					dryRun: boolean;
				}>();

				const target = cmdOptions.to;
				if (target !== "claude" && target !== "cursor") {
					throw new CliError({
						message: `Unknown export target: ${target}`,
						suggestion: "Use --to claude or --to cursor",
					});
				}

				const exportOptions: ExportOptions = {
					cwd: opts.cwd,
					to: target as ExportTarget,
					verbose: opts.verbose,
					dryRun: opts.dryRun,
				};

				await runExport(exportOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
