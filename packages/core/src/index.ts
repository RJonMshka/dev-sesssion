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
// Detectors
export { ProjectDetector } from "./detectors/project-detector.js";
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
	DetectedToolValue,
	DirectoryGroup,
	FileIndexEntry,
	NextPrompt,
	PlanChunk,
	ProjectInfo,
	ProjectTypeValue,
	SessionState,
	Task,
	TaskStatusValue,
	ValidationResult,
	WalkedFile,
	WalkOptions,
} from "./schemas/index.js";
// Schemas and types
export {
	AdapterConfigSchema,
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
