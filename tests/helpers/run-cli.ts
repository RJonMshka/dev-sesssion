/**
 * E2E test helper — run the dev-session CLI binary as a subprocess.
 *
 * Uses execa to invoke the compiled CLI via a thin wrapper script so tests
 * exercise the real compiled artifact, not the TypeScript source. ANSI codes
 * are stripped from all output before returning.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import stripAnsi from "strip-ansi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Thin CJS wrapper that calls run() directly — bypasses the auto-run
 * heuristic in index.ts which checks process.argv[1].includes("dev-session").
 * IMPORTANT: this file must NOT be named "dev-session.*" or the auto-run
 * check will fire a second time when the module is required, causing double
 * execution.
 */
export const CLI_WRAPPER = path.resolve(__dirname, "./cli-runner.cjs");

/** Absolute path to the compiled CLI entry point (for existence checks). */
export const CLI_BIN = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

export interface RunResult {
	/** Exit code of the process. */
	exitCode: number;
	/** Combined stdout (ANSI stripped). */
	stdout: string;
	/** Combined stderr (ANSI stripped). */
	stderr: string;
	/** True if the process exited with code 0. */
	ok: boolean;
}

/**
 * Run the dev-session CLI with the given arguments.
 *
 * @param args - CLI arguments (e.g. ["init", "--yes", "--cwd", "/tmp/x"])
 * @param options - Optional overrides for cwd and env
 * @returns RunResult with exit code and stripped output
 */
export async function runCli(
	args: string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
	if (!fs.existsSync(CLI_BIN)) {
		throw new Error(
			`CLI binary not found at ${CLI_BIN}. Run 'pnpm build' before running E2E tests.`,
		);
	}

	const result = await execa("node", [CLI_WRAPPER, ...args], {
		...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
		env: {
			...process.env,
			// Disable color output for deterministic assertions
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...options.env,
		},
		reject: false,
		all: true,
	});

	return {
		exitCode: result.exitCode ?? 0,
		stdout: stripAnsi(result.stdout),
		stderr: stripAnsi(result.stderr),
		ok: (result.exitCode ?? 0) === 0,
	};
}
