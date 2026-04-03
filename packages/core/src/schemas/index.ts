/**
 * @dev-session/core schemas
 *
 * All Zod schemas, TypeScript types, and shared constants for the core package.
 *
 * @packageDocumentation
 */

export type { AdapterConfig } from "./adapter-config.js";
// Adapter config
export { AdapterConfigSchema } from "./adapter-config.js";
// Plan parser types
export type { BoundaryResult } from "./boundary-result.js";
// Context budget
export type {
	ContextBudget,
	ContextBudgetBreakdown,
	ContextBudgetSummary,
} from "./context-budget.js";
export {
	ContextBudgetSummarySchema,
	DEFAULT_CONTEXT_BUDGET,
} from "./context-budget.js";
export type { AuditResult, FileIndexEntry } from "./file-index-entry.js";

// File index
export { FileIndexEntrySchema } from "./file-index-entry.js";
export type { NextPrompt, ValidationResult } from "./next-prompt.js";
// Next prompt
export { MAX_PROMPT_LINES, NextPromptSchema } from "./next-prompt.js";
export type { PlanChunk } from "./plan-chunk.js";
// Plan chunk
export { PlanChunkSchema } from "./plan-chunk.js";
export type {
	DetectedToolValue,
	ProjectInfo,
	ProjectTypeValue,
} from "./project-info.js";

// Project info
export {
	DetectedTool,
	ProjectInfoSchema,
	ProjectType,
} from "./project-info.js";
export type { SessionState } from "./session-state.js";
// Session state
export { SessionStateSchema } from "./session-state.js";
export type { Task, TaskStatusValue } from "./task.js";
// Task
export { TaskSchema, TaskStatus, TaskStatusSchema } from "./task.js";
// Token counting
export type {
	ExternalTokenCounter,
	TokenBudget,
	TokenCostMap,
	TokenCountResult,
} from "./token-counting.js";
// Walker types
export type {
	DirectoryGroup,
	WalkedFile,
	WalkOptions,
} from "./walked-file.js";
