/**
 * Report formatters for benchmark results.
 */

import type { BenchmarkResult, PatternComparison } from "./types.js";

const CHECK = "✓";
const CROSS = "✗";
const WIDTH = 66;

function sep(char = "─"): string {
	return char.repeat(WIDTH);
}

function fmt(n: number): string {
	return n.toLocaleString("en-US");
}

function bar(tokens: number, maxTokens: number, cols = 16): string {
	const filled = maxTokens > 0 ? Math.round((tokens / maxTokens) * cols) : 0;
	const empty = cols - filled;
	return `${"█".repeat(filled)}${"░".repeat(empty)}`;
}

function cmdStatus(ok: boolean): string {
	return ok ? CHECK : CROSS;
}

/**
 * Print the developer-pattern vs NEXT_PROMPT comparison section.
 */
function printPatternComparison(pc: PatternComparison): void {
	const maxTokens = pc.patterns.at(-1)?.tokens ?? 1; // whole-project is always last/largest

	const npTokens = pc.nextPromptTokens;
	const npBar = bar(npTokens, maxTokens);
	const npLine = `  NEXT_PROMPT (dev-sesssion):  ${npBar} ${fmt(npTokens).padStart(7)} t  (${pc.nextPromptLines} lines)`;
	console.log(`│${npLine.padEnd(WIDTH - 2)}│`);
	console.log(`├${"─".repeat(WIDTH - 2)}┤`);
	console.log(`│  vs developer loading patterns:${"".padEnd(WIDTH - 34)}│`);

	for (const p of pc.patterns) {
		const ratio = npTokens > 0 ? p.tokens / npTokens : 0;
		const mult =
			ratio >= 1 ? `${ratio.toFixed(1)}× bigger` : `${(1 / (ratio || 1)).toFixed(1)}× smaller`;
		const b = bar(p.tokens, maxTokens);
		const nameCol = p.name.padEnd(18);
		const tCol = fmt(p.tokens).padStart(7);
		const row = `    ${nameCol} ${b} ${tCol} t  ${mult}`;
		console.log(`│${row.padEnd(WIDTH - 2)}│`);
	}
}

/**
 * Print a human-readable benchmark report to stdout.
 */
export function printReport(results: BenchmarkResult[]): void {
	console.log();
	console.log("dev-sesssion Token Savings Benchmark");
	console.log(sep("═"));
	console.log();

	for (const r of results) {
		const title = ` ${r.target.name}`;
		console.log(`┌${"─".repeat(WIDTH - 2)}┐`);
		console.log(`│${title.padEnd(WIDTH - 2)}│`);
		if (r.target.description) {
			console.log(`│  ${r.target.description.padEnd(WIDTH - 4)}│`);
		}
		console.log(`├${"─".repeat(WIDTH - 2)}┤`);

		if (r.error) {
			console.log(`│  ERROR: ${r.error.slice(0, WIDTH - 12).padEnd(WIDTH - 10)}│`);
			console.log(`└${"─".repeat(WIDTH - 2)}┘`);
			console.log();
			continue;
		}

		const maxTokens = r.without.totalTokens;

		const withoutBar = bar(r.without.totalTokens, maxTokens);
		const withBar = bar(r.with.totalTokens, maxTokens);

		const woPad = "".padEnd(WIDTH - 2 - 18 - 16 - 10 - String(r.without.fileCount).length - 9);
		const wiPad = "".padEnd(WIDTH - 2 - 18 - 16 - 10 - String(r.with.fileCount).length - 9);
		console.log(
			`│  WITHOUT tool  ${withoutBar} ${fmt(r.without.totalTokens).padStart(8)} t  (${r.without.fileCount} files)${woPad}│`,
		);
		console.log(
			`│  WITH tool     ${withBar} ${fmt(r.with.totalTokens).padStart(8)} t  (${r.with.fileCount} files)${wiPad}│`,
		);
		console.log(`├${"─".repeat(WIDTH - 2)}┤`);

		const savedLine = `  Saved: ${fmt(r.savings.tokensSaved)} tokens  (${r.savings.percentSaved.toFixed(1)}% — ${r.savings.ratio} smaller)`;
		console.log(`│${savedLine.padEnd(WIDTH - 2)}│`);

		const cmdLine = `  Commands: status ${cmdStatus(r.commands.statusOk)}  health ${cmdStatus(r.commands.healthOk)}  prompt ${cmdStatus(r.commands.promptOk)}  export ${cmdStatus(r.commands.exportClaudeOk)}`;
		console.log(`│${cmdLine.padEnd(WIDTH - 2)}│`);

		const durLine = `  Duration: ${(r.durationMs / 1000).toFixed(1)}s${r.initialized ? "  (init ran)" : ""}`;
		console.log(`│${durLine.padEnd(WIDTH - 2)}│`);

		// Pattern comparison section
		if (r.patternComparison && r.patternComparison.nextPromptTokens > 0) {
			console.log(`├${"─".repeat(WIDTH - 2)}┤`);
			const hdr = `  Context handoff — NEXT_PROMPT vs developer loading patterns:`;
			console.log(`│${hdr.padEnd(WIDTH - 2)}│`);
			printPatternComparison(r.patternComparison);
		}

		console.log(`└${"─".repeat(WIDTH - 2)}┘`);
		console.log();

		if (r.without.topFiles.length > 0) {
			console.log("  Top files by token cost (baseline):");
			for (const f of r.without.topFiles.slice(0, 5)) {
				console.log(`    ${fmt(f.tokens).padStart(6)} tokens  ${f.path}`);
			}
			console.log();
		}
	}

	// Summary row if multiple targets
	if (results.length > 1) {
		const successful = results.filter((r) => !r.error);
		const avgSaved =
			successful.length > 0
				? successful.reduce((s, r) => s + r.savings.percentSaved, 0) / successful.length
				: 0;
		console.log(sep("─"));
		console.log(
			`  ${successful.length}/${results.length} targets succeeded  |  avg savings: ${avgSaved.toFixed(1)}%`,
		);
		console.log();
	}
}

/**
 * Build a JSON-serializable report array.
 */
export function buildJsonReport(results: BenchmarkResult[]): unknown {
	return results.map((r) => ({
		target: r.target.name,
		path: r.target.path,
		error: r.error ?? null,
		without: {
			total_tokens: r.without.totalTokens,
			file_count: r.without.fileCount,
			top_files: r.without.topFiles,
		},
		with: {
			total_tokens: r.with.totalTokens,
			file_count: r.with.fileCount,
			accurate: r.with.accurate,
		},
		savings: {
			tokens_saved: r.savings.tokensSaved,
			percent_saved: Number(r.savings.percentSaved.toFixed(2)),
			ratio: r.savings.ratio,
		},
		commands: r.commands,
		initialized: r.initialized,
		duration_ms: r.durationMs,
		pattern_comparison: r.patternComparison ?? null,
	}));
}
