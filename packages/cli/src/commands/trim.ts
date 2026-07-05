/**
 * `dev-sesssion trim` command.
 *
 * Interactive or automated context pruning — lets the user exclude files
 * from the bootstrap context to stay within a token budget.
 *
 * Modes:
 * - Interactive (default): shows each file's token cost and prompts action
 * - `--budget <N>`: auto-suggests skipping files largest-first until under budget
 * - `--dry-run`: shows what would change without writing
 *
 * Writes excluded files to `.session/trim-overrides.json` (gitignored).
 * Cleared on `dev-sesssion advance`.
 *
 * Does NOT require `ANTHROPIC_API_KEY` — all operations are local.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, isCancel, log, multiselect } from "@clack/prompts";
import {
	DEFAULT_CONTEXT_BUDGET,
	FileIndexManager,
	SessionStateManager,
	TokenCounter,
	TrimOverridesManager,
} from "@dev-session/core";
import { CliError, PathValidator, type ValidatedPath } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options passed from Commander to the trim action. */
export interface TrimOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Target token budget — auto-suggest exclusions to reach this. */
	readonly budget?: number;
	/** Show what would be excluded without writing. */
	readonly dryRun: boolean;
	/** Skip prompts and apply auto-budget mode if --budget provided. */
	readonly yes: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
}

/** File candidate for trimming. */
export interface TrimCandidate {
	readonly filepath: string;
	readonly tokens: number;
	readonly alreadyExcluded: boolean;
}

/** Result of a trim run. */
export interface TrimResult {
	/** Files newly added to exclusions. */
	readonly excluded: readonly string[];
	/** Files restored to context (removed from exclusions). */
	readonly restored: readonly string[];
	/** Whether any changes were written. */
	readonly dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Reads a file's content for token counting.
 *
 * @param filePath - Absolute path to read.
 * @returns Content string, or empty string if unreadable.
 */
function safeReadFile(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

/**
 * Builds the list of trim candidates with their token costs.
 *
 * @param cwd - Working directory.
 * @param chunkFiles - Context files for the active chunk.
 * @param alreadyExcludedPaths - Paths already in trim overrides.
 * @returns Array of candidates sorted largest-first.
 */
async function buildCandidates(
	cwd: string,
	chunkFiles: ReadonlyArray<{ filepath: string }>,
	alreadyExcludedPaths: readonly string[],
): Promise<TrimCandidate[]> {
	const counter = TokenCounter.create();
	const candidates = await Promise.all(
		chunkFiles.map(async (entry) => {
			const content = safeReadFile(path.join(cwd, entry.filepath));
			const tokens = (await counter.countString(content)).tokens;
			return {
				filepath: entry.filepath,
				tokens,
				alreadyExcluded: alreadyExcludedPaths.includes(entry.filepath),
			};
		}),
	);
	// Sort largest-first
	return candidates.sort((a, b) => b.tokens - a.tokens);
}

/**
 * Auto-selects files to exclude until total is under the budget target.
 *
 * @param candidates - Files sorted largest-first.
 * @param currentTotal - Current total token count.
 * @param targetBudget - Target maximum tokens.
 * @returns Array of filepaths to exclude.
 */
export function autoSelectExclusions(
	candidates: readonly TrimCandidate[],
	currentTotal: number,
	targetBudget: number,
): string[] {
	const toExclude: string[] = [];
	let remaining = currentTotal;

	for (const c of candidates) {
		if (remaining <= targetBudget) {
			break;
		}
		if (!c.alreadyExcluded) {
			toExclude.push(c.filepath);
			remaining -= c.tokens;
		}
	}

	return toExclude;
}

/**
 * Executes the trim command.
 *
 * @param options - Resolved CLI options.
 * @returns Trim result summary.
 */
export async function runTrim(options: TrimOptions): Promise<TrimResult> {
	const sessionDir = resolveSessionDir(options.cwd);

	const state = SessionStateManager.load(sessionDir);
	const allEntries = FileIndexManager.load(sessionDir);
	const chunkFiles = FileIndexManager.queryByChunk(allEntries, state.active_chunk);

	if (chunkFiles.length === 0) {
		log.info("No context files for the active chunk — nothing to trim.");
		return { excluded: [], restored: [], dryRun: options.dryRun };
	}

	const trimOverrides = TrimOverridesManager.load(sessionDir);
	const excludedPaths = TrimOverridesManager.getExcludedPaths(trimOverrides);

	const candidates = await buildCandidates(options.cwd, chunkFiles, [...excludedPaths]);

	const counter = TokenCounter.create();
	// Estimate session overhead
	const sessionStatePath = path.join(sessionDir, "SESSION_STATE.md");
	const planChunkPath = path.join(sessionDir, `PLAN_${String(state.active_chunk)}.md`);
	const sessionStateTokens = (await counter.countString(safeReadFile(sessionStatePath))).tokens;
	const planChunkTokens = (await counter.countString(safeReadFile(planChunkPath))).tokens;
	const nonFileTokens = sessionStateTokens + planChunkTokens;
	const contextTotal = candidates
		.filter((c) => !c.alreadyExcluded)
		.reduce((s, c) => s + c.tokens, 0);
	const currentTotal = nonFileTokens + contextTotal;
	const budgetCap = options.budget ?? DEFAULT_CONTEXT_BUDGET;

	// Display current state
	log.info(
		`Context: ~${String(currentTotal)} tokens / ${String(budgetCap)} budget cap (${currentTotal > budgetCap ? "OVER" : "OK"})`,
	);

	if (excludedPaths.length > 0) {
		log.info(`Already excluded: ${String(excludedPaths.length)} file(s)`);
	}

	let newExclusions: string[] = [];
	let restored: string[] = [];

	// Budget mode (--budget N): auto-suggest exclusions
	if (options.budget !== undefined) {
		if (currentTotal <= options.budget) {
			log.success(
				`Already under budget (${String(currentTotal)} ≤ ${String(options.budget)} tokens).`,
			);
			return { excluded: [], restored: [], dryRun: options.dryRun };
		}

		newExclusions = autoSelectExclusions(candidates, currentTotal, options.budget);

		if (newExclusions.length === 0) {
			log.warn("Cannot reduce to budget — all files already excluded or none large enough.");
			return { excluded: [], restored: [], dryRun: options.dryRun };
		}

		log.info(`Auto-selected ${String(newExclusions.length)} file(s) to exclude:`);
		for (const f of newExclusions) {
			const c = candidates.find((x) => x.filepath === f);
			log.info(`  - ${f} (~${String(c?.tokens ?? 0)} tokens)`);
		}

		if (!options.dryRun) {
			for (const filepath of newExclusions) {
				TrimOverridesManager.addExclusion(sessionDir, state.session_id, filepath, "auto-trim");
			}
			log.success(
				`Excluded ${String(newExclusions.length)} file(s). Run \`dev-sesssion preview\` to verify.`,
			);
		} else {
			log.info("Dry run — no changes written.");
		}

		return { excluded: newExclusions, restored: [], dryRun: options.dryRun };
	}

	// Interactive mode
	if (options.yes) {
		log.info("Use --budget <N> with --yes to auto-trim. Interactive mode requires a terminal.");
		return { excluded: [], restored: [], dryRun: options.dryRun };
	}

	const selectOptions = candidates.map((c) => ({
		value: c.filepath,
		label: `${c.filepath} (~${String(c.tokens)} tokens)`,
		...(c.alreadyExcluded ? { hint: "currently excluded" } : {}),
	}));

	const initialExcluded = candidates.filter((c) => c.alreadyExcluded).map((c) => c.filepath);

	log.info(
		"Select files to EXCLUDE from context (space to toggle, enter to confirm).\nCurrently excluded files are pre-selected.",
	);

	const selection = await multiselect({
		message: "Files in context (select to exclude):",
		options: selectOptions,
		initialValues: initialExcluded,
		required: false,
	});

	if (isCancel(selection)) {
		cancel("Trim cancelled.");
		throw new CliError({ message: "Trim cancelled by user." });
	}

	const selectedExclusions = selection as string[];

	// Determine what changed
	newExclusions = selectedExclusions.filter((f) => !initialExcluded.includes(f));
	restored = initialExcluded.filter((f) => !selectedExclusions.includes(f));

	if (newExclusions.length === 0 && restored.length === 0) {
		log.info("No changes made.");
		return { excluded: [], restored: [], dryRun: options.dryRun };
	}

	if (options.dryRun) {
		if (newExclusions.length > 0) {
			log.info(`Would exclude: ${newExclusions.join(", ")}`);
		}
		if (restored.length > 0) {
			log.info(`Would restore: ${restored.join(", ")}`);
		}
		log.info("Dry run — no changes written.");
		return { excluded: newExclusions, restored, dryRun: true };
	}

	for (const filepath of newExclusions) {
		TrimOverridesManager.addExclusion(sessionDir, state.session_id, filepath);
	}
	for (const filepath of restored) {
		TrimOverridesManager.removeExclusion(sessionDir, filepath);
	}

	if (newExclusions.length > 0) {
		log.success(`Excluded ${String(newExclusions.length)} file(s) from context.`);
	}
	if (restored.length > 0) {
		log.success(`Restored ${String(restored.length)} file(s) to context.`);
	}

	return { excluded: newExclusions, restored, dryRun: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve and validate the .session/ directory path.
 *
 * @param cwd - Working directory
 * @returns ValidatedPath to .session/
 * @throws CliError if .session/ does not exist
 */
function resolveSessionDir(cwd: string): ValidatedPath {
	const sessionDir = path.join(cwd, ".session");

	if (!fs.existsSync(sessionDir)) {
		throw new CliError({
			message: "No .session/ directory found",
			suggestion: "Run `dev-sesssion init` first to initialize the project.",
		});
	}

	return PathValidator.safeResolvePath(".session", cwd);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the `trim` command on a Commander program.
 *
 * @param program - The root Commander program
 */
export function registerTrimCommand(program: Command): void {
	program
		.command("trim")
		.description("Interactively exclude files from context to reduce token usage")
		.option("--budget <n>", "Auto-suggest exclusions to reach target token count")
		.action(async (cmdOptions: { budget?: string }) => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				verbose: boolean;
				dryRun: boolean;
			}>();

			const budget =
				cmdOptions.budget !== undefined ? Number.parseInt(cmdOptions.budget, 10) : undefined;

			if (budget !== undefined && (Number.isNaN(budget) || budget <= 0)) {
				log.error("--budget must be a positive integer (token count).");
				process.exit(1);
				return;
			}

			const trimOptions: TrimOptions = {
				cwd: opts.cwd,
				dryRun: opts.dryRun,
				yes: opts.yes,
				verbose: opts.verbose,
				...(budget !== undefined ? { budget } : {}),
			};

			try {
				await runTrim(trimOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
