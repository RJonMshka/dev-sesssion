/**
 * Shared types for the dev-sesssion eval harness.
 *
 * The harness is dev-only tooling: it drives the *published* CLI as a black box
 * and never imports from `packages/`. It therefore sits outside the CLI error
 * contract (CliError/ParseError/SecurityError) and throws plain `Error`.
 *
 * @module
 */

/**
 * A removal applied to a workspace before the cold agent runs.
 *
 * Each removed file is its own ground truth: the eval scores whether an agent
 * given only the generated bootstrap can restore equivalent behaviour.
 */
export interface Ablation {
	/** Stable id, used in report keys. */
	readonly id: string;
	/** What the agent has to rebuild, in one line. */
	readonly description: string;
	/**
	 * The task as stated in PLAN.md. Identical across arms — it is deliberately
	 * underspecified, so the generated context is what has to close the gap.
	 */
	readonly task: string;
	/** Repo-relative paths deleted before `init` runs. */
	readonly removeFiles: readonly string[];
	/** Behavioural contract the restored code must satisfy, for the judge rubric. */
	readonly contract: string;
}

/** A fixture or real repo the eval runs against. */
export interface EvalTarget {
	readonly id: string;
	/** Path relative to the repo root. */
	readonly sourceDir: string;
	/** Chunk the session should be resumed at. */
	readonly chunk: number;
	readonly ablations: readonly Ablation[];
}

/** Result of the deterministic path-grounding check. */
export interface GroundingResult {
	readonly declared: readonly string[];
	readonly missing: readonly string[];
	/** Share of declared paths that exist on disk; null when nothing was declared. */
	readonly groundedRatio: number | null;
}

/** Machine-readable slice of `dev-sesssion verify --replay --json`. */
export interface SessionMetrics {
	readonly verifyOk: boolean;
	readonly findings: readonly { readonly code: string; readonly severity: string }[];
	readonly meanRecall: number | null;
	readonly meanPrecision: number | null;
	readonly wasteRatio: number | null;
	readonly boundariesScored: number;
	readonly unavailableReason: string | null;
}

/** One end-to-end run: a target x ablation x arm. */
export interface RunRecord {
	readonly target: string;
	readonly ablation: string;
	/** `bootstrap` = agent sees generated context; `control` = agent sees none. */
	readonly arm: "bootstrap" | "control";
	readonly bootstrap: string | null;
	readonly grounding: GroundingResult;
	readonly metrics: SessionMetrics | null;
}
