/**
 * Token counting with pluggable accurate counting and heuristic fallback.
 *
 * The `TokenCounter` uses a character-based heuristic by default
 * (`Math.ceil(chars / 4)`), which is free and works offline.
 * Adapters can inject an {@link ExternalTokenCounter} callback to get
 * ground-truth counts from a real tokenizer API (e.g., Anthropic's
 * `messages.countTokens`).
 *
 * Design rationale: `packages/core` must not depend on vendor SDKs.
 * The pluggable callback keeps core dependency-free while allowing
 * accurate counting when an adapter provides the implementation.
 *
 * @packageDocumentation
 */

import * as fs from "node:fs";
import type { ValidatedPath } from "@dev-session/security";
import { CliError } from "@dev-session/security";

import type {
	ExternalTokenCounter,
	TokenCostMap,
	TokenCountResult,
} from "../schemas/token-counting.js";

/**
 * Bytes-per-token heuristic for English text and code.
 *
 * Claude's actual BPE tokenizer averages ~3.5–4.5 bytes per token
 * for mixed English prose and source code. We use 4 as a conservative
 * middle ground — slightly overestimates for dense code, slightly
 * underestimates for prose-heavy markdown.
 */
const BYTES_PER_TOKEN = 4;

/**
 * Estimates token count from a string using the character-based heuristic.
 *
 * @param content - The string content to estimate.
 * @returns The estimated token count.
 */
function heuristicCount(content: string): number {
	const byteLength = Buffer.byteLength(content, "utf-8");
	return Math.ceil(byteLength / BYTES_PER_TOKEN);
}

/**
 * Options for creating a {@link TokenCounter} instance.
 */
export interface TokenCounterOptions {
	/**
	 * Optional external token counter callback for accurate counting.
	 * If not provided, all counts use the heuristic fallback.
	 */
	readonly externalCounter?: ExternalTokenCounter;
}

/**
 * Counts tokens for strings and files with heuristic fallback.
 *
 * Create via {@link TokenCounter.create} to optionally inject an accurate
 * external counter. When no external counter is provided (or it throws),
 * all results use the `Math.ceil(bytes / 4)` heuristic and are marked
 * `accurate: false`.
 *
 * @example
 * ```typescript
 * // Heuristic-only (no API key):
 * const counter = TokenCounter.create();
 * const result = await counter.countString("Hello world");
 * // { tokens: 3, accurate: false }
 *
 * // With adapter-provided accurate counter:
 * const counter = TokenCounter.create({
 *   externalCounter: async (content) => anthropic.messages.countTokens(...)
 * });
 * const result = await counter.countString("Hello world");
 * // { tokens: 2, accurate: true }
 * ```
 */
export const TokenCounter = {
	/**
	 * Creates a new token counter instance.
	 *
	 * @param options - Optional configuration with an external counter callback.
	 * @returns A token counter object with `countString`, `countFile`, and `countFiles` methods.
	 */
	create(options?: TokenCounterOptions): TokenCounterInstance {
		const externalCounter = options?.externalCounter;
		return {
			/**
			 * Whether this counter has an external (accurate) counter available.
			 */
			get hasExternalCounter(): boolean {
				return externalCounter !== undefined;
			},

			/**
			 * Counts tokens for a raw string.
			 *
			 * If an external counter is available, uses it. Falls back to heuristic
			 * on failure or when no external counter is configured.
			 *
			 * @param content - The string to count tokens for.
			 * @returns A promise resolving to a {@link TokenCountResult}.
			 */
			async countString(content: string): Promise<TokenCountResult> {
				if (externalCounter !== undefined) {
					try {
						const tokens = await externalCounter(content);
						return { tokens, accurate: true };
					} catch {
						// Fall through to heuristic
					}
				}
				return { tokens: heuristicCount(content), accurate: false };
			},

			/**
			 * Counts tokens for a file on disk.
			 *
			 * Reads the file content and delegates to {@link countString}.
			 *
			 * @param filePath - A validated file path to read and count.
			 * @returns A promise resolving to a {@link TokenCountResult}.
			 * @throws {CliError} If the file cannot be read.
			 */
			async countFile(filePath: ValidatedPath): Promise<TokenCountResult> {
				const content = readFileContent(filePath);
				return this.countString(content);
			},

			/**
			 * Counts tokens for multiple files, returning a {@link TokenCostMap}.
			 *
			 * Processes files sequentially to avoid overwhelming an external API.
			 * If any file uses the heuristic fallback, the overall map will contain
			 * a mix of accurate and inaccurate results — consumers should check
			 * individual entries.
			 *
			 * @param paths - An array of validated file paths.
			 * @returns A promise resolving to a map of path to token count result.
			 */
			async countFiles(paths: readonly ValidatedPath[]): Promise<TokenCostMap> {
				const results = new Map<string, TokenCountResult>();
				for (const filePath of paths) {
					const result = await this.countFile(filePath);
					results.set(filePath, result);
				}
				return results;
			},
		};
	},

	/**
	 * Synchronous heuristic-only token estimate for a string.
	 *
	 * Convenience method for cases where async is not needed and heuristic
	 * accuracy is acceptable (e.g., quick estimates during file walking).
	 *
	 * @param content - The string to estimate.
	 * @returns The heuristic token estimate.
	 */
	heuristicCount(content: string): number {
		return heuristicCount(content);
	},

	/**
	 * Synchronous heuristic-only token estimate from byte count.
	 *
	 * @param bytes - The byte count to estimate from.
	 * @returns The heuristic token estimate.
	 */
	heuristicCountFromBytes(bytes: number): number {
		return Math.ceil(bytes / BYTES_PER_TOKEN);
	},
} as const;

/**
 * Instance returned by {@link TokenCounter.create}.
 */
export interface TokenCounterInstance {
	/** Whether an external (accurate) counter is available. */
	readonly hasExternalCounter: boolean;
	/** Count tokens for a string. */
	countString(content: string): Promise<TokenCountResult>;
	/** Count tokens for a file on disk. */
	countFile(filePath: ValidatedPath): Promise<TokenCountResult>;
	/** Count tokens for multiple files. */
	countFiles(paths: readonly ValidatedPath[]): Promise<TokenCostMap>;
}

/**
 * Reads file content as UTF-8 string.
 *
 * @param filePath - The absolute file path.
 * @returns The file content as a string.
 * @throws {CliError} If the file cannot be read.
 */
function readFileContent(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch (cause: unknown) {
		throw new CliError({
			message: "Failed to read file for token counting",
			suggestion: "Check that the file exists and has read permissions.",
			cause,
		});
	}
}
