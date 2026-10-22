/**
 * The version the deterministic tier installs by default (REQ-EVAL-14).
 *
 * A hardcoded default drifted behind the published release twice — 2.2.0 while
 * 2.2.1 was out, then 2.2.1 while 2.4.2 was out — so CI gated on bugs already
 * fixed and never saw the current release. The release commit bumps
 * `packages/cli/package.json`, so reading it tracks the release by construction.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Reads the CLI package's declared version.
 *
 * @param repoRoot - The repository root.
 * @returns The version string.
 * @throws {Error} If the manifest has no string version.
 */
export async function readDefaultVersion(repoRoot: string): Promise<string> {
	const manifest = path.join(repoRoot, "packages", "cli", "package.json");
	const pkg = JSON.parse(await fs.readFile(manifest, "utf8")) as { version?: unknown };
	if (typeof pkg.version !== "string") throw new Error("packages/cli/package.json has no version");
	return pkg.version;
}
