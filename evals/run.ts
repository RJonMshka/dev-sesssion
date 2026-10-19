/**
 * Eval orchestrator — deterministic tier.
 *
 * Drives the published CLI over each target x ablation, then runs the checks
 * that need no API key. The cold-agent and judge tiers layer on top of the
 * records this produces.
 *
 * Usage: `pnpm eval [--version 2.2.0 | --local] [--keep]`
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
	checkGrounding,
	declaredFromAdapterFile,
	declaredFromFileIndex,
	declaredFromPrompt,
	duplicatePromptRefs,
} from "./checks/grounding.js";
import { collectSessionMetrics } from "./checks/session-metrics.js";
import {
	type InstalledCli,
	installLocalCli,
	installPublishedCli,
} from "./harness/published-cli.js";
import { prepareWorkspace } from "./harness/workspace.js";
import { TARGETS } from "./targets.js";
import type { GroundingResult, SessionMetrics } from "./types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Track the current release. The tier gates CI, so defaulting to a superseded
// version means gating on bugs that are already fixed — 2.2.0 still carries the
// duplicate-ref bug that 2.2.1 shipped the fix for.
const DEFAULT_VERSION = "2.2.1";

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
async function runDeterministic(cli: InstalledCli, keep: boolean): Promise<DeterministicRow[]> {
	process.stdout.write(`  binary: ${cli.binPath}\n\n`);

	const rows: DeterministicRow[] = [];

	for (const target of TARGETS) {
		const sourceDir = path.join(REPO_ROOT, target.sourceDir);
		for (const ablation of target.ablations) {
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
 * Entry point.
 *
 * @returns Resolves when the report is written.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const vIdx = argv.indexOf("--version");
	const requested = vIdx !== -1 ? (argv[vIdx + 1] ?? DEFAULT_VERSION) : DEFAULT_VERSION;
	const keep = argv.includes("--keep");

	// `--local` packs the workspace build instead of installing from npm (REQ-EVAL-9).
	const local = argv.includes("--local");
	process.stdout.write(
		local ? "Packing workspace build...\n" : `Installing dev-sesssion@${requested}...\n`,
	);
	const cli = local ? await installLocalCli(REPO_ROOT) : await installPublishedCli(requested);
	const version = cli.version;

	const rows = await runDeterministic(cli, keep);

	const reportDir = path.join(REPO_ROOT, "evals", "report");
	await fs.mkdir(reportDir, { recursive: true });
	const out = path.join(reportDir, `deterministic-${version}.json`);
	await fs.writeFile(out, `${JSON.stringify({ version, rows }, null, 2)}\n`, "utf8");

	const failures = rows.filter(
		(r) =>
			r.initExitCode !== 0 ||
			r.grounding.missing.length > 0 ||
			r.stalePaths.length > 0 ||
			r.duplicateRefs.length > 0,
	);
	process.stdout.write(`Report: ${path.relative(REPO_ROOT, out)}\n`);
	process.stdout.write(
		`${String(rows.length - failures.length)}/${String(rows.length)} runs clean\n`,
	);

	// A reported failure has to be an exit code, or CI cannot gate on this tier —
	// it previously printed the failure count and exited 0.
	if (failures.length > 0) {
		for (const r of failures) {
			process.stderr.write(`FAIL ${r.target}/${r.ablation}\n`);
		}
		process.exitCode = 1;
	}
}

main().catch((err: unknown) => {
	process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
});
