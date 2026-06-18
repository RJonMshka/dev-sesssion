/**
 * `dev-sesssion migrate` command.
 *
 * Detects monorepo workspace configuration (pnpm-workspace.yaml, nx.json,
 * turbo.json, package.json workspaces) and offers to initialize
 * dev-sesssion in each workspace package that does not already have a
 * `.session/` directory.
 *
 * Business logic (MonorepoDetector) lives in @dev-session/core.
 * This module handles prompts, formatting, and orchestration.
 *
 * @module
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { cancel, intro, isCancel, log, multiselect, outro, spinner } from "@clack/prompts";
import type { WorkspacePackage } from "@dev-session/core";
import { MonorepoDetector } from "@dev-session/core";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";
import type { InitOptions } from "./init.js";
import { runInit } from "./init.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the migrate command. */
export interface MigrateOptions {
	/** Working directory (project root). */
	readonly cwd: string;
	/** Skip all prompts and init all packages. */
	readonly yes: boolean;
	/** Log writes without touching the filesystem. */
	readonly dryRun: boolean;
	/** Show verbose output. */
	readonly verbose: boolean;
	/** Enable strict mode. */
	readonly strict: boolean;
	/** Explicit adapter override. */
	readonly adapter?: string;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

/**
 * Execute the migrate command.
 *
 * @param options - Resolved CLI options.
 * @throws {CliError} if detection or init fails.
 */
export async function runMigrate(options: MigrateOptions): Promise<void> {
	intro("dev-sesssion migrate");

	const s = spinner();

	// --- 1. Detect monorepo ---
	s.start("Detecting monorepo workspace...");
	const info = MonorepoDetector.detect(options.cwd);
	s.stop(info.isMonorepo ? `Detected ${info.type} workspace.` : "No monorepo workspace detected.");

	if (!info.isMonorepo || info.packages.length === 0) {
		log.warn(
			"No workspace packages found. Run `dev-sesssion init` directly in the package directories.",
		);
		outro("Nothing to migrate.");
		return;
	}

	log.info(
		`Found ${info.packages.length} workspace package${info.packages.length === 1 ? "" : "s"}:`,
	);
	for (const pkg of info.packages) {
		const label = pkg.name ?? pkg.relativePath;
		const status = packageHasSession(pkg.absolutePath) ? " (already initialized)" : "";
		log.message(`  ${label}${status}`);
	}

	// --- 2. Filter to packages that need init ---
	const needsInit = info.packages.filter((p) => !packageHasSession(p.absolutePath));

	if (needsInit.length === 0) {
		log.success("All packages already have dev-sesssion initialized.");
		outro("Nothing to do.");
		return;
	}

	// --- 3. Select packages to initialize ---
	let selected: readonly WorkspacePackage[];

	if (options.yes) {
		selected = needsInit;
		log.info(
			`Initializing all ${needsInit.length} package${needsInit.length === 1 ? "" : "s"} (--yes mode).`,
		);
	} else {
		const choices = needsInit.map((pkg) => ({
			value: pkg.relativePath,
			label: pkg.name ?? pkg.relativePath,
			hint: pkg.relativePath,
		}));

		const result = await multiselect({
			message: "Select packages to initialize:",
			options: choices,
			required: false,
		});

		if (isCancel(result) || !Array.isArray(result)) {
			cancel("Migration cancelled.");
			outro("No changes made.");
			return;
		}

		const selectedPaths = new Set<string>(result);
		selected = needsInit.filter((p) => selectedPaths.has(p.relativePath));
	}

	if (selected.length === 0) {
		outro("No packages selected. Nothing to do.");
		return;
	}

	// --- 4. Init each selected package ---
	let successCount = 0;
	let failCount = 0;

	for (const pkg of selected) {
		const label = pkg.name ?? pkg.relativePath;
		log.step(`Initializing ${label}...`);

		const initOptions: InitOptions = {
			cwd: pkg.absolutePath,
			yes: options.yes,
			dryRun: options.dryRun,
			verbose: options.verbose,
			strict: options.strict,
			...(options.adapter !== undefined ? { adapter: options.adapter } : {}),
		};

		try {
			await runInit(initOptions);
			successCount++;
		} catch (error: unknown) {
			log.error(`Failed to initialize ${label}: ${errorMessage(error)}`);
			failCount++;
		}
	}

	// --- 5. Summary ---
	if (failCount === 0) {
		outro(
			`Migration complete. ${successCount} package${successCount === 1 ? "" : "s"} initialized.`,
		);
	} else {
		outro(`Migration done with errors. ${successCount} succeeded, ${failCount} failed.`);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a package directory already has a `.session/` directory.
 *
 * @param absolutePath - Absolute path to the package directory.
 * @returns true if `.session/` exists.
 */
function packageHasSession(absolutePath: string): boolean {
	return fs.existsSync(path.join(absolutePath, ".session"));
}

/**
 * Extract a human-readable message from an unknown error.
 *
 * @param error - The caught error value.
 * @returns A string message.
 */
function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

// ---------------------------------------------------------------------------
// Commander registration
// ---------------------------------------------------------------------------

/**
 * Register the `migrate` command on a Commander program.
 *
 * @param program - The root Commander program.
 */
export function registerMigrateCommand(program: Command): void {
	program
		.command("migrate")
		.description("Initialize dev-sesssion in monorepo workspace packages")
		.action(async () => {
			const opts = program.opts<{
				cwd: string;
				yes: boolean;
				dryRun: boolean;
				verbose: boolean;
				strict: boolean;
				adapter?: string;
			}>();

			const migrateOptions: MigrateOptions = {
				cwd: opts.cwd,
				yes: opts.yes,
				dryRun: opts.dryRun,
				verbose: opts.verbose,
				strict: opts.strict,
				...(opts.adapter !== undefined ? { adapter: opts.adapter } : {}),
			};

			try {
				await runMigrate(migrateOptions);
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
