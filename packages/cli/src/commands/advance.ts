/**
 * `dev-session advance` command.
 *
 * Archives the current chunk, compacts session state, advances to the
 * next chunk, and regenerates NEXT_PROMPT.md. Warns if not all tasks in
 * the active chunk are done, prompting for confirmation to force-advance.
 *
 * Business logic lives in @dev-session/core — this module handles CLI
 * prompts, formatting, and orchestration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, confirm, isCancel, log } from "@clack/prompts";
import {
	type BootstrapContext,
	ContextBudgetCalculator,
	FileIndexManager,
	NextPromptWriter,
	type PlanChunk,
	PlanChunkManager,
	SessionStateManager,
	TaskStatus,
	TrimOverridesManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { createAdapterReadFile } from "../utils/adapter-io.js";
import { handleError } from "../utils/error-handler.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the advance action. */
export interface AdvanceOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Skip prompts and force-advance even with incomplete tasks. */
	readonly yes: boolean;
	/** Show detailed output. */
	readonly verbose: boolean;
	/** Explicit adapter override (from --adapter flag). */
	readonly adapter?: string;
}

/** Result returned after an advance run. */
export interface AdvanceResult {
	/** The chunk ID that was archived. */
	readonly archivedChunkId: number;
	/** The new active chunk ID. */
	readonly newChunkId: number;
	/** Title of the new active chunk. */
	readonly newChunkTitle: string;
	/** Number of tasks remaining in the new chunk. */
	readonly tasksRemaining: number;
	/** Whether a force-advance was needed (incomplete tasks). */
	readonly forceAdvanced: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the advance command.
 *
 * @param options - Resolved CLI options
 * @returns Advance result summary
 * @throws CliError if no session is found, user cancels, or no next chunk
 */
export async function runAdvance(options: AdvanceOptions): Promise<AdvanceResult> {
	const sessionDir = resolveSessionDir(options.cwd);

	// Load current state
	let state = SessionStateManager.load(sessionDir);
	const currentChunk = PlanChunkManager.loadActive(sessionDir, state);
	const allChunks = PlanChunkManager.loadAll(sessionDir);
	const allEntries = FileIndexManager.load(sessionDir);

	const currentChunkId = state.active_chunk;

	// -----------------------------------------------------------------------
	// Step 1: Check task completion
	// -----------------------------------------------------------------------
	const isComplete = PlanChunkManager.isComplete(currentChunk);
	let forceAdvanced = false;

	if (!isComplete) {
		const doneCount = currentChunk.tasks.filter((t) => t.status === TaskStatus.DONE).length;
		const totalCount = currentChunk.tasks.length;

		log.warn(
			`Chunk ${String(currentChunkId)} has incomplete tasks: ${String(doneCount)}/${String(totalCount)} done`,
		);

		if (options.yes) {
			log.warn("Force-advancing in --yes mode.");
			forceAdvanced = true;
		} else {
			const forceResult = await confirm({
				message: "Force advance with incomplete tasks?",
			});

			if (isCancel(forceResult) || !forceResult) {
				cancel("Advance cancelled.");
				throw new CliError({
					message: "Advance cancelled — complete tasks first or use --yes to force.",
				});
			}
			forceAdvanced = true;
		}
	}

	// -----------------------------------------------------------------------
	// Step 2: Verify next chunk exists
	// -----------------------------------------------------------------------
	const nextChunkId = currentChunkId + 1;
	const nextChunkExists = allChunks.some((c) => c.chunk_id === nextChunkId);

	if (!nextChunkExists) {
		throw new CliError({
			message: `No PLAN_${String(nextChunkId)}.md found — cannot advance beyond the last chunk.`,
			suggestion: "All chunks are complete. Consider running `dev-session status` to review.",
		});
	}

	// -----------------------------------------------------------------------
	// Step 3: Archive the completed chunk
	// -----------------------------------------------------------------------
	PlanChunkManager.archive(sessionDir, currentChunk);

	if (options.verbose) {
		log.info(`Archived chunk ${String(currentChunkId)} to DONE_LOG.md`);
	}

	// -----------------------------------------------------------------------
	// Step 4: Compact session state
	// -----------------------------------------------------------------------
	state = SessionStateManager.compact(state);

	if (options.verbose) {
		log.info("Compacted session state.");
	}

	// -----------------------------------------------------------------------
	// Step 5: Advance to next chunk
	// -----------------------------------------------------------------------
	state = PlanChunkManager.advance(state);
	SessionStateManager.save(sessionDir, state);

	// -----------------------------------------------------------------------
	// Step 6: Load the new chunk and regenerate NEXT_PROMPT.md
	// -----------------------------------------------------------------------
	const newChunk = PlanChunkManager.loadActive(sessionDir, state);
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	const chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	const budget = ContextBudgetCalculator.estimate(state, newChunk, chunkFiles, alwaysInclude);

	const excludePatterns = buildExcludePatterns(state.active_chunk, allChunks);
	const projectName = detectProjectName(options.cwd);

	// Resolve adapter (flag → detect → fallback)
	const { adapter, tool: detectedTool, source } = resolveAdapter(options.cwd, options.adapter);

	if (options.verbose) {
		log.info(`Using ${adapter.config.display_name} adapter (${source}: ${detectedTool})`);
	}

	// Run transformState hook if the adapter provides one
	if (adapter.transformState) {
		const readFile = createAdapterReadFile(options.cwd);
		state = adapter.transformState(state, {
			projectRoot: options.cwd,
			sessionDir,
			readFile,
		});
	}

	const bootstrapContext: BootstrapContext = {
		state,
		chunk: newChunk,
		chunkFiles,
		alwaysIncludeFiles: alwaysInclude,
		budget,
		excludePatterns,
		projectName,
	};

	const promptContent = NextPromptWriter.generateWithFormatter(adapter.formatter, bootstrapContext);

	NextPromptWriter.write(sessionDir, promptContent);

	// -----------------------------------------------------------------------
	// Step 7: Clear trim overrides (session-scoped, reset on advance)
	// -----------------------------------------------------------------------
	TrimOverridesManager.clear(sessionDir);

	if (options.verbose) {
		log.info("Cleared trim overrides for new chunk.");
	}

	// -----------------------------------------------------------------------
	// Step 8: Display result
	// -----------------------------------------------------------------------
	const tasksRemaining = newChunk.tasks.filter((t) => t.status !== TaskStatus.DONE).length;

	log.success(
		`Advanced to PLAN_${String(newChunk.chunk_id)}.md. ${String(tasksRemaining)} task${tasksRemaining === 1 ? "" : "s"} remaining in this chunk.`,
	);

	log.info(ContextBudgetCalculator.formatSummary(budget));

	return {
		archivedChunkId: currentChunkId,
		newChunkId: newChunk.chunk_id,
		newChunkTitle: newChunk.title,
		tasksRemaining,
		forceAdvanced,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect project name from package.json.
 *
 * @param cwd - Working directory
 * @returns Project name or directory basename
 */
function detectProjectName(cwd: string): string {
	try {
		const pkgPath = path.join(cwd, "package.json");
		const raw = fs.readFileSync(pkgPath, "utf-8");
		const pkg: unknown = JSON.parse(raw);
		if (
			typeof pkg === "object" &&
			pkg !== null &&
			"name" in pkg &&
			typeof (pkg as Record<string, unknown>).name === "string"
		) {
			return (pkg as Record<string, unknown>).name as string;
		}
	} catch {
		// No package.json or invalid JSON
	}
	return path.basename(cwd);
}

/**
 * Build exclude patterns for NEXT_PROMPT generation.
 *
 * @param activeChunkId - The currently active chunk ID
 * @param chunks - All available chunks
 * @returns Array of exclude pattern strings
 */
function buildExcludePatterns(
	activeChunkId: number,
	chunks: readonly PlanChunk[],
): readonly string[] {
	const patterns: string[] = ["**/__tests__/**", "**/dist/**", "**/node_modules/**"];

	for (const chunk of chunks) {
		if (chunk.chunk_id !== activeChunkId) {
			patterns.push(`.session/PLAN_${String(chunk.chunk_id)}.md`);
		}
	}

	return patterns;
}

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
 * Register the `advance` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerAdvanceCommand(program: Command): void {
	program
		.command("advance")
		.description("Archive current chunk and advance to the next one")
		.action(async () => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
				adapter?: string;
			}>();

			const advanceOptions: AdvanceOptions = {
				cwd: opts.cwd,
				yes: opts.yes,
				verbose: opts.verbose,
				...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
			};

			try {
				await runAdvance(advanceOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
