/**
 * `dev-session update` command.
 *
 * Interactive task marking, note adding, "last worked" file updates,
 * prompt regeneration, and secret scanning. In `--yes` mode, only
 * auto-detectable updates are applied (git status for last-worked files).
 *
 * Business logic lives in @dev-session/core — this module handles CLI
 * prompts, formatting, and file write orchestration.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { cancel, isCancel, log, multiselect, text } from "@clack/prompts";
import {
	type BootstrapContext,
	ContextBudgetCalculator,
	type ContextLogEntry,
	FileIndexManager,
	NextPromptWriter,
	type PlanChunk,
	PlanChunkManager,
	SessionMemoryManager,
	SessionStateManager,
	type Task,
	TaskStatus,
} from "@dev-session/core";
import { CliError, PathValidator, SecretScanner, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { createAdapterReadFile } from "../utils/adapter-io.js";
import { handleError } from "../utils/error-handler.js";
import { resolveAdapter } from "../utils/resolve-adapter.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the update action. */
export interface UpdateOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Skip prompts and apply auto-detectable updates only. */
	readonly yes: boolean;
	/** Show detailed output. */
	readonly verbose: boolean;
	/** Enable strict mode (block on secret detection). */
	readonly strict: boolean;
	/** Explicit adapter override (from --adapter flag). */
	readonly adapter?: string;
}

/** Result returned after an update run. */
export interface UpdateResult {
	/** Number of tasks whose status was changed. */
	readonly tasksUpdated: number;
	/** Number of notes added. */
	readonly notesAdded: number;
	/** Whether the last-worked file list was changed. */
	readonly lastWorkedUpdated: boolean;
	/** Whether NEXT_PROMPT.md was regenerated. */
	readonly promptRegenerated: boolean;
	/** Number of secret scan warnings found. */
	readonly secretWarnings: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute the update command.
 *
 * @param options - Resolved CLI options
 * @returns Update result summary
 * @throws CliError if no session is found or user cancels
 */
export async function runUpdate(options: UpdateOptions): Promise<UpdateResult> {
	const sessionDir = resolveSessionDir(options.cwd);

	// Load current state
	let state = SessionStateManager.load(sessionDir);
	const chunk = PlanChunkManager.loadActive(sessionDir, state);
	const allEntries = FileIndexManager.load(sessionDir);

	let tasksUpdated = 0;
	let notesAdded = 0;
	let lastWorkedUpdated = false;

	// -----------------------------------------------------------------------
	// Step 1: Interactive task marking
	// -----------------------------------------------------------------------
	if (!options.yes && chunk.tasks.length > 0) {
		const taskResult = await promptTaskUpdates(chunk.tasks);
		if (taskResult.changed) {
			// Apply changes to state
			for (const update of taskResult.updates) {
				if (update.newStatus === TaskStatus.DONE) {
					state = SessionStateManager.markTaskDone(state, update.text);
				} else if (update.newStatus === TaskStatus.IN_PROGRESS) {
					state = SessionStateManager.markTaskInProgress(state, update.text);
				}
				tasksUpdated++;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Step 2: Add session notes
	// -----------------------------------------------------------------------
	if (!options.yes) {
		const noteResult = await promptAddNote();
		if (noteResult !== undefined) {
			state = SessionStateManager.addNote(state, noteResult);
			notesAdded++;
		}
	}

	// -----------------------------------------------------------------------
	// Step 3: Update "last worked" files (auto-suggest from git status)
	// -----------------------------------------------------------------------
	const gitFiles = await getGitModifiedFiles(options.cwd);

	if (gitFiles.length > 0) {
		let selectedFiles: readonly string[];

		if (options.yes) {
			selectedFiles = gitFiles;
		} else {
			selectedFiles = await promptLastWorkedFiles(gitFiles, state.last_worked_files);
		}

		if (selectedFiles.length > 0) {
			state = SessionStateManager.updateLastWorked(state, selectedFiles);
			lastWorkedUpdated = true;
		}
	}

	// -----------------------------------------------------------------------
	// Step 4: Save state
	// -----------------------------------------------------------------------
	SessionStateManager.save(sessionDir, state);

	if (options.verbose) {
		log.info(`Tasks updated: ${String(tasksUpdated)}`);
		log.info(`Notes added: ${String(notesAdded)}`);
		log.info(`Last-worked files updated: ${lastWorkedUpdated ? "yes" : "no"}`);
	}

	// -----------------------------------------------------------------------
	// Step 5: Regenerate NEXT_PROMPT.md
	// -----------------------------------------------------------------------
	const alwaysInclude = FileIndexManager.alwaysInclude(allEntries);
	const chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);
	const allChunks = PlanChunkManager.loadAll(sessionDir);

	const budget = ContextBudgetCalculator.estimate(state, chunk, chunkFiles, alwaysInclude);

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
		chunk,
		chunkFiles,
		alwaysIncludeFiles: alwaysInclude,
		budget,
		excludePatterns,
		projectName,
	};

	const promptContent = NextPromptWriter.generateWithFormatter(adapter.formatter, bootstrapContext);

	// -----------------------------------------------------------------------
	// Step 6: Secret scan before writing
	// -----------------------------------------------------------------------
	let secretWarnings = 0;
	secretWarnings += scanContent(promptContent, "NEXT_PROMPT.md", options.verbose);

	if (secretWarnings > 0 && options.strict) {
		throw new CliError({
			message: `Secret scan found ${String(secretWarnings)} issue${secretWarnings === 1 ? "" : "s"} — blocking write in strict mode`,
			suggestion: "Remove secrets from session state or notes, then retry.",
		});
	}

	// -----------------------------------------------------------------------
	// Step 7: Write regenerated prompt
	// -----------------------------------------------------------------------
	NextPromptWriter.write(sessionDir, promptContent);

	log.info(ContextBudgetCalculator.formatSummary(budget));

	if (!options.yes) {
		log.success("Session updated and NEXT_PROMPT.md regenerated.");
	}

	// -----------------------------------------------------------------------
	// Step 8: Append context log entry
	// -----------------------------------------------------------------------
	const logEntry: ContextLogEntry = {
		session_id: state.session_id,
		timestamp: new Date().toISOString(),
		active_chunk: state.active_chunk,
		files_loaded: [...alwaysInclude.map((e) => e.filepath), ...chunkFiles.map((e) => e.filepath)],
		total_tokens: budget.totalTokens,
		modifications: [...state.last_worked_files],
	};
	SessionMemoryManager.append(sessionDir, logEntry);

	return {
		tasksUpdated,
		notesAdded,
		lastWorkedUpdated,
		promptRegenerated: true,
		secretWarnings,
	};
}

// ---------------------------------------------------------------------------
// Interactive prompts
// ---------------------------------------------------------------------------

/** A single task status change. */
interface TaskUpdate {
	readonly text: string;
	readonly newStatus: string;
}

/** Result from the task update prompt. */
interface TaskUpdateResult {
	readonly changed: boolean;
	readonly updates: readonly TaskUpdate[];
}

/**
 * Prompt the user to mark tasks as done.
 *
 * @param tasks - Current task list from the chunk
 * @returns Task update result
 */
async function promptTaskUpdates(tasks: readonly Task[]): Promise<TaskUpdateResult> {
	const pendingTasks = tasks.filter((t) => t.status !== TaskStatus.DONE);

	if (pendingTasks.length === 0) {
		log.info("All tasks are already done.");
		return { changed: false, updates: [] };
	}

	// Ask which tasks to mark done
	const doneResult = await multiselect({
		message: "Mark tasks as done (space to toggle, enter to confirm):",
		options: pendingTasks.map((t) => ({
			value: t.text,
			label: `[${t.status === TaskStatus.IN_PROGRESS ? "~" : " "}] ${t.text}`,
		})),
		required: false,
	});

	if (isCancel(doneResult)) {
		cancel("Update cancelled.");
		throw new CliError({ message: "Update cancelled by user." });
	}

	const doneTexts = new Set(doneResult as string[]);
	const updates: TaskUpdate[] = [];

	for (const taskText of doneTexts) {
		updates.push({ text: taskText, newStatus: TaskStatus.DONE });
	}

	// For remaining pending tasks, ask if any should be marked in-progress
	const remainingPending = pendingTasks.filter(
		(t) => !doneTexts.has(t.text) && t.status === TaskStatus.TODO,
	);

	if (remainingPending.length > 0) {
		const inProgressResult = await multiselect({
			message: "Mark tasks as in-progress (optional):",
			options: remainingPending.map((t) => ({
				value: t.text,
				label: t.text,
			})),
			required: false,
		});

		if (!isCancel(inProgressResult)) {
			for (const taskText of inProgressResult as string[]) {
				updates.push({ text: taskText, newStatus: TaskStatus.IN_PROGRESS });
			}
		}
	}

	return { changed: updates.length > 0, updates };
}

/**
 * Prompt the user to add a session note.
 *
 * @returns The note text, or undefined if skipped
 */
async function promptAddNote(): Promise<string | undefined> {
	const noteResult = await text({
		message: "Add a session note (leave empty to skip):",
		initialValue: "",
	});

	if (isCancel(noteResult)) {
		return undefined;
	}

	const note = (noteResult as string).trim();
	return note.length > 0 ? note : undefined;
}

/**
 * Prompt the user to select which git-modified files to record.
 *
 * @param gitFiles - Files modified according to git status
 * @param currentFiles - Currently tracked last-worked files
 * @returns Selected file paths
 */
async function promptLastWorkedFiles(
	gitFiles: readonly string[],
	currentFiles: readonly string[],
): Promise<readonly string[]> {
	const currentSet = new Set(currentFiles);

	const result = await multiselect({
		message: "Update last-worked files from git changes:",
		options: gitFiles.map((f) => {
			const opt: { value: string; label: string; hint?: string } = {
				value: f,
				label: f,
			};
			if (currentSet.has(f)) {
				opt.hint = "already tracked";
			}
			return opt;
		}),
		required: false,
		initialValues: gitFiles.filter((f) => currentSet.has(f)),
	});

	if (isCancel(result)) {
		return currentFiles;
	}

	return result as string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get modified files from git status.
 *
 * @param cwd - Working directory
 * @returns Array of relative file paths
 */
export async function getGitModifiedFiles(cwd: string): Promise<readonly string[]> {
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--short"], { cwd });

		return stdout
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => line.slice(3).trim())
			.filter((f) => f.length > 0);
	} catch {
		// Not a git repo or git not available — return empty
		return [];
	}
}

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
 * Scan content for secrets and log warnings.
 *
 * @param content - The content to scan
 * @param filename - The filename (for logging)
 * @param verbose - Whether to log individual findings
 * @returns Number of warnings found
 */
function scanContent(content: string, filename: string, verbose: boolean): number {
	const results = SecretScanner.scan(content);
	if (results.length > 0) {
		log.warn(
			`Secret scan found ${String(results.length)} issue${results.length === 1 ? "" : "s"} in ${filename}`,
		);
		if (verbose) {
			for (const r of results) {
				log.message(`  Line ${String(r.line)}: ${r.pattern} (${r.redacted})`);
			}
		}
	}
	return results.length;
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
 * Register the `update` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerUpdateCommand(program: Command): void {
	program
		.command("update")
		.description("Interactively update task status, add notes, and regenerate the prompt")
		.action(async () => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
				strict: boolean;
				adapter?: string;
			}>();

			const updateOptions: UpdateOptions = {
				cwd: opts.cwd,
				yes: opts.yes,
				verbose: opts.verbose,
				strict: opts.strict,
				...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
			};

			try {
				await runUpdate(updateOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
