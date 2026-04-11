/**
 * Benchmark runner — orchestrates measurements across all targets.
 */

import {
	measureBaseline,
	measureDeveloperPatterns,
	measureNextPrompt,
	measureWithTool,
	runCommandChecks,
} from "./measure.js";
import type {
	BenchmarkOptions,
	BenchmarkResult,
	BenchmarkTarget,
	PatternComparison,
	SavingsReport,
} from "./types.js";

function computeSavings(withoutTokens: number, withTokens: number): SavingsReport {
	const tokensSaved = withoutTokens - withTokens;
	const percentSaved = withoutTokens > 0 ? (tokensSaved / withoutTokens) * 100 : 0;
	const ratioNum = withTokens > 0 ? withoutTokens / withTokens : 0;
	const ratio = `${ratioNum.toFixed(1)}×`;
	return { tokensSaved, percentSaved, ratio };
}

/**
 * Run the benchmark for a single target.
 */
async function benchmarkTarget(
	target: BenchmarkTarget,
	options: BenchmarkOptions,
): Promise<BenchmarkResult> {
	const t0 = Date.now();

	try {
		// Run baseline and init/status in parallel — init happens inside measureWithTool
		const [without, { report: withReport, initialized }] = await Promise.all([
			measureBaseline(target.path),
			measureWithTool(target.path, options.skipInit || (target.skipInit ?? false)),
		]);

		const savings = computeSavings(without.totalTokens, withReport.totalTokens);

		// Pattern comparison and command checks can run in parallel (session is ready)
		const [commands, patterns, nextPrompt] = await Promise.all([
			runCommandChecks(target.path),
			measureDeveloperPatterns(target.path),
			measureNextPrompt(target.path),
		]);

		const patternComparison: PatternComparison = {
			nextPromptTokens: nextPrompt.tokens,
			nextPromptLines: nextPrompt.lines,
			patterns,
		};

		return {
			target,
			without,
			with: withReport,
			savings,
			commands,
			initialized,
			durationMs: Date.now() - t0,
			patternComparison,
		};
	} catch (err: unknown) {
		return {
			target,
			without: { totalTokens: 0, fileCount: 0, topFiles: [], accurate: false },
			with: { totalTokens: 0, fileCount: 0, topFiles: [], accurate: false },
			savings: { tokensSaved: 0, percentSaved: 0, ratio: "N/A" },
			commands: { statusOk: false, healthOk: false, promptOk: false, exportClaudeOk: false },
			initialized: false,
			durationMs: Date.now() - t0,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Run benchmarks for all targets sequentially (to avoid port conflicts in fixtures).
 */
export async function runBenchmark(
	targets: BenchmarkTarget[],
	options: BenchmarkOptions,
): Promise<BenchmarkResult[]> {
	const results: BenchmarkResult[] = [];
	for (const target of targets) {
		results.push(await benchmarkTarget(target, options));
	}
	return results;
}
