/**
 * Session health checking for dev-sesssion.
 *
 * Audits `.session/` for structural issues and returns a {@link HealthReport}.
 * All issues carry machine-readable {@link HealthIssue.code} values so the CLI
 * can selectively auto-remediate them with `--fix`.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ValidatedPath } from "@dev-session/security";

import { ContextBudgetCalculator } from "../calculators/context-budget-calculator.js";
import { FILE_INDEX_PAGE_SIZE, FileIndexManager } from "../managers/file-index-manager.js";
import { PlanChunkManager } from "../managers/plan-chunk-manager.js";
import { SessionStateManager } from "../managers/session-state-manager.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";
import { MAX_PROMPT_LINES, TaskStatus } from "../schemas/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Severity levels for health issues. */
export const HealthSeverity = {
	ERROR: "error",
	WARNING: "warning",
	INFO: "info",
} as const;

/** A single severity value. */
export type HealthSeverityValue = (typeof HealthSeverity)[keyof typeof HealthSeverity];

/** A single detected health issue. */
export interface HealthIssue {
	/** Severity of this issue. */
	readonly severity: HealthSeverityValue;
	/** Machine-readable code for programmatic handling (e.g. `--fix`). */
	readonly code: string;
	/** Human-readable description. */
	readonly message: string;
	/** Whether the CLI can auto-remediate this issue. */
	readonly fixable: boolean;
}

/** Summary of a full health audit. */
export interface HealthReport {
	/** True only when errorCount === 0 and warningCount === 0. */
	readonly healthy: boolean;
	/** Number of ERROR-severity issues. */
	readonly errorCount: number;
	/** Number of WARNING-severity issues. */
	readonly warningCount: number;
	/** Number of INFO-severity issues. */
	readonly infoCount: number;
	/** Total number of checks performed. */
	readonly checksRun: number;
	/** All detected issues in the order they were discovered. */
	readonly issues: readonly HealthIssue[];
	/**
	 * Stale FILE_INDEX entries (files that no longer exist on disk).
	 * Populated when the STALE_INDEX_ENTRIES issue is present; needed by `--fix`.
	 */
	readonly staleEntries: readonly FileIndexEntry[];
	/**
	 * NEXT_PROMPT.md line count, or `undefined` if the file is unreadable.
	 * Populated for the PROMPT_TOO_LONG / PROMPT_MISSING issues.
	 */
	readonly promptLineCount: number | undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs a full health audit of the `.session/` directory.
 *
 * Checks performed (in order):
 * 1. SESSION_STATE.md is present and valid
 * 2. Active PLAN_N.md exists
 * 3. FILE_INDEX.md is present, parseable, and not stale
 * 4. Always-include entry count (≤ 4 recommended)
 * 5. Context budget (within cap)
 * 6. Active chunk task completion status
 * 7. NEXT_PROMPT.md line count (≤ MAX_PROMPT_LINES)
 * 8. Session staleness (last_updated within 7 days)
 */
export const HealthChecker = {
	/**
	 * Audit the session directory and return a structured report.
	 *
	 * @param sessionDir - Validated path to `.session/`
	 * @returns A {@link HealthReport} with all detected issues
	 */
	audit(sessionDir: ValidatedPath): HealthReport {
		const issues: HealthIssue[] = [];
		let staleEntries: readonly FileIndexEntry[] = [];
		let promptLineCount: number | undefined;
		let checksRun = 0;

		// 1. SESSION_STATE.md
		checksRun++;
		const state = safeLoad(() => SessionStateManager.load(sessionDir));
		if (state === null) {
			issues.push(
				makeIssue(
					HealthSeverity.ERROR,
					"SESSION_STATE_INVALID",
					"SESSION_STATE.md is unreadable or invalid",
					false,
				),
			);
			return buildReport(issues, staleEntries, promptLineCount, checksRun);
		}

		// 2. Active plan file
		checksRun++;
		issues.push(...checkPlanFile(sessionDir, state.active_chunk));

		// 3-6. FILE_INDEX + budget + task completion
		checksRun++;
		const indexResult = checkFileIndex(sessionDir, state);
		issues.push(...indexResult.issues);
		staleEntries = indexResult.staleEntries;
		checksRun += indexResult.extraChecks;

		// 7. NEXT_PROMPT.md
		checksRun++;
		const promptResult = checkPrompt(sessionDir);
		issues.push(...promptResult.issues);
		promptLineCount = promptResult.lineCount;

		// 8. Staleness
		checksRun++;
		issues.push(...checkStaleness(state.last_updated));

		return buildReport(issues, staleEntries, promptLineCount, checksRun);
	},
} as const;

// ---------------------------------------------------------------------------
// Internal: per-check helpers
// ---------------------------------------------------------------------------

/**
 * Check that the active PLAN_N.md exists.
 *
 * @param sessionDir - Path to .session/
 * @param activeChunk - The active chunk ID
 * @returns Array of issues (empty if healthy)
 */
function checkPlanFile(sessionDir: string, activeChunk: number): HealthIssue[] {
	const planPath = path.join(sessionDir, `PLAN_${String(activeChunk)}.md`);
	if (!fs.existsSync(planPath)) {
		return [
			makeIssue(
				HealthSeverity.ERROR,
				"PLAN_MISSING",
				`PLAN_${String(activeChunk)}.md not found — active chunk ${String(activeChunk)} has no plan file`,
				false,
			),
		];
	}
	return [];
}

/**
 * Internal result from the FILE_INDEX check block.
 */
interface IndexCheckResult {
	readonly issues: readonly HealthIssue[];
	readonly staleEntries: readonly FileIndexEntry[];
	readonly extraChecks: number;
}

/**
 * Check FILE_INDEX.md: parseability, stale entries, missing chunks,
 * always-include count, context budget, and task completion.
 *
 * @param sessionDir - Validated path to .session/
 * @param state - The loaded session state
 * @returns Issues, stale entries, and count of extra checks performed
 */
function checkFileIndex(sessionDir: ValidatedPath, state: SessionState): IndexCheckResult {
	const issues: HealthIssue[] = [];
	let staleEntries: readonly FileIndexEntry[] = [];
	let extraChecks = 0;

	const entries = safeLoad(() => FileIndexManager.load(sessionDir));
	if (entries === null) {
		issues.push(
			makeIssue(
				HealthSeverity.ERROR,
				"FILE_INDEX_INVALID",
				"FILE_INDEX.md is unreadable or malformed",
				false,
			),
		);
		return { issues, staleEntries, extraChecks };
	}

	// Stale entries + missing chunks
	const audit = FileIndexManager.audit(entries, sessionDir);
	if (audit.stale.length > 0) {
		staleEntries = audit.stale;
		issues.push(
			makeIssue(
				HealthSeverity.WARNING,
				"STALE_INDEX_ENTRIES",
				`${String(audit.stale.length)} FILE_INDEX entr${audit.stale.length === 1 ? "y" : "ies"} point to files that no longer exist`,
				true,
			),
		);
	}
	if (audit.missingChunks.length > 0) {
		issues.push(
			makeIssue(
				HealthSeverity.WARNING,
				"MISSING_CHUNK_FILES",
				`Missing plan files: ${audit.missingChunks.map((id) => `PLAN_${String(id)}.md`).join(", ")}`,
				false,
			),
		);
	}

	// Large FILE_INDEX warning (pagination hint)
	if (entries.length > FILE_INDEX_PAGE_SIZE) {
		issues.push(
			makeIssue(
				HealthSeverity.INFO,
				"FILE_INDEX_LARGE",
				`FILE_INDEX has ${String(entries.length)} entries (> ${String(FILE_INDEX_PAGE_SIZE)}) — consider using --max-files on init or splitting chunks`,
				false,
			),
		);
	}

	// Always-include creep
	extraChecks++;
	const alwaysInclude = FileIndexManager.alwaysInclude(entries);
	if (alwaysInclude.length > 4) {
		issues.push(
			makeIssue(
				HealthSeverity.WARNING,
				"ALWAYS_INCLUDE_CREEP",
				`always-include list has ${String(alwaysInclude.length)} files (recommend ≤ 4)`,
				false,
			),
		);
	}

	// Budget + task completion (needs the active chunk)
	extraChecks++;
	const chunk = safeLoad(() => PlanChunkManager.loadActive(sessionDir, state));
	if (chunk !== null) {
		issues.push(...checkBudget(state, chunk, entries, alwaysInclude));
		issues.push(...checkTaskCompletion(chunk));
	}

	return { issues, staleEntries, extraChecks };
}

/**
 * Check whether the context budget is exceeded.
 *
 * @param state - Session state
 * @param chunk - Active plan chunk
 * @param entries - All FILE_INDEX entries
 * @param alwaysInclude - Always-include entries
 * @returns Array of issues
 */
function checkBudget(
	state: SessionState,
	chunk: PlanChunk,
	entries: readonly FileIndexEntry[],
	alwaysInclude: readonly FileIndexEntry[],
): HealthIssue[] {
	const chunkFiles = FileIndexManager.queryByChunk(entries, state.active_chunk);
	const budget = ContextBudgetCalculator.estimate(state, chunk, chunkFiles, alwaysInclude);
	if (!budget.overBudget) return [];
	return [
		makeIssue(
			HealthSeverity.WARNING,
			"BUDGET_EXCEEDED",
			`Context budget exceeded: ~${String(budget.totalTokens)} / ${String(budget.budgetCap)} tokens — remove large files or split the chunk`,
			false,
		),
	];
}

/**
 * Check whether all tasks are done but the chunk hasn't been advanced.
 *
 * @param chunk - The active plan chunk
 * @returns Array of issues
 */
function checkTaskCompletion(chunk: PlanChunk): HealthIssue[] {
	const allDone = chunk.tasks.length > 0 && chunk.tasks.every((t) => t.status === TaskStatus.DONE);
	if (!allDone) return [];
	return [
		makeIssue(
			HealthSeverity.INFO,
			"ALL_TASKS_DONE",
			"All tasks in active chunk are done — run `dev-sesssion advance` to move to the next chunk",
			false,
		),
	];
}

/**
 * Internal result from the NEXT_PROMPT.md check.
 */
interface PromptCheckResult {
	readonly issues: readonly HealthIssue[];
	readonly lineCount: number | undefined;
}

/**
 * Check NEXT_PROMPT.md for existence and line count.
 *
 * @param sessionDir - Path to .session/
 * @returns Issues and line count
 */
function checkPrompt(sessionDir: string): PromptCheckResult {
	const promptPath = path.join(sessionDir, "NEXT_PROMPT.md");
	if (!fs.existsSync(promptPath)) {
		return {
			issues: [
				makeIssue(
					HealthSeverity.WARNING,
					"PROMPT_MISSING",
					"NEXT_PROMPT.md does not exist — run `dev-sesssion update` to regenerate",
					false,
				),
			],
			lineCount: undefined,
		};
	}

	const content = safeLoad(() => fs.readFileSync(promptPath, "utf-8"));
	if (content === null) {
		return { issues: [], lineCount: undefined };
	}

	const lineCount = content.split("\n").length;
	if (lineCount > MAX_PROMPT_LINES) {
		return {
			issues: [
				makeIssue(
					HealthSeverity.WARNING,
					"PROMPT_TOO_LONG",
					`NEXT_PROMPT.md has ${String(lineCount)} lines (max ${String(MAX_PROMPT_LINES)}) — run \`dev-sesssion update\` to regenerate`,
					false,
				),
			],
			lineCount,
		};
	}

	return { issues: [], lineCount };
}

/**
 * Check whether the session was updated recently (within 7 days).
 *
 * @param lastUpdated - ISO date string from session state
 * @returns Array of issues
 */
function checkStaleness(lastUpdated: string): HealthIssue[] {
	const date = new Date(lastUpdated);
	if (Number.isNaN(date.getTime())) return [];

	const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (diffDays <= 7) return [];

	return [
		makeIssue(
			HealthSeverity.INFO,
			"SESSION_STALE",
			`Session not updated in ${String(diffDays)} days (last: ${lastUpdated})`,
			false,
		),
	];
}

// ---------------------------------------------------------------------------
// Internal: utilities
// ---------------------------------------------------------------------------

/**
 * Safely call a loader function, returning null on any thrown error.
 *
 * @param fn - A function that may throw
 * @returns The return value, or null if an error was thrown
 */
function safeLoad<T>(fn: () => T): T | null {
	try {
		return fn();
	} catch {
		return null;
	}
}

/**
 * Construct a {@link HealthIssue}.
 *
 * @param severity - Issue severity
 * @param code - Machine-readable code
 * @param message - Human-readable message
 * @param fixable - Whether --fix can remediate this
 * @returns A HealthIssue object
 */
function makeIssue(
	severity: HealthSeverityValue,
	code: string,
	message: string,
	fixable: boolean,
): HealthIssue {
	return { severity, code, message, fixable };
}

/**
 * Assemble a {@link HealthReport} from collected issues.
 *
 * @param issues - All detected issues
 * @param staleEntries - Stale FILE_INDEX entries
 * @param promptLineCount - NEXT_PROMPT.md line count
 * @param checksRun - Total checks performed
 * @returns Complete HealthReport
 */
function buildReport(
	issues: readonly HealthIssue[],
	staleEntries: readonly FileIndexEntry[],
	promptLineCount: number | undefined,
	checksRun: number,
): HealthReport {
	const errorCount = issues.filter((i) => i.severity === HealthSeverity.ERROR).length;
	const warningCount = issues.filter((i) => i.severity === HealthSeverity.WARNING).length;
	const infoCount = issues.filter((i) => i.severity === HealthSeverity.INFO).length;

	return {
		healthy: errorCount === 0 && warningCount === 0,
		errorCount,
		warningCount,
		infoCount,
		checksRun,
		issues,
		staleEntries,
		promptLineCount,
	};
}
