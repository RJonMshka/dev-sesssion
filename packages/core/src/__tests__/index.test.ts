import { describe, expect, it } from "vitest";
import {
	ContextBudgetCalculator,
	DEFAULT_CONTEXT_BUDGET,
	FileIndexManager,
	GitignoreAwareWalker,
	NextPromptWriter,
	PlainTextFormatter,
	PlanChunkManager,
	PlanParser,
	ProjectDetector,
	RoutinesWriter,
	SessionStateManager,
	SessionStateSchema,
	TaskSchema,
	TaskStatus,
	TokenCounter,
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
		expect(typeof GitignoreAwareWalker.measureTokenCost).toBe("function");
	});

	it("exports TokenCounter", () => {
		expect(TokenCounter).toBeDefined();
		expect(typeof TokenCounter.create).toBe("function");
		expect(typeof TokenCounter.heuristicCount).toBe("function");
		expect(typeof TokenCounter.heuristicCountFromBytes).toBe("function");
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

	it("exports ContextBudgetCalculator and constants", () => {
		expect(ContextBudgetCalculator).toBeDefined();
		expect(typeof ContextBudgetCalculator.estimate).toBe("function");
		expect(typeof ContextBudgetCalculator.estimateFromString).toBe("function");
		expect(typeof ContextBudgetCalculator.formatSummary).toBe("function");
		expect(DEFAULT_CONTEXT_BUDGET).toBe(4000);
	});

	it("exports PlainTextFormatter", () => {
		expect(PlainTextFormatter).toBeDefined();
		expect(PlainTextFormatter.name).toBe("plain");
		expect(typeof PlainTextFormatter.formatFilesToLoad).toBe("function");
		expect(typeof PlainTextFormatter.formatExcludes).toBe("function");
		expect(typeof PlainTextFormatter.generatePrompt).toBe("function");
	});

	it("exports SessionStateManager.compact", () => {
		expect(typeof SessionStateManager.compact).toBe("function");
	});

	it("exports NextPromptWriter.generateWithFormatter", () => {
		expect(typeof NextPromptWriter.generateWithFormatter).toBe("function");
	});
});
