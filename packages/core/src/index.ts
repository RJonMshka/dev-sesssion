/**
 * @dev-session/core
 *
 * Business logic for dev-session. Data model, file managers, validators.
 * No CLI dependencies — this is a pure library.
 *
 * @packageDocumentation
 */

// Re-export security types that consumers need
export {
	CliError,
	ParseError,
	SecurityError,
} from "@dev-session/security";
// Adapter interface and context types
export type {
	Adapter,
	AdapterReadFile,
	AdapterSetupContext,
	AdapterSetupResult,
	AdapterWriteFile,
	SessionLifecycleContext,
	TransformStateContext,
} from "./adapters/adapter.js";
// Calculators
export { ContextBudgetCalculator } from "./calculators/context-budget-calculator.js";
export type { TokenCounterInstance } from "./counters/token-counter.js";
// Counters
export { TokenCounter } from "./counters/token-counter.js";
// Detectors
export { ProjectDetector } from "./detectors/project-detector.js";
// Types for bootstrap formatters
export type { BootstrapContext, BootstrapFormatter } from "./formatters/bootstrap-formatter.js";
// Formatter utilities (shared across all formatter implementations)
export {
	DEFAULT_MAX_NEXT_TASKS,
	DEFAULT_MAX_NOTES,
	DEFAULT_MAX_PROMPT_LINES,
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	getPendingTasks,
	trimToMaxLines,
} from "./formatters/formatter-utils.js";
// Bootstrap formatters
export { PlainTextFormatter } from "./formatters/plain-text-formatter.js";
export { FileIndexManager } from "./managers/file-index-manager.js";
export { NextPromptWriter } from "./managers/next-prompt-writer.js";
export { PlanChunkManager } from "./managers/plan-chunk-manager.js";
export { RoutinesWriter } from "./managers/routines-writer.js";
// Managers
export { SessionStateManager } from "./managers/session-state-manager.js";
// Parsers
export { PlanParser } from "./parsers/plan-parser.js";
export type {
	AdapterConfig,
	AuditResult,
	BoundaryResult,
	ContextBudget,
	ContextBudgetBreakdown,
	ContextBudgetSummary,
	DetectedToolValue,
	DirectoryGroup,
	ExternalTokenCounter,
	FileIndexEntry,
	NextPrompt,
	PlanChunk,
	ProjectInfo,
	ProjectTypeValue,
	SessionState,
	Task,
	TaskStatusValue,
	TokenBudget,
	TokenCostMap,
	TokenCountResult,
	ValidationResult,
	WalkedFile,
	WalkOptions,
} from "./schemas/index.js";
// Schemas and types
export {
	AdapterConfigSchema,
	ContextBudgetSummarySchema,
	DEFAULT_CONTEXT_BUDGET,
	DetectedTool,
	FileIndexEntrySchema,
	MAX_PROMPT_LINES,
	NextPromptSchema,
	PlanChunkSchema,
	ProjectInfoSchema,
	ProjectType,
	SessionStateSchema,
	TaskSchema,
	TaskStatus,
	TaskStatusSchema,
} from "./schemas/index.js";

// Walkers
export { GitignoreAwareWalker } from "./walkers/gitignore-aware-walker.js";
