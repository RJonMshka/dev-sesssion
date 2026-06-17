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
export type {
	AiIndex,
	FileAnnotations,
	FileEntry,
	LayerHint,
	ParsedFile,
	ParsedSymbol,
	SymbolAnnotations,
	SymbolEntry,
	SymbolSurface,
} from "./annotation/index.js";
// Annotation: ai-index auto-extraction (Chunk 12) + @ai-* refinement (Chunk 13)
export {
	AI_INDEX_FILENAME,
	AiIndexBuilder,
	AiIndexManager,
	AnnotationParser,
	AutoExtractor,
} from "./annotation/index.js";
// Calculators
export { ContextBudgetCalculator } from "./calculators/context-budget-calculator.js";
export type {
	HealthIssue,
	HealthReport,
	HealthSeverityValue,
} from "./checkers/health-checker.js";
// Checkers
export { HealthChecker, HealthSeverity } from "./checkers/health-checker.js";
export type { TokenCounterInstance } from "./counters/token-counter.js";
// Counters
export { TokenCounter } from "./counters/token-counter.js";
export type {
	MonorepoInfo,
	MonorepoType,
	WorkspacePackage,
} from "./detectors/monorepo-detector.js";
export { MonorepoDetector } from "./detectors/monorepo-detector.js";
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
export type { LintResult } from "./linters/context-linter.js";
// Linters
export { ContextLinter } from "./linters/context-linter.js";
export { FILE_INDEX_PAGE_SIZE, FileIndexManager } from "./managers/file-index-manager.js";
export { NextPromptWriter } from "./managers/next-prompt-writer.js";
export { PlanChunkManager } from "./managers/plan-chunk-manager.js";
export { RoutinesWriter } from "./managers/routines-writer.js";
export type {
	ActiveChunkInfo,
	IndexQuery,
	MarkTaskResult,
} from "./managers/session-manager.js";
// Session facade (composes the individual managers for transport layers)
export { SessionManager } from "./managers/session-manager.js";
export { SessionMemoryManager } from "./managers/session-memory-manager.js";
// Managers
export { SessionStateManager } from "./managers/session-state-manager.js";
// Trim overrides
export { TrimOverridesManager } from "./managers/trim-overrides-manager.js";
// Parsers
export { PlanParser } from "./parsers/plan-parser.js";
export type {
	AdapterConfig,
	AuditResult,
	BoundaryResult,
	ContextBudget,
	ContextBudgetBreakdown,
	ContextBudgetSummary,
	ContextLog,
	ContextLogEntry,
	ContextLogStats,
	DetectedToolValue,
	DirectoryGroup,
	ExternalTokenCounter,
	FileIndexEntry,
	NextPrompt,
	PlanChunk,
	ProjectInfo,
	ProjectTypeValue,
	SessionState,
	StalenessReport,
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
	CONTEXT_LOG_FILENAME,
	ContextBudgetSummarySchema,
	ContextLogEntrySchema,
	ContextLogSchema,
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
export type { TrimOverrideEntry, TrimOverrides } from "./schemas/trim-overrides.js";
export { TRIM_OVERRIDES_FILENAME, TrimOverridesSchema } from "./schemas/trim-overrides.js";
// Walkers
export { GitignoreAwareWalker } from "./walkers/gitignore-aware-walker.js";
