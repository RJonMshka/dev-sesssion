import { describe, expect, it } from "vitest";
import { TaskSelector } from "../managers/task-selector.js";
import type { Task } from "../schemas/index.js";

/** Requirements: docs/plan/LLD-task-done.md (area TASK). */

const TASKS: readonly Task[] = [
	{ text: "Initialize project", status: "done" },
	{ text: "Configure tooling in package.json", status: "todo" },
	{ text: "Wire auth", status: "todo" },
	{ text: "Wire auth tests", status: "todo" },
];

describe("TaskSelector.resolve", () => {
	it("takes a whole number as a 1-based position (REQ-TASK-1)", () => {
		expect(TaskSelector.resolve(TASKS, "2")).toEqual({
			kind: "one",
			number: 2,
			task: TASKS[1],
		});
	});

	it("treats a number outside the list as no match, not as text (REQ-TASK-1, -3)", () => {
		expect(TaskSelector.resolve(TASKS, "0")).toEqual({ kind: "none" });
		expect(TaskSelector.resolve(TASKS, "5")).toEqual({ kind: "none" });
	});

	it("matches exact text before containment (REQ-TASK-2)", () => {
		expect(TaskSelector.resolve(TASKS, "Wire auth")).toMatchObject({ kind: "one", number: 3 });
	});

	it("matches the one task containing the text, ignoring case (REQ-TASK-2)", () => {
		expect(TaskSelector.resolve(TASKS, "TOOLING")).toMatchObject({ kind: "one", number: 2 });
	});

	it("reports every number when the text is in more than one task (REQ-TASK-3)", () => {
		expect(TaskSelector.resolve(TASKS, "wire")).toEqual({ kind: "many", numbers: [3, 4] });
	});

	it("reports no match for text in no task, or blank text (REQ-TASK-3)", () => {
		expect(TaskSelector.resolve(TASKS, "billing")).toEqual({ kind: "none" });
		expect(TaskSelector.resolve(TASKS, "   ")).toEqual({ kind: "none" });
	});
});
