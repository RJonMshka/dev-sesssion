/**
 * `dev-sesssion task done <n|text>` — tick one task of the active chunk
 * (LLD-task-done.md, REQ-TASK-1..8).
 *
 * Business logic lives in @dev-session/core: `TaskSelector` picks the task and
 * `SessionManager.markTaskDone` records it, the same write the MCP
 * `mark_task_done` tool makes. This module parses, prints and regenerates.
 *
 * @module
 */

import { log } from "@clack/prompts";
import { SessionManager, type Task, TaskSelector, TaskStatus } from "@dev-session/core";
import { PathValidator } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";
import { withStdoutOnStderr, writeJson } from "../utils/json-output.js";
import { regeneratePrompt } from "./regenerate-prompt.js";

/** Options for `task done`. */
export interface TaskDoneOptions {
	/** Project root. */
	readonly cwd: string;
	/** What the user typed: a 1-based number or task text. */
	readonly selector: string;
	/** Name the task and write nothing (REQ-TASK-7). */
	readonly dryRun: boolean;
	/** Show detailed output. */
	readonly verbose: boolean;
	/** Block the prompt write on a detected secret. */
	readonly strict: boolean;
	/** Explicit adapter override. */
	readonly adapter?: string;
}

/** A numbered task, as a refusal lists it. */
export interface NumberedTask {
	/** 1-based position in plan order. */
	readonly number: number;
	/** The task text. */
	readonly text: string;
	/** Its status. */
	readonly status: Task["status"];
}

/** What `task done` did; printed as-is under `--json` (REQ-TASK-6). */
export type TaskDoneResult =
	| {
			readonly ok: true;
			readonly number: number;
			readonly task: string;
			readonly alreadyDone: boolean;
			readonly done: number;
			readonly total: number;
			readonly chunkComplete: boolean;
	  }
	| { readonly ok: false; readonly error: string; readonly tasks: readonly NumberedTask[] };

/**
 * Marks one task of the active chunk done and regenerates the prompt.
 *
 * @param options - Selector, root and flags.
 * @returns The result; `ok: false` when the selector names no single task.
 * @throws {CliError} If there is no session.
 */
export function runTaskDone(options: TaskDoneOptions): TaskDoneResult {
	const manager = SessionManager.create(options.cwd);
	const { tasks } = manager.getActiveChunk();
	const picked = TaskSelector.resolve(tasks, options.selector);

	if (picked.kind !== "one") {
		const error =
			picked.kind === "none"
				? `No task of the active chunk matches "${options.selector}".`
				: `"${options.selector}" matches tasks ${picked.numbers.join(", ")}; name one by number.`;
		return refuse(error, tasks);
	}

	const { number, task } = picked;
	const alreadyDone = task.status === TaskStatus.DONE;
	if (alreadyDone) {
		log.info(`Task ${String(number)} is already done: ${task.text}`);
	} else if (options.dryRun) {
		log.info(`[dry-run] Would mark task ${String(number)} done: ${task.text}`);
	} else {
		manager.markTaskDone(task.text);
		regeneratePrompt(PathValidator.safeResolvePath(".session", options.cwd), {
			cwd: options.cwd,
			dryRun: false,
			verbose: options.verbose,
			blockOnSecrets: options.strict,
			...(options.adapter !== undefined ? { adapter: options.adapter } : {}),
		});
		log.success(`Marked task ${String(number)} done: ${task.text}`);
	}

	const after = options.dryRun ? tasks : manager.getActiveChunk().tasks;
	const done = after.filter((t) => t.status === TaskStatus.DONE || t.text === task.text).length;
	const chunkComplete = done === after.length;
	if (chunkComplete) {
		log.info("Every task in this chunk is done. Next: dev-sesssion advance");
	}
	return {
		ok: true,
		number,
		task: task.text,
		alreadyDone,
		done,
		total: after.length,
		chunkComplete,
	};
}

/**
 * Prints why no task was marked, with the numbered list (REQ-TASK-3).
 *
 * @param error - The reason.
 * @param tasks - The active chunk's tasks.
 * @returns The refusal.
 */
function refuse(error: string, tasks: readonly Task[]): TaskDoneResult {
	const numbered = tasks.map((t, i) => ({ number: i + 1, text: t.text, status: t.status }));
	log.error(error);
	log.message(
		numbered.length === 0
			? "The active chunk has no tasks."
			: numbered.map((t) => `${String(t.number)}. ${t.text} (${t.status})`).join("\n"),
	);
	return { ok: false, error, tasks: numbered };
}

/**
 * Register the `task` command and its `done` subcommand.
 *
 * @param program - The root Commander program
 */
export function registerTaskCommand(program: Command): void {
	const task = program.command("task").description("Work with the active chunk's tasks");

	task
		.command("done <task...>")
		.description("Mark a task of the active chunk done, by number or by text")
		.option("--json", "Output the result as machine-readable JSON", false)
		.action(async (words: string[], cmdOptions: { json?: boolean }) => {
			const opts = program.opts<{
				cwd: string;
				dryRun: boolean;
				verbose: boolean;
				strict: boolean;
				adapter?: string;
			}>();
			const run = (): TaskDoneResult =>
				runTaskDone({
					cwd: opts.cwd,
					selector: words.join(" "),
					dryRun: opts.dryRun,
					verbose: opts.verbose,
					strict: opts.strict,
					...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
				});
			try {
				// One JSON document on stdout; everything else to stderr (REQ-TASK-6).
				const result =
					cmdOptions.json === true ? await withStdoutOnStderr(async () => run()) : run();
				if (cmdOptions.json === true) writeJson(result);
				if (!result.ok) process.exitCode = 1;
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
