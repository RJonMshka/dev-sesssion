import { describe, expect, it } from "vitest";
import { TaskListPlanSource } from "../../parsers/plan-sources/task-list-source.js";
import { TaskStatus } from "../../schemas/index.js";

/** Requirements: docs/plan/LLD-plan-sources.md (area PS). */

describe("TaskListPlanSource", () => {
	it("produces one chunk holding every task when a document has no headings (REQ-PS-14)", () => {
		const content = ["- [ ] login", "- [x] stripe", "- [-] ship"].join("\n");

		const result = TaskListPlanSource.parse(content);

		expect(result.chunks).toHaveLength(1);
		expect(result.chunks[0]?.chunk_id).toBe(1);
		expect(result.chunks[0]?.tasks.map((t) => t.text)).toEqual(["login", "stripe", "ship"]);
	});

	it("preserves task status (REQ-PS-14)", () => {
		const result = TaskListPlanSource.parse("- [ ] a\n- [x] b\n- [-] c\n");

		expect(result.chunks[0]?.tasks.map((t) => t.status)).toEqual([
			TaskStatus.TODO,
			TaskStatus.DONE,
			TaskStatus.IN_PROGRESS,
		]);
	});

	it("scores a headings-free task list above zero", () => {
		expect(TaskListPlanSource.detect("- [ ] login\n- [ ] stripe\n").confidence).toBeGreaterThan(0);
	});

	it("scores a document that has headings at zero", () => {
		expect(TaskListPlanSource.detect("## Auth\n- [ ] login\n").confidence).toBe(0);
	});

	it("scores a document with no tasks at zero", () => {
		expect(TaskListPlanSource.detect("just some prose\n").confidence).toBe(0);
	});
});
