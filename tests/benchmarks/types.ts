/**
 * Types for the dev-sesssion token savings benchmark framework.
 *
 * The framework compares:
 * - WITHOUT tool: tokens to load every non-ignored file in a project
 * - WITH tool:    tokens dev-sesssion exposes for the active chunk
 */

/** A project to benchmark against. */
export interface BenchmarkTarget {
	/** Human-readable name for the report. */
	name: string;
	/** Absolute path to the project root. */
	path: string;
	/** Optional description shown in the report. */
	description?: string;
	/** If true, skip running `dev-sesssion init` (project is already initialized). */
	skipInit?: boolean;
}

/** Token measurement for one side of the comparison. */
export interface TokenReport {
	/** Total estimated tokens. */
	totalTokens: number;
	/** Number of files counted. */
	fileCount: number;
	/** Top 10 files by token cost, descending. */
	topFiles: Array<{ path: string; tokens: number }>;
	/** True if counts came from an external tokenizer; false = heuristic (bytes/4). */
	accurate: boolean;
}

/** Token savings between WITHOUT and WITH. */
export interface SavingsReport {
	/** Absolute tokens saved. */
	tokensSaved: number;
	/** Percentage saved (0–100). */
	percentSaved: number;
	/** Compression ratio string, e.g. "8.3×". */
	ratio: string;
}

/** Pass/fail status for each CLI command. */
export interface CommandChecks {
	statusOk: boolean;
	healthOk: boolean;
	promptOk: boolean;
	exportClaudeOk: boolean;
}

/** A single developer loading pattern — one way a dev might gather context manually. */
export interface DeveloperPattern {
	/** Short identifier, e.g. "plan-only", "task-scoped". */
	name: string;
	/** One-line description of the developer behaviour being modelled. */
	description: string;
	/** Total estimated tokens for this pattern. */
	tokens: number;
	/** Number of files counted. */
	fileCount: number;
}

/**
 * Comparison between how a developer would manually load context for the next
 * phase versus the compact NEXT_PROMPT that dev-sesssion generates.
 */
export interface PatternComparison {
	/** Tokens in .session/NEXT_PROMPT.md (the dev-sesssion handoff document). */
	nextPromptTokens: number;
	/** Non-empty line count of NEXT_PROMPT.md. */
	nextPromptLines: number;
	/** Developer loading patterns, ordered from fewest to most tokens. */
	patterns: DeveloperPattern[];
}

/** Full result for a single benchmark target. */
export interface BenchmarkResult {
	/** The target that was benchmarked. */
	target: BenchmarkTarget;
	/** "WITHOUT tool" — full codebase token count. */
	without: TokenReport;
	/** "WITH tool" — dev-sesssion context budget. */
	with: TokenReport;
	/** Computed savings. */
	savings: SavingsReport;
	/** CLI command health checks. */
	commands: CommandChecks;
	/** True if dev-sesssion init was run during this benchmark. */
	initialized: boolean;
	/** Wall-clock time for the full benchmark in milliseconds. */
	durationMs: number;
	/** Developer pattern comparison (populated after init runs). */
	patternComparison?: PatternComparison;
	/** Set if the benchmark failed with an unrecoverable error. */
	error?: string;
}

/** Options for the benchmark runner. */
export interface BenchmarkOptions {
	/** Skip dev-sesssion init for all targets. */
	skipInit: boolean;
}
