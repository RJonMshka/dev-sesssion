/**
 * Shared dependency cache for eval workspaces.
 *
 * Fixture projects ship no `node_modules`, and installing per workspace would
 * dominate runtime. Deps are installed once into a cache keyed by target and
 * symlinked into each workspace, leaving `tests/fixtures/` untouched — the
 * existing test suite asserts against those files.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Deps the fixture's own tests need but its manifest omits, plus the toolchain
 * the eval's verification gate runs.
 */
const EXTRA_DEPS: Readonly<Record<string, string>> = {
	supertest: "^7.0.0",
	"@types/supertest": "^6.0.0",
};

/**
 * Installs (or reuses) the dependency set for a target.
 *
 * @param cacheRoot - Directory holding all dependency caches.
 * @param targetId - Target id, used as the cache key.
 * @param sourceDir - The target's source directory, read for its manifest.
 * @returns Absolute path to the installed `node_modules`.
 * @throws {Error} If the install fails.
 */
export async function ensureFixtureDeps(
	cacheRoot: string,
	targetId: string,
	sourceDir: string,
): Promise<string> {
	const cacheDir = path.join(cacheRoot, targetId);
	const nodeModules = path.join(cacheDir, "node_modules");

	const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};

	const deps: Record<string, string> = {
		...(manifest.dependencies ?? {}),
		...(manifest.devDependencies ?? {}),
		...EXTRA_DEPS,
	};

	const desired = JSON.stringify(deps, Object.keys(deps).sort());
	const stampPath = path.join(cacheDir, ".deps-stamp");
	try {
		if ((await fs.readFile(stampPath, "utf8")) === desired) return nodeModules;
	} catch {
		// No usable cache — fall through and install.
	}

	await fs.mkdir(cacheDir, { recursive: true });
	await fs.writeFile(
		path.join(cacheDir, "package.json"),
		JSON.stringify(
			{ name: `eval-deps-${targetId}`, private: true, version: "0.0.0", dependencies: deps },
			null,
			2,
		),
		"utf8",
	);

	await execFileAsync("npm", ["install", "--silent", "--no-audit", "--no-fund"], {
		cwd: cacheDir,
		maxBuffer: 64 * 1024 * 1024,
	});

	await fs.writeFile(stampPath, desired, "utf8");
	return nodeModules;
}

/**
 * Symlinks a cached `node_modules` into a workspace.
 *
 * @param workspaceDir - Absolute workspace root.
 * @param nodeModules - Absolute path to the cached `node_modules`.
 */
export async function linkDeps(workspaceDir: string, nodeModules: string): Promise<void> {
	const target = path.join(workspaceDir, "node_modules");
	await fs.rm(target, { recursive: true, force: true });
	await fs.symlink(nodeModules, target, "dir");
}
