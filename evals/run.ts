/**
 * Eval orchestrator — deterministic tier.
 *
 * Drives the published CLI over each target x ablation, then runs the checks
 * that need no API key. The cold-agent and judge tiers layer on top of the
 * records this produces.
 *
 * With `--local` and no `--target`, then runs the adversarial corpus
 * (REQ-EVAL-6). It gates this build: run against a release, a fixed break would
 * stay red until the fix shipped, and the fix cannot ship while CI is red.
 * `--target` skips it because the corpus tests the CLI, not a repository.
 *
 * Usage: `pnpm eval [--version 2.2.0 | --local] [--target file.json] [--keep]`
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS } from "./adversarial.js";
import {
	checkGrounding,
	declaredFromAdapterFile,
	declaredFromFileIndex,
	declaredFromPrompt,
	duplicatePromptRefs,
} from "./checks/grounding.js";
import {
	fileIndexByChunk,
	partitionPresent,
	promptRecallFailed,
	type RecallScore,
	scoreRecall,
} from "./checks/recall.js";
import { collectSessionMetrics } from "./checks/session-metrics.js";
import { runAdversarial } from "./harness/adversarial-runner.js";
import { readDefaultVersion } from "./harness/default-version.js";
import {
	type InstalledCli,
	installLocalCli,
	installPublishedCli,
} from "./harness/published-cli.js";
import { loadTargetFile } from "./harness/target-file.js";
import { prepareWorkspace } from "./harness/workspace.js";
import { TARGETS } from "./targets.js";
import type { Ablation, EvalTarget, GroundingResult, SessionMetrics } from "./types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One deterministic-tier result row. */
interface DeterministicRow {
	readonly target: string;
	readonly ablation: string;
	readonly initExitCode: number;
	readonly initStderr: string;
	readonly promptDeclared: readonly string[];
	readonly grounding: GroundingResult;
	readonly metrics: SessionMetrics | null;
	/** Ablated paths the regenerated context still points at — a stale-path bug. */
	readonly stalePaths: readonly string[];
	/** Paths the capped prompt list names more than once. */
	readonly duplicateRefs: readonly string[];
	/** Recall measures; null when the target declares no files (REQ-EVAL-10, 11). */
	readonly recall: RecallReport | null;
}

/** Context recall for one run. */
interface RecallReport {
	readonly activeChunk: number;
	/** Declared files the prompt names, for the active chunk (REQ-EVAL-11). */
	readonly prompt: RecallScore;
	/** Declared files FILE_INDEX tags to each chunk or always-includes (REQ-EVAL-10). */
	readonly tagged: Readonly<Record<string, RecallScore>>;
	/** Declared files absent on disk, per chunk — reported, never scored. */
	readonly absent: Readonly<Record<string, readonly string[]>>;
}

/** Stands in for an ablation when a target is evaluated as it is. */
const UNABLATED: Ablation = {
	id: "as-is",
	description: "The repository unmodified.",
	task: "",
	removeFiles: [],
	contract: "",
};

/**
 * Reads the active chunk id from SESSION_STATE.md frontmatter.
 *
 * @param state - Raw SESSION_STATE.md, or null.
 * @returns The id, or null when absent.
 */
function activeChunkOf(state: string | null): number | null {
	const m = /^active_chunk:\s*([\d.]+)\s*$/m.exec(state ?? "");
	return m?.[1] === undefined ? null : Number.parseFloat(m[1]);
}

/**
 * Scores context recall against a target's declared files.
 *
 * @param target - The target.
 * @param wsDir - Workspace root.
 * @param fileIndex - Raw FILE_INDEX.md.
 * @param promptDeclared - Paths the prompt names.
 * @param activeChunk - The session's active chunk.
 * @returns The report, or null when the target declares nothing.
 */
async function measureRecall(
	target: EvalTarget,
	wsDir: string,
	fileIndex: string,
	promptDeclared: readonly string[],
	activeChunk: number,
): Promise<RecallReport | null> {
	if (target.expectedFiles === undefined) return null;
	const idx = fileIndexByChunk(fileIndex);
	const tagged: Record<string, RecallScore> = {};
	const absent: Record<string, readonly string[]> = {};
	let prompt = scoreRecall([], promptDeclared);
	for (const [key, declared] of Object.entries(target.expectedFiles)) {
		const split = await partitionPresent(wsDir, declared);
		absent[key] = split.absent;
		const named = [...idx.alwaysInclude, ...(idx.chunks.get(Number.parseFloat(key)) ?? [])];
		tagged[key] = scoreRecall(split.present, named);
		if (Number.parseFloat(key) === activeChunk) prompt = scoreRecall(split.present, promptDeclared);
	}
	return { activeChunk, prompt, tagged, absent };
}

/**
 * Formats a recall score for the console.
 *
 * @param s - The score.
 * @returns e.g. `3/11 (27.3%)`, or `n/a`.
 */
function fmtRecall(s: RecallScore): string {
	return s.ratio === null
		? "n/a"
		: `${String(s.hit)}/${String(s.total)} (${(s.ratio * 100).toFixed(1)}%)`;
}

/**
 * Reads a file, returning null when absent.
 *
 * @param p - Absolute path.
 * @returns Contents or null.
 */
async function readOrNull(p: string): Promise<string | null> {
	try {
		return await fs.readFile(p, "utf8");
	} catch {
		return null;
	}
}

/**
 * Runs the deterministic tier for every target and ablation.
 *
 * @param cli - The installed CLI to evaluate.
 * @param keep - Leave workspaces on disk for inspection.
 * @returns One row per run.
 */
async function runDeterministic(
	cli: InstalledCli,
	keep: boolean,
	targets: readonly EvalTarget[],
): Promise<DeterministicRow[]> {
	process.stdout.write(`  binary: ${cli.binPath}\n\n`);

	const rows: DeterministicRow[] = [];

	for (const target of targets) {
		const sourceDir = path.resolve(REPO_ROOT, target.sourceDir);
		const ablations = target.ablations.length > 0 ? target.ablations : [UNABLATED];
		for (const ablation of ablations) {
			process.stdout.write(`▸ ${target.id} / ${ablation.id}\n`);
			const ws = await prepareWorkspace(sourceDir, ablation);
			try {
				const init = await cli.run(["--yes", "--adapter", "claude", "init"], ws.dir);

				const prompt = (await readOrNull(path.join(ws.dir, ".session", "NEXT_PROMPT.md"))) ?? "";
				const adapterFile = (await readOrNull(path.join(ws.dir, "CLAUDE.md"))) ?? "";
				const fileIndex = (await readOrNull(path.join(ws.dir, ".session", "FILE_INDEX.md"))) ?? "";

				const promptDeclared = declaredFromPrompt(prompt);
				const allDeclared = [
					...new Set([
						...promptDeclared,
						...declaredFromAdapterFile(adapterFile),
						...declaredFromFileIndex(fileIndex),
					]),
				];
				const grounding = await checkGrounding(ws.dir, allDeclared);
				const stalePaths = allDeclared.filter((p) => ws.groundTruth.has(p));
				const metrics = await collectSessionMetrics(cli, ws.dir);
				const state = await readOrNull(path.join(ws.dir, ".session", "SESSION_STATE.md"));
				const recall = await measureRecall(
					target,
					ws.dir,
					fileIndex,
					promptDeclared,
					activeChunkOf(state) ?? target.chunk,
				);

				rows.push({
					target: target.id,
					ablation: ablation.id,
					initExitCode: init.exitCode,
					initStderr: init.stderr.trim().slice(0, 400),
					promptDeclared,
					grounding,
					metrics,
					stalePaths,
					duplicateRefs: duplicatePromptRefs(prompt),
					recall,
				});

				const g = grounding.groundedRatio;
				process.stdout.write(
					`  init exit ${String(init.exitCode)} · declared ${String(allDeclared.length)}` +
						` · grounded ${g === null ? "n/a" : `${(g * 100).toFixed(1)}%`}` +
						` · missing ${String(grounding.missing.length)}\n`,
				);
				if (grounding.missing.length > 0) {
					process.stdout.write(`  MISSING: ${grounding.missing.join(", ")}\n`);
				}
				const dupes = duplicatePromptRefs(prompt);
				if (dupes.length > 0) {
					process.stdout.write(`  DUPLICATE in capped prompt list: ${dupes.join(", ")}\n`);
				}
				if (stalePaths.length > 0) {
					process.stdout.write(`  STALE (points at ablated file): ${stalePaths.join(", ")}\n`);
				}
				if (recall !== null) printRecall(recall);
			} finally {
				if (!keep) await ws.cleanup();
				else process.stdout.write(`  kept: ${ws.dir}\n`);
			}
			process.stdout.write("\n");
		}
	}

	return rows;
}

/**
 * Prints the recall section of one run.
 *
 * @param recall - The run's recall report.
 */
function printRecall(recall: RecallReport): void {
	process.stdout.write(
		`  prompt recall (chunk ${String(recall.activeChunk)}): ${fmtRecall(recall.prompt)}\n`,
	);
	if (promptRecallFailed(recall.prompt)) {
		process.stdout.write(
			`  EMPTY CONTEXT: the prompt names none of chunk ${String(recall.activeChunk)}'s files\n`,
		);
	}
	for (const [chunk, score] of Object.entries(recall.tagged)) {
		const gone = recall.absent[chunk]?.length ?? 0;
		process.stdout.write(
			`  tag recall chunk ${chunk}: ${fmtRecall(score)}` +
				(gone > 0 ? ` · ${String(gone)} declared file(s) not on disk` : "") +
				"\n",
		);
	}
}

/**
 * Entry point.
 *
 * @returns Resolves when the report is written.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	// Track the current release by construction (REQ-EVAL-14): a hardcoded default
	// drifted behind the published version twice.
	const defaultVersion = await readDefaultVersion(REPO_ROOT);
	const vIdx = argv.indexOf("--version");
	const requested = vIdx !== -1 ? (argv[vIdx + 1] ?? defaultVersion) : defaultVersion;
	const keep = argv.includes("--keep");
	// A target file runs a real repo outside this tree, and only that (REQ-EVAL-13).
	const tIdx = argv.indexOf("--target");
	const targetFile = tIdx !== -1 ? argv[tIdx + 1] : undefined;
	if (tIdx !== -1 && targetFile === undefined) throw new Error("--target needs a file");
	const targets = targetFile === undefined ? TARGETS : [await loadTargetFile(targetFile)];

	// `--local` packs the workspace build instead of installing from npm (REQ-EVAL-9).
	const local = argv.includes("--local");
	process.stdout.write(
		local ? "Packing workspace build...\n" : `Installing dev-sesssion@${requested}...\n`,
	);
	const cli = local ? await installLocalCli(REPO_ROOT) : await installPublishedCli(requested);
	const version = cli.version;

	const rows = await runDeterministic(cli, keep, targets);
	const runCorpus = local && targetFile === undefined;
	const adversarial = runCorpus ? await runAdversarial(cli, CORPUS, keep) : [];
	if (!runCorpus && targetFile === undefined) {
		process.stdout.write(
			"Adversarial corpus: skipped — it runs against this build, with --local\n\n",
		);
	}

	const reportDir = path.join(REPO_ROOT, "evals", "report");
	// A target file's report names a private repo's files: keep it out of the tree.
	const out =
		targetFile === undefined
			? path.join(reportDir, `deterministic-${version}.json`)
			: path.join(
					reportDir,
					"local",
					`deterministic-${version}-${targets[0]?.id ?? "target"}.json`,
				);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await fs.writeFile(out, `${JSON.stringify({ version, rows, adversarial }, null, 2)}\n`, "utf8");

	const failures = rows.filter(
		(r) =>
			r.initExitCode !== 0 ||
			r.grounding.missing.length > 0 ||
			r.stalePaths.length > 0 ||
			r.duplicateRefs.length > 0 ||
			(r.recall !== null && promptRecallFailed(r.recall.prompt)),
	);
	process.stdout.write(`Report: ${path.relative(REPO_ROOT, out)}\n`);
	process.stdout.write(
		`${String(rows.length - failures.length)}/${String(rows.length)} runs clean\n`,
	);
	const attacks = adversarial.filter((r) => r.failures.length > 0);
	if (adversarial.length > 0) {
		process.stdout.write(
			`${String(adversarial.length - attacks.length)}/${String(adversarial.length)} adversarial cases clean\n`,
		);
	}

	// A reported failure has to be an exit code, or CI cannot gate on this tier —
	// it previously printed the failure count and exited 0.
	if (failures.length > 0 || attacks.length > 0) {
		for (const r of failures) {
			process.stderr.write(`FAIL ${r.target}/${r.ablation}\n`);
		}
		for (const r of attacks) {
			process.stderr.write(`FAIL adversarial/${r.id}\n`);
		}
		process.exitCode = 1;
	}
}

main().catch((err: unknown) => {
	process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
});
