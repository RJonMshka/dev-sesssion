/**
 * `dev-sesssion symbols` (LLD-symbols.md, area SYM).
 *
 * - `symbols <path>` — what the ai-index holds for one file: cost, summary,
 *   exports with signatures, units with ranges and costs, and whether the
 *   record still matches the file.
 * - `symbols --name <name>` — every unit a name matches, and which of them a
 *   task naming it in backticks would focus.
 *
 * Reads only. The query and the rendering live in core (`SymbolQuery`); this
 * module parses arguments, prints, and sets the exit code.
 *
 * @module
 */

import { log } from "@clack/prompts";
import {
	SessionManager,
	type SymbolFileReport,
	type SymbolNameReport,
	SymbolQuery,
} from "@dev-session/core";
import { CliError } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

/** Options for {@link runSymbols}. */
export interface SymbolsOptions {
	/** The project root. */
	readonly cwd: string;
	/** A file path, relative to `cwd`. Exactly one of `file` and `name`. */
	readonly file?: string;
	/** A unit name. Exactly one of `file` and `name`. */
	readonly name?: string;
	/** Print the report as one JSON document. */
	readonly json: boolean;
}

/**
 * Runs the query and prints the report.
 *
 * @param options - Project root, the one selector, and output mode.
 * @returns `false` when `--name` matched nothing (REQ-SYM-6), else `true`.
 * @throws {CliError} If both or neither selector is given, or the index is missing.
 * @throws {SecurityError} If the path escapes the project root.
 */
export function runSymbols(options: SymbolsOptions): boolean {
	if ((options.file === undefined) === (options.name === undefined)) {
		throw new CliError({
			message: "Give a file or a name, not both",
			suggestion: "Use `dev-sesssion symbols <path>` or `dev-sesssion symbols --name <name>`.",
		});
	}
	const manager = SessionManager.create(options.cwd, { readOnly: true });
	const report: SymbolFileReport | SymbolNameReport =
		options.file !== undefined
			? manager.symbolsForFile(options.file)
			: manager.symbolsByName(options.name ?? "");

	if (options.json) {
		// REQ-SYM-10 — one JSON document on stdout, nothing else.
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	} else {
		log.message(SymbolQuery.renderText(report).join("\n"));
	}
	return !("matches" in report) || report.matches.length > 0;
}

/**
 * Register the `symbols` command.
 *
 * @param program - The root Commander program
 */
export function registerSymbolsCommand(program: Command): void {
	program
		.command("symbols [path]")
		.description("Show what the ai-index holds for a file, or where a name is declared")
		.option("--name <name>", "Find the units a name matches, and whether a task would focus them")
		.option("--json", "Output machine-readable JSON", false)
		.action((file: string | undefined, cmdOptions: { name?: string; json?: boolean }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				const found = runSymbols({
					cwd: opts.cwd,
					...(file !== undefined ? { file } : {}),
					...(cmdOptions.name !== undefined ? { name: cmdOptions.name } : {}),
					json: cmdOptions.json ?? false,
				});
				if (!found) process.exitCode = 1;
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
