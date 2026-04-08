/**
 * Adapter interface — lifecycle hooks for tool-specific behavior.
 *
 * Adapters extend the bootstrap formatter system (Chunk 6) with full lifecycle
 * participation: file generation during init, state transformation before prompt
 * rendering, and session start/end hooks for reading/writing tool-specific context.
 *
 * Each adapter bundles:
 * - {@link AdapterConfig} — static metadata (name, detect files, output files)
 * - {@link BootstrapFormatter} — prompt generation for NEXT_PROMPT.md
 * - Lifecycle hooks — optional async hooks for setup, state transforms, session events
 *
 * All hooks are optional. A minimal adapter only needs `config` and `formatter`.
 *
 * @packageDocumentation
 */

import type { BootstrapFormatter } from "../formatters/bootstrap-formatter.js";
import type { ContextBudget } from "../schemas/context-budget.js";
import type {
	AdapterConfig,
	FileIndexEntry,
	PlanChunk,
	ProjectInfo,
	SessionState,
} from "../schemas/index.js";

// ---------------------------------------------------------------------------
// IO helpers — injected by the CLI layer so adapters don't depend on security
// ---------------------------------------------------------------------------

/**
 * File writer function injected by the CLI layer.
 *
 * The CLI provides an implementation backed by {@link AtomicWriter} + {@link PathValidator}.
 * Adapters call this instead of writing to the filesystem directly.
 *
 * @param relativePath - Path relative to the project root (e.g., "CLAUDE.md").
 * @param content - The file content to write.
 */
export type AdapterWriteFile = (relativePath: string, content: string) => void;

/**
 * File reader function injected by the CLI layer.
 *
 * Returns `undefined` if the file does not exist, rather than throwing.
 *
 * @param relativePath - Path relative to the project root.
 * @returns The file content, or `undefined` if the file does not exist.
 */
export type AdapterReadFile = (relativePath: string) => string | undefined;

// ---------------------------------------------------------------------------
// Context types — scoped per lifecycle phase
// ---------------------------------------------------------------------------

/**
 * Context provided during adapter setup (called during `dev-session init`).
 *
 * Contains everything the adapter needs to generate tool-specific files
 * (e.g., CLAUDE.md section, AGENTS.md) on first init.
 */
export interface AdapterSetupContext {
	/** Absolute path to the project root. */
	readonly projectRoot: string;
	/** Absolute path to the `.session/` directory. */
	readonly sessionDir: string;
	/** Detected project environment info. */
	readonly projectInfo: ProjectInfo;
	/** Whether this is a reinit over an existing `.session/` directory. */
	readonly isReinit: boolean;
	/** Safe file writer (backed by AtomicWriter in the CLI layer). */
	readonly writeFile: AdapterWriteFile;
	/** Safe file reader (returns undefined if not found). */
	readonly readFile: AdapterReadFile;
}

/**
 * Result returned from an adapter's `setup` hook.
 */
export interface AdapterSetupResult {
	/** Relative paths of files that were created or modified. */
	readonly filesWritten: readonly string[];
	/** Human-readable summary of what the setup did (for CLI output). */
	readonly summary: string;
}

/**
 * Context provided during session lifecycle events (`onSessionStart`, `onSessionEnd`).
 *
 * Contains the current session state and active chunk, plus paths needed
 * to read/write tool-specific files.
 */
export interface SessionLifecycleContext {
	/** Absolute path to the project root. */
	readonly projectRoot: string;
	/** Absolute path to the `.session/` directory. */
	readonly sessionDir: string;
	/** Current session state. */
	readonly state: SessionState;
	/** The active plan chunk. */
	readonly chunk: PlanChunk;
	/** File index entries tagged to the active chunk. */
	readonly chunkFiles: readonly FileIndexEntry[];
	/** The calculated context budget. */
	readonly budget: ContextBudget;
	/** Safe file writer (backed by AtomicWriter in the CLI layer). */
	readonly writeFile: AdapterWriteFile;
	/** Safe file reader (returns undefined if not found). */
	readonly readFile: AdapterReadFile;
}

/**
 * Context provided to the `transformState` hook.
 *
 * Intentionally minimal — this is a synchronous pure transform,
 * so it only receives what's needed to augment the state.
 */
export interface TransformStateContext {
	/** Absolute path to the project root. */
	readonly projectRoot: string;
	/** Absolute path to the `.session/` directory. */
	readonly sessionDir: string;
	/** Safe file reader (returns undefined if not found). */
	readonly readFile: AdapterReadFile;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Full adapter interface for tool-specific behavior.
 *
 * Combines static metadata ({@link AdapterConfig}), prompt formatting
 * ({@link BootstrapFormatter}), and optional lifecycle hooks.
 *
 * **Lifecycle hook execution order:**
 *
 * 1. `setup()` — during `dev-session init` (once per project)
 * 2. `onSessionStart()` — at the start of each coding session
 * 3. `transformState()` — before prompt regeneration (each `update`/`advance`)
 * 4. `onSessionEnd()` — at the end of each coding session (`update --end`)
 *
 * All hooks are optional. If a hook is not implemented, the system skips it.
 *
 * @example
 * ```typescript
 * const adapter: Adapter = {
 *   config: {
 *     name: "claude",
 *     display_name: "Claude Code",
 *     detect_files: ["CLAUDE.md", ".claude"],
 *     output_files: ["CLAUDE.md"],
 *     config_version: 1,
 *   },
 *   formatter: ClaudeBootstrapFormatter,
 *
 *   async setup(ctx) {
 *     // Generate CLAUDE.md section during init
 *     return { filesWritten: ["CLAUDE.md"], summary: "Added dev-session section to CLAUDE.md" };
 *   },
 *
 *   transformState(state, ctx) {
 *     // Inject .claude/MEMORY.md context into notes
 *     return state;
 *   },
 * };
 * ```
 */
export interface Adapter {
	/** Static metadata describing the adapter. */
	readonly config: AdapterConfig;

	/** The bootstrap formatter used for NEXT_PROMPT.md generation. */
	readonly formatter: BootstrapFormatter;

	/**
	 * Called during `dev-session init` to generate tool-specific files.
	 *
	 * Use this to create or update tool configuration files (e.g., add a
	 * dev-session section to CLAUDE.md, generate an AGENTS.md skeleton).
	 *
	 * @param context - Setup context with project paths and detection info.
	 * @returns A result describing what files were written.
	 */
	setup?(context: AdapterSetupContext): Promise<AdapterSetupResult>;

	/**
	 * Transforms session state before prompt generation.
	 *
	 * Called synchronously before the formatter renders NEXT_PROMPT.md.
	 * Use this to inject tool-specific context (e.g., reading `.claude/MEMORY.md`
	 * and appending relevant notes) or reshape state for the tool's format.
	 *
	 * Must be a pure transform — no side effects, no file writes.
	 *
	 * @param state - The current session state.
	 * @param context - Paths needed to locate tool-specific files.
	 * @returns The (possibly modified) session state.
	 */
	transformState?(state: SessionState, context: TransformStateContext): SessionState;

	/**
	 * Called at the start of a coding session.
	 *
	 * Use this to read tool-specific context files, validate tool configuration,
	 * or perform any startup tasks. Called after the bootstrap prompt is loaded.
	 *
	 * @param context - Session lifecycle context with state and chunk.
	 */
	onSessionStart?(context: SessionLifecycleContext): Promise<void>;

	/**
	 * Called at the end of a coding session.
	 *
	 * Use this to write tool-specific updates — e.g., syncing session notes
	 * back to `.claude/MEMORY.md` or updating an AGENTS.md section.
	 *
	 * @param context - Session lifecycle context with state and chunk.
	 */
	onSessionEnd?(context: SessionLifecycleContext): Promise<void>;
}
