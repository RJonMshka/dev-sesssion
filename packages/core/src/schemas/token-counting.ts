/**
 * Types for the token counting infrastructure.
 *
 * Supports both heuristic (offline) and accurate (API-based) token counting.
 * The {@link ExternalTokenCounter} callback type enables adapters to inject
 * vendor-specific counting (e.g., Anthropic `messages.countTokens`) without
 * adding SDK dependencies to `packages/core`.
 *
 * @packageDocumentation
 */

import type { ValidatedPath } from "@dev-session/security";

/**
 * Result of counting tokens for a single piece of content.
 */
export interface TokenCountResult {
	/** The estimated or measured token count. */
	readonly tokens: number;
	/**
	 * Whether the count came from a real tokenizer API (`true`)
	 * or the character-based heuristic (`false`).
	 */
	readonly accurate: boolean;
}

/**
 * A map of file paths to their token count results.
 *
 * Keys are {@link ValidatedPath} strings; values include both the count
 * and whether it was measured accurately.
 */
export type TokenCostMap = ReadonlyMap<string, TokenCountResult>;

/**
 * Budget summary that tracks token usage against a cap.
 *
 * Extends the existing {@link ContextBudget} concept with accuracy tracking.
 */
export interface TokenBudget {
	/** The configured maximum token budget. */
	readonly limit: number;
	/** Total tokens used. */
	readonly used: number;
	/** Remaining tokens before hitting the limit. */
	readonly remaining: number;
	/** Whether usage exceeds the limit. */
	readonly overBudget: boolean;
	/**
	 * Whether all token counts in this budget came from an accurate tokenizer.
	 * `false` if any file used the heuristic fallback.
	 */
	readonly accurate: boolean;
}

/**
 * Callback that an adapter can provide to perform accurate token counting.
 *
 * Accepts raw string content and returns the exact token count.
 * If the callback throws, the caller falls back to the heuristic.
 *
 * @param content - The string content to count tokens for.
 * @returns The exact token count from a real tokenizer.
 *
 * @example
 * ```typescript
 * // Adapter provides this using the Anthropic SDK:
 * const counter: ExternalTokenCounter = async (content) => {
 *   const result = await anthropic.messages.countTokens({
 *     model: "claude-sonnet-4-20250514",
 *     messages: [{ role: "user", content }],
 *   });
 *   return result.input_tokens;
 * };
 * ```
 */
export type ExternalTokenCounter = (content: string) => Promise<number>;
