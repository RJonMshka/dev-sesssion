/**
 * `dev-sesssion mcp` command.
 *
 * Starts the dev-sesssion Model Context Protocol server over stdio, exposing
 * `.session/` state to an agent as pull-based tools. Business logic lives in
 * the `SessionManager` facade (@dev-session/core); the MCP wiring lives in
 * `../mcp/`. This module only handles Commander registration.
 *
 * @module
 */

import type { Command } from "commander";

import { startStdioServer } from "../mcp/server.js";
import { handleError } from "../utils/error-handler.js";

/** Options passed from Commander to the mcp action. */
export interface McpOptions {
	/** Working directory override. */
	readonly cwd: string;
	/** Disable mutating tools (shared/team setups). */
	readonly readOnly: boolean;
}

/**
 * Start the MCP server.
 *
 * Runs until stdin closes. Stdout is reserved for the MCP protocol, so this
 * command emits no human-readable output on the happy path.
 *
 * @param options - Resolved CLI options.
 * @throws {CliError} If no `.session/` directory exists.
 */
export async function runMcp(options: McpOptions): Promise<void> {
	await startStdioServer({ cwd: options.cwd, readOnly: options.readOnly });
}

/**
 * Register the `mcp` command on a Commander program.
 *
 * @param program - The root Commander program.
 */
export function registerMcpCommand(program: Command): void {
	program
		.command("mcp")
		.description("Start the dev-sesssion MCP server (stdio) to serve .session/ state to an agent")
		.option("--read-only", "Disable mutating tools (mark_task_done)", false)
		.action(async (cmdOptions: { readOnly?: boolean }) => {
			const opts = program.opts<{ cwd: string }>();
			try {
				await runMcp({
					cwd: opts.cwd,
					readOnly: cmdOptions.readOnly ?? false,
				});
			} catch (error: unknown) {
				handleError(error);
			}
		});
}
