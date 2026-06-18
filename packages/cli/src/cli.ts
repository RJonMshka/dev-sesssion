/**
 * Commander program setup for the dev-sesssion CLI.
 *
 * Defines the root program with global options and registers all
 * subcommands. This module owns the Commander instance — `index.ts`
 * imports and runs it.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerAdvanceCommand } from "./commands/advance.js";
import { registerCompactCommand } from "./commands/compact.js";
import { registerExportCommand } from "./commands/export.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerImportCommand } from "./commands/import.js";
import { registerIndexCommand } from "./commands/index-cmd.js";
import { registerInitCommand } from "./commands/init.js";
import { registerLintContextCommand } from "./commands/lint-context.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerMemoryCommand } from "./commands/memory.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerPreviewCommand } from "./commands/preview.js";
import { registerPromptCommand } from "./commands/prompt.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTrimCommand } from "./commands/trim.js";
import { registerUpdateCommand } from "./commands/update.js";
import { handleError } from "./utils/error-handler.js";
import { installSignalHandlers } from "./utils/signal-handler.js";

/**
 * The CLI version, read at runtime from the package's own package.json.
 *
 * `../package.json` resolves correctly relative to the module in every form:
 * source (`src/cli.ts`), the bundle (`dist/index.{c,m}js`), and the published
 * package (`node_modules/dev-sesssion/`). Read at runtime — not baked at build
 * time — because semantic-release sets the version after the build step runs.
 *
 * @returns The semver string from package.json, or "0.0.0" if it can't be read.
 */
function readVersion(): string {
	try {
		const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
		const pkg = JSON.parse(raw) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Create and configure the Commander program.
 *
 * @returns The configured Commander program (not yet parsed)
 */
export function createProgram(): Command {
	const program = new Command();

	program
		.name("dev-sesssion")
		.description("Self-managing context architecture for AI-assisted coding sessions")
		.version(readVersion())
		.option("--cwd <path>", "Working directory", process.cwd())
		.option("-y, --yes", "Skip prompts and use defaults", false)
		.option("--dry-run", "Show what would be written without writing", false)
		.option("-v, --verbose", "Show detailed output", false)
		.option("--strict", "Block on secret detection instead of warning", false)
		.option(
			"--adapter <name>",
			"Override adapter auto-detection (claude, opencode, cursor, windsurf)",
		);

	// Use exitOverride so Commander throws instead of calling process.exit
	// directly — lets our global error handler manage exit codes.
	program.exitOverride();

	// Register subcommands
	registerInitCommand(program);
	registerMigrateCommand(program);
	registerStatusCommand(program);
	registerUpdateCommand(program);
	registerAdvanceCommand(program);
	registerPromptCommand(program);
	registerIndexCommand(program);
	registerHealthCommand(program);
	registerImportCommand(program);
	registerExportCommand(program);
	registerPreviewCommand(program);
	registerTrimCommand(program);
	registerLintContextCommand(program);
	registerCompactCommand(program);
	registerMemoryCommand(program);
	registerMcpCommand(program);

	return program;
}

/**
 * Parse arguments and run the CLI.
 *
 * Installs signal handlers, creates the program, parses argv,
 * and handles any uncaught errors.
 *
 * @param argv - Process arguments (defaults to process.argv)
 * @returns Promise that resolves when the command completes
 */
export async function run(argv?: readonly string[]): Promise<void> {
	const removeHandlers = installSignalHandlers();

	try {
		const program = createProgram();
		await program.parseAsync(argv as string[] | undefined);
	} catch (error: unknown) {
		// Commander's exitOverride throws CommanderError on --help / --version
		// with exitCode 0. Let those pass through cleanly.
		if (isCommanderExit(error, 0)) {
			return;
		}

		// Commander parse errors (unknown option, missing arg) exit with code 1
		if (isCommanderExit(error)) {
			// Commander already printed the error message
			process.exit(1);
			return;
		}

		handleError(error);
	} finally {
		removeHandlers();
	}
}

/**
 * Check if an error is a Commander exit (thrown by exitOverride).
 *
 * @param error - The caught error
 * @param exitCode - Optional specific exit code to match
 * @returns true if the error is a Commander exit error
 */
function isCommanderExit(error: unknown, exitCode?: number): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	// Commander throws errors with name "CommanderError" when exitOverride is set
	if (error.name !== "CommanderError") {
		return false;
	}
	if (exitCode !== undefined) {
		return (error as Error & { exitCode?: number }).exitCode === exitCode;
	}
	return true;
}
