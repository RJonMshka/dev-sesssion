import { z } from "zod";

/**
 * Default context budget in estimated tokens.
 *
 * This caps what one chunk brings into context: SESSION_STATE.md, the
 * active plan chunk, and the chunk's files at their loaded layer. Always-include
 * files (`CLAUDE.md`) are reported beside it, not counted toward it — they
 * load in every chunk, so no trim or split can reduce them (LLD-budget.md,
 * REQ-BUD-6).
 *
 * On DevNexus, a 195-file monorepo, chunks came to ~950–2,550 tokens under
 * this cap; the one chunk over it (~6,100) loads a 17 KB design doc whole.
 * Projects can override via the `budgetCap` param.
 *
 * When accurate counting is available (via {@link TokenCounter}),
 * this default may be adjusted — but the heuristic estimate validated
 * here is within ±15% of real Claude tokenizer output for English
 * text and TypeScript source code.
 */
export const DEFAULT_CONTEXT_BUDGET = 4000;

/**
 * Breakdown of token costs by category within a context budget.
 */
export interface ContextBudgetBreakdown {
	/** Estimated tokens for the SESSION_STATE.md file. */
	readonly sessionState: number;
	/** Estimated tokens for the active plan chunk file. */
	readonly planChunk: number;
	/** Per-file token estimates for context files (keyed by filepath). */
	readonly files: ReadonlyMap<string, number>;
	/** Estimated tokens for always-include files. */
	readonly alwaysInclude: number;
}

/**
 * Zod schema for a serializable context budget summary.
 *
 * Used when persisting budget data to NEXT_PROMPT.md or status output.
 */
export const ContextBudgetSummarySchema = z
	.object({
		/** Total estimated token cost for the current context. */
		total_tokens: z.number().int().min(0),
		/** The configured budget cap. */
		budget_cap: z.number().int().min(1),
		/** Whether the current context exceeds the budget cap. */
		over_budget: z.boolean(),
		/** Number of files included in the estimate. */
		file_count: z.number().int().min(0),
		/** Whether all counts used an accurate tokenizer (false = heuristic). */
		accurate: z.boolean().optional(),
	})
	.strict();

/**
 * A serializable summary of the context budget.
 */
export type ContextBudgetSummary = z.infer<typeof ContextBudgetSummarySchema>;

/**
 * Full context budget result returned by the calculator.
 */
export interface ContextBudget {
	/** Total estimated token cost across all loaded context. */
	readonly totalTokens: number;
	/**
	 * The tokens judged against the cap: everything but always-include files,
	 * which load in every chunk and so cannot make a chunk too heavy
	 * (LLD-budget.md, REQ-BUD-6). Equals `totalTokens - breakdown.alwaysInclude`.
	 */
	readonly cappedTokens: number;
	/** Detailed per-category breakdown. */
	readonly breakdown: ContextBudgetBreakdown;
	/** Whether {@link cappedTokens} exceeds the configured budget cap. */
	readonly overBudget: boolean;
	/** The configured budget cap in tokens. */
	readonly budgetCap: number;
	/**
	 * Whether all token counts in this budget came from an accurate tokenizer.
	 *
	 * `false` when any file (or the session state / plan chunk estimates) used
	 * the character-based heuristic. Consumers can use this to display a
	 * "~ approximate" qualifier in budget summaries.
	 *
	 * Defaults to `false` for backward compatibility with callers that do not
	 * provide a {@link TokenCounterInstance}.
	 */
	readonly accurate: boolean;
}
