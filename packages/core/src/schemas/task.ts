import { z } from "zod";

/**
 * Valid task status values.
 *
 * - `todo` — not yet started
 * - `in-progress` — actively being worked on
 * - `done` — completed
 */
export const TaskStatus = {
	TODO: "todo",
	IN_PROGRESS: "in-progress",
	DONE: "done",
} as const;

/** Union type of all valid task status values. */
export type TaskStatusValue = (typeof TaskStatus)[keyof typeof TaskStatus];

/**
 * Zod schema for a task's status field.
 */
export const TaskStatusSchema = z.enum(["todo", "in-progress", "done"]);

/**
 * Zod schema for a single task within a session or plan chunk.
 *
 * Tasks represent discrete units of work, tracked with status and optional timestamps.
 */
export const TaskSchema = z
	.object({
		/** The human-readable description of the task. */
		text: z.string().min(1),
		/** Current status of the task. */
		status: TaskStatusSchema,
		/** ISO 8601 timestamp when the task was added. */
		added_at: z.string().datetime().optional(),
		/** ISO 8601 timestamp when the task was completed (only set when status is `done`). */
		completed_at: z.string().datetime().optional(),
	})
	.strict();

/**
 * A single task within a session or plan chunk.
 */
export type Task = z.infer<typeof TaskSchema>;
