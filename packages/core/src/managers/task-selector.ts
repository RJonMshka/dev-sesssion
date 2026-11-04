/**
 * Picks one task of a chunk from what a user typed (LLD-task-done.md,
 * REQ-TASK-1..3).
 *
 * @packageDocumentation
 */

import type { Task } from "../schemas/index.js";

/** What a selector named. Numbers are 1-based positions in plan order. */
export type TaskSelection =
	| { readonly kind: "one"; readonly number: number; readonly task: Task }
	| { readonly kind: "none" }
	| { readonly kind: "many"; readonly numbers: readonly number[] };

/** Resolves `task done <selector>`. Pure. */
export const TaskSelector = {
	/**
	 * Resolves a selector against a chunk's tasks.
	 *
	 * All digits is a position, and a position outside the list matches
	 * nothing rather than falling back to text. Otherwise exact text wins,
	 * then the one task whose text contains the selector, ignoring case.
	 *
	 * @param tasks - The chunk's tasks, in plan order.
	 * @param selector - What the user typed.
	 * @returns The task, or why there is no single one.
	 */
	resolve(tasks: readonly Task[], selector: string): TaskSelection {
		const wanted = selector.trim();
		if (wanted === "") return { kind: "none" };

		if (/^\d+$/.test(wanted)) {
			const number = Number.parseInt(wanted, 10);
			const task = tasks[number - 1];
			return task !== undefined && number >= 1 ? { kind: "one", number, task } : { kind: "none" };
		}

		const exact = tasks.findIndex((t) => t.text === wanted);
		const exactTask = tasks[exact];
		if (exactTask !== undefined) return { kind: "one", number: exact + 1, task: exactTask };

		const needle = wanted.toLowerCase();
		const numbers = tasks.flatMap((t, i) => (t.text.toLowerCase().includes(needle) ? [i + 1] : []));
		const [only] = numbers;
		const onlyTask = only !== undefined ? tasks[only - 1] : undefined;
		if (numbers.length === 1 && only !== undefined && onlyTask !== undefined) {
			return { kind: "one", number: only, task: onlyTask };
		}
		return numbers.length === 0 ? { kind: "none" } : { kind: "many", numbers };
	},
};
