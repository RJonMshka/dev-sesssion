/**
 * The task-list plan source — for documents that are a checklist and nothing
 * else.
 *
 * A `TODO.md` with no headings is a plan; it is simply a plan with one chunk.
 * Before the registry, such a document yielded zero chunks and the CLI asked
 * the user to add `## Chunk 1` headings to it.
 *
 * @packageDocumentation
 */

import type { PlanChunk, Task } from "../../schemas/index.js";
import { parseHeading, parseTaskLine, scanLines } from "./markdown-utils.js";
import type { PlanParseResult, PlanSource, PlanSourceDetection } from "./types.js";

/** Title used for the single chunk a bare checklist produces. */
const SINGLE_CHUNK_TITLE = "Tasks";

/**
 * Collect every task in a document, ignoring fenced code blocks.
 *
 * @param content - The raw plan document.
 * @returns The tasks, in document order.
 */
function collectTasks(content: string): Task[] {
	const tasks: Task[] = [];
	for (const line of scanLines(content)) {
		if (line.inFence) {
			continue;
		}
		const task = parseTaskLine(line.trimmed);
		if (task !== undefined) {
			tasks.push(task);
		}
	}
	return tasks;
}

/**
 * Whether the document contains any heading outside a fenced code block.
 *
 * @param content - The raw plan document.
 * @returns `true` if at least one heading is present.
 */
function hasHeadings(content: string): boolean {
	return scanLines(content).some(
		(line) => !line.inFence && parseHeading(line.trimmed) !== undefined,
	);
}

/**
 * Parse a headings-free checklist into a single chunk.
 *
 * @param content - The raw plan document.
 * @returns One chunk holding every task, or no chunks if there are none.
 */
function parse(content: string): PlanParseResult {
	const tasks = collectTasks(content);
	if (tasks.length === 0) {
		return { chunks: [], excluded: [], warnings: [] };
	}

	const chunk: PlanChunk = {
		chunk_id: 1,
		title: SINGLE_CHUNK_TITLE,
		depends_on: [],
		tasks,
	};

	return { chunks: [chunk], excluded: [], warnings: [] };
}

/**
 * Score how well this source understands a document.
 *
 * Scores zero for anything with a heading, so it never competes with
 * {@link HeadingPlanSource} on a structured plan.
 *
 * @param content - The raw plan document.
 * @returns The confidence and its reason.
 */
function detect(content: string): PlanSourceDetection {
	if (hasHeadings(content)) {
		return { confidence: 0, reason: "document has headings" };
	}

	const taskCount = collectTasks(content).length;
	return taskCount > 0
		? { confidence: 0.5, reason: `${taskCount} task(s), no headings` }
		: { confidence: 0, reason: "no tasks" };
}

/** Plan source for heading-free task lists. */
export const TaskListPlanSource: PlanSource = {
	name: "task-list",
	displayName: "Flat task list",
	detect,
	parse,
} as const;
