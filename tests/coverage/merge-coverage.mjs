/**
 * Merge in-process (vitest) and subprocess (c8/CLI) coverage into a single
 * istanbul map, print a per-package summary, and enforce global thresholds.
 *
 * Why two sources:
 *   - `coverage/unit/coverage-final.json`  — vitest v8 provider; covers code
 *     imported directly into the unit/integration test process.
 *   - `coverage/e2e/coverage-final.json`   — c8 over NODE_V8_COVERAGE dumps
 *     from the spawned CLI binary (dist bundle), remapped to source via the
 *     tsup sourcemap. This is the only way the subprocess-tested CLI commands
 *     (and the e2e-only `health` checker) get credited.
 *
 * Run via `pnpm test:coverage`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Open-source release target (PLAN_9), now met by the combined unit + e2e
// suites and enforced as the CI gate. Keep them equal: any drop below target
// fails CI. Raise both together if coverage climbs and you want to lock it in.
const TARGET = { statements: 80, branches: 75 };
const GATE = { statements: 80, branches: 75 };

const UNIT_SRC = path.join(ROOT, "coverage/unit/coverage-final.json");
const E2E_SRC = path.join(ROOT, "coverage/e2e/coverage-final.json");

/** Only first-party source counts; tests, barrels, and type-only files do not. */
function isCounted(file) {
	const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
	if (!/^packages\/[^/]+\/src\//.test(rel)) return false;
	if (rel.includes("/__tests__/")) return false;
	if (rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) return false;
	if (rel.endsWith("/index.ts")) return false;
	return true;
}

/**
 * Files whose coverage comes from the subprocess (c8) source, not vitest:
 * the CLI commands and the health-checker are only exercised via the spawned
 * binary. Attribution must be DISJOINT — vitest and c8 instrument the same
 * source with different statement maps, so merging both for one file unions
 * the maps and corrupts the percentage. Each file is credited to exactly one
 * collector.
 */
function isSubprocessOwned(file) {
	const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
	return rel.startsWith("packages/cli/src/") || rel.includes("/core/src/checkers/");
}

function loadFiltered(src, keep) {
	if (!fs.existsSync(src)) {
		console.warn(`⚠  coverage source missing: ${path.relative(ROOT, src)}`);
		return null;
	}
	const json = JSON.parse(fs.readFileSync(src, "utf8"));
	const map = libCoverage.createCoverageMap({});
	for (const [file, fc] of Object.entries(json)) {
		if (!isCounted(file)) continue;
		if (!keep(file)) continue;
		map.merge({ [file]: fc });
	}
	return map;
}

const map = libCoverage.createCoverageMap({});
let loaded = 0;
// vitest owns in-process unit/integration code; c8 owns subprocess-only code.
const unit = loadFiltered(UNIT_SRC, (f) => !isSubprocessOwned(f));
const e2e = loadFiltered(E2E_SRC, (f) => isSubprocessOwned(f));
for (const m of [unit, e2e]) {
	if (m) {
		map.merge(m);
		loaded++;
	}
}
if (loaded === 0) {
	console.error("✗ no coverage sources found — run unit + e2e coverage first");
	process.exit(1);
}

// Aggregate per package, skipping files with no executable statements
// (pure type-only modules report 0/0 and must not dilute the percentage).
const perPackage = new Map();
const global = libCoverage.createCoverageSummary();

for (const file of map.files()) {
	if (!isCounted(file)) continue;
	const summary = map.fileCoverageFor(file).toSummary();
	if (summary.statements.total === 0) continue;
	const rel = path.relative(ROOT, file).replaceAll(path.sep, "/");
	const pkg = rel.split("/")[1];
	if (!perPackage.has(pkg)) perPackage.set(pkg, libCoverage.createCoverageSummary());
	perPackage.get(pkg).merge(summary);
	global.merge(summary);
}

const pct = (n) => `${n.toFixed(2)}%`.padStart(8);
console.log("\nMerged coverage (unit + subprocess e2e)\n");
console.log(`${"package".padEnd(12)}${"stmts".padStart(9)}${"branch".padStart(9)}${"funcs".padStart(9)}${"lines".padStart(9)}`);
console.log("-".repeat(48));
for (const [pkg, s] of [...perPackage].sort()) {
	const j = s.toJSON();
	console.log(`${pkg.padEnd(12)}${pct(j.statements.pct)}${pct(j.branches.pct)}${pct(j.functions.pct)}${pct(j.lines.pct)}`);
}
const g = global.toJSON();
console.log("-".repeat(48));
console.log(`${"ALL".padEnd(12)}${pct(g.statements.pct)}${pct(g.branches.pct)}${pct(g.functions.pct)}${pct(g.lines.pct)}\n`);

console.log(`gate: ${GATE.statements}% stmts / ${GATE.branches}% branches (CI fails below this)`);
if (g.statements.pct < TARGET.statements || g.branches.pct < TARGET.branches) {
	console.log("note: below target — remaining gap is CLI-command coverage; add e2e tests, then raise the gate.");
}

const failures = [];
if (g.statements.pct < GATE.statements)
	failures.push(`statements ${g.statements.pct.toFixed(2)}% < gate ${GATE.statements}%`);
if (g.branches.pct < GATE.branches)
	failures.push(`branches ${g.branches.pct.toFixed(2)}% < gate ${GATE.branches}%`);

if (failures.length > 0) {
	console.error(`\n✗ coverage regressed below gate:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`✓ coverage gate met (statements ≥ ${GATE.statements}%, branches ≥ ${GATE.branches}%)`);
