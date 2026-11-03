/**
 * Guard for commands that ask questions.
 *
 * A prompt read from a closed or piped stdin never settles, so Node drains the
 * event loop and exits 0 mid-question — a harness reads that as success.
 *
 * @module
 */

import { CliError } from "@dev-session/security";

/**
 * Fails before a command prompts when stdin is not a terminal (REQ-ORC-9).
 *
 * @param command - The command name, e.g. `init`.
 * @param suggestion - What to run instead; should name `--yes`.
 * @returns Nothing when stdin is a terminal.
 * @throws {CliError} When stdin is not a terminal.
 */
export function requireTerminal(command: string, suggestion: string): void {
	if (process.stdin.isTTY === true) return;
	throw new CliError({
		message: `${command} asks questions, and stdin is not a terminal, so nothing would answer them.`,
		suggestion,
	});
}
