/**
 * `dev-sesssion advance` command.
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
	CONTEXT_LOG_FILENAME,
	ContextBudgetCalculator,
	type ContextLogEntry,
	DONE_LOG_FILENAME,
	FileIndexManager,
	PlanChunkManager,
	SessionMemoryManager,
	SessionStateManager,
	TaskStatus,
	TrimOverridesManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { dryRunSkipWrite } from "../utils/dry-run.js";
import { handleError } from "../utils/error-handler.js";
import { withStdoutOnStderr, writeJson } from "../utils/json-output.js";
import { regeneratePrompt } from "./regenerate-prompt.js";
import { withSessionBase } from "./touch-tagging.js";

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
	/** Report what would change without touching the filesystem. */
	readonly dryRun?: boolean;
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
	/**
	 * True when there is no next chunk to advance to — the current chunk is the
	 * last one. This is a clean terminal state (exit 0), not an error: no archive
	 * or advance is performed and `newChunkId` equals the current chunk.
	 */
	readonly allChunksComplete: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the advance command.
 *
 * When the active chunk is the last one, this resolves with
 * `allChunksComplete: true` (a clean terminal state) rather than throwing — so
 * scripts and CI see exit 0, not a failure.
 *
 * @param options - Resolved CLI options
 * @returns Advance result summary
 * @throws CliError if no session is found or the user cancels
 */
export async function runAdvance(options: AdvanceOptions): Promise<AdvanceResult> {
	const sessionDir = resolveSessionDir(options.cwd);

	let state = SessionStateManager.load(sessionDir);
	const currentChunk = PlanChunkManager.loadActive(sessionDir, state);
	const allChunks = PlanChunkManager.loadAll(sessionDir);
	const allEntries = FileIndexManager.load(sessionDir);

	const currentChunkId = state.active_chunk;

	// Step 1: Check task completion
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
			// A harness cannot answer the prompt, so without a TTY it would hang
			// forever. Fail before anything is written (REQ-ORC-2).
			if (process.stdin.isTTY !== true) {
				throw new CliError({
					message: `Chunk ${String(currentChunkId)} has incomplete tasks and stdin is not a terminal, so advance cannot ask to confirm.`,
					suggestion: "Mark the tasks done first, or pass --yes to advance with them incomplete.",
				});
			}
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

	// Step 2: Verify next chunk exists
	// The lowest id above this one, so 3.5 is not skipped and a gap is crossed (REQ-ORC-6, 7).
	const nextChunk = PlanChunkManager.nextAfter(allChunks, currentChunkId);

	if (nextChunk === undefined) {
		// Reaching the last chunk is a clean terminal state, not an error: nothing
		// to archive or advance to. Return a passing result so callers exit 0.
		log.success(
			`Chunk ${String(currentChunkId)} is the last chunk — no higher-numbered PLAN_<n>.md to advance to.`,
		);
		log.info("All chunks complete. Run `dev-sesssion status` to review.");

		return {
			archivedChunkId: currentChunkId,
			newChunkId: currentChunkId,
			newChunkTitle: currentChunk.title,
			tasksRemaining: currentChunk.tasks.filter((t) => t.status !== TaskStatus.DONE).length,
			forceAdvanced,
			allChunksComplete: true,
		};
	}

	// Step 3: Archive the completed chunk
	const dryRun = options.dryRun === true;
	if (dryRun) {
		dryRunSkipWrite(
			path.join(sessionDir, DONE_LOG_FILENAME),
			options.cwd,
			`archive chunk ${String(currentChunkId)}`,
		);
	} else {
		PlanChunkManager.archive(sessionDir, currentChunk);
	}

	if (options.verbose) {
		log.info(`Archived chunk ${String(currentChunkId)} to DONE_LOG.md`);
	}

	// Step 4: Compact session state
	state = SessionStateManager.compact(state);

	if (options.verbose) {
		log.info("Compacted session state.");
	}

	// Step 5: Advance to next chunk
	// State's task list follows the chunk, so MCP and `update` see the new
	// chunk's tasks, not the archived one's (REQ-WF-9).
	state = {
		...PlanChunkManager.advance(state, nextChunk.chunk_id),
		tasks: [...nextChunk.tasks],
	};
	// A fresh base, and no tags: a completed chunk loads nothing, and tagging
	// the next one would guess that work carries over (REQ-IDX-19, -41).
	state = await withSessionBase(state, options.cwd);
	if (dryRun) {
		dryRunSkipWrite(
			path.join(sessionDir, "SESSION_STATE.md"),
			options.cwd,
			`active_chunk -> ${String(state.active_chunk)}`,
		);
	} else {
		SessionStateManager.save(sessionDir, state);
	}

	// Step 6: Clear trim overrides (session-scoped, reset on advance) before the
	// new prompt is built, so the new chunk starts with none (REQ-RUN-20).
	if (!dryRun) {
		TrimOverridesManager.clear(sessionDir);
	}

	if (options.verbose) {
		log.info("Cleared trim overrides for new chunk.");
	}

	// Step 7: Load the new chunk and regenerate NEXT_PROMPT.md
	const newChunk = PlanChunkManager.loadActive(sessionDir, state);
	const {
		budget,
		chunkFiles,
		alwaysIncludeFiles: alwaysInclude,
	} = regeneratePrompt(sessionDir, {
		cwd: options.cwd,
		dryRun,
		verbose: options.verbose,
		blockOnSecrets: false,
		...(options.adapter !== undefined ? { adapter: options.adapter } : {}),
		state,
		chunk: newChunk,
		allChunks,
		entries: allEntries,
		excluded: [],
	});

	// Step 7b: Append context log entry for the completed chunk
	const logEntry: ContextLogEntry = {
		session_id: state.session_id,
		timestamp: new Date().toISOString(),
		active_chunk: newChunk.chunk_id,
		files_loaded: [...alwaysInclude.map((e) => e.filepath), ...chunkFiles.map((e) => e.filepath)],
		total_tokens: budget.totalTokens,
		modifications: [...state.last_worked_files],
	};
	if (dryRun) {
		dryRunSkipWrite(path.join(sessionDir, CONTEXT_LOG_FILENAME), options.cwd, "1 log entry");
	} else {
		SessionMemoryManager.append(sessionDir, logEntry);
	}

	// Step 8: Display result
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
		allChunksComplete: false,
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

/**
 * Register the `advance` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerAdvanceCommand(program: Command): void {
	program
		.command("advance")
		.description("Archive current chunk and advance to the next one")
		.option("--json", "Output the result as machine-readable JSON", false)
		.action(async (cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
				dryRun: boolean;
				adapter?: string;
			}>();

			const advanceOptions: AdvanceOptions = {
				cwd: opts.cwd,
				yes: opts.yes,
				verbose: opts.verbose,
				dryRun: opts.dryRun,
				...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
			};

			if (cmdOptions.json !== true) {
				try {
					await runAdvance(advanceOptions);
				} catch (error: unknown) {
					handleError(error);
				}
				return;
			}

			// One JSON document on stdout; progress and errors go to stderr (REQ-ORC-1).
			const result = await withStdoutOnStderr(async () => {
				try {
					return await runAdvance(advanceOptions);
				} catch (error: unknown) {
					handleError(error);
					return undefined;
				}
			});
			if (result !== undefined) writeJson(result);
		});
}
