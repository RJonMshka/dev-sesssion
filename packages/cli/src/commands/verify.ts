/**
 * `dev-sesssion verify` command.
 *
 * Reconciles what the session files claim against what git actually shows,
 * and — with `--replay` — scores past bootstrap prompts against the work that
 * followed them.
 *
 * `health` asks whether the session files are internally consistent. `verify`
 * asks whether they are true. Both matter, and only one of them can be
 * answered without looking at history.
 *
 * Business logic (SessionVerifier, ReplayScorer) lives in `@dev-session/core`.
 * This module handles CLI display and Commander registration.
 *
 * @module
 */

import { intro, log, outro, spinner } from "@clack/prompts";
import {
	FileIndexManager,
	GitReader,
	PlanChunkManager,
	type ReplayReport,
	ReplayScorer,
	SessionStateManager,
	SessionVerifier,
	type VerifyReport,
	VerifySeverity,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";

import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the verify command. */
export interface VerifyOptions {
	/** Working directory (project root). */
	readonly cwd: string;
	/** Also replay-score historical prompts against subsequent commits. */
	readonly replay: boolean;
	/** How many session boundaries to score in replay mode. */
	readonly limit: number;
	/** How many commits of history count as evidence for current claims. */
	readonly lookback: number;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Output machine-readable JSON. */
	readonly json: boolean;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

/**
 * Execute the verify command.
 *
 * @param options - Resolved CLI options.
 * @throws {CliError} If `.session/` is not found, or verification finds errors.
 */
export async function runVerify(options: VerifyOptions): Promise<void> {
	const sessionDir = resolveSessionDir(options.cwd);

	if (!options.json) {
		intro("dev-sesssion verify");
	}

	const state = SessionStateManager.load(sessionDir);
	const chunk = PlanChunkManager.loadActive(sessionDir, state);
	const entries = FileIndexManager.load(sessionDir);

	const s = spinner();
	if (!options.json) s.start("Reconciling session state against git...");

	const report = await SessionVerifier.verify(
		{
			cwd: options.cwd,
			state,
			chunk,
			entries,
			lookback: options.lookback,
		},
		GitReader,
	);

	const replay = options.replay
		? await ReplayScorer.run(options.cwd, GitReader, options.limit)
		: null;

	if (!options.json) {
		s.stop(
			report.findings.length === 0
				? `All ${String(report.checksRun)} checks reconciled.`
				: `Reconciled — ${String(report.errorCount)} error${report.errorCount === 1 ? "" : "s"}, ${String(report.warningCount)} warning${report.warningCount === 1 ? "" : "s"}.`,
		);
	}

	if (options.json) {
		process.stdout.write(`${JSON.stringify(buildJsonOutput(report, replay), null, 2)}\n`);
		if (report.errorCount > 0) {
			process.exitCode = 1;
		}
		return;
	}

	displayReport(report);
	if (replay !== null) {
		displayReplay(replay, options.verbose);
	}

	if (report.errorCount > 0) {
		outro("Verification complete.");
		throw new CliError({
			message: `Session state contradicts git history: ${String(report.errorCount)} error${report.errorCount === 1 ? "" : "s"}`,
			suggestion: "Update SESSION_STATE.md to match what was actually done, then re-run.",
		});
	}

	outro("Session state matches git history.");
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/**
 * Display the verification report.
 *
 * @param report - The report to display.
 */
function displayReport(report: VerifyReport): void {
	if (!report.gitAvailable) {
		log.warn("Not a git repository — history-backed checks were skipped.");
		return;
	}

	if (report.findings.length === 0) {
		log.success(`Session state matches git history. ${String(report.checksRun)} checks passed.`);
		return;
	}

	for (const f of report.findings) {
		const line = `[${f.code}] ${f.message}`;
		switch (f.severity) {
			case VerifySeverity.ERROR:
				log.error(line);
				break;
			case VerifySeverity.WARNING:
				log.warn(line);
				break;
			default:
				log.info(line);
				break;
		}
	}
}

/**
 * Renders a ratio as a percentage, or a dash when it is undefined.
 *
 * @param value - The ratio in the range 0..1, or `null`.
 * @returns A display string.
 */
function pct(value: number | null): string {
	return value === null ? "—" : `${String(Math.round(value * 100))}%`;
}

/**
 * Display the replay scoring summary.
 *
 * @param replay - The replay report.
 * @param verbose - Whether to list per-boundary detail.
 */
function displayReplay(replay: ReplayReport, verbose: boolean): void {
	if (replay.boundariesScored === 0) {
		log.info(
			replay.unavailableReason ??
				"Replay: no scorable session boundaries yet — NEXT_PROMPT.md needs history across at least two sessions.",
		);
		return;
	}

	log.info(
		[
			`Replay over ${String(replay.boundariesScored)} session boundaries:`,
			`  Recall     ${pct(replay.meanRecall)}  (files the session needed that the prompt named)`,
			`  Precision  ${pct(replay.meanPrecision)}  (files the prompt named that the session used)`,
			`  Waste      ${pct(replay.wasteRatio)}  (declared context never touched)`,
		].join("\n"),
	);

	if (!verbose) {
		return;
	}

	for (const score of replay.scores) {
		const head = `  ${score.sha.slice(0, 8)} ${score.date.slice(0, 10)} — recall ${pct(score.recall)}, precision ${pct(score.precision)}`;
		const missed =
			score.missed.length > 0 ? `\n    missed: ${score.missed.slice(0, 5).join(", ")}` : "";
		const unused =
			score.unused.length > 0 ? `\n    unused: ${score.unused.slice(0, 5).join(", ")}` : "";
		log.info(head + missed + unused);
	}
}

/**
 * Build the machine-readable output payload.
 *
 * @param report - The verification report.
 * @param replay - The replay report, when replay mode ran.
 * @returns A JSON-serializable object.
 */
function buildJsonOutput(
	report: VerifyReport,
	replay: ReplayReport | null,
): Record<string, unknown> {
	return {
		ok: report.errorCount === 0,
		gitAvailable: report.gitAvailable,
		checksRun: report.checksRun,
		errorCount: report.errorCount,
		warningCount: report.warningCount,
		infoCount: report.infoCount,
		findings: report.findings.map((f) => ({
			severity: f.severity,
			code: f.code,
			message: f.message,
		})),
		...(replay !== null
			? {
					replay: {
						meanRecall: replay.meanRecall,
						meanPrecision: replay.meanPrecision,
						wasteRatio: replay.wasteRatio,
						boundariesFound: replay.boundariesFound,
						boundariesScored: replay.boundariesScored,
						scores: replay.scores.map((s) => ({
							sha: s.sha,
							date: s.date,
							recall: s.recall,
							precision: s.precision,
							declared: s.declared,
							missed: s.missed,
							unused: s.unused,
						})),
					},
				}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the `.session/` directory path.
 *
 * @param cwd - The project root.
 * @returns A validated path to `.session/`.
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	return PathValidator.safeResolvePath(".session", cwd);
}

/**
 * Parses a positive-integer CLI option, falling back when it is not one.
 *
 * @param raw - The raw option string.
 * @param fallback - Value to use when parsing fails.
 * @returns A positive integer.
 */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
	if (raw === undefined) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `verify` command on a Commander program.
 *
 * @param program - The root Commander program.
 */
export function registerVerifyCommand(program: Command): void {
	program
		.command("verify")
		.description("Reconcile session state against git history; --replay scores past prompts")
		.option("--replay", "Score historical prompts against the commits that followed", false)
		.option("--limit <n>", "Session boundaries to score in replay mode", "10")
		.option("--lookback <n>", "Commits treated as evidence for current claims", "20")
		.option("--json", "Output machine-readable JSON", false)
		.action(
			async (cmdOptions: {
				replay?: boolean;
				limit?: string;
				lookback?: string;
				json?: boolean;
			}) => {
				const opts = program.opts<{ cwd: string; verbose: boolean }>();

				const verifyOptions: VerifyOptions = {
					cwd: opts.cwd,
					replay: cmdOptions.replay ?? false,
					limit: parsePositiveInt(cmdOptions.limit, 10),
					lookback: parsePositiveInt(cmdOptions.lookback, 20),
					verbose: opts.verbose,
					json: cmdOptions.json ?? false,
				};

				try {
					await runVerify(verifyOptions);
				} catch (error: unknown) {
					handleError(error);
				}
			},
		);
}
