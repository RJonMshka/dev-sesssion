/**
 * Reconciles what SESSION_STATE.md claims against what the repository shows.
 *
 * `HealthChecker` asks whether the session files are internally consistent.
 * This asks a different and harder question: are they *true*? A task marked
 * done with no commit behind it, or a `last_worked_files` entry that no diff
 * ever touched, is a state file that has drifted from reality — and a prompt
 * generated from it will mislead the next session.
 *
 * @packageDocumentation
 */

import type { GitReader as GitReaderType } from "../git/git-reader.js";
import type { FileIndexEntry, PlanChunk, SessionState } from "../schemas/index.js";
import { TaskStatus } from "../schemas/index.js";

/** Severity of a verification finding. */
export const VerifySeverity = {
	ERROR: "error",
	WARNING: "warning",
	INFO: "info",
} as const;

/** A single severity value. */
export type VerifySeverityValue = (typeof VerifySeverity)[keyof typeof VerifySeverity];

/**
 * A single discrepancy between claimed session state and repository history.
 */
export interface VerifyFinding {
	/** How severe the discrepancy is. */
	readonly severity: VerifySeverityValue;
	/** Machine-readable code (e.g., `UNBACKED_WORKED_FILE`). */
	readonly code: string;
	/** Human-readable description. */
	readonly message: string;
}

/**
 * The outcome of a verification run.
 */
export interface VerifyReport {
	/** All discrepancies found, most severe first. */
	readonly findings: readonly VerifyFinding[];
	/** Number of ERROR-severity findings. */
	readonly errorCount: number;
	/** Number of WARNING-severity findings. */
	readonly warningCount: number;
	/** Number of INFO-severity findings. */
	readonly infoCount: number;
	/** Number of reconciliation checks performed. */
	readonly checksRun: number;
	/** Whether git history was available; when false, only local checks ran. */
	readonly gitAvailable: boolean;
}

/**
 * Inputs required to verify a session.
 */
export interface VerifyInput {
	/** Project root (must be inside a git work tree for history checks). */
	readonly cwd: string;
	/** The session state being verified. */
	readonly state: SessionState;
	/** The active plan chunk. */
	readonly chunk: PlanChunk;
	/** All FILE_INDEX entries. */
	readonly entries: readonly FileIndexEntry[];
	/**
	 * How many commits of history to treat as evidence for the current
	 * session's claims. Defaults to 20.
	 */
	readonly lookback?: number;
}

/** Default number of commits treated as "this session's" history. */
const DEFAULT_LOOKBACK = 20;

/**
 * Builds a finding.
 *
 * @param severity - Finding severity.
 * @param code - Machine-readable code.
 * @param message - Human-readable description.
 * @returns The finding.
 */
function finding(severity: VerifySeverityValue, code: string, message: string): VerifyFinding {
	return { severity, code, message };
}

/**
 * Formats a capped, comma-separated list of paths for a message.
 *
 * @param items - The paths to render.
 * @param max - How many to show before summarizing the remainder.
 * @returns A display string.
 */
function list(items: readonly string[], max = 5): string {
	const shown = items.slice(0, max);
	const rest = items.length - shown.length;
	return shown.join(", ") + (rest > 0 ? `, +${String(rest)} more` : "");
}

/**
 * Collects the set of files touched by the most recent commits.
 *
 * @param cwd - Repository working directory.
 * @param reader - Git accessor.
 * @param lookback - How many commits back to look.
 * @returns Repo-relative paths changed in that window.
 */
async function recentlyChangedFiles(
	cwd: string,
	reader: typeof GitReaderType,
	lookback: number,
): Promise<string[]> {
	const history = await reader.commitsTouching(cwd, ".", lookback);
	const oldest = history.at(-1);
	if (oldest === undefined) {
		return [];
	}
	return await reader.changedBetween(cwd, `${oldest.sha}~1`, "HEAD");
}

/**
 * Sorts findings by severity and tallies the counts.
 *
 * @param findings - The raw findings.
 * @param checksRun - Number of checks performed.
 * @param gitAvailable - Whether history-backed checks could run.
 * @returns The assembled report.
 */
function buildReport(
	findings: readonly VerifyFinding[],
	checksRun: number,
	gitAvailable: boolean,
): VerifyReport {
	const rank: Record<VerifySeverityValue, number> = { error: 0, warning: 1, info: 2 };
	const sorted = [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);

	return {
		findings: sorted,
		errorCount: sorted.filter((f) => f.severity === VerifySeverity.ERROR).length,
		warningCount: sorted.filter((f) => f.severity === VerifySeverity.WARNING).length,
		infoCount: sorted.filter((f) => f.severity === VerifySeverity.INFO).length,
		checksRun,
		gitAvailable,
	};
}

/**
 * Verifies that a session's claims are supported by repository history.
 */
export const SessionVerifier = {
	/**
	 * Reconciles session state against git.
	 *
	 * Degrades to a single informational finding when the directory is not a
	 * git repository, rather than failing outright.
	 *
	 * @param input - The session data and project root to verify.
	 * @param reader - Git accessor, injected so tests can supply a fake.
	 * @returns A {@link VerifyReport} describing every discrepancy found.
	 */
	async verify(input: VerifyInput, reader: typeof GitReaderType): Promise<VerifyReport> {
		const gitAvailable = await reader.isRepo(input.cwd);
		if (!gitAvailable) {
			return buildReport(
				[
					finding(
						VerifySeverity.INFO,
						"NOT_A_REPO",
						"Not a git repository — skipped every history-backed check",
					),
				],
				0,
				false,
			);
		}

		const findings: VerifyFinding[] = [];
		let checksRun = 0;

		const lookback = input.lookback ?? DEFAULT_LOOKBACK;
		const dirty = new Set(await reader.dirtyFiles(input.cwd));
		const recent = await recentlyChangedFiles(input.cwd, reader, lookback);
		const evidenced = new Set([...dirty, ...recent]);

		// 1. Every claimed last-worked file should appear somewhere in the evidence.
		checksRun++;
		const unbacked = input.state.last_worked_files.filter((f) => !evidenced.has(f));
		if (unbacked.length > 0) {
			findings.push(
				finding(
					VerifySeverity.WARNING,
					"UNBACKED_WORKED_FILE",
					`${String(unbacked.length)} last_worked_files have no commit or working-tree change behind them: ${list(unbacked)}`,
				),
			);
		}

		// 2. Files actually being worked on that the index has never heard of.
		checksRun++;
		const indexed = new Set(input.entries.map((e) => e.filepath));
		const unindexed = [...dirty].filter((f) => !indexed.has(f) && !f.startsWith("."));
		if (unindexed.length > 0) {
			findings.push(
				finding(
					VerifySeverity.WARNING,
					"UNINDEXED_CHANGE",
					`${String(unindexed.length)} modified files are absent from FILE_INDEX.md: ${list(unindexed)}`,
				),
			);
		}

		// 3. A chunk reported complete with nothing committed cannot be trusted.
		checksRun++;
		const done = input.chunk.tasks.filter((t) => t.status === TaskStatus.DONE);
		if (done.length > 0 && recent.length === 0 && dirty.size === 0) {
			findings.push(
				finding(
					VerifySeverity.ERROR,
					"DONE_WITHOUT_EVIDENCE",
					`${String(done.length)} tasks are marked done, but no commit in the last ${String(lookback)} and no working-tree change supports them`,
				),
			);
		}

		// 4. State edited but never committed — a teammate cloning now gets stale files.
		checksRun++;
		const sessionDirty = [...dirty].filter((f) => f.startsWith(".session/"));
		if (sessionDirty.length > 0) {
			findings.push(
				finding(
					VerifySeverity.INFO,
					"UNCOMMITTED_SESSION",
					`Session files have uncommitted changes: ${list(sessionDirty)}`,
				),
			);
		}

		return buildReport(findings, checksRun, true);
	},
} as const;
