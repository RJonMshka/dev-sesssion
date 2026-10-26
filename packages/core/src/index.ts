/**
 * @dev-session/core
 *
 * Business logic for dev-sesssion. Data model, file managers, validators.
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
	AdapterRefreshContext,
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
	ParsedUnit,
	SymbolAnnotations,
	SymbolEntry,
	SymbolSurface,
	UnitEntry,
	UnitKind,
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
export { mentionsFile, referencedFiles } from "./calculators/file-reference.js";
export type {
	ContextPlan,
	FileLayerRole,
	LayerResolverInput,
	ResolvedFileLayer,
} from "./calculators/layer-resolver.js";
export { LayerResolver } from "./calculators/layer-resolver.js";
export { type NeighbourInput, NewFiles } from "./calculators/new-files.js";
export type {
	FocusedUnit,
	UnitFocusInput,
	UnitFocusResult,
} from "./calculators/unit-focus.js";
export { MAX_FOCUS_UNITS, UnitFocusResolver } from "./calculators/unit-focus.js";
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
	FILE_LOAD_PREFIXES,
	FOCUS_PREFIX,
	formatBudgetLine,
	formatChunkProgress,
	formatCompletedChunksSummary,
	formatLayeredContextLines,
	formatNewFilesLine,
	formatOverBudgetMessage,
	formatPlanLine,
	formatQuotedNote,
	formatQuotedSummary,
	formatRefList,
	formatUnitRef,
	getPendingTasks,
	LAYER_SUFFIX_RE,
	LEGACY_LOAD_PREFIX,
	LOAD_FULL_PREFIX,
	LOAD_PREFIX,
	MAX_NOTE_CHARS,
	MAX_REF_LINE_CHARS,
	mergeContextFiles,
	NEW_FILES_PREFIX,
	PLAN_PREFIX,
	QUOTED_LABEL,
	quoteText,
	SUMMARIES_PREFIX,
	trimToMaxLines,
} from "./formatters/formatter-utils.js";
// Bootstrap formatters
export { PlainTextFormatter } from "./formatters/plain-text-formatter.js";
// Git-backed verification and replay scoring
export type { GitCommit } from "./git/git-reader.js";
export { GitReader } from "./git/git-reader.js";
// Importers
export type { MergedNotes } from "./importers/claude-md-notes.js";
export { ClaudeMdNotes } from "./importers/claude-md-notes.js";
export type { SplitContent } from "./importers/managed-block.js";
export {
	MANAGED_BLOCK_END,
	MANAGED_BLOCK_START,
	splitManagedBlock,
} from "./importers/managed-block.js";
export type { LintResult } from "./linters/context-linter.js";
// Linters
export { ContextLinter } from "./linters/context-linter.js";
export type { ManifestInput } from "./managers/context-manifest.js";
export { ContextManifest } from "./managers/context-manifest.js";
export { FILE_INDEX_PAGE_SIZE, FileIndexManager } from "./managers/file-index-manager.js";
export { NextPromptWriter } from "./managers/next-prompt-writer.js";
export { DONE_LOG_FILENAME, PlanChunkManager } from "./managers/plan-chunk-manager.js";
export type {
	AssembledPrompt,
	AssembleInput,
	ChargedContext,
	ChargeInput,
} from "./managers/prompt-assembler.js";
export { PromptAssembler } from "./managers/prompt-assembler.js";
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
	ExcludedSection,
	ExclusionReason,
	NoPlanDirectionOptions,
	PlanCheckCandidate,
	PlanCheckChunk,
	PlanCheckReport,
	PlanIngestResult,
	PlanParseResult,
	PlanSource,
	PlanSourceCandidate,
	PlanSourceDetection,
} from "./parsers/plan-sources/index.js";
// Plan source registry — many plan dialects in, one PlanChunk[] out
export {
	CHUNK_HEADING_SHAPE,
	checkPlan,
	DEFAULT_PLAN_PATHS,
	describeExclusion,
	detectPlanSource,
	formatCandidates,
	getPlanSourceByName,
	getRegisteredPlanSources,
	HeadingPlanSource,
	INIT_WITH_PLAN_COMMAND,
	noPlanDirection,
	PLAN_CHECK_COMMAND,
	PLAN_SOURCE_MIN_CONFIDENCE,
	parsePlan,
	registerPlanSource,
	TaskListPlanSource,
	unregisterPlanSource,
} from "./parsers/plan-sources/index.js";
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
	ContextManifestData,
	DetectedToolValue,
	DirectoryGroup,
	ExternalTokenCounter,
	FileIndexEntry,
	ManifestEntry,
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
	CONTEXT_MANIFEST_FILENAME,
	ContextBudgetSummarySchema,
	ContextLogEntrySchema,
	ContextLogSchema,
	ContextManifestSchema,
	countPromptChars,
	countPromptLines,
	DEFAULT_CONTEXT_BUDGET,
	DetectedTool,
	FileIndexEntrySchema,
	MAX_CONFIGURABLE_PROMPT_LINES,
	MAX_PROJECT_NAME_CHARS,
	MAX_PROMPT_CHARS,
	MAX_PROMPT_LINES,
	ManifestEntrySchema,
	MIN_CONFIGURABLE_PROMPT_LINES,
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
export { ContextManifestChecker } from "./verifiers/context-manifest-checker.js";
export type {
	ReplayReport,
	ReplayScore,
} from "./verifiers/replay-scorer.js";
export { extractDeclaredFiles, ReplayScorer } from "./verifiers/replay-scorer.js";
export type {
	VerifyFinding,
	VerifyInput,
	VerifyReport,
	VerifySeverityValue,
} from "./verifiers/session-verifier.js";
export { SessionVerifier, VerifySeverity } from "./verifiers/session-verifier.js";
// Walkers
export { GitignoreAwareWalker } from "./walkers/gitignore-aware-walker.js";
