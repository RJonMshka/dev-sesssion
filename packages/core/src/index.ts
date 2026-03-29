/**
 * @dev-session/core
 *
 * Business logic for dev-session. Data model, file managers, validators.
 * No CLI dependencies — this is a pure library.
 *
 * @packageDocumentation
 */

// Re-export security types that consumers need
// export { CliError, ParseError, SecurityError } from "@dev-session/security";

// Managers — will be implemented in Chunk 3
// export { SessionStateManager } from "./managers/session-state-manager.js";
// export { FileIndexManager } from "./managers/file-index-manager.js";
// export { PlanChunkManager } from "./managers/plan-chunk-manager.js";
// export { NextPromptWriter } from "./managers/next-prompt-writer.js";

// Parsers — will be implemented in Chunk 3
// export { PlanParser } from "./parsers/plan-parser.js";

// Detectors — will be implemented in Chunk 3
// export { ProjectDetector } from "./detectors/project-detector.js";

// Walkers — will be implemented in Chunk 3
// export { GitignoreAwareWalker } from "./walkers/gitignore-aware-walker.js";

// Facade — will be implemented in Chunk 6
// export { SessionManager } from "./session-manager.js";

/** Placeholder export to verify the package builds correctly. */
export const CORE_VERSION = "0.0.0" as const;
