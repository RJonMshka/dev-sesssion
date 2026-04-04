/**
 * Global error handler for the dev-session CLI.
 *
 * Catches typed errors (CliError, ParseError, SecurityError) and formats
 * them for terminal output. Unrecognized errors get a generic message.
 *
 * @module
 */

import { log } from "@clack/prompts";
import { isCliError, isParseError, isSecurityError } from "@dev-session/security";

/**
 * Format and display an error in the terminal, then exit with the
 * appropriate code.
 *
 * @param error - The caught error (typed or unknown)
 * @param opts - Options controlling exit behavior
 * @param opts.exit - Whether to call process.exit (default: true). Set to false in tests.
 * @returns The exit code that was (or would be) used
 */
export function handleError(error: unknown, opts: { exit?: boolean } = {}): number {
	const shouldExit = opts.exit !== false;

	if (isSecurityError(error)) {
		log.error(`Security violation: ${error.message}`);
		log.warn(`Threat type: ${error.threat}`);
		const code = 3;
		if (shouldExit) {
			process.exit(code);
		}
		return code;
	}

	if (isParseError(error)) {
		const location = error.file
			? error.line !== undefined
				? `${error.file}:${error.line}`
				: error.file
			: "unknown file";
		log.error(`Parse error in ${location}: ${error.message}`);
		const code = 2;
		if (shouldExit) {
			process.exit(code);
		}
		return code;
	}

	if (isCliError(error)) {
		log.error(error.message);
		if (error.suggestion) {
			log.info(`Suggestion: ${error.suggestion}`);
		}
		const code = 1;
		if (shouldExit) {
			process.exit(code);
		}
		return code;
	}

	// Unknown error — generic handling, never leak internals
	if (error instanceof Error) {
		log.error(`Unexpected error: ${error.message}`);
	} else {
		log.error("An unexpected error occurred.");
	}

	const code = 1;
	if (shouldExit) {
		process.exit(code);
	}
	return code;
}
