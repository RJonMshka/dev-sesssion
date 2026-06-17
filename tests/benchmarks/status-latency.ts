/**
 * Latency benchmark: `dev-session status` must complete in < 500ms on a
 * 200-file project (PLAN_9 performance target).
 *
 * Generates a throwaway 200-file project, runs `init --yes`, then times the
 * real compiled CLI over several `status` invocations (full process wall time,
 * including Node startup — what the user actually feels). Reports min / median
 * / p95 and exits non-zero if the median misses the budget.
 *
 * Usage:  pnpm benchmark:status
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "../helpers/run-cli.js";

const FILE_COUNT = 200;
const WARMUP = 2;
const ITERATIONS = 10;
const BUDGET_MS = 500;

/** Create a temp project with FILE_COUNT TypeScript files across several dirs. */
function makeProject(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-session-perf-"));
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "perf-fixture", version: "1.0.0" }, null, 2),
	);
	const modules = ["api", "core", "db", "ui", "utils"];
	for (let i = 0; i < FILE_COUNT; i++) {
		const mod = modules[i % modules.length];
		const sub = path.join(dir, "src", mod as string);
		fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(
			path.join(sub, `file-${i}.ts`),
			`/** Module ${mod} unit ${i}. */\nexport function fn${i}(x: number): number {\n  return x * ${i} + ${i};\n}\n`,
		);
	}
	return dir;
}

/** Quantile of a sorted-on-demand sample. */
function quantile(samples: number[], q: number): number {
	const sorted = [...samples].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
	return sorted[idx] as number;
}

const project = makeProject();
try {
	const init = await runCli(["init", "--yes", "--cwd", project]);
	if (!init.ok) {
		throw new Error(`init failed (exit ${init.exitCode}):\n${init.stderr || init.stdout}`);
	}

	for (let i = 0; i < WARMUP; i++) await runCli(["status", "--cwd", project]);

	const timings: number[] = [];
	for (let i = 0; i < ITERATIONS; i++) {
		const t0 = performance.now();
		const res = await runCli(["status", "--cwd", project]);
		const ms = performance.now() - t0;
		if (!res.ok)
			throw new Error(`status failed (exit ${res.exitCode}):\n${res.stderr || res.stdout}`);
		timings.push(ms);
	}

	const min = Math.min(...timings);
	const median = quantile(timings, 0.5);
	const p95 = quantile(timings, 0.95);

	const fmt = (n: number) => `${n.toFixed(0)}ms`;
	console.log(`\ndev-session status latency — ${FILE_COUNT} files, ${ITERATIONS} runs\n`);
	console.log(`  min     ${fmt(min)}`);
	console.log(`  median  ${fmt(median)}`);
	console.log(`  p95     ${fmt(p95)}`);
	console.log(`  budget  ${fmt(BUDGET_MS)} (median)\n`);

	if (median >= BUDGET_MS) {
		console.error(`✗ median ${fmt(median)} exceeds budget ${fmt(BUDGET_MS)}`);
		process.exit(1);
	}
	console.log(`✓ median within budget (${fmt(median)} < ${fmt(BUDGET_MS)})`);
} finally {
	fs.rmSync(project, { recursive: true, force: true });
}
