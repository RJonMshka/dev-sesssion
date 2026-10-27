/**
 * `compact`, removed in 3.0 (LLD-offline.md, REQ-OFF-3).
 *
 * It sent a file to the Anthropic API with a key of its own. dev-sesssion now
 * calls no model and makes no network request (REQ-OFF-1); the agent in the
 * user's harness can shorten a file with the subscription it already has. The
 * command stays registered, hidden, so a script that still calls it gets a
 * reason instead of Commander's bare "unknown command".
 *
 * @module
 */

import { CliError } from "@dev-session/security";
import type { Command } from "commander";
import { handleError } from "../utils/error-handler.js";

/**
 * Registers the hidden `compact` stub.
 *
 * @param program - The root Commander program.
 */
export function registerCompactRemovedCommand(program: Command): void {
	program
		.command("compact", { hidden: true })
		.allowUnknownOption()
		.allowExcessArguments()
		.action(() => {
			handleError(
				new CliError({
					message:
						"`compact` was removed in dev-sesssion 3.0: it called an API with a key of its own.",
					suggestion:
						"Ask the agent in your harness (Claude Code, opencode, Cursor, Windsurf) to shorten the file, then run `dev-sesssion update`.",
				}),
			);
		});
}
