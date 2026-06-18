/**
 * `dev-sesssion status` command.
 *
 * Reads the session state, active plan chunk, and file index to display
 * a rich status overview: task completion percentage, context budget
 * breakdown, health warnings, and optional JSON output.
 *
 * Business logic lives in @dev-session/core — this module handles CLI
 * display formatting and Commander registration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "@clack/prompts";
import {
	type ContextBudget,
	ContextBudgetCalculator,
	type FileIndexEntry,
	FileIndexManager,
	MAX_PROMPT_LINES,
	NextPromptWriter,
	type PlanChunk,
	PlanChunkManager,
	SessionMemoryManager,
	type SessionState,
	SessionStateManager,
	type Task,
	TaskStatus,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

/** Options passed from Commander to the status action. */
export interface StatusOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Output machine-readable JSON. */
	readonly json: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
}

/** JSON-serializable status output for --json flag. */
export interface StatusJson {
	readonly active_chunk: number;
	readonly chunk_title: string;
	readonly session_id: string;
	readonly last_updated: string;
	readonly tasks: {
		readonly total: number;
		readonly done: number;
		readonly in_progress: number;
		readonly todo: number;
		readonly percent_complete: number;
	};
	readonly files: {
		readonly always_include: number;
		readonly indexed: number;
		readonly context: number;
	};
	readonly budget: {
		readonly total_tokens: number;
		readonly budget_cap: number;
		readonly over_budget: boolean;
		readonly accurate: boolean;
	};
	readonly warnings: readonly string[];
	readonly days_since_last_session: number | null;
	readonly memory?: {
		readonly totalSessions: number;
		readonly avgTokens: number;
		readonly firstDate: string | null;
		readonly lastDate: string | null;
	};
}

/**
 * Compute warnings for the current session state.
 *
 * @param state - The current session state
 * @param chunk - The active plan chunk
 * @param alwaysInclude - Always-include entries from the file index
 * @param promptValidation - Result of validating NEXT_PROMPT.md
 * @param budget - Computed context budget
 * @returns Array of warning strings
 */
export function computeWarnings(
	_state: SessionState,
	chunk: PlanChunk,
	alwaysInclude: readonly FileIndexEntry[],
	promptLineCount: number | undefined,
	budget: ContextBudget,
): readonly string[] {
	const warnings: string[] = [];

	if (promptLineCount !== undefined && promptLineCount > MAX_PROMPT_LINES) {
		warnings.push(
			`NEXT_PROMPT.md has ${String(promptLineCount)} lines (max ${String(MAX_PROMPT_LINES)}) — consider regenerating`,
		);
	}

	if (alwaysInclude.length > 4) {
		warnings.push(
			`always-include list has ${String(alwaysInclude.length)} files — creep detected (recommend <= 4)`,
		);
	}

	if (budget.overBudget) {
		warnings.push(
			`Context budget exceeded: ~${String(budget.totalTokens)} / ${String(budget.budgetCap)} tokens — remove large files or split the chunk`,
		);
	}

	// Warn if all tasks are done but chunk hasn't been advanced
	const allDone = chunk.tasks.length > 0 && chunk.tasks.every((t) => t.status === TaskStatus.DONE);
	if (allDone) {
		warnings.push(
			"All tasks in active chunk are done — run `dev-sesssion advance` to move to the next chunk",
		);
	}

	return warnings;
}

/**
 * Count days since the last session update.
 *
 * @param lastUpdated - ISO date string from SessionState
 * @returns Number of days, or null if the date is unparseable
 */
export function daysSinceLastSession(lastUpdated: string): number | null {
	const date = new Date(lastUpdated);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Count tasks by status.
 *
 * @param tasks - Array of tasks from state + chunk
 * @returns Counts per status category
 */
export function countTasks(tasks: readonly Task[]): {
	total: number;
	done: number;
	inProgress: number;
	todo: number;
	percentComplete: number;
} {
	let done = 0;
	let inProgress = 0;
	let todo = 0;

	for (const task of tasks) {
		switch (task.status) {
			case TaskStatus.DONE:
				done++;
				break;
			case TaskStatus.IN_PROGRESS:
				inProgress++;
				break;
			case TaskStatus.TODO:
				todo++;
				break;
		}
	}

	const total = tasks.length;
	const percentComplete = total > 0 ? Math.round((done / total) * 100) : 0;

	return { total, done, inProgress, todo, percentComplete };
}

/**
 * Read NEXT_PROMPT.md line count, or undefined if the file doesn't exist.
 *
 * @param sessionDir - Validated path to .session/
 * @returns Line count or undefined
 */
function readPromptLineCount(sessionDir: ValidatedPath): number | undefined {
	const promptPath = path.join(sessionDir, "NEXT_PROMPT.md");
	try {
		const content = fs.readFileSync(promptPath, "utf-8");
		const validation = NextPromptWriter.validate(content);
		return validation.lineCount;
	} catch {
		return undefined;
	}
}

/**
 * Build the full StatusJson object.
 *
 * @param state - Session state
 * @param chunk - Active plan chunk
 * @param allEntries - All file index entries
 * @param alwaysInclude - Always-include entries
 * @param chunkFiles - Files for the active chunk
 * @param budget - Context budget
 * @param warnings - Computed warnings
 * @returns StatusJson
 */
export function buildStatusJson(
	state: SessionState,
	chunk: PlanChunk,
	allEntries: readonly FileIndexEntry[],
	alwaysInclude: readonly FileIndexEntry[],
	chunkFiles: readonly FileIndexEntry[],
	budget: ContextBudget,
	warnings: readonly string[],
	memoryStats?: {
		totalSessions: number;
		avgTokens: number;
		firstDate: string | null;
		lastDate: string | null;
	},
): StatusJson {
	const taskCounts = countTasks(chunk.tasks);

	return {
		active_chunk: state.active_chunk,
		chunk_title: chunk.title,
		session_id: state.session_id,
		last_updated: state.last_updated,
		tasks: {
			total: taskCounts.total,
			done: taskCounts.done,
			in_progress: taskCounts.inProgress,
			todo: taskCounts.todo,
			percent_complete: taskCounts.percentComplete,
		},
		files: {
			always_include: alwaysInclude.length,
			indexed: allEntries.length,
			context: chunkFiles.length,
		},
		budget: {
			total_tokens: budget.totalTokens,
			budget_cap: budget.budgetCap,
			over_budget: budget.overBudget,
			accurate: budget.accurate,
		},
		warnings,
		days_since_last_session: daysSinceLastSession(state.last_updated),
		...(memoryStats !== undefined ? { memory: memoryStats } : {}),
	};
}

/**
 * Display human-readable status output.
 *
 * @param status - The computed status JSON
 * @param budget - The full context budget (for formatSummary)
 * @param verbose - Whether to show detailed output
 */
export function displayStatus(status: StatusJson, budget: ContextBudget, verbose: boolean): void {
	log.info(`Active chunk: ${String(status.active_chunk)} — ${status.chunk_title}`);
	log.info(`Session: ${status.session_id}`);
	log.info(`Last updated: ${status.last_updated}`);

	const days = status.days_since_last_session;
	if (days !== null) {
		const label = days === 0 ? "today" : days === 1 ? "1 day ago" : `${String(days)} days ago`;
		log.info(`Last session: ${label}`);
	}

	// Task completion
	const bar = renderProgressBar(status.tasks.percent_complete, 20);
	log.info(
		`Tasks: ${bar} ${String(status.tasks.percent_complete)}% (${String(status.tasks.done)}/${String(status.tasks.total)} done)`,
	);

	if (verbose) {
		if (status.tasks.in_progress > 0) {
			log.info(`  In progress: ${String(status.tasks.in_progress)}`);
		}
		if (status.tasks.todo > 0) {
			log.info(`  Todo: ${String(status.tasks.todo)}`);
		}
	}

	// Files
	log.info(
		`Files: ${String(status.files.context)} in context, ${String(status.files.always_include)} always-include, ${String(status.files.indexed)} indexed`,
	);

	// Budget
	log.info(ContextBudgetCalculator.formatSummary(budget));

	// Session memory summary
	if (status.memory !== undefined) {
		const m = status.memory;
		if (m.totalSessions === 0) {
			log.info("Session memory: no entries yet");
		} else {
			log.info(
				`Session memory: ${String(m.totalSessions)} session${m.totalSessions === 1 ? "" : "s"} recorded, avg ~${String(m.avgTokens)} tokens`,
			);
		}
	}

	// Warnings
	for (const warning of status.warnings) {
		log.warn(warning);
	}
}

/**
 * Render a simple ASCII progress bar.
 *
 * @param percent - Completion percentage (0-100)
 * @param width - Bar width in characters
 * @returns Progress bar string like "[=========>          ]"
 */
export function renderProgressBar(percent: number, width: number): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	const bar = "=".repeat(Math.max(0, filled - 1));
	const tip = filled > 0 ? ">" : "";
	const space = " ".repeat(empty);
	return `[${bar}${tip}${space}]`;
}

/**
 * Execute the status command.
 *
 * @param options - Resolved CLI options
 * @throws CliError if no session is found
 */
export async function runStatus(options: StatusOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	// Load state + chunk + file index
	const state = SessionStateManager.load(sessionDir);
	const chunk = PlanChunkManager.loadActive(sessionDir, state);
	const allEntries = FileIndexManager.load(sessionDir);
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	const chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	// Compute context budget
	const budget = ContextBudgetCalculator.estimate(state, chunk, chunkFiles, alwaysInclude);

	// Check NEXT_PROMPT.md health
	const promptLineCount = readPromptLineCount(sessionDir);

	// Compute warnings
	const warnings = computeWarnings(state, chunk, alwaysInclude, promptLineCount, budget);

	// Load memory stats (best-effort — no error if log missing)
	const memoryEntries = SessionMemoryManager.load(sessionDir);
	const memoryStats = SessionMemoryManager.summarizeStats(memoryEntries);

	// Build status object
	const status = buildStatusJson(
		state,
		chunk,
		allEntries,
		alwaysInclude,
		chunkFiles,
		budget,
		warnings,
		{
			totalSessions: memoryStats.totalSessions,
			avgTokens: memoryStats.avgTokens,
			firstDate: memoryStats.firstDate,
			lastDate: memoryStats.lastDate,
		},
	);

	if (options.json) {
		// Machine-readable output — no ANSI, just JSON to stdout
		process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
		return;
	}

	displayStatus(status, budget, options.verbose);
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
			suggestion: "Run `dev-sesssion init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

/**
 * Register the `status` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerStatusCommand(program: Command): void {
	program
		.command("status")
		.description("Show session status: task progress, context budget, and health warnings")
		.option("--json", "Output machine-readable JSON", false)
		.action(async (_cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				verbose: boolean;
			}>();

			const statusOptions: StatusOptions = {
				cwd: opts.cwd,
				json: _cmdOptions.json ?? false,
				verbose: opts.verbose,
			};

			try {
				await runStatus(statusOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
