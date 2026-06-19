/**
 * Runtime version reader for the dev-sesssion CLI package.
 *
 * Shared by the Commander `--version` flag and the MCP server handshake so
 * both advertise the same, real published version instead of a hardcoded
 * string.
 *
 * @module
 */

import { readFileSync } from "node:fs";

/**
 * Read the CLI version at runtime from the package's own `package.json`.
 *
 * `../package.json` resolves correctly relative to this module in every form:
 * source (`src/read-version.ts`), the bundle (`dist/index.{c,m}js`), and the
 * published package (`node_modules/dev-sesssion/`). Read at runtime — not baked
 * at build time — because semantic-release sets the version after the build
 * step runs.
 *
 * @returns The semver string from package.json, or "0.0.0" if it can't be read.
 */
export function readVersion(): string {
	try {
		const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const pkg = JSON.parse(raw) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}
