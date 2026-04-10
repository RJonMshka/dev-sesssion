/**
 * Vitest globalSetup for E2E tests.
 *
 * Ensures the CLI binary exists before any E2E test runs.
 * If the dist is missing, runs `pnpm build` automatically.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CLI_BIN = path.join(ROOT, "packages/cli/dist/index.cjs");

export async function setup(): Promise<void> {
	if (!fs.existsSync(CLI_BIN)) {
		console.log("[e2e setup] CLI dist missing — running pnpm build...");
		await execa("pnpm", ["build"], { cwd: ROOT, stdio: "inherit" });
		console.log("[e2e setup] build complete");
	}
}
