/**
 * Eval orchestrator — cold-agent tier.
 *
 * For each ablation, runs two arms that differ in exactly one respect: the
 * bootstrap arm receives the context dev-sesssion generated, the control arm
 * receives nothing. Without the control arm a score measures how well Claude
 * writes Express middleware, not whether the tool helped.
 *
 * Requires `ANTHROPIC_API_KEY` (or an `ant auth login` profile).
 *
 * Usage: `pnpm eval:agent [--version 2.2.0] [--only <ablation-id>] [--tag <label>]`
 *
 * `--tag` keeps repeat runs of the same version in separate reports. Repeating
 * an identical configuration is the only way to estimate run-to-run variance,
 * without which a version-to-version difference cannot be told from noise.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeRestoration, type ReliableScore } from "./checks/judge.js";
import { newTypeErrors, verifyWorkspace } from "./checks/verification.js";
import { listFiles, runColdAgent } from "./harness/cold-agent.js";
import { ensureFixtureDeps, linkDeps } from "./harness/fixture-deps.js";
import { type InstalledCli, installPublishedCli } from "./harness/published-cli.js";
import { prepareWorkspace, restoreTree, snapshotTree } from "./harness/workspace.js";
import { TARGETS } from "./targets.js";
import type { Ablation } from "./types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VERSION = "2.2.0";

/** One arm's full result. */
interface ArmResult {
	readonly arm: "bootstrap" | "control";
	readonly turns: number;
	readonly filesWritten: readonly string[];
	readonly filesRead: readonly string[];
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly testsPassed: boolean;
	readonly stoppedBecause: string;
	/** Gate files the agent altered; restored before verification, recorded here. */
	readonly testFilesTampered: readonly string[];
	readonly newTypeErrors: readonly string[];
	readonly scores: readonly ReliableScore[];
	readonly meanScore: number | null;
}

/**
 * Runs one arm end to end.
 *
 * @param opts - Everything the arm needs.
 * @returns The arm's result.
 */
async function runArm(opts: {
	readonly cli: InstalledCli;
	readonly sourceDir: string;
	readonly ablation: Ablation;
	readonly nodeModules: string;
	readonly baselineErrors: readonly string[];
	readonly withBootstrap: boolean;
}): Promise<ArmResult> {
	const ws = await prepareWorkspace(opts.sourceDir, opts.ablation);
	try {
		// init runs in both arms; only the bootstrap arm is *shown* the result.
		await opts.cli.run(["--yes", "--adapter", "claude", "init"], ws.dir);
		const prompt = await fs
			.readFile(path.join(ws.dir, ".session", "NEXT_PROMPT.md"), "utf8")
			.catch(() => "");

		// The subject must not be able to edit the tests that grade it.
		const testsBefore = await snapshotTree(ws.dir, "tests");

		const run = await runColdAgent({
			workspaceDir: ws.dir,
			task: opts.ablation.task,
			bootstrap: opts.withBootstrap ? prompt : null,
		});

		const testFilesTampered = await restoreTree(ws.dir, "tests", testsBefore);

		await linkDeps(ws.dir, opts.nodeModules);
		const v = await verifyWorkspace(ws.dir);

		const targetPath = opts.ablation.removeFiles[0] ?? "";
		const reference = ws.groundTruth.get(targetPath) ?? "";
		const candidate = await fs.readFile(path.join(ws.dir, targetPath), "utf8").catch(() => null);

		// The judge must see everything the agent built, or a module the agent
		// created itself reads as a fabricated import.
		const supportingFiles = new Map<string, string>();
		for (const rel of run.filesWritten) {
			if (rel === targetPath) continue;
			const body = await fs.readFile(path.join(ws.dir, rel), "utf8").catch(() => null);
			if (body !== null) supportingFiles.set(rel, body);
		}

		const scores = await judgeRestoration({
			contract: opts.ablation.contract,
			reference,
			candidate,
			supportingFiles,
			projectFiles: await listFiles(ws.dir),
		});
		const usable = scores.filter((s) => !s.unstable);

		return {
			arm: opts.withBootstrap ? "bootstrap" : "control",
			turns: run.turns,
			filesWritten: run.filesWritten,
			filesRead: run.filesRead,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			testsPassed: v.tests.passed,
			stoppedBecause: run.stoppedBecause,
			testFilesTampered,
			newTypeErrors: newTypeErrors(opts.baselineErrors, v.typecheckErrors),
			scores,
			meanScore:
				usable.length === 0 ? null : usable.reduce((a, s) => a + s.score, 0) / usable.length,
		};
	} finally {
		await ws.cleanup();
	}
}

/**
 * Entry point.
 *
 * @returns Resolves once the report is written.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const vIdx = argv.indexOf("--version");
	const version = vIdx !== -1 ? (argv[vIdx + 1] ?? DEFAULT_VERSION) : DEFAULT_VERSION;
	const onlyIdx = argv.indexOf("--only");
	const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : undefined;
	const tagIdx = argv.indexOf("--tag");
	const tag = tagIdx !== -1 ? argv[tagIdx + 1] : undefined;

	const cli = await installPublishedCli(version);
	const cacheRoot = path.join(REPO_ROOT, "evals", ".cache", "deps");
	const rows: Record<string, unknown>[] = [];

	for (const target of TARGETS) {
		const sourceDir = path.join(REPO_ROOT, target.sourceDir);
		const nodeModules = await ensureFixtureDeps(cacheRoot, target.id, sourceDir);

		// Pre-existing diagnostics must not be blamed on the agent.
		const base = await prepareWorkspace(sourceDir, null);
		await linkDeps(base.dir, nodeModules);
		const baselineErrors = (await verifyWorkspace(base.dir)).typecheckErrors;
		await base.cleanup();
		process.stdout.write(
			`${target.id}: baseline has ${String(baselineErrors.length)} pre-existing type error(s)\n\n`,
		);

		for (const ablation of target.ablations) {
			if (only !== undefined && ablation.id !== only) continue;
			process.stdout.write(`▸ ${target.id} / ${ablation.id}\n`);

			for (const withBootstrap of [true, false]) {
				const r = await runArm({
					cli,
					sourceDir,
					ablation,
					nodeModules,
					baselineErrors,
					withBootstrap,
				});
				rows.push({ target: target.id, ablation: ablation.id, ...r });
				process.stdout.write(
					`  ${r.arm.padEnd(9)} turns ${String(r.turns).padStart(2)}` +
						` · read ${String(r.filesRead.length).padStart(2)}` +
						` · tests ${r.testsPassed ? "PASS" : "FAIL"}` +
						` · new type errs ${String(r.newTypeErrors.length)}` +
						` · judge ${r.meanScore === null ? "n/a" : r.meanScore.toFixed(2)}\n`,
				);
				if (r.testFilesTampered.length > 0) {
					process.stdout.write(
						`    TAMPERED with gate files (restored): ${r.testFilesTampered.join(", ")}\n`,
					);
				}
				const unstable = r.scores.filter((s) => s.unstable).map((s) => s.dimension);
				if (unstable.length > 0) {
					process.stdout.write(`    unstable dimensions (excluded): ${unstable.join(", ")}\n`);
				}
			}
			process.stdout.write("\n");
		}
	}

	const reportDir = path.join(REPO_ROOT, "evals", "report");
	await fs.mkdir(reportDir, { recursive: true });
	// A filtered run must not clobber the full run's report.
	const suffix = `${only === undefined ? "" : `-${only}`}${tag === undefined ? "" : `-${tag}`}`;
	const out = path.join(reportDir, `agent-${version}${suffix}.json`);
	await fs.writeFile(out, `${JSON.stringify({ version, rows }, null, 2)}\n`, "utf8");
	process.stdout.write(`Report: ${path.relative(REPO_ROOT, out)}\n`);
}

main().catch((err: unknown) => {
	process.stderr.write(`eval failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
});
