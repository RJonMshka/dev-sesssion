/**
 * Objective correctness gate for a cold-agent run.
 *
 * Typecheck and the project's own test suite are the only signals here that do
 * not depend on a model's opinion, so every judged score is anchored to them.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Result of one objective gate. */
export interface GateResult {
	readonly passed: boolean;
	readonly exitCode: number;
	/** Tail of combined output, for triage. */
	readonly output: string;
}

/** Both objective gates for a workspace. */
export interface VerificationResult {
	readonly typecheck: GateResult;
	/**
	 * Distinct tsc diagnostics, as `file(line,col): errorCode`. Compared against
	 * an unablated baseline so pre-existing breakage is not blamed on the agent —
	 * fixtures and real repos alike ship with errors already present.
	 */
	readonly typecheckErrors: readonly string[];
	readonly tests: GateResult;
}

/** Matches a tsc diagnostic line: `path(line,col): error TS1234: message`. */
const TSC_ERROR_RE = /^(.+?\((\d+),(\d+)\)): error (TS\d+):/;

/**
 * Extracts stable diagnostic identities from tsc output.
 *
 * The message text is dropped so trivial rewordings do not read as new errors.
 *
 * @param output - Raw tsc output.
 * @returns Sorted, deduplicated diagnostic identities.
 */
export function parseTscErrors(output: string): string[] {
	const found = new Set<string>();
	for (const line of output.split("\n")) {
		const m = TSC_ERROR_RE.exec(line.trim());
		if (m?.[1] !== undefined && m[4] !== undefined) found.add(`${m[1]}: ${m[4]}`);
	}
	return [...found].sort();
}

/**
 * Diagnostics present after a run but absent from the baseline.
 *
 * @param baseline - Baseline diagnostic identities.
 * @param after - Post-run diagnostic identities.
 * @returns Newly introduced diagnostics.
 */
export function newTypeErrors(baseline: readonly string[], after: readonly string[]): string[] {
	const known = new Set(baseline);
	return after.filter((e) => !known.has(e));
}

/**
 * Runs a command in the workspace, capturing output without throwing.
 *
 * @param cmd - Executable.
 * @param args - Argument array.
 * @param cwd - Workspace directory.
 * @returns The gate result.
 */
async function runGate(cmd: string, args: readonly string[], cwd: string): Promise<GateResult> {
	try {
		const { stdout, stderr } = await execFileAsync(cmd, [...args], {
			cwd,
			maxBuffer: 32 * 1024 * 1024,
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
		});
		return { passed: true, exitCode: 0, output: `${stdout}${stderr}`.trim().slice(-8000) };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
		return {
			passed: false,
			exitCode: typeof e.code === "number" ? e.code : 1,
			output: `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.trim().slice(-8000),
		};
	}
}

/**
 * Typechecks the workspace and runs its test suite.
 *
 * @param workspaceDir - Absolute workspace root.
 * @returns Both gate results.
 */
export async function verifyWorkspace(workspaceDir: string): Promise<VerificationResult> {
	const bin = (name: string): string => path.join(workspaceDir, "node_modules", ".bin", name);
	const typecheck = await runGate(bin("tsc"), ["--noEmit"], workspaceDir);
	const tests = await runGate(bin("vitest"), ["run", "--reporter=basic"], workspaceDir);
	return { typecheck, typecheckErrors: parseTscErrors(typecheck.output), tests };
}
