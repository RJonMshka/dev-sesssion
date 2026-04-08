/**
 * Final writes phase for `dev-session init`.
 *
 * Writes SESSION_STATE.md, ROUTINES.md, NEXT_PROMPT.md, runs the
 * secret scanner on all written content, and offers to patch `.gitignore`.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { confirm, isCancel, log } from "@clack/prompts";
import type { BootstrapContext, FileIndexEntry, PlanChunk, SessionState } from "@dev-session/core";
import {
	ContextBudgetCalculator,
	DEFAULT_CONTEXT_BUDGET,
	FileIndexManager,
	NextPromptWriter,
	RoutinesWriter,
	SessionStateManager,
} from "@dev-session/core";
import type { ValidatedPath } from "@dev-session/security";
import { AtomicWriter, CliError, PathValidator, SecretScanner } from "@dev-session/security";
import { createAdapterReadFile, createAdapterWriteFile } from "../utils/adapter-io.js";
import { dryRunGitignorePatch, dryRunWrite } from "../utils/dry-run.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the final writes phase. */
export interface FinalWriteOptions {
	readonly cwd: string;
	readonly yes: boolean;
	readonly dryRun: boolean;
	readonly verbose: boolean;
	readonly strict: boolean;
	/** Explicit adapter override (from --adapter flag). */
	readonly adapter?: string;
}

/** Result from the final writes phase. */
export interface FinalWriteResult {
	/** Total files written (0 in dry-run mode). */
	readonly filesWritten: number;
	/** Whether .gitignore was patched. */
	readonly gitignorePatched: boolean;
	/** Number of secret scan warnings. */
	readonly secretWarnings: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Lines to add to .gitignore for session files. */
const GITIGNORE_ENTRIES = [
	"",
	"# dev-session (ephemeral session state)",
	".session/SESSION_STATE.md",
	".session/NEXT_PROMPT.md",
	".session/DONE_LOG.md",
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the final writes phase of init.
 *
 * Creates SESSION_STATE.md, ROUTINES.md, NEXT_PROMPT.md, scans for
 * secrets, and optionally patches .gitignore.
 *
 * @param sessionDir - Validated path to the `.session/` directory.
 * @param chunks - The plan chunks (from split or scaffold).
 * @param entries - The file index entries (from generate-index).
 * @param projectName - The project name for NEXT_PROMPT.
 * @param options - CLI options.
 * @returns The final write result.
 * @throws {CliError} If writes fail.
 */
export async function runFinalWrites(
	sessionDir: ValidatedPath,
	chunks: readonly PlanChunk[],
	entries: readonly FileIndexEntry[],
	projectName: string,
	options: FinalWriteOptions,
): Promise<FinalWriteResult> {
	let filesWritten = 0;
	let secretWarnings = 0;

	const activeChunk = chunks[0];
	if (!activeChunk) {
		throw new CliError({
			message: "No plan chunks available. Cannot create session state.",
			suggestion: "Ensure plan splitting or scaffolding produced at least one chunk.",
		});
	}

	// --- 1. Write SESSION_STATE.md ---
	const sessionState = buildInitialState(activeChunk);
	const stateContent = serializeSessionState(sessionState);

	secretWarnings += scanContent(stateContent, "SESSION_STATE.md", options.verbose);

	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "SESSION_STATE.md"), stateContent, options.cwd);
	} else {
		SessionStateManager.save(sessionDir, sessionState);
		filesWritten++;
	}

	// --- 2. Write ROUTINES.md ---
	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "ROUTINES.md"), "(ROUTINES.md template)", options.cwd);
	} else {
		RoutinesWriter.write(sessionDir);
		filesWritten++;
	}

	// --- 3. Write NEXT_PROMPT.md ---
	const chunkFiles = FileIndexManager.queryByChunk(entries, activeChunk.chunk_id);
	const alwaysIncludeFiles = FileIndexManager.alwaysInclude(entries);

	const budget = ContextBudgetCalculator.estimate(
		sessionState,
		activeChunk,
		chunkFiles,
		alwaysIncludeFiles,
		DEFAULT_CONTEXT_BUDGET,
	);

	const excludePatterns = buildExcludePatterns(activeChunk.chunk_id, chunks);

	// Resolve adapter (flag → detect → fallback)
	const { adapter, tool: detectedTool, source } = resolveAdapter(options.cwd, options.adapter);

	if (options.verbose) {
		log.info(`Using ${adapter.config.display_name} adapter (${source}: ${detectedTool})`);
	}

	// --- 3a. Run adapter setup (generates tool-specific files like CLAUDE.md) ---
	if (!options.dryRun && adapter.setup) {
		const projectInfo = {
			tool: detectedTool,
			project_type: "unknown" as const,
			existing_files: [] as string[],
			project_root: options.cwd,
			has_existing_session: true,
			project_name: projectName,
		};

		const setupResult = await adapter.setup({
			projectRoot: options.cwd,
			sessionDir,
			projectInfo,
			isReinit: false,
			writeFile: createAdapterWriteFile(options.cwd),
			readFile: createAdapterReadFile(options.cwd),
		});

		if (options.verbose) {
			log.info(`Adapter setup: ${setupResult.summary}`);
		}
	}

	const bootstrapContext: BootstrapContext = {
		state: sessionState,
		chunk: activeChunk,
		chunkFiles,
		alwaysIncludeFiles,
		budget,
		excludePatterns,
		projectName,
	};

	const promptContent = NextPromptWriter.generateWithFormatter(adapter.formatter, bootstrapContext);

	secretWarnings += scanContent(promptContent, "NEXT_PROMPT.md", options.verbose);

	if (options.dryRun) {
		dryRunWrite(path.join(sessionDir, "NEXT_PROMPT.md"), promptContent, options.cwd);
	} else {
		NextPromptWriter.write(sessionDir, promptContent);
		filesWritten++;
	}

	// --- 4. Offer to patch .gitignore ---
	const gitignorePatched = await patchGitignore(options);

	if (!options.dryRun) {
		log.info(`Context budget: ${ContextBudgetCalculator.formatSummary(budget)}`);
	}

	return {
		filesWritten,
		gitignorePatched,
		secretWarnings,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the initial session state for chunk 1.
 *
 * @param activeChunk - The first plan chunk.
 * @returns A fresh SessionState.
 */
function buildInitialState(activeChunk: PlanChunk): SessionState {
	const sessionId = generateSessionId();
	const now = new Date().toISOString().slice(0, 10);

	return {
		active_chunk: activeChunk.chunk_id,
		session_id: sessionId,
		last_updated: now,
		tasks: activeChunk.tasks.map((t) => ({
			text: t.text,
			status: t.status,
			added_at: now,
		})),
		last_worked_files: [],
		notes: [`Session initialized on ${now}`],
		completed_chunks: {},
	};
}

/**
 * Generate a UUID v4 session ID.
 *
 * Uses Node.js crypto.randomUUID when available.
 *
 * @returns A UUID v4 string.
 */
function generateSessionId(): string {
	// Node 20+ always has crypto.randomUUID
	return crypto.randomUUID();
}

/**
 * Serialize a SessionState to YAML frontmatter format.
 *
 * This mirrors what SessionStateManager.save() writes, but returns
 * the string for scanning purposes.
 *
 * @param state - The session state.
 * @returns YAML-frontmattered markdown string.
 */
function serializeSessionState(state: SessionState): string {
	const lines: string[] = [
		"---",
		`active_chunk: ${state.active_chunk}`,
		`session_id: "${state.session_id}"`,
		`last_updated: "${state.last_updated}"`,
		"---",
		"",
		"# Session State",
		"",
		`## Active Chunk: ${state.active_chunk}`,
		"",
	];

	if (state.tasks.length > 0) {
		for (const task of state.tasks) {
			const marker = task.status === "done" ? "x" : " ";
			lines.push(`- [${marker}] ${task.text}`);
		}
		lines.push("");
	}

	if (state.notes.length > 0) {
		lines.push("## Notes");
		lines.push("");
		for (const note of state.notes) {
			lines.push(`- ${note}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Build exclude patterns for NEXT_PROMPT.
 *
 * Excludes test files, dist, and other chunk files.
 *
 * @param activeChunkId - The currently active chunk ID.
 * @param chunks - All available chunks.
 * @returns Array of exclude pattern strings.
 */
function buildExcludePatterns(
	activeChunkId: number,
	chunks: readonly PlanChunk[],
): readonly string[] {
	const patterns: string[] = ["**/__tests__/**", "**/dist/**", "**/node_modules/**"];

	// Exclude other chunk plan files
	for (const chunk of chunks) {
		if (chunk.chunk_id !== activeChunkId) {
			patterns.push(`.session/PLAN_${chunk.chunk_id}.md`);
		}
	}

	return patterns;
}

/**
 * Scan content for secrets and log warnings.
 *
 * @param content - The content to scan.
 * @param filename - The filename (for logging).
 * @param verbose - Whether to log individual findings.
 * @returns Number of warnings found.
 */
function scanContent(content: string, filename: string, verbose: boolean): number {
	const results = SecretScanner.scan(content);
	if (results.length > 0) {
		log.warn(
			`Secret scan found ${results.length} issue${results.length === 1 ? "" : "s"} in ${filename}`,
		);
		if (verbose) {
			for (const r of results) {
				log.message(`  Line ${r.line}: ${r.pattern} (${r.redacted})`);
			}
		}
	}
	return results.length;
}

/**
 * Offer to patch .gitignore with session-specific entries.
 *
 * @param options - CLI options.
 * @returns Whether the patch was applied.
 */
async function patchGitignore(options: FinalWriteOptions): Promise<boolean> {
	const gitignorePath = path.join(options.cwd, ".gitignore");

	// Check if entries already exist
	let existingContent = "";
	try {
		existingContent = fs.readFileSync(gitignorePath, "utf-8");
	} catch {
		// No .gitignore — we'll create one
	}

	const alreadyPatched = GITIGNORE_ENTRIES.some(
		(entry) => entry.trim().length > 0 && existingContent.includes(entry),
	);

	if (alreadyPatched) {
		if (options.verbose) {
			log.info(".gitignore already contains dev-session entries.");
		}
		return false;
	}

	if (options.dryRun) {
		dryRunGitignorePatch(gitignorePath, [...GITIGNORE_ENTRIES], options.cwd);
		return false;
	}

	let shouldPatch: boolean;
	if (options.yes) {
		shouldPatch = true;
	} else {
		const result = await confirm({
			message: "Add session files to .gitignore?",
		});

		if (isCancel(result)) {
			shouldPatch = false;
		} else {
			shouldPatch = result;
		}
	}

	if (shouldPatch) {
		const newContent = `${existingContent}${GITIGNORE_ENTRIES.join("\n")}\n`;
		const validatedPath = PathValidator.safeResolvePath(".gitignore", options.cwd);
		AtomicWriter.writeFile(validatedPath, newContent, { skipGuard: true });
		log.success("Patched .gitignore with session entries.");
		return true;
	}

	return false;
}
