/**
 * Interface for tool-specific bootstrap prompt formatters.
 *
 * Each AI coding tool (Claude Code, opencode, Cursor, etc.) has its own way
 * of loading files into context. The {@link BootstrapFormatter} interface
 * allows adapters to produce tool-native bootstrap prompts.
 *
 * - Claude Code uses `@file` mentions
 * - opencode uses its own context loading mechanism
 * - Generic / unknown tools use plain text instructions
 *
 * Implementations must produce a NEXT_PROMPT.md that is both human-readable
 * and optimized for the target tool's context loading behavior.
 *
 * @packageDocumentation
 */

import type { AiIndex } from "../annotation/types.js";
import type { ContextBudget } from "../schemas/context-budget.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";

/**
 * All the context data needed to generate a bootstrap prompt.
 */
export interface BootstrapContext {
	/** The current session state. */
	readonly state: SessionState;
	/** The active plan chunk. */
	readonly chunk: PlanChunk;
	/** File index entries tagged to the active chunk. */
	readonly chunkFiles: readonly FileIndexEntry[];
	/** File index entries tagged as always-include. */
	readonly alwaysIncludeFiles: readonly FileIndexEntry[];
	/** The calculated context budget for the session. */
	readonly budget: ContextBudget;
	/** Glob patterns or paths to explicitly exclude from context. */
	readonly excludePatterns: readonly string[];
	/** Human-readable project name. */
	readonly projectName: string;
}

/**
 * Interface for generating tool-specific bootstrap prompts.
 *
 * Adapters implement this to produce NEXT_PROMPT.md content in the format
 * best suited for their target AI coding tool.
 *
 * @example
 * ```typescript
 * const formatter: BootstrapFormatter = new ClaudeBootstrapFormatter();
 * const prompt = formatter.generatePrompt(context);
 * ```
 */
export interface BootstrapFormatter {
	/** Short identifier for the formatter (e.g., "plain", "claude", "opencode"). */
	readonly name: string;

	/**
	 * Formats file paths for inclusion in the bootstrap prompt.
	 *
	 * Different tools use different syntax for referencing files:
	 * - Plain text: `packages/core/src/index.ts`
	 * - Claude Code: `@packages/core/src/index.ts`
	 *
	 * @param files - File index entries to format.
	 * @returns Formatted file references as a string.
	 */
	formatFilesToLoad(files: readonly FileIndexEntry[]): string;

	/**
	 * Formats exclude patterns for the bootstrap prompt.
	 *
	 * Tells the AI tool which files/patterns to avoid loading.
	 *
	 * @param patterns - Glob patterns or file paths to exclude.
	 * @returns Formatted exclude instructions as a string.
	 */
	formatExcludes(patterns: readonly string[]): string;

	/**
	 * Generates the full bootstrap prompt content.
	 *
	 * This is the main entry point. The output should be a complete,
	 * self-contained string suitable for writing to NEXT_PROMPT.md.
	 *
	 * @param context - All the data needed to generate the prompt.
	 * @returns The complete NEXT_PROMPT.md content string.
	 */
	generatePrompt(context: BootstrapContext): string;

	/**
	 * Formats ai-index content at the specified layer for inclusion in a
	 * bootstrap prompt.
	 *
	 * - Layer 0: module summaries + public symbol names (most compact)
	 * - Layer 1: public signatures, no implementation
	 * - Layer 2: full source (not normally inlined — returns a file-reference hint)
	 *
	 * @param index - The ai-index to render.
	 * @param layer - Context layer (0 = summary, 1 = signatures, 2 = full).
	 * @returns Formatted string for the prompt (may be empty if index has no files).
	 */
	formatAiIndex(index: AiIndex, layer: 0 | 1 | 2): string;
}
