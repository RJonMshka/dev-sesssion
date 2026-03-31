import { describe, expect, it } from "vitest";
import {
	FileIndexManager,
	GitignoreAwareWalker,
	NextPromptWriter,
	PlanChunkManager,
	PlanParser,
	ProjectDetector,
	RoutinesWriter,
	SessionStateManager,
	SessionStateSchema,
	TaskSchema,
	TaskStatus,
} from "../index.js";

describe("@dev-session/core", () => {
	it("exports all managers", () => {
		expect(SessionStateManager).toBeDefined();
		expect(FileIndexManager).toBeDefined();
		expect(PlanChunkManager).toBeDefined();
		expect(NextPromptWriter).toBeDefined();
		expect(RoutinesWriter).toBeDefined();
	});

	it("exports PlanParser", () => {
		expect(PlanParser).toBeDefined();
		expect(typeof PlanParser.fromMarkdown).toBe("function");
		expect(typeof PlanParser.detectBoundaries).toBe("function");
		expect(typeof PlanParser.toMarkdown).toBe("function");
	});

	it("exports ProjectDetector", () => {
		expect(ProjectDetector).toBeDefined();
		expect(typeof ProjectDetector.detect).toBe("function");
		expect(typeof ProjectDetector.hasExistingSession).toBe("function");
		expect(typeof ProjectDetector.getProjectType).toBe("function");
	});

	it("exports GitignoreAwareWalker", () => {
		expect(GitignoreAwareWalker).toBeDefined();
		expect(typeof GitignoreAwareWalker.walk).toBe("function");
		expect(typeof GitignoreAwareWalker.groupByDirectory).toBe("function");
		expect(typeof GitignoreAwareWalker.estimateTokenCost).toBe("function");
	});

	it("exports schemas and constants", () => {
		expect(SessionStateSchema).toBeDefined();
		expect(TaskSchema).toBeDefined();
		expect(TaskStatus).toEqual({
			TODO: "todo",
			IN_PROGRESS: "in-progress",
			DONE: "done",
		});
	});
});
