/**
 * Collect coverage for the subprocess-tested CLI.
 *
 * The e2e suite spawns the compiled CLI (`packages/cli/dist/index.cjs`) via
 * execa. Setting NODE_V8_COVERAGE makes each spawned Node process dump raw V8
 * coverage; c8 then remaps those dumps to source through the tsup sourcemap
 * (`--exclude-after-remap` drops the bundled node_modules that only appear
 * after remapping) and writes an istanbul `coverage-final.json`.
 *
 * Output: coverage/e2e/coverage-final.json  (consumed by merge-coverage.mjs)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BIN = path.join(ROOT, "node_modules/.bin");
const RAW_DIR = path.join(ROOT, "coverage/.e2e-v8");
const OUT_DIR = path.join(ROOT, "coverage/e2e");

/** Run a binary with an arg array; inherit stdio; abort on failure. */
function run(cmd, args, env) {
	const result = spawnSync(cmd, args, {
		cwd: ROOT,
		stdio: "inherit",
		env: { ...process.env, ...env },
	});
	if (result.status !== 0) {
		throw new Error(`${path.basename(cmd)} exited with code ${result.status}`);
	}
}

/**
 * Rewrite each raw V8 dump in `dir` to hold only the CLI bundle's coverage,
 * and drop `source-map-cache` from every dump but the first that has it.
 * Dumps with no CLI coverage are deleted.
 */
function pruneDumps(dir) {
	const isCli = (url) => url.includes("/packages/cli/dist/");
	let keptMapCache = false;
	for (const name of fs.readdirSync(dir)) {
		const file = path.join(dir, name);
		const dump = JSON.parse(fs.readFileSync(file, "utf8"));
		const result = dump.result.filter((entry) => isCli(entry.url));
		if (result.length === 0) {
			fs.rmSync(file);
			continue;
		}
		const pruned = { result, timestamp: dump.timestamp };
		const cache = dump["source-map-cache"];
		if (cache !== undefined && !keptMapCache) {
			pruned["source-map-cache"] = Object.fromEntries(
				Object.entries(cache).filter(([url]) => isCli(url)),
			);
			keptMapCache = true;
		}
		fs.writeFileSync(file, JSON.stringify(pruned));
	}
}

fs.rmSync(RAW_DIR, { recursive: true, force: true });
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

// 1. Run the e2e suite; spawned CLI processes dump raw V8 coverage to RAW_DIR.
//    vitest's own coverage stays off — c8 owns the subprocess numbers.
run(path.join(BIN, "vitest"), ["run", "--project", "e2e", "--coverage=false"], {
	NODE_V8_COVERAGE: RAW_DIR,
});

// 2. Prune the dumps. Each CLI process writes its own copy of the bundle's
//    ~16 MB sourcemap into `source-map-cache`, plus coverage for every Node
//    internal and dependency it loaded. c8 holds every dump in memory, so a few
//    hundred dumps ran out of an 8 GB heap. Keep only the CLI bundle's entries,
//    and the sourcemap in a single dump — c8 merges the caches by URL.
pruneDumps(RAW_DIR);

// 3. Remap raw dumps to source and emit istanbul json for the merge step.
run(
	path.join(BIN, "c8"),
	[
		"report",
		"--temp-directory",
		RAW_DIR,
		"--exclude-after-remap",
		"--all=false",
		"--exclude",
		"**/__tests__/**",
		"--exclude",
		"**/*.test.ts",
		"--exclude",
		"tests/**",
		"--reporter",
		"json",
		"--report-dir",
		OUT_DIR,
	],
	{ NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim() },
);

console.log(`✓ subprocess coverage written to ${path.relative(ROOT, OUT_DIR)}/coverage-final.json`);
