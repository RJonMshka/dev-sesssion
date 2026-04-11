/**
 * dev-session token savings benchmark CLI.
 *
 * Usage:
 *   pnpm benchmark                       # run all fixtures
 *   pnpm benchmark --cwd /path/to/proj   # run on a specific project
 *   pnpm benchmark --json                # JSON output
 *   pnpm benchmark --no-init             # skip dev-session init
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonReport, printReport } from "./report.js";
import { runBenchmark } from "./runner.js";
import type { BenchmarkOptions, BenchmarkTarget } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

/** Built-in fixture projects. */
const FIXTURE_TARGETS: BenchmarkTarget[] = [
	{
		name: "simple-node-app",
		path: path.join(FIXTURES_DIR, "simple-node-app"),
		description: "Minimal Express REST API  (~15 files, 1 chunk)",
	},
	{
		name: "medium-ts-monorepo",
		path: path.join(FIXTURES_DIR, "medium-ts-monorepo"),
		description: "TypeScript monorepo      (~35 files, 3 chunks)",
	},
	{
		name: "dev-session (self)",
		path: path.resolve(__dirname, "../.."),
		description: "This repo — the real dogfood test",
		skipInit: true, // already initialized
	},
];

// ---------------------------------------------------------------------------
// Arg parsing (no commander dep — keep benchmark tooling dependency-free)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
	cwd: string | undefined;
	json: boolean;
	noInit: boolean;
	fixturesOnly: boolean;
} {
	const args = argv.slice(2);
	let cwd: string | undefined;
	let json = false;
	let noInit = false;
	let fixturesOnly = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--cwd" && args[i + 1] !== undefined) {
			i++;
			cwd = path.resolve(args[i] as string);
		} else if (arg === "--json") {
			json = true;
		} else if (arg === "--no-init") {
			noInit = true;
		} else if (arg === "--fixtures-only") {
			fixturesOnly = true;
		}
	}

	return { cwd, json, noInit, fixturesOnly };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const { cwd, json, noInit, fixturesOnly } = parseArgs(process.argv);

let targets: BenchmarkTarget[];

if (cwd) {
	targets = [{ name: path.basename(cwd), path: cwd }];
} else if (fixturesOnly) {
	targets = FIXTURE_TARGETS.filter((t) => t.name !== "dev-session (self)");
} else {
	targets = FIXTURE_TARGETS;
}

const options: BenchmarkOptions = { skipInit: noInit };

if (!json) {
	console.log(`\nRunning benchmark against ${targets.length} target(s)...\n`);
}

const results = await runBenchmark(targets, options);

if (json) {
	process.stdout.write(`${JSON.stringify(buildJsonReport(results), null, 2)}\n`);
} else {
	printReport(results);
}

const failed = results.filter((r) => r.error).length;
process.exit(failed > 0 ? 1 : 0);
