/**
 * One-off baseline probe: does an unablated target typecheck and test clean?
 *
 * If the baseline is red, the objective gate cannot distinguish agent failure
 * from pre-existing fixture breakage, so this must pass before the cold-agent
 * tier means anything.
 *
 * @module
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyWorkspace } from "./checks/verification.js";
import { ensureFixtureDeps, linkDeps } from "./harness/fixture-deps.js";
import { prepareWorkspace } from "./harness/workspace.js";
import { TARGETS } from "./targets.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Probes every target's unablated baseline.
 *
 * @returns Resolves when all targets have been probed.
 */
async function main(): Promise<void> {
	const cacheRoot = path.join(REPO_ROOT, "evals", ".cache", "deps");
	for (const target of TARGETS) {
		const sourceDir = path.join(REPO_ROOT, target.sourceDir);
		process.stdout.write(`▸ ${target.id}: installing deps (once)...\n`);
		const nodeModules = await ensureFixtureDeps(cacheRoot, target.id, sourceDir);

		const ws = await prepareWorkspace(sourceDir, null);
		try {
			await linkDeps(ws.dir, nodeModules);
			const v = await verifyWorkspace(ws.dir);
			process.stdout.write(
				`  typecheck: ${v.typecheck.passed ? "PASS" : `FAIL (${String(v.typecheck.exitCode)})`}\n`,
			);
			if (!v.typecheck.passed) process.stdout.write(`${v.typecheck.output}\n\n`);
			process.stdout.write(
				`  tests:     ${v.tests.passed ? "PASS" : `FAIL (${String(v.tests.exitCode)})`}\n`,
			);
			if (!v.tests.passed) process.stdout.write(`${v.tests.output}\n`);
		} finally {
			await ws.cleanup();
		}
	}
}

main().catch((err: unknown) => {
	process.stderr.write(`baseline failed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
});
