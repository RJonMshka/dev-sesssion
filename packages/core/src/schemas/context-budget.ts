import { z } from "zod";

/**
 * Default context budget in estimated tokens.
 *
 * This is the recommended maximum combined token cost for all files
 * loaded in a single session bootstrap. Set conservatively to leave
 * room for the AI's system prompt and generated output.
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
	/** Detailed per-category breakdown. */
	readonly breakdown: ContextBudgetBreakdown;
	/** Whether the total exceeds the configured budget cap. */
	readonly overBudget: boolean;
	/** The configured budget cap in tokens. */
	readonly budgetCap: number;
}
