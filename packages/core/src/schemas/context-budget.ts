import { z } from "zod";

/**
 * Default context budget in estimated tokens.
 *
 * This caps the token cost of the *generated bootstrap context* that
 * `dev-sesssion` produces (SESSION_STATE summary, plan chunk summary,
 * always-include file references, and context file metadata). It is
 * **not** the full AI context window — source files listed in the
 * bootstrap are loaded separately by the AI.
 *
 * Measured against this project's own bootstrap:
 * - SESSION_STATE metadata:  ~50–150 tokens (YAML frontmatter + task list)
 * - Plan chunk summary:      ~100–300 tokens (title + task markdown)
 * - Always-include refs:     ~200–400 tokens (CLAUDE.md, SESSION_STATE.md paths)
 * - File index metadata:     ~50–100 tokens per file (path + purpose + chunk tags)
 *
 * A typical 10-file chunk generates ~1,500–2,500 bootstrap tokens.
 * 4,000 provides ~60% headroom for larger chunks before triggering
 * an over-budget warning. Projects can override via `budgetCap` param.
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
	/** Detailed per-category breakdown. */
	readonly breakdown: ContextBudgetBreakdown;
	/** Whether the total exceeds the configured budget cap. */
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
