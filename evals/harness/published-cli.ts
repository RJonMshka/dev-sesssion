/**
 * Installs and drives the *published* dev-sesssion CLI.
 *
 * The eval deliberately exercises the npm tarball rather than the workspace
 * build: packaging bugs (bundle layout, shebang, `../package.json` resolution)
 * only reproduce against the artifact users actually install.
 *
 * @module
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** npm package name — three s's, deliberately. */
const PACKAGE_NAME = "dev-sesssion";

/** Result of running the CLI. */
export interface CliResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	/** True when the run was killed for exceeding its timeout. */
	readonly timedOut?: boolean;
}

/** Options for one run. */
export interface RunOptions {
	/** Kill the process after this many milliseconds; no limit when absent. */
	readonly timeoutMs?: number;
}

/** A CLI installed at a pinned version. */
export interface InstalledCli {
	readonly version: string;
	readonly binPath: string;
	/** Runs the CLI in `cwd`; never rejects on a non-zero exit or a timeout. */
	run(args: readonly string[], cwd: string, opts?: RunOptions): Promise<CliResult>;
}

/**
 * Installs the published CLI into a throwaway prefix and returns a runner.
 *
 * @param version - Exact version to install, e.g. `"2.2.0"`.
 * @returns A handle that runs the installed binary.
 * @throws {Error} If npm install fails or the binary is missing afterwards.
 */
export async function installPublishedCli(version: string): Promise<InstalledCli> {
	return await installIntoPrefix(`${PACKAGE_NAME}@${version}`, version);
}

/**
 * Packs the workspace build into a tarball and installs that (REQ-EVAL-9).
 *
 * Unreleased behaviour is measured through the same `npm install` path users
 * take, so bundle and packaging defects still reproduce. Requires `pnpm build`.
 *
 * @param repoRoot - The repository root.
 * @returns A handle whose `version` is `"local"`.
 * @throws {Error} If the CLI is not built, or packing or installing fails.
 */
export async function installLocalCli(repoRoot: string): Promise<InstalledCli> {
	const cliDir = path.join(repoRoot, "packages", "cli");
	try {
		await fs.access(path.join(cliDir, "dist", "index.cjs"));
	} catch {
		throw new Error("packages/cli is not built — run `pnpm build` first");
	}
	const packDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-sesssion-eval-pack-"));
	await execFileAsync("pnpm", ["pack", "--pack-destination", packDir], {
		cwd: cliDir,
		maxBuffer: 32 * 1024 * 1024,
	});
	const tarball = (await fs.readdir(packDir)).find((f) => f.endsWith(".tgz"));
	if (tarball === undefined) throw new Error("pnpm pack produced no tarball");
	return await installIntoPrefix(path.join(packDir, tarball), "local");
}

/**
 * Installs an npm spec into a throwaway prefix and returns a runner for it.
 *
 * @param spec - What to `npm install`: `name@version` or a tarball path.
 * @param version - The label the handle reports.
 * @returns A handle that runs the installed binary.
 * @throws {Error} If npm install fails or the binary is missing afterwards.
 */
async function installIntoPrefix(spec: string, version: string): Promise<InstalledCli> {
	const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "dev-sesssion-eval-cli-"));
	// npm walks up for a package.json without one here, which would install into the repo.
	await fs.writeFile(
		path.join(prefix, "package.json"),
		JSON.stringify({ name: "eval-cli-prefix", private: true, version: "0.0.0" }),
		"utf8",
	);

	await execFileAsync("npm", ["install", "--silent", spec], {
		cwd: prefix,
		maxBuffer: 32 * 1024 * 1024,
	});

	const binPath = path.join(prefix, "node_modules", ".bin", PACKAGE_NAME);
	try {
		await fs.access(binPath);
	} catch {
		throw new Error(`installed ${spec} but no binary at node_modules/.bin`);
	}

	return {
		version,
		binPath,
		async run(args: readonly string[], cwd: string, opts?: RunOptions): Promise<CliResult> {
			try {
				const { stdout, stderr } = await execFileAsync(binPath, [...args], {
					cwd,
					maxBuffer: 32 * 1024 * 1024,
					...(opts?.timeoutMs === undefined ? {} : { timeout: opts.timeoutMs }),
					env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" },
				});
				return { stdout, stderr, exitCode: 0 };
			} catch (err: unknown) {
				const e = err as {
					stdout?: string;
					stderr?: string;
					code?: number;
					killed?: boolean;
					message?: string;
				};
				return {
					stdout: e.stdout ?? "",
					stderr: e.stderr ?? e.message ?? "",
					exitCode: typeof e.code === "number" ? e.code : 1,
					timedOut: e.killed === true,
				};
			}
		},
	};
}
